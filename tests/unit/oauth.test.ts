import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isProviderConfigured,
  getEnabledProviders,
  getProviderDisplayName,
  getAuthorizationUrl,
  linkFederatedIdentity,
  findFederatedIdentity,
  getFederatedIdentitiesForTeacher,
  unlinkFederatedIdentity,
  resetOAuthMemoryState,
  generateOauthDisabledPasswordHash,
  isOauthOnlyAccount,
} from '@/lib/oauth';
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
    resetOAuthMemoryState();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetOAuthMemoryState();
  });

  describe('Configuration-driven Provider Activation', () => {
    it('returns false for all providers when environment variables are not set', () => {
      expect(isProviderConfigured('google')).toBe(false);
      expect(isProviderConfigured('microsoft')).toBe(false);
      expect(getEnabledProviders()).toEqual({ google: false, microsoft: false });
    });

    it('activates Google only when both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set', () => {
      process.env.GOOGLE_CLIENT_ID = 'google-client-id-123';
      expect(isProviderConfigured('google')).toBe(false);

      process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret-xyz';
      expect(isProviderConfigured('google')).toBe(true);
      expect(getEnabledProviders()).toEqual({ google: true, microsoft: false });
    });

    it('activates Microsoft only when both MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET are set', () => {
      process.env.MICROSOFT_CLIENT_ID = 'ms-client-id-456';
      expect(isProviderConfigured('microsoft')).toBe(false);

      process.env.MICROSOFT_CLIENT_SECRET = 'ms-client-secret-abc';
      expect(isProviderConfigured('microsoft')).toBe(true);
      expect(getEnabledProviders()).toEqual({ google: false, microsoft: true });
    });

    it('activates both providers in expected priority order (Google first, then Microsoft)', () => {
      process.env.GOOGLE_CLIENT_ID = 'gid';
      process.env.GOOGLE_CLIENT_SECRET = 'gsecret';
      process.env.MICROSOFT_CLIENT_ID = 'msid';
      process.env.MICROSOFT_CLIENT_SECRET = 'mssecret';

      const enabled = getEnabledProviders();
      expect(enabled.google).toBe(true);
      expect(enabled.microsoft).toBe(true);
      expect(Object.keys(enabled)).toEqual(['google', 'microsoft']);
    });

    it('ensures Apple is never activated or supported', () => {
      // @ts-expect-error Apple is rejected by types and runtime
      expect(isProviderConfigured('apple')).toBe(false);
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
