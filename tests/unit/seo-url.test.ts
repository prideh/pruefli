import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getBaseUrl } from '@/lib/seo-url';

describe('getBaseUrl (lib/seo-url.ts)', () => {
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

  it('returns undefined when no base URL environment variable is set', () => {
    expect(getBaseUrl()).toBeUndefined();
  });

  it('never returns the dead fallback domain grade-ai.ch when unset', () => {
    const url = getBaseUrl();
    expect(url).toBeUndefined();
    expect(url).not.toBe('https://grade-ai.ch');
  });

  it('prioritizes APP_URL over other environment variables', () => {
    process.env.APP_URL = 'https://app.pruefli.ch';
    process.env.NEXT_PUBLIC_APP_URL = 'https://public.pruefli.ch';
    process.env.BASE_URL = 'https://base.pruefli.ch';
    process.env.RENDER_EXTERNAL_URL = 'https://grade-ai-qkkc.onrender.com';
    expect(getBaseUrl()).toBe('https://app.pruefli.ch');
  });

  it('uses NEXT_PUBLIC_APP_URL if APP_URL is absent', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://grade-ai-qkkc.onrender.com';
    expect(getBaseUrl()).toBe('https://grade-ai-qkkc.onrender.com');
  });

  it('uses BASE_URL if APP_URL and NEXT_PUBLIC_APP_URL are absent', () => {
    process.env.BASE_URL = 'https://custom-domain.ch';
    expect(getBaseUrl()).toBe('https://custom-domain.ch');
  });

  it('ignores BASE_URL when set to "/" in test environments', () => {
    process.env.BASE_URL = '/';
    expect(getBaseUrl()).toBeUndefined();
  });

  it('uses RENDER_EXTERNAL_URL if APP_URL, NEXT_PUBLIC_APP_URL, and BASE_URL are absent', () => {
    process.env.RENDER_EXTERNAL_URL = 'https://grade-ai-qkkc.onrender.com';
    expect(getBaseUrl()).toBe('https://grade-ai-qkkc.onrender.com');
  });

  it('uses VERCEL_URL if other variables are absent', () => {
    process.env.VERCEL_URL = 'pruefli-preview.vercel.app';
    expect(getBaseUrl()).toBe('https://pruefli-preview.vercel.app');
  });

  it('normalizes URLs missing a scheme by prepending https://', () => {
    process.env.APP_URL = 'pruefli.ch';
    expect(getBaseUrl()).toBe('https://pruefli.ch');
  });

  it('normalizes paths and strips subpaths down to the origin', () => {
    process.env.APP_URL = 'https://pruefli.ch/subpath/page?query=1';
    expect(getBaseUrl()).toBe('https://pruefli.ch');
  });

  it('returns undefined for malformed URL strings', () => {
    process.env.APP_URL = 'http://:not-a-valid-url';
    expect(getBaseUrl()).toBeUndefined();
  });

  it('provides a German branded 404 NotFound page with link back to /dashboard (Issue #77)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const notFoundPath = path.resolve(process.cwd(), 'app/not-found.tsx');
    expect(fs.existsSync(notFoundPath)).toBe(true);

    const content = fs.readFileSync(notFoundPath, 'utf8');
    expect(content).toContain('prüefli');
    expect(content).toContain('Seite nicht gefunden');
    expect(content).toContain('Zur Übersicht');
    expect(content).toContain('href="/dashboard"');
    expect(content).not.toContain('This page could not be found');
    expect(content).not.toContain('\u00df');
  });
});
