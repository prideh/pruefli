// Server-side in-memory store for QR Mobile Relay document scans (Musterlösung / Vorlagenprüfung)
// Persists across hot-reloads via globalThis so desktop dialogs receive mobile scans immediately,
// even before a new exam has been saved to PostgreSQL.

import { db } from '@/lib/db';

export type RelayTargetMode =
  | 'SUBMISSION'
  | 'RUBRIC'
  | 'EXAM_TEMPLATE'
  | 'REPLACE_SUBMISSION'
  | 'APPEND_SUBMISSION';

export interface ScannedRelayDocument {
  id: string;
  sessionId: string;
  teacherId: string;
  targetMode: 'RUBRIC' | 'EXAM_TEMPLATE';
  payload: string; // JSON string of { mimeType, data } or Array<{ mimeType, data }>
  pageCount: number;
  createdAt: number;
}

const globalForRelay = globalThis as unknown as {
  relayDocumentStore?: Map<string, ScannedRelayDocument>;
};

const store = globalForRelay.relayDocumentStore ?? new Map<string, ScannedRelayDocument>();
if (!globalForRelay.relayDocumentStore) {
  globalForRelay.relayDocumentStore = store;
}

const TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

let tableInitialized = false;

function hasDatabaseRawSupport(): boolean {
  const client = db as unknown as {
    $executeRawUnsafe?: ((query: string, ...values: unknown[]) => Promise<unknown>) & {
      mock?: unknown;
    };
    $queryRawUnsafe?: ((query: string, ...values: unknown[]) => Promise<unknown>) & {
      mock?: unknown;
    };
  };
  if (
    typeof client?.$executeRawUnsafe !== 'function' ||
    typeof client?.$queryRawUnsafe !== 'function'
  ) {
    return false;
  }
  if (process.env.VITEST === 'true' && !client.$executeRawUnsafe.mock) {
    return false;
  }
  return true;
}

async function ensureRelayDocumentsTable(): Promise<boolean> {
  if (!hasDatabaseRawSupport()) return false;
  if (tableInitialized) return true;
  try {
    const client = db as unknown as {
      $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
    };
    await client.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS relay_documents (
        session_id TEXT PRIMARY KEY,
        id TEXT NOT NULL,
        teacher_id TEXT NOT NULL,
        target_mode TEXT NOT NULL,
        payload TEXT NOT NULL,
        page_count INTEGER NOT NULL DEFAULT 1,
        created_at BIGINT NOT NULL
      )
    `);
    tableInitialized = true;
    return true;
  } catch {
    return false;
  }
}

function pruneExpired() {
  const now = Date.now();
  for (const [key, val] of store.entries()) {
    if (now - val.createdAt > TTL_MS) {
      store.delete(key);
    }
  }
}

export function saveScannedRelayDocument(doc: ScannedRelayDocument): void {
  pruneExpired();
  store.set(doc.sessionId, doc);

  if (hasDatabaseRawSupport()) {
    void (async () => {
      const ready = await ensureRelayDocumentsTable();
      if (!ready) return;
      try {
        const client = db as unknown as {
          $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
        };
        const cutoff = Date.now() - TTL_MS;
        await client.$executeRawUnsafe(`DELETE FROM relay_documents WHERE created_at < $1`, cutoff);
        await client.$executeRawUnsafe(
          `INSERT INTO relay_documents (session_id, id, teacher_id, target_mode, payload, page_count, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (session_id) DO UPDATE SET
             id = EXCLUDED.id,
             teacher_id = EXCLUDED.teacher_id,
             target_mode = EXCLUDED.target_mode,
             payload = EXCLUDED.payload,
             page_count = EXCLUDED.page_count,
             created_at = EXCLUDED.created_at`,
          doc.sessionId,
          doc.id,
          doc.teacherId,
          doc.targetMode,
          doc.payload,
          doc.pageCount,
          doc.createdAt
        );
      } catch {
        // Non-fatal fallback to in-memory store
      }
    })();
  }
}

export function getScannedRelayDocument(
  sessionId: string | undefined | null,
  teacherId: string
): ScannedRelayDocument | null {
  if (!sessionId) return null;
  pruneExpired();
  const doc = store.get(sessionId);
  if (!doc || doc.teacherId !== teacherId) return null;
  return doc;
}

export async function getScannedRelayDocumentAsync(
  sessionId: string | undefined | null,
  teacherId: string
): Promise<ScannedRelayDocument | null> {
  if (!sessionId) return null;
  const cached = getScannedRelayDocument(sessionId, teacherId);
  if (cached) return cached;

  if (!hasDatabaseRawSupport()) return null;
  const ready = await ensureRelayDocumentsTable();
  if (!ready) return null;

  try {
    const client = db as unknown as {
      $queryRawUnsafe: (
        query: string,
        ...values: unknown[]
      ) => Promise<
        Array<{
          session_id: string;
          id: string;
          teacher_id: string;
          target_mode: 'RUBRIC' | 'EXAM_TEMPLATE';
          payload: string;
          page_count: number;
          created_at: bigint | number | string;
        }>
      >;
    };
    const rows = await client.$queryRawUnsafe(
      `SELECT session_id, id, teacher_id, target_mode, payload, page_count, created_at
       FROM relay_documents
       WHERE session_id = $1 AND teacher_id = $2
       LIMIT 1`,
      sessionId,
      teacherId
    );
    const row = rows?.[0];
    if (!row) return null;
    const createdAt = Number(row.created_at);
    if (Date.now() - createdAt > TTL_MS) {
      return null;
    }
    const restored: ScannedRelayDocument = {
      id: row.id,
      sessionId: row.session_id,
      teacherId: row.teacher_id,
      targetMode: row.target_mode,
      payload: row.payload,
      pageCount: Number(row.page_count) || 1,
      createdAt,
    };
    store.set(restored.sessionId, restored);
    return restored;
  } catch {
    return null;
  }
}

export function resetRelayStoreForTests(): void {
  store.clear();
  tableInitialized = false;
}
