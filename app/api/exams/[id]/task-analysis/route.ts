import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireVerifiedEmailForApi } from '@/lib/email-verification';
import { computeTaskAnalysis } from '@/lib/task-analysis';
import { serverCache, CacheTags } from '@/lib/cache';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }
    const unverifiedResponse = await requireVerifiedEmailForApi(session.userId, request);
    if (unverifiedResponse) return unverifiedResponse;

    const { id: examId } = await params;

    const cacheKey = `teacher:${session.userId}:exam:${examId}:task-analysis`;
    const cached = await serverCache.get<{ success: boolean; taskAnalysis: unknown }>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const exam = await db.exam.findUnique({
      where: { id: examId },
      include: {
        class: true,
        submissions: {
          include: {
            tasks: {
              orderBy: { orderIndex: 'asc' },
              include: {
                schritte: {
                  orderBy: { schrittIndex: 'asc' },
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

    if (exam.class.teacherId !== session.userId) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 403 });
    }

    const taskAnalysis = computeTaskAnalysis(exam.tasks, exam.submissions);

    const responsePayload = {
      success: true,
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
    console.error('Error fetching task analysis:', error);
    return NextResponse.json({ error: 'Fehler beim Laden der Aufgabenanalyse.' }, { status: 500 });
  }
}
