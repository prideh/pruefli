import type { Metadata } from 'next';

/**
 * Ermittelt die Basis-URL fuer SEO-Metadaten, Robots und Sitemap.
 * Beruecksichtigt Umgebungsvariablen (APP_URL, NEXT_PUBLIC_APP_URL, BASE_URL, RENDER_EXTERNAL_URL, VERCEL_URL).
 * Gibt undefined zurueck, falls keine gueltige Basis-URL konfiguriert ist,
 * um das Emittieren nicht existierender Domaenen (z. B. grade-ai.ch) zu verhindern.
 */
export function getBaseUrl(): string | undefined {
  const envUrl =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.BASE_URL && process.env.BASE_URL !== '/' ? process.env.BASE_URL : undefined) ||
    process.env.RENDER_EXTERNAL_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

  if (!envUrl || !envUrl.trim()) {
    return undefined;
  }

  const trimmed = envUrl.trim();
  const normalized =
    trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `https://${trimmed}`;

  try {
    const parsed = new URL(normalized);
    return parsed.origin;
  } catch {
    return undefined;
  }
}

export function buildRootMetadata(baseUrl: string | undefined = getBaseUrl()): Metadata {
  return {
    ...(baseUrl ? { metadataBase: new URL(baseUrl) } : {}),
    title: {
      default: 'prüefli - Intelligente Prüfungskorrektur für Lehrpersonen',
      template: '%s | prüefli',
    },
    description:
      'Die Schweizer Korrektur-Plattform für Schulen: Automatisierte Prüfungsbewertung mit Handschrifterkennung, Teilschritt-Bewertung und transparenter Fehleranalyse.',
    icons: {
      icon: [
        { url: '/icon.svg', type: 'image/svg+xml' },
        { url: '/favicon.ico', sizes: '32x32' },
      ],
      apple: [{ url: '/icon.svg' }],
    },
    manifest: '/manifest.webmanifest',
  };
}

export function buildHomeMetadata(baseUrl: string | undefined = getBaseUrl()): Metadata {
  return {
    title: 'prüefli - Intelligente Prüfungskorrektur für Lehrpersonen',
    description:
      'Die Schweizer Korrektur-Plattform für Schulen: Automatisierte Prüfungsbewertung mit Handschrifterkennung, Teilschritt-Bewertung und transparenter Fehleranalyse.',
    ...(baseUrl
      ? {
          alternates: {
            canonical: '/',
          },
        }
      : {}),
    openGraph: {
      title: 'prüefli - Intelligente Prüfungskorrektur für Lehrpersonen',
      description:
        'Die Schweizer Korrektur-Plattform für Schulen: Automatisierte Prüfungsbewertung mit Handschrifterkennung, Teilschritt-Bewertung und transparenter Fehleranalyse.',
      siteName: 'prüefli',
      locale: 'de_CH',
      type: 'website',
      ...(baseUrl
        ? {
            url: '/',
            images: [
              {
                url: '/og-image.png',
                width: 1200,
                height: 630,
                alt: 'prüefli - Intelligente Prüfungskorrektur für Lehrpersonen',
              },
            ],
          }
        : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: 'prüefli - Intelligente Prüfungskorrektur für Lehrpersonen',
      description:
        'Die Schweizer Korrektur-Plattform für Schulen: Automatisierte Prüfungsbewertung mit Handschrifterkennung, Teilschritt-Bewertung und transparenter Fehleranalyse.',
      ...(baseUrl
        ? {
            images: ['/og-image.png'],
          }
        : {}),
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}
