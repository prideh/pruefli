import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { getTeacherSavedSubjects, saveTeacherSubjects } from '@/lib/teacher-subjects';
import { resolveTeacherSubjects, resolveFilterAndViewSubjects } from '@/lib/grading';

// GET: Fetch the teacher's "Meine Fächer" configuration and resolved subject lists
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }

    const [savedSubjects, teacherExams] = await Promise.all([
      getTeacherSavedSubjects(session.userId),
      db.exam.findMany({
        where: {
          class: {
            teacherId: session.userId,
          },
        },
        select: {
          subject: true,
        },
      }),
    ]);

    const existingExamSubjects = teacherExams.map((ex) => ex.subject).filter(Boolean);
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
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }

    const body = await request.json();
    if (!body || !Array.isArray(body.subjects)) {
      return NextResponse.json({ error: 'Ungültige Anfrage: Fächerliste fehlt.' }, { status: 400 });
    }

    const saved = await saveTeacherSubjects(session.userId, body.subjects);
    const teacherExams = await db.exam.findMany({
      where: {
        class: {
          teacherId: session.userId,
        },
      },
      select: {
        subject: true,
      },
    });
    const existingExamSubjects = teacherExams.map((ex) => ex.subject).filter(Boolean);
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
