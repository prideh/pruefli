import { cookies } from 'next/headers';
import { createHash, randomUUID } from 'crypto';
import { signJWT, verifyJWT } from './jwt';
import { db } from './db';
import {
  isSafeReturnUrl,
  resolveSafeReturnUrl,
  buildLoginRedirectUrl,
  saveCorrectionDraft,
  loadCorrectionDraft,
  clearCorrectionDraft,
} from './sessionCache';

export {
  isSafeReturnUrl,
  resolveSafeReturnUrl,
  buildLoginRedirectUrl,
  saveCorrectionDraft,
  loadCorrectionDraft,
  clearCorrectionDraft,
};

export const SESSION_COOKIE_NAME = 'grade_ai_session';

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60; // 604800s
const ONE_DAY_SECONDS = 24 * 60 * 60; // 86400s
const LAZY_CLEANUP_THROTTLE_MS = 60 * 1000; // 60s

export interface SessionLifecycleConfig {
  slidingWindowSeconds: number;
  inactivityTimeoutSeconds: number;
  absoluteMaxSeconds: number;
  renewalThrottleSeconds: number;
  expiryWarningSeconds: number;
  slidingWindowMs: number;
  inactivityTimeoutMs: number;
  absoluteMaxMs: number;
  renewalThrottleMs: number;
  expiryWarningMs: number;
}

export interface SessionRecord {
  id: string;
  teacherId: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  lastRenewedAt: Date;
  revokedAt: Date | null;
  userAgent: string | null;
  tokenVersion: number;
  isLegacyConverted?: boolean;
}

export interface VerifiedSessionResult {
  userId: string;
  sessionId: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  lastRenewedAt: Date;
  remainingSeconds: number;
  expiringSoon: boolean;
  renewed: boolean;
  renewedToken?: string;
  tokenVersion: number;
  isLegacyConverted?: boolean;
}

interface GlobalSessionState {
  sessions: Map<string, SessionRecord>;
  teacherRevokedBefore: Map<string, Date>;
  revokedLegacyIds: Set<string>;
  inflightRenewals: Map<string, { fromVersion: number; promise: Promise<VerifiedSessionResult> }>;
  fallbackCookies: Map<string, string>;
  tableInitialized: boolean;
  lastCleanupAtMs: number;
}

const globalForSessions = globalThis as unknown as {
  __pruefliSessionState?: GlobalSessionState;
};

function getGlobalState(): GlobalSessionState {
  if (!globalForSessions.__pruefliSessionState) {
    globalForSessions.__pruefliSessionState = {
      sessions: new Map<string, SessionRecord>(),
      teacherRevokedBefore: new Map<string, Date>(),
      revokedLegacyIds: new Set<string>(),
      inflightRenewals: new Map(),
      fallbackCookies: new Map<string, string>(),
      tableInitialized: false,
      lastCleanupAtMs: 0,
    };
  }
  return globalForSessions.__pruefliSessionState;
}

function parsePositiveSeconds(envValue: string | undefined, defaultSeconds: number): number {
  if (!envValue) return defaultSeconds;
  const parsed = Number(envValue);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return defaultSeconds;
}

/**
 * Resolves the active session lifecycle configuration from environment variables
 * and optional test/runtime overrides. Defaults preserve the 7-day standard behavior.
 */
export function getSessionLifecycleConfig(
  overrides?: Partial<{
    slidingWindowSeconds: number;
    inactivityTimeoutSeconds: number;
    absoluteMaxSeconds: number;
    renewalThrottleSeconds: number;
    expiryWarningSeconds: number;
  }>
): SessionLifecycleConfig {
  const slidingWindowSeconds =
    overrides?.slidingWindowSeconds ??
    parsePositiveSeconds(process.env.SESSION_SLIDING_WINDOW_SECONDS, SEVEN_DAYS_SECONDS);
  const inactivityTimeoutSeconds =
    overrides?.inactivityTimeoutSeconds ??
    parsePositiveSeconds(process.env.SESSION_INACTIVITY_TIMEOUT_SECONDS, SEVEN_DAYS_SECONDS);
  const absoluteMaxSeconds =
    overrides?.absoluteMaxSeconds ??
    parsePositiveSeconds(process.env.SESSION_ABSOLUTE_MAX_SECONDS, SEVEN_DAYS_SECONDS);
  const renewalThrottleSeconds =
    overrides?.renewalThrottleSeconds ??
    parsePositiveSeconds(process.env.SESSION_RENEWAL_THROTTLE_SECONDS, ONE_DAY_SECONDS);
  const expiryWarningSeconds =
    overrides?.expiryWarningSeconds ??
    parsePositiveSeconds(process.env.SESSION_EXPIRY_WARNING_SECONDS, ONE_DAY_SECONDS);

  return {
    slidingWindowSeconds,
    inactivityTimeoutSeconds,
    absoluteMaxSeconds,
    renewalThrottleSeconds,
    expiryWarningSeconds,
    slidingWindowMs: slidingWindowSeconds * 1000,
    inactivityTimeoutMs: inactivityTimeoutSeconds * 1000,
    absoluteMaxMs: absoluteMaxSeconds * 1000,
    renewalThrottleMs: renewalThrottleSeconds * 1000,
    expiryWarningMs: expiryWarningSeconds * 1000,
  };
}

function shouldUseSqlPersistence(): boolean {
  const rawDb = db as unknown as {
    $executeRawUnsafe?: ((...args: unknown[]) => unknown) & { mock?: unknown };
    $queryRawUnsafe?: ((...args: unknown[]) => unknown) & { mock?: unknown };
  };
  if (!rawDb || typeof rawDb.$executeRawUnsafe !== 'function') {
    return false;
  }
  if (process.env.VITEST === 'true') {
    return Boolean(rawDb.$executeRawUnsafe.mock || rawDb.$queryRawUnsafe?.mock);
  }
  return true;
}

export async function ensureSessionTables(): Promise<void> {
  const state = getGlobalState();
  if (state.tableInitialized || !shouldUseSqlPersistence()) return;
  try {
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS teacher_sessions (
        id TEXT PRIMARY KEY,
        teacher_id TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        last_seen_at TIMESTAMP NOT NULL,
        last_renewed_at TIMESTAMP NOT NULL,
        revoked_at TIMESTAMP NULL,
        user_agent TEXT NULL,
        token_version INTEGER NOT NULL DEFAULT 1,
        is_legacy_converted BOOLEAN NOT NULL DEFAULT FALSE
      );
    `);
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS teacher_session_revocations (
        teacher_id TEXT PRIMARY KEY,
        revoked_before TIMESTAMP NOT NULL
      );
    `);
    state.tableInitialized = true;
  } catch {
    // Fallback to in-memory store if database raw SQL is unavailable
  }
}

async function persistSessionToSql(record: SessionRecord): Promise<void> {
  if (!shouldUseSqlPersistence()) return;
  try {
    await ensureSessionTables();
    await db.$executeRawUnsafe(
      `INSERT INTO teacher_sessions (
         id, teacher_id, created_at, expires_at, last_seen_at, last_renewed_at,
         revoked_at, user_agent, token_version, is_legacy_converted
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         expires_at = EXCLUDED.expires_at,
         last_seen_at = EXCLUDED.last_seen_at,
         last_renewed_at = EXCLUDED.last_renewed_at,
         revoked_at = EXCLUDED.revoked_at,
         user_agent = EXCLUDED.user_agent,
         token_version = EXCLUDED.token_version,
         is_legacy_converted = EXCLUDED.is_legacy_converted`,
      record.id,
      record.teacherId,
      record.createdAt,
      record.expiresAt,
      record.lastSeenAt,
      record.lastRenewedAt,
      record.revokedAt,
      record.userAgent,
      record.tokenVersion,
      Boolean(record.isLegacyConverted)
    );
  } catch {
    // In-memory state remains authoritative fallback
  }
}

async function fetchSessionFromSql(sessionId: string): Promise<SessionRecord | null> {
  if (!shouldUseSqlPersistence()) return null;
  try {
    await ensureSessionTables();
    const rows = await db.$queryRawUnsafe<
      Array<{
        id: string;
        teacher_id: string;
        created_at: Date | string;
        expires_at: Date | string;
        last_seen_at: Date | string;
        last_renewed_at: Date | string;
        revoked_at: Date | string | null;
        user_agent: string | null;
        token_version: number;
        is_legacy_converted: boolean;
      }>
    >(`SELECT * FROM teacher_sessions WHERE id = $1 LIMIT 1`, sessionId);

    if (Array.isArray(rows) && rows.length > 0) {
      const row = rows[0];
      const record: SessionRecord = {
        id: row.id,
        teacherId: row.teacher_id,
        createdAt: new Date(row.created_at),
        expiresAt: new Date(row.expires_at),
        lastSeenAt: new Date(row.last_seen_at),
        lastRenewedAt: new Date(row.last_renewed_at),
        revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
        userAgent: row.user_agent ?? null,
        tokenVersion: Number(row.token_version || 1),
        isLegacyConverted: Boolean(row.is_legacy_converted),
      };
      getGlobalState().sessions.set(record.id, record);
      return record;
    }
  } catch {
    // Ignore SQL lookup error and rely on in-memory state
  }
  return null;
}

export function deriveLegacySessionId(token: string): string {
  const digest = createHash('sha256').update(token).digest('hex').slice(0, 32);
  return `legacy_${digest}`;
}

/**
 * The fallback cookie jar exists ONLY for unit tests, where no Next.js request
 * context exists and cookies() throws. In production a missing request cookie
 * must always mean "no session" - never fall back to a process-global value,
 * otherwise cookieless requests would inherit the most recently issued session.
 */
function isFallbackCookieJarEnabled(): boolean {
  return process.env.NODE_ENV !== 'production';
}

async function setCookieSafe(name: string, value: string, expiresAt: Date): Promise<void> {
  const state = getGlobalState();
  if (isFallbackCookieJarEnabled()) {
    state.fallbackCookies.set(name, value);
  }
  try {
    const cookieStore = await cookies();
    cookieStore.set(name, value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      expires: expiresAt,
      sameSite: 'lax',
      path: '/',
    });
  } catch {
    // Outside request scope or inside read-only Server Component render; fallbackCookies holds state for tests
  }
}

async function getCookieSafe(name: string): Promise<string | undefined> {
  const state = getGlobalState();
  try {
    const cookieStore = await cookies();
    const val = cookieStore.get(name)?.value;
    if (val !== undefined) {
      return val;
    }
  } catch {
    // Outside Next.js request context (unit tests); use fallback cookie jar
  }
  return isFallbackCookieJarEnabled() ? state.fallbackCookies.get(name) : undefined;
}

async function deleteCookieSafe(name: string): Promise<void> {
  const state = getGlobalState();
  state.fallbackCookies.delete(name);
  try {
    const cookieStore = await cookies();
    cookieStore.delete(name);
  } catch {
    // Outside request context
  }
}

/**
 * Lazily purges expired and revoked sessions so the session store cannot grow unbounded.
 */
export async function cleanupExpiredAndRevokedSessions(
  now: Date = new Date()
): Promise<{ deletedCount: number }> {
  const state = getGlobalState();
  const cfg = getSessionLifecycleConfig();
  const nowMs = now.getTime();
  let deletedCount = 0;

  for (const [id, session] of state.sessions.entries()) {
    const isRevoked = session.revokedAt !== null;
    const isExpired = nowMs >= session.expiresAt.getTime();
    const isInactive = nowMs - session.lastSeenAt.getTime() > cfg.inactivityTimeoutMs;
    const isOverAbsoluteMax = nowMs - session.createdAt.getTime() >= cfg.absoluteMaxMs;

    if (isRevoked || isExpired || isInactive || isOverAbsoluteMax) {
      if (session.isLegacyConverted || id.startsWith('legacy_')) {
        state.revokedLegacyIds.add(id);
      }
      state.sessions.delete(id);
      deletedCount += 1;
    }
  }

  state.lastCleanupAtMs = nowMs;

  if (shouldUseSqlPersistence()) {
    try {
      await ensureSessionTables();
      await db.$executeRawUnsafe(
        `DELETE FROM teacher_sessions
         WHERE revoked_at IS NOT NULL
            OR expires_at <= $1
            OR last_seen_at < $2
            OR created_at <= $3`,
        now,
        new Date(nowMs - cfg.inactivityTimeoutMs),
        new Date(nowMs - cfg.absoluteMaxMs)
      );
    } catch {
      // Ignore SQL cleanup errors
    }
  }

  return { deletedCount };
}

function maybeTriggerLazyCleanup(now: Date): void {
  const state = getGlobalState();
  if (now.getTime() - state.lastCleanupAtMs >= LAZY_CLEANUP_THROTTLE_MS) {
    state.lastCleanupAtMs = now.getTime();
    void cleanupExpiredAndRevokedSessions(now);
  }
}

/**
 * Creates a server-side session record and signs a session JWT without requiring Next.js cookie headers.
 */
export async function createSessionRecord(
  userId: string,
  options?: {
    now?: Date;
    userAgent?: string | null;
    config?: Partial<{
      slidingWindowSeconds: number;
      inactivityTimeoutSeconds: number;
      absoluteMaxSeconds: number;
      renewalThrottleSeconds: number;
      expiryWarningSeconds: number;
    }>;
  }
): Promise<{ session: SessionRecord; token: string }> {
  const now = options?.now ? new Date(options.now.getTime()) : new Date();
  const cfg = getSessionLifecycleConfig(options?.config);
  const state = getGlobalState();

  maybeTriggerLazyCleanup(now);

  const initialDurationMs = Math.min(cfg.slidingWindowMs, cfg.absoluteMaxMs);
  const expiresAt = new Date(now.getTime() + initialDurationMs);
  const sessionId = `sess_${randomUUID().replace(/-/g, '')}`;

  const record: SessionRecord = {
    id: sessionId,
    teacherId: userId,
    createdAt: now,
    expiresAt,
    lastSeenAt: now,
    lastRenewedAt: now,
    revokedAt: null,
    userAgent: options?.userAgent ?? null,
    tokenVersion: 1,
    isLegacyConverted: false,
  };

  state.sessions.set(sessionId, record);
  await persistSessionToSql(record);

  const token = await signJWT(
    {
      userId,
      sessionId,
      tokenVersion: 1,
      purpose: 'session',
    },
    Math.floor(expiresAt.getTime() / 1000),
    now
  );

  return { session: record, token };
}

/**
 * Creates a secure cookie session backed by a server-side session record and signed JWT.
 * @param userId Teacher's database ID
 */
export async function createSession(
  userId: string,
  options?: {
    now?: Date;
    userAgent?: string | null;
    config?: Partial<{
      slidingWindowSeconds: number;
      inactivityTimeoutSeconds: number;
      absoluteMaxSeconds: number;
      renewalThrottleSeconds: number;
      expiryWarningSeconds: number;
    }>;
  }
): Promise<{ sessionId: string; token: string; expiresAt: Date }> {
  const { session, token } = await createSessionRecord(userId, options);
  await setCookieSafe(SESSION_COOKIE_NAME, token, session.expiresAt);
  return {
    sessionId: session.id,
    token,
    expiresAt: session.expiresAt,
  };
}

/**
 * Retrieves a session record by its ID from memory or PostgreSQL.
 */
export async function getSessionRecordById(sessionId: string): Promise<SessionRecord | null> {
  if (!sessionId) return null;
  const state = getGlobalState();
  const existing = state.sessions.get(sessionId);
  if (existing) return existing;
  return fetchSessionFromSql(sessionId);
}

/**
 * Returns the count of currently stored session records (useful for cleanup and lifecycle diagnostics).
 */
export function getStoredSessionCount(): number {
  return getGlobalState().sessions.size;
}

/**
 * Validates a session JWT against cryptographic signature, purpose isolation, server-side revocation,
 * inactivity timeout, absolute maximum lifetime, legacy token conversion, and throttled sliding renewal.
 */
export async function verifySessionToken(
  token: string | undefined | null,
  options?: {
    now?: Date;
    renewIfEligible?: boolean;
    config?: Partial<{
      slidingWindowSeconds: number;
      inactivityTimeoutSeconds: number;
      absoluteMaxSeconds: number;
      renewalThrottleSeconds: number;
      expiryWarningSeconds: number;
    }>;
  }
): Promise<VerifiedSessionResult | null> {
  if (!token) return null;
  const now = options?.now ? new Date(options.now.getTime()) : new Date();
  const nowMs = now.getTime();
  const cfg = getSessionLifecycleConfig(options?.config);
  const state = getGlobalState();

  const payload = await verifyJWT(token, now);
  if (!payload || !payload.userId) {
    return null;
  }

  let session: SessionRecord | null = null;

  if (payload.sessionId) {
    // Modern session token: must exist in server-side store
    session =
      state.sessions.get(payload.sessionId) ?? (await fetchSessionFromSql(payload.sessionId));
    if (!session || session.teacherId !== payload.userId) {
      return null;
    }
  } else {
    // Legacy token without sessionId: Option (b) safe deterministic conversion on first verification
    const legacyId = deriveLegacySessionId(token);
    if (state.revokedLegacyIds.has(legacyId)) {
      return null;
    }

    session = state.sessions.get(legacyId) ?? (await fetchSessionFromSql(legacyId));

    if (!session) {
      const tokenIssuedAt = payload.iat ? new Date(payload.iat * 1000) : now;
      const teacherRevokedBefore = state.teacherRevokedBefore.get(payload.userId);
      if (teacherRevokedBefore && tokenIssuedAt.getTime() <= teacherRevokedBefore.getTime()) {
        state.revokedLegacyIds.add(legacyId);
        return null;
      }

      const rawExpiresAt = payload.exp
        ? new Date(payload.exp * 1000)
        : new Date(tokenIssuedAt.getTime() + Math.min(cfg.slidingWindowMs, cfg.absoluteMaxMs));
      const maxAllowedExpiresAt = new Date(tokenIssuedAt.getTime() + cfg.absoluteMaxMs);
      const effectiveExpiresAt =
        rawExpiresAt.getTime() > maxAllowedExpiresAt.getTime() ? maxAllowedExpiresAt : rawExpiresAt;

      session = {
        id: legacyId,
        teacherId: payload.userId,
        createdAt: tokenIssuedAt,
        expiresAt: effectiveExpiresAt,
        lastSeenAt: now,
        lastRenewedAt: tokenIssuedAt,
        revokedAt: null,
        userAgent: null,
        tokenVersion: 1,
        isLegacyConverted: true,
      };
      state.sessions.set(legacyId, session);
      await persistSessionToSql(session);
    }
  }

  // 1. Check explicit revocation
  if (session.revokedAt !== null) {
    return null;
  }

  // 2. Check teacher-wide revocation (e.g. password reset or logout-all)
  const teacherRevokedBefore = state.teacherRevokedBefore.get(session.teacherId);
  if (teacherRevokedBefore && session.createdAt.getTime() <= teacherRevokedBefore.getTime()) {
    session.revokedAt = teacherRevokedBefore;
    if (session.isLegacyConverted || session.id.startsWith('legacy_')) {
      state.revokedLegacyIds.add(session.id);
    }
    await persistSessionToSql(session);
    return null;
  }

  // 3. Check session expiration
  if (nowMs >= session.expiresAt.getTime()) {
    return null;
  }

  // 4. Check inactivity timeout
  if (nowMs - session.lastSeenAt.getTime() > cfg.inactivityTimeoutMs) {
    return null;
  }

  // 5. Check absolute maximum lifetime from createdAt
  const absoluteMaxDeadlineMs = session.createdAt.getTime() + cfg.absoluteMaxMs;
  if (nowMs >= absoluteMaxDeadlineMs) {
    return null;
  }

  // 6. Coordinate concurrent renewals & prevent replay of rotated token versions
  const incomingTokenVersion = typeof payload.tokenVersion === 'number' ? payload.tokenVersion : 1;
  const inflight = state.inflightRenewals.get(session.id);
  if (inflight && inflight.fromVersion === incomingTokenVersion) {
    return inflight.promise;
  }

  if (incomingTokenVersion !== session.tokenVersion) {
    return null;
  }

  // 7. Determine whether throttled sliding renewal should trigger
  const renewIfEligible = options?.renewIfEligible ?? true;
  const elapsedSinceLastRenewalMs = nowMs - session.lastRenewedAt.getTime();
  const shouldRenew =
    renewIfEligible &&
    elapsedSinceLastRenewalMs >= cfg.renewalThrottleMs &&
    nowMs < absoluteMaxDeadlineMs;

  if (shouldRenew) {
    const currentSession = session;
    const fromVersion = currentSession.tokenVersion;

    const renewalPromise = (async (): Promise<VerifiedSessionResult> => {
      try {
        const nextVersion = fromVersion + 1;
        const candidateExpiresMs = Math.min(nowMs + cfg.slidingWindowMs, absoluteMaxDeadlineMs);
        const newExpiresAt = new Date(candidateExpiresMs);

        currentSession.tokenVersion = nextVersion;
        currentSession.lastRenewedAt = now;
        currentSession.lastSeenAt = now;
        currentSession.expiresAt = newExpiresAt;

        state.sessions.set(currentSession.id, currentSession);
        await persistSessionToSql(currentSession);

        const renewedToken = await signJWT(
          {
            userId: currentSession.teacherId,
            sessionId: currentSession.id,
            tokenVersion: nextVersion,
            purpose: 'session',
          },
          Math.floor(newExpiresAt.getTime() / 1000),
          now
        );

        const effectiveEndMs = Math.min(newExpiresAt.getTime(), absoluteMaxDeadlineMs);
        const remainingSeconds = Math.max(0, Math.floor((effectiveEndMs - nowMs) / 1000));
        const expiringSoon = effectiveEndMs - nowMs <= cfg.expiryWarningMs;

        return {
          userId: currentSession.teacherId,
          sessionId: currentSession.id,
          createdAt: currentSession.createdAt,
          expiresAt: currentSession.expiresAt,
          lastSeenAt: currentSession.lastSeenAt,
          lastRenewedAt: currentSession.lastRenewedAt,
          remainingSeconds,
          expiringSoon,
          renewed: true,
          renewedToken,
          tokenVersion: nextVersion,
          isLegacyConverted: currentSession.isLegacyConverted,
        };
      } finally {
        state.inflightRenewals.delete(currentSession.id);
      }
    })();

    state.inflightRenewals.set(currentSession.id, {
      fromVersion,
      promise: renewalPromise,
    });

    return renewalPromise;
  }

  // Update lastSeenAt for activity tracking
  session.lastSeenAt = now;
  state.sessions.set(session.id, session);
  void persistSessionToSql(session);

  const effectiveEndMs = Math.min(session.expiresAt.getTime(), absoluteMaxDeadlineMs);
  const remainingSeconds = Math.max(0, Math.floor((effectiveEndMs - nowMs) / 1000));
  const expiringSoon = effectiveEndMs - nowMs <= cfg.expiryWarningMs;

  return {
    userId: session.teacherId,
    sessionId: session.id,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    lastSeenAt: session.lastSeenAt,
    lastRenewedAt: session.lastRenewedAt,
    remainingSeconds,
    expiringSoon,
    renewed: false,
    tokenVersion: session.tokenVersion,
    isLegacyConverted: session.isLegacyConverted,
  };
}

export interface SessionInfo {
  userId: string;
  sessionId?: string;
  createdAt?: Date;
  expiresAt?: Date;
  lastSeenAt?: Date;
  lastRenewedAt?: Date;
  remainingSeconds?: number;
  expiringSoon?: boolean;
  renewed?: boolean;
  renewedToken?: string;
  tokenVersion?: number;
  isLegacyConverted?: boolean;
}

/**
 * Validates the active secure session from cookies and returns the teacher session metadata if verified.
 * Also applies throttled sliding renewal in regular API/application traffic when eligible.
 */
export async function getSession(options?: {
  now?: Date;
  renewIfEligible?: boolean;
}): Promise<SessionInfo | null> {
  const sessionToken = await getCookieSafe(SESSION_COOKIE_NAME);
  if (!sessionToken) return null;

  const verified = await verifySessionToken(sessionToken, options);
  if (!verified) return null;

  if (verified.renewed && verified.renewedToken) {
    await setCookieSafe(SESSION_COOKIE_NAME, verified.renewedToken, verified.expiresAt);
  }

  return verified;
}

/**
 * Explicitly revokes a single session by ID on the server.
 */
export async function revokeSessionById(
  sessionId: string,
  now: Date = new Date()
): Promise<boolean> {
  if (!sessionId) return false;
  const state = getGlobalState();
  if (sessionId.startsWith('legacy_')) {
    state.revokedLegacyIds.add(sessionId);
  }

  const existing = state.sessions.get(sessionId) ?? (await fetchSessionFromSql(sessionId));
  if (existing) {
    existing.revokedAt = now;
    if (existing.isLegacyConverted || existing.id.startsWith('legacy_')) {
      state.revokedLegacyIds.add(existing.id);
    }
    state.sessions.set(sessionId, existing);
    await persistSessionToSql(existing);
    return true;
  }

  if (shouldUseSqlPersistence()) {
    try {
      await ensureSessionTables();
      await db.$executeRawUnsafe(
        `UPDATE teacher_sessions SET revoked_at = $1 WHERE id = $2`,
        now,
        sessionId
      );
      return true;
    } catch {
      // Ignore SQL update error
    }
  }

  return false;
}

/**
 * Explicitly revokes a session given its raw JWT token (handles both modern and legacy tokens).
 */
export async function revokeSessionToken(
  token: string | undefined | null,
  now: Date = new Date()
): Promise<boolean> {
  if (!token) return false;
  const payload = await verifyJWT(token, now);
  if (payload?.sessionId) {
    return revokeSessionById(payload.sessionId, now);
  }
  const legacyId = deriveLegacySessionId(token);
  getGlobalState().revokedLegacyIds.add(legacyId);
  await revokeSessionById(legacyId, now);
  return true;
}

/**
 * Revokes all active and legacy sessions belonging to a teacher (e.g. on password reset or global logout).
 */
export async function revokeAllTeacherSessions(
  teacherId: string,
  now: Date = new Date()
): Promise<number> {
  if (!teacherId) return 0;
  const state = getGlobalState();
  state.teacherRevokedBefore.set(teacherId, now);

  let revokedCount = 0;
  for (const [id, session] of state.sessions.entries()) {
    if (session.teacherId === teacherId && session.revokedAt === null) {
      session.revokedAt = now;
      if (session.isLegacyConverted || id.startsWith('legacy_')) {
        state.revokedLegacyIds.add(id);
      }
      state.sessions.set(id, session);
      revokedCount += 1;
    }
  }

  if (shouldUseSqlPersistence()) {
    try {
      await ensureSessionTables();
      await db.$executeRawUnsafe(
        `INSERT INTO teacher_session_revocations (teacher_id, revoked_before)
         VALUES ($1, $2)
         ON CONFLICT (teacher_id) DO UPDATE SET revoked_before = EXCLUDED.revoked_before`,
        teacherId,
        now
      );
      await db.$executeRawUnsafe(
        `UPDATE teacher_sessions SET revoked_at = $1 WHERE teacher_id = $2 AND revoked_at IS NULL`,
        now,
        teacherId
      );
    } catch {
      // In-memory state remains authoritative fallback
    }
  }

  return revokedCount;
}

/**
 * Revokes the current session server-side AND deletes the session cookie to log the teacher out.
 */
export async function deleteSession(options?: {
  allSessions?: boolean;
  now?: Date;
}): Promise<void> {
  const now = options?.now ? new Date(options.now.getTime()) : new Date();
  const sessionToken = await getCookieSafe(SESSION_COOKIE_NAME);

  if (sessionToken) {
    const payload = await verifyJWT(sessionToken, now);
    await revokeSessionToken(sessionToken, now);
    if (options?.allSessions && payload?.userId) {
      await revokeAllTeacherSessions(payload.userId, now);
    }
  }

  await deleteCookieSafe(SESSION_COOKIE_NAME);
}

/**
 * Resets in-memory session store for deterministic unit testing.
 */
export function resetSessionStoreForTests(): void {
  const state = getGlobalState();
  state.sessions.clear();
  state.teacherRevokedBefore.clear();
  state.revokedLegacyIds.clear();
  state.inflightRenewals.clear();
  state.fallbackCookies.clear();
  state.tableInitialized = false;
  state.lastCleanupAtMs = 0;
}
