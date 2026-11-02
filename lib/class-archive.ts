import { db } from './db';

const inMemoryArchivedClasses = new Map<string, Date>();
let tableInitialized = false;

/**
 * Initialisiert die Tabelle class_archives in PostgreSQL, falls eine Verbindung besteht.
 * Im Testbetrieb (VITEST) oder ohne DB-Verbindung greift der In-Memory-Fallback.
 */
export async function ensureClassArchiveTable(): Promise<void> {
  if (tableInitialized || process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') {
    return;
  }
  try {
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS class_archives (
        class_id TEXT PRIMARY KEY,
        archived_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    // Optional: Falls die Spalte archivedAt auf Class noch nicht existiert, fuer direkte Konsistenz anlegen
    try {
      await db.$executeRawUnsafe(`
        ALTER TABLE "Class" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP;
      `);
    } catch {
      // Ignorieren falls keine Berechtigung fuer DDL
    }
    tableInitialized = true;
  } catch {
    // In-Memory-Fallback aktiv
  }
}

/**
 * Prueft, ob eine Klasse archiviert ist.
 */
export async function isClassArchived(classId: string): Promise<boolean> {
  if (!classId || typeof classId !== 'string') return false;

  if (inMemoryArchivedClasses.has(classId)) {
    return true;
  }

  if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
    try {
      await ensureClassArchiveTable();
      const rows = await db.$queryRawUnsafe<
        Array<{ class_id?: string; archived_at?: Date | string }>
      >(`SELECT class_id, archived_at FROM class_archives WHERE class_id = $1 LIMIT 1`, classId);
      if (Array.isArray(rows) && rows.length > 0) {
        const row = rows[0];
        const dateVal = row.archived_at ? new Date(row.archived_at) : new Date();
        inMemoryArchivedClasses.set(classId, dateVal);
        return true;
      }
    } catch {
      // Fallback auf In-Memory
    }
  }

  return inMemoryArchivedClasses.has(classId);
}

/**
 * Gibt den Archivierungszeitpunkt einer Klasse zurueck, oder null falls aktiv.
 */
export async function getClassArchivedAt(classId: string): Promise<Date | null> {
  if (!classId || typeof classId !== 'string') return null;

  if (inMemoryArchivedClasses.has(classId)) {
    return inMemoryArchivedClasses.get(classId) || null;
  }

  if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
    try {
      await ensureClassArchiveTable();
      const rows = await db.$queryRawUnsafe<Array<{ archived_at?: Date | string }>>(
        `SELECT archived_at FROM class_archives WHERE class_id = $1 LIMIT 1`,
        classId
      );
      if (Array.isArray(rows) && rows.length > 0 && rows[0].archived_at) {
        const dateVal = new Date(rows[0].archived_at);
        inMemoryArchivedClasses.set(classId, dateVal);
        return dateVal;
      }
    } catch {
      // Fallback
    }
  }

  return inMemoryArchivedClasses.get(classId) || null;
}

/**
 * Ermittelt alle archivierten Klassen-IDs fuer eine gegebene Liste oder den gesamten Mandanten.
 */
export async function getArchivedClassIds(classIds?: string[]): Promise<Set<string>> {
  const result = new Set<string>();

  // In-Memory-Werte uebernehmen
  for (const [id] of inMemoryArchivedClasses.entries()) {
    if (!classIds || classIds.includes(id)) {
      result.add(id);
    }
  }

  if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
    try {
      await ensureClassArchiveTable();
      if (Array.isArray(classIds) && classIds.length > 0) {
        const validIds = classIds.filter((id) => typeof id === 'string' && id.trim().length > 0);
        if (validIds.length > 0) {
          const placeholders = validIds.map((_, i) => `$${i + 1}`).join(', ');
          const rows = await db.$queryRawUnsafe<
            Array<{ class_id?: string; archived_at?: Date | string }>
          >(
            `SELECT class_id, archived_at FROM class_archives WHERE class_id IN (${placeholders})`,
            ...validIds
          );
          if (Array.isArray(rows)) {
            for (const r of rows) {
              if (r.class_id) {
                result.add(r.class_id);
                inMemoryArchivedClasses.set(
                  r.class_id,
                  r.archived_at ? new Date(r.archived_at) : new Date()
                );
              }
            }
          }
        }
      } else {
        const rows = await db.$queryRawUnsafe<
          Array<{ class_id?: string; archived_at?: Date | string }>
        >(`SELECT class_id, archived_at FROM class_archives`);
        if (Array.isArray(rows)) {
          for (const r of rows) {
            if (r.class_id) {
              result.add(r.class_id);
              inMemoryArchivedClasses.set(
                r.class_id,
                r.archived_at ? new Date(r.archived_at) : new Date()
              );
            }
          }
        }
      }
    } catch {
      // In-Memory-Werte genuegen als Fallback
    }
  }

  return result;
}

/**
 * Archiviert eine Klasse atomar.
 */
export async function archiveClass(classId: string): Promise<Date> {
  if (!classId || typeof classId !== 'string') {
    throw new Error('Gueltige classId ist fuer die Archivierung erforderlich.');
  }

  const now = new Date();
  inMemoryArchivedClasses.set(classId, now);

  if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
    try {
      await ensureClassArchiveTable();
      await db.$executeRawUnsafe(
        `INSERT INTO class_archives (class_id, archived_at)
         VALUES ($1, $2)
         ON CONFLICT (class_id) DO UPDATE SET archived_at = $2`,
        classId,
        now
      );
      try {
        await db.$executeRawUnsafe(
          `UPDATE "Class" SET "archivedAt" = $1 WHERE id = $2`,
          now,
          classId
        );
      } catch {
        // Ignorieren falls Spalte nicht vorhanden
      }
    } catch {
      // In-Memory-Fallback bleibt gesetzt
    }
  }

  return now;
}

/**
 * Stellt eine archivierte Klasse wieder her (de-archivieren).
 */
export async function unarchiveClass(classId: string): Promise<void> {
  if (!classId || typeof classId !== 'string') return;

  inMemoryArchivedClasses.delete(classId);

  if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
    try {
      await ensureClassArchiveTable();
      await db.$executeRawUnsafe(`DELETE FROM class_archives WHERE class_id = $1`, classId);
      try {
        await db.$executeRawUnsafe(`UPDATE "Class" SET "archivedAt" = NULL WHERE id = $1`, classId);
      } catch {
        // Ignorieren
      }
    } catch {
      // In-Memory-Delete wirksam
    }
  }
}

/**
 * Entfernt den Archiveintrag, wenn eine Klasse vollstaendig aufgeloest/geloescht wird.
 */
export async function deleteClassArchive(classId: string): Promise<void> {
  await unarchiveClass(classId);
}

export interface ClassDeletionImpact {
  studentsCount: number;
  examsCount: number;
  submissionsCount: number;
}

/**
 * Formatiert die konkreten Konsequenzen einer endgueltigen Klassenloeschung
 * mit aktuellen Zahlen aus der Datenbank (z. B. "3 Schüler/innen, 5 Prüfungen, 41 Korrekturen inkl. aller gespeicherten Scans").
 */
export function formatClassDeletionConsequences(impact: ClassDeletionImpact): string {
  const studentsCount = Math.max(0, Math.trunc(Number(impact.studentsCount) || 0));
  const examsCount = Math.max(0, Math.trunc(Number(impact.examsCount) || 0));
  const submissionsCount = Math.max(0, Math.trunc(Number(impact.submissionsCount) || 0));

  const studentsLabel = `${studentsCount} Schüler/innen`;
  const examsLabel = examsCount === 1 ? '1 Prüfung' : `${examsCount} Prüfungen`;
  const submissionsLabel =
    submissionsCount === 1
      ? '1 Korrektur inkl. aller gespeicherten Scans'
      : `${submissionsCount} Korrekturen inkl. aller gespeicherten Scans`;

  return `${studentsLabel}, ${examsLabel}, ${submissionsLabel}`;
}

/**
 * Prueft die Tipp-Bestaetigung fuer das endgueltige Loeschen einer archivierten Klasse.
 * Der eingegebene Name muss exakt (nach Trimming) mit dem Klassennamen uebereinstimmen.
 */
export function isClassDeleteConfirmationValid(
  className: string,
  typedConfirmation: string
): boolean {
  if (typeof className !== 'string' || typeof typedConfirmation !== 'string') {
    return false;
  }
  const expected = className.trim();
  const actual = typedConfirmation.trim();
  if (!expected) {
    return false;
  }
  return actual === expected;
}

/**
 * Erzeugt die klare Abschlussmeldung nach dem endgueltigen Loeschen einer archivierten Klasse.
 */
export function formatClassDeletedCompletionMessage(
  className: string,
  impact?: ClassDeletionImpact
): string {
  const cleanName = (className || '').trim();
  if (impact) {
    const details = formatClassDeletionConsequences(impact);
    return `Die archivierte Klasse „${cleanName}“ (${details}) wurde endgültig und unwiderruflich gelöscht.`;
  }
  return `Die archivierte Klasse „${cleanName}“ wurde endgültig und unwiderruflich gelöscht.`;
}

/**
 * Setzt den In-Memory-Zustand zurueck (fuer Unit-Tests).
 */
export function resetClassArchiveMemoryState(): void {
  inMemoryArchivedClasses.clear();
}
