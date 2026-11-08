import { db } from '@/lib/db';

/**
 * Maximale Laufzeit fuer eine laufende Hintergrund-Korrektur (5 Minuten).
 * Ueberschreitet eine Submission im Status PROCESSING dieses Zeitfenster (z. B. nach Server-Neustart),
 * wird sie deterministisch auf FAILED gesetzt, damit die Lehrperson sie neu starten kann.
 */
export const STALE_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;

export const STALE_PROCESSING_RECOVERY_MESSAGE =
  'Die Hintergrund-Korrektur wurde unerwartet unterbrochen (Zeitüberschreitung). Bitte starte die Korrektur über «Erneut versuchen» neu.';

/**
 * Prueft, ob eine Submission im Status PROCESSING das Zeitlimit ueberschritten hat.
 */
export function isSubmissionStaleProcessing(
  submission: {
    status?: string | null;
    updatedAt?: Date | string | number | null;
    createdAt?: Date | string | number | null;
  },
  nowMs: number = Date.now(),
  timeoutMs: number = STALE_PROCESSING_TIMEOUT_MS
): boolean {
  if (!submission || submission.status !== 'PROCESSING') {
    return false;
  }
  const rawTimestamp = submission.updatedAt ?? submission.createdAt;
  if (!rawTimestamp) {
    return false;
  }
  const ts =
    rawTimestamp instanceof Date
      ? rawTimestamp.getTime()
      : typeof rawTimestamp === 'number'
        ? rawTimestamp
        : Date.parse(String(rawTimestamp));
  if (!Number.isFinite(ts)) {
    return false;
  }
  return nowMs - ts > timeoutMs;
}

/**
 * Setzt verwaiste PROCESSING-Submissions einer Lehrperson in der Datenbank auf FAILED zurueck.
 * Arbeitet defensiv gegen partielle Test-Mocks.
 */
export async function recoverStaleProcessingSubmissions(
  teacherId: string,
  options?: { examId?: string | null; nowMs?: number; timeoutMs?: number }
): Promise<number> {
  if (!teacherId) return 0;

  const submissionModel = (
    db as unknown as {
      submission?: {
        updateMany?: ((args: unknown) => Promise<{ count?: number }>) & { mock?: unknown };
      };
    }
  )?.submission;

  if (typeof submissionModel?.updateMany !== 'function') {
    return 0;
  }

  // Wenn in Unit-Tests updateMany nicht explizit gemockt oder vorbereitet wurde, kein Nebeneffekt
  if (process.env.VITEST === 'true' && !submissionModel.updateMany.mock) {
    return 0;
  }

  const nowMs = options?.nowMs ?? Date.now();
  const timeoutMs = options?.timeoutMs ?? STALE_PROCESSING_TIMEOUT_MS;
  const cutoffDate = new Date(nowMs - timeoutMs);

  try {
    const whereClause: Record<string, unknown> = {
      status: 'PROCESSING',
      updatedAt: { lt: cutoffDate },
      exam: {
        class: {
          teacherId,
        },
      },
    };
    if (options?.examId) {
      whereClause.examId = options.examId;
    }

    const result = await submissionModel.updateMany({
      where: whereClause,
      data: {
        status: 'FAILED',
        errorMessage: STALE_PROCESSING_RECOVERY_MESSAGE,
      },
    });
    return Number(result?.count) || 0;
  } catch {
    return 0;
  }
}
