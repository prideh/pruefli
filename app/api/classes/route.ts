import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireVerifiedEmailForApi } from '@/lib/email-verification';
import { serverCache, CacheTags, invalidateClassCache } from '@/lib/cache';
import { validateClassName } from '@/lib/payload-limits';
import { getMultipleClassesSavedSubjects, saveClassSubjects } from '@/lib/teacher-subjects';
import {
  getArchivedClassIds,
  getClassArchivedAt,
  formatClassDeletionConsequences,
} from '@/lib/class-archive';

export async function GET(request?: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }
    const unverifiedResponse = await requireVerifiedEmailForApi(session.userId, request);
    if (unverifiedResponse) return unverifiedResponse;

    const url = request?.url ? new URL(request.url) : new URL('http://localhost/api/classes');
    const statusParam = (url.searchParams.get('status') || 'active').toLowerCase();
    const includeArchived =
      url.searchParams.get('includeArchived') === 'true' || statusParam === 'all';
    const filterMode = includeArchived ? 'all' : statusParam === 'archived' ? 'archived' : 'active';

    const cacheKey = `teacher:${session.userId}:classes:list:${filterMode}`;
    const cached = await serverCache.get<{ classes: unknown[] }>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const rawClasses = await db.class.findMany({
      where: { teacherId: session.userId },
      include: {
        _count: {
          select: { students: true, exams: true },
        },
        exams: {
          select: {
            _count: {
              select: { submissions: true },
            },
            submissions: {
              where: { status: 'COMPLETED', studentId: { not: null } },
              select: { gradeRaw: true, studentId: true },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const classIds = rawClasses.map((cls) => cls.id);
    const [subjectsMap, archivedIds] = await Promise.all([
      getMultipleClassesSavedSubjects(classIds),
      getArchivedClassIds(classIds),
    ]);

    const mappedClasses = await Promise.all(
      rawClasses.map(async (cls) => {
        const allGrades = cls.exams.flatMap((ex) =>
          ex.submissions
            .filter((s) => !('studentId' in s) || Boolean(s.studentId))
            .map((s) => s.gradeRaw)
        );
        const totalSubmissions = cls.exams.reduce(
          (sum, ex) =>
            sum +
            ((ex as { _count?: { submissions?: number } })._count?.submissions ??
              ex.submissions?.length ??
              0),
          0
        );
        const gradeRawSum = allGrades.reduce((sum, g) => sum + g, 0);
        const avg = allGrades.length > 0 ? (gradeRawSum / allGrades.length).toFixed(2) : 'N/A';
        const isArchived =
          archivedIds.has(cls.id) ||
          Boolean((cls as { archivedAt?: Date | string | null }).archivedAt);
        const archivedAtDate = isArchived
          ? (await getClassArchivedAt(cls.id)) ||
            ((cls as { archivedAt?: Date | string | null }).archivedAt
              ? new Date((cls as { archivedAt?: Date | string }).archivedAt!)
              : null)
          : null;

        return {
          id: cls.id,
          name: cls.name,
          teacherId: cls.teacherId,
          createdAt: cls.createdAt,
          isArchived,
          archivedAt: archivedAtDate ? archivedAtDate.toISOString() : null,
          _count: { students: cls._count.students },
          totalExams: cls._count.exams,
          totalSubmissions,
          deletionImpact: {
            studentsCount: cls._count.students,
            examsCount: cls._count.exams,
            submissionsCount: totalSubmissions,
            summaryText: formatClassDeletionConsequences({
              studentsCount: cls._count.students,
              examsCount: cls._count.exams,
              submissionsCount: totalSubmissions,
            }),
          },
          averageGrade: avg,
          gradedSubmissionsCount: allGrades.length,
          gradeRawSum,
          subjects: subjectsMap[cls.id] || [],
        };
      })
    );

    const classes = mappedClasses.filter((cls) => {
      if (filterMode === 'all') return true;
      if (filterMode === 'archived') return cls.isArchived;
      return !cls.isArchived;
    });

    const responsePayload = { classes };
    await serverCache.set(cacheKey, responsePayload, {
      tags: [CacheTags.teacher(session.userId), CacheTags.classes(session.userId)],
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('Error fetching classes:', error);
    return NextResponse.json({ error: 'Fehler beim Laden der Klassen.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }
    const unverifiedResponse = await requireVerifiedEmailForApi(session.userId, request);
    if (unverifiedResponse) return unverifiedResponse;

    const body = await request.json();
    const { name } = body;

    const validation = validateClassName(name);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: validation.status || 400 });
    }

    const trimmedName = (name as string).trim();

    const existingClass = await db.class.findFirst({
      where: {
        name: trimmedName,
        teacherId: session.userId,
      },
    });

    if (existingClass) {
      return NextResponse.json(
        { error: 'Eine Klasse mit diesem Namen existiert bereits.' },
        { status: 400 }
      );
    }

    const schoolClass = await db.class.create({
      data: {
        name: trimmedName,
        teacherId: session.userId,
      },
    });

    const savedSubjects = Array.isArray(body.subjects)
      ? await saveClassSubjects(schoolClass.id, body.subjects)
      : undefined;

    await invalidateClassCache(session.userId);

    return NextResponse.json({
      success: true,
      class:
        savedSubjects !== undefined ? { ...schoolClass, subjects: savedSubjects } : schoolClass,
    });
  } catch (error) {
    console.error('Error creating class:', error);
    return NextResponse.json({ error: 'Fehler beim Erstellen der Klasse.' }, { status: 500 });
  }
}
