import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { serverCache, CacheTags, invalidateExamCache } from '@/lib/cache';
import { parseExamMetadata } from '@/lib/exam-meta';
import { validateReferenceUpload } from '@/lib/document-validation';

// GET: Fetch all exams created by the teacher across all their classes
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }

    const cacheKey = `teacher:${session.userId}:exams:list`;
    const cached = await serverCache.get<{ exams: unknown[] }>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const exams = await db.exam.findMany({
      where: {
        class: {
          teacherId: session.userId,
        },
      },
      include: {
        class: true,
        tasks: {
          orderBy: {
            orderIndex: 'asc',
          },
        },
        submissions: {
          where: { status: 'COMPLETED' },
          select: { gradeRaw: true },
        },
        _count: {
          select: {
            submissions: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const formatted = exams.map((ex) => {
      const completedGrades = ex.submissions.map((s) => s.gradeRaw);
      const averageGrade =
        completedGrades.length > 0
          ? (completedGrades.reduce((a, b) => a + b, 0) / completedGrades.length).toFixed(2)
          : 'N/A';
      const { metadata, cleanNotes } = parseExamMetadata(ex.gradingNotes);

      return {
        id: ex.id,
        title: ex.title,
        subject: ex.subject,
        maxPoints: ex.maxPoints,
        rubricText: ex.rubricText,
        examTemplateText: ex.examTemplateText,
        gradingNotes: cleanNotes,
        isGenerated: metadata.isGenerated,
        isApproved: metadata.isApproved,
        approvedAt: metadata.approvedAt,
        gradingFormula: ex.gradingFormula,
        gradeRounding: ex.gradeRounding,
        classId: ex.classId,
        className: ex.class.name,
        createdAt: ex.createdAt.toLocaleDateString('de-CH'),
        submissionsCount: ex._count.submissions,
        averageGrade,
        tasks: ex.tasks.map((t) => ({
          taskId: t.taskId,
          title: t.title,
          maxPoints: t.maxPoints,
        })),
      };
    });

    const responsePayload = { exams: formatted };
    await serverCache.set(cacheKey, responsePayload, {
      tags: [CacheTags.teacher(session.userId), CacheTags.exams(session.userId)],
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('Error fetching global exams:', error);
    return NextResponse.json({ error: 'Fehler beim Laden der Prüfungen.' }, { status: 500 });
  }
}

// POST: Create a new exam explicitly
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }

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
      classId,
      tasks,
      overrideDocumentType: explicitOverride,
      override,
    } = body;
    const overrideDocumentType = explicitOverride === true || override === true;

    if (!title || typeof title !== 'string' || title.trim() === '') {
      return NextResponse.json({ error: 'Prüfungstitel ist erforderlich.' }, { status: 400 });
    }

    if (!subject || typeof subject !== 'string' || subject.trim() === '') {
      return NextResponse.json({ error: 'Fach ist erforderlich.' }, { status: 400 });
    }

    if (!classId || typeof classId !== 'string') {
      return NextResponse.json({ error: 'Klasse muss ausgewählt sein.' }, { status: 400 });
    }

    // Verify class belongs to this teacher
    const schoolClass = await db.class.findFirst({
      where: { id: classId, teacherId: session.userId },
    });

    if (!schoolClass) {
      return NextResponse.json({ error: 'Klasse nicht gefunden.' }, { status: 404 });
    }

    if (rubricText) {
      const rubricDocValidation = await validateReferenceUpload(rubricText, 'Die Musterlösung', {
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

    if (examTemplateText) {
      const templateDocValidation = await validateReferenceUpload(
        examTemplateText,
        'Die Prüfungsvorlage',
        {
          overrideDocumentType,
          teacherId: session.userId,
        }
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

    // Determine final max points
    let finalMaxPoints = Number(maxPoints) || 0;
    if (Array.isArray(tasks) && tasks.length > 0) {
      finalMaxPoints = tasks.reduce((sum, t) => sum + (Number(t.maxPoints) || 0), 0);
    }

    if (finalMaxPoints <= 0) {
      return NextResponse.json(
        { error: 'Maximale Punktzahl muss eine positive Zahl sein.' },
        { status: 400 }
      );
    }

    const exam = await db.$transaction(async (tx) => {
      const newExam = await tx.exam.create({
        data: {
          title: title.trim(),
          subject: subject.trim(),
          rubricText: rubricText || 'Standard Musterlösung',
          examTemplateText: examTemplateText || null,
          gradingNotes: gradingNotes?.trim() || null,
          gradingFormula: gradingFormula || 'LINEAR_60',
          gradeRounding: gradeRounding || '0.1',
          maxPoints: finalMaxPoints,
          classId,
        },
      });

      if (Array.isArray(tasks) && tasks.length > 0) {
        await tx.examTask.createMany({
          data: tasks.map((t, index) => ({
            examId: newExam.id,
            taskId: String(t.taskId),
            title: t.title || `Aufgabe ${t.taskId}`,
            maxPoints: Number(t.maxPoints),
            orderIndex: index,
          })),
        });
      }

      return newExam;
    });

    await invalidateExamCache(session.userId, exam.id, classId);

    return NextResponse.json({ success: true, exam });
  } catch (error) {
    console.error('Error creating exam:', error);
    return NextResponse.json({ error: 'Fehler beim Erstellen der Prüfung.' }, { status: 500 });
  }
}
