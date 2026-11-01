import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { calculateRawSwissGrade, calculateSwissGrade } from '@/lib/grading';
import { normalizeStepFeedbackConsistency } from '@/lib/gemini';
import { deleteSubmissionScanFiles, StorageCleanupError } from '@/lib/storage-cleanup';
import {
  serverCache,
  CacheTags,
  invalidateSubmissionCache,
  invalidateLogsCache,
} from '@/lib/cache';

// GET: Fetch a submission by ID and map to standard ExamCorrectionResult
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }

    const { id: submissionId } = await params;

    const cacheKey = `teacher:${session.userId}:submission:${submissionId}:detail`;
    const cached = await serverCache.get<unknown>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const submission = await db.submission.findUnique({
      where: { id: submissionId },
      include: {
        student: true,
        exam: {
          include: {
            class: true,
          },
        },
        tasks: {
          include: {
            schritte: true,
          },
          orderBy: {
            orderIndex: 'asc',
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

    // Fetch all sibling submissions for the same exam so the teacher can speed-grade across the class
    const rawSiblings = await db.submission.findMany({
      where: { examId: submission.examId },
      include: {
        student: { select: { name: true } },
        tasks: {
          include: {
            schritte: { select: { istUnsicher: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const siblingSubmissions = rawSiblings
      .map((sib) => ({
        id: sib.id,
        studentName:
          sib.student?.name ||
          (sib.extractedStudentName
            ? `${sib.extractedStudentName} (Nicht zugeordnet)`
            : 'Nicht zugeordnet'),
        status: sib.status,
        grade: sib.gradeRounded,
        earnedPoints: sib.earnedPoints,
        uncertainStepsCount: sib.tasks.reduce(
          (acc, t) => acc + t.schritte.filter((s) => s.istUnsicher).length,
          0
        ),
      }))
      .sort((a, b) => a.studentName.localeCompare(b.studentName, 'de-CH'));

    const latestLog = await db.correctionLog.findFirst({
      where: { submissionId },
      orderBy: { createdAt: 'desc' },
      select: { actionType: true, modelUsed: true },
    });
    const isReused = latestLog?.actionType === 'WIEDERVERWENDET';

    // Map DB relational model to ExamCorrectionResult frontend format
    const responseData = {
      id: submission.id,
      examId: submission.examId,
      examTitle: submission.exam.title,
      siblingSubmissions,
      isReused: Boolean(isReused),
      status: submission.status,
      errorMessage: submission.errorMessage,
      schuelerName:
        submission.student?.name ||
        (submission.extractedStudentName
          ? `${submission.extractedStudentName} (Nicht zugeordnet)`
          : 'Nicht zugeordnet'),
      extractedStudentName: submission.extractedStudentName,
      suggestedStudentId: submission.suggestedStudentId,
      isStudentMatchUncertain: submission.isStudentMatchUncertain,
      isExamMatchUncertain: submission.isExamMatchUncertain,
      studentId: submission.studentId,
      classId: submission.exam.classId,
      className: submission.exam.class.name,
      fach: submission.exam.subject,
      datum: submission.createdAt.toLocaleDateString('de-CH'),
      gesamterzieltePunkte: submission.earnedPoints,
      gesamtmaximalPunkte: submission.exam.maxPoints,
      note: submission.gradeRounded,
      gradingFormula: submission.exam.gradingFormula,
      gradeRounding: submission.exam.gradeRounding,
      studentExamUrl: submission.studentExamUrl,
      aufgaben: submission.tasks.map((task) => ({
        aufgabeId: task.taskId,
        titel: task.title,
        schuelerAntwort: task.studentAnswer,
        erzieltePunkte: task.erzieltePunkte,
        maximalPunkte: task.maximalPunkte,
        status: task.status,
        lehrerKommentar: task.lehrerKommentar,
        schritte: task.schritte
          .map((step) =>
            normalizeStepFeedbackConsistency({
              id: step.id,
              schrittIndex: step.schrittIndex,
              schrittText: step.schrittText,
              istKorrekt: step.istKorrekt,
              fehlerTyp: step.fehlerTyp,
              erreichtePunkte: step.erreichtePunkte,
              maximalPunkte: step.maximalPunkte,
              begruendung: step.begruendung,
              istUnsicher: step.istUnsicher,
              unsicherheitsGrund: step.unsicherheitsGrund || '',
            })
          )
          .sort((a, b) => a.schrittIndex - b.schrittIndex),
      })),
      schuelerFeedback: {
        staerken: submission.strengths,
        schwaechen: submission.weaknesses,
        hilfreicherTipp: submission.helpfulTip || '',
        uebungsEmpfehlung: submission.exerciseRecommendation || '',
      },
    };

    await serverCache.set(cacheKey, responseData, {
      tags: [
        CacheTags.teacher(session.userId),
        CacheTags.submissions(session.userId),
        CacheTags.submission(session.userId, submissionId),
        CacheTags.exam(session.userId, submission.examId),
      ],
    });

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('Error fetching submission:', error);
    return NextResponse.json({ error: 'Fehler beim Laden der Korrektur.' }, { status: 500 });
  }
}

// POST: Save updated teacher points, comments, and recalculate grades
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }

    const { id: submissionId } = await params;
    const body = await request.json();
    const { aufgaben, schuelerFeedback } = body; // Array of updated tasks + optional student feedback

    if (!Array.isArray(aufgaben)) {
      return NextResponse.json({ error: 'Ungültige Aufgaben-Daten.' }, { status: 400 });
    }

    // Load the existing submission to verify and get max points
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

    // Verify teacher ownership
    if (submission.exam.class.teacherId !== session.userId) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 403 });
    }

    // Run dynamic point updates and Swiss grade recalculation in a single transaction
    const updatedSubmission = await db.$transaction(async (tx) => {
      let totalEarnedPoints = 0;
      const stepUpdatePromises: Promise<unknown>[] = [];
      const taskUpdatePromises: Promise<unknown>[] = [];

      for (const updatedTask of aufgaben) {
        let taskPoints = Math.round((updatedTask.erzieltePunkte || 0) * 10) / 10;

        // 1. Update individual steps (scoped to this submissionId to prevent cross-submission IDOR)
        if (Array.isArray(updatedTask.schritte) && updatedTask.schritte.length > 0) {
          let stepSum = 0;
          for (const updatedStep of updatedTask.schritte) {
            // Round input points to 1 decimal place to handle JS precision errors
            const roundedInputPoints = Math.round(updatedStep.erreichtePunkte * 10) / 10;
            // Clamp points between 0 and max
            const clampedPoints = Math.max(
              0,
              Math.min(updatedStep.maximalPunkte, roundedInputPoints)
            );
            stepSum += clampedPoints;

            // If step ID is present, scope update to steps belonging to this submission
            if (updatedStep.id) {
              const normalizedStep = normalizeStepFeedbackConsistency({
                id: updatedStep.id,
                schrittIndex: updatedStep.schrittIndex ?? 0,
                schrittText: updatedStep.schrittText ?? '',
                istKorrekt: Boolean(updatedStep.istKorrekt),
                fehlerTyp: updatedStep.fehlerTyp || 'KeinFehler',
                erreichtePunkte: clampedPoints,
                maximalPunkte: updatedStep.maximalPunkte,
                begruendung: updatedStep.begruendung ?? '',
              });

              stepUpdatePromises.push(
                tx.stepCorrection.updateMany({
                  where: {
                    id: updatedStep.id,
                    taskCorrection: {
                      submissionId: submissionId,
                    },
                  },
                  data: {
                    erreichtePunkte: clampedPoints,
                    begruendung: normalizedStep.begruendung,
                    fehlerTyp: normalizedStep.fehlerTyp,
                    istUnsicher:
                      updatedStep.istUnsicher !== undefined
                        ? Boolean(updatedStep.istUnsicher)
                        : undefined,
                    unsicherheitsGrund:
                      updatedStep.istUnsicher !== undefined
                        ? updatedStep.istUnsicher
                          ? updatedStep.unsicherheitsGrund || null
                          : null
                        : undefined,
                  },
                })
              );
            }
          }
          taskPoints = Math.round(stepSum * 10) / 10;
        }

        totalEarnedPoints = Math.round((totalEarnedPoints + taskPoints) * 10) / 10;

        // 2. Update parent TaskCorrection
        taskUpdatePromises.push(
          tx.taskCorrection.updateMany({
            where: {
              submissionId: submissionId,
              taskId: updatedTask.aufgabeId,
            },
            data: {
              erzieltePunkte: taskPoints,
              lehrerKommentar: updatedTask.lehrerKommentar || '',
              status: updatedTask.status,
            },
          })
        );
      }

      await Promise.all([...stepUpdatePromises, ...taskUpdatePromises]);

      // 3. Recalculate Schweizer Schulnote using exam's configured formula and rounding
      const maxScore = submission.exam.maxPoints;
      const rawGrade = calculateRawSwissGrade(
        totalEarnedPoints,
        maxScore,
        submission.exam.gradingFormula
      );
      const roundedGrade = calculateSwissGrade(
        totalEarnedPoints,
        maxScore,
        submission.exam.gradingFormula,
        submission.exam.gradeRounding
      );

      // 4. Update the Submission details
      const finalSubmission = await tx.submission.update({
        where: { id: submissionId },
        data: {
          earnedPoints: totalEarnedPoints,
          gradeRaw: rawGrade,
          gradeRounded: roundedGrade,
          helpfulTip:
            schuelerFeedback?.hilfreicherTipp !== undefined
              ? schuelerFeedback.hilfreicherTipp
              : undefined,
          exerciseRecommendation:
            schuelerFeedback?.uebungsEmpfehlung !== undefined
              ? schuelerFeedback.uebungsEmpfehlung
              : undefined,
        },
      });

      return finalSubmission;
    });

    await invalidateSubmissionCache(session.userId, {
      submissionId,
      examId: submission.examId,
      classId: submission.exam.classId,
      studentId: submission.studentId || undefined,
    });

    return NextResponse.json({
      success: true,
      earnedPoints: updatedSubmission.earnedPoints,
      gradeRounded: updatedSubmission.gradeRounded,
    });
  } catch (error) {
    console.error('Error updating submission:', error);
    return NextResponse.json({ error: 'Speichern fehlgeschlagen.' }, { status: 500 });
  }
}

// PATCH: Update studentId (and optionally examId) for manual mapping / AI Auto-Matching override
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }

    const { id: submissionId } = await params;
    const body = await request.json();
    const { studentId, examId: newExamId, overwrite } = body;
    const shouldOverwrite = overwrite === true;

    if (!studentId) {
      return NextResponse.json({ error: 'Schüler-ID fehlt.' }, { status: 400 });
    }

    // Load the submission
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

    // Verify ownership
    if (submission.exam.class.teacherId !== session.userId) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 403 });
    }

    let targetExamId = submission.examId;
    let targetClassId = submission.exam.classId;
    let examChanged = false;

    if (newExamId && newExamId !== submission.examId) {
      const targetExam = await db.exam.findFirst({
        where: {
          id: newExamId,
          class: {
            teacherId: session.userId,
          },
        },
      });
      if (!targetExam) {
        return NextResponse.json({ error: 'Zielprüfung nicht gefunden.' }, { status: 404 });
      }
      targetExamId = targetExam.id;
      targetClassId = targetExam.classId;
      examChanged = true;
    }

    // Verify student exists in the target class
    const student = await db.student.findUnique({
      where: { id: studentId },
    });

    if (!student || student.classId !== targetClassId) {
      return NextResponse.json({ error: 'Ungültiger Schüler für diese Klasse.' }, { status: 400 });
    }

    // Check if a submission already exists for this exam and student
    const existingSubmission = await db.submission.findFirst({
      where: {
        examId: targetExamId,
        studentId: studentId,
        id: { not: submissionId },
      },
    });

    if (existingSubmission && !shouldOverwrite) {
      return NextResponse.json(
        {
          error: `Für Schüler/in "${student.name}" existiert bereits eine Korrektur für diese Prüfung. Klicke auf 'Korrektur ersetzen', um sie zu überschreiben.`,
          code: 'DUPLICATE_SUBMISSION',
          existingSubmissionId: existingSubmission.id,
          studentId: student.id,
          studentName: student.name,
          examId: targetExamId,
        },
        { status: 409 }
      );
    }

    let deletedDuplicateIds: string[] = [];

    if (shouldOverwrite) {
      const examOtherSubmissions =
        typeof db.submission.findMany === 'function'
          ? await db.submission.findMany({
              where: {
                examId: targetExamId,
                id: { not: submissionId },
              },
            })
          : existingSubmission
            ? [existingSubmission]
            : [];

      const normName = (s?: string | null) => (s || '').trim().toLowerCase();
      const currentNormName = normName(submission.extractedStudentName);

      const duplicatesToDelete = examOtherSubmissions.filter((other) => {
        if (other.studentId === studentId) return true;
        if (
          !other.studentId &&
          (other.targetStudentId === studentId || other.suggestedStudentId === studentId)
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
          submission.status === 'COMPLETED' &&
          Math.abs((other.earnedPoints ?? 0) - (submission.earnedPoints ?? 0)) < 0.01 &&
          other.gradeRounded === submission.gradeRounded &&
          normName(other.extractedStudentName) === currentNormName
        ) {
          return true;
        }
        return false;
      });

      deletedDuplicateIds = duplicatesToDelete.map((d) => d.id);

      const filesToClean = duplicatesToDelete.filter(
        (d) => d.studentExamUrl && d.studentExamUrl !== submission.studentExamUrl
      );
      if (filesToClean.length > 0) {
        try {
          await deleteSubmissionScanFiles(
            filesToClean.map((d) => ({ id: d.id, studentExamUrl: d.studentExamUrl }))
          );
        } catch (cleanupErr) {
          console.warn('Non-fatal scan cleanup warning during overwrite:', cleanupErr);
        }
      }
    }

    const executeUpdate = async (client: typeof db) => {
      if (deletedDuplicateIds.length > 0) {
        if (typeof client.correctionLog?.updateMany === 'function') {
          await client.correctionLog.updateMany({
            where: { submissionId: { in: deletedDuplicateIds } },
            data: { submissionId: null },
          });
        }
        if (typeof client.submission.deleteMany === 'function') {
          await client.submission.deleteMany({
            where: { id: { in: deletedDuplicateIds } },
          });
        } else {
          for (const dupId of deletedDuplicateIds) {
            await client.submission.delete({ where: { id: dupId } });
          }
        }
      }

      const updatedSub = await client.submission.update({
        where: { id: submissionId },
        data: {
          examId: targetExamId,
          studentId,
          targetStudentId: null,
          suggestedStudentId: studentId,
          isStudentMatchUncertain: false,
          isExamMatchUncertain: false,
        },
        include: { student: true },
      });

      if (typeof client.correctionLog?.updateMany === 'function') {
        await client.correctionLog.updateMany({
          where: { submissionId },
          data: {
            studentName: student.name,
            ...(deletedDuplicateIds.length > 0 ? { actionType: 'ERSETZT' } : {}),
          },
        });
      }

      return updatedSub;
    };

    const updated =
      typeof db.$transaction === 'function'
        ? await db.$transaction(async (tx) => executeUpdate(tx as unknown as typeof db))
        : await executeUpdate(db);

    await invalidateSubmissionCache(session.userId, {
      submissionId,
      examId: submission.examId,
      classId: submission.exam.classId,
      studentId: submission.studentId || studentId || undefined,
    });
    if (examChanged) {
      await invalidateSubmissionCache(session.userId, {
        submissionId,
        examId: targetExamId,
        classId: targetClassId,
        studentId,
      });
    }
    if (deletedDuplicateIds.length > 0) {
      await invalidateLogsCache(session.userId);
    }

    return NextResponse.json({
      success: true,
      replaced: deletedDuplicateIds.length > 0,
      deletedDuplicateIds,
      studentId: updated.studentId,
      studentName: updated.student?.name,
      examId: updated.examId,
      examChanged,
    });
  } catch (error) {
    console.error('Error assigning student to submission:', error);
    return NextResponse.json({ error: 'Zuweisung fehlgeschlagen.' }, { status: 500 });
  }
}

// DELETE: Delete a submission entirely
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }

    const { id: submissionId } = await params;

    // Load the submission to verify ownership
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

    // Verify ownership
    if (submission.exam.class.teacherId !== session.userId) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 403 });
    }

    // Storage-Bereinigung VOR der DB-Loeschung ausfuehren.
    // Schlaegt das Loeschen im Storage fehl, bricht der Vorgang ab und die DB-Referenz bleibt erhalten.
    await deleteSubmissionScanFiles([
      { id: submissionId, studentExamUrl: submission.studentExamUrl },
    ]);

    // If the submission is active, mark the corresponding decoupled logs as CANCELLED
    if (submission.status === 'PENDING' || submission.status === 'PROCESSING') {
      const durationMs = Date.now() - new Date(submission.createdAt).getTime();
      await db.correctionLog.updateMany({
        where: { submissionId: submission.id },
        data: {
          status: 'CANCELLED',
          durationMs,
        },
      });
    }

    // Nullify submissionId on associated logs to safely decoupling them before deletion
    await db.correctionLog.updateMany({
      where: { submissionId: submission.id },
      data: { submissionId: null },
    });

    // Delete the submission (cascade will delete task and step corrections)
    await db.submission.delete({
      where: { id: submissionId },
    });

    await invalidateSubmissionCache(session.userId, {
      submissionId,
      examId: submission.examId,
      classId: submission.exam.classId,
      studentId: submission.studentId || undefined,
    });
    await invalidateLogsCache(session.userId);

    return NextResponse.json({ success: true, message: 'Korrektur erfolgreich gelöscht.' });
  } catch (error) {
    if (error instanceof StorageCleanupError) {
      console.error(
        'Storage-Bereinigung beim Löschen der Korrektur fehlgeschlagen:',
        error.failedFiles
      );
      return NextResponse.json(
        {
          error:
            'Löschen der zugehörigen Scan-Dateien fehlgeschlagen. Die Korrektur wurde in der Datenbank nicht gelöscht, um verwaiste Daten zu verhindern.',
          failedFiles: error.failedFiles,
        },
        { status: 500 }
      );
    }

    console.error('Error deleting submission:', error);
    return NextResponse.json({ error: 'Löschen fehlgeschlagen.' }, { status: 500 });
  }
}
