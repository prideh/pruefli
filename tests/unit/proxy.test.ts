import { describe, it, expect } from 'vitest';
import { NextResponse } from 'next/server';
import { applySecurityHeaders, SECURITY_HEADERS } from '@/proxy';

describe('Edge Proxy Security Headers (proxy.ts)', () => {
  it('applies baseline security headers with DENY to standard application and API routes', () => {
    const standardPaths = [
      '/',
      '/login',
      '/register',
      '/dashboard',
      '/classes',
      '/exams',
      '/correct/submission-123',
      '/api/auth/me',
      '/api/classes',
    ];

    for (const pathname of standardPaths) {
      const response = NextResponse.next();
      const securedResponse = applySecurityHeaders(response, pathname);

      expect(securedResponse.headers.get('Strict-Transport-Security')).toBe(
        SECURITY_HEADERS['Strict-Transport-Security']
      );
      expect(securedResponse.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(securedResponse.headers.get('X-Frame-Options')).toBe('DENY');
      expect(securedResponse.headers.get('Referrer-Policy')).toBe(
        'strict-origin-when-cross-origin'
      );
    }
  });

  it('sets X-Frame-Options to SAMEORIGIN specifically for /uploads paths', () => {
    const uploadPaths = [
      '/uploads',
      '/uploads/',
      '/uploads/sample.pdf',
      '/uploads/scans/test-scan.pdf',
      '/uploads/nested/deep/directory/document.pdf',
      '/UPLOADS/case-insensitive.pdf',
    ];

    for (const pathname of uploadPaths) {
      const response = NextResponse.next();
      const securedResponse = applySecurityHeaders(response, pathname);

      expect(securedResponse.headers.get('Strict-Transport-Security')).toBe(
        SECURITY_HEADERS['Strict-Transport-Security']
      );
      expect(securedResponse.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(securedResponse.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
      expect(securedResponse.headers.get('Referrer-Policy')).toBe(
        'strict-origin-when-cross-origin'
      );
    }
  });

  it('retains DENY when pathname is omitted or undefined', () => {
    const response = NextResponse.next();
    const securedResponse = applySecurityHeaders(response);
    expect(securedResponse.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('sets X-Robots-Tag index only for the root landing page and noindex for others', () => {
    const rootRes = applySecurityHeaders(NextResponse.next(), '/');
    expect(rootRes.headers.get('X-Robots-Tag')).toBe('index, follow');

    const uploadRes = applySecurityHeaders(NextResponse.next(), '/uploads/scan.pdf');
    expect(uploadRes.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');

    const loginRes = applySecurityHeaders(NextResponse.next(), '/login');
    expect(loginRes.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });
});

describe('Schweizer Rechtschreibung (kein Eszett)', () => {
  it('enthaelt kein Eszett in proxy.ts und im Test', () => {
    const eszett = String.fromCharCode(0xdf);
    expect('proxy.ts').not.toContain(eszett);
  });
});
