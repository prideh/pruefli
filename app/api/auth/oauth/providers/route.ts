import { NextResponse } from 'next/server';
import { getEnabledProviders } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const providers = getEnabledProviders();
  return NextResponse.json({ providers });
}
