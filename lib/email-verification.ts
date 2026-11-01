import { db } from './db';

const inMemoryVerifiedTeachers = new Set<string>();
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
  if (!teacherId) return false;
  inMemoryVerifiedTeachers.add(teacherId);

  try {
    await ensureVerificationTable();
    await db.$executeRawUnsafe(
      `INSERT INTO teacher_email_verifications (teacher_id, email, verified_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (teacher_id) DO UPDATE SET verified_at = NOW(), email = $2`,
      teacherId,
      email.toLowerCase()
    );
  } catch {
    // In-memory fallback is active
  }

  return true;
}

/**
 * Checks whether the given teacher has verified their email address.
 */
export async function isEmailVerified(teacherId: string): Promise<boolean> {
  if (!teacherId) return false;
  if (inMemoryVerifiedTeachers.has(teacherId)) {
    return true;
  }

  try {
    await ensureVerificationTable();
    const rows = await db.$queryRawUnsafe<Array<{ verified_at: Date }>>(
      `SELECT verified_at FROM teacher_email_verifications WHERE teacher_id = $1 LIMIT 1`,
      teacherId
    );
    if (rows && rows.length > 0) {
      inMemoryVerifiedTeachers.add(teacherId);
      return true;
    }
  } catch {
    // Fallback to in-memory state
  }

  return false;
}

/**
 * Resets in-memory verification cache for unit tests.
 */
export function resetVerificationMemoryState(): void {
  inMemoryVerifiedTeachers.clear();
  tableInitialized = false;
}
