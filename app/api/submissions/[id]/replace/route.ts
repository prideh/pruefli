import { NextResponse, after } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { checkAiRateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import {
  DEFAULT_GEMINI_MODEL,
  runLiveGeminiCorrection,
  categorizeGeminiError,
  type ExamCorrectionResult,
} from '@/lib/gemini';
import {
  calculateRawSwissGrade,
  calculateSwissGrade,
  matchStudentByNameWithConfidence,
  parseStudentExamUrls,
} from '@/lib/grading';
import { getStorageAdapter } from '@/lib/storage';
import { invalidateSubmissionCache, invalidateLogsCache } from '@/lib/cache';
import { validateDocument } from '@/lib/document-validation';
import {
  computeGradingHash,
  buildLlmCacheKey,
  getCachedLlmResult,
  setCachedLlmResult,
  LLM_PROMPT_VERSIONS,
} from '@/lib/llm-cache';
import crypto from 'crypto';

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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // 1. Authenticate user
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }

    // Rate limiting for AI endpoints
    const rateLimit = await checkAiRateLimit({
      identifier: session.userId,
      scope: 'teacher',
      endpoint: 'replace',
    });
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit);
    }

    const { id: submissionId } = await params;
    const body = await request.json().catch(() => ({}));
    const overrideDocumentType = body?.overrideDocumentType === true || body?.override === true;

    // 2. Fetch the failed submission
    const submission = await db.submission.findUnique({
      where: { id: submissionId },
      include: {
        exam: {
          include: {
            class: true,
          },
        },
      },
    });

    if (!submission) {
      return NextResponse.json({ error: 'Korrektur nicht gefunden.' }, { status: 404 });
    }

    // Verify teacher owns the class
    if (submission.exam.class.teacherId !== session.userId) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 403 });
    }

    const pageUrls = parseStudentExamUrls(submission.studentExamUrl);
    if (!submission.studentExamUrl || pageUrls.length === 0) {
      const missingMsg =
        'Der Dokumenten-Scan dieser Arbeit ist nicht mehr verfügbar (vor der Speicher-Migration verloren gegangen). Bitte lade die Prüfung erneut hoch.';
      await db.submission.update({
        where: { id: submissionId },
        data: { status: 'FAILED', errorMessage: missingMsg },
      });
      return NextResponse.json({ error: missingMsg, missingFile: true }, { status: 400 });
    }

    let resolvedStudentName = 'Automatische Zuordnung';
    const initialStudentId = submission.studentId || submission.targetStudentId;
    if (initialStudentId) {
      const student = await db.student.findUnique({
        where: { id: initialStudentId },
      });
      if (student) {
        resolvedStudentName = student.name;
      }
    }

    const modelToUse = DEFAULT_GEMINI_MODEL;
    const isDuplicateConflict = Boolean(
      submission.errorMessage?.includes('bereits eine Korrektur')
    );
    const actionType =
      submission.status === 'FAILED' && !isDuplicateConflict ? 'NEUSTART' : 'ERSETZT';

    // Verify scan files actually exist in durable storage before scheduling background AI task
    const storage = getStorageAdapter();
    let hasMissingFile = false;
    for (const relUrl of pageUrls) {
      const fileExists = await storage.exists(relUrl);
      if (!fileExists) {
        hasMissingFile = true;
        break;
      }
    }

    if (hasMissingFile) {
      const missingMsg =
        'Der Dokumenten-Scan dieser Arbeit ist nicht mehr verfügbar (vor der Speicher-Migration verloren gegangen). Bitte lade die Prüfung erneut hoch.';

      await db.submission.update({
        where: { id: submissionId },
        data: {
          status: 'FAILED',
          errorMessage: missingMsg,
        },
      });

      await db.correctionLog.create({
        data: {
          submissionId,
          teacherId: session.userId,
          className: submission.exam.class.name,
          examTitle: submission.exam.title,
          studentName: resolvedStudentName,
          modelUsed: modelToUse,
          status: 'FAILED',
          actionType,
          errorMessage: `[MISSING_FILE] ${missingMsg}`,
        },
      });

      await invalidateSubmissionCache(session.userId, {
        submissionId,
        examId: submission.examId,
        classId: submission.exam.classId,
        studentId: submission.studentId || undefined,
      });
      await invalidateLogsCache(session.userId);

      return NextResponse.json({ error: missingMsg, missingFile: true }, { status: 400 });
    }

    // Validate stored scan files before scheduling background AI task
    for (let idx = 0; idx < pageUrls.length; idx++) {
      const relUrl = pageUrls[idx];
      const fileData = await storage.read(relUrl);
      if (fileData) {
        const pageLabel = pageUrls.length === 1 ? 'Die Schülerarbeit' : `Seite ${idx + 1}`;
        const docValidation = await validateDocument(
          {
            buffer: fileData.buffer,
            name: relUrl,
            mimeType: fileData.contentType,
            label: pageLabel,
            expectedType: 'student_exam',
          },
          {
            overrideDocumentType,
            teacherId: session.userId,
          }
        );
        if (!docValidation.valid) {
          return NextResponse.json(
            {
              error: docValidation.error,
              reason: docValidation.reason,
              canOverride: docValidation.canOverride,
              classification: docValidation.classification,
            },
            { status: docValidation.status || 400 }
          );
        }
      }
    }

    // Reset status to PROCESSING to display active loading spinner
    await db.submission.update({
      where: { id: submissionId },
      data: { status: 'PROCESSING', errorMessage: null },
    });

    // Create decoupling CorrectionLog record synchronously
    const logRecord = await db.correctionLog.create({
      data: {
        submissionId: submissionId,
        teacherId: session.userId,
        className: submission.exam.class.name,
        examTitle: submission.exam.title,
        studentName: resolvedStudentName,
        modelUsed: modelToUse,
        status: 'PROCESSING', // Starts directly in PROCESSING
        actionType,
      },
    });

    await invalidateSubmissionCache(session.userId, {
      submissionId,
      examId: submission.examId,
      classId: submission.exam.classId,
      studentId: submission.studentId || undefined,
    });
    await invalidateLogsCache(session.userId);

    // 3. Schedule the background task using Next.js after() to re-run correction with overwrite = true
    after(async () => {
      const startTime = Date.now();
      let finalStudentName = resolvedStudentName;

      try {
        // Read single or multi-page files from durable storage and convert to base64
        const pageUrls = parseStudentExamUrls(submission.studentExamUrl);
        if (pageUrls.length === 0) {
          throw new Error('Keine Prüfungsdateien für diese Abgabe gefunden.');
        }

        const storage = getStorageAdapter();
        const pagePayloads: { mimeType: string; data: string }[] = [];
        for (const relUrl of pageUrls) {
          const fileData = await storage.read(relUrl);
          if (!fileData) {
            throw new Error(`Prüfungsdatei nicht gefunden: ${relUrl}`);
          }
          pagePayloads.push({
            mimeType: fileData.contentType,
            data: fileData.buffer.toString('base64'),
          });
        }

        const [firstPage, ...extraPages] = pagePayloads;

        // Load rubric and 3-tier context
        const rubricParam =
          parseStoredMaterial(submission.exam.rubricText) || submission.exam.rubricText;
        const examTemplateParam = parseStoredMaterial(submission.exam.examTemplateText);

        // Fetch predefined tasks if available
        const examTasks = await db.examTask.findMany({
          where: { examId: submission.examId },
          orderBy: { orderIndex: 'asc' },
        });

        const predefinedTasks =
          examTasks.length > 0
            ? examTasks.map((t) => ({
                taskId: t.taskId,
                title: t.title,
                maxPoints: t.maxPoints,
              }))
            : undefined;

        // Content-Hash LLM Cache check: If identical scan was already cached, reuse it to avoid duplicate billing
        const promptVersion = LLM_PROMPT_VERSIONS.grading;
        const studentPages = [firstPage, ...extraPages];
        const gradingHash = computeGradingHash({
          teacherId: session.userId,
          modelName: modelToUse,
          promptVersion,
          studentPages,
          rubric: rubricParam,
          examTemplate: examTemplateParam,
          gradingNotes: submission.exam.gradingNotes,
          predefinedTasks,
          subject: submission.exam.subject,
        });
        const cacheKey = buildLlmCacheKey(session.userId, 'grading', gradingHash);

        let result: ExamCorrectionResult;
        let isReused = false;
        let modelUsedForLog = modelToUse;

        // On retry or duplicate-overwrite of a failed submission, check if cached result exists
        const cached =
          submission.status === 'FAILED'
            ? await getCachedLlmResult<ExamCorrectionResult>(cacheKey)
            : null;
        if (cached) {
          result = cached.result;
          isReused = true;
          modelUsedForLog = cached.model;
        } else {
          // Run live Gemini OCR and correction analysis
          result = await runLiveGeminiCorrection(
            firstPage.data,
            rubricParam,
            modelToUse,
            process.env.GEMINI_API_KEY,
            firstPage.mimeType,
            predefinedTasks,
            submission.exam.subject,
            {
              examTemplate: examTemplateParam,
              gradingNotes: submission.exam.gradingNotes,
              additionalStudentPages: extraPages,
            }
          );

          // Update LLM cache for future identical queries
          await setCachedLlmResult(cacheKey, {
            result,
            cachedAt: Date.now(),
            cachedAtIso: new Date().toISOString(),
            model: modelToUse,
            hash: gradingHash,
            callType: 'grading',
            promptVersion,
            teacherId: session.userId,
          });
        }

        // Resolve student ID via calibrated auto-matching if student was not manually set previously
        let matchedStudentId = submission.studentId || submission.targetStudentId;
        let suggestedStudentId = submission.suggestedStudentId;
        let isStudentMatchUncertain = false;
        const extractedStudentName =
          (result.schuelerName || '').trim() || submission.extractedStudentName;

        if (!matchedStudentId && extractedStudentName) {
          const classStudents = await db.student.findMany({
            where: { classId: submission.exam.classId },
          });
          const matchResult = matchStudentByNameWithConfidence(
            extractedStudentName,
            classStudents,
            Boolean(result.istNameUnsicher)
          );
          suggestedStudentId = matchResult.suggestedStudentId;
          if (matchResult.confidence === 'HIGH' && matchResult.matchedStudentId) {
            matchedStudentId = matchResult.matchedStudentId;
            const matchedRec = classStudents.find((s) => s.id === matchedStudentId);
            if (matchedRec) {
              finalStudentName = matchedRec.name;
            }
          } else {
            isStudentMatchUncertain = true;
            finalStudentName = `${extractedStudentName} (Nicht zugeordnet)`;
          }
        }

        // Execute transaction to delete duplicate submission and save the new correction
        await db.$transaction(async (tx) => {
          if (matchedStudentId) {
            // Delete existing completed/duplicate submission for the matched student to overwrite it
            const existingSubmission = await tx.submission.findFirst({
              where: {
                examId: submission.examId,
                studentId: matchedStudentId,
                id: { not: submissionId }, // Exclude current record
              },
            });

            if (existingSubmission) {
              await tx.submission.delete({
                where: { id: existingSubmission.id },
              });
            }
          }

          // Delete any legacy task corrections that were partially generated
          await tx.taskCorrection.deleteMany({
            where: { submissionId },
          });

          // Prepare Task and Step corrections first to calculate deterministic server-side totals
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
            const taskCorrectionId = crypto.randomUUID();

            let calculatedTaskPoints = 0;
            const hasSteps = Array.isArray(task.schritte) && task.schritte.length > 0;

            if (hasSteps) {
              for (const step of task.schritte) {
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
                  fehlerTyp: step.fehlerTyp as
                    | 'KeinFehler'
                    | 'Rechenfehler'
                    | 'Folgefehler'
                    | 'SonstigerFehler',
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
              ? Math.round(calculatedTaskPoints * 10) / 10
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
              status: task.status as 'Korrekt' | 'Folgefehler' | 'Fehler',
              lehrerKommentar: task.lehrerKommentar || '',
              orderIndex: tIdx,
            });
          }

          const effectiveMaxPoints =
            submission.exam.maxPoints > 0 ? submission.exam.maxPoints : serverTotalMaxPoints;
          const rawGrade = calculateRawSwissGrade(
            serverTotalEarnedPoints,
            effectiveMaxPoints,
            submission.exam.gradingFormula
          );
          const roundedGrade = calculateSwissGrade(
            serverTotalEarnedPoints,
            effectiveMaxPoints,
            submission.exam.gradingFormula,
            submission.exam.gradeRounding
          );

          // Update current submission with deterministic server-calculated correction results
          await tx.submission.update({
            where: { id: submissionId },
            data: {
              studentId: matchedStudentId,
              targetStudentId: null,
              extractedStudentName,
              suggestedStudentId,
              isStudentMatchUncertain,
              isExamMatchUncertain: false,
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

        // Update decouple CorrectionLog to COMPLETED
        const durationMs = Date.now() - startTime;
        await db.correctionLog.update({
          where: { id: logRecord.id },
          data: {
            status: 'COMPLETED',
            studentName: finalStudentName,
            durationMs,
            modelUsed: modelUsedForLog,
            actionType: isReused ? 'WIEDERVERWENDET' : actionType,
          },
        });

        await invalidateSubmissionCache(session.userId, {
          submissionId,
          examId: submission.examId,
          classId: submission.exam.classId,
          studentId: matchedStudentId || submission.studentId || undefined,
        });
        await invalidateLogsCache(session.userId);
      } catch (error) {
        const durationMs = Date.now() - startTime;

        // Check if this error is due to the submission being deleted (e.g. cancelled by the user)
        const isCancelled =
          error && typeof error === 'object' && 'code' in error && error.code === 'P2025';

        if (isCancelled) {
          console.info(
            `Background replace for submission ${submissionId} was cancelled by the user (record deleted).`
          );

          // Update decouple CorrectionLog to CANCELLED
          try {
            await db.correctionLog.update({
              where: { id: logRecord.id },
              data: {
                status: 'CANCELLED',
                durationMs,
              },
            });
          } catch (logErr) {
            console.error('Failed to set CANCELLED status on CorrectionLog:', logErr);
          }
          await invalidateSubmissionCache(session.userId, {
            submissionId,
            examId: submission.examId,
            classId: submission.exam.classId,
          });
          await invalidateLogsCache(session.userId);
          return;
        }

        const categorized = categorizeGeminiError(error);
        console.error(
          `Background replace error for submission ${submissionId} [Category: ${categorized.category} | Details: ${categorized.technicalDetails}]:`,
          error
        );

        // Update decouple CorrectionLog to FAILED with monitoring category and upstream error details
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
          console.error('Failed to set FAILED status on CorrectionLog:', logErr);
        }

        try {
          await db.submission.update({
            where: { id: submissionId },
            data: {
              status: 'FAILED',
              errorMessage: categorized.userMessage,
            },
          });
        } catch (dbErr) {
          const isDbErrCancelled =
            dbErr && typeof dbErr === 'object' && 'code' in dbErr && dbErr.code === 'P2025';

          if (!isDbErrCancelled) {
            console.error(`Failed to set FAILED status on submission ${submissionId}:`, dbErr);
          } else {
            console.info(
              `Failed to set FAILED status: submission ${submissionId} was already deleted (cancelled).`
            );
          }
        }

        await invalidateSubmissionCache(session.userId, {
          submissionId,
          examId: submission.examId,
          classId: submission.exam.classId,
        });
        await invalidateLogsCache(session.userId);
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in replace API endpoint:', error);
    return NextResponse.json(
      { error: 'Die Korrektur konnte nicht neu gestartet werden.' },
      { status: 500 }
    );
  }
}
