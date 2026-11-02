import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { regenerateSingleTask, replaceTaskInText } from '@/lib/exam-generator';
import { parseExamMetadata, embedExamMetadata, isExamApproved } from '@/lib/exam-meta';
import { invalidateExamCache } from '@/lib/cache';
import { getStorageAdapter } from '@/lib/storage';
import { checkAiRateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { isClassArchived } from '@/lib/class-archive';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }

    // Rate limiting for AI endpoints
    const rateLimit = await checkAiRateLimit({
      identifier: session.userId,
      scope: 'teacher',
      endpoint: 'regenerate-task',
    });
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit);
    }

    const { id: examId } = await params;
    const body = await request.json();
    const { taskId, instructions, bypassCache } = body;

    if (!taskId) {
      return NextResponse.json({ error: 'Aufgaben-ID ist erforderlich.' }, { status: 400 });
    }

    const exam = await db.exam.findUnique({
      where: { id: examId },
      include: {
        class: true,
        tasks: {
          orderBy: { orderIndex: 'asc' },
        },
      },
    });

    if (!exam) {
      return NextResponse.json({ error: 'Prüfung nicht gefunden.' }, { status: 404 });
    }

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

    // Freezing gate: Cannot regenerate tasks once approved/frozen
    if (isExamApproved(exam)) {
      return NextResponse.json(
        {
          error:
            'Eingefrorene Prüfungen können nicht neu generiert werden. Freigegebene Prüfungen sind unveränderlich.',
        },
        { status: 400 }
      );
    }

    const { metadata, cleanNotes } = parseExamMetadata(exam.gradingNotes);
    const existingTask = exam.tasks.find((t) => t.taskId === String(taskId));
    if (!existingTask) {
      return NextResponse.json({ error: `Aufgabe ${taskId} nicht gefunden.` }, { status: 404 });
    }

    // Retrieve original teaching material from storage if available
    let material: unknown = null;
    if (metadata.materialStorageKey) {
      try {
        const storage = getStorageAdapter();
        const file = await storage.read(metadata.materialStorageKey);
        if (file) {
          const raw = file.buffer.toString('utf-8');
          try {
            material = JSON.parse(raw);
          } catch {
            material = raw;
          }
        }
      } catch {
        // Fall through
      }
    }

    // If storage has no material, fall back to existing template/rubric context
    if (!material) {
      material = `=== BESTEHENDES PRÜFUNGSMATERIAL ===\nAufgabenblatt:\n${exam.examTemplateText || ''}\n\nMusterlösung:\n${exam.rubricText || ''}`;
    }

    const { task: regeneratedTask, cached } = await regenerateSingleTask({
      teacherId: session.userId,
      material: material as string,
      taskId: String(taskId),
      existingTaskTitle: existingTask.title,
      targetMaxPoints: existingTask.maxPoints,
      instructions: instructions || undefined,
      subject: exam.subject,
      topic: metadata.generatorParams?.topic || undefined,
      stufe: metadata.generatorParams?.stufe || undefined,
      difficulty: metadata.generatorParams?.difficulty || undefined,
      bypassCache: Boolean(bypassCache),
    });

    // Update the task's text in examTemplateText and rubricText while preserving all other tasks
    const updatedTemplateText = replaceTaskInText(
      exam.examTemplateText || '',
      String(taskId),
      `### ${regeneratedTask.title} (${regeneratedTask.maxPoints} Punkte)\n\n${regeneratedTask.taskQuestion}`
    );

    const updatedRubricText = replaceTaskInText(
      exam.rubricText || '',
      String(taskId),
      `### ${regeneratedTask.title} (${regeneratedTask.maxPoints} Punkte)\n\n${regeneratedTask.taskSolution}`
    );

    // Update metadata taskSources
    const updatedTaskSources = {
      ...(metadata.taskSources || {}),
      [String(taskId)]: regeneratedTask.sourceReference || 'Unterrichtsmaterial',
    };

    const updatedGradingNotes = embedExamMetadata(cleanNotes, {
      ...metadata,
      taskSources: updatedTaskSources,
    });

    // Recalculate max points if changed
    const newMaxPoints = exam.tasks.reduce((sum, t) => {
      if (t.taskId === String(taskId)) {
        return sum + regeneratedTask.maxPoints;
      }
      return sum + t.maxPoints;
    }, 0);

    await db.$transaction(async (tx) => {
      await tx.examTask.updateMany({
        where: { examId, taskId: String(taskId) },
        data: {
          title: regeneratedTask.title,
          maxPoints: regeneratedTask.maxPoints,
        },
      });

      await tx.exam.update({
        where: { id: examId },
        data: {
          examTemplateText: updatedTemplateText,
          rubricText: updatedRubricText,
          gradingNotes: updatedGradingNotes,
          maxPoints: newMaxPoints,
        },
      });
    });

    await invalidateExamCache(session.userId, examId, exam.classId);

    return NextResponse.json({
      success: true,
      cached,
      task: regeneratedTask,
    });
  } catch (error) {
    console.error('Error regenerating single task:', error);
    return NextResponse.json(
      {
        error: 'Fehler bei der Neu-Generierung der Aufgabe. Bitte versuchen Sie es später erneut.',
      },
      { status: 500 }
    );
  }
}
