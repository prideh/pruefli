import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { requireVerifiedEmailForApi } from '@/lib/email-verification';
import { db } from '@/lib/db';
import { getStorageAdapter, normalizeStorageKey } from '@/lib/storage';
import path from 'path';

export async function GET(request: Request, { params }: { params: Promise<{ file: string[] }> }) {
  try {
    const { file } = await params;
    if (!file || file.length === 0) {
      return NextResponse.json({ error: 'Ungueltige Dateianforderung.' }, { status: 400 });
    }

    const rawPath = file.join('/');
    // Schutz vor Path-Traversal
    if (rawPath.includes('..') || rawPath.includes('\0')) {
      return NextResponse.json({ error: 'Ungueltiger Pfad.' }, { status: 400 });
    }

    const cleanKey = normalizeStorageKey(rawPath);
    const baseName = path.basename(cleanKey);

    // 1. Authentifizierung pruefen
    const session = await getSession();
    if (!session || !session.userId) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }
    const unverifiedResponse = await requireVerifiedEmailForApi(session.userId, request);
    if (unverifiedResponse) return unverifiedResponse;

    // 2. Autorisierung pruefen: Scan muss zur Lehrperson gehoeren
    const submission = await db.submission.findFirst({
      where: {
        OR: [
          { studentExamUrl: { contains: cleanKey } },
          { studentExamUrl: { contains: baseName } },
        ],
      },
      include: {
        exam: {
          include: {
            class: true,
          },
        },
      },
    });

    if (!submission) {
      return NextResponse.json({ error: 'Scan nicht gefunden.' }, { status: 404 });
    }

    if (submission.exam?.class?.teacherId !== session.userId) {
      return NextResponse.json({ error: 'Keine Berechtigung fuer diesen Scan.' }, { status: 403 });
    }

    // 3. Scan aus persistentem Storage laden
    const storage = getStorageAdapter();
    const fileResult = await storage.read(cleanKey);

    if (!fileResult) {
      return NextResponse.json({ error: 'Datei nicht gefunden.' }, { status: 404 });
    }

    return new Response(new Uint8Array(fileResult.buffer), {
      status: 200,
      headers: {
        'Content-Type': fileResult.contentType,
        'Content-Length': String(fileResult.buffer.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });
  } catch (error) {
    console.error('Fehler beim Laden des Scans:', error);
    return NextResponse.json({ error: 'Interner Serverfehler.' }, { status: 500 });
  }
}

export async function HEAD(request: Request, { params }: { params: Promise<{ file: string[] }> }) {
  try {
    const { file } = await params;
    if (!file || file.length === 0) {
      return new Response(null, { status: 400 });
    }

    const rawPath = file.join('/');
    if (rawPath.includes('..') || rawPath.includes('\0')) {
      return new Response(null, { status: 400 });
    }

    const cleanKey = normalizeStorageKey(rawPath);
    const baseName = path.basename(cleanKey);

    const session = await getSession();
    if (!session || !session.userId) {
      return new Response(null, { status: 401 });
    }
    const unverifiedResponse = await requireVerifiedEmailForApi(session.userId, request);
    if (unverifiedResponse) {
      return new Response(null, { status: 403 });
    }

    const submission = await db.submission.findFirst({
      where: {
        OR: [
          { studentExamUrl: { contains: cleanKey } },
          { studentExamUrl: { contains: baseName } },
        ],
      },
      include: {
        exam: {
          include: {
            class: true,
          },
        },
      },
    });

    if (!submission) {
      return new Response(null, { status: 404 });
    }

    if (submission.exam?.class?.teacherId !== session.userId) {
      return new Response(null, { status: 403 });
    }

    const storage = getStorageAdapter();
    const exists = await storage.exists(cleanKey);
    if (!exists) {
      return new Response(null, { status: 404 });
    }

    return new Response(null, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
      },
    });
  } catch {
    return new Response(null, { status: 500 });
  }
}
