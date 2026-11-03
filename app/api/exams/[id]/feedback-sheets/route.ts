import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireVerifiedEmailForApi } from '@/lib/email-verification';
import { serverCache, CacheTags } from '@/lib/cache';
import { isExamApproved } from '@/lib/exam-meta';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }
    const unverifiedResponse = await requireVerifiedEmailForApi(session.userId, request);
    if (unverifiedResponse) return unverifiedResponse;

    const { id: examId } = await params;

    const cacheKey = `teacher:${session.userId}:exam:${examId}:feedback-sheets`;
    const cached = await serverCache.get<{
      examTitle: string;
      subject: string;
      className: string;
      totalCount: number;
      completedCount: number;
      ungradedCount: number;
      sheets: unknown[];
    }>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const exam = await db.exam.findUnique({
      where: { id: examId },
      include: {
        class: true,
        submissions: {
          include: {
            student: true,
            tasks: {
              orderBy: { orderIndex: 'asc' },
            },
          },
        },
      },
    });

    if (!exam) {
      return NextResponse.json({ error: 'Prüfung nicht gefunden.' }, { status: 404 });
    }

    if (exam.class.teacherId !== session.userId) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 403 });
    }

    if (!isExamApproved(exam)) {
      return NextResponse.json(
        {
          error:
            'Die Prüfung ist ein noch ungeprüfter Entwurf und muss vor dem Drucken freigegeben werden.',
        },
        { status: 400 }
      );
    }

    const totalSubmissions = exam.submissions.length;
    const completedSubmissions = exam.submissions.filter((s) => s.status === 'COMPLETED');
    const ungradedCount = totalSubmissions - completedSubmissions.length;

    // Sort alphabetically by student name
    completedSubmissions.sort((a, b) => {
      const nameA = a.student?.name || a.extractedStudentName || 'Nicht zugeordnet';
      const nameB = b.student?.name || b.extractedStudentName || 'Nicht zugeordnet';
      return nameA.localeCompare(nameB, 'de-CH');
    });

    const sheets = completedSubmissions.map((sub) => {
      const schuelerName =
        sub.student?.name ||
        (sub.extractedStudentName
          ? `${sub.extractedStudentName} (Nicht zugeordnet)`
          : 'Nicht zugeordnet');

      return {
        submissionId: sub.id,
        examId: exam.id,
        examTitle: exam.title,
        fach: exam.subject,
        className: exam.class.name,
        schuelerName,
        datum: sub.createdAt.toLocaleDateString('de-CH'),
        gesamterzieltePunkte: sub.earnedPoints,
        gesamtmaximalPunkte: exam.maxPoints,
        note: sub.gradeRounded,
        aufgaben: sub.tasks.map((task) => ({
          aufgabeId: task.taskId,
          titel: task.title,
          schuelerAntwort: task.studentAnswer || '—',
          erzieltePunkte: task.erzieltePunkte,
          maximalPunkte: task.maximalPunkte,
          status: task.status,
          lehrerKommentar: task.lehrerKommentar || 'Keine Bemerkungen.',
        })),
        schuelerFeedback: {
          staerken: sub.strengths || [],
          schwaechen: sub.weaknesses || [],
          hilfreicherTipp: sub.helpfulTip || '',
          uebungsEmpfehlung: sub.exerciseRecommendation || '',
        },
      };
    });

    const responsePayload = {
      examTitle: exam.title,
      subject: exam.subject,
      className: exam.class.name,
      totalCount: totalSubmissions,
      completedCount: completedSubmissions.length,
      ungradedCount,
      sheets,
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
    console.error('Error fetching feedback sheets:', error);
    return NextResponse.json(
      { error: 'Fehler beim Laden der Feedback-Berichte.' },
      { status: 500 }
    );
  }
}
