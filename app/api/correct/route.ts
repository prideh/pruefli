import { NextResponse, after } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireVerifiedEmailForApi } from '@/lib/email-verification';
import {
  DEFAULT_GEMINI_MODEL,
  runLiveGeminiCorrection,
  auditAndEnforceCorrectionSecurity,
  enforceStepFeedbackConsistency,
  normalizeStepFeedbackConsistency,
  categorizeGeminiError,
  parseSerializedReferenceMaterial,
  type ExamCorrectionResult,
  type ReferenceMaterialInput,
} from '@/lib/gemini';
import {
  calculateRawSwissGrade,
  calculateSwissGrade,
  matchStudentByNameWithConfidence,
  resolveEffectiveGradingMaxPoints,
} from '@/lib/grading';
import { getStorageAdapter } from '@/lib/storage';
import { invalidateSubmissionCache, invalidateLogsCache } from '@/lib/cache';
import {
  computeGradingCacheKey,
  computeGradingHash,
  buildLlmCacheKey,
  getCachedLlmResult,
  setCachedGradingResult,
  setCachedLlmResult,
  LLM_PROMPT_VERSIONS,
} from '@/lib/llm-cache';
import { isExamApproved } from '@/lib/exam-meta';
import { checkAiRateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import {
  validateScanFile,
  validateRubricOrTemplatePayload,
  createPayloadErrorResponse,
} from '@/lib/payload-limits';
import { validateStudentExamUpload, validateReferenceUpload } from '@/lib/document-validation';
import { isClassArchived } from '@/lib/class-archive';
import crypto from 'crypto';

// Allowed student exam MIME types and safe file extensions
const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function resolveSafeFileFormat(file: File): { mimeType: string; ext: string } | null {
  const mime = (file.type || '').toLowerCase();
  if (ALLOWED_MIME_TO_EXT[mime]) {
    return { mimeType: mime === 'image/jpg' ? 'image/jpeg' : mime, ext: ALLOWED_MIME_TO_EXT[mime] };
  }
  const rawExt = (file.name.split('.').pop() || '').toLowerCase();
  if (rawExt === 'pdf') return { mimeType: 'application/pdf', ext: 'pdf' };
  if (rawExt === 'png') return { mimeType: 'image/png', ext: 'png' };
  if (rawExt === 'webp') return { mimeType: 'image/webp', ext: 'webp' };
  if (rawExt === 'jpg' || rawExt === 'jpeg') return { mimeType: 'image/jpeg', ext: 'jpg' };
  return null;
}

function parseStoredMaterial(rawText?: string | null): ReferenceMaterialInput | null {
  if (!rawText) return null;
  return parseSerializedReferenceMaterial(rawText) || rawText;
}

export async function POST(request: Request) {
  try {
    // 1. Authenticate user
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }
    const unverifiedResponse = await requireVerifiedEmailForApi(session.userId, request);
    if (unverifiedResponse) return unverifiedResponse;

    // Rate limiting for AI endpoints
    const rateLimit = await checkAiRateLimit({
      identifier: session.userId,
      scope: 'teacher',
      endpoint: 'correct',
    });
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit);
    }

    const formData = await request.formData();
    const studentId = formData.get('studentId') as string | null; // Can be null for AI Auto-matching
    const classId = formData.get('classId') as string | null;
    const examId = formData.get('examId') as string | null; // For existing exams
    const overwrite = formData.get('overwrite') === 'true';
    const overrideDocumentType =
      formData.get('overrideDocumentType') === 'true' || formData.get('override') === 'true';

    // For new exams
    const examTitle = formData.get('examTitle') as string | null;
    const examSubject = formData.get('examSubject') as string | null;
    const maxPointsRaw = formData.get('maxPoints') as string | null;
    const rubric = formData.get('rubric') as File | string | null;
    const examTemplate = formData.get('examTemplate') as File | string | null;
    const gradingNotes = formData.get('gradingNotes') as string | null;
    const gradingFormula = (formData.get('gradingFormula') as string | null) || 'LINEAR_60';
    const gradeRounding = (formData.get('gradeRounding') as string | null) || '0.1';

    // Core parameters
    const studentExam = formData.get('studentExam') as File | null;
    const model = DEFAULT_GEMINI_MODEL;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error: 'Gemini API-Schlüssel ist auf dem Server nicht konfiguriert.',
        },
        { status: 500 }
      );
    }

    if (!classId) {
      return NextResponse.json({ error: 'Klasse muss ausgewählt sein.' }, { status: 400 });
    }

    if (await isClassArchived(classId)) {
      return NextResponse.json(
        {
          error:
            'Archivierte Klassen sind schreibgeschützt. Es können keine neuen Scans oder Korrekturen eingereicht werden.',
        },
        { status: 400 }
      );
    }

    if (!studentExam) {
      return NextResponse.json(
        { error: 'Es wurde keine Schülerarbeit hochgeladen.' },
        { status: 400 }
      );
    }

    // Payload size validations: prevent excessive Gemini costs and storage bloat
    const scanValidation = validateScanFile(studentExam, 'Die Schülerarbeit');
    if (!scanValidation.valid) {
      return createPayloadErrorResponse(scanValidation);
    }

    if (rubric) {
      const rubricValidation = validateRubricOrTemplatePayload(rubric, 'Die Musterlösung');
      if (!rubricValidation.valid) {
        return createPayloadErrorResponse(rubricValidation);
      }
    }

    if (examTemplate) {
      const templateValidation = validateRubricOrTemplatePayload(
        examTemplate,
        'Die Prüfungsvorlage'
      );
      if (!templateValidation.valid) {
        return createPayloadErrorResponse(templateValidation);
      }
    }

    const safeFormat = resolveSafeFileFormat(studentExam);
    if (!safeFormat) {
      return NextResponse.json(
        { error: 'Ungültiges Dateiformat. Erlaubt sind PDF, JPG, PNG und WebP.' },
        { status: 400 }
      );
    }

    // Content and document type validations (reject invalid/empty/non-exam before storage and model calls)
    // Phase 1: Fast deterministic checks on all files first (zero LLM calls)
    const studentFastValidation = await validateStudentExamUpload(
      studentExam,
      'Die Schülerarbeit',
      { overrideDocumentType, teacherId: session.userId, skipAiClassification: true }
    );
    if (!studentFastValidation.valid) {
      return NextResponse.json(
        {
          error: studentFastValidation.error,
          reason: studentFastValidation.reason,
          canOverride: studentFastValidation.canOverride,
          classification: studentFastValidation.classification,
        },
        { status: studentFastValidation.status || 400 }
      );
    }

    if (rubric) {
      const rubricFastValidation = await validateReferenceUpload(rubric, 'Die Musterlösung', {
        overrideDocumentType,
        teacherId: session.userId,
        skipAiClassification: true,
      });
      if (!rubricFastValidation.valid) {
        return NextResponse.json(
          {
            error: rubricFastValidation.error,
            reason: rubricFastValidation.reason,
            canOverride: rubricFastValidation.canOverride,
            classification: rubricFastValidation.classification,
          },
          { status: rubricFastValidation.status || 400 }
        );
      }
    }

    if (examTemplate) {
      const templateFastValidation = await validateReferenceUpload(
        examTemplate,
        'Die Prüfungsvorlage',
        { overrideDocumentType, teacherId: session.userId, skipAiClassification: true }
      );
      if (!templateFastValidation.valid) {
        return NextResponse.json(
          {
            error: templateFastValidation.error,
            reason: templateFastValidation.reason,
            canOverride: templateFastValidation.canOverride,
            classification: templateFastValidation.classification,
          },
          { status: templateFastValidation.status || 400 }
        );
      }
    }

    // Phase 2: AI document-type classification (when not overridden and API key is present)
    const studentDocValidation = await validateStudentExamUpload(studentExam, 'Die Schülerarbeit', {
      overrideDocumentType,
      teacherId: session.userId,
    });
    if (!studentDocValidation.valid) {
      return NextResponse.json(
        {
          error: studentDocValidation.error,
          reason: studentDocValidation.reason,
          canOverride: studentDocValidation.canOverride,
          classification: studentDocValidation.classification,
        },
        { status: studentDocValidation.status || 400 }
      );
    }

    if (rubric) {
      const rubricDocValidation = await validateReferenceUpload(rubric, 'Die Musterlösung', {
        overrideDocumentType,
        teacherId: session.userId,
      });
      if (!rubricDocValidation.valid) {
        return NextResponse.json(
          {
            error: rubricDocValidation.error,
            reason: rubricDocValidation.reason,
            canOverride: rubricDocValidation.canOverride,
            classification: rubricDocValidation.classification,
          },
          { status: rubricDocValidation.status || 400 }
        );
      }
    }

    if (examTemplate) {
      const templateDocValidation = await validateReferenceUpload(
        examTemplate,
        'Die Prüfungsvorlage',
        { overrideDocumentType, teacherId: session.userId }
      );
      if (!templateDocValidation.valid) {
        return NextResponse.json(
          {
            error: templateDocValidation.error,
            reason: templateDocValidation.reason,
            canOverride: templateDocValidation.canOverride,
            classification: templateDocValidation.classification,
          },
          { status: templateDocValidation.status || 400 }
        );
      }
    }

    // Verify class exists and belongs to the authenticated teacher
    const classRecord = await db.class.findFirst({
      where: { id: classId, teacherId: session.userId },
    });
    if (!classRecord) {
      return NextResponse.json({ error: 'Keine Berechtigung für diese Klasse.' }, { status: 403 });
    }

    // Pre-flight check: If studentId and examId are selected
    if (examId && studentId) {
      const existingSubmission = await db.submission.findUnique({
        where: {
          examId_studentId: {
            examId,
            studentId,
          },
        },
      });

      if (existingSubmission && !overwrite) {
        return NextResponse.json(
          {
            error: 'Für diesen Schüler existiert bereits eine Korrektur für diese Prüfung.',
            exists: true,
          },
          { status: 409 }
        );
      }
    }

    // 2. Fetch/resolve the rubric data from DB or parameters
    let rubricParam: ReferenceMaterialInput = '';
    let rubricTextString = '';

    let finalExamId = examId;

    if (examId) {
      // Fetch existing exam details and verify it belongs to the target class
      const existingExam = await db.exam.findFirst({
        where: { id: examId, classId },
      });
      if (!existingExam) {
        return NextResponse.json(
          { error: 'Ausgewählte Prüfung existiert nicht in dieser Klasse.' },
          { status: 404 }
        );
      }
      if (!isExamApproved(existingExam)) {
        return NextResponse.json(
          {
            error:
              'Die Prüfung ist ein noch ungeprüfter Entwurf und muss vor der Korrektur freigegeben werden.',
          },
          { status: 400 }
        );
      }
      const parsedRubric = parseSerializedReferenceMaterial(existingExam.rubricText);
      if (parsedRubric) {
        rubricParam = parsedRubric;
        const isPdf = !Array.isArray(parsedRubric) && parsedRubric.mimeType === 'application/pdf';
        rubricTextString = isPdf
          ? 'Musterlösung als PDF hinterlegt'
          : 'Musterlösung als Bild hinterlegt';
      } else {
        rubricParam = existingExam.rubricText;
        rubricTextString = existingExam.rubricText;
      }
    } else {
      // Process uploaded new rubric or find existing one dynamically to avoid double creations in batch
      if (!examTitle || !examSubject || !rubric) {
        return NextResponse.json(
          {
            error:
              'Prüfungstitel, Fach und Musterlösung müssen für eine neue Prüfung angegeben werden.',
          },
          { status: 400 }
        );
      }

      if (typeof rubric === 'string') {
        rubricParam = parseSerializedReferenceMaterial(rubric) || rubric;
        rubricTextString = rubric;
      } else {
        const mimeType = rubric.type || '';
        const rubricBytes = await rubric.arrayBuffer();

        if (mimeType.startsWith('image/') || mimeType === 'application/pdf') {
          const base64Data = Buffer.from(rubricBytes).toString('base64');
          rubricParam = { mimeType, data: base64Data };
          rubricTextString = JSON.stringify(rubricParam);
        } else {
          rubricTextString = Buffer.from(rubricBytes).toString('utf-8');
          rubricParam = rubricTextString;
        }
      }

      // Check if an exam with this title already exists in this class (for bulk uploader concurrency)
      const existingExam = await db.exam.findFirst({
        where: { title: examTitle, classId },
      });

      let examTemplateString: string | null = null;
      if (examTemplate) {
        if (typeof examTemplate === 'string') {
          examTemplateString = examTemplate.trim() || null;
        } else {
          const tplMime = examTemplate.type || '';
          const tplBytes = await examTemplate.arrayBuffer();
          if (tplMime.startsWith('image/') || tplMime === 'application/pdf') {
            examTemplateString = JSON.stringify({
              mimeType: tplMime,
              data: Buffer.from(tplBytes).toString('base64'),
            });
          } else {
            examTemplateString = Buffer.from(tplBytes).toString('utf-8');
          }
        }
      }

      const parsedMaxPoints = maxPointsRaw ? Number(maxPointsRaw) : 0;
      const initialMaxPoints =
        Number.isFinite(parsedMaxPoints) && parsedMaxPoints > 0 ? parsedMaxPoints : 20;

      if (existingExam) {
        finalExamId = existingExam.id;
        if (existingExam.maxPoints <= 0 && initialMaxPoints > 0) {
          await db.exam.update({
            where: { id: existingExam.id },
            data: { maxPoints: initialMaxPoints },
          });
        }
      } else {
        const examRecord = await db.exam.create({
          data: {
            title: examTitle,
            subject: examSubject,
            rubricText: rubricTextString,
            examTemplateText: examTemplateString,
            gradingNotes: gradingNotes?.trim() || null,
            gradingFormula,
            gradeRounding,
            maxPoints: initialMaxPoints,
            classId: classId,
          },
        });
        finalExamId = examRecord.id;
      }
    }

    if (!finalExamId) {
      return NextResponse.json({ error: 'Prüfungszuordnung fehlgeschlagen.' }, { status: 500 });
    }

    // 3. Process student exam to base64 for Gemini
    const studentBytes = await studentExam.arrayBuffer();
    const studentBase64 = Buffer.from(studentBytes).toString('base64');

    // 4. Save the exam sheet document via the configured durable storage adapter
    const submissionId = crypto.randomUUID();
    const fileName = `${submissionId}.${safeFormat.ext}`;
    const storage = getStorageAdapter();
    const savedFilePath = await storage.write(
      fileName,
      Buffer.from(studentBytes),
      safeFormat.mimeType
    );

    // Fetch exam name synchronously for decoupled logging
    const examRecordSync = await db.exam.findUnique({ where: { id: finalExamId } });

    const resolvedClassName = classRecord.name || 'Unbekannte Klasse';
    const resolvedExamTitle = examRecordSync?.title || 'Unbekannte Prüfung';

    let resolvedStudentName = 'Automatische Zuordnung';
    if (studentId) {
      const studentRecord = await db.student.findFirst({ where: { id: studentId, classId } });
      if (studentRecord) {
        resolvedStudentName = studentRecord.name;
      }
    }

    // 5. Create PENDING placeholder Submission record in the DB
    const submission = await db.submission.create({
      data: {
        id: submissionId,
        examId: finalExamId,
        studentId: null, // Always null initially to avoid unique constraint violations
        targetStudentId: studentId || null, // Track targeted student if provided
        status: 'PENDING',
        earnedPoints: 0.0,
        gradeRaw: 1.0,
        gradeRounded: '1.0',
        strengths: [],
        weaknesses: [],
        helpfulTip: null,
        exerciseRecommendation: null,
        studentExamUrl: savedFilePath,
      },
    });

    // Create decoupling CorrectionLog record synchronously
    const logRecord = await db.correctionLog.create({
      data: {
        submissionId: submissionId,
        teacherId: session.userId,
        className: resolvedClassName,
        examTitle: resolvedExamTitle,
        studentName: resolvedStudentName,
        modelUsed: model,
        status: 'PENDING',
        actionType: overwrite ? 'ERSETZT' : 'ERSTELLT',
      },
    });

    await invalidateSubmissionCache(session.userId, {
      submissionId: submission.id,
      examId: finalExamId,
      classId: classId,
      studentId: studentId || undefined,
    });
    await invalidateLogsCache(session.userId);

    // 6. Schedule heavy live Gemini OCR and correction in the background using stable Next.js after()
    after(async () => {
      const startTime = Date.now();
      let finalStudentName = resolvedStudentName;
      let resolvedMatchedStudentId: string | null = studentId || null;
      let resolvedExtractedStudentName: string | null = null;
      let resolvedSuggestedStudentId: string | null = null;

      try {
        // 1. Update status to PROCESSING
        await db.submission.update({
          where: { id: submissionId },
          data: { status: 'PROCESSING' },
        });

        await db.correctionLog.update({
          where: { id: logRecord.id },
          data: { status: 'PROCESSING' },
        });

        // 2. Fetch the predefined tasks of this exam if available
        const examRecord = await db.exam.findUnique({
          where: { id: finalExamId },
          include: { tasks: true },
        });

        const predefinedTasks =
          examRecord?.tasks && examRecord.tasks.length > 0
            ? examRecord.tasks.map((t) => ({
                taskId: t.taskId,
                title: t.title,
                maxPoints: t.maxPoints,
              }))
            : undefined;

        // 3. Run live Gemini OCR or reuse result from Content-Hash LLM Cache
        const examTemplateParam = parseStoredMaterial(examRecord?.examTemplateText);
        const promptVersion = LLM_PROMPT_VERSIONS.grading;
        const studentPages = [{ mimeType: safeFormat.mimeType, data: studentBase64 }];
        const { cacheKey, hash: gradingHash } = computeGradingCacheKey({
          teacherId: session.userId,
          modelName: model,
          promptVersion,
          studentPages,
          rubric: rubricParam,
          examTemplate: examTemplateParam,
          gradingNotes: examRecord?.gradingNotes,
          predefinedTasks,
          subject: examRecord?.subject,
        });

        let result: ExamCorrectionResult;
        let isReused = false;
        let modelUsedForLog = model;

        const cached = !overwrite ? await getCachedLlmResult<ExamCorrectionResult>(cacheKey) : null;
        if (cached) {
          result = enforceStepFeedbackConsistency(
            auditAndEnforceCorrectionSecurity(cached.result, {
              studentText: cached.result.aufgaben?.map((t) => t.schuelerAntwort).join('\n'),
              rubricText: rubricParam,
              examTemplateText: examTemplateParam || undefined,
              gradingNotes: examRecord?.gradingNotes || undefined,
              referenzTranskript: cached.result.referenzTranskript || undefined,
            })
          );
          isReused = true;
          modelUsedForLog = cached.model;
        } else {
          result = await runLiveGeminiCorrection(
            studentBase64,
            rubricParam,
            model,
            apiKey,
            safeFormat.mimeType,
            predefinedTasks,
            examRecord?.subject,
            {
              examTemplate: examTemplateParam,
              gradingNotes: examRecord?.gradingNotes,
            }
          );
          await setCachedGradingResult({
            teacherId: session.userId,
            modelName: model,
            promptVersion,
            studentPages,
            rubric: rubricParam,
            examTemplate: examTemplateParam,
            gradingNotes: examRecord?.gradingNotes,
            predefinedTasks,
            subject: examRecord?.subject,
            result,
          });
        }

        // 4. Perform AI Auto-Matching with explicit confidence calibration if studentId was not provided synchronously
        let matchedStudentId = studentId || null;
        let suggestedStudentId: string | null = null;
        let isStudentMatchUncertain = false;
        const extractedStudentName = (result.schuelerName || '').trim() || null;
        let classStudentsList: { id: string; name: string }[] = [];

        if (!matchedStudentId) {
          classStudentsList = await db.student.findMany({
            where: { classId },
          });
          const matchResult = matchStudentByNameWithConfidence(
            extractedStudentName || '',
            classStudentsList,
            Boolean(result.istNameUnsicher)
          );
          suggestedStudentId = matchResult.suggestedStudentId;
          // Keine Auto-Zuordnung ohne explizite Bestätigung durch die Lehrperson:
          // Vorschläge (suggestedStudentId) werden vorbefüllt, aber erst bei Bestätigung übernommen.
          matchedStudentId = null;
          isStudentMatchUncertain = true;
          finalStudentName = extractedStudentName
            ? `${extractedStudentName} (Nicht zugeordnet)`
            : 'Nicht zugeordnet';
        }

        resolvedMatchedStudentId = matchedStudentId;
        resolvedExtractedStudentName = extractedStudentName;
        resolvedSuggestedStudentId = suggestedStudentId;

        // 5. Build deterministic task & step corrections and compute server-authoritative points
        const taskCorrectionsData: {
          id: string;
          submissionId: string;
          taskId: string;
          title: string;
          studentAnswer: string;
          erzieltePunkte: number;
          maximalPunkte: number;
          status: 'Korrekt' | 'Folgefehler' | 'Fehler';
          lehrerKommentar: string;
          orderIndex: number;
        }[] = [];
        const stepCorrectionsData: {
          id: string;
          taskCorrectionId: string;
          schrittIndex: number;
          schrittText: string;
          istKorrekt: boolean;
          fehlerTyp: 'KeinFehler' | 'Rechenfehler' | 'Folgefehler' | 'SonstigerFehler';
          erreichtePunkte: number;
          maximalPunkte: number;
          begruendung: string;
          istUnsicher: boolean;
          unsicherheitsGrund: string | null;
        }[] = [];

        let serverTotalEarnedPoints = 0;
        let serverTotalMaxPoints = 0;

        for (let tIdx = 0; tIdx < result.aufgaben.length; tIdx++) {
          const task = result.aufgaben[tIdx];

          let taskStatus: 'Korrekt' | 'Folgefehler' | 'Fehler' = 'Korrekt';
          if (task.status === 'Folgefehler') taskStatus = 'Folgefehler';
          else if (task.status === 'Fehler') taskStatus = 'Fehler';

          const taskCorrectionId = crypto.randomUUID();

          let calculatedTaskPoints = 0;
          const hasSteps = Array.isArray(task.schritte) && task.schritte.length > 0;

          if (hasSteps) {
            for (const rawStep of task.schritte) {
              const step = normalizeStepFeedbackConsistency(rawStep);
              let errorType: 'KeinFehler' | 'Rechenfehler' | 'Folgefehler' | 'SonstigerFehler' =
                'KeinFehler';
              if (step.fehlerTyp === 'Rechenfehler') errorType = 'Rechenfehler';
              else if (step.fehlerTyp === 'Folgefehler') errorType = 'Folgefehler';
              else if (step.fehlerTyp === 'SonstigerFehler') errorType = 'SonstigerFehler';

              const clampedStepMax = Math.max(0, Number(step.maximalPunkte || 0));
              const clampedStepEarned = Math.max(
                0,
                Math.min(clampedStepMax, Number(step.erreichtePunkte || 0))
              );

              calculatedTaskPoints += clampedStepEarned;

              const isStepUncertain = Boolean(step.istUnsicher);
              stepCorrectionsData.push({
                id: crypto.randomUUID(),
                taskCorrectionId: taskCorrectionId,
                schrittIndex: step.schrittIndex,
                schrittText: step.schrittText,
                istKorrekt: step.istKorrekt,
                fehlerTyp: errorType,
                erreichtePunkte: clampedStepEarned,
                maximalPunkte: clampedStepMax,
                begruendung: step.begruendung || '',
                istUnsicher: isStepUncertain,
                unsicherheitsGrund: isStepUncertain
                  ? step.unsicherheitsGrund || 'Bitte diesen Teilschritt manuell überprüfen.'
                  : null,
              });
            }
          }

          const clampedTaskMax = Math.max(0, Number(task.maximalPunkte || 0));
          const finalTaskPoints = hasSteps
            ? Math.min(clampedTaskMax, Math.round(calculatedTaskPoints * 10) / 10)
            : Math.max(0, Math.min(clampedTaskMax, Number(task.erzieltePunkte || 0)));

          serverTotalEarnedPoints =
            Math.round((serverTotalEarnedPoints + finalTaskPoints) * 10) / 10;
          serverTotalMaxPoints = Math.round((serverTotalMaxPoints + clampedTaskMax) * 10) / 10;

          taskCorrectionsData.push({
            id: taskCorrectionId,
            submissionId: submissionId,
            taskId: task.aufgabeId,
            title: task.titel,
            studentAnswer: task.schuelerAntwort,
            erzieltePunkte: finalTaskPoints,
            maximalPunkte: clampedTaskMax,
            status: taskStatus,
            lehrerKommentar: task.lehrerKommentar || '',
            orderIndex: tIdx,
          });
        }

        // Update Exam maxPoints based on the resolved points of the first finished grading
        // ONLY if the exam has NO predefined tasks yet and NO explicit teacher maxPoints (>0)!
        const hasPredefinedTasks = Boolean(
          examRecord && examRecord.tasks && examRecord.tasks.length > 0
        );
        const resolvedMaxPoints =
          serverTotalMaxPoints > 0 ? serverTotalMaxPoints : result.gesamtmaximalPunkte;

        const { effectiveMaxPoints, shouldUpdateExamMaxPoints } = resolveEffectiveGradingMaxPoints({
          teacherMaxPoints: examRecord?.maxPoints,
          resolvedMaxPoints,
          hasPredefinedTasks,
        });

        if (examRecord && shouldUpdateExamMaxPoints && effectiveMaxPoints > 0) {
          await db.exam.update({
            where: { id: finalExamId },
            data: { maxPoints: effectiveMaxPoints },
          });
        }

        const rawGrade = calculateRawSwissGrade(
          serverTotalEarnedPoints,
          effectiveMaxPoints,
          examRecord?.gradingFormula || 'LINEAR_60'
        );
        const roundedGrade = calculateSwissGrade(
          serverTotalEarnedPoints,
          effectiveMaxPoints,
          examRecord?.gradingFormula || 'LINEAR_60',
          examRecord?.gradeRounding || '0.1'
        );

        // 6. Execute transaction to write AI grading results
        await db.$transaction(async (tx) => {
          const normName = (s?: string | null) => (s || '').trim().toLowerCase();
          const currentNormName = normName(extractedStudentName);
          const candidateStudentId = matchedStudentId || suggestedStudentId;

          const existingExamSubmissions =
            typeof tx.submission.findMany === 'function'
              ? await tx.submission.findMany({
                  where: {
                    examId: finalExamId,
                    id: { not: submissionId },
                  },
                  include: { student: true },
                  orderBy: { createdAt: 'desc' },
                })
              : [];

          let existingDuplicate: {
            id: string;
            studentId?: string | null;
            targetStudentId?: string | null;
            suggestedStudentId?: string | null;
            extractedStudentName?: string | null;
            earnedPoints?: number;
            gradeRounded?: string;
            status?: string;
            student?: { id: string; name: string } | null;
          } | null = null;

          if (candidateStudentId) {
            existingDuplicate =
              existingExamSubmissions.find(
                (s) => s.studentId === candidateStudentId && s.status === 'COMPLETED'
              ) ||
              existingExamSubmissions.find((s) => s.studentId === candidateStudentId) ||
              null;

            if (!existingDuplicate && typeof tx.submission.findFirst === 'function') {
              existingDuplicate = await tx.submission.findFirst({
                where: {
                  examId: finalExamId,
                  studentId: candidateStudentId,
                  id: { not: submissionId },
                },
              });
            }
          }

          if (
            !existingDuplicate &&
            currentNormName &&
            currentNormName !== 'unbekannt' &&
            currentNormName !== 'nicht lesbar' &&
            currentNormName !== 'kein name'
          ) {
            existingDuplicate =
              existingExamSubmissions.find(
                (s) =>
                  s.status === 'COMPLETED' &&
                  s.studentId !== null &&
                  normName(s.extractedStudentName) === currentNormName
              ) ||
              existingExamSubmissions.find(
                (s) =>
                  s.status === 'COMPLETED' && normName(s.extractedStudentName) === currentNormName
              ) ||
              null;
          }

          if (!existingDuplicate && isReused) {
            existingDuplicate =
              existingExamSubmissions.find(
                (s) =>
                  s.status === 'COMPLETED' &&
                  s.studentId !== null &&
                  Math.abs((s.earnedPoints ?? 0) - serverTotalEarnedPoints) < 0.01 &&
                  normName(s.extractedStudentName) === currentNormName
              ) ||
              existingExamSubmissions.find(
                (s) =>
                  s.status === 'COMPLETED' &&
                  Math.abs((s.earnedPoints ?? 0) - serverTotalEarnedPoints) < 0.01 &&
                  normName(s.extractedStudentName) === currentNormName
              ) ||
              null;
          }

          if (existingDuplicate) {
            const effectiveStudentId =
              existingDuplicate.studentId ||
              candidateStudentId ||
              existingDuplicate.targetStudentId ||
              existingDuplicate.suggestedStudentId ||
              null;
            const matchedRosterStudent = effectiveStudentId
              ? classStudentsList.find((s) => s.id === effectiveStudentId)
              : undefined;
            const resolvedDupStudentName =
              existingDuplicate.student?.name || matchedRosterStudent?.name || null;

            if (effectiveStudentId) {
              resolvedMatchedStudentId = effectiveStudentId;
              resolvedSuggestedStudentId = effectiveStudentId;
            }
            if (resolvedDupStudentName) {
              finalStudentName = resolvedDupStudentName;
            }

            if (overwrite) {
              if (effectiveStudentId) {
                matchedStudentId = effectiveStudentId;
                suggestedStudentId = effectiveStudentId;
                isStudentMatchUncertain = false;
              }
              const duplicatesToDelete =
                existingExamSubmissions.length > 0
                  ? existingExamSubmissions.filter((other) => {
                      if (other.id === existingDuplicate!.id) return true;
                      if (effectiveStudentId && other.studentId === effectiveStudentId) return true;
                      if (
                        effectiveStudentId &&
                        !other.studentId &&
                        (other.targetStudentId === effectiveStudentId ||
                          other.suggestedStudentId === effectiveStudentId)
                      ) {
                        return true;
                      }
                      if (
                        !other.studentId &&
                        currentNormName &&
                        normName(other.extractedStudentName) === currentNormName
                      ) {
                        return true;
                      }
                      if (
                        !other.studentId &&
                        other.status === 'COMPLETED' &&
                        Math.abs((other.earnedPoints ?? 0) - serverTotalEarnedPoints) < 0.01 &&
                        normName(other.extractedStudentName) === currentNormName
                      ) {
                        return true;
                      }
                      return false;
                    })
                  : [existingDuplicate];

              const dupIds = duplicatesToDelete.map((d) => d.id);
              if (typeof tx.correctionLog?.updateMany === 'function' && dupIds.length > 0) {
                await tx.correctionLog.updateMany({
                  where: { submissionId: { in: dupIds } },
                  data: { submissionId: null },
                });
              }
              if (typeof tx.submission.deleteMany === 'function' && dupIds.length > 1) {
                await tx.submission.deleteMany({
                  where: { id: { in: dupIds } },
                });
              } else {
                for (const dupId of dupIds) {
                  await tx.submission.delete({
                    where: { id: dupId },
                  });
                }
              }
            } else {
              const duplicateStudentLabel =
                resolvedDupStudentName ||
                (finalStudentName &&
                finalStudentName !== 'Automatische Zuordnung' &&
                !finalStudentName.includes('(Nicht zugeordnet)')
                  ? finalStudentName
                  : result.schuelerName || 'diese/n Schüler/in');
              throw new Error(
                `Für Schüler/in "${duplicateStudentLabel}" existiert bereits eine Korrektur. Klicke auf 'Korrektur ersetzen', um sie zu überschreiben.`
              );
            }
          }

          await tx.submission.update({
            where: { id: submissionId },
            data: {
              studentId: matchedStudentId, // Can be null if unmatched (unassigned)
              targetStudentId: null, // Clear the temporary target field on completion
              extractedStudentName,
              suggestedStudentId,
              isStudentMatchUncertain,
              status: 'COMPLETED',
              earnedPoints: serverTotalEarnedPoints,
              gradeRaw: rawGrade,
              gradeRounded: roundedGrade,
              strengths: result.schuelerFeedback.staerken,
              weaknesses: result.schuelerFeedback.schwaechen,
              helpfulTip: result.schuelerFeedback.hilfreicherTipp,
              exerciseRecommendation: result.schuelerFeedback.uebungsEmpfehlung,
            },
          });

          if (taskCorrectionsData.length > 0) {
            await tx.taskCorrection.createMany({
              data: taskCorrectionsData,
            });
          }

          if (stepCorrectionsData.length > 0) {
            await tx.stepCorrection.createMany({
              data: stepCorrectionsData,
            });
          }
        });

        // 7. Update decouple CorrectionLog to COMPLETED
        const durationMs = Date.now() - startTime;
        await db.correctionLog.update({
          where: { id: logRecord.id },
          data: {
            status: 'COMPLETED',
            studentName: finalStudentName,
            durationMs,
            modelUsed: modelUsedForLog,
            actionType: isReused ? 'WIEDERVERWENDET' : overwrite ? 'ERSETZT' : 'ERSTELLT',
          },
        });

        await invalidateSubmissionCache(session.userId, {
          submissionId: submission.id,
          examId: finalExamId,
          classId: classId,
          studentId: matchedStudentId || studentId || undefined,
        });
        await invalidateLogsCache(session.userId);
      } catch (error) {
        const durationMs = Date.now() - startTime;

        // Check if this error is due to the submission being deleted (e.g. cancelled by the user)
        const isCancelled =
          error && typeof error === 'object' && 'code' in error && error.code === 'P2025';

        if (isCancelled) {
          console.info(
            `Background grading for submission ${submissionId} was cancelled by the user (record deleted).`
          );

          // Update decoupled CorrectionLog to CANCELLED
          try {
            await db.correctionLog.update({
              where: { id: logRecord.id },
              data: {
                status: 'CANCELLED',
                durationMs,
              },
            });
          } catch (logErr) {
            console.error('Failed to set CANCELLED state on CorrectionLog:', logErr);
          }
          await invalidateSubmissionCache(session.userId, {
            submissionId: submission.id,
            examId: finalExamId,
            classId: classId,
          });
          await invalidateLogsCache(session.userId);
          return;
        }

        const categorized = categorizeGeminiError(error);
        if (categorized.category === 'DUPLICATE_SUBMISSION') {
          console.warn(
            `Background grading duplicate detected for submission ${submissionId} [Category: ${categorized.category} | Details: ${categorized.technicalDetails}]`
          );
        } else {
          console.error(
            `Background grading error for submission ${submissionId} [Category: ${categorized.category} | Details: ${categorized.technicalDetails}]:`,
            error
          );
        }

        // Update decoupled CorrectionLog to FAILED with monitoring category and upstream error details
        const logDetail = categorized.technicalDetails
          ? ` (Details: ${categorized.technicalDetails.slice(0, 300)})`
          : '';
        try {
          await db.correctionLog.update({
            where: { id: logRecord.id },
            data: {
              status: 'FAILED',
              studentName: finalStudentName,
              durationMs,
              errorMessage: `[${categorized.category}] ${categorized.userMessage}${logDetail}`,
            },
          });
        } catch (logErr) {
          console.error('Failed to set FAILED state on CorrectionLog:', logErr);
        }

        // Mark as FAILED in DB and store teacher-facing error details
        try {
          await db.submission.update({
            where: { id: submissionId },
            data: {
              status: 'FAILED',
              errorMessage: categorized.userMessage,
              ...(resolvedMatchedStudentId ? { targetStudentId: resolvedMatchedStudentId } : {}),
              ...(resolvedExtractedStudentName
                ? { extractedStudentName: resolvedExtractedStudentName }
                : {}),
              ...(resolvedSuggestedStudentId
                ? { suggestedStudentId: resolvedSuggestedStudentId }
                : {}),
            },
          });

          if (
            categorized.category === 'DUPLICATE_SUBMISSION' &&
            typeof db.submission.findMany === 'function'
          ) {
            const olderFailedDuplicates = await db.submission.findMany({
              where: {
                examId: finalExamId,
                id: { not: submissionId },
                status: 'FAILED',
                errorMessage: { contains: 'bereits eine Korrektur' },
              },
            });
            const normName = (s?: string | null) => (s || '').trim().toLowerCase();
            const staleIds = olderFailedDuplicates
              .filter((old) => {
                if (
                  resolvedMatchedStudentId &&
                  (old.targetStudentId === resolvedMatchedStudentId ||
                    old.suggestedStudentId === resolvedMatchedStudentId)
                ) {
                  return true;
                }
                if (
                  resolvedExtractedStudentName &&
                  normName(old.extractedStudentName) === normName(resolvedExtractedStudentName)
                ) {
                  return true;
                }
                return false;
              })
              .map((old) => old.id);

            if (staleIds.length > 0) {
              if (typeof db.correctionLog?.updateMany === 'function') {
                await db.correctionLog.updateMany({
                  where: { submissionId: { in: staleIds } },
                  data: { submissionId: null },
                });
              }
              if (typeof db.submission.deleteMany === 'function') {
                await db.submission.deleteMany({
                  where: { id: { in: staleIds } },
                });
              }
            }
          }
        } catch (dbErr) {
          const isDbErrCancelled =
            dbErr && typeof dbErr === 'object' && 'code' in dbErr && dbErr.code === 'P2025';

          if (!isDbErrCancelled) {
            console.error(`Failed to set FAILED state on submission ${submissionId}:`, dbErr);
          } else {
            console.info(
              `Failed to set FAILED state: submission ${submissionId} was already deleted (cancelled).`
            );
          }
        }

        await invalidateSubmissionCache(session.userId, {
          submissionId: submission.id,
          examId: finalExamId,
          classId: classId,
          studentId: resolvedMatchedStudentId || studentId || undefined,
        });
        await invalidateLogsCache(session.userId);
      }
    });

    // 7. Instantly return PENDING submission details to the client
    return NextResponse.json({
      success: true,
      submissionId: submission.id,
      examId: finalExamId,
      status: 'PENDING',
    });
  } catch (error) {
    console.error('Error in API /correct route (sync part):', error);
    return NextResponse.json(
      { error: 'Upload fehlgeschlagen. Bitte versuchen Sie es später erneut.' },
      { status: 500 }
    );
  }
}
