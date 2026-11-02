import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { serverCache, CacheTags, invalidateClassCache, invalidateLogsCache } from '@/lib/cache';
import { deleteClassScanFiles, StorageCleanupError } from '@/lib/storage-cleanup';
import { validateClassName } from '@/lib/payload-limits';
import { computeClassSubjectBreakdown } from '@/lib/grading';
import {
  getClassSavedSubjects,
  saveClassSubjects,
  deleteClassSubjects,
} from '@/lib/teacher-subjects';

// GET: Fetch class details, students roster, and class statistics
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }

    const { id: classId } = await params;

    const cacheKey = `teacher:${session.userId}:class:${classId}:detail`;
    const cached = await serverCache.get<{
      class: unknown;
      stats: unknown;
      students: unknown;
      exams: unknown;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // Verify class belongs to this teacher
    const schoolClass = await db.class.findFirst({
      where: { id: classId, teacherId: session.userId },
      include: {
        students: {
          include: {
            submissions: {
              where: { status: 'COMPLETED' },
              include: { exam: true },
            },
          },
          orderBy: { name: 'asc' },
        },
        exams: {
          include: {
            submissions: {
              where: { status: 'COMPLETED', studentId: { not: null } },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!schoolClass) {
      return NextResponse.json({ error: 'Klasse nicht gefunden.' }, { status: 404 });
    }

    // 1. Calculate stats across all completed submissions for this class
    const allCompletedSubmissions = schoolClass.students.flatMap((s) => s.submissions);
    const totalSubmissions = allCompletedSubmissions.length;

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

    if (totalSubmissions > 0) {
      const grades = allCompletedSubmissions.map((sub) => sub.gradeRaw);
      const sum = grades.reduce((a, b) => a + b, 0);
      averageGrade = sum / totalSubmissions;

      grades.forEach((g) => {
        if (g >= 4.0) passingCount++;
        if (g > highestGrade) highestGrade = g;
        if (g < lowestGrade) lowestGrade = g;

        // Bucketing for distribution (clamped to [1.0, 6.0] Swiss scale)
        const clampedG = Math.min(6.0, Math.max(1.0, g));
        if (clampedG >= 1.0 && clampedG < 2.0) gradeDistribution['1.0-2.0']++;
        else if (clampedG >= 2.0 && clampedG < 3.0) gradeDistribution['2.0-3.0']++;
        else if (clampedG >= 3.0 && clampedG < 4.0) gradeDistribution['3.0-4.0']++;
        else if (clampedG >= 4.0 && clampedG < 5.0) gradeDistribution['4.0-5.0']++;
        else if (clampedG >= 5.0 && clampedG <= 6.0) gradeDistribution['5.0-6.0']++;
      });

      // Calculate Standard Deviation
      const variance =
        grades.reduce((sqSum, val) => sqSum + Math.pow(val - averageGrade, 2), 0) /
        totalSubmissions;
      stdDev = Math.sqrt(variance);
    } else {
      lowestGrade = 0;
    }

    // 2. Format students roster with individual averages
    const studentsRoster = schoolClass.students.map((student) => {
      const completedSubmissions = student.submissions;
      let studentAvg = 0;
      if (completedSubmissions.length > 0) {
        const sum = completedSubmissions.reduce((a, b) => a + b.gradeRaw, 0);
        studentAvg = sum / completedSubmissions.length;
      }

      return {
        id: student.id,
        name: student.name,
        totalExamsCorrected: completedSubmissions.length,
        averageGrade: studentAvg > 0 ? studentAvg.toFixed(2) : 'N/A',
      };
    });

    // 3. Format exams list with averages (only completed submissions assigned to a student)
    const examsList = schoolClass.exams.map((exam) => {
      const subs = exam.submissions.filter((s) => !('studentId' in s) || Boolean(s.studentId));
      let examAvg = 0;
      if (subs.length > 0) {
        const sum = subs.reduce((a, b) => a + b.gradeRaw, 0);
        examAvg = sum / subs.length;
      }

      return {
        id: exam.id,
        title: exam.title,
        subject: exam.subject,
        maxPoints: exam.maxPoints,
        createdAt: exam.createdAt.toLocaleDateString('de-CH'),
        submissionsCount: subs.length,
        averageGrade: examAvg > 0 ? examAvg.toFixed(2) : 'N/A',
      };
    });

    const stats = {
      averageGrade: averageGrade > 0 ? averageGrade.toFixed(2) : 'N/A',
      passRate:
        totalSubmissions > 0 ? ((passingCount / totalSubmissions) * 100).toFixed(1) + '%' : '0%',
      highestGrade: highestGrade > 0 ? highestGrade.toFixed(1) : 'N/A',
      lowestGrade: lowestGrade > 0 ? lowestGrade.toFixed(1) : 'N/A',
      stdDev: stdDev > 0 ? stdDev.toFixed(2) : '0.00',
      totalSubmissions,
      gradeDistribution,
    };

    const classSubjects = await getClassSavedSubjects(classId);
    const subjectStats = computeClassSubjectBreakdown(examsList, classSubjects);

    const responsePayload = {
      class: {
        id: schoolClass.id,
        name: schoolClass.name,
        createdAt: schoolClass.createdAt.toLocaleDateString('de-CH'),
        subjects: classSubjects,
      },
      stats,
      subjectStats,
      students: studentsRoster,
      exams: examsList,
    };

    await serverCache.set(cacheKey, responsePayload, {
      tags: [
        CacheTags.teacher(session.userId),
        CacheTags.classes(session.userId),
        CacheTags.class(session.userId, classId),
      ],
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('Error fetching class details:', error);
    return NextResponse.json({ error: 'Fehler beim Laden der Klassendetails.' }, { status: 500 });
  }
}

// PUT: Update class name
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }

    const { id: classId } = await params;
    const body = await request.json();
    const { name } = body;

    const validation = validateClassName(name);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: validation.status || 400 });
    }

    // Verify class ownership
    const schoolClass = await db.class.findFirst({
      where: { id: classId, teacherId: session.userId },
    });

    if (!schoolClass) {
      return NextResponse.json({ error: 'Klasse nicht gefunden.' }, { status: 404 });
    }

    const trimmedName = (name as string).trim();
    const updatedClass = await db.class.update({
      where: { id: classId },
      data: { name: trimmedName },
    });

    const savedSubjects = Array.isArray(body.subjects)
      ? await saveClassSubjects(classId, body.subjects)
      : undefined;

    await invalidateClassCache(session.userId, classId);

    return NextResponse.json({
      success: true,
      class:
        savedSubjects !== undefined ? { ...updatedClass, subjects: savedSubjects } : updatedClass,
    });
  } catch (error) {
    console.error('Error updating class:', error);
    return NextResponse.json({ error: 'Fehler beim Aktualisieren der Klasse.' }, { status: 500 });
  }
}

export const PATCH = PUT;

// DELETE: Delete class (cleans up scan files in storage, then cascade deletes all students, exams, and submissions via Prisma)
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }

    const { id: classId } = await params;

    // Verify class ownership
    const schoolClass = await db.class.findFirst({
      where: { id: classId, teacherId: session.userId },
    });

    if (!schoolClass) {
      return NextResponse.json({ error: 'Klasse nicht gefunden.' }, { status: 404 });
    }

    // Storage-Bereinigung VOR der DB-Kaskadenloeschung ausfuehren.
    // Schlaegt das Loeschen im Storage fehl, bricht der Vorgang ab und die DB-Referenzen bleiben erhalten.
    await deleteClassScanFiles(classId);

    await db.class.delete({
      where: { id: classId },
    });
    await deleteClassSubjects(classId);

    await invalidateClassCache(session.userId, classId);
    await invalidateLogsCache(session.userId);

    return NextResponse.json({ success: true, message: 'Klasse erfolgreich gelöscht.' });
  } catch (error) {
    if (error instanceof StorageCleanupError) {
      console.error(
        'Storage-Bereinigung beim Löschen der Klasse fehlgeschlagen:',
        error.failedFiles
      );
      return NextResponse.json(
        {
          error:
            'Löschen der zugehörigen Scan-Dateien fehlgeschlagen. Die Klasse wurde in der Datenbank nicht gelöscht, um verwaiste Daten zu verhindern.',
          failedFiles: error.failedFiles,
        },
        { status: 500 }
      );
    }

    console.error('Error deleting class:', error);
    return NextResponse.json({ error: 'Fehler beim Löschen der Klasse.' }, { status: 500 });
  }
}
