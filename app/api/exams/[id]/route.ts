import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { computeTaskAnalysis } from '@/lib/task-analysis';
import { serverCache, CacheTags, invalidateExamCache, invalidateLogsCache } from '@/lib/cache';
import { parseExamMetadata, embedExamMetadata } from '@/lib/exam-meta';
import { deleteExamScanFiles, StorageCleanupError } from '@/lib/storage-cleanup';
import { isClassArchived } from '@/lib/class-archive';

// GET: Fetch exam details, statistics, and submissions tracking (all class students)
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }

    const { id: examId } = await params;

    const cacheKey = `teacher:${session.userId}:exam:${examId}:detail`;
    const cached = await serverCache.get<{
      exam: unknown;
      stats: unknown;
      roster: unknown;
      taskAnalysis: unknown;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const exam = await db.exam.findUnique({
      where: { id: examId },
      include: {
        class: {
          include: {
            students: true,
          },
        },
        submissions: {
          include: {
            student: true,
            tasks: {
              orderBy: {
                orderIndex: 'asc',
              },
              include: {
                schritte: {
                  orderBy: {
                    schrittIndex: 'asc',
                  },
                },
              },
            },
          },
        },
        tasks: {
          orderBy: {
            orderIndex: 'asc',
          },
        },
      },
    });

    if (!exam) {
      return NextResponse.json({ error: 'Prüfung nicht gefunden.' }, { status: 404 });
    }

    // Verify teacher owns class
    if (exam.class.teacherId !== session.userId) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 403 });
    }

    // 1. Calculate stats across COMPLETED submissions assigned to a student for this exam
    const completedSubmissions = exam.submissions.filter(
      (s) => s.status === 'COMPLETED' && (!('studentId' in s) || Boolean(s.studentId))
    );
    const totalCompleted = completedSubmissions.length;

    let averageGrade = 0;
    let passingCount = 0;
    let highestGrade = 0;
    let lowestGrade = 6.0;
    let stdDev = 0;
    const gradeDistribution = {
      '1.0-2.0': 0,
      '2.0-3.0': 0,
      '3.0-4.0': 0,
      '4.0-5.0': 0,
      '5.0-6.0': 0,
    };

    if (totalCompleted > 0) {
      const grades = completedSubmissions.map((sub) => sub.gradeRaw);
      const sum = grades.reduce((a, b) => a + b, 0);
      averageGrade = sum / totalCompleted;

      grades.forEach((g) => {
        if (g >= 4.0) passingCount++;
        if (g > highestGrade) highestGrade = g;
        if (g < lowestGrade) lowestGrade = g;

        // Bucketing for distribution histogram (clamped to [1.0, 6.0] Swiss scale)
        const clampedG = Math.min(6.0, Math.max(1.0, g));
        if (clampedG >= 1.0 && clampedG < 2.0) gradeDistribution['1.0-2.0']++;
        else if (clampedG >= 2.0 && clampedG < 3.0) gradeDistribution['2.0-3.0']++;
        else if (clampedG >= 3.0 && clampedG < 4.0) gradeDistribution['3.0-4.0']++;
        else if (clampedG >= 4.0 && clampedG < 5.0) gradeDistribution['4.0-5.0']++;
        else if (clampedG >= 5.0 && clampedG <= 6.0) gradeDistribution['5.0-6.0']++;
      });

      // Calculate Standard Deviation
      const variance =
        grades.reduce((sqSum, val) => sqSum + Math.pow(val - averageGrade, 2), 0) / totalCompleted;
      stdDev = Math.sqrt(variance);
    } else {
      lowestGrade = 0;
    }

    // 2. Track submission status for ALL class students (to identify who has NOT taken/completed the exam)
    const submissionsTracker = exam.class.students.map((student) => {
      const existingSub = exam.submissions.find((s) => s.studentId === student.id);

      return {
        studentId: student.id,
        studentName: student.name,
        submissionId: existingSub?.id || null,
        status: existingSub ? existingSub.status : 'UNSTARTED', // COMPLETED, DRAFT, UNSTARTED
        grade: existingSub && existingSub.status === 'COMPLETED' ? existingSub.gradeRounded : 'N/A',
        earnedPoints: existingSub ? existingSub.earnedPoints.toFixed(1) : 'N/A',
        date: existingSub ? existingSub.createdAt.toLocaleDateString('de-CH') : 'N/A',
        uncertainStepsCount: existingSub
          ? existingSub.tasks.reduce(
              (sum, t) => sum + t.schritte.filter((s) => s.istUnsicher).length,
              0
            )
          : 0,
      };
    });

    const stats = {
      averageGrade: averageGrade > 0 ? averageGrade.toFixed(2) : 'N/A',
      passRate:
        totalCompleted > 0 ? ((passingCount / totalCompleted) * 100).toFixed(1) + '%' : '0%',
      highestGrade: highestGrade > 0 ? highestGrade.toFixed(1) : 'N/A',
      lowestGrade: lowestGrade > 0 ? lowestGrade.toFixed(1) : 'N/A',
      stdDev: stdDev > 0 ? stdDev.toFixed(2) : '0.00',
      totalCompleted,
      totalStudents: exam.class.students.length,
      gradeDistribution,
    };

    const { metadata, cleanNotes } = parseExamMetadata(exam.gradingNotes);
    const enrichedTasks = exam.tasks.map((t) => ({
      ...t,
      sourceReference: metadata.taskSources?.[t.taskId] || null,
    }));
    const taskAnalysis = computeTaskAnalysis(enrichedTasks, exam.submissions);

    const isArchived =
      (await isClassArchived(exam.classId)) ||
      Boolean((exam.class as { archivedAt?: Date | string | null })?.archivedAt);

    const responsePayload = {
      exam: {
        id: exam.id,
        title: exam.title,
        subject: exam.subject,
        maxPoints: exam.maxPoints,
        rubricText: exam.rubricText,
        examTemplateText: exam.examTemplateText,
        gradingNotes: cleanNotes,
        rawGradingNotes: exam.gradingNotes,
        isGenerated: metadata.isGenerated,
        isApproved: metadata.isApproved,
        approvedAt: metadata.approvedAt,
        generatorParams: metadata.generatorParams,
        taskSources: metadata.taskSources,
        gradingFormula: exam.gradingFormula,
        gradeRounding: exam.gradeRounding,
        classId: exam.classId,
        className: exam.class.name,
        isClassArchived: isArchived,
        createdAt: exam.createdAt.toLocaleDateString('de-CH'),
        tasks: enrichedTasks,
      },
      stats,
      roster: submissionsTracker,
      taskAnalysis,
    };

    await serverCache.set(cacheKey, responsePayload, {
      tags: [
        CacheTags.teacher(session.userId),
        CacheTags.exams(session.userId),
        CacheTags.exam(session.userId, examId),
        CacheTags.class(session.userId, exam.classId),
      ],
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('Error fetching exam details:', error);
    return NextResponse.json({ error: 'Fehler beim Laden der Prüfungsdetails.' }, { status: 500 });
  }
}

// PUT: Update exam fields or rubric text
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }

    const { id: examId } = await params;
    const body = await request.json();
    const {
      title,
      subject,
      rubricText,
      examTemplateText,
      gradingNotes,
      gradingFormula,
      gradeRounding,
      maxPoints,
      tasks,
    } = body;

    // Fetch existing exam
    const exam = await db.exam.findUnique({
      where: { id: examId },
      include: { class: true },
    });

    if (!exam) {
      return NextResponse.json({ error: 'Prüfung nicht gefunden.' }, { status: 404 });
    }

    // Verify teacher owns class
    if (exam.class.teacherId !== session.userId) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 403 });
    }

    if (
      (await isClassArchived(exam.classId)) ||
      Boolean((exam.class as { archivedAt?: Date | string | null })?.archivedAt)
    ) {
      return NextResponse.json(
        {
          error:
            'Archivierte Klassen sind schreibgeschützt. Prüfungen können nicht bearbeitet werden.',
        },
        { status: 400 }
      );
    }

    const { metadata: existingMeta } = parseExamMetadata(exam.gradingNotes);

    // Freezing gate: Approved generated exams are strictly immutable
    if (existingMeta.isGenerated && existingMeta.isApproved) {
      return NextResponse.json(
        {
          error:
            'Eingefrorene Prüfungen können nicht nachträglich verändert werden. Der Stand ist finalisiert.',
        },
        { status: 400 }
      );
    }

    const finalGradingNotes =
      gradingNotes !== undefined ? embedExamMetadata(gradingNotes, existingMeta) : undefined;

    let finalMaxPoints = Number(maxPoints) !== undefined ? Number(maxPoints) : exam.maxPoints;
    if (Array.isArray(tasks)) {
      finalMaxPoints = tasks.reduce((sum, t) => sum + (Number(t.maxPoints) || 0), 0);
    }

    if (finalMaxPoints <= 0) {
      return NextResponse.json({ error: 'Maximale Punktzahl muss positiv sein.' }, { status: 400 });
    }

    const updatedExam = await db.$transaction(async (tx) => {
      const updated = await tx.exam.update({
        where: { id: examId },
        data: {
          title: title !== undefined ? title.trim() : undefined,
          subject: subject !== undefined ? subject.trim() : undefined,
          rubricText: rubricText !== undefined ? rubricText : undefined,
          examTemplateText: examTemplateText !== undefined ? examTemplateText : undefined,
          gradingNotes: finalGradingNotes,
          gradingFormula: gradingFormula !== undefined ? gradingFormula : undefined,
          gradeRounding: gradeRounding !== undefined ? gradeRounding : undefined,
          maxPoints: finalMaxPoints,
        },
      });

      if (Array.isArray(tasks)) {
        // Delete all old tasks
        await tx.examTask.deleteMany({
          where: { examId },
        });

        // Recreate new tasks
        if (tasks.length > 0) {
          await tx.examTask.createMany({
            data: tasks.map((t, index) => ({
              examId,
              taskId: String(t.taskId),
              title: t.title || `Aufgabe ${t.taskId}`,
              maxPoints: Number(t.maxPoints),
              orderIndex: index,
            })),
          });
        }
      }

      return updated;
    });

    await invalidateExamCache(session.userId, examId, exam.classId);

    return NextResponse.json({ success: true, exam: updatedExam });
  } catch (error) {
    console.error('Error updating exam:', error);
    return NextResponse.json({ error: 'Fehler beim Aktualisieren der Prüfung.' }, { status: 500 });
  }
}

// DELETE: Delete exam (cleans up scan files in storage, then cascade deletes submissions)
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }

    const { id: examId } = await params;

    // Fetch existing exam
    const exam = await db.exam.findUnique({
      where: { id: examId },
      include: { class: true },
    });

    if (!exam) {
      return NextResponse.json({ error: 'Prüfung nicht gefunden.' }, { status: 404 });
    }

    // Verify teacher owns class
    if (exam.class.teacherId !== session.userId) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 403 });
    }

    if (
      (await isClassArchived(exam.classId)) ||
      Boolean((exam.class as { archivedAt?: Date | string | null })?.archivedAt)
    ) {
      return NextResponse.json(
        {
          error:
            'Archivierte Klassen sind schreibgeschützt. Prüfungen können nicht gelöscht werden.',
        },
        { status: 400 }
      );
    }

    // Storage-Bereinigung VOR der DB-Kaskadenloeschung ausfuehren.
    // Schlaegt das Loeschen im Storage fehl, bricht der Vorgang ab und die DB-Referenzen bleiben erhalten.
    await deleteExamScanFiles(examId);

    await db.exam.delete({
      where: { id: examId },
    });

    await invalidateExamCache(session.userId, examId, exam.classId);
    await invalidateLogsCache(session.userId);

    return NextResponse.json({ success: true, message: 'Prüfung erfolgreich gelöscht.' });
  } catch (error) {
    if (error instanceof StorageCleanupError) {
      console.error(
        'Storage-Bereinigung beim Löschen der Prüfung fehlgeschlagen:',
        error.failedFiles
      );
      return NextResponse.json(
        {
          error:
            'Löschen der zugehörigen Scan-Dateien fehlgeschlagen. Die Prüfung wurde in der Datenbank nicht gelöscht, um verwaiste Daten zu verhindern.',
          failedFiles: error.failedFiles,
        },
        { status: 500 }
      );
    }

    console.error('Error deleting exam:', error);
    return NextResponse.json({ error: 'Fehler beim Löschen der Prüfung.' }, { status: 500 });
  }
}
