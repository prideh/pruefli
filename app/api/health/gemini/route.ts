import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  requireVerifiedEmailForApi,
  requireVerifiedEmailForPaidAi,
} from '@/lib/email-verification';
import { checkGeminiHealth, probeGeminiGenerateContent } from '@/lib/gemini';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }
    const unverifiedResponse = await requireVerifiedEmailForApi(session.userId, request);
    if (unverifiedResponse) return unverifiedResponse;

    const url = request?.url ? new URL(request.url) : null;
    const probe = url?.searchParams.get('probe');

    if (probe === 'generateContent') {
      const unverifiedAiResponse = await requireVerifiedEmailForPaidAi(session.userId, request);
      if (unverifiedAiResponse) return unverifiedAiResponse;
      const probeResult = await probeGeminiGenerateContent();
      return NextResponse.json(probeResult);
    }

    const health = await checkGeminiHealth();
    return NextResponse.json(health);
  } catch {
    return NextResponse.json(
      {
        ok: false,
        latencyMs: 0,
        errorCategory: 'UNKNOWN',
      },
      { status: 500 }
    );
  }
}
