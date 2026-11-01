import { NextResponse, after } from 'next/server';
import { db } from '@/lib/db';
import { verifyMobileRelayToken } from '@/lib/jwt';
import {
  DEFAULT_GEMINI_MODEL,
  identifyExamAndStudentFromScan,
  runLiveGeminiCorrection,
  categorizeGeminiError,
  type ExamCorrectionResult,
} from '@/lib/gemini';
import {
  calculateRawSwissGrade,
  calculateSwissGrade,
  matchStudentByNameWithConfidence,
  parseStudentExamUrls,
  resolveEffectiveGradingMaxPoints,
} from '@/lib/grading';
import { saveScannedRelayDocument } from '@/lib/relay-store';
import { getStorageAdapter } from '@/lib/storage';
import { invalidateExamCache, invalidateSubmissionCache, invalidateLogsCache } from '@/lib/cache';
import {
  computeGradingHash,
  buildLlmCacheKey,
  getCachedLlmResult,
  setCachedLlmResult,
  LLM_PROMPT_VERSIONS,
} from '@/lib/llm-cache';
import crypto from 'crypto';
import { isExamApproved } from '@/lib/exam-meta';
import { checkAiRateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { validateRelayPages, createPayloadErrorResponse } from '@/lib/payload-limits';
import { deduplicatePayloadsByHash } from '@/lib/relay-dedup';
import { validateDocument } from '@/lib/document-validation';

function parseStoredMaterial(
  rawText?: string | null
): string | { mimeType: string; data: string } | null {
  if (!rawText) return null;
  if (rawText.startsWith('{"mimeType":')) {
    try {
      return JSON.parse(rawText);
    } catch {
      return rawText;
    }
  }
  return rawText;
}

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

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const token = formData.get('token') as string | null;
    const explicitExamId = formData.get('examId') as string | null;
    const explicitStudentId = formData.get('studentId') as string | null;
    const explicitSubmissionId = formData.get('submissionId') as string | null;
    const explicitTargetMode = formData.get('targetMode') as string | null;
    const rawPages = formData.getAll('pages').filter((f): f is File => f instanceof File);

    const payload = await verifyMobileRelayToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: 'QR-Sitzung abgelaufen oder ungültig. Bitte neuen QR-Code scannen.' },
        { status: 401 }
      );
    }

    // Rate limiting for AI endpoints via relay token / teacher
    const rateLimit = await checkAiRateLimit({
      identifier: payload.sessionId || payload.teacherId,
      scope: 'relay',
      endpoint: 'mobile-relay-upload',
    });
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit);
    }

    if (rawPages.length === 0) {
      return NextResponse.json(
        { error: 'Bitte mindestens eine Seite fotografieren.' },
        { status: 400 }
      );
    }

    // Size and page count limit check: reject before memory-heavy base64 encoding and LLM calls
    const pagesValidation = validateRelayPages(rawPages);
    if (!pagesValidation.valid) {
      return createPayloadErrorResponse(pagesValidation);
    }

    const effectiveTargetMode = explicitTargetMode || payload.targetMode || 'SUBMISSION';

    // Convert uploaded files into base64 payloads & validate MIME
    const rawPagePayloads: { mimeType: string; data: string; ext: string; buffer: Buffer }[] = [];
    for (let idx = 0; idx < rawPages.length; idx++) {
      const file = rawPages[idx];
      const safeFormat = resolveSafeFileFormat(file);
      if (!safeFormat) {
        return NextResponse.json(
          { error: 'Ungültiges Dateiformat. Erlaubt sind JPG, PNG, WebP und PDF.' },
          { status: 400 }
        );
      }
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      rawPagePayloads.push({
        mimeType: safeFormat.mimeType,
        data: buffer.toString('base64'),
        ext: safeFormat.ext,
        buffer,
      });
    }

    // Deduplicate byte-identical pages while preserving original page order
    const pagePayloads = deduplicatePayloadsByHash(rawPagePayloads, (p) =>
      crypto.createHash('sha256').update(p.buffer).digest('hex')
    );

    if (pagePayloads.length === 0) {
      return NextResponse.json(
        { error: 'Bitte mindestens eine gültige Seite fotografieren.' },
        { status: 400 }
      );
    }

    // Document type and content validation (reject empty/blank/consent form before storage and LLM calls)
    const isReferenceScan =
      effectiveTargetMode === 'RUBRIC' || effectiveTargetMode === 'EXAM_TEMPLATE';

    for (let idx = 0; idx < pagePayloads.length; idx++) {
      const p = pagePayloads[idx];
      const origFile = rawPages[idx];
      const pageLabel = isReferenceScan
        ? 'Die Musterlösung'
        : pagePayloads.length === 1
          ? 'Die Schülerarbeit'
          : `Seite ${idx + 1}`;

      const docValidation = await validateDocument({
        buffer: p.buffer,
        name: origFile?.name,
        mimeType: p.mimeType,
        label: pageLabel,
        expectedType: isReferenceScan ? 'reference' : 'student_exam',
      });

      if (!docValidation.valid) {
        return NextResponse.json(
          { error: docValidation.error },
          { status: docValidation.status || 400 }
        );
      }
    }

    // =========================================================================
    // MODE 1: SCANNING MUSTERLÖSUNG ('RUBRIC') OR VORLAGENPRÜFUNG ('EXAM_TEMPLATE')
    // =========================================================================
    if (effectiveTargetMode === 'RUBRIC' || effectiveTargetMode === 'EXAM_TEMPLATE') {
      const cleanPayloads = pagePayloads.map((p) => ({ mimeType: p.mimeType, data: p.data }));
      const serializedDocument =
        cleanPayloads.length === 1
          ? JSON.stringify(cleanPayloads[0])
          : JSON.stringify(cleanPayloads);

      if (payload.sessionId) {
        saveScannedRelayDocument({
          id: crypto.randomUUID(),
          sessionId: payload.sessionId,
          teacherId: payload.teacherId,
          targetMode: effectiveTargetMode,
          payload: serializedDocument,
          pageCount: cleanPayloads.length,
          createdAt: Date.now(),
        });
      }

      const targetExamId =
        (explicitExamId && explicitExamId !== 'AUTO' ? explicitExamId : null) ||
        payload.examId ||
        null;

      if (targetExamId) {
        const ownedExam = await db.exam.findFirst({
          where: { id: targetExamId, class: { teacherId: payload.teacherId } },
        });
        if (ownedExam) {
          await db.exam.update({
            where: { id: ownedExam.id },
            data:
              effectiveTargetMode === 'RUBRIC'
                ? { rubricText: serializedDocument }
                : { examTemplateText: serializedDocument },
          });
          invalidateExamCache(payload.teacherId, ownedExam.id, ownedExam.classId);
        }
      }

      return NextResponse.json({
        success: true,
        targetMode: effectiveTargetMode,
        pagesCount: cleanPayloads.length,
        status: 'DOCUMENT_TRANSFERRED',
      });
    }

    const storage = getStorageAdapter();

    // =========================================================================
    // MODE 2: REPLACING OR APPENDING PAGES TO AN EXISTING SUBMISSION
    // =========================================================================
    const targetSubmissionId = explicitSubmissionId || payload.submissionId || null;
    if (
      (effectiveTargetMode === 'REPLACE_SUBMISSION' ||
        effectiveTargetMode === 'APPEND_SUBMISSION') &&
      targetSubmissionId
    ) {
      const existingSub = await db.submission.findFirst({
        where: {
          id: targetSubmissionId,
          exam: { class: { teacherId: payload.teacherId } },
        },
        include: {
          student: true,
          exam: {
            include: {
              class: true,
              tasks: { orderBy: { orderIndex: 'asc' } },
            },
          },
        },
      });

      if (!existingSub) {
        return NextResponse.json({ error: 'Korrektur nicht gefunden.' }, { status: 404 });
      }

      const existingUrls = parseStudentExamUrls(existingSub.studentExamUrl);
      const newUrls: string[] = [];
      const suffixId = crypto.randomUUID().slice(0, 8);

      for (let idx = 0; idx < pagePayloads.length; idx++) {
        const p = pagePayloads[idx];
        const fileName = `${existingSub.id}_${suffixId}_p${idx + 1}.${p.ext}`;
        const savedUrl = await storage.write(fileName, p.buffer, p.mimeType);
        newUrls.push(savedUrl);
      }

      const finalUrls =
        effectiveTargetMode === 'APPEND_SUBMISSION' ? [...existingUrls, ...newUrls] : newUrls;
      const storedUrl = finalUrls.length === 1 ? finalUrls[0] : JSON.stringify(finalUrls);

      // Load all pages (existing + new if APPEND) for Gemini re-evaluation
      const allEvaluationPages: { mimeType: string; data: string }[] = [];
      if (effectiveTargetMode === 'APPEND_SUBMISSION') {
        for (const u of existingUrls) {
          try {
            const fileData = await storage.read(u);
            if (fileData) {
              allEvaluationPages.push({
                mimeType: fileData.contentType,
                data: fileData.buffer.toString('base64'),
              });
            }
          } catch {
            // Skip unreadable old file
          }
        }
      }
      for (const p of pagePayloads) {
        allEvaluationPages.push({ mimeType: p.mimeType, data: p.data });
      }

      await db.submission.update({
        where: { id: existingSub.id },
        data: {
          status: 'PROCESSING',
          studentExamUrl: storedUrl,
          errorMessage: null,
        },
      });

      const logRecord = await db.correctionLog.create({
        data: {
          submissionId: existingSub.id,
          teacherId: payload.teacherId,
          className: existingSub.exam.class.name,
          examTitle: existingSub.exam.title,
          studentName: existingSub.student?.name || existingSub.extractedStudentName || 'Unbekannt',
          modelUsed: DEFAULT_GEMINI_MODEL,
          status: 'PROCESSING',
          actionType: 'SCAN_ERSETZT',
        },
      });

      invalidateSubmissionCache(payload.teacherId, {
        submissionId: existingSub.id,
        examId: existingSub.examId,
        classId: existingSub.exam.classId,
        studentId: existingSub.studentId,
      });
      invalidateLogsCache(payload.teacherId);

      after(async () => {
        const startTime = Date.now();
        try {
          const predefinedTasks =
            existingSub.exam.tasks.length > 0
              ? existingSub.exam.tasks.map((t) => ({
                  taskId: t.taskId,
                  title: t.title,
                  maxPoints: t.maxPoints,
                }))
              : undefined;

          const [firstEvalPage, ...extraEvalPages] = allEvaluationPages;
          const promptVersion = LLM_PROMPT_VERSIONS.grading;
          const gradingHash = computeGradingHash({
            teacherId: payload.teacherId,
            modelName: DEFAULT_GEMINI_MODEL,
            promptVersion,
            studentPages: allEvaluationPages,
            rubric: parseStoredMaterial(existingSub.exam.rubricText),
            examTemplate: parseStoredMaterial(existingSub.exam.examTemplateText),
            gradingNotes: existingSub.exam.gradingNotes,
            predefinedTasks,
            subject: existingSub.exam.subject,
          });
          const cacheKey = buildLlmCacheKey(payload.teacherId, 'grading', gradingHash);

          let result: ExamCorrectionResult;
          const cached = await getCachedLlmResult<ExamCorrectionResult>(cacheKey);
          if (cached) {
            result = cached.result;
          } else {
            result = await runLiveGeminiCorrection(
              firstEvalPage.data,
              existingSub.exam.rubricText,
              DEFAULT_GEMINI_MODEL,
              process.env.GEMINI_API_KEY,
              firstEvalPage.mimeType,
              predefinedTasks,
              existingSub.exam.subject,
              {
                examTemplate: existingSub.exam.examTemplateText,
                gradingNotes: existingSub.exam.gradingNotes,
                additionalStudentPages: extraEvalPages,
              }
            );
            await setCachedLlmResult(cacheKey, {
              result,
              cachedAt: Date.now(),
              cachedAtIso: new Date().toISOString(),
              model: DEFAULT_GEMINI_MODEL,
              hash: gradingHash,
              callType: 'grading',
              promptVersion,
              teacherId: payload.teacherId,
            });
          }

          let serverTotalEarnedPoints = 0;
          let serverTotalMaxPoints = 0;
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

          for (let tIdx = 0; tIdx < result.aufgaben.length; tIdx++) {
            const task = result.aufgaben[tIdx];
            let taskStatus: 'Korrekt' | 'Folgefehler' | 'Fehler' = 'Korrekt';
            if (task.status === 'Folgefehler') taskStatus = 'Folgefehler';
            else if (task.status === 'Fehler') taskStatus = 'Fehler';

            const taskCorrectionId = crypto.randomUUID();
            let calculatedTaskPoints = 0;
            const hasSteps = Array.isArray(task.schritte) && task.schritte.length > 0;

            if (hasSteps) {
              for (const step of task.schritte) {
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
                  taskCorrectionId,
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
              submissionId: existingSub.id,
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

          const effectiveMaxPoints =
            existingSub.exam.maxPoints > 0
              ? existingSub.exam.maxPoints
              : serverTotalMaxPoints || result.gesamtmaximalPunkte;

          const rawGrade = calculateRawSwissGrade(
            serverTotalEarnedPoints,
            effectiveMaxPoints,
            existingSub.exam.gradingFormula
          );
          const roundedGrade = calculateSwissGrade(
            serverTotalEarnedPoints,
            effectiveMaxPoints,
            existingSub.exam.gradingFormula,
            existingSub.exam.gradeRounding
          );

          await db.$transaction(async (tx) => {
            await tx.taskCorrection.deleteMany({ where: { submissionId: existingSub.id } });
            await tx.submission.update({
              where: { id: existingSub.id },
              data: {
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
              await tx.taskCorrection.createMany({ data: taskCorrectionsData });
            }
            if (stepCorrectionsData.length > 0) {
              await tx.stepCorrection.createMany({ data: stepCorrectionsData });
            }
          });

          await db.correctionLog.update({
            where: { id: logRecord.id },
            data: { status: 'COMPLETED', durationMs: Date.now() - startTime },
          });
          invalidateSubmissionCache(payload.teacherId, {
            submissionId: existingSub.id,
            examId: existingSub.examId,
            classId: existingSub.exam.classId,
            studentId: existingSub.studentId,
          });
          invalidateLogsCache(payload.teacherId);
        } catch (err) {
          const categorized = categorizeGeminiError(err);
          await db.submission.update({
            where: { id: existingSub.id },
            data: { status: 'FAILED', errorMessage: categorized.userMessage },
          });
          await db.correctionLog.update({
            where: { id: logRecord.id },
            data: {
              status: 'FAILED',
              errorMessage: `[${categorized.category}] ${categorized.userMessage}`,
              durationMs: Date.now() - startTime,
            },
          });
          invalidateSubmissionCache(payload.teacherId, {
            submissionId: existingSub.id,
            examId: existingSub.examId,
            classId: existingSub.exam.classId,
            studentId: existingSub.studentId,
          });
          invalidateLogsCache(payload.teacherId);
        }
      });

      return NextResponse.json({
        success: true,
        submissionId: existingSub.id,
        pagesCount: finalUrls.length,
        status: 'PROCESSING',
      });
    }

    // =========================================================================
    // MODE 3: STANDARD OR UNIVERSAL STUDENT EXAM SUBMISSION ('SUBMISSION')
    // =========================================================================
    const teacherExams = await db.exam.findMany({
      where: {
        class: {
          teacherId: payload.teacherId,
        },
      },
      include: {
        class: {
          include: {
            students: true,
          },
        },
        tasks: {
          orderBy: {
            orderIndex: 'asc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (teacherExams.length === 0) {
      return NextResponse.json(
        {
          error:
            'Es existiert noch keine Prüfung im System. Bitte lege auf dem Desktop zuerst eine Prüfung mit Musterlösung an.',
        },
        { status: 400 }
      );
    }

    const targetExamIdFromRequest =
      (explicitExamId && explicitExamId !== 'AUTO' ? explicitExamId : null) ||
      payload.examId ||
      null;

    if (targetExamIdFromRequest) {
      const explicitExam = teacherExams.find((e) => e.id === targetExamIdFromRequest);
      if (explicitExam && !isExamApproved(explicitExam)) {
        return NextResponse.json(
          {
            error:
              'Die Prüfung ist ein noch ungeprüfter Entwurf und muss vor der Korrektur freigegeben werden.',
          },
          { status: 400 }
        );
      }
    }

    const approvedTeacherExams = teacherExams.filter((e) => isExamApproved(e));

    if (approvedTeacherExams.length === 0) {
      return NextResponse.json(
        {
          error:
            'Es existiert noch keine freigegebene Prüfung im System. Bitte prüfe und gib deine Entwürfe zuerst frei.',
        },
        { status: 400 }
      );
    }

    const submissionId = crypto.randomUUID();
    const savedUrls: string[] = [];

    for (let idx = 0; idx < pagePayloads.length; idx++) {
      const p = pagePayloads[idx];
      const fileName =
        pagePayloads.length === 1
          ? `${submissionId}.${p.ext}`
          : `${submissionId}_p${idx + 1}.${p.ext}`;
      const savedUrl = await storage.write(fileName, p.buffer, p.mimeType);
      savedUrls.push(savedUrl);
    }

    const storedStudentExamUrl = savedUrls.length === 1 ? savedUrls[0] : JSON.stringify(savedUrls);

    const targetStudentIdFromRequest =
      (explicitStudentId && explicitStudentId !== 'AUTO' ? explicitStudentId : null) ||
      payload.studentId ||
      null;

    const initialExam =
      (targetExamIdFromRequest
        ? approvedTeacherExams.find((e) => e.id === targetExamIdFromRequest)
        : null) || approvedTeacherExams[0];

    const isAutoDetectExamMode = !targetExamIdFromRequest;

    const submission = await db.submission.create({
      data: {
        id: submissionId,
        examId: initialExam.id,
        studentId: null,
        targetStudentId: targetStudentIdFromRequest,
        isExamMatchUncertain: isAutoDetectExamMode && approvedTeacherExams.length > 1,
        isStudentMatchUncertain: false,
        status: 'PENDING',
        earnedPoints: 0.0,
        gradeRaw: 1.0,
        gradeRounded: '1.0',
        strengths: [],
        weaknesses: [],
        helpfulTip: null,
        exerciseRecommendation: null,
        studentExamUrl: storedStudentExamUrl,
      },
    });

    const preselectedStudentObj = targetStudentIdFromRequest
      ? initialExam.class.students.find((s) => s.id === targetStudentIdFromRequest)
      : null;

    const logRecord = await db.correctionLog.create({
      data: {
        submissionId: submissionId,
        teacherId: payload.teacherId,
        className: initialExam.class.name,
        examTitle: initialExam.title,
        studentName: preselectedStudentObj?.name || 'Smartphone-Scan (KI-Erkennung)',
        modelUsed: DEFAULT_GEMINI_MODEL,
        status: 'PENDING',
        actionType: 'ERSTELLT',
      },
    });

    invalidateSubmissionCache(payload.teacherId, {
      submissionId,
      examId: initialExam.id,
      classId: initialExam.classId,
      studentId: targetStudentIdFromRequest,
    });
    invalidateLogsCache(payload.teacherId);

    after(async () => {
      const startTime = Date.now();
      let finalStudentName = preselectedStudentObj?.name || 'Smartphone-Scan';

      try {
        await db.submission.update({
          where: { id: submissionId },
          data: { status: 'PROCESSING' },
        });
        await db.correctionLog.update({
          where: { id: logRecord.id },
          data: { status: 'PROCESSING' },
        });

        let activeExam = initialExam;
        let isExamMatchUncertain = false;

        if (isAutoDetectExamMode) {
          if (approvedTeacherExams.length === 1) {
            activeExam = approvedTeacherExams[0];
            isExamMatchUncertain = false;
          } else {
            const candidates = approvedTeacherExams.map((e) => ({
              examId: e.id,
              examTitle: e.title,
              subject: e.subject,
              classId: e.classId,
              className: e.class.name,
              taskTitles: e.tasks.map((t) => `${t.taskId}: ${t.title}`),
              studentNames: e.class.students.map((s) => s.name),
            }));

            const identification = await identifyExamAndStudentFromScan(
              pagePayloads.map((p) => ({ mimeType: p.mimeType, data: p.data })),
              candidates,
              { teacherId: payload.teacherId }
            );
            const foundExam = approvedTeacherExams.find(
              (e) => e.id === identification.matchedExamId
            );
            if (foundExam) {
              activeExam = foundExam;
            }
            isExamMatchUncertain = !identification.isExamMatchCertain;
          }
        }

        const predefinedTasks =
          activeExam.tasks.length > 0
            ? activeExam.tasks.map((t) => ({
                taskId: t.taskId,
                title: t.title,
                maxPoints: t.maxPoints,
              }))
            : undefined;

        const [firstPage, ...extraPages] = pagePayloads;
        const promptVersion = LLM_PROMPT_VERSIONS.grading;
        const studentPages = pagePayloads.map((p) => ({ mimeType: p.mimeType, data: p.data }));
        const gradingHash = computeGradingHash({
          teacherId: payload.teacherId,
          modelName: DEFAULT_GEMINI_MODEL,
          promptVersion,
          studentPages,
          rubric: parseStoredMaterial(activeExam.rubricText),
          examTemplate: parseStoredMaterial(activeExam.examTemplateText),
          gradingNotes: activeExam.gradingNotes,
          predefinedTasks,
          subject: activeExam.subject,
        });
        const cacheKey = buildLlmCacheKey(payload.teacherId, 'grading', gradingHash);

        let result: ExamCorrectionResult;
        let isReused = false;

        const cached = await getCachedLlmResult<ExamCorrectionResult>(cacheKey);
        if (cached) {
          result = cached.result;
          isReused = true;
        } else {
          result = await runLiveGeminiCorrection(
            firstPage.data,
            activeExam.rubricText,
            DEFAULT_GEMINI_MODEL,
            process.env.GEMINI_API_KEY,
            firstPage.mimeType,
            predefinedTasks,
            activeExam.subject,
            {
              examTemplate: activeExam.examTemplateText,
              gradingNotes: activeExam.gradingNotes,
              additionalStudentPages: extraPages.map((p) => ({
                mimeType: p.mimeType,
                data: p.data,
              })),
            }
          );
          await setCachedLlmResult(cacheKey, {
            result,
            cachedAt: Date.now(),
            cachedAtIso: new Date().toISOString(),
            model: DEFAULT_GEMINI_MODEL,
            hash: gradingHash,
            callType: 'grading',
            promptVersion,
            teacherId: payload.teacherId,
          });
        }

        const classStudents = activeExam.class.students;
        const extractedName = (result.schuelerName || '').trim();

        let finalMatchedStudentId: string | null = null;
        let suggestedStudentId: string | null = null;
        let isStudentMatchUncertain = true;

        if (targetStudentIdFromRequest) {
          // Teacher explicitly locked/selected the student on Desktop or Smartphone
          const validStudent = classStudents.find((s) => s.id === targetStudentIdFromRequest);
          if (validStudent) {
            const existingDuplicate = await db.submission.findFirst({
              where: {
                examId: activeExam.id,
                studentId: validStudent.id,
                id: { not: submissionId },
              },
            });
            if (!existingDuplicate) {
              finalMatchedStudentId = validStudent.id;
              isStudentMatchUncertain = false;
              finalStudentName = validStudent.name;
            } else {
              suggestedStudentId = validStudent.id;
              isStudentMatchUncertain = true;
              finalStudentName = `${validStudent.name} (Duplikat prüfen)`;
            }
          }
        } else {
          const studentMatch = matchStudentByNameWithConfidence(
            extractedName,
            classStudents,
            Boolean(result.istNameUnsicher)
          );
          suggestedStudentId = studentMatch.suggestedStudentId;

          if (
            !isExamMatchUncertain &&
            studentMatch.confidence === 'HIGH' &&
            studentMatch.matchedStudentId
          ) {
            const existingDuplicate = await db.submission.findFirst({
              where: {
                examId: activeExam.id,
                studentId: studentMatch.matchedStudentId,
                id: { not: submissionId },
              },
            });

            if (!existingDuplicate) {
              finalMatchedStudentId = studentMatch.matchedStudentId;
              isStudentMatchUncertain = false;
              const matchedStudentObj = classStudents.find((s) => s.id === finalMatchedStudentId);
              if (matchedStudentObj) {
                finalStudentName = matchedStudentObj.name;
              }
            } else {
              suggestedStudentId = studentMatch.matchedStudentId;
              isStudentMatchUncertain = true;
              finalStudentName = `${extractedName || 'Schüler/in'} (Duplikat prüfen)`;
            }
          } else {
            finalStudentName = extractedName
              ? `${extractedName} (Zuordnung prüfen)`
              : 'Nicht zugeordnet (Smartphone-Scan)';
          }
        }

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
            for (const step of task.schritte) {
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
                taskCorrectionId,
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
            submissionId,
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

        const hasPredefinedTasks = activeExam.tasks.length > 0;
        const resolvedMaxPoints =
          serverTotalMaxPoints > 0 ? serverTotalMaxPoints : result.gesamtmaximalPunkte;

        const { effectiveMaxPoints, shouldUpdateExamMaxPoints } = resolveEffectiveGradingMaxPoints({
          teacherMaxPoints: activeExam.maxPoints,
          resolvedMaxPoints,
          hasPredefinedTasks,
        });

        if (shouldUpdateExamMaxPoints && effectiveMaxPoints > 0) {
          await db.exam.update({
            where: { id: activeExam.id },
            data: { maxPoints: effectiveMaxPoints },
          });
          activeExam.maxPoints = effectiveMaxPoints;
        }

        const rawGrade = calculateRawSwissGrade(
          serverTotalEarnedPoints,
          effectiveMaxPoints,
          activeExam.gradingFormula
        );
        const roundedGrade = calculateSwissGrade(
          serverTotalEarnedPoints,
          effectiveMaxPoints,
          activeExam.gradingFormula,
          activeExam.gradeRounding
        );

        await db.$transaction(async (tx) => {
          await tx.submission.update({
            where: { id: submissionId },
            data: {
              examId: activeExam.id,
              studentId: finalMatchedStudentId,
              extractedStudentName: extractedName || null,
              suggestedStudentId: suggestedStudentId,
              isStudentMatchUncertain,
              isExamMatchUncertain,
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
            await tx.taskCorrection.createMany({ data: taskCorrectionsData });
          }
          if (stepCorrectionsData.length > 0) {
            await tx.stepCorrection.createMany({ data: stepCorrectionsData });
          }
        });

        const durationMs = Date.now() - startTime;
        await db.correctionLog.update({
          where: { id: logRecord.id },
          data: {
            className: activeExam.class.name,
            examTitle: activeExam.title,
            studentName: finalStudentName,
            status: 'COMPLETED',
            durationMs,
            actionType: isReused ? 'WIEDERVERWENDET' : 'ERSTELLT',
          },
        });
        invalidateSubmissionCache(payload.teacherId, {
          submissionId,
          examId: activeExam.id,
          classId: activeExam.classId,
          studentId: finalMatchedStudentId,
        });
        invalidateLogsCache(payload.teacherId);
      } catch (error) {
        const durationMs = Date.now() - startTime;
        const categorized = categorizeGeminiError(error);
        console.error(
          `Mobile relay background grading error for ${submissionId} [Category: ${categorized.category}]:`,
          error
        );

        try {
          await db.correctionLog.update({
            where: { id: logRecord.id },
            data: {
              status: 'FAILED',
              studentName: finalStudentName,
              durationMs,
              errorMessage: `[${categorized.category}] ${categorized.userMessage}`,
            },
          });
        } catch {
          // Ignore log update failure
        }

        try {
          await db.submission.update({
            where: { id: submissionId },
            data: {
              status: 'FAILED',
              errorMessage: categorized.userMessage,
            },
          });
        } catch {
          // Ignore if deleted
        }
        invalidateSubmissionCache(payload.teacherId, {
          submissionId,
          examId: initialExam.id,
          classId: initialExam.classId,
          studentId: targetStudentIdFromRequest,
        });
        invalidateLogsCache(payload.teacherId);
      }
    });

    return NextResponse.json({
      success: true,
      submissionId: submission.id,
      pagesCount: pagePayloads.length,
      status: 'PENDING',
    });
  } catch (error) {
    console.error('Error in mobile relay upload:', error);
    return NextResponse.json(
      { error: 'Smartphone-Upload fehlgeschlagen. Bitte versuchen Sie es später erneut.' },
      { status: 500 }
    );
  }
}
