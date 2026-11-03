import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireVerifiedEmailForApi } from '@/lib/email-verification';
import { serverCache, CacheTags, invalidateStudentCache, invalidateLogsCache } from '@/lib/cache';
import { deleteStudentScanFiles, StorageCleanupError } from '@/lib/storage-cleanup';
import { isClassArchived } from '@/lib/class-archive';

// GET: Fetch student details, analytics, grade trajectory, and AI feedback aggregation
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }
    const unverifiedResponse = await requireVerifiedEmailForApi(session.userId, request);
    if (unverifiedResponse) return unverifiedResponse;

    const { id: studentId } = await params;

    const cacheKey = `teacher:${session.userId}:student:${studentId}:detail`;
    const cached = await serverCache.get<{
      student: unknown;
      stats: unknown;
      trajectory: unknown;
      submissions: unknown;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // Fetch student and verify teacher ownership
    const student = await db.student.findUnique({
      where: { id: studentId },
      include: {
        class: true,
        submissions: {
          include: {
            exam: true,
          },
          orderBy: {
            createdAt: 'asc', // Chronological order for trajectory plotting
          },
        },
      },
    });

    if (!student) {
      return NextResponse.json({ error: 'Schüler nicht gefunden.' }, { status: 404 });
    }

    // Verify teacher owns the student's class
    if (student.class.teacherId !== session.userId) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 403 });
    }

    // 1. Filter completed submissions for calculations
    const completedSubmissions = student.submissions.filter((s) => s.status === 'COMPLETED');
    const totalExamsCorrected = completedSubmissions.length;

    let averageGrade = 0;
    const strengthsSet = new Set<string>();
    const weaknessesSet = new Set<string>();
    const helpfulTips: string[] = [];

    if (totalExamsCorrected > 0) {
      const sum = completedSubmissions.reduce((a, b) => a + b.gradeRaw, 0);
      averageGrade = sum / totalExamsCorrected;

      completedSubmissions.forEach((s) => {
        s.strengths.forEach((st) => strengthsSet.add(st));
        s.weaknesses.forEach((we) => weaknessesSet.add(we));
        if (s.helpfulTip) helpfulTips.push(s.helpfulTip);
      });
    }

    // 2. Fetch the class average for comparison
    const allClassSubmissions = await db.submission.findMany({
      where: {
        status: 'COMPLETED',
        student: {
          classId: student.classId,
        },
      },
    });

    let classAverage = 0;
    if (allClassSubmissions.length > 0) {
      const sum = allClassSubmissions.reduce((a, b) => a + b.gradeRaw, 0);
      classAverage = sum / allClassSubmissions.length;
    }

    // 3. Map trajectory for MUI Line Chart
    const trajectory = completedSubmissions.map((s) => ({
      id: s.id,
      date: s.createdAt.toLocaleDateString('de-CH'),
      examTitle: s.exam.title,
      grade: s.gradeRaw, // Numeric value for line chart
      gradeRounded: s.gradeRounded, // Display string
      earnedPoints: s.earnedPoints,
      maxPoints: s.exam.maxPoints,
    }));

    // 4. Detailed submission list
    const submissionsList = student.submissions.map((s) => ({
      id: s.id,
      examId: s.examId,
      examTitle: s.exam.title,
      subject: s.exam.subject,
      status: s.status,
      grade: s.gradeRounded,
      points: `${s.earnedPoints.toFixed(1)} / ${s.exam.maxPoints}`,
      date: s.createdAt.toLocaleDateString('de-CH'),
    }));

    const isArchived =
      (await isClassArchived(student.classId)) ||
      Boolean((student.class as { archivedAt?: Date | string | null })?.archivedAt);

    const responsePayload = {
      student: {
        id: student.id,
        name: student.name,
        classId: student.classId,
        className: student.class.name,
        isClassArchived: isArchived,
        createdAt: student.createdAt.toLocaleDateString('de-CH'),
      },
      stats: {
        averageGrade: averageGrade > 0 ? averageGrade.toFixed(2) : 'N/A',
        classAverage: classAverage > 0 ? classAverage.toFixed(2) : 'N/A',
        totalExamsCorrected,
        status:
          totalExamsCorrected > 0
            ? averageGrade >= 4.0
              ? 'Genügend'
              : 'Ungenügend'
            : 'Keine Daten',
        strengths: Array.from(strengthsSet),
        weaknesses: Array.from(weaknessesSet),
        helpfulTips,
      },
      trajectory,
      submissions: submissionsList,
    };

    await serverCache.set(cacheKey, responsePayload, {
      tags: [
        CacheTags.teacher(session.userId),
        CacheTags.students(session.userId),
        CacheTags.student(session.userId, studentId),
        CacheTags.class(session.userId, student.classId),
      ],
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('Error fetching student details:', error);
    return NextResponse.json({ error: 'Fehler beim Laden der Schülerdetails.' }, { status: 500 });
  }
}

// PUT: Update student name or transfer class
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }
    const unverifiedResponse = await requireVerifiedEmailForApi(session.userId, request);
    if (unverifiedResponse) return unverifiedResponse;

    const { id: studentId } = await params;
    const body = await request.json();
    const { name, classId } = body;

    // Fetch existing student
    const student = await db.student.findUnique({
      where: { id: studentId },
      include: { class: true },
    });

    if (!student) {
      return NextResponse.json({ error: 'Schüler nicht gefunden.' }, { status: 404 });
    }

    // Verify teacher owns current class
    if (student.class.teacherId !== session.userId) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 403 });
    }

    if (
      (await isClassArchived(student.classId)) ||
      Boolean((student.class as { archivedAt?: Date | string | null })?.archivedAt)
    ) {
      return NextResponse.json(
        {
          error:
            'Archivierte Klassen sind schreibgeschützt. Schüler/innen können nicht bearbeitet oder verschoben werden.',
        },
        { status: 400 }
      );
    }

    // If transferring class, verify teacher owns new class
    if (classId && classId !== student.classId) {
      const newClass = await db.class.findFirst({
        where: { id: classId, teacherId: session.userId },
      });
      if (!newClass) {
        return NextResponse.json({ error: 'Neue Klasse nicht gefunden.' }, { status: 404 });
      }
      if (
        (await isClassArchived(classId)) ||
        Boolean((newClass as { archivedAt?: Date | string | null })?.archivedAt)
      ) {
        return NextResponse.json(
          {
            error: 'Schüler/innen können nicht in eine archivierte Klasse verschoben werden.',
          },
          { status: 400 }
        );
      }
    }

    const updatedStudent = await db.student.update({
      where: { id: studentId },
      data: {
        name: name !== undefined ? name.trim() : undefined,
        classId: classId !== undefined ? classId : undefined,
      },
    });

    await invalidateStudentCache(session.userId, studentId, student.classId);
    if (classId && classId !== student.classId) {
      await invalidateStudentCache(session.userId, studentId, classId);
    }

    return NextResponse.json({ success: true, student: updatedStudent });
  } catch (error) {
    console.error('Error updating student:', error);
    return NextResponse.json({ error: 'Fehler beim Aktualisieren des Schülers.' }, { status: 500 });
  }
}

// DELETE: Delete student (cleans up scan files in storage, then cascade deletes submissions)
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }
    const unverifiedResponse = await requireVerifiedEmailForApi(session.userId, request);
    if (unverifiedResponse) return unverifiedResponse;

    const { id: studentId } = await params;

    // Fetch existing student
    const student = await db.student.findUnique({
      where: { id: studentId },
      include: { class: true },
    });

    if (!student) {
      return NextResponse.json({ error: 'Schüler nicht gefunden.' }, { status: 404 });
    }

    // Verify teacher owns class
    if (student.class.teacherId !== session.userId) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 403 });
    }

    if (
      (await isClassArchived(student.classId)) ||
      Boolean((student.class as { archivedAt?: Date | string | null })?.archivedAt)
    ) {
      return NextResponse.json(
        {
          error:
            'Archivierte Klassen sind schreibgeschützt. Schüler/innen können nicht gelöscht werden.',
        },
        { status: 400 }
      );
    }

    // Storage-Bereinigung VOR der DB-Kaskadenloeschung ausfuehren.
    // Schlaegt das Loeschen im Storage fehl, bricht der Vorgang ab und die DB-Referenzen bleiben erhalten.
    await deleteStudentScanFiles(studentId);

    await db.student.delete({
      where: { id: studentId },
    });

    await invalidateStudentCache(session.userId, studentId, student.classId);
    await invalidateLogsCache(session.userId);

    return NextResponse.json({ success: true, message: 'Schüler erfolgreich gelöscht.' });
  } catch (error) {
    if (error instanceof StorageCleanupError) {
      console.error(
        'Storage-Bereinigung beim Löschen des Schülers fehlgeschlagen:',
        error.failedFiles
      );
      return NextResponse.json(
        {
          error:
            'Löschen der zugehörigen Scan-Dateien fehlgeschlagen. Der Schüler wurde in der Datenbank nicht gelöscht, um verwaiste Daten zu verhindern.',
          failedFiles: error.failedFiles,
        },
        { status: 500 }
      );
    }

    console.error('Error deleting student:', error);
    return NextResponse.json({ error: 'Fehler beim Löschen des Schülers.' }, { status: 500 });
  }
}
