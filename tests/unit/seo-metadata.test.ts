import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import manifest from '@/app/manifest';
import { metadata as rootMetadata } from '@/app/layout';
import { metadata as homeMetadata } from '@/app/page';
import { buildRootMetadata, buildHomeMetadata } from '@/lib/seo-url';
import { metadata as dashboardMeta } from '@/app/dashboard/layout';
import { metadata as classesMeta } from '@/app/classes/layout';
import { metadata as examsMeta } from '@/app/exams/layout';
import { metadata as submissionsMeta } from '@/app/submissions/layout';
import { metadata as correctMeta } from '@/app/correct/layout';
import { metadata as logsMeta } from '@/app/logs/layout';
import { metadata as studentsMeta } from '@/app/students/layout';
import { metadata as scanMeta } from '@/app/scan/layout';
import { metadata as loginMeta } from '@/app/login/layout';
import { metadata as registerMeta } from '@/app/register/layout';
import * as fs from 'fs';
import * as path from 'path';

describe('SEO Metadata, Robots, Sitemap & Icons (Issue #17 & #22)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.BASE_URL;
    delete process.env.RENDER_EXTERNAL_URL;
    delete process.env.VERCEL_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('app/robots.ts erlaubt die Landing-Page, sperrt geschuetzte Routen aus und emittiert keine tote Fallback-Domain', () => {
    const robotsUnconfigured = robots();
    const rules = Array.isArray(robotsUnconfigured.rules)
      ? robotsUnconfigured.rules[0]
      : robotsUnconfigured.rules;

    expect(rules.allow).toContain('/$');

    const disallows = Array.isArray(rules.disallow) ? rules.disallow : [rules.disallow];
    expect(disallows).toEqual(
      expect.arrayContaining([
        '/dashboard/',
        '/classes/',
        '/exams/',
        '/submissions/',
        '/correct/',
        '/logs/',
        '/students/',
        '/scan/',
        '/login/',
        '/register/',
        '/api/',
      ])
    );
    expect(robotsUnconfigured.sitemap).toBeUndefined();

    process.env.APP_URL = 'https://grade-ai-qkkc.onrender.com';
    const robotsConfigured = robots();
    expect(robotsConfigured.sitemap).toBe('https://grade-ai-qkkc.onrender.com/sitemap.xml');
  });

  it('app/sitemap.ts bleibt ohne konfigurierte Basis-URL leer und fuehrt mit Basis-URL nur die Landing-Page auf', () => {
    expect(sitemap()).toEqual([]);

    process.env.APP_URL = 'https://grade-ai-qkkc.onrender.com';
    const sitemapData = sitemap();
    expect(sitemapData).toHaveLength(1);
    expect(sitemapData[0].url).toBe('https://grade-ai-qkkc.onrender.com/');
    expect(sitemapData[0].priority).toBe(1.0);
    expect(sitemapData[0].changeFrequency).toBe('weekly');
  });

  it('app/manifest.ts liefert ein vollstaendiges Web-App-Manifest mit Icons', () => {
    const manifestData = manifest();
    expect(manifestData.name).toContain('prüefli');
    expect(manifestData.start_url).toBe('/');
    expect(manifestData.display).toBe('standalone');
    expect(manifestData.icons?.length).toBeGreaterThan(0);
  });

  it('app/layout.tsx definiert Favicon & App-Icons und setzt metadataBase nur bei konfigurierter Basis-URL', () => {
    expect(rootMetadata.icons).toBeDefined();
    expect(rootMetadata.manifest).toBe('/manifest.webmanifest');

    const unconfigured = buildRootMetadata(undefined);
    expect(unconfigured.metadataBase).toBeUndefined();

    const configured = buildRootMetadata('https://grade-ai-qkkc.onrender.com');
    expect(configured.metadataBase).toEqual(new URL('https://grade-ai-qkkc.onrender.com'));
  });

  it('Landing-Page app/page.tsx definiert OpenGraph-, Twitter- und kanonische Metadaten ohne tote Fallback-Domain', () => {
    expect(homeMetadata.title).toBeDefined();
    expect(homeMetadata.description).toBeDefined();
    expect(homeMetadata.robots).toEqual({ index: true, follow: true });

    const unconfigured = buildHomeMetadata(undefined);
    expect(unconfigured.alternates).toBeUndefined();
    const ogUnconfigured = unconfigured.openGraph as Record<string, unknown>;
    expect(ogUnconfigured.title).toContain('prüefli');
    expect(ogUnconfigured.type).toBe('website');
    expect(ogUnconfigured.locale).toBe('de_CH');
    expect(ogUnconfigured.url).toBeUndefined();
    expect(ogUnconfigured.images).toBeUndefined();

    const configured = buildHomeMetadata('https://grade-ai-qkkc.onrender.com');
    expect(configured.alternates?.canonical).toBe('/');
    const ogConfigured = configured.openGraph as Record<string, unknown>;
    expect(ogConfigured.url).toBe('/');
    expect(Array.isArray(ogConfigured.images)).toBe(true);
    const twitterConfigured = configured.twitter as Record<string, unknown>;
    expect(twitterConfigured.card).toBe('summary_large_image');
    expect(twitterConfigured.images).toBeDefined();
  });

  it('alle internen App-Routen tragen explizit noindex & nofollow', () => {
    const noIndexMetas = [
      dashboardMeta,
      classesMeta,
      examsMeta,
      submissionsMeta,
      correctMeta,
      logsMeta,
      studentsMeta,
      scanMeta,
      loginMeta,
      registerMeta,
    ];

    for (const meta of noIndexMetas) {
      expect(meta.robots).toEqual({ index: false, follow: false });
    }
  });

  it('alle statischen Asset-Dateien (OG-Image, Favicon, SVG-Icon) existieren auf der Festplatte', () => {
    const ogImagePath = path.join(process.cwd(), 'public/og-image.png');
    const faviconPath = path.join(process.cwd(), 'public/favicon.ico');
    const iconSvgApp = path.join(process.cwd(), 'app/icon.svg');
    const iconSvgPublic = path.join(process.cwd(), 'public/icon.svg');

    expect(fs.existsSync(ogImagePath)).toBe(true);
    expect(fs.statSync(ogImagePath).size).toBeGreaterThan(1000);

    expect(fs.existsSync(faviconPath)).toBe(true);
    expect(fs.statSync(faviconPath).size).toBeGreaterThan(100);

    expect(fs.existsSync(iconSvgApp)).toBe(true);
    expect(fs.existsSync(iconSvgPublic)).toBe(true);
  });

  it('haelt Schweizer Rechtschreibung ein (kein "ß")', () => {
    const filesToCheck = [
      'lib/seo-url.ts',
      'app/robots.ts',
      'app/sitemap.ts',
      'app/manifest.ts',
      'app/layout.tsx',
      'app/page.tsx',
    ];

    for (const relPath of filesToCheck) {
      const fullPath = path.join(process.cwd(), relPath);
      const content = fs.readFileSync(fullPath, 'utf-8');
      expect(content).not.toContain('ß');
    }
  });
});
