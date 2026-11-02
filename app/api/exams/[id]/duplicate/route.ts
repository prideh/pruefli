import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { invalidateExamCache } from '@/lib/cache';
import { isClassArchived } from '@/lib/class-archive';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }

    const { id: examId } = await params;

    let body: {
      title?: string;
      targetClassId?: string;
      subject?: string;
      maxPoints?: number;
      rubricText?: string;
      gradingNotes?: string;
      gradingFormula?: string;
      gradeRounding?: string;
    } = {};

    try {
      body = await request.json();
    } catch {
      // Empty body is acceptable; defaults will be used
      body = {};
    }

    // Fetch source exam with its tasks and class
    const sourceExam = await db.exam.findUnique({
      where: { id: examId },
      include: {
        class: true,
        tasks: {
          orderBy: {
            orderIndex: 'asc',
          },
        },
      },
    });

    if (!sourceExam) {
      return NextResponse.json({ error: 'Prüfung nicht gefunden.' }, { status: 404 });
    }

    // Verify teacher owns the source class
    if (sourceExam.class.teacherId !== session.userId) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 403 });
    }

    // Target class: default to same class as source exam
    let destinationClassId = sourceExam.classId;
    if (body.targetClassId && body.targetClassId.trim() !== '') {
      const targetClass = await db.class.findFirst({
        where: { id: body.targetClassId.trim(), teacherId: session.userId },
      });
      if (!targetClass) {
        return NextResponse.json({ error: 'Zielklasse nicht gefunden.' }, { status: 404 });
      }
      destinationClassId = targetClass.id;
    }

    if (await isClassArchived(destinationClassId)) {
      return NextResponse.json(
        {
          error:
            'Archivierte Klassen sind schreibgeschützt. Prüfungen können nicht in eine archivierte Klasse dupliziert werden.',
        },
        { status: 400 }
      );
    }

    // Title: custom or suffixed "<Titel> (Kopie)"
    const finalTitle =
      body.title && body.title.trim() !== '' ? body.title.trim() : `${sourceExam.title} (Kopie)`;

    // Other fields: override or inherit
    const finalSubject = body.subject?.trim() || sourceExam.subject;
    const finalRubricText = body.rubricText !== undefined ? body.rubricText : sourceExam.rubricText;
    const finalExamTemplateText = sourceExam.examTemplateText;
    const finalGradingNotes =
      body.gradingNotes !== undefined ? body.gradingNotes : sourceExam.gradingNotes;
    const finalGradingFormula = body.gradingFormula || sourceExam.gradingFormula;
    const finalGradeRounding = body.gradeRounding || sourceExam.gradeRounding;
    const finalMaxPoints =
      body.maxPoints !== undefined && Number(body.maxPoints) > 0
        ? Number(body.maxPoints)
        : sourceExam.maxPoints;

    // Create duplicate Exam + ExamTask rows inside a transaction
    // Explicitly NO submissions, NO corrections, NO student logs
    const duplicatedExam = await db.$transaction(async (tx) => {
      const createdExam = await tx.exam.create({
        data: {
          title: finalTitle,
          subject: finalSubject,
          rubricText: finalRubricText,
          examTemplateText: finalExamTemplateText,
          gradingNotes: finalGradingNotes,
          gradingFormula: finalGradingFormula,
          gradeRounding: finalGradeRounding,
          maxPoints: finalMaxPoints,
          classId: destinationClassId,
        },
      });

      if (sourceExam.tasks && sourceExam.tasks.length > 0) {
        await tx.examTask.createMany({
          data: sourceExam.tasks.map((task) => ({
            examId: createdExam.id,
            taskId: task.taskId,
            title: task.title,
            maxPoints: task.maxPoints,
            orderIndex: task.orderIndex,
          })),
        });
      }

      return createdExam;
    });

    await invalidateExamCache(session.userId, duplicatedExam.id, destinationClassId);

    return NextResponse.json({
      success: true,
      exam: duplicatedExam,
      id: duplicatedExam.id,
    });
  } catch (error) {
    console.error('Error duplicating exam:', error);
    return NextResponse.json({ error: 'Fehler beim Duplizieren der Prüfung.' }, { status: 500 });
  }
}
