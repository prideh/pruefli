import crypto from 'crypto';
import { db } from './db';
import { getAppUrl } from './app-url';

export type OAuthProvider = 'google' | 'microsoft';

export interface FederatedIdentity {
  id: string;
  teacherId: string;
  provider: OAuthProvider;
  providerAccountId: string;
  email: string;
  createdAt: Date;
}

export interface OAuthUserProfile {
  provider: OAuthProvider;
  providerAccountId: string;
  email: string;
  name: string;
  emailVerified?: boolean;
}

// In-memory fallback identity storage for test environments or initial runs
const inMemoryIdentities: FederatedIdentity[] = [];
let tableInitialized = false;

/**
 * Initializes the federated identities tracking table if running against PostgreSQL.
 * Gracefully no-ops under in-memory test setups or if raw SQL is restricted.
 */
export async function ensureFederatedIdentitiesTable(): Promise<void> {
  if (tableInitialized) return;
  try {
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS teacher_federated_identities (
        id TEXT PRIMARY KEY,
        teacher_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_account_id TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_teacher_provider_account UNIQUE (provider, provider_account_id)
      );
    `);
    tableInitialized = true;
  } catch {
    // In-memory fallback if raw SQL is not available
  }
}

/**
 * Helper to parse boolean environment variables.
 * Treats 'true' and '1' (case-insensitive) as true.
 */
function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1';
}

/**
 * Checks whether a given OAuth provider is fully configured via environment variables.
 */
export function isProviderConfigured(provider: OAuthProvider): boolean {
  if (provider === 'google') {
    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    return Boolean(clientId && clientSecret);
  }

  if (provider === 'microsoft') {
    const clientId = process.env.MICROSOFT_CLIENT_ID?.trim();
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim();
    return Boolean(clientId && clientSecret);
  }

  return false;
}

/**
 * Checks whether the UI visibility flag is set for a given OAuth provider.
 * Environment variables:
 * - Google: OAUTH_UI_GOOGLE_ENABLED
 * - Microsoft: OAUTH_UI_MICROSOFT_ENABLED
 * Default is false when unset.
 */
export function isProviderUiFlagEnabled(provider: OAuthProvider): boolean {
  if (provider === 'google') {
    return parseBooleanEnv(process.env.OAUTH_UI_GOOGLE_ENABLED);
  }

  if (provider === 'microsoft') {
    return parseBooleanEnv(process.env.OAUTH_UI_MICROSOFT_ENABLED);
  }

  return false;
}

/**
 * Checks whether the UI button for a given OAuth provider should be rendered.
 * Requires the provider to be fully configured AND its specific UI flag to be enabled.
 */
export function isProviderUiEnabled(provider: OAuthProvider): boolean {
  return isProviderConfigured(provider) && isProviderUiFlagEnabled(provider);
}

/**
 * Returns the configuration status of all supported providers (credentials present).
 */
export function getConfiguredProviders(): { google: boolean; microsoft: boolean } {
  return {
    google: isProviderConfigured('google'),
    microsoft: isProviderConfigured('microsoft'),
  };
}

/**
 * Returns the UI visibility status of all supported providers.
 * Each provider is true only if fully configured AND its specific UI flag is enabled.
 */
export function getUiEnabledProviders(): { google: boolean; microsoft: boolean } {
  return {
    google: isProviderUiEnabled('google'),
    microsoft: isProviderUiEnabled('microsoft'),
  };
}

/**
 * Returns the UI activation status of all supported providers.
 * Apple is explicitly discarded and never enabled.
 */
export function getEnabledProviders(): { google: boolean; microsoft: boolean } {
  return getUiEnabledProviders();
}

/**
 * Returns the human-readable provider name.
 */
export function getProviderDisplayName(provider: OAuthProvider): string {
  switch (provider) {
    case 'google':
      return 'Google';
    case 'microsoft':
      return 'Microsoft';
    default:
      return provider;
  }
}

/**
 * Returns the absolute redirect URI configured for this provider.
 */
export function getRedirectUri(provider: OAuthProvider): string {
  const baseUrl = getAppUrl();
  if (provider === 'google') {
    const custom = process.env.GOOGLE_REDIRECT_URI?.trim();
    return custom || `${baseUrl}/api/auth/oauth/google/callback`;
  }
  if (provider === 'microsoft') {
    const custom = process.env.MICROSOFT_REDIRECT_URI?.trim();
    return custom || `${baseUrl}/api/auth/oauth/microsoft/callback`;
  }
  return `${baseUrl}/api/auth/oauth/${provider}/callback`;
}

/**
 * Generates an unguessable password hash string that disables standard password logins
 * for accounts registered exclusively via OAuth.
 */
export function generateOauthDisabledPasswordHash(): string {
  const salt = 'oauth_disabled';
  const key = crypto.randomBytes(32).toString('hex');
  return `${salt}:${key}`;
}

/**
 * Checks if a teacher's password hash indicates an OAuth-only account.
 */
export function isOauthOnlyAccount(passwordHash: string): boolean {
  return typeof passwordHash === 'string' && passwordHash.startsWith('oauth_disabled:');
}

/**
 * Constructs the authorization URL for Google or Microsoft OAuth 2.0 / OpenID Connect.
 */
export function getAuthorizationUrl(provider: OAuthProvider, stateToken: string): string {
  if (!isProviderConfigured(provider)) {
    throw new Error(`OAuth-Provider '${provider}' ist nicht konfiguriert.`);
  }

  const redirectUri = getRedirectUri(provider);

  if (provider === 'google') {
    const clientId = process.env.GOOGLE_CLIENT_ID!.trim();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: stateToken,
      access_type: 'online',
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  if (provider === 'microsoft') {
    const clientId = process.env.MICROSOFT_CLIENT_ID!.trim();
    const tenant = process.env.MICROSOFT_TENANT_ID?.trim() || 'common';
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email User.Read',
      state: stateToken,
      response_mode: 'query',
      prompt: 'select_account',
    });
    return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  throw new Error(`Nicht unterstützter Provider: ${provider}`);
}

/**
 * Exchanges an authorization code for access tokens with the respective provider.
 */
export async function exchangeCodeForTokens(
  provider: OAuthProvider,
  code: string
): Promise<{ accessToken: string; idToken?: string }> {
  const redirectUri = getRedirectUri(provider);

  if (provider === 'google') {
    const clientId = process.env.GOOGLE_CLIENT_ID!.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!.trim();

    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Google Token-Austausch fehlgeschlagen (${res.status}): ${err}`);
    }

    const data = await res.json();
    return { accessToken: data.access_token, idToken: data.id_token };
  }

  if (provider === 'microsoft') {
    const clientId = process.env.MICROSOFT_CLIENT_ID!.trim();
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET!.trim();
    const tenant = process.env.MICROSOFT_TENANT_ID?.trim() || 'common';

    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    });

    const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Microsoft Token-Austausch fehlgeschlagen (${res.status}): ${err}`);
    }

    const data = await res.json();
    return { accessToken: data.access_token, idToken: data.id_token };
  }

  throw new Error(`Nicht unterstützter Provider: ${provider}`);
}

/**
 * Fetches user profile information from the OAuth provider.
 */
export async function fetchOAuthUserProfile(
  provider: OAuthProvider,
  accessToken: string
): Promise<OAuthUserProfile> {
  if (provider === 'google') {
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      throw new Error(`Google UserInfo fehlgeschlagen (${res.status})`);
    }

    const data = await res.json();
    if (!data.sub || !data.email) {
      throw new Error('Google UserInfo enthält keine gültige Benutzer-ID oder E-Mail.');
    }

    return {
      provider: 'google',
      providerAccountId: String(data.sub).trim(),
      email: String(data.email).trim().toLowerCase(),
      name: data.name?.trim() || 'Lehrperson',
      emailVerified: data.email_verified === true,
    };
  }

  if (provider === 'microsoft') {
    const res = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      throw new Error(`Microsoft Graph me-Abfrage fehlgeschlagen (${res.status})`);
    }

    const data = await res.json();
    const email = data.mail || data.userPrincipalName;
    if (!data.id || !email) {
      throw new Error('Microsoft Graph enthält keine gültige Benutzer-ID oder E-Mail.');
    }

    return {
      provider: 'microsoft',
      providerAccountId: String(data.id).trim(),
      email: String(email).trim().toLowerCase(),
      name: data.displayName?.trim() || 'Lehrperson',
      // Microsoft Graph /v1.0/me liefert keinen belastbaren E-Mail-Verifizierungsclaim
      // (mail / userPrincipalName ist nicht automatisch eine bestaetigte Adresse).
      emailVerified: false,
    };
  }

  throw new Error(`Nicht unterstützter Provider: ${provider}`);
}

/**
 * Finds a federated identity by provider and provider account id.
 */
export async function findFederatedIdentity(
  provider: OAuthProvider,
  providerAccountId: string
): Promise<FederatedIdentity | null> {
  const normId = providerAccountId.trim();

  // 1. Check in-memory store
  const foundMem = inMemoryIdentities.find(
    (i) => i.provider === provider && i.providerAccountId === normId
  );
  if (foundMem) return foundMem;

  // 2. Query PostgreSQL if table is available
  try {
    await ensureFederatedIdentitiesTable();
    const rows = await db.$queryRawUnsafe<
      Array<{
        id: string;
        teacher_id: string;
        provider: string;
        provider_account_id: string;
        email: string;
        created_at: Date;
      }>
    >(
      `SELECT id, teacher_id, provider, provider_account_id, email, created_at
       FROM teacher_federated_identities
       WHERE provider = $1 AND provider_account_id = $2
       LIMIT 1`,
      provider,
      normId
    );

    if (rows && rows.length > 0) {
      const row = rows[0];
      const identity: FederatedIdentity = {
        id: row.id,
        teacherId: row.teacher_id,
        provider: row.provider as OAuthProvider,
        providerAccountId: row.provider_account_id,
        email: row.email,
        createdAt: row.created_at,
      };
      if (!inMemoryIdentities.some((i) => i.id === identity.id)) {
        inMemoryIdentities.push(identity);
      }
      return identity;
    }
  } catch {
    // In-memory fallback
  }

  return null;
}

/**
 * Returns all federated identities linked to a specific teacher.
 */
export async function getFederatedIdentitiesForTeacher(
  teacherId: string
): Promise<FederatedIdentity[]> {
  const results: FederatedIdentity[] = [];

  try {
    await ensureFederatedIdentitiesTable();
    const rows = await db.$queryRawUnsafe<
      Array<{
        id: string;
        teacher_id: string;
        provider: string;
        provider_account_id: string;
        email: string;
        created_at: Date;
      }>
    >(
      `SELECT id, teacher_id, provider, provider_account_id, email, created_at
       FROM teacher_federated_identities
       WHERE teacher_id = $1
       ORDER BY created_at ASC`,
      teacherId
    );

    if (rows && rows.length > 0) {
      for (const row of rows) {
        results.push({
          id: row.id,
          teacherId: row.teacher_id,
          provider: row.provider as OAuthProvider,
          providerAccountId: row.provider_account_id,
          email: row.email,
          createdAt: row.created_at,
        });
      }
      return results;
    }
  } catch {
    // In-memory fallback
  }

  return inMemoryIdentities.filter((i) => i.teacherId === teacherId);
}

/**
 * Links a federated identity to a teacher account.
 * Rejects if the provider account is already linked to a different teacher.
 */
export async function linkFederatedIdentity(params: {
  teacherId: string;
  provider: OAuthProvider;
  providerAccountId: string;
  email: string;
}): Promise<FederatedIdentity> {
  const { teacherId, provider, providerAccountId, email } = params;
  const normId = providerAccountId.trim();
  const normEmail = email.trim().toLowerCase();

  // Check if already linked to someone else
  const existing = await findFederatedIdentity(provider, normId);
  if (existing && existing.teacherId !== teacherId) {
    throw new Error(
      `Dieses ${getProviderDisplayName(provider)}-Konto ist bereits mit einem anderen Benutzerkonto verknüpft.`
    );
  }

  const id = existing?.id || crypto.randomUUID();
  const identity: FederatedIdentity = {
    id,
    teacherId,
    provider,
    providerAccountId: normId,
    email: normEmail,
    createdAt: existing?.createdAt || new Date(),
  };

  // Upsert in memory
  const memIndex = inMemoryIdentities.findIndex(
    (i) => i.provider === provider && i.providerAccountId === normId
  );
  if (memIndex >= 0) {
    inMemoryIdentities[memIndex] = identity;
  } else {
    inMemoryIdentities.push(identity);
  }

  // Persist to PostgreSQL if available
  try {
    await ensureFederatedIdentitiesTable();
    await db.$executeRawUnsafe(
      `INSERT INTO teacher_federated_identities (id, teacher_id, provider, provider_account_id, email, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (provider, provider_account_id)
       DO UPDATE SET teacher_id = $2, email = $5`,
      id,
      teacherId,
      provider,
      normId,
      normEmail
    );
  } catch {
    // In-memory fallback
  }

  return identity;
}

/**
 * Unlinks a federated identity from a teacher account.
 */
export async function unlinkFederatedIdentity(
  teacherId: string,
  provider: OAuthProvider
): Promise<boolean> {
  // Check memory
  const idx = inMemoryIdentities.findIndex(
    (i) => i.teacherId === teacherId && i.provider === provider
  );
  if (idx >= 0) {
    inMemoryIdentities.splice(idx, 1);
  }

  try {
    await ensureFederatedIdentitiesTable();
    await db.$executeRawUnsafe(
      `DELETE FROM teacher_federated_identities WHERE teacher_id = $1 AND provider = $2`,
      teacherId,
      provider
    );
    return true;
  } catch {
    // In-memory fallback
  }

  return true;
}

/**
 * Resets in-memory state for isolated unit testing.
 */
export function resetOAuthMemoryState(): void {
  inMemoryIdentities.length = 0;
  tableInitialized = false;
}
