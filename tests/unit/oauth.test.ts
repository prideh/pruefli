import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isProviderConfigured,
  isProviderUiFlagEnabled,
  isProviderUiEnabled,
  getConfiguredProviders,
  getUiEnabledProviders,
  getEnabledProviders,
  getProviderDisplayName,
  getAuthorizationUrl,
  fetchOAuthUserProfile,
  linkFederatedIdentity,
  findFederatedIdentity,
  getFederatedIdentitiesForTeacher,
  unlinkFederatedIdentity,
  resetOAuthMemoryState,
  generateOauthDisabledPasswordHash,
  isOauthOnlyAccount,
} from '@/lib/oauth';
import { GET as getProvidersRoute } from '@/app/api/auth/oauth/providers/route';
import { GET as getOAuthStartRoute } from '@/app/api/auth/oauth/[provider]/route';
import {
  signOAuthStateToken,
  verifyOAuthStateToken,
  signOAuthPendingLinkToken,
  verifyOAuthPendingLinkToken,
  signOAuthConfirmLinkEmailToken,
  verifyOAuthConfirmLinkEmailToken,
} from '@/lib/jwt';
import { verifyPassword, hashPassword } from '@/lib/auth';

describe('OAuth Social Sign-in & Account Linking (lib/oauth.ts & lib/jwt.ts)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_SECRET;
    delete process.env.MICROSOFT_TENANT_ID;
    delete process.env.OAUTH_UI_GOOGLE_ENABLED;
    delete process.env.OAUTH_UI_MICROSOFT_ENABLED;
    resetOAuthMemoryState();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetOAuthMemoryState();
    vi.restoreAllMocks();
  });

  describe('Configuration-driven Provider Activation (Credentials)', () => {
    it('returns false for all providers when environment variables are not set', () => {
      expect(isProviderConfigured('google')).toBe(false);
      expect(isProviderConfigured('microsoft')).toBe(false);
      expect(getConfiguredProviders()).toEqual({ google: false, microsoft: false });
    });

    it('activates Google configuration only when both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set', () => {
      process.env.GOOGLE_CLIENT_ID = 'google-client-id-123';
      expect(isProviderConfigured('google')).toBe(false);

      process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret-xyz';
      expect(isProviderConfigured('google')).toBe(true);
      expect(getConfiguredProviders()).toEqual({ google: true, microsoft: false });
    });

    it('activates Microsoft configuration only when both MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET are set', () => {
      process.env.MICROSOFT_CLIENT_ID = 'ms-client-id-456';
      expect(isProviderConfigured('microsoft')).toBe(false);

      process.env.MICROSOFT_CLIENT_SECRET = 'ms-client-secret-abc';
      expect(isProviderConfigured('microsoft')).toBe(true);
      expect(getConfiguredProviders()).toEqual({ google: false, microsoft: true });
    });

    it('activates both provider configurations in expected priority order', () => {
      process.env.GOOGLE_CLIENT_ID = 'gid';
      process.env.GOOGLE_CLIENT_SECRET = 'gsecret';
      process.env.MICROSOFT_CLIENT_ID = 'msid';
      process.env.MICROSOFT_CLIENT_SECRET = 'mssecret';

      const configured = getConfiguredProviders();
      expect(configured.google).toBe(true);
      expect(configured.microsoft).toBe(true);
      expect(Object.keys(configured)).toEqual(['google', 'microsoft']);
    });

    it('ensures Apple is never activated or supported', () => {
      // @ts-expect-error Apple is rejected by types and runtime
      expect(isProviderConfigured('apple')).toBe(false);
    });
  });

  describe('UI Visibility Flags (OAUTH_UI_GOOGLE_ENABLED & OAUTH_UI_MICROSOFT_ENABLED)', () => {
    it('defaults to false for all providers when UI flags are unset', () => {
      expect(isProviderUiFlagEnabled('google')).toBe(false);
      expect(isProviderUiFlagEnabled('microsoft')).toBe(false);
    });

    it('parses truthy values case-insensitively (true, TRUE, 1)', () => {
      process.env.OAUTH_UI_GOOGLE_ENABLED = 'true';
      expect(isProviderUiFlagEnabled('google')).toBe(true);

      process.env.OAUTH_UI_GOOGLE_ENABLED = 'TRUE';
      expect(isProviderUiFlagEnabled('google')).toBe(true);

      process.env.OAUTH_UI_GOOGLE_ENABLED = ' 1 ';
      expect(isProviderUiFlagEnabled('google')).toBe(true);
    });

    it('parses falsy and invalid values as false', () => {
      process.env.OAUTH_UI_GOOGLE_ENABLED = 'false';
      expect(isProviderUiFlagEnabled('google')).toBe(false);

      process.env.OAUTH_UI_GOOGLE_ENABLED = '0';
      expect(isProviderUiFlagEnabled('google')).toBe(false);

      process.env.OAUTH_UI_GOOGLE_ENABLED = 'random-value';
      expect(isProviderUiFlagEnabled('google')).toBe(false);
    });

    it('operates flags independently between providers', () => {
      process.env.OAUTH_UI_GOOGLE_ENABLED = 'true';
      delete process.env.OAUTH_UI_MICROSOFT_ENABLED;

      expect(isProviderUiFlagEnabled('google')).toBe(true);
      expect(isProviderUiFlagEnabled('microsoft')).toBe(false);

      process.env.OAUTH_UI_MICROSOFT_ENABLED = 'true';
      process.env.OAUTH_UI_GOOGLE_ENABLED = 'false';

      expect(isProviderUiFlagEnabled('google')).toBe(false);
      expect(isProviderUiFlagEnabled('microsoft')).toBe(true);
    });
  });

  describe('UI Visibility Gate (isProviderUiEnabled, getUiEnabledProviders, getEnabledProviders)', () => {
    describe('Zustand 1: Nicht konfiguriert', () => {
      it('returns false when neither configured nor UI flag set', () => {
        expect(isProviderUiEnabled('google')).toBe(false);
        expect(isProviderUiEnabled('microsoft')).toBe(false);
        expect(getUiEnabledProviders()).toEqual({ google: false, microsoft: false });
        expect(getEnabledProviders()).toEqual({ google: false, microsoft: false });
      });

      it('returns false even if UI flag is set to true when credentials are missing', () => {
        process.env.OAUTH_UI_GOOGLE_ENABLED = 'true';
        process.env.OAUTH_UI_MICROSOFT_ENABLED = 'true';

        expect(isProviderUiEnabled('google')).toBe(false);
        expect(isProviderUiEnabled('microsoft')).toBe(false);
        expect(getUiEnabledProviders()).toEqual({ google: false, microsoft: false });
        expect(getEnabledProviders()).toEqual({ google: false, microsoft: false });
      });
    });

    describe('Zustand 2: Konfiguriert ohne Flag (stille Verifikation in Production)', () => {
      it('returns false for UI button while provider configuration is active', () => {
        process.env.GOOGLE_CLIENT_ID = 'gid';
        process.env.GOOGLE_CLIENT_SECRET = 'gsec';
        process.env.MICROSOFT_CLIENT_ID = 'msid';
        process.env.MICROSOFT_CLIENT_SECRET = 'mssec';

        expect(isProviderConfigured('google')).toBe(true);
        expect(isProviderConfigured('microsoft')).toBe(true);

        // UI flags are unset, so buttons must remain hidden
        expect(isProviderUiEnabled('google')).toBe(false);
        expect(isProviderUiEnabled('microsoft')).toBe(false);
        expect(getUiEnabledProviders()).toEqual({ google: false, microsoft: false });
        expect(getEnabledProviders()).toEqual({ google: false, microsoft: false });
      });

      it('returns false when UI flag is explicitly set to false', () => {
        process.env.GOOGLE_CLIENT_ID = 'gid';
        process.env.GOOGLE_CLIENT_SECRET = 'gsec';
        process.env.OAUTH_UI_GOOGLE_ENABLED = 'false';

        expect(isProviderConfigured('google')).toBe(true);
        expect(isProviderUiEnabled('google')).toBe(false);
      });
    });

    describe('Zustand 3: Konfiguriert mit Flag (oeffentliche Freischaltung)', () => {
      it('renders button only when provider is configured AND flag is true', () => {
        process.env.GOOGLE_CLIENT_ID = 'gid';
        process.env.GOOGLE_CLIENT_SECRET = 'gsec';
        process.env.OAUTH_UI_GOOGLE_ENABLED = 'true';

        expect(isProviderConfigured('google')).toBe(true);
        expect(isProviderUiFlagEnabled('google')).toBe(true);
        expect(isProviderUiEnabled('google')).toBe(true);
        expect(getUiEnabledProviders()).toEqual({ google: true, microsoft: false });
        expect(getEnabledProviders()).toEqual({ google: true, microsoft: false });
      });

      it('renders both buttons when both are configured and both flags are true', () => {
        process.env.GOOGLE_CLIENT_ID = 'gid';
        process.env.GOOGLE_CLIENT_SECRET = 'gsec';
        process.env.OAUTH_UI_GOOGLE_ENABLED = 'true';

        process.env.MICROSOFT_CLIENT_ID = 'msid';
        process.env.MICROSOFT_CLIENT_SECRET = 'mssec';
        process.env.OAUTH_UI_MICROSOFT_ENABLED = 'true';

        expect(isProviderUiEnabled('google')).toBe(true);
        expect(isProviderUiEnabled('microsoft')).toBe(true);
        expect(getUiEnabledProviders()).toEqual({ google: true, microsoft: true });
        expect(getEnabledProviders()).toEqual({ google: true, microsoft: true });
      });
    });

    describe('Gemischte Provider-Kombinationen', () => {
      it('allows Microsoft live while Google is still hidden in testing', () => {
        process.env.GOOGLE_CLIENT_ID = 'gid';
        process.env.GOOGLE_CLIENT_SECRET = 'gsec';
        delete process.env.OAUTH_UI_GOOGLE_ENABLED;

        process.env.MICROSOFT_CLIENT_ID = 'msid';
        process.env.MICROSOFT_CLIENT_SECRET = 'mssec';
        process.env.OAUTH_UI_MICROSOFT_ENABLED = 'true';

        expect(isProviderConfigured('google')).toBe(true);
        expect(isProviderConfigured('microsoft')).toBe(true);

        expect(isProviderUiEnabled('google')).toBe(false);
        expect(isProviderUiEnabled('microsoft')).toBe(true);

        expect(getUiEnabledProviders()).toEqual({ google: false, microsoft: true });
      });

      it('allows Google live while Microsoft is still hidden in testing', () => {
        process.env.GOOGLE_CLIENT_ID = 'gid';
        process.env.GOOGLE_CLIENT_SECRET = 'gsec';
        process.env.OAUTH_UI_GOOGLE_ENABLED = 'true';

        process.env.MICROSOFT_CLIENT_ID = 'msid';
        process.env.MICROSOFT_CLIENT_SECRET = 'mssec';
        delete process.env.OAUTH_UI_MICROSOFT_ENABLED;

        expect(isProviderConfigured('google')).toBe(true);
        expect(isProviderConfigured('microsoft')).toBe(true);

        expect(isProviderUiEnabled('google')).toBe(true);
        expect(isProviderUiEnabled('microsoft')).toBe(false);

        expect(getUiEnabledProviders()).toEqual({ google: true, microsoft: false });
      });

      it('handles Google unconfigured with flag true, and Microsoft configured with flag true', () => {
        delete process.env.GOOGLE_CLIENT_ID;
        delete process.env.GOOGLE_CLIENT_SECRET;
        process.env.OAUTH_UI_GOOGLE_ENABLED = 'true';

        process.env.MICROSOFT_CLIENT_ID = 'msid';
        process.env.MICROSOFT_CLIENT_SECRET = 'mssec';
        process.env.OAUTH_UI_MICROSOFT_ENABLED = 'true';

        expect(isProviderUiEnabled('google')).toBe(false);
        expect(isProviderUiEnabled('microsoft')).toBe(true);
        expect(getUiEnabledProviders()).toEqual({ google: false, microsoft: true });
      });
    });
  });

  describe('Providers API Route (/api/auth/oauth/providers)', () => {
    it('returns separate UI and configuration status per provider', async () => {
      // Setup: Google configured without flag, Microsoft configured with flag
      process.env.GOOGLE_CLIENT_ID = 'gid';
      process.env.GOOGLE_CLIENT_SECRET = 'gsec';
      delete process.env.OAUTH_UI_GOOGLE_ENABLED;

      process.env.MICROSOFT_CLIENT_ID = 'msid';
      process.env.MICROSOFT_CLIENT_SECRET = 'mssec';
      process.env.OAUTH_UI_MICROSOFT_ENABLED = 'true';

      const response = await getProvidersRoute();
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.configured).toEqual({ google: true, microsoft: true });
      expect(data.ui).toEqual({ google: false, microsoft: true });
      expect(data.providers).toEqual({ google: false, microsoft: true });
      expect(data.flags).toEqual({ google: false, microsoft: true });
    });

    it('returns all false when nothing is configured and no flags set', async () => {
      const response = await getProvidersRoute();
      const data = await response.json();

      expect(data.configured).toEqual({ google: false, microsoft: false });
      expect(data.ui).toEqual({ google: false, microsoft: false });
      expect(data.providers).toEqual({ google: false, microsoft: false });
      expect(data.flags).toEqual({ google: false, microsoft: false });
    });
  });

  describe('OAuth Flow Endpoints Work Independent of UI Flags', () => {
    it('initiates Google OAuth flow when credentials exist even if UI flag is false or unset', async () => {
      process.env.GOOGLE_CLIENT_ID = 'google-client-id-flow-test';
      process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret-flow-test';
      delete process.env.OAUTH_UI_GOOGLE_ENABLED;

      const req = new Request('http://localhost/api/auth/oauth/google');
      const response = await getOAuthStartRoute(req, {
        params: Promise.resolve({ provider: 'google' }),
      });

      // Must redirect to Google authorization URL (not error redirect)
      expect(response.status).toBe(307);
      const location = response.headers.get('location');
      expect(location).toContain('https://accounts.google.com/o/oauth2/v2/auth');
      expect(location).toContain('client_id=google-client-id-flow-test');
    });

    it('initiates Microsoft OAuth flow when credentials exist even if UI flag is false or unset', async () => {
      process.env.MICROSOFT_CLIENT_ID = 'ms-client-id-flow-test';
      process.env.MICROSOFT_CLIENT_SECRET = 'ms-client-secret-flow-test';
      delete process.env.OAUTH_UI_MICROSOFT_ENABLED;

      const req = new Request('http://localhost/api/auth/oauth/microsoft');
      const response = await getOAuthStartRoute(req, {
        params: Promise.resolve({ provider: 'microsoft' }),
      });

      expect(response.status).toBe(307);
      const location = response.headers.get('location');
      expect(location).toContain('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
      expect(location).toContain('client_id=ms-client-id-flow-test');
    });

    it('redirects to error when provider credentials are not configured', async () => {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      process.env.OAUTH_UI_GOOGLE_ENABLED = 'true';

      const req = new Request('http://localhost/api/auth/oauth/google');
      const response = await getOAuthStartRoute(req, {
        params: Promise.resolve({ provider: 'google' }),
      });

      expect(response.status).toBe(307);
      const location = response.headers.get('location');
      expect(location).toContain('/login?error=provider_not_configured');
    });
  });

  describe('OAuth Authorization URL Generation', () => {
    it('throws when attempting to generate URL for unconfigured provider', () => {
      expect(() => getAuthorizationUrl('google', 'dummy-state')).toThrow(
        "OAuth-Provider 'google' ist nicht konfiguriert."
      );
      expect(() => getAuthorizationUrl('microsoft', 'dummy-state')).toThrow(
        "OAuth-Provider 'microsoft' ist nicht konfiguriert."
      );
    });

    it('generates a valid Google OAuth authorization URL with correct scopes and state', () => {
      process.env.GOOGLE_CLIENT_ID = 'test-google-id';
      process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret';

      const urlStr = getAuthorizationUrl('google', 'state-token-123');
      const url = new URL(urlStr);

      expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(url.searchParams.get('client_id')).toBe('test-google-id');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('scope')).toBe('openid email profile');
      expect(url.searchParams.get('state')).toBe('state-token-123');
      expect(url.searchParams.get('prompt')).toBe('select_account');
    });

    it('generates a valid Microsoft OAuth authorization URL with correct tenant and scopes', () => {
      process.env.MICROSOFT_CLIENT_ID = 'test-ms-id';
      process.env.MICROSOFT_CLIENT_SECRET = 'test-ms-secret';
      process.env.MICROSOFT_TENANT_ID = 'school-tenant-uuid';

      const urlStr = getAuthorizationUrl('microsoft', 'state-token-456');
      const url = new URL(urlStr);

      expect(url.origin + url.pathname).toBe(
        'https://login.microsoftonline.com/school-tenant-uuid/oauth2/v2.0/authorize'
      );
      expect(url.searchParams.get('client_id')).toBe('test-ms-id');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('scope')).toBe('openid profile email User.Read');
      expect(url.searchParams.get('state')).toBe('state-token-456');
      expect(url.searchParams.get('prompt')).toBe('select_account');
    });
  });

  describe('OAuth User Profile Parsing & Provider Verification Claims (Issue #100)', () => {
    it('sets emailVerified=true for Google only when email_verified is strictly true', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sub: 'google-sub-verified',
            email: 'Verified.Teacher@Schule.ch',
            name: 'Anna Verifiziert',
            email_verified: true,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const profile = await fetchOAuthUserProfile('google', 'google-access-token');
      expect(profile).toEqual({
        provider: 'google',
        providerAccountId: 'google-sub-verified',
        email: 'verified.teacher@schule.ch',
        name: 'Anna Verifiziert',
        emailVerified: true,
      });
    });

    it('sets emailVerified=false for Google when email_verified is false or missing', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sub: 'google-sub-unverified',
            email: 'unverified@schule.ch',
            name: 'Max Unbestaetigt',
            email_verified: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const falseProfile = await fetchOAuthUserProfile('google', 'google-access-token');
      expect(falseProfile.emailVerified).toBe(false);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sub: 'google-sub-missing-claim',
            email: 'noclaim@schule.ch',
            name: 'Kein Claim',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const missingProfile = await fetchOAuthUserProfile('google', 'google-access-token');
      expect(missingProfile.emailVerified).toBe(false);
    });

    it('sets emailVerified=false for Microsoft Graph /me profiles without verification claim', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'ms-oid-777',
            mail: 'Lehrperson@Schule-Bern.ch',
            userPrincipalName: 'lehrperson@schule-bern.ch',
            displayName: 'Ursula Keller',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const profile = await fetchOAuthUserProfile('microsoft', 'ms-access-token');
      expect(profile).toEqual({
        provider: 'microsoft',
        providerAccountId: 'ms-oid-777',
        email: 'lehrperson@schule-bern.ch',
        name: 'Ursula Keller',
        emailVerified: false,
      });
    });
  });

  describe('Cryptographic CSRF State Tokens (lib/jwt.ts)', () => {
    it('signs and verifies state tokens with action and nonce', async () => {
      const token = await signOAuthStateToken({
        provider: 'google',
        action: 'login',
        nonce: 'random-nonce-123',
      });

      const payload = await verifyOAuthStateToken(token);
      expect(payload).not.toBeNull();
      expect(payload?.purpose).toBe('oauth_state');
      expect(payload?.provider).toBe('google');
      expect(payload?.action).toBe('login');
      expect(payload?.nonce).toBe('random-nonce-123');
    });

    it('binds teacherId when linking an account from an active session', async () => {
      const token = await signOAuthStateToken({
        provider: 'microsoft',
        action: 'link',
        teacherId: 'teacher-uuid-789',
        nonce: 'nonce-xyz',
      });

      const payload = await verifyOAuthStateToken(token);
      expect(payload).not.toBeNull();
      expect(payload?.action).toBe('link');
      expect(payload?.teacherId).toBe('teacher-uuid-789');
    });

    it('rejects tampered state tokens', async () => {
      const token = await signOAuthStateToken({
        provider: 'google',
        action: 'login',
        nonce: 'nonce-abc',
      });
      const tampered = token.slice(0, -6) + 'ABCDEF';
      expect(await verifyOAuthStateToken(tampered)).toBeNull();
    });
  });

  describe('Account Linking Tokens & Ownership Proof (lib/jwt.ts)', () => {
    it('signs and verifies pending link tokens for account conflicts', async () => {
      const pendingToken = await signOAuthPendingLinkToken({
        provider: 'google',
        providerAccountId: 'sub-google-101',
        providerEmail: 'lehrer@schule.ch',
        providerName: 'Frau Meier',
        existingTeacherId: 'teacher-existing-1',
        existingTeacherEmail: 'lehrer@schule.ch',
      });

      const payload = await verifyOAuthPendingLinkToken(pendingToken);
      expect(payload).not.toBeNull();
      expect(payload?.purpose).toBe('oauth_pending_link');
      expect(payload?.provider).toBe('google');
      expect(payload?.providerAccountId).toBe('sub-google-101');
      expect(payload?.existingTeacherId).toBe('teacher-existing-1');
      expect(payload?.existingTeacherEmail).toBe('lehrer@schule.ch');
    });

    it('signs and verifies 24-hour email confirmation tokens', async () => {
      const confirmToken = await signOAuthConfirmLinkEmailToken({
        provider: 'microsoft',
        providerAccountId: 'ms-oid-202',
        providerEmail: 'meier@schule.ch',
        teacherId: 'teacher-existing-2',
      });

      const payload = await verifyOAuthConfirmLinkEmailToken(confirmToken);
      expect(payload).not.toBeNull();
      expect(payload?.purpose).toBe('oauth_confirm_link_email');
      expect(payload?.provider).toBe('microsoft');
      expect(payload?.providerAccountId).toBe('ms-oid-202');
      expect(payload?.teacherId).toBe('teacher-existing-2');
    });
  });

  describe('Federated Identity Storage & Conflict Prevention (lib/oauth.ts)', () => {
    it('links a social provider account to a teacher and allows retrieval', async () => {
      const linked = await linkFederatedIdentity({
        teacherId: 'teacher-10',
        provider: 'google',
        providerAccountId: 'google-sub-999',
        email: 'lehrer@schule.ch',
      });

      expect(linked.teacherId).toBe('teacher-10');
      expect(linked.provider).toBe('google');
      expect(linked.providerAccountId).toBe('google-sub-999');

      const found = await findFederatedIdentity('google', 'google-sub-999');
      expect(found).not.toBeNull();
      expect(found?.teacherId).toBe('teacher-10');
    });

    it('prevents linking the same provider account to a different teacher', async () => {
      await linkFederatedIdentity({
        teacherId: 'teacher-A',
        provider: 'microsoft',
        providerAccountId: 'ms-oid-333',
        email: 'personA@schule.ch',
      });

      await expect(
        linkFederatedIdentity({
          teacherId: 'teacher-B',
          provider: 'microsoft',
          providerAccountId: 'ms-oid-333',
          email: 'personB@schule.ch',
        })
      ).rejects.toThrow('bereits mit einem anderen Benutzerkonto verknüpft');
    });

    it('lists all linked identities for a teacher', async () => {
      await linkFederatedIdentity({
        teacherId: 'teacher-multi',
        provider: 'google',
        providerAccountId: 'sub-g-1',
        email: 'multi@schule.ch',
      });
      await linkFederatedIdentity({
        teacherId: 'teacher-multi',
        provider: 'microsoft',
        providerAccountId: 'oid-m-1',
        email: 'multi@schule.ch',
      });

      const identities = await getFederatedIdentitiesForTeacher('teacher-multi');
      expect(identities.length).toBe(2);
      expect(identities.map((i) => i.provider)).toEqual(['google', 'microsoft']);
    });

    it('unlinks an identity properly', async () => {
      await linkFederatedIdentity({
        teacherId: 'teacher-unlink',
        provider: 'google',
        providerAccountId: 'sub-unlink',
        email: 'unlink@schule.ch',
      });

      expect(await findFederatedIdentity('google', 'sub-unlink')).not.toBeNull();

      await unlinkFederatedIdentity('teacher-unlink', 'google');
      expect(await findFederatedIdentity('google', 'sub-unlink')).toBeNull();
    });

    it('provides disabled password hashes for OAuth-only accounts that cannot be guessed', async () => {
      const disabledHash = generateOauthDisabledPasswordHash();
      expect(isOauthOnlyAccount(disabledHash)).toBe(true);

      // Verify that no password can ever validate against this disabled hash
      expect(await verifyPassword('password123', disabledHash)).toBe(false);
      expect(await verifyPassword('', disabledHash)).toBe(false);
      expect(await verifyPassword('oauth_disabled', disabledHash)).toBe(false);

      // Regular password hash is not an OAuth-only account
      const realHash = await hashPassword('securePass123!');
      expect(isOauthOnlyAccount(realHash)).toBe(false);
      expect(await verifyPassword('securePass123!', realHash)).toBe(true);
    });

    it('formats provider display names in Swiss German standards without Eszett', () => {
      expect(getProviderDisplayName('google')).toBe('Google');
      expect(getProviderDisplayName('microsoft')).toBe('Microsoft');
    });
  });
});
