import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireVerifiedEmailForApi } from '@/lib/email-verification';
import { serverCache, CacheTags } from '@/lib/cache';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }
    const unverifiedResponse = await requireVerifiedEmailForApi(session.userId, request);
    if (unverifiedResponse) return unverifiedResponse;

    // Await params promise in Next.js 16
    const { id: classId } = await params;

    const cacheKey = `teacher:${session.userId}:class:${classId}:exams`;
    const cached = await serverCache.get<{ exams: unknown[] }>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // Verify class belongs to this teacher
    const schoolClass = await db.class.findFirst({
      where: { id: classId, teacherId: session.userId },
    });

    if (!schoolClass) {
      return NextResponse.json({ error: 'Klasse nicht gefunden.' }, { status: 404 });
    }

    const exams = await db.exam.findMany({
      where: { classId },
      orderBy: { createdAt: 'desc' },
    });

    const responsePayload = { exams };
    await serverCache.set(cacheKey, responsePayload, {
      tags: [
        CacheTags.teacher(session.userId),
        CacheTags.class(session.userId, classId),
        CacheTags.exams(session.userId),
      ],
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('Error fetching exams:', error);
    return NextResponse.json({ error: 'Fehler beim Laden der Prüfungen.' }, { status: 500 });
  }
}
