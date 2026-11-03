import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireVerifiedEmailForApi } from '@/lib/email-verification';
import { serverCache, CacheTags, invalidateStudentCache } from '@/lib/cache';
import { isClassArchived } from '@/lib/class-archive';

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

    const cacheKey = `teacher:${session.userId}:class:${classId}:students`;
    const cached = await serverCache.get<{ students: unknown[] }>(cacheKey);
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

    const students = await db.student.findMany({
      where: { classId },
      orderBy: { name: 'asc' },
    });

    const responsePayload = { students };
    await serverCache.set(cacheKey, responsePayload, {
      tags: [
        CacheTags.teacher(session.userId),
        CacheTags.class(session.userId, classId),
        CacheTags.students(session.userId),
      ],
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('Error fetching students:', error);
    return NextResponse.json({ error: 'Fehler beim Laden der Schüler.' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }
    const unverifiedResponse = await requireVerifiedEmailForApi(session.userId, request);
    if (unverifiedResponse) return unverifiedResponse;

    const { id: classId } = await params;
    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json({ error: 'Schülername ist erforderlich.' }, { status: 400 });
    }

    // Verify class belongs to this teacher
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
            'Archivierte Klassen sind schreibgeschützt. Es können keine neuen Schüler/innen hinzugefügt werden.',
        },
        { status: 400 }
      );
    }

    const student = await db.student.create({
      data: {
        name: name.trim(),
        classId,
      },
    });

    await invalidateStudentCache(session.userId, student.id, classId);

    return NextResponse.json({ success: true, student });
  } catch (error) {
    console.error('Error creating student:', error);
    return NextResponse.json({ error: 'Fehler beim Erstellen des Schülers.' }, { status: 500 });
  }
}
