import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/auth/oauth/[provider]/callback/route';
import { db } from '@/lib/db';
import * as oauthModule from '@/lib/oauth';
import * as sessionModule from '@/lib/session';
import * as emailVerificationModule from '@/lib/email-verification';
import { signOAuthStateToken } from '@/lib/jwt';

vi.mock('@/lib/db', () => ({
  db: {
    teacher: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/session', () => ({
  createSession: vi.fn().mockResolvedValue({ sessionId: 'mock-session-id' }),
}));

vi.mock('@/lib/email-verification', () => ({
  markEmailVerified: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/oauth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/oauth')>();
  return {
    ...actual,
    exchangeCodeForTokens: vi.fn(),
    fetchOAuthUserProfile: vi.fn(),
    findFederatedIdentity: vi.fn(),
    linkFederatedIdentity: vi.fn(),
  };
});

describe('OAuth Callback Route (app/api/auth/oauth/[provider]/callback/route.ts)', () => {
  const originalEnv = process.env;
  const PROD_PROXY_URL = 'http://localhost:10000/api/auth/oauth/google/callback';

  beforeEach(() => {
    process.env = { ...originalEnv };
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    vi.clearAllMocks();
    oauthModule.resetOAuthMemoryState();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    oauthModule.resetOAuthMemoryState();
  });

  describe('Production-Proxy-Konstellation (interner Origin in request.url)', () => {
    it('leitet bei invalid_state auf die oeffentliche Origin https://pruefli.ch um und nicht auf localhost:10000', async () => {
      const request = new Request(`${PROD_PROXY_URL}?code=test123&state=badstate`);
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) });

      expect(response.status).toBe(307);
      const location = response.headers.get('location');
      expect(location).toBeTruthy();
      expect(location).not.toContain('localhost:10000');

      const redirectUrl = new URL(location!);
      expect(redirectUrl.origin).toBe('https://pruefli.ch');
      expect(redirectUrl.pathname).toBe('/login');
      expect(redirectUrl.searchParams.get('error')).toBe('invalid_state');
    });

    it('leitet bei missing_code_or_state auf die oeffentliche Origin um', async () => {
      const request = new Request(PROD_PROXY_URL);
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) });

      expect(response.status).toBe(307);
      const location = response.headers.get('location');
      expect(location).toBeTruthy();

      const redirectUrl = new URL(location!);
      expect(redirectUrl.origin).toBe('https://pruefli.ch');
      expect(redirectUrl.pathname).toBe('/login');
      expect(redirectUrl.searchParams.get('error')).toBe('missing_code_or_state');
    });

    it('leitet bei Provider-Abbruch (oauthError) auf die oeffentliche Origin um', async () => {
      const request = new Request(`${PROD_PROXY_URL}?error=access_denied`);
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) });

      expect(response.status).toBe(307);
      const location = response.headers.get('location');
      expect(location).toBeTruthy();

      const redirectUrl = new URL(location!);
      expect(redirectUrl.origin).toBe('https://pruefli.ch');
      expect(redirectUrl.pathname).toBe('/login');
      expect(redirectUrl.searchParams.get('error')).toBe('oauth_cancelled');
    });

    it('leitet bei nicht unterstuetztem Provider auf die oeffentliche Origin um', async () => {
      const request = new Request('http://localhost:10000/api/auth/oauth/github/callback');
      const response = await GET(request, { params: Promise.resolve({ provider: 'github' }) });

      expect(response.status).toBe(307);
      const location = response.headers.get('location');
      expect(location).toBeTruthy();

      const redirectUrl = new URL(location!);
      expect(redirectUrl.origin).toBe('https://pruefli.ch');
      expect(redirectUrl.pathname).toBe('/login');
      expect(redirectUrl.searchParams.get('error')).toBe('unsupported_provider');
    });

    it('leitet bei Token-Austausch-Fehler auf die oeffentliche Origin um', async () => {
      const validState = await signOAuthStateToken({
        provider: 'google',
        action: 'login',
        nonce: 'valid-nonce',
      });

      vi.mocked(oauthModule.exchangeCodeForTokens).mockRejectedValue(
        new Error('Token exchange timeout')
      );

      const request = new Request(`${PROD_PROXY_URL}?code=testcode&state=${validState}`);
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) });

      expect(response.status).toBe(307);
      const location = response.headers.get('location');
      expect(location).toBeTruthy();

      const redirectUrl = new URL(location!);
      expect(redirectUrl.origin).toBe('https://pruefli.ch');
      expect(redirectUrl.pathname).toBe('/login');
      expect(redirectUrl.searchParams.get('error')).toBe('oauth_exchange_failed');
    });

    it('respektiert benutzerdefinierte APP_URL Umgebungsvariablen', async () => {
      process.env.APP_URL = 'https://custom.pruefli.ch';

      const request = new Request(`${PROD_PROXY_URL}?code=test123&state=badstate`);
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) });

      expect(response.status).toBe(307);
      const location = response.headers.get('location');
      expect(location).toBeTruthy();

      const redirectUrl = new URL(location!);
      expect(redirectUrl.origin).toBe('https://custom.pruefli.ch');
      expect(redirectUrl.pathname).toBe('/login');
      expect(redirectUrl.searchParams.get('error')).toBe('invalid_state');
    });
  });

  describe('Erfolgspfade (Social Login & Signup)', () => {
    it('leitet existierende verknuepfte Benutzer auf /dashboard der oeffentlichen Origin um', async () => {
      const validState = await signOAuthStateToken({
        provider: 'google',
        action: 'login',
        nonce: 'test-nonce-1',
      });

      vi.mocked(oauthModule.exchangeCodeForTokens).mockResolvedValue({
        accessToken: 'mock-access-token',
      });
      vi.mocked(oauthModule.fetchOAuthUserProfile).mockResolvedValue({
        provider: 'google',
        providerAccountId: 'g-sub-123',
        email: 'lehrer@schule.ch',
        name: 'Max Muster',
      });
      vi.mocked(oauthModule.findFederatedIdentity).mockResolvedValue({
        id: 'fed-1',
        teacherId: 'teacher-123',
        provider: 'google',
        providerAccountId: 'g-sub-123',
        email: 'lehrer@schule.ch',
        createdAt: new Date(),
      });
      vi.mocked(db.teacher.findUnique).mockResolvedValue({
        id: 'teacher-123',
        email: 'lehrer@schule.ch',
        name: 'Max Muster',
        passwordHash: 'hash',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Awaited<ReturnType<typeof db.teacher.findUnique>>);

      const request = new Request(`${PROD_PROXY_URL}?code=validcode&state=${validState}`);
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) });

      expect(response.status).toBe(307);
      const location = response.headers.get('location');
      expect(location).toBeTruthy();
      expect(location).not.toContain('localhost:10000');

      const redirectUrl = new URL(location!);
      expect(redirectUrl.origin).toBe('https://pruefli.ch');
      expect(redirectUrl.pathname).toBe('/dashboard');
      expect(sessionModule.createSession).toHaveBeenCalledWith('teacher-123');
    });

    it('registriert neue Benutzer und leitet auf /dashboard der oeffentlichen Origin um', async () => {
      const validState = await signOAuthStateToken({
        provider: 'google',
        action: 'login',
        nonce: 'test-nonce-2',
      });

      vi.mocked(oauthModule.exchangeCodeForTokens).mockResolvedValue({
        accessToken: 'mock-access-token-new',
      });
      vi.mocked(oauthModule.fetchOAuthUserProfile).mockResolvedValue({
        provider: 'google',
        providerAccountId: 'g-sub-new',
        email: 'neu@schule.ch',
        name: 'Anna Schmidt',
      });
      vi.mocked(oauthModule.findFederatedIdentity).mockResolvedValue(null);
      vi.mocked(db.teacher.findUnique).mockResolvedValue(null);
      vi.mocked(db.teacher.create).mockResolvedValue({
        id: 'teacher-new-456',
        email: 'neu@schule.ch',
        name: 'Anna Schmidt',
        passwordHash: 'oauth_disabled:xyz',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Awaited<ReturnType<typeof db.teacher.create>>);

      const request = new Request(`${PROD_PROXY_URL}?code=validcode&state=${validState}`);
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) });

      expect(response.status).toBe(307);
      const location = response.headers.get('location');
      expect(location).toBeTruthy();
      expect(location).not.toContain('localhost:10000');

      const redirectUrl = new URL(location!);
      expect(redirectUrl.origin).toBe('https://pruefli.ch');
      expect(redirectUrl.pathname).toBe('/dashboard');
      expect(oauthModule.linkFederatedIdentity).toHaveBeenCalledWith({
        teacherId: 'teacher-new-456',
        provider: 'google',
        providerAccountId: 'g-sub-new',
        email: 'neu@schule.ch',
      });
      expect(emailVerificationModule.markEmailVerified).toHaveBeenCalledWith(
        'teacher-new-456',
        'neu@schule.ch'
      );
      expect(sessionModule.createSession).toHaveBeenCalledWith('teacher-new-456');
    });
  });

  describe('Linking-Pfade (Account Conflict & Authenticated Linking)', () => {
    it('leitet bei existierendem unvollstaendig verknuepftem Konto auf /auth/link-account der oeffentlichen Origin um', async () => {
      const validState = await signOAuthStateToken({
        provider: 'google',
        action: 'login',
        nonce: 'test-nonce-3',
      });

      vi.mocked(oauthModule.exchangeCodeForTokens).mockResolvedValue({
        accessToken: 'mock-access-token-conflict',
      });
      vi.mocked(oauthModule.fetchOAuthUserProfile).mockResolvedValue({
        provider: 'google',
        providerAccountId: 'g-sub-conflict',
        email: 'vorhanden@schule.ch',
        name: 'Peter Keller',
      });
      vi.mocked(oauthModule.findFederatedIdentity).mockResolvedValue(null);
      vi.mocked(db.teacher.findUnique).mockResolvedValue({
        id: 'teacher-existing-789',
        email: 'vorhanden@schule.ch',
        name: 'Peter Keller',
        passwordHash: 'regular-password-hash',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Awaited<ReturnType<typeof db.teacher.findUnique>>);

      const request = new Request(`${PROD_PROXY_URL}?code=validcode&state=${validState}`);
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) });

      expect(response.status).toBe(307);
      const location = response.headers.get('location');
      expect(location).toBeTruthy();
      expect(location).not.toContain('localhost:10000');

      const redirectUrl = new URL(location!);
      expect(redirectUrl.origin).toBe('https://pruefli.ch');
      expect(redirectUrl.pathname).toBe('/auth/link-account');
      expect(redirectUrl.searchParams.get('token')).toBeTruthy();
    });

    it('leitet bei erfolgreichem Verknuepfen aus aktiver Sitzung auf /dashboard?linked=google der oeffentlichen Origin um', async () => {
      const validLinkState = await signOAuthStateToken({
        provider: 'google',
        action: 'link',
        teacherId: 'teacher-active-1',
        nonce: 'link-nonce-1',
      });

      vi.mocked(oauthModule.exchangeCodeForTokens).mockResolvedValue({
        accessToken: 'mock-link-token',
      });
      vi.mocked(oauthModule.fetchOAuthUserProfile).mockResolvedValue({
        provider: 'google',
        providerAccountId: 'g-link-sub',
        email: 'active@schule.ch',
        name: 'Aktiver Lehrer',
      });
      vi.mocked(db.teacher.findUnique).mockResolvedValue({
        id: 'teacher-active-1',
        email: 'active@schule.ch',
        name: 'Aktiver Lehrer',
        passwordHash: 'hash',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Awaited<ReturnType<typeof db.teacher.findUnique>>);
      vi.mocked(oauthModule.linkFederatedIdentity).mockResolvedValue({
        id: 'fed-new',
        teacherId: 'teacher-active-1',
        provider: 'google',
        providerAccountId: 'g-link-sub',
        email: 'active@schule.ch',
        createdAt: new Date(),
      });

      const request = new Request(`${PROD_PROXY_URL}?code=linkcode&state=${validLinkState}`);
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) });

      expect(response.status).toBe(307);
      const location = response.headers.get('location');
      expect(location).toBeTruthy();
      expect(location).not.toContain('localhost:10000');

      const redirectUrl = new URL(location!);
      expect(redirectUrl.origin).toBe('https://pruefli.ch');
      expect(redirectUrl.pathname).toBe('/dashboard');
      expect(redirectUrl.searchParams.get('linked')).toBe('google');
    });

    it('leitet bei fehlgeschlagenem Verknuepfen auf /dashboard?error=provider_link_failed der oeffentlichen Origin um', async () => {
      const validLinkState = await signOAuthStateToken({
        provider: 'google',
        action: 'link',
        teacherId: 'teacher-active-1',
        nonce: 'link-nonce-2',
      });

      vi.mocked(oauthModule.exchangeCodeForTokens).mockResolvedValue({
        accessToken: 'mock-link-token',
      });
      vi.mocked(oauthModule.fetchOAuthUserProfile).mockResolvedValue({
        provider: 'google',
        providerAccountId: 'g-link-sub',
        email: 'active@schule.ch',
        name: 'Aktiver Lehrer',
      });
      vi.mocked(db.teacher.findUnique).mockResolvedValue({
        id: 'teacher-active-1',
        email: 'active@schule.ch',
        name: 'Aktiver Lehrer',
        passwordHash: 'hash',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as Awaited<ReturnType<typeof db.teacher.findUnique>>);
      vi.mocked(oauthModule.linkFederatedIdentity).mockRejectedValue(
        new Error('provider_link_failed')
      );

      const request = new Request(`${PROD_PROXY_URL}?code=linkcode&state=${validLinkState}`);
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) });

      expect(response.status).toBe(307);
      const location = response.headers.get('location');
      expect(location).toBeTruthy();
      expect(location).not.toContain('localhost:10000');

      const redirectUrl = new URL(location!);
      expect(redirectUrl.origin).toBe('https://pruefli.ch');
      expect(redirectUrl.pathname).toBe('/dashboard');
      expect(redirectUrl.searchParams.get('error')).toBe('provider_link_failed');
    });

    it('leitet bei fehlerhafter Link-State ohne teacherId auf /login?error=invalid_link_state um', async () => {
      const stateWithoutTeacherId = await signOAuthStateToken({
        provider: 'google',
        action: 'link',
        nonce: 'link-nonce-3',
      });

      vi.mocked(oauthModule.exchangeCodeForTokens).mockResolvedValue({
        accessToken: 'mock-token',
      });
      vi.mocked(oauthModule.fetchOAuthUserProfile).mockResolvedValue({
        provider: 'google',
        providerAccountId: 'g-sub',
        email: 'test@schule.ch',
        name: 'Test',
      });

      const request = new Request(`${PROD_PROXY_URL}?code=code&state=${stateWithoutTeacherId}`);
      const response = await GET(request, { params: Promise.resolve({ provider: 'google' }) });

      expect(response.status).toBe(307);
      const location = response.headers.get('location');
      expect(location).toBeTruthy();

      const redirectUrl = new URL(location!);
      expect(redirectUrl.origin).toBe('https://pruefli.ch');
      expect(redirectUrl.pathname).toBe('/login');
      expect(redirectUrl.searchParams.get('error')).toBe('invalid_link_state');
    });
  });
});
