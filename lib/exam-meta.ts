export interface ExamGeneratorParams {
  topic?: string | null;
  stufe?: string | null;
  difficulty?: string | null;
  taskCount?: number | null;
  totalPoints?: number | null;
  enableQrSheet?: boolean | null;
}

export interface ExamMetadata {
  isGenerated: boolean;
  isApproved: boolean;
  approvedAt: string | null;
  materialStorageKey?: string | null;
  generatorParams?: ExamGeneratorParams | null;
  taskSources?: Record<string, string>; // Map taskId -> source reference (e.g. "Seite 2, Abschnitt 2.1")
}

const META_PREFIX = '<!-- PRUEFLI_EXAM_META:';
const LEGACY_META_PREFIX = '<!-- GRADEAI_EXAM_META:';
const META_SUFFIX = ' -->';

/**
 * Parses embedded JSON metadata from exam.gradingNotes.
 * If no metadata is found:
 * - If gradingNotes has no metadata marker, standard non-generated exams are treated as approved by default.
 */
export function parseExamMetadata(gradingNotes?: string | null): {
  metadata: ExamMetadata;
  cleanNotes: string;
} {
  const defaultMeta: ExamMetadata = {
    isGenerated: false,
    isApproved: true,
    approvedAt: null,
    taskSources: {},
    generatorParams: null,
  };

  if (!gradingNotes || typeof gradingNotes !== 'string') {
    return { metadata: defaultMeta, cleanNotes: '' };
  }

  const trimmed = gradingNotes.trim();
  let startIdx = trimmed.indexOf(META_PREFIX);
  let prefixLength = META_PREFIX.length;

  if (startIdx === -1) {
    startIdx = trimmed.indexOf(LEGACY_META_PREFIX);
    prefixLength = LEGACY_META_PREFIX.length;
  }

  if (startIdx === -1) {
    return { metadata: defaultMeta, cleanNotes: trimmed };
  }

  const endIdx = trimmed.indexOf(META_SUFFIX, startIdx + prefixLength);
  if (endIdx === -1) {
    return { metadata: defaultMeta, cleanNotes: trimmed };
  }

  const jsonStr = trimmed.slice(startIdx + prefixLength, endIdx);
  const remainingNotes = (
    trimmed.slice(0, startIdx) + trimmed.slice(endIdx + META_SUFFIX.length)
  ).trim();

  try {
    const parsed = JSON.parse(jsonStr) as Partial<ExamMetadata>;
    const metadata: ExamMetadata = {
      isGenerated: Boolean(parsed.isGenerated),
      isApproved: Boolean(parsed.isApproved),
      approvedAt: parsed.approvedAt || null,
      materialStorageKey: parsed.materialStorageKey || null,
      generatorParams: parsed.generatorParams || null,
      taskSources: parsed.taskSources || {},
    };
    return { metadata, cleanNotes: remainingNotes };
  } catch {
    return { metadata: defaultMeta, cleanNotes: trimmed };
  }
}

/**
 * Embeds JSON metadata into gradingNotes. Preserves any existing clean teacher notes.
 */
export function embedExamMetadata(
  cleanNotes: string | null | undefined,
  metadata: ExamMetadata
): string {
  const jsonStr = JSON.stringify(metadata);
  const metaComment = `${META_PREFIX}${jsonStr}${META_SUFFIX}`;
  const notes = (cleanNotes || '').trim();
  if (!notes) {
    return metaComment;
  }
  return `${metaComment}\n\n${notes}`;
}

/**
 * Resolves ExamMetadata from either structured Exam database columns or the embedded
 * gradingNotes comment, ensuring 100% backward compatibility.
 */
export function resolveExamMetadataFromRecord(exam: {
  gradingNotes?: string | null;
  isGenerated?: boolean | null;
  isApproved?: boolean | null;
  approvedAt?: Date | string | null;
  materialStorageKey?: string | null;
  tasks?: Array<{ taskId: string; sourceReference?: string | null }> | null;
}): {
  metadata: ExamMetadata;
  cleanNotes: string;
} {
  const { metadata: parsedMeta, cleanNotes } = parseExamMetadata(exam.gradingNotes);

  const isGenerated =
    typeof exam.isGenerated === 'boolean'
      ? exam.isGenerated || parsedMeta.isGenerated
      : parsedMeta.isGenerated;
  const isApproved =
    typeof exam.isApproved === 'boolean'
      ? isGenerated
        ? exam.isApproved && parsedMeta.isApproved
        : exam.isApproved
      : parsedMeta.isApproved;
  const approvedAt =
    exam.approvedAt instanceof Date
      ? exam.approvedAt.toISOString()
      : typeof exam.approvedAt === 'string' && exam.approvedAt
        ? exam.approvedAt
        : parsedMeta.approvedAt;
  const materialStorageKey = exam.materialStorageKey || parsedMeta.materialStorageKey || null;

  const taskSources: Record<string, string> = { ...(parsedMeta.taskSources || {}) };
  if (Array.isArray(exam.tasks)) {
    for (const t of exam.tasks) {
      if (t && t.taskId && t.sourceReference && !taskSources[t.taskId]) {
        taskSources[t.taskId] = t.sourceReference;
      }
    }
  }

  return {
    metadata: {
      isGenerated,
      isApproved,
      approvedAt,
      materialStorageKey,
      generatorParams: parsedMeta.generatorParams || null,
      taskSources,
    },
    cleanNotes,
  };
}

/**
 * Checks whether an exam is approved and frozen.
 * Standard (manually created) exams are considered approved by default.
 * Generated exams require explicit approval.
 */
export function isExamApproved(exam: {
  gradingNotes?: string | null;
  isGenerated?: boolean | null;
  isApproved?: boolean | null;
}): boolean {
  const { metadata } = resolveExamMetadataFromRecord(exam);
  if (!metadata.isGenerated) {
    return true; // Non-generated standard exams do not block grading/printing
  }
  return metadata.isApproved === true;
}

/**
 * Checks whether an exam was created via the "Prüfung generieren" flow.
 */
export function isExamGenerated(exam: {
  gradingNotes?: string | null;
  isGenerated?: boolean | null;
}): boolean {
  const { metadata } = resolveExamMetadataFromRecord(exam);
  return metadata.isGenerated === true;
}

export interface ExamSheetQrPayload {
  type: 'PRUEFLI_EXAM_SHEET';
  v: 1;
  examId: string;
  title?: string;
  className?: string;
  subject?: string;
}

/**
 * Baut den maschinenlesbaren QR-Code-Payload für ein Aufgabenblatt (Smart Exam Sheet).
 */
export function buildExamSheetQrPayload(params: {
  examId: string;
  title?: string | null;
  className?: string | null;
  subject?: string | null;
}): string {
  const payload: ExamSheetQrPayload = {
    type: 'PRUEFLI_EXAM_SHEET',
    v: 1,
    examId: String(params.examId || '').trim(),
    ...(params.title ? { title: String(params.title).trim().slice(0, 80) } : {}),
    ...(params.className ? { className: String(params.className).trim().slice(0, 40) } : {}),
    ...(params.subject ? { subject: String(params.subject).trim().slice(0, 40) } : {}),
  };
  return JSON.stringify(payload);
}

/**
 * Parst einen gescannten QR-Code-String und prüft, ob es sich um ein gültiges prüefli-Aufgabenblatt handelt.
 */
export function parseExamSheetQrPayload(raw: string | null | undefined): ExamSheetQrPayload | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw.trim()) as Partial<ExamSheetQrPayload>;
    if (
      parsed &&
      parsed.type === 'PRUEFLI_EXAM_SHEET' &&
      typeof parsed.examId === 'string' &&
      parsed.examId.trim()
    ) {
      return {
        type: 'PRUEFLI_EXAM_SHEET',
        v: 1,
        examId: parsed.examId.trim(),
        ...(parsed.title ? { title: String(parsed.title) } : {}),
        ...(parsed.className ? { className: String(parsed.className) } : {}),
        ...(parsed.subject ? { subject: String(parsed.subject) } : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}
