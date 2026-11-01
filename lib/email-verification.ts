import { db } from './db';

const inMemoryVerifiedTeachers = new Map<string, { email: string; verifiedAt: Date }>();
let tableInitialized = false;

/**
 * Initializes the lightweight verification tracking table if running against a real PostgreSQL instance.
 * Gracefully no-ops if raw SQL is restricted or running under mock unit test environments.
 */
export async function ensureVerificationTable(): Promise<void> {
  if (tableInitialized) return;
  try {
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS teacher_email_verifications (
        teacher_id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        verified_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    tableInitialized = true;
  } catch {
    // In-memory fallback if raw SQL is not available
  }
}

/**
 * Marks a teacher account as verified.
 */
export async function markEmailVerified(teacherId: string, email: string): Promise<boolean> {
  if (!teacherId || !email) return false;
  const normalizedEmail = email.trim().toLowerCase();
  inMemoryVerifiedTeachers.set(teacherId, {
    email: normalizedEmail,
    verifiedAt: new Date(),
  });

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

  return true;
}

/**
 * Checks whether the given teacher has verified their email address.
 * When `expectedEmail` is provided, also validates that the verified address matches the current account email.
 */
export async function isEmailVerified(teacherId: string, expectedEmail?: string): Promise<boolean> {
  if (!teacherId) return false;
  const normalizedExpected = expectedEmail?.trim().toLowerCase();

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
      inMemoryVerifiedTeachers.set(teacherId, {
        email: rowEmail || normalizedExpected || '',
        verifiedAt: rows[0].verified_at ? new Date(rows[0].verified_at) : new Date(),
      });
      return true;
    }
  } catch {
    // Fallback to in-memory state
  }

  const memEntry = inMemoryVerifiedTeachers.get(teacherId);
  if (!memEntry) return false;
  if (normalizedExpected && memEntry.email && memEntry.email !== normalizedExpected) {
    return false;
  }
  return true;
}

/**
 * Resets in-memory verification cache for unit tests.
 */
export function resetVerificationMemoryState(): void {
  inMemoryVerifiedTeachers.clear();
  tableInitialized = false;
}
