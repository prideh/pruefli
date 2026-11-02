import { NextResponse } from 'next/server';
import {
  getConfiguredProviders,
  getUiEnabledProviders,
  isProviderUiFlagEnabled,
} from '@/lib/oauth';

export const dynamic = 'force-dynamic';

export async function GET() {
  const configured = getConfiguredProviders();
  const ui = getUiEnabledProviders();
  const flags = {
    google: isProviderUiFlagEnabled('google'),
    microsoft: isProviderUiFlagEnabled('microsoft'),
  };

  return NextResponse.json({
    // providers reflects UI visibility for backwards compatibility
    providers: ui,
    ui,
    configured,
    flags,
  });
}
