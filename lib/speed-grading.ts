/**
 * Horizontaler Korrektur-Modus ("Aufgabe fixieren") & Express-Unsicherheiten-Queue
 * Deterministische Hilfsfunktionen für schnelles aufgabenweises Korrigieren über die gesamte Klasse.
 */

export interface SpeedGradingTaskLike {
  aufgabeId: string;
  schritte: Array<{ istUnsicher?: boolean }>;
}

export interface SpeedGradingSiblingLike {
  id: string;
  studentName: string;
  uncertainStepsCount: number;
}

/**
 * Bestimmt den initial aktiven Aufgaben-Tab beim Öffnen oder Wechseln einer Schülerabgabe.
 */
export function resolveInitialTaskIndex(params: {
  tasks: SpeedGradingTaskLike[];
  pinnedTaskId?: string | null;
  queryTaskParam?: string | null;
  isUncertainMode?: boolean;
}): number {
  const { tasks, pinnedTaskId, queryTaskParam, isUncertainMode } = params;
  if (!Array.isArray(tasks) || tasks.length === 0) return 0;

  const candidateTaskRef = (queryTaskParam ?? pinnedTaskId ?? '').trim();
  if (candidateTaskRef) {
    const byIdIdx = tasks.findIndex(
      (t) => String(t.aufgabeId).trim().toLowerCase() === candidateTaskRef.toLowerCase()
    );
    if (byIdIdx !== -1) return byIdIdx;

    const asNum = Number(candidateTaskRef);
    if (Number.isInteger(asNum) && asNum >= 0 && asNum < tasks.length) {
      return asNum;
    }
  }

  if (isUncertainMode) {
    const firstUncertainIdx = tasks.findIndex(
      (t) => Array.isArray(t.schritte) && t.schritte.some((s) => Boolean(s.istUnsicher))
    );
    if (firstUncertainIdx !== -1) return firstUncertainIdx;
  }

  return 0;
}

export type UncertaintyNavigationTarget =
  | { type: 'SAME_SUBMISSION_TASK'; taskIndex: number }
  | { type: 'SIBLING_SUBMISSION'; submissionId: string; studentName: string }
  | null;

/**
 * Findet das nächste Ziel in der Express-Unsicherheiten-Queue:
 * 1. Nächste Aufgabe mit `istUnsicher` innerhalb der aktuellen Abgabe (nach `activeTaskIndex`).
 * 2. Nächste Schülerabgabe in `siblingSubmissions` mit `uncertainStepsCount > 0`.
 * 3. Frühere Aufgabe mit `istUnsicher` innerhalb der aktuellen Abgabe.
 */
export function findNextUncertaintyTarget(params: {
  currentSubmissionId: string;
  activeTaskIndex: number;
  tasks: SpeedGradingTaskLike[];
  siblingSubmissions: SpeedGradingSiblingLike[];
}): UncertaintyNavigationTarget {
  const { currentSubmissionId, activeTaskIndex, tasks, siblingSubmissions } = params;

  if (Array.isArray(tasks)) {
    for (let idx = activeTaskIndex + 1; idx < tasks.length; idx++) {
      if (tasks[idx]?.schritte?.some((s) => Boolean(s.istUnsicher))) {
        return { type: 'SAME_SUBMISSION_TASK', taskIndex: idx };
      }
    }
  }

  if (Array.isArray(siblingSubmissions) && siblingSubmissions.length > 0) {
    const currentIdx = siblingSubmissions.findIndex(
      (s) => String(s.id) === String(currentSubmissionId)
    );
    const startOffset = currentIdx !== -1 ? currentIdx + 1 : 0;

    for (let offset = 0; offset < siblingSubmissions.length; offset++) {
      const idx = (startOffset + offset) % siblingSubmissions.length;
      const candidate = siblingSubmissions[idx];
      if (
        candidate &&
        String(candidate.id) !== String(currentSubmissionId) &&
        candidate.uncertainStepsCount > 0
      ) {
        return {
          type: 'SIBLING_SUBMISSION',
          submissionId: candidate.id,
          studentName: candidate.studentName,
        };
      }
    }
  }

  if (Array.isArray(tasks)) {
    for (let idx = 0; idx <= Math.min(activeTaskIndex, tasks.length - 1); idx++) {
      if (tasks[idx]?.schritte?.some((s) => Boolean(s.istUnsicher))) {
        return { type: 'SAME_SUBMISSION_TASK', taskIndex: idx };
      }
    }
  }

  return null;
}

/**
 * Erzeugt die Ziel-URL beim Wechsel zwischen Schülerabgaben unter Berücksichtigung
 * der Aufgaben-Fixierung (Horizontal-Modus) und des Unsicherheiten-Modus.
 */
export function buildSiblingNavigationHref(params: {
  targetSubmissionId: string;
  isTaskPinned: boolean;
  activeTaskId?: string | null;
  activeTaskIndex: number;
  isUncertainMode?: boolean;
}): string {
  const { targetSubmissionId, isTaskPinned, activeTaskId, activeTaskIndex, isUncertainMode } =
    params;
  const searchParams = new URLSearchParams();

  if (isTaskPinned) {
    const taskRef =
      activeTaskId && String(activeTaskId).trim()
        ? String(activeTaskId).trim()
        : String(activeTaskIndex);
    searchParams.set('task', taskRef);
  }
  if (isUncertainMode) {
    searchParams.set('mode', 'uncertain');
  }

  const query = searchParams.toString();
  return query ? `/correct/${targetSubmissionId}?${query}` : `/correct/${targetSubmissionId}`;
}
