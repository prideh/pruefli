import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET } from '@/app/api/auth/oauth/[provider]/callback/route';
import { db } from '@/lib/db';
import * as oauthModule from '@/lib/oauth';
import * as sessionModule from '@/lib/session';
import * as emailVerificationModule from '@/lib/email-verification';
import { clearMockSentEmails, getMockSentEmails } from '@/lib/email';
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

vi.mock('@/lib/email-verification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email-verification')>();
  return {
    ...actual,
    markEmailVerified: vi.fn((...args: Parameters<typeof actual.markEmailVerified>) =>
      actual.markEmailVerified(...args)
    ),
    markEmailVerificationPending: vi.fn(
      (...args: Parameters<typeof actual.markEmailVerificationPending>) =>
        actual.markEmailVerificationPending(...args)
    ),
  };
});

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
  const MS_PROD_PROXY_URL = 'http://localhost:10000/api/auth/oauth/microsoft/callback';

  beforeEach(() => {
    process.env = { ...originalEnv };
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.EMAIL_VERIFICATION_ENFORCED;
    delete process.env.ENFORCE_EMAIL_VERIFICATION;
    delete process.env.EMAIL_VERIFICATION_ALLOW_MOCK;
    delete process.env.BREVO_LIVE_SENDING;
    delete process.env.BREVO_API_KEY;
    vi.clearAllMocks();
    clearMockSentEmails();
    oauthModule.resetOAuthMemoryState();
    emailVerificationModule.resetVerificationMemoryState();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
    clearMockSentEmails();
    oauthModule.resetOAuthMemoryState();
    emailVerificationModule.resetVerificationMemoryState();
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
        emailVerified: true,
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

    it('registriert neue Benutzer mit bestaetigtem Google-Profil und leitet auf /dashboard der oeffentlichen Origin um', async () => {
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
        emailVerified: true,
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
      expect(await emailVerificationModule.isEmailVerified('teacher-new-456')).toBe(true);
      expect(sessionModule.createSession).toHaveBeenCalledWith('teacher-new-456');
    });
  });

  describe('OAuth-Signup E-Mail-Verifizierungsstatus nach Provider-Claim (Issue #100)', () => {
    it('Google-Profil mit email_verified=true fuehrt zu bestaetigtem Konto; email_verified=false fuehrt zu unbestaetigtem Konto', async () => {
      // 1. Google mit email_verified=false -> Konto bleibt unbestaetigt (kein markEmailVerified)
      const stateFalse = await signOAuthStateToken({
        provider: 'google',
        action: 'login',
        nonce: 'google-unverified-nonce',
      });

      vi.mocked(oauthModule.exchangeCodeForTokens).mockResolvedValueOnce({
        accessToken: 'google-token-unverified',
      });
      vi.mocked(oauthModule.fetchOAuthUserProfile).mockResolvedValueOnce({
        provider: 'google',
        providerAccountId: 'g-sub-unverified-100',
        email: 'unverified.google@schule.ch',
        name: 'Lukas Unbestaetigt',
        emailVerified: false,
      });
      vi.mocked(oauthModule.findFederatedIdentity).mockResolvedValueOnce(null);
      vi.mocked(db.teacher.findUnique).mockResolvedValueOnce(null);
      vi.mocked(db.teacher.create).mockResolvedValueOnce({
        id: 'teacher-google-unverified-100',
        email: 'unverified.google@schule.ch',
        name: 'Lukas Unbestaetigt',
        passwordHash: 'oauth_disabled:111',
        createdAt: new Date('2026-05-01T10:00:00.000Z'),
        updatedAt: new Date('2026-05-01T10:00:00.000Z'),
      } as unknown as Awaited<ReturnType<typeof db.teacher.create>>);

      const reqFalse = new Request(`${PROD_PROXY_URL}?code=code-false&state=${stateFalse}`);
      const resFalse = await GET(reqFalse, { params: Promise.resolve({ provider: 'google' }) });

      expect(resFalse.status).toBe(307);
      expect(emailVerificationModule.markEmailVerified).not.toHaveBeenCalled();
      expect(emailVerificationModule.markEmailVerificationPending).toHaveBeenCalledWith(
        'teacher-google-unverified-100',
        'unverified.google@schule.ch'
      );
      expect(await emailVerificationModule.isEmailVerified('teacher-google-unverified-100')).toBe(
        false
      );
      expect(
        emailVerificationModule.isEmailVerificationPending('teacher-google-unverified-100')
      ).toBe(true);

      // Bestaetigungs-E-Mail wurde fuer den E-Mail-Verifizierungs-Flow vorbereitet/versendet
      const sentEmails = getMockSentEmails();
      expect(sentEmails.length).toBe(1);
      expect(sentEmails[0].to.email).toBe('unverified.google@schule.ch');
      expect(sentEmails[0].template).toBe('verification');

      // Wenn die serverseitige Durchsetzung aktiv ist, darf das unbestaetigte Google-Konto sie nicht umgehen
      process.env.EMAIL_VERIFICATION_ENFORCED = 'true';
      process.env.EMAIL_VERIFICATION_ALLOW_MOCK = 'true';
      const guardBlocked = await emailVerificationModule.requireVerifiedEmailForApi(
        'teacher-google-unverified-100'
      );
      expect(guardBlocked).not.toBeNull();
      expect(guardBlocked?.status).toBe(403);

      // 2. Google mit email_verified=true -> Konto wird als bestaetigt markiert
      vi.clearAllMocks();
      clearMockSentEmails();

      const stateTrue = await signOAuthStateToken({
        provider: 'google',
        action: 'login',
        nonce: 'google-verified-nonce',
      });

      vi.mocked(oauthModule.exchangeCodeForTokens).mockResolvedValueOnce({
        accessToken: 'google-token-verified',
      });
      vi.mocked(oauthModule.fetchOAuthUserProfile).mockResolvedValueOnce({
        provider: 'google',
        providerAccountId: 'g-sub-verified-100',
        email: 'verified.google@schule.ch',
        name: 'Sarah Bestaetigt',
        emailVerified: true,
      });
      vi.mocked(oauthModule.findFederatedIdentity).mockResolvedValueOnce(null);
      vi.mocked(db.teacher.findUnique).mockResolvedValueOnce(null);
      vi.mocked(db.teacher.create).mockResolvedValueOnce({
        id: 'teacher-google-verified-100',
        email: 'verified.google@schule.ch',
        name: 'Sarah Bestaetigt',
        passwordHash: 'oauth_disabled:222',
        createdAt: new Date('2026-05-01T10:05:00.000Z'),
        updatedAt: new Date('2026-05-01T10:05:00.000Z'),
      } as unknown as Awaited<ReturnType<typeof db.teacher.create>>);

      const reqTrue = new Request(`${PROD_PROXY_URL}?code=code-true&state=${stateTrue}`);
      const resTrue = await GET(reqTrue, { params: Promise.resolve({ provider: 'google' }) });

      expect(resTrue.status).toBe(307);
      expect(new URL(resTrue.headers.get('location')!).pathname).toBe('/dashboard');
      expect(emailVerificationModule.markEmailVerified).toHaveBeenCalledWith(
        'teacher-google-verified-100',
        'verified.google@schule.ch'
      );
      expect(await emailVerificationModule.isEmailVerified('teacher-google-verified-100')).toBe(
        true
      );
      expect(getMockSentEmails().length).toBe(0);

      // Verifiziertes Google-Konto hat auch bei aktiver Durchsetzung vollen API-Zugriff
      const guardAllowed = await emailVerificationModule.requireVerifiedEmailForApi(
        'teacher-google-verified-100'
      );
      expect(guardAllowed).toBeNull();
    });

    it('Microsoft-Profil ohne Verifizierungsclaim fuehrt zu unbestaetigtem Konto und leitet bei aktiver Durchsetzung auf /verify-email', async () => {
      process.env.EMAIL_VERIFICATION_ENFORCED = 'true';
      process.env.EMAIL_VERIFICATION_ALLOW_MOCK = 'true';

      const msState = await signOAuthStateToken({
        provider: 'microsoft',
        action: 'login',
        nonce: 'ms-signup-nonce',
      });

      vi.mocked(oauthModule.exchangeCodeForTokens).mockResolvedValueOnce({
        accessToken: 'ms-token-100',
      });
      // Microsoft Graph /v1.0/me liefert keinen Verifizierungsclaim -> emailVerified: false
      vi.mocked(oauthModule.fetchOAuthUserProfile).mockResolvedValueOnce({
        provider: 'microsoft',
        providerAccountId: 'ms-oid-unverified-100',
        email: 'lehrer.ms@schule-zuerich.ch',
        name: 'Reto Microsoft',
        emailVerified: false,
      });
      vi.mocked(oauthModule.findFederatedIdentity).mockResolvedValueOnce(null);
      vi.mocked(db.teacher.findUnique).mockResolvedValueOnce(null);
      vi.mocked(db.teacher.create).mockResolvedValueOnce({
        id: 'teacher-ms-unverified-100',
        email: 'lehrer.ms@schule-zuerich.ch',
        name: 'Reto Microsoft',
        passwordHash: 'oauth_disabled:333',
        createdAt: new Date('2026-05-01T11:00:00.000Z'),
        updatedAt: new Date('2026-05-01T11:00:00.000Z'),
      } as unknown as Awaited<ReturnType<typeof db.teacher.create>>);

      const request = new Request(`${MS_PROD_PROXY_URL}?code=mscode&state=${msState}`);
      const response = await GET(request, { params: Promise.resolve({ provider: 'microsoft' }) });

      expect(response.status).toBe(307);
      const redirectUrl = new URL(response.headers.get('location')!);
      expect(redirectUrl.origin).toBe('https://pruefli.ch');
      expect(redirectUrl.pathname).toBe('/verify-email');

      expect(emailVerificationModule.markEmailVerified).not.toHaveBeenCalled();
      expect(emailVerificationModule.markEmailVerificationPending).toHaveBeenCalledWith(
        'teacher-ms-unverified-100',
        'lehrer.ms@schule-zuerich.ch'
      );
      expect(await emailVerificationModule.isEmailVerified('teacher-ms-unverified-100')).toBe(
        false
      );

      const sentEmails = getMockSentEmails();
      expect(sentEmails.length).toBe(1);
      expect(sentEmails[0].to.email).toBe('lehrer.ms@schule-zuerich.ch');
      expect(sentEmails[0].template).toBe('verification');

      const guardBlocked = await emailVerificationModule.requireVerifiedEmailForApi(
        'teacher-ms-unverified-100'
      );
      expect(guardBlocked).not.toBeNull();
      expect(guardBlocked?.status).toBe(403);
    });

    it('laesst bestehende verknuepfte Konten beim Social Login (Flow 2) unveraendert', async () => {
      // Bestehendes verifiziertes Microsoft-Konto
      await emailVerificationModule.markEmailVerified(
        'teacher-existing-ms',
        'bestand.ms@schule.ch'
      );
      vi.clearAllMocks();

      const msState = await signOAuthStateToken({
        provider: 'microsoft',
        action: 'login',
        nonce: 'ms-existing-login-nonce',
      });

      vi.mocked(oauthModule.exchangeCodeForTokens).mockResolvedValueOnce({
        accessToken: 'ms-token-existing',
      });
      vi.mocked(oauthModule.fetchOAuthUserProfile).mockResolvedValueOnce({
        provider: 'microsoft',
        providerAccountId: 'ms-oid-existing',
        email: 'bestand.ms@schule.ch',
        name: 'Bestand Lehrperson',
        emailVerified: false,
      });
      vi.mocked(oauthModule.findFederatedIdentity).mockResolvedValueOnce({
        id: 'fed-ms-existing',
        teacherId: 'teacher-existing-ms',
        provider: 'microsoft',
        providerAccountId: 'ms-oid-existing',
        email: 'bestand.ms@schule.ch',
        createdAt: new Date('2026-01-10T08:00:00.000Z'),
      });
      vi.mocked(db.teacher.findUnique).mockResolvedValueOnce({
        id: 'teacher-existing-ms',
        email: 'bestand.ms@schule.ch',
        name: 'Bestand Lehrperson',
        passwordHash: 'oauth_disabled:existing',
        createdAt: new Date('2026-01-10T08:00:00.000Z'),
        updatedAt: new Date('2026-01-10T08:00:00.000Z'),
      } as unknown as Awaited<ReturnType<typeof db.teacher.findUnique>>);

      const request = new Request(`${MS_PROD_PROXY_URL}?code=mscode&state=${msState}`);
      const response = await GET(request, { params: Promise.resolve({ provider: 'microsoft' }) });

      expect(response.status).toBe(307);
      expect(new URL(response.headers.get('location')!).pathname).toBe('/dashboard');
      expect(emailVerificationModule.markEmailVerificationPending).not.toHaveBeenCalled();
      expect(await emailVerificationModule.isEmailVerified('teacher-existing-ms')).toBe(true);
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
