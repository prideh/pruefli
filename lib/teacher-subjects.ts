import { db } from './db';
import { normalizeSubjectValue } from './grading';

const inMemoryTeacherSubjects = new Map<string, string[]>();
let tableInitialized = false;

/**
 * Initializes the lightweight teacher subject preferences table if running against a real PostgreSQL instance.
 * Gracefully no-ops if raw SQL is restricted or running under mock unit test environments.
 */
export async function ensureTeacherSubjectsTable(): Promise<void> {
  if (tableInitialized) return;
  try {
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS teacher_subject_preferences (
        teacher_id TEXT PRIMARY KEY,
        subjects_json TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    tableInitialized = true;
  } catch {
    // In-memory fallback if raw SQL is not available
  }
}

/**
 * Sanitizes and deduplicates a list of subject strings, preserving catalog canonical values and custom trimmed names.
 */
export function sanitizeSubjectList(rawSubjects: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of rawSubjects) {
    if (typeof item !== 'string') continue;
    const normalized = normalizeSubjectValue(item);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

/**
 * Loads the teacher's explicitly saved subject list ("Meine Fächer"), or returns null if the teacher
 * has not saved a custom configuration yet.
 */
export async function getTeacherSavedSubjects(teacherId: string): Promise<string[] | null> {
  if (!teacherId) return null;

  try {
    await ensureTeacherSubjectsTable();
    const rows = await db.$queryRawUnsafe<Array<{ subjects_json?: string }>>(
      `SELECT subjects_json FROM teacher_subject_preferences WHERE teacher_id = $1 LIMIT 1`,
      teacherId
    );
    if (Array.isArray(rows) && rows.length > 0 && typeof rows[0].subjects_json === 'string') {
      const parsed = JSON.parse(rows[0].subjects_json);
      if (Array.isArray(parsed)) {
        const sanitized = sanitizeSubjectList(parsed);
        inMemoryTeacherSubjects.set(teacherId, sanitized);
        return sanitized;
      }
    }
  } catch {
    // Fallback to in-memory state
  }

  const memEntry = inMemoryTeacherSubjects.get(teacherId);
  return memEntry ? [...memEntry] : null;
}

/**
 * Saves the teacher's subject list ("Meine Fächer").
 */
export async function saveTeacherSubjects(
  teacherId: string,
  subjects: unknown[]
): Promise<string[]> {
  const sanitized = sanitizeSubjectList(subjects);
  if (!teacherId) return sanitized;

  inMemoryTeacherSubjects.set(teacherId, sanitized);

  try {
    await ensureTeacherSubjectsTable();
    await db.$executeRawUnsafe(
      `INSERT INTO teacher_subject_preferences (teacher_id, subjects_json, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (teacher_id) DO UPDATE SET subjects_json = $2, updated_at = NOW()`,
      teacherId,
      JSON.stringify(sanitized)
    );
  } catch {
    // In-memory fallback is active
  }

  return sanitized;
}

/**
 * Resets in-memory state for unit tests.
 */
export function resetTeacherSubjectsMemoryState(): void {
  inMemoryTeacherSubjects.clear();
  tableInitialized = false;
}
