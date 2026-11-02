import { db } from './db';
import { normalizeSubjectValue } from './grading';

const inMemoryTeacherSubjects = new Map<string, string[]>();
const inMemoryClassSubjects = new Map<string, string[]>();
let tableInitialized = false;

/**
 * Initializes the lightweight teacher and class subject preferences tables if running against a real PostgreSQL instance.
 * Gracefully no-ops if raw SQL is restricted or running under mock unit test environments.
 */
export async function ensureTeacherSubjectsTable(): Promise<void> {
  if (tableInitialized || process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') return;
  try {
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS teacher_subject_preferences (
        teacher_id TEXT PRIMARY KEY,
        subjects_json TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS class_subject_preferences (
        class_id TEXT PRIMARY KEY,
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

  if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
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

  if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
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
  }

  return sanitized;
}

/**
 * Loads the explicitly saved subject subset for a specific class (`[]` means no restriction).
 */
export async function getClassSavedSubjects(classId: string): Promise<string[]> {
  if (!classId) return [];

  if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
    try {
      await ensureTeacherSubjectsTable();
      const rows = await db.$queryRawUnsafe<Array<{ subjects_json?: string }>>(
        `SELECT subjects_json FROM class_subject_preferences WHERE class_id = $1 LIMIT 1`,
        classId
      );
      if (Array.isArray(rows) && rows.length > 0 && typeof rows[0].subjects_json === 'string') {
        const parsed = JSON.parse(rows[0].subjects_json);
        if (Array.isArray(parsed)) {
          const sanitized = sanitizeSubjectList(parsed);
          inMemoryClassSubjects.set(classId, sanitized);
          return sanitized;
        }
      }
    } catch {
      // Fallback to in-memory state
    }
  }

  const memEntry = inMemoryClassSubjects.get(classId);
  return memEntry ? [...memEntry] : [];
}

/**
 * Loads saved subject subsets for multiple classes at once.
 */
export async function getMultipleClassesSavedSubjects(
  classIds: string[]
): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  const validIds = classIds.filter((id) => typeof id === 'string' && id.trim().length > 0);
  if (validIds.length === 0) return result;

  for (const id of validIds) {
    result[id] = [];
  }

  if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
    try {
      await ensureTeacherSubjectsTable();
      const placeholders = validIds.map((_, idx) => `$${idx + 1}`).join(', ');
      const rows = await db.$queryRawUnsafe<Array<{ class_id?: string; subjects_json?: string }>>(
        `SELECT class_id, subjects_json FROM class_subject_preferences WHERE class_id IN (${placeholders})`,
        ...validIds
      );
      if (Array.isArray(rows)) {
        for (const row of rows) {
          if (typeof row.class_id === 'string' && typeof row.subjects_json === 'string') {
            try {
              const parsed = JSON.parse(row.subjects_json);
              if (Array.isArray(parsed)) {
                const sanitized = sanitizeSubjectList(parsed);
                inMemoryClassSubjects.set(row.class_id, sanitized);
                result[row.class_id] = sanitized;
              }
            } catch {
              // Ignore malformed JSON row
            }
          }
        }
        return result;
      }
    } catch {
      // Fallback to in-memory state
    }
  }

  for (const id of validIds) {
    const memEntry = inMemoryClassSubjects.get(id);
    if (memEntry) {
      result[id] = [...memEntry];
    }
  }
  return result;
}

/**
 * Saves the subject subset for a specific class (`[]` means no restriction).
 */
export async function saveClassSubjects(classId: string, subjects: unknown[]): Promise<string[]> {
  const sanitized = sanitizeSubjectList(subjects);
  if (!classId) return sanitized;

  inMemoryClassSubjects.set(classId, sanitized);

  if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
    try {
      await ensureTeacherSubjectsTable();
      await db.$executeRawUnsafe(
        `INSERT INTO class_subject_preferences (class_id, subjects_json, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (class_id) DO UPDATE SET subjects_json = $2, updated_at = NOW()`,
        classId,
        JSON.stringify(sanitized)
      );
    } catch {
      // In-memory fallback is active
    }
  }

  return sanitized;
}

/**
 * Deletes the saved subject subset for a deleted class.
 */
export async function deleteClassSubjects(classId: string): Promise<void> {
  if (!classId) return;
  inMemoryClassSubjects.delete(classId);

  if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
    try {
      await ensureTeacherSubjectsTable();
      await db.$executeRawUnsafe(
        `DELETE FROM class_subject_preferences WHERE class_id = $1`,
        classId
      );
    } catch {
      // In-memory fallback is active
    }
  }
}

/**
 * Resets in-memory state for unit tests.
 */
export function resetTeacherSubjectsMemoryState(): void {
  inMemoryTeacherSubjects.clear();
  inMemoryClassSubjects.clear();
  tableInitialized = false;
}
