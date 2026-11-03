import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireVerifiedEmailForApi } from '@/lib/email-verification';
import { signMobileRelayToken, verifyMobileRelayToken } from '@/lib/jwt';
import { getScannedRelayDocument } from '@/lib/relay-store';
import { resolveRelayOrigin } from '@/lib/relay-url';
import QRCode from 'qrcode';
import crypto from 'crypto';

// POST: Create a new QR Mobile Camera Relay session token and QR code Data URL
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }
    const unverifiedResponse = await requireVerifiedEmailForApi(session.userId, request);
    if (unverifiedResponse) return unverifiedResponse;

    const body = await request.json().catch(() => ({}));
    const classId = typeof body.classId === 'string' && body.classId ? body.classId : null;
    const examId = typeof body.examId === 'string' && body.examId ? body.examId : null;
    const studentId = typeof body.studentId === 'string' && body.studentId ? body.studentId : null;
    const submissionId =
      typeof body.submissionId === 'string' && body.submissionId ? body.submissionId : null;
    const targetMode =
      typeof body.targetMode === 'string' && body.targetMode ? body.targetMode : 'SUBMISSION';
    const customOrigin =
      typeof body.customOrigin === 'string' && body.customOrigin.trim()
        ? body.customOrigin.trim().replace(/\/+$/, '')
        : null;

    if (examId) {
      const exam = await db.exam.findFirst({
        where: { id: examId, class: { teacherId: session.userId } },
      });
      if (!exam) {
        return NextResponse.json({ error: 'Prüfung nicht gefunden.' }, { status: 404 });
      }
    }

    const sessionId = crypto.randomUUID();
    const token = await signMobileRelayToken(
      {
        teacherId: session.userId,
        sessionId,
        targetMode,
        classId,
        examId,
        studentId,
        submissionId,
      },
      '2h'
    );

    const { origin: baseOrigin, lanIp } = resolveRelayOrigin(request, customOrigin);
    const scanUrl = `${baseOrigin}/scan/${token}`;
    const qrDataUrl = await QRCode.toDataURL(scanUrl, {
      width: 320,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    });

    return NextResponse.json({
      success: true,
      token,
      sessionId,
      scanUrl,
      qrDataUrl,
      lanIp,
      expiresInMinutes: 120,
    });
  } catch (error) {
    console.error('Error creating mobile relay session:', error);
    return NextResponse.json(
      { error: 'QR-Relay-Sitzung konnte nicht erstellt werden.' },
      { status: 500 }
    );
  }
}

// GET: Validate token from smartphone/desktop and return teacher/exam/student context + recent uploads + scanned reference docs
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');

    const payload = await verifyMobileRelayToken(token);
    if (!payload) {
      return NextResponse.json(
        {
          error:
            'Dieser QR-Code ist abgelaufen oder ungültig. Bitte generiere auf dem Desktop einen neuen QR-Code.',
        },
        { status: 401 }
      );
    }
    const unverifiedResponse = await requireVerifiedEmailForApi(payload.teacherId, request);
    if (unverifiedResponse) return unverifiedResponse;

    const [teacher, exams, recentSubmissions, targetSubmission] = await Promise.all([
      db.teacher.findUnique({
        where: { id: payload.teacherId },
        select: { id: true, name: true },
      }),
      db.exam.findMany({
        where: {
          class: {
            teacherId: payload.teacherId,
          },
        },
        select: {
          id: true,
          title: true,
          subject: true,
          classId: true,
          class: {
            select: {
              id: true,
              name: true,
              students: {
                select: {
                  id: true,
                  name: true,
                },
                orderBy: {
                  name: 'asc',
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
      db.submission.findMany({
        where: {
          exam: {
            class: {
              teacherId: payload.teacherId,
            },
          },
          createdAt: {
            gte: new Date(Date.now() - 2 * 60 * 60 * 1000),
          },
        },
        include: {
          student: { select: { name: true } },
          exam: { select: { title: true, maxPoints: true, class: { select: { name: true } } } },
          tasks: {
            include: {
              schritte: {
                select: {
                  istUnsicher: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 15,
      }),
      payload.submissionId
        ? db.submission.findFirst({
            where: {
              id: payload.submissionId,
              exam: { class: { teacherId: payload.teacherId } },
            },
            include: {
              student: { select: { id: true, name: true } },
              exam: { select: { id: true, title: true, class: { select: { name: true } } } },
            },
          })
        : Promise.resolve(null),
    ]);

    if (!teacher) {
      return NextResponse.json({ error: 'Lehrperson nicht gefunden.' }, { status: 404 });
    }

    const lockedExam = payload.examId
      ? exams.find((e) => e.id === payload.examId) || null
      : targetSubmission
        ? exams.find((e) => e.id === targetSubmission.examId) || null
        : null;

    let lockedStudentName: string | null = null;
    if (payload.studentId && lockedExam) {
      const st = lockedExam.class.students.find((s) => s.id === payload.studentId);
      lockedStudentName = st?.name || null;
    } else if (targetSubmission?.student) {
      lockedStudentName = targetSubmission.student.name;
    }

    const scannedDocument = getScannedRelayDocument(payload.sessionId, payload.teacherId);

    return NextResponse.json({
      teacherName: teacher.name,
      targetMode: payload.targetMode || 'SUBMISSION',
      lockedExamId: lockedExam?.id || null,
      lockedExamTitle: lockedExam?.title || null,
      lockedClassName: lockedExam?.class.name || null,
      lockedStudentId: payload.studentId || targetSubmission?.student?.id || null,
      lockedStudentName,
      lockedSubmissionId: payload.submissionId || null,
      scannedDocument: scannedDocument
        ? {
            id: scannedDocument.id,
            targetMode: scannedDocument.targetMode,
            payload: scannedDocument.payload,
            pageCount: scannedDocument.pageCount,
            createdAt: scannedDocument.createdAt,
          }
        : null,
      exams: exams.map((e) => ({
        id: e.id,
        title: e.title,
        subject: e.subject,
        classId: e.classId,
        className: e.class.name,
        students: e.class.students,
      })),
      recentUploads: recentSubmissions.map((s) => {
        const uncertainStepsCount = s.tasks.reduce(
          (acc, t) => acc + t.schritte.filter((st) => st.istUnsicher).length,
          0
        );
        return {
          id: s.id,
          studentName: s.student?.name || s.extractedStudentName || 'KI erkennt Namen...',
          examTitle: s.exam.title,
          className: s.exam.class.name,
          status: s.status,
          grade: s.status === 'COMPLETED' ? s.gradeRounded : null,
          earnedPoints: s.status === 'COMPLETED' ? s.earnedPoints : null,
          maxPoints: s.exam.maxPoints,
          uncertainStepsCount,
          isExamMatchUncertain: s.isExamMatchUncertain,
          isStudentMatchUncertain: s.isStudentMatchUncertain,
          time: s.createdAt.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' }),
        };
      }),
    });
  } catch (error) {
    console.error('Error fetching mobile relay metadata:', error);
    return NextResponse.json({ error: 'Fehler beim Laden der Sitzungsdaten.' }, { status: 500 });
  }
}
