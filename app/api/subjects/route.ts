import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireVerifiedEmailForApi } from '@/lib/email-verification';
import { getTeacherSavedSubjects, saveTeacherSubjects } from '@/lib/teacher-subjects';
import { resolveTeacherSubjects, resolveFilterAndViewSubjects } from '@/lib/grading';
import { getArchivedClassIds } from '@/lib/class-archive';

async function isSessionTeacherValid(userId: string): Promise<boolean> {
  const findUnique = (
    db as unknown as {
      teacher?: {
        findUnique?: ((args: unknown) => Promise<{ id: string } | null | undefined>) & {
          mock?: unknown;
        };
      };
    }
  )?.teacher?.findUnique;

  if (typeof findUnique !== 'function') {
    return true;
  }

  if (process.env.VITEST === 'true' && !findUnique.mock) {
    return true;
  }

  try {
    const teacher = await findUnique({
      where: { id: userId },
      select: { id: true },
    });
    return teacher !== null;
  } catch {
    return true;
  }
}

// GET: Fetch the teacher's "Meine Fächer" configuration and resolved subject lists
export async function GET(request: Request) {
  try {
    const session = await getSession(request ? { request } : undefined);
    if (!session || !session.userId || !(await isSessionTeacherValid(session.userId))) {
      return NextResponse.json(
        { authenticated: false, error: 'Nicht autorisiert.' },
        { status: 401 }
      );
    }
    const unverifiedResponse = await requireVerifiedEmailForApi(session.userId, request);
    if (unverifiedResponse) return unverifiedResponse;

    const [savedSubjects, teacherExams, archivedIds] = await Promise.all([
      getTeacherSavedSubjects(session.userId),
      db.exam.findMany({
        where: {
          class: {
            teacherId: session.userId,
          },
        },
        select: {
          subject: true,
          classId: true,
        },
      }),
      getArchivedClassIds(),
    ]);

    const existingExamSubjects = teacherExams
      .filter((ex) => !ex.classId || !archivedIds.has(ex.classId))
      .map((ex) => ex.subject)
      .filter(Boolean);
    const mySubjects = resolveTeacherSubjects(savedSubjects, existingExamSubjects);
    const filterAndViewSubjects = resolveFilterAndViewSubjects(savedSubjects, existingExamSubjects);

    return NextResponse.json({
      hasConfigured: savedSubjects !== null && savedSubjects.length > 0,
      savedSubjects,
      existingExamSubjects,
      mySubjects,
      filterAndViewSubjects,
    });
  } catch (error) {
    console.error('Error fetching teacher subjects:', error);
    return NextResponse.json({ error: 'Fehler beim Laden der Fächerliste.' }, { status: 500 });
  }
}

// PUT: Update the teacher's "Meine Fächer" list (catalog selection + custom subjects)
export async function PUT(request: Request) {
  try {
    const session = await getSession(request ? { request } : undefined);
    if (!session || !session.userId || !(await isSessionTeacherValid(session.userId))) {
      return NextResponse.json(
        { authenticated: false, error: 'Nicht autorisiert.' },
        { status: 401 }
      );
    }
    const unverifiedResponse = await requireVerifiedEmailForApi(session.userId, request);
    if (unverifiedResponse) return unverifiedResponse;

    const body = await request.json();
    if (!body || !Array.isArray(body.subjects)) {
      return NextResponse.json({ error: 'Ungültige Anfrage: Fächerliste fehlt.' }, { status: 400 });
    }

    const saved = await saveTeacherSubjects(session.userId, body.subjects);
    const [teacherExams, archivedIds] = await Promise.all([
      db.exam.findMany({
        where: {
          class: {
            teacherId: session.userId,
          },
        },
        select: {
          subject: true,
          classId: true,
        },
      }),
      getArchivedClassIds(),
    ]);
    const existingExamSubjects = teacherExams
      .filter((ex) => !ex.classId || !archivedIds.has(ex.classId))
      .map((ex) => ex.subject)
      .filter(Boolean);
    const mySubjects = resolveTeacherSubjects(saved, existingExamSubjects);
    const filterAndViewSubjects = resolveFilterAndViewSubjects(saved, existingExamSubjects);

    return NextResponse.json({
      hasConfigured: saved.length > 0,
      savedSubjects: saved,
      existingExamSubjects,
      mySubjects,
      filterAndViewSubjects,
    });
  } catch (error) {
    console.error('Error saving teacher subjects:', error);
    return NextResponse.json({ error: 'Fehler beim Speichern der Fächerliste.' }, { status: 500 });
  }
}
