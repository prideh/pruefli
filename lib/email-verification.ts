import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { db } from './db';
import { isLiveSendingEnabled } from './email';

export const EMAIL_VERIFICATION_REQUIRED_CODE = 'EMAIL_VERIFICATION_REQUIRED';
export const ENFORCE_EMAIL_VERIFICATION_COOKIE = 'pruefli_enforce_email_verification';
export const DEFAULT_EMAIL_VERIFICATION_CUTOFF_DATE = '2026-03-01T00:00:00.000Z';

export interface EmailVerificationStatus {
  isEmailVerified: boolean;
  isGrandfathered: boolean;
  enforcementEnabled: boolean;
  emailVerificationRequired: boolean;
  liveSendingEnabled: boolean;
  cutoffDate: string;
}

interface GlobalVerificationState {
  verifiedTeachers: Map<string, { email: string; verifiedAt: Date }>;
  pendingTeachers: Map<string, { email: string; pendingSince: Date }>;
  tableInitialized: boolean;
}

const globalForVerification = globalThis as unknown as {
  __pruefliEmailVerificationState?: GlobalVerificationState;
};

function getGlobalState(): GlobalVerificationState {
  if (!globalForVerification.__pruefliEmailVerificationState) {
    globalForVerification.__pruefliEmailVerificationState = {
      verifiedTeachers: new Map<string, { email: string; verifiedAt: Date }>(),
      pendingTeachers: new Map<string, { email: string; pendingSince: Date }>(),
      tableInitialized: false,
    };
  }
  return globalForVerification.__pruefliEmailVerificationState;
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return undefined;
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

/**
 * Initializes the lightweight verification tracking table if running against a real PostgreSQL instance.
 * Gracefully no-ops if raw SQL is restricted or running under mock unit test environments.
 */
export async function ensureVerificationTable(): Promise<void> {
  const state = getGlobalState();
  if (state.tableInitialized || !shouldUseSqlPersistence()) return;
  try {
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS teacher_email_verifications (
        teacher_id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        verified_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    state.tableInitialized = true;
  } catch {
    // In-memory fallback if raw SQL is not available
  }
}

/**
 * Records that a newly registered teacher account is awaiting email verification.
 */
export async function markEmailVerificationPending(
  teacherId: string,
  email: string
): Promise<boolean> {
  if (!teacherId || !email) return false;
  const state = getGlobalState();
  const normalizedEmail = email.trim().toLowerCase();
  state.pendingTeachers.set(teacherId, {
    email: normalizedEmail,
    pendingSince: new Date(),
  });
  return true;
}

/**
 * Checks whether the teacher account was marked as newly registered and pending verification.
 */
export function isEmailVerificationPending(teacherId: string): boolean {
  if (!teacherId) return false;
  return getGlobalState().pendingTeachers.has(teacherId);
}

/**
 * Marks a teacher account as verified.
 */
export async function markEmailVerified(teacherId: string, email: string): Promise<boolean> {
  if (!teacherId || !email) return false;
  const state = getGlobalState();
  const normalizedEmail = email.trim().toLowerCase();
  state.pendingTeachers.delete(teacherId);
  state.verifiedTeachers.set(teacherId, {
    email: normalizedEmail,
    verifiedAt: new Date(),
  });

  if (shouldUseSqlPersistence()) {
    try {
      await ensureVerificationTable();
      await db.$executeRawUnsafe(
        `INSERT INTO teacher_email_verifications (teacher_id, email, verified_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (teacher_id) DO UPDATE SET verified_at = NOW(), email = $2`,
        teacherId,
        normalizedEmail
      );
    } catch {
      // In-memory fallback is active
    }
  }

  return true;
}

/**
 * Checks whether the given teacher has verified their email address.
 * When `expectedEmail` is provided, also validates that the verified address matches the current account email.
 */
export async function isEmailVerified(teacherId: string, expectedEmail?: string): Promise<boolean> {
  if (!teacherId) return false;
  const state = getGlobalState();
  const normalizedExpected = expectedEmail?.trim().toLowerCase();

  if (shouldUseSqlPersistence()) {
    try {
      await ensureVerificationTable();
      const rows = await db.$queryRawUnsafe<Array<{ email?: string; verified_at: Date }>>(
        `SELECT email, verified_at FROM teacher_email_verifications WHERE teacher_id = $1 LIMIT 1`,
        teacherId
      );
      if (Array.isArray(rows) && rows.length > 0) {
        const rowEmail = rows[0].email?.trim().toLowerCase();
        if (normalizedExpected && rowEmail && rowEmail !== normalizedExpected) {
          return false;
        }
        state.pendingTeachers.delete(teacherId);
        state.verifiedTeachers.set(teacherId, {
          email: rowEmail || normalizedExpected || '',
          verifiedAt: rows[0].verified_at ? new Date(rows[0].verified_at) : new Date(),
        });
        return true;
      }
    } catch {
      // Fallback to in-memory state
    }
  }

  const memEntry = state.verifiedTeachers.get(teacherId);
  if (!memEntry) return false;
  if (normalizedExpected && memEntry.email && memEntry.email !== normalizedExpected) {
    return false;
  }
  return true;
}

/**
 * Checks whether the email verification enforcement feature flag is enabled via environment variables.
 */
export function isEmailVerificationFlagEnabled(): boolean {
  const explicit =
    parseBooleanEnv(process.env.EMAIL_VERIFICATION_ENFORCED) ??
    parseBooleanEnv(process.env.ENFORCE_EMAIL_VERIFICATION);
  return explicit === true;
}

function isEmailVerificationExplicitlyDisabled(): boolean {
  const explicit =
    parseBooleanEnv(process.env.EMAIL_VERIFICATION_ENFORCED) ??
    parseBooleanEnv(process.env.ENFORCE_EMAIL_VERIFICATION);
  return explicit === false;
}

function extractCookieFromHeader(
  cookieHeader: string | null | undefined,
  name: string
): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) {
      return rest.join('=').trim();
    }
  }
  return null;
}

async function hasEnforcementCookieInRequest(request?: Request): Promise<boolean> {
  try {
    const headerCookie = request?.headers?.get?.('cookie');
    const fromHeader = extractCookieFromHeader(headerCookie, ENFORCE_EMAIL_VERIFICATION_COOKIE);
    if (fromHeader !== null) {
      return parseBooleanEnv(fromHeader) === true;
    }
  } catch {
    // Ignore malformed request objects in unit tests
  }

  try {
    const cookieStore = await cookies();
    const cookieVal = cookieStore.get(ENFORCE_EMAIL_VERIFICATION_COOKIE)?.value;
    if (cookieVal !== undefined) {
      return parseBooleanEnv(cookieVal) === true;
    }
  } catch {
    // Outside Next.js request context
  }

  return false;
}

/**
 * Determines whether server-side email verification enforcement is active.
 *
 * Rollout & Review-Gate safety:
 * - Requires `EMAIL_VERIFICATION_ENFORCED=true` AND (`isLiveSendingEnabled()` OR `EMAIL_VERIFICATION_ALLOW_MOCK=true`),
 *   so enabling the flag before Brevo live sending is active cannot lock out new registrations.
 * - Also supports opt-in enforcement via the `pruefli_enforce_email_verification=true` request cookie
 *   (unless explicitly disabled via `EMAIL_VERIFICATION_ENFORCED=false`) for deterministic E2E verification testing.
 */
export async function isEmailVerificationEnforcementEnabled(options?: {
  request?: Request;
}): Promise<boolean> {
  if (isEmailVerificationExplicitlyDisabled()) {
    return false;
  }

  if (isEmailVerificationFlagEnabled()) {
    const allowMock = parseBooleanEnv(process.env.EMAIL_VERIFICATION_ALLOW_MOCK) === true;
    if (isLiveSendingEnabled() || allowMock) {
      return true;
    }
  }

  return hasEnforcementCookieInRequest(options?.request);
}

/**
 * Returns the cutoff timestamp used for grandfathering existing accounts (Bestandskonten).
 * Accounts created strictly before this timestamp are not locked out when enforcement is enabled.
 */
export function getEmailVerificationCutoffDate(): Date {
  const raw = process.env.EMAIL_VERIFICATION_CUTOFF_DATE?.trim();
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date(DEFAULT_EMAIL_VERIFICATION_CUTOFF_DATE);
}

/**
 * Checks whether an unverified teacher account is grandfathered (Bestandskonto created before cutoff date).
 */
export async function isTeacherGrandfathered(options: {
  teacherId: string;
  createdAt?: Date | string | null;
  isVerified?: boolean;
}): Promise<boolean> {
  if (options.isVerified) return false;
  if (!options.teacherId) return false;

  const cutoffDate = getEmailVerificationCutoffDate();
  let resolvedCreatedAt: Date | null = null;

  if (options.createdAt) {
    const parsed = new Date(options.createdAt);
    if (!Number.isNaN(parsed.getTime())) {
      resolvedCreatedAt = parsed;
    }
  } else if (!('createdAt' in options)) {
    try {
      const teacher = await db.teacher.findUnique({
        where: { id: options.teacherId },
        select: { createdAt: true },
      });
      if (teacher?.createdAt) {
        const parsed = new Date(teacher.createdAt);
        if (!Number.isNaN(parsed.getTime())) {
          resolvedCreatedAt = parsed;
        }
      }
    } catch {
      // Ignore DB lookup errors in unit tests with partial mocks
    }
  }

  if (!resolvedCreatedAt) {
    return false;
  }

  return resolvedCreatedAt.getTime() < cutoffDate.getTime();
}

/**
 * Resolves the complete email verification and enforcement status for a teacher account.
 */
export async function getEmailVerificationStatus(
  teacherId: string,
  options?: {
    email?: string;
    createdAt?: Date | string | null;
    request?: Request;
  }
): Promise<EmailVerificationStatus> {
  const verified = await isEmailVerified(teacherId, options?.email);
  const enforcementEnabled = await isEmailVerificationEnforcementEnabled({
    request: options?.request,
  });
  const grandfathered = verified
    ? false
    : await isTeacherGrandfathered({
        teacherId,
        isVerified: verified,
        ...(options && 'createdAt' in options ? { createdAt: options.createdAt } : {}),
      });
  const emailVerificationRequired = Boolean(enforcementEnabled && !verified && !grandfathered);

  return {
    isEmailVerified: verified,
    isGrandfathered: grandfathered,
    enforcementEnabled,
    emailVerificationRequired,
    liveSendingEnabled: isLiveSendingEnabled(),
    cutoffDate: getEmailVerificationCutoffDate().toISOString(),
  };
}

/**
 * Server-side API guard that rejects unverified non-grandfathered accounts with HTTP 403
 * when email verification enforcement is enabled.
 * Returns `null` when access is permitted.
 */
export async function requireVerifiedEmailForApi(
  teacherId: string,
  request?: Request
): Promise<NextResponse | null> {
  const enforcementEnabled = await isEmailVerificationEnforcementEnabled({ request });
  if (!enforcementEnabled) {
    return null;
  }

  const verified = await isEmailVerified(teacherId);
  if (verified) {
    return null;
  }

  const grandfathered = await isTeacherGrandfathered({
    teacherId,
    isVerified: false,
  });
  if (grandfathered) {
    return null;
  }

  return NextResponse.json(
    {
      error: 'Bitte bestätige zuerst deine E-Mail-Adresse, um auf diese Funktion zuzugreifen.',
      code: EMAIL_VERIFICATION_REQUIRED_CODE,
      emailVerificationRequired: true,
    },
    { status: 403 }
  );
}

/**
 * Resets in-memory verification cache for unit tests.
 */
export function resetVerificationMemoryState(): void {
  const state = getGlobalState();
  state.verifiedTeachers.clear();
  state.pendingTeachers.clear();
  state.tableInitialized = false;
}
