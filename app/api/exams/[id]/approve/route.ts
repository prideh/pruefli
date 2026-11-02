import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { parseExamMetadata, embedExamMetadata } from '@/lib/exam-meta';
import { invalidateExamCache } from '@/lib/cache';
import { isClassArchived } from '@/lib/class-archive';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }

    const { id: examId } = await params;

    const exam = await db.exam.findUnique({
      where: { id: examId },
      include: { class: true },
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

    const { metadata, cleanNotes } = parseExamMetadata(exam.gradingNotes);

    if (metadata.isApproved) {
      return NextResponse.json({
        success: true,
        message: 'Prüfung ist bereits freigegeben und eingefroren.',
        exam,
      });
    }

    const updatedMetadata = {
      ...metadata,
      isApproved: true,
      approvedAt: new Date().toISOString(),
    };

    const updatedGradingNotes = embedExamMetadata(cleanNotes, updatedMetadata);

    const updatedExam = await db.exam.update({
      where: { id: examId },
      data: {
        gradingNotes: updatedGradingNotes,
      },
    });

    await invalidateExamCache(session.userId, examId, exam.classId);

    return NextResponse.json({
      success: true,
      message: 'Prüfung erfolgreich freigegeben und eingefroren.',
      exam: updatedExam,
    });
  } catch (error) {
    console.error('Error approving exam:', error);
    return NextResponse.json({ error: 'Fehler bei der Freigabe der Prüfung.' }, { status: 500 });
  }
}
