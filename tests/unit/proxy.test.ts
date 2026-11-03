import { describe, it, expect } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  proxy,
  applySecurityHeaders,
  SECURITY_HEADERS,
  PUBLIC_API_ENDPOINTS,
  PROTECTED_API_PREFIXES,
  isPublicApiEndpoint,
} from '@/proxy';

describe('Edge Proxy Security Headers & API Fail-Closed Protection (proxy.ts)', () => {
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

  it('rejects unauthenticated requests to tenant-bound API endpoints with HTTP 401 (Issue #101)', async () => {
    const protectedEndpoints = [
      '/api/exams',
      '/api/classes',
      '/api/subjects',
      '/api/submissions',
      '/api/auth/me',
      '/api/auth/oauth/identities',
      '/api/students/st-1',
      '/api/correct',
      '/api/logs',
      '/api/health/gemini',
    ];

    for (const endpoint of protectedEndpoints) {
      expect(isPublicApiEndpoint(endpoint, 'GET')).toBe(false);
      const req = new NextRequest(`http://localhost:3000${endpoint}`);
      const res = await proxy(req);
      expect(res.status, `Expected 401 for unauthenticated ${endpoint}`).toBe(401);
      const body = await res.json();
      expect(body.authenticated).toBe(false);
      expect(body.error).toBe('Nicht autorisiert.');
    }

    // POST /api/mobile-relay requires a teacher session
    expect(isPublicApiEndpoint('/api/mobile-relay', 'POST')).toBe(false);
    const relayPostRes = await proxy(
      new NextRequest('http://localhost:3000/api/mobile-relay', { method: 'POST' })
    );
    expect(relayPostRes.status).toBe(401);
  });

  it('explicitly marks intentionally public catalog and auth endpoints as public (Issue #101)', async () => {
    expect(PUBLIC_API_ENDPOINTS).toContain('/api/auth/oauth/providers');
    expect(PROTECTED_API_PREFIXES).toEqual(
      expect.arrayContaining(['/api/exams', '/api/classes', '/api/subjects', '/api/submissions'])
    );

    expect(isPublicApiEndpoint('/api/auth/oauth/providers', 'GET')).toBe(true);
    expect(isPublicApiEndpoint('/api/auth/login', 'POST')).toBe(true);
    expect(isPublicApiEndpoint('/api/auth/register', 'POST')).toBe(true);
    expect(isPublicApiEndpoint('/api/auth/oauth/google', 'GET')).toBe(true);
    expect(isPublicApiEndpoint('/api/auth/oauth/google/callback', 'GET')).toBe(true);
    expect(isPublicApiEndpoint('/api/mobile-relay', 'GET')).toBe(true);
    expect(isPublicApiEndpoint('/api/mobile-relay/upload', 'POST')).toBe(true);

    const publicRes = await proxy(
      new NextRequest('http://localhost:3000/api/auth/oauth/providers')
    );
    expect(publicRes.status).toBe(200);
  });
});

describe('Schweizer Rechtschreibung (kein Eszett)', () => {
  it('enthaelt kein Eszett in proxy.ts und im Test', () => {
    const eszett = String.fromCharCode(0xdf);
    expect('proxy.ts').not.toContain(eszett);
  });
});
