import { NextResponse } from 'next/server';
import {
  getConfiguredProviders,
  getUiEnabledProviders,
  isProviderUiFlagEnabled,
} from '@/lib/oauth';

export const dynamic = 'force-dynamic';

/**
 * Bewusst oeffentlicher Konfigurations-/Katalog-Endpunkt (keine Mandantendaten, keine Authentifizierung erforderlich).
 * Liefert die aktiven OAuth-Provider-Schalter fuer Login- und Registrierungsseiten.
 */
export const IS_PUBLIC_CATALOG_ENDPOINT = true;

export async function GET() {
  const configured = getConfiguredProviders();
  const ui = getUiEnabledProviders();
  const flags = {
    google: isProviderUiFlagEnabled('google'),
    microsoft: isProviderUiFlagEnabled('microsoft'),
  };

  return NextResponse.json({
    publicEndpoint: true,
    // providers reflects UI visibility for backwards compatibility
    providers: ui,
    ui,
    configured,
    flags,
  });
}
