/**
 * Pure UX state & validation helpers for Issue #119:
 * 1. Deduplicating redundant ErrorState title and body messages
 * 2. Allowing exam creation on /exams when classes are loaded even if the exam list fails
 * 3. Clearing stale validation banners in the Dashboard Wizard & Exam dialogs as soon as conditions are met
 * 4. Updating class student counters and Dashboard stat cards immediately after adding a student
 */

export const DEFAULT_ERROR_RECOVERY_HINT = 'Bitte Verbindung prüfen und erneut versuchen.';

function normalizeErrorTextForComparison(text: string | null | undefined): string {
  return (text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!?:;]+$/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Prevents ErrorState from displaying an identical heading and body text
 * (e.g. title="Fehler beim Laden der Prüfungen" and message="Fehler beim Laden der Prüfungen.").
 * Replaces redundant or empty body text with an actionable recovery hint.
 */
export function resolveErrorStateMessage(
  title: string | undefined,
  message: string | undefined,
  fallbackHint: string = DEFAULT_ERROR_RECOVERY_HINT
): string {
  const effectiveTitle = title ?? 'Fehler beim Laden';
  const trimmedMessage = (message || '').trim();
  if (!trimmedMessage) {
    return fallbackHint;
  }
  if (
    normalizeErrorTextForComparison(effectiveTitle) ===
    normalizeErrorTextForComparison(trimmedMessage)
  ) {
    return fallbackHint;
  }
  return trimmedMessage;
}

export interface CanCreateExamParams {
  classesLoading: boolean;
  classesError?: string | null;
  classesCount: number;
}

/**
 * Determines whether the "Prüfung generieren" and "Manuell anlegen" actions on /exams
 * can be used. Creating an exam requires available classes, not the existing exams list.
 */
export function canCreateExamWithClasses(params: CanCreateExamParams): boolean {
  if (params.classesLoading) return false;
  if (params.classesError && params.classesError.trim().length > 0) return false;
  return params.classesCount > 0;
}

export interface CreateExamDisabledHintParams extends CanCreateExamParams {
  isUnverified?: boolean;
  forAiGeneration?: boolean;
}

/**
 * Returns an explanatory tooltip/hint when an exam creation button on /exams is disabled.
 */
export function resolveCreateExamDisabledHint(params: CreateExamDisabledHintParams): string {
  if (params.forAiGeneration && params.isUnverified) {
    return 'Bitte bestätige zuerst deine E-Mail-Adresse, um KI-Prüfungen zu generieren.';
  }
  if (params.classesLoading) {
    return 'Klassen werden geladen...';
  }
  if (params.classesError && params.classesError.trim().length > 0) {
    return 'Prüfungen können erst angelegt werden, sobald die Klassenliste geladen werden konnte.';
  }
  if (params.classesCount <= 0) {
    return 'Erstelle zuerst eine Klasse, um Prüfungen anzulegen.';
  }
  return '';
}

export interface WizardValidationSnapshot {
  hasClass: boolean;
  hasStudent: boolean;
  isNewExam: boolean;
  hasTitle: boolean;
  hasSubject: boolean;
  hasValidMaxPoints: boolean;
  hasFiles: boolean;
}

/**
 * Determines whether a currently displayed validation error banner in the Dashboard Wizard
 * is stale because the user has now satisfied the required condition.
 */
export function shouldClearWizardValidationError(
  currentError: string,
  state: WizardValidationSnapshot
): boolean {
  const err = (currentError || '').trim();
  if (!err) return false;

  if (
    (err === 'Fach ist erforderlich.' || err === 'Bitte gib ein Fach an.') &&
    (state.hasSubject || !state.isNewExam)
  ) {
    return true;
  }

  if (
    (err === 'Prüfungstitel ist erforderlich.' || err.includes('zuerst einen Prüfungstitel ein')) &&
    (state.hasTitle || !state.isNewExam)
  ) {
    return true;
  }

  if (
    err === 'Bitte gib einen Prüfungstitel und ein Fach für die neue Prüfung an.' &&
    ((state.hasTitle && state.hasSubject) || !state.isNewExam)
  ) {
    return true;
  }

  if (
    (err === 'Bitte gib eine gültige Maximalpunktzahl grösser als 0 an.' ||
      err === 'Maximale Punktzahl muss eine positive Zahl sein.') &&
    (state.hasValidMaxPoints || !state.isNewExam)
  ) {
    return true;
  }

  if (
    (err === 'Bitte wähle eine Klasse aus.' || err === 'Klasse muss ausgewählt sein.') &&
    state.hasClass
  ) {
    return true;
  }

  if (err === 'Bitte wähle einen Schüler oder Auto-Match aus.' && state.hasStudent) {
    return true;
  }

  if (err === 'Bitte lade mindestens eine Schülerarbeit (PDF oder Bild) hoch.' && state.hasFiles) {
    return true;
  }

  return false;
}

export interface ClassWithStudentCount {
  id: string;
  name: string;
  _count?: {
    students?: number;
  };
  studentsCount?: number;
}

/**
 * Updates the student counter on a class entry in memory so Dashboard stat cards
 * and class selector dropdowns reflect newly added students immediately without page reload.
 */
export function applyUpdatedClassStudentCount<T extends ClassWithStudentCount>(
  classes: T[],
  targetClassId: string,
  nextStudentsCount: number
): T[] {
  const safeCount = Math.max(0, Math.trunc(Number(nextStudentsCount) || 0));
  return classes.map((cls) => {
    if (cls.id !== targetClassId) return cls;
    return {
      ...cls,
      ...(typeof cls.studentsCount === 'number' ? { studentsCount: safeCount } : {}),
      _count: {
        ...cls._count,
        students: safeCount,
      },
    };
  });
}

/**
 * Builds the dedicated print view URL (/exams/<examId>/print) for a single submission
 * or for the entire exam cohort so "Feedback drucken" on /correct/<id> opens the rendered
 * feedback sheet instead of a blank about:blank popup.
 */
export function buildFeedbackPrintHref(
  examId: string | null | undefined,
  submissionId?: string | null
): string | null {
  const trimmedExamId = (examId || '').trim();
  if (!trimmedExamId) return null;
  const base = `/exams/${encodeURIComponent(trimmedExamId)}/print`;
  const trimmedSubmissionId = (submissionId || '').trim();
  if (!trimmedSubmissionId) return base;
  return `${base}?submissionId=${encodeURIComponent(trimmedSubmissionId)}`;
}

/**
 * Filters feedback sheets on /exams/[id]/print when a target submissionId is provided
 * via query parameter.
 * IMPORTANT: If an explicit targetSubmissionId is requested and not found in `sheets`,
 * returns an empty array `[]` (NEVER falls back to all student sheets) to prevent
 * accidentally displaying or printing another student's feedback report.
 */
export function filterFeedbackSheetsForPrint<T extends { submissionId: string }>(
  sheets: T[],
  targetSubmissionId?: string | null
): T[] {
  const trimmedId = (targetSubmissionId || '').trim();
  if (!trimmedId) return sheets;
  return sheets.filter((sheet) => sheet.submissionId === trimmedId);
}

/**
 * Normalizes raw user input in maximum-points fields (Issue #127):
 * - Preserves empty string `""` while the teacher clears or edits the field (no forced fallback to `0`).
 * - Strips sticky leading zeros before digits (e.g. `"017"` -> `"17"`, `"0020"` -> `"20"`, `"00.5"` -> `"0.5"`),
 *   while preserving single `"0"` and decimal prefixes like `"0."` or `"0.5"` during typing.
 */
export function normalizeMaxPointsInput(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '';
  const trimmed = String(raw).trim().replace(',', '.');
  if (!trimmed) return '';
  return trimmed.replace(/^(-?)0+(?=\d)/, '$1');
}

/**
 * Parses a maximum-points input into a valid positive finite number (`> 0`),
 * or returns `null` when empty, zero, negative, or non-numeric.
 */
export function parseMaxPointsInput(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  const normalized = normalizeMaxPointsInput(value);
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Returns true if the maximum-points input represents a valid finite number greater than 0.
 */
export function isValidMaxPointsInput(value: string | number | null | undefined): boolean {
  return parseMaxPointsInput(value) !== null;
}
