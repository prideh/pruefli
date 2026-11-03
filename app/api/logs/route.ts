import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { requireVerifiedEmailForApi } from '@/lib/email-verification';
import { serverCache, CacheTags } from '@/lib/cache';

export async function GET(request?: Request | NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }
    const unverifiedResponse = await requireVerifiedEmailForApi(session.userId, request);
    if (unverifiedResponse) return unverifiedResponse;

    const url = request?.url ? new URL(request.url) : new URL('http://localhost/api/logs');
    const searchParams = url.searchParams;

    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const rawPageSize =
      parseInt(searchParams.get('pageSize') || searchParams.get('limit') || '25', 10) || 25;
    const pageSize = Math.min(100, Math.max(1, rawPageSize));
    const cursor = searchParams.get('cursor')?.trim() || null;
    const status = searchParams.get('status')?.trim() || null;
    const actionType = searchParams.get('actionType')?.trim() || null;
    const search = searchParams.get('search')?.trim() || null;

    const cacheKey = `teacher:${session.userId}:logs:list:page=${page}:size=${pageSize}:cursor=${cursor || ''}:status=${status || 'ALL'}:action=${actionType || 'ALL'}:search=${encodeURIComponent(search || '')}`;

    const cached = await serverCache.get<{
      logs: unknown[];
      pagination: unknown;
      stats: unknown;
    }>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    const where: Record<string, unknown> = {
      teacherId: session.userId,
    };

    if (status && status !== 'ALL') {
      where.status = status;
    }

    if (actionType && actionType !== 'ALL') {
      where.actionType = actionType;
    }

    if (search) {
      where.OR = [
        { className: { contains: search, mode: 'insensitive' } },
        { examTitle: { contains: search, mode: 'insensitive' } },
        { studentName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (page - 1) * pageSize;

    const [totalCount, logs, allTeacherLogsCount, completedCount, failedCount, durationAgg] =
      await Promise.all([
        db.correctionLog.count({ where }),
        db.correctionLog.findMany({
          where,
          orderBy: {
            createdAt: 'desc',
          },
          take: pageSize,
          skip: cursor ? 1 : skip,
          ...(cursor ? { cursor: { id: cursor } } : {}),
        }),
        db.correctionLog.count({ where: { teacherId: session.userId } }),
        db.correctionLog.count({ where: { teacherId: session.userId, status: 'COMPLETED' } }),
        db.correctionLog.count({ where: { teacherId: session.userId, status: 'FAILED' } }),
        db.correctionLog.aggregate({
          where: { teacherId: session.userId, status: 'COMPLETED', durationMs: { not: null } },
          _avg: { durationMs: true },
        }),
      ]);

    const totalPages = Math.ceil(totalCount / pageSize) || 1;
    const hasMore = cursor
      ? logs.length === pageSize
      : skip + logs.length < totalCount && logs.length === pageSize;
    const nextCursor = logs.length === pageSize ? (logs[logs.length - 1]?.id ?? null) : null;

    const avgDurationMs = durationAgg._avg?.durationMs ?? 0;
    const totalFinished = completedCount + failedCount;
    const successRate = totalFinished > 0 ? (completedCount / totalFinished) * 100 : 0;

    const responsePayload = {
      logs,
      pagination: {
        page,
        pageSize,
        total: totalCount,
        totalPages,
        hasMore,
        nextCursor,
      },
      stats: {
        total: allTeacherLogsCount,
        completed: completedCount,
        failed: failedCount,
        averageDurationSeconds: avgDurationMs / 1000,
        successRate,
      },
    };

    await serverCache.set(cacheKey, responsePayload, {
      tags: [CacheTags.teacher(session.userId), CacheTags.logs(session.userId)],
    });

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('Error fetching correction logs:', error);
    return NextResponse.json(
      { error: 'Fehler beim Laden des Korrektur-Protokolls.' },
      { status: 500 }
    );
  }
}
