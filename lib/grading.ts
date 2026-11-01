// Swiss Grading Formula, Rounding, Subject Profile, and Student Matching Utilities

export type GradingFormula = 'LINEAR_60' | 'KNICK_50' | 'KNICK_66';
export type GradeRounding = '0.1' | '0.25' | '0.5';

export const GRADING_FORMULA_OPTIONS: {
  value: GradingFormula;
  label: string;
  description: string;
}[] = [
  {
    value: 'LINEAR_60',
    label: 'Linear (Note 4.0 bei 60%)',
    description: 'Schweizer Standardformel: Note = 1 + 5 * (Punkte / MaxPunkte)',
  },
  {
    value: 'KNICK_50',
    label: 'Knick 50% (Note 4.0 ab 50%)',
    description: 'Milder Massstab: Note 4.0 wird bereits bei 50% der Maximalpunktzahl erreicht',
  },
  {
    value: 'KNICK_66',
    label: 'Knick 66.7% (Note 4.0 ab 2/3)',
    description: 'Strenger Massstab: Note 4.0 wird erst ab 66.7% der Maximalpunktzahl erreicht',
  },
];

export const GRADE_ROUNDING_OPTIONS: {
  value: GradeRounding;
  label: string;
}[] = [
  { value: '0.1', label: 'Zehntelnoten (0.1 – z. B. 4.3)' },
  { value: '0.25', label: 'Viertelnoten (0.25 – z. B. 4.25)' },
  { value: '0.5', label: 'Halbnoten (0.5 – z. B. 4.5)' },
];

export type SubjectSupportLevel = 'VERIFIED_MODALITY' | 'FOCUS_PROFILE' | 'GENERIC_FALLBACK';

export interface SubjectProfile {
  value: string;
  label: string;
  profileFocus: string;
  supportLevel: 'VERIFIED_MODALITY' | 'FOCUS_PROFILE';
  supportBadge: string;
  supportDescription: string;
}

export const SUBJECT_PROFILES: SubjectProfile[] = [
  {
    value: 'Mathematik',
    label: 'Mathematik',
    profileFocus: 'Rechenwege, Zwischenschritte, Äquivalenzumformungen & Folgefehler',
    supportLevel: 'VERIFIED_MODALITY',
    supportBadge: 'Verifizierte Modalität',
    supportDescription:
      'Voll verifizierte Folgefehler-Logik & Zwischenwert-Nachrechnung für mathematische Rechenwege.',
  },
  {
    value: 'Geometrie',
    label: 'Geometrie',
    profileFocus: 'Konstruktionsschritte, Winkel-/Längenbeziehungen, Skizzen & Masseinheiten',
    supportLevel: 'FOCUS_PROFILE',
    supportBadge: 'Fokus-Profil',
    supportDescription:
      'Fokus-Anweisung für Konstruktionsschritte & Einheiten aktiv. Spezialisierte Zeichnungsanalyse in Vorbereitung.',
  },
  {
    value: 'Physik',
    label: 'Physik',
    profileFocus: 'Physikalische Formeln, Einheiten, Grössenordnungen & Vorzeichen',
    supportLevel: 'FOCUS_PROFILE',
    supportBadge: 'Fokus-Profil',
    supportDescription:
      'Fokus-Anweisung für physikalische Formeln & Masseinheiten aktiv. Dedizierte Einheiten-Engine in Vorbereitung.',
  },
  {
    value: 'Chemie',
    label: 'Chemie',
    profileFocus: 'Reaktionsgleichungen, Stöchiometrie, Wertigkeiten & Molberechnungen',
    supportLevel: 'FOCUS_PROFILE',
    supportBadge: 'Fokus-Profil',
    supportDescription:
      'Fokus-Anweisung für Reaktionsgleichungen & Stöchiometrie aktiv. Strukturformel-Analyse in Vorbereitung.',
  },
  {
    value: 'Biologie',
    label: 'Biologie',
    profileFocus: 'Fachterminologie, biologische Prozesse & Ursache-Wirkungs-Ketten',
    supportLevel: 'FOCUS_PROFILE',
    supportBadge: 'Fokus-Profil',
    supportDescription:
      'Fokus-Anweisung für Fachterminologie, biochemische Vorgänge & Ursache-Wirkungs-Ketten aktiv.',
  },
  {
    value: 'Informatik',
    label: 'Informatik / ICT',
    profileFocus: 'Algorithmische Logik, Kontrollstrukturen, Randfälle & Code-Korrektheit',
    supportLevel: 'FOCUS_PROFILE',
    supportBadge: 'Fokus-Profil',
    supportDescription:
      'Fokus-Anweisung für algorithmische Logik & Kontrollstrukturen aktiv (mit Syntax-Toleranz bei Handschrift).',
  },
  {
    value: 'Wirtschaft',
    label: 'Wirtschaft & Recht',
    profileFocus: 'Fachbegriffe, Buchungssätze, Kennzahlen & strukturierte Argumentation',
    supportLevel: 'FOCUS_PROFILE',
    supportBadge: 'Fokus-Profil',
    supportDescription:
      'Fokus-Anweisung für ökonomische und juristische Fachbegriffe, Buchungssätze & fallbezogene Argumentation aktiv.',
  },
  {
    value: 'Sprache',
    label: 'Sprache / Deutsch',
    profileFocus: 'Inhaltliche Präzision, Textverständnis, Ausdruck & Orthographie',
    supportLevel: 'FOCUS_PROFILE',
    supportBadge: 'Fokus-Profil',
    supportDescription:
      'Fokus-Anweisung für Textverständnis, Argumentationskohärenz & Orthographie aktiv.',
  },
];

export interface SubjectSupportInfo {
  subjectName: string;
  matchedProfile: SubjectProfile | null;
  supportLevel: SubjectSupportLevel;
  supportBadge: string;
  supportDescription: string;
  profileFocus: string;
}

export function getSubjectSupportInfo(subjectName?: string | null): SubjectSupportInfo {
  const raw = (subjectName || '').trim();
  if (!raw) {
    return {
      subjectName: 'Allgemein',
      matchedProfile: null,
      supportLevel: 'GENERIC_FALLBACK',
      supportBadge: 'Basis-Korrektur',
      supportDescription:
        'Allgemeines Korrektur- und Teilschritte-Profil. Kein fachspezifisches KI-Fokusprofil aktiv.',
      profileFocus:
        'Sachliche und fachliche Korrektheit, nachvollziehbare Teilschritte & faire Punktevergabe',
    };
  }

  const norm = raw.toLowerCase();

  // 1. Exact value or label match
  const exact = SUBJECT_PROFILES.find(
    (p) => p.value.toLowerCase() === norm || p.label.toLowerCase() === norm
  );
  if (exact) {
    return {
      subjectName: exact.label,
      matchedProfile: exact,
      supportLevel: exact.supportLevel,
      supportBadge: exact.supportBadge,
      supportDescription: exact.supportDescription,
      profileFocus: exact.profileFocus,
    };
  }

  // 2. Substring matching for known profiles
  if (norm.includes('mathe') || norm.includes('arithmetik') || norm.includes('algebra')) {
    const p = SUBJECT_PROFILES.find((x) => x.value === 'Mathematik')!;
    return {
      subjectName: raw,
      matchedProfile: p,
      supportLevel: p.supportLevel,
      supportBadge: p.supportBadge,
      supportDescription: p.supportDescription,
      profileFocus: p.profileFocus,
    };
  }
  if (norm.includes('physik')) {
    const p = SUBJECT_PROFILES.find((x) => x.value === 'Physik')!;
    return {
      subjectName: raw,
      matchedProfile: p,
      supportLevel: p.supportLevel,
      supportBadge: p.supportBadge,
      supportDescription: p.supportDescription,
      profileFocus: p.profileFocus,
    };
  }
  if (norm.includes('chemie')) {
    const p = SUBJECT_PROFILES.find((x) => x.value === 'Chemie')!;
    return {
      subjectName: raw,
      matchedProfile: p,
      supportLevel: p.supportLevel,
      supportBadge: p.supportBadge,
      supportDescription: p.supportDescription,
      profileFocus: p.profileFocus,
    };
  }
  if (norm.includes('geometrie')) {
    const p = SUBJECT_PROFILES.find((x) => x.value === 'Geometrie')!;
    return {
      subjectName: raw,
      matchedProfile: p,
      supportLevel: p.supportLevel,
      supportBadge: p.supportBadge,
      supportDescription: p.supportDescription,
      profileFocus: p.profileFocus,
    };
  }
  if (norm.includes('biologie')) {
    const p = SUBJECT_PROFILES.find((x) => x.value === 'Biologie')!;
    return {
      subjectName: raw,
      matchedProfile: p,
      supportLevel: p.supportLevel,
      supportBadge: p.supportBadge,
      supportDescription: p.supportDescription,
      profileFocus: p.profileFocus,
    };
  }
  if (norm.includes('informatik') || norm.includes('ict')) {
    const p = SUBJECT_PROFILES.find((x) => x.value === 'Informatik')!;
    return {
      subjectName: raw,
      matchedProfile: p,
      supportLevel: p.supportLevel,
      supportBadge: p.supportBadge,
      supportDescription: p.supportDescription,
      profileFocus: p.profileFocus,
    };
  }
  if (norm.includes('wirtschaft') || norm.includes('recht')) {
    const p = SUBJECT_PROFILES.find((x) => x.value === 'Wirtschaft')!;
    return {
      subjectName: raw,
      matchedProfile: p,
      supportLevel: p.supportLevel,
      supportBadge: p.supportBadge,
      supportDescription: p.supportDescription,
      profileFocus: p.profileFocus,
    };
  }
  if (
    norm.includes('sprache') ||
    norm.includes('deutsch') ||
    norm.includes('englisch') ||
    norm.includes('franz')
  ) {
    const p = SUBJECT_PROFILES.find((x) => x.value === 'Sprache')!;
    return {
      subjectName: raw,
      matchedProfile: p,
      supportLevel: p.supportLevel,
      supportBadge: p.supportBadge,
      supportDescription: p.supportDescription,
      profileFocus: p.profileFocus,
    };
  }

  // 3. Fallback for custom or unrecognized subjects
  return {
    subjectName: raw,
    matchedProfile: null,
    supportLevel: 'GENERIC_FALLBACK',
    supportBadge: 'Basis-Korrektur',
    supportDescription:
      'Allgemeines Korrektur- und Teilschritte-Profil. Kein fachspezifisches KI-Fokusprofil aktiv.',
    profileFocus:
      'Sachliche und fachliche Korrektheit, nachvollziehbare Teilschritte & faire Punktevergabe',
  };
}

/**
 * Calculates the unrounded raw Swiss school grade (1.0 to 6.0) using the configured formula.
 */
export function calculateRawSwissGrade(
  earnedPoints: number,
  maxPoints: number,
  formula: GradingFormula | string = 'LINEAR_60'
): number {
  if (maxPoints <= 0) return 1.0;

  const ratio = Math.max(0, Math.min(1, earnedPoints / maxPoints));
  let rawGrade = 1.0;

  if (formula === 'KNICK_50') {
    if (ratio < 0.5) {
      rawGrade = 1.0 + 3.0 * (ratio / 0.5);
    } else {
      rawGrade = 4.0 + 2.0 * ((ratio - 0.5) / 0.5);
    }
  } else if (formula === 'KNICK_66') {
    const passRatio = 2 / 3;
    if (ratio < passRatio) {
      rawGrade = 1.0 + 3.0 * (ratio / passRatio);
    } else {
      rawGrade = 4.0 + 2.0 * ((ratio - passRatio) / (1 - passRatio));
    }
  } else {
    // Default LINEAR_60: 1 + 5 * (earned / max) -> 4.0 at 60%
    rawGrade = 1.0 + 5.0 * ratio;
  }

  return Math.min(6.0, Math.max(1.0, rawGrade));
}

/**
 * Calculates a Swiss school grade (1.0 to 6.0) using the configured formula and rounding step.
 */
export function calculateSwissGrade(
  earnedPoints: number,
  maxPoints: number,
  formula: GradingFormula | string = 'LINEAR_60',
  rounding: GradeRounding | string = '0.1'
): string {
  const clamped = calculateRawSwissGrade(earnedPoints, maxPoints, formula);

  if (rounding === '0.5') {
    const rounded = Math.round(clamped * 2) / 2;
    return rounded.toFixed(1);
  }

  if (rounding === '0.25') {
    const rounded = Math.round(clamped * 4) / 4;
    // Format as X.0, X.25, X.5, X.75
    return Number.isInteger(rounded * 2) ? rounded.toFixed(1) : rounded.toFixed(2);
  }

  // Default 0.1 rounding
  const rounded = Math.round(clamped * 10) / 10;
  return rounded.toFixed(1);
}

export interface StudentMatchResult {
  matchedStudentId: string | null;
  suggestedStudentId: string | null;
  confidence: 'HIGH' | 'LOW' | 'NONE';
}

/**
 * Matches an AI-extracted student name against a class roster with explicit confidence calibration.
 * - HIGH: Unique exact normalized name match and AI did not flag the name OCR as uncertain.
 * - LOW: Partial/substring/token match, or exact match where AI flagged handwritten name as uncertain.
 * - NONE: No plausible match or multiple ambiguous matches.
 */
export function matchStudentByNameWithConfidence(
  extractedName: string,
  students: { id: string; name: string }[],
  isAiNameUncertain = false
): StudentMatchResult {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const cleanExtracted = normalize(extractedName);
  if (
    !cleanExtracted ||
    cleanExtracted === 'unbekannt' ||
    cleanExtracted === 'nicht lesbar' ||
    cleanExtracted === 'kein name'
  ) {
    return { matchedStudentId: null, suggestedStudentId: null, confidence: 'NONE' };
  }

  const compact = (s: string) => s.replace(/\s+/g, '');
  const compactExtracted = compact(cleanExtracted);

  // 1. Exact full-name match (normalized or token-order-invariant)
  const extractedTokens = cleanExtracted.split(' ').filter(Boolean);
  const exactMatches = students.filter((s) => {
    const normDb = normalize(s.name);
    if (compact(normDb) === compactExtracted) return true;
    const dbTokens = normDb.split(' ').filter(Boolean);
    if (
      dbTokens.length === extractedTokens.length &&
      dbTokens.length > 0 &&
      dbTokens.every((t) => extractedTokens.includes(t))
    ) {
      return true;
    }
    return false;
  });

  if (exactMatches.length === 1) {
    if (isAiNameUncertain) {
      return {
        matchedStudentId: null,
        suggestedStudentId: exactMatches[0].id,
        confidence: 'LOW',
      };
    }
    return {
      matchedStudentId: exactMatches[0].id,
      suggestedStudentId: exactMatches[0].id,
      confidence: 'HIGH',
    };
  }

  // 2. Substring / partial match -> always LOW confidence (requires teacher confirmation)
  const partialMatches = students.filter((s) => {
    const compactDb = compact(normalize(s.name));
    return (
      compactExtracted.length >= 3 &&
      (compactDb.includes(compactExtracted) || compactExtracted.includes(compactDb))
    );
  });
  if (partialMatches.length === 1) {
    return {
      matchedStudentId: null,
      suggestedStudentId: partialMatches[0].id,
      confidence: 'LOW',
    };
  }

  // 3. Token match (e.g. first name or last name matches uniquely) -> LOW confidence
  const tokenMatches = students.filter((s) => {
    const dbTokens = normalize(s.name)
      .split(' ')
      .filter((t) => t.length >= 3);
    return dbTokens.some((t) => extractedTokens.includes(t));
  });
  if (tokenMatches.length === 1) {
    return {
      matchedStudentId: null,
      suggestedStudentId: tokenMatches[0].id,
      confidence: 'LOW',
    };
  }

  return { matchedStudentId: null, suggestedStudentId: null, confidence: 'NONE' };
}

/**
 * Parses `studentExamUrl` which can be either a single URL string (e.g. "/uploads/exams/abc.jpg")
 * or a JSON array of URL strings for multi-page mobile camera captures (e.g. '["/uploads/exams/p1.jpg","/uploads/exams/p2.jpg"]').
 */
export function parseStudentExamUrls(rawUrl?: string | null): string[] {
  if (!rawUrl) return [];
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter((u): u is string => typeof u === 'string' && u.length > 0);
      }
    } catch {
      // Fallback to single string
    }
  }
  return [trimmed];
}

export interface SerializedDocumentPage {
  mimeType: string;
  data: string;
  name?: string;
}

/**
 * Parses a JSON-serialized single-page or multi-page document payload
 * (e.g. `{"mimeType":"image/png","data":"..."}` or `{"name":"file.png","mimeType":"image/png","data":"..."}`
 * or `[{"mimeType":"image/jpeg","data":"..."}]`), regardless of JSON property order.
 * Returns null if the input is plain text or not a valid document payload.
 */
export function parseSerializedDocumentPayload(
  raw?: string | null
):
  | { kind: 'single'; page: SerializedDocumentPage }
  | { kind: 'multi'; pages: SerializedDocumentPage[] }
  | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (
    !(trimmed.startsWith('{') && trimmed.endsWith('}')) &&
    !(trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      const pages = parsed.filter((item): item is SerializedDocumentPage =>
        Boolean(
          item &&
          typeof item === 'object' &&
          typeof (item as { mimeType?: unknown }).mimeType === 'string' &&
          typeof (item as { data?: unknown }).data === 'string'
        )
      );
      return pages.length > 0 ? { kind: 'multi', pages } : null;
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { mimeType?: unknown }).mimeType === 'string' &&
      typeof (parsed as { data?: unknown }).data === 'string'
    ) {
      return {
        kind: 'single',
        page: parsed as SerializedDocumentPage,
      };
    }
  } catch {
    // Plain text or invalid JSON
  }
  return null;
}

/**
 * Checks whether a string contains a JSON-serialized single or multi-page document payload.
 */
export function isSerializedDocumentPayload(raw?: string | null): boolean {
  return parseSerializedDocumentPayload(raw) !== null;
}

/**
 * Resolves the effective maximum points for grading an exam submission.
 *
 * Single Source of Truth rule:
 * - If the teacher configured an exam maximum (> 0), that value is authoritative and MUST be used.
 * - The model's resolved task sum (resolvedMaxPoints) only serves as fallback when the teacher's
 *   configured maximum is 0 (or undefined).
 * - Neither route may silently override or overwrite the teacher's maximum.
 */
export function resolveEffectiveGradingMaxPoints(params: {
  teacherMaxPoints?: number | null;
  resolvedMaxPoints?: number | null;
  hasPredefinedTasks?: boolean;
}): {
  effectiveMaxPoints: number;
  shouldUpdateExamMaxPoints: boolean;
  isMaxPointsMismatch: boolean;
} {
  const teacherMax = Math.max(0, Number(params.teacherMaxPoints || 0));
  const resolvedMax = Math.max(0, Number(params.resolvedMaxPoints || 0));

  // If teacher provided a positive maximum (either explicitly in form or via predefined tasks):
  if (teacherMax > 0) {
    const isMismatch = resolvedMax > 0 && Math.abs(resolvedMax - teacherMax) > 0.05;
    return {
      effectiveMaxPoints: teacherMax,
      shouldUpdateExamMaxPoints: false,
      isMaxPointsMismatch: isMismatch,
    };
  }

  // Teacher maximum was not set (<= 0)
  if (resolvedMax > 0) {
    return {
      effectiveMaxPoints: resolvedMax,
      shouldUpdateExamMaxPoints: !params.hasPredefinedTasks,
      isMaxPointsMismatch: false,
    };
  }

  return {
    effectiveMaxPoints: 0,
    shouldUpdateExamMaxPoints: false,
    isMaxPointsMismatch: false,
  };
}

export interface GradeAverageSubmissionInput {
  status?: string | null;
  studentId?: string | null;
  assignedStudentId?: string | null;
  studentName?: string | null;
  isStudentMatchUncertain?: boolean | null;
  gradeRaw?: number | null;
  grade?: string | number | null;
  gradeRounded?: string | number | null;
}

/**
 * Determines whether a submission is completed and validly assigned to a class student.
 *
 * Single Source of Truth rule (Issue #75):
 * - Only submissions with `status === 'COMPLETED'` AND an assigned student (`studentId` / `assignedStudentId`
 *   non-empty and not flagged as `'Nicht zugeordnet'` or `isStudentMatchUncertain`) count towards
 *   class, exam, subject, and dashboard grade averages.
 * - Unassigned ("Zuordnung ausstehend") or orphaned duplicate-flow scans are strictly excluded.
 */
export function isAssignedCompletedSubmission(sub: GradeAverageSubmissionInput): boolean {
  if (sub.status !== 'COMPLETED') return false;
  if (sub.isStudentMatchUncertain === true) return false;
  if (sub.studentName && sub.studentName.trim() === 'Nicht zugeordnet') return false;

  const effectiveStudentId =
    sub.assignedStudentId !== undefined ? sub.assignedStudentId : sub.studentId;
  if (!effectiveStudentId || typeof effectiveStudentId !== 'string' || !effectiveStudentId.trim()) {
    return false;
  }

  return true;
}

/**
 * Computes the unified Swiss grade average across completed, student-assigned submissions.
 * Uses unrounded `gradeRaw` when available (falling back to numeric `grade` / `gradeRounded`)
 * before formatting the final average to 2 decimal places (`X.XX` or `'N/A'`).
 */
export function computeAssignedGradeAverage(submissions: GradeAverageSubmissionInput[]): {
  averageGrade: string;
  averageNumeric: number;
  count: number;
  sum: number;
} {
  const validGrades: number[] = [];

  for (const sub of submissions) {
    if (!isAssignedCompletedSubmission(sub)) continue;
    const rawVal =
      typeof sub.gradeRaw === 'number' && Number.isFinite(sub.gradeRaw)
        ? sub.gradeRaw
        : typeof sub.grade === 'number' && Number.isFinite(sub.grade)
          ? sub.grade
          : typeof sub.grade === 'string'
            ? parseFloat(sub.grade)
            : typeof sub.gradeRounded === 'number' && Number.isFinite(sub.gradeRounded)
              ? sub.gradeRounded
              : typeof sub.gradeRounded === 'string'
                ? parseFloat(sub.gradeRounded)
                : NaN;

    if (Number.isFinite(rawVal) && rawVal > 0) {
      validGrades.push(rawVal);
    }
  }

  if (validGrades.length === 0) {
    return {
      averageGrade: 'N/A',
      averageNumeric: 0,
      count: 0,
      sum: 0,
    };
  }

  const sum = validGrades.reduce((acc, g) => acc + g, 0);
  const averageNumeric = sum / validGrades.length;
  return {
    averageGrade: averageNumeric.toFixed(2),
    averageNumeric,
    count: validGrades.length,
    sum,
  };
}
