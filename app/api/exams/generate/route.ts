import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { generateExamFromMaterial } from '@/lib/exam-generator';
import { embedExamMetadata } from '@/lib/exam-meta';
import { invalidateExamCache } from '@/lib/cache';
import { getStorageAdapter } from '@/lib/storage';
import { checkAiRateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { validateMaterialPayload, createPayloadErrorResponse } from '@/lib/payload-limits';
import { validateExamMaterialInput } from '@/lib/document-validation';
import { isClassArchived } from '@/lib/class-archive';

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }

    // Rate limiting for AI endpoints
    const rateLimit = await checkAiRateLimit({
      identifier: session.userId,
      scope: 'teacher',
      endpoint: 'generate',
    });
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit);
    }

    const body = await request.json();
    const {
      material,
      classId,
      subject = 'Mathematik',
      topic,
      stufe,
      difficulty,
      totalPoints = 20,
      taskCount = 4,
      title,
      gradingFormula = 'LINEAR_60',
      gradeRounding = '0.1',
      bypassCache,
      overrideDocumentType: explicitOverride,
      override,
    } = body;
    const overrideDocumentType = explicitOverride === true || override === true;

    // Requirement: Material upload is MANDATORY; refuse if missing
    if (!material) {
      return NextResponse.json(
        {
          error:
            'Das Hochladen von Unterrichtsmaterial ist erforderlich. prüefli generiert Prüfungen ausschliesslich auf Basis Ihrer Unterlagen.',
        },
        { status: 400 }
      );
    }

    if (typeof material === 'string' && material.trim() === '') {
      return NextResponse.json(
        {
          error:
            'Das Hochladen von Unterrichtsmaterial ist erforderlich. prüefli generiert Prüfungen ausschliesslich auf Basis Ihrer Unterlagen.',
        },
        { status: 400 }
      );
    }

    if (Array.isArray(material) && material.length === 0) {
      return NextResponse.json(
        {
          error:
            'Das Hochladen von Unterrichtsmaterial ist erforderlich. prüefli generiert Prüfungen ausschliesslich auf Basis Ihrer Unterlagen.',
        },
        { status: 400 }
      );
    }

    // Size limit check: prevent abusive or accidental oversized payloads from reaching Gemini or storage
    const materialValidation = validateMaterialPayload(material);
    if (!materialValidation.valid) {
      return createPayloadErrorResponse(materialValidation);
    }

    // Content and document type check (reject invalid/empty/consent form before model calls)
    const docValidation = await validateExamMaterialInput(material, {
      overrideDocumentType,
      teacherId: session.userId,
    });
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

    if (!classId || typeof classId !== 'string') {
      return NextResponse.json({ error: 'Klasse muss ausgewählt sein.' }, { status: 400 });
    }

    // Verify teacher owns class
    const schoolClass = await db.class.findFirst({
      where: { id: classId, teacherId: session.userId },
    });

    if (!schoolClass) {
      return NextResponse.json({ error: 'Klasse nicht gefunden.' }, { status: 404 });
    }

    if (
      (await isClassArchived(classId)) ||
      Boolean((schoolClass as { archivedAt?: Date | string | null }).archivedAt)
    ) {
      return NextResponse.json(
        {
          error:
            'Archivierte Klassen sind schreibgeschützt. Es können keine neuen Prüfungen generiert werden.',
        },
        { status: 400 }
      );
    }

    // Generate complete package via Gemini and content-hash cache
    const { examPackage, cached } = await generateExamFromMaterial({
      teacherId: session.userId,
      material,
      subject,
      topic,
      stufe,
      difficulty,
      totalPoints: Number(totalPoints) || 20,
      taskCount: Number(taskCount) || 4,
      customTitle: title,
      bypassCache: Boolean(bypassCache),
    });

    const finalTitle = (title && title.trim()) || examPackage.examTitle || 'Generierte Prüfung';
    const finalMaxPoints =
      examPackage.tasks.length > 0
        ? examPackage.tasks.reduce((sum, t) => sum + (Number(t.maxPoints) || 0), 0)
        : Number(totalPoints) || 20;

    // Build task sources mapping for traceability
    const taskSources: Record<string, string> = {};
    for (const t of examPackage.tasks) {
      taskSources[t.taskId] = t.sourceReference || 'Unterrichtsmaterial';
    }

    // Persist material into storage for later single-task regenerations
    let materialStorageKey: string | null = null;
    try {
      const storage = getStorageAdapter();
      const storageKey = `exam-materials/${session.userId}/${Date.now()}_material.json`;
      const payloadBuf = Buffer.from(
        typeof material === 'string' ? material : JSON.stringify(material),
        'utf-8'
      );
      await storage.write(storageKey, payloadBuf, 'application/json');
      materialStorageKey = storageKey;
    } catch {
      // Storage fallback: generation continues even if storage fails
    }

    const gradingNotesWithMeta = embedExamMetadata('', {
      isGenerated: true,
      isApproved: false,
      approvedAt: null,
      materialStorageKey,
      taskSources,
      generatorParams: {
        topic: topic || null,
        stufe: stufe || null,
        difficulty: difficulty || null,
        taskCount: Number(taskCount) || 4,
        totalPoints: finalMaxPoints,
      },
    });

    const newExam = await db.$transaction(async (tx) => {
      const exam = await tx.exam.create({
        data: {
          title: finalTitle.trim(),
          subject: (subject || 'Mathematik').trim(),
          rubricText: examPackage.rubricText,
          examTemplateText: examPackage.examTemplateText,
          gradingNotes: gradingNotesWithMeta,
          gradingFormula: gradingFormula || 'LINEAR_60',
          gradeRounding: gradeRounding || '0.1',
          maxPoints: finalMaxPoints,
          classId,
        },
      });

      if (examPackage.tasks.length > 0) {
        await tx.examTask.createMany({
          data: examPackage.tasks.map((t, index) => ({
            examId: exam.id,
            taskId: String(t.taskId),
            title: t.title || `Aufgabe ${t.taskId}`,
            maxPoints: Number(t.maxPoints) || 1,
            orderIndex: index,
          })),
        });
      }

      return exam;
    });

    await invalidateExamCache(session.userId, newExam.id, classId);

    return NextResponse.json({
      success: true,
      examId: newExam.id,
      exam: newExam,
      cached,
    });
  } catch (error) {
    console.error('Error generating exam:', error);
    return NextResponse.json(
      {
        error:
          'Fehler bei der Generierung der Prüfung aus Unterrichtsmaterial. Bitte versuchen Sie es später erneut.',
      },
      { status: 500 }
    );
  }
}
