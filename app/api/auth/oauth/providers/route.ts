import { NextResponse } from 'next/server';
import {
  getConfiguredProviders,
  getUiEnabledProviders,
  isProviderUiFlagEnabled,
  IS_PUBLIC_CATALOG_ENDPOINT,
} from '@/lib/oauth';

export const dynamic = 'force-dynamic';

/**
 * Bewusst oeffentlicher Konfigurations-/Katalog-Endpunkt (keine Mandantendaten, keine Authentifizierung erforderlich).
 * Liefert die aktiven OAuth-Provider-Schalter fuer Login- und Registrierungsseiten.
 */
export async function GET() {
  const configured = getConfiguredProviders();
  const ui = getUiEnabledProviders();
  const flags = {
    google: isProviderUiFlagEnabled('google'),
    microsoft: isProviderUiFlagEnabled('microsoft'),
  };

  return NextResponse.json({
    publicEndpoint: IS_PUBLIC_CATALOG_ENDPOINT,
    // providers reflects UI visibility for backwards compatibility
    providers: ui,
    ui,
    configured,
    flags,
  });
}
