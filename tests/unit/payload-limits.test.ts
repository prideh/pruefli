import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getPayloadLimits,
  validateMaterialPayload,
  validateScanFile,
  validateRelayPages,
  validateRubricOrTemplatePayload,
  formatMb,
  createPayloadErrorResponse,
  MAX_CLASS_NAME_LENGTH,
  validateClassName,
} from '@/lib/payload-limits';
import { POST as generatePost } from '@/app/api/exams/generate/route';
import { POST as correctPost } from '@/app/api/correct/route';
import { POST as relayUploadPost } from '@/app/api/mobile-relay/upload/route';
import { POST as parseRubricPost } from '@/app/api/exams/parse-rubric/route';
import * as rateLimitModule from '@/lib/rate-limit';
import * as sessionModule from '@/lib/session';
import * as jwtModule from '@/lib/jwt';
import { markEmailVerified } from '@/lib/email-verification';
import fs from 'fs';
import path from 'path';

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkAiRateLimit: vi.fn(),
  createRateLimitResponse: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    class: {
      findFirst: vi.fn(),
    },
    submission: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    exam: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    student: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/jwt', () => ({
  verifyMobileRelayToken: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  getStorageAdapter: vi.fn(() => ({
    write: vi.fn().mockResolvedValue('test-storage-key'),
    read: vi.fn(),
    delete: vi.fn(),
    exists: vi.fn(),
  })),
}));

describe('Kostenkontrolle: Grössenlimits für Unterrichtsmaterial und Scans', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env = { ...originalEnv };
    delete process.env.MAX_SCAN_FILE_SIZE_BYTES;
    delete process.env.MAX_MATERIAL_TEXT_CHARS;
    delete process.env.MAX_MATERIAL_DOC_BYTES;
    delete process.env.MAX_RELAY_PAGES;
    delete process.env.MAX_RELAY_PAGE_FILE_SIZE_BYTES;
    delete process.env.MAX_RELAY_TOTAL_BYTES;
    delete process.env.MAX_RUBRIC_TEXT_CHARS;
    delete process.env.MAX_RUBRIC_DOC_BYTES;
    vi.restoreAllMocks();
    await markEmailVerified('teacher-1', 'teacher1@schule.ch');

    vi.mocked(rateLimitModule.checkAiRateLimit).mockResolvedValue({
      allowed: true,
      limit: 60,
      remaining: 59,
      retryAfterSeconds: 0,
      resetMs: 0,
    });
  });

  describe('Standard-Konfiguration und Env-Overrides', () => {
    it('verwendet praxistaugliche Standardwerte', () => {
      const limits = getPayloadLimits();
      expect(limits.maxScanFileSizeBytes).toBe(25 * 1024 * 1024);
      expect(limits.maxMaterialTextChars).toBe(100_000);
      expect(limits.maxMaterialDocBytes).toBe(25 * 1024 * 1024);
      expect(limits.maxRelayPages).toBe(15);
      expect(limits.maxRelayPageFileSizeBytes).toBe(20 * 1024 * 1024);
      expect(limits.maxRelayTotalBytes).toBe(50 * 1024 * 1024);
      expect(limits.maxRubricTextChars).toBe(100_000);
      expect(limits.maxRubricDocBytes).toBe(25 * 1024 * 1024);
    });

    it('akzeptiert konfigurierbare Grenzwerte via Umgebungsvariablen', () => {
      process.env.MAX_SCAN_FILE_SIZE_BYTES = '10485760'; // 10 MB
      process.env.MAX_MATERIAL_TEXT_CHARS = '50000';
      process.env.MAX_MATERIAL_DOC_BYTES = '15728640'; // 15 MB
      process.env.MAX_RELAY_PAGES = '8';
      process.env.MAX_RELAY_PAGE_FILE_SIZE_BYTES = '10485760'; // 10 MB
      process.env.MAX_RELAY_TOTAL_BYTES = '31457280'; // 30 MB
      process.env.MAX_RUBRIC_TEXT_CHARS = '40000';
      process.env.MAX_RUBRIC_DOC_BYTES = '12582912'; // 12 MB

      const limits = getPayloadLimits();
      expect(limits.maxScanFileSizeBytes).toBe(10485760);
      expect(limits.maxMaterialTextChars).toBe(50_000);
      expect(limits.maxMaterialDocBytes).toBe(15728640);
      expect(limits.maxRelayPages).toBe(8);
      expect(limits.maxRelayPageFileSizeBytes).toBe(10485760);
      expect(limits.maxRelayTotalBytes).toBe(31457280);
      expect(limits.maxRubricTextChars).toBe(40_000);
      expect(limits.maxRubricDocBytes).toBe(12582912);
    });

    it('fällt bei ungültigen Env-Werten sicher auf Standardwerte zurück', () => {
      process.env.MAX_SCAN_FILE_SIZE_BYTES = 'invalid-number';
      process.env.MAX_MATERIAL_TEXT_CHARS = '-50';
      const limits = getPayloadLimits();
      expect(limits.maxScanFileSizeBytes).toBe(25 * 1024 * 1024);
      expect(limits.maxMaterialTextChars).toBe(100_000);
    });
  });

  describe('validateMaterialPayload', () => {
    it('akzeptiert normale Textunterlagen problemlos', () => {
      const normalText = 'Kapitel 1: Pythagoras. a^2 + b^2 = c^2.'.repeat(50);
      const res = validateMaterialPayload(normalText);
      expect(res.valid).toBe(true);
    });

    it('lehnt überdimensionierten Text mit HTTP 413 ab', () => {
      process.env.MAX_MATERIAL_TEXT_CHARS = '500';
      const hugeText = 'A'.repeat(501);
      const res = validateMaterialPayload(hugeText);
      expect(res.valid).toBe(false);
      expect(res.status).toBe(413);
      expect(res.error).toContain('Das Unterrichtsmaterial ist zu lang');
      expect(res.error).toContain('Maximal 500 Zeichen');
    });

    it('akzeptiert normale Dokumente als Base64-Payload', () => {
      const sampleDoc = {
        mimeType: 'application/pdf',
        data: Buffer.from('PDF Content').toString('base64'),
      };
      const res = validateMaterialPayload(sampleDoc);
      expect(res.valid).toBe(true);
    });

    it('lehnt überdimensionierte Dokumente als Base64 mit HTTP 413 ab', () => {
      process.env.MAX_MATERIAL_DOC_BYTES = '1024'; // 1 KB
      const oversizedBuffer = Buffer.alloc(2048, 1);
      const oversizedDoc = {
        mimeType: 'application/pdf',
        data: oversizedBuffer.toString('base64'),
      };
      const res = validateMaterialPayload(oversizedDoc);
      expect(res.valid).toBe(false);
      expect(res.status).toBe(413);
      expect(res.error).toContain('Das Unterrichtsmaterial überschreitet die maximale Dateigrösse');
    });

    it('validiert JSON-serialisiertes Dokument im String', () => {
      process.env.MAX_MATERIAL_DOC_BYTES = '1024';
      const oversizedBuffer = Buffer.alloc(2048, 1);
      const jsonStr = JSON.stringify({
        mimeType: 'application/pdf',
        data: oversizedBuffer.toString('base64'),
      });
      const res = validateMaterialPayload(jsonStr);
      expect(res.valid).toBe(false);
      expect(res.status).toBe(413);
    });

    it('validiert mehrteilige Dokumenten-Arrays', () => {
      process.env.MAX_MATERIAL_DOC_BYTES = '3000';
      const buf1 = Buffer.alloc(2000, 1);
      const buf2 = Buffer.alloc(2000, 2);
      const docList = [
        { mimeType: 'image/jpeg', data: buf1.toString('base64') },
        { mimeType: 'image/jpeg', data: buf2.toString('base64') },
      ];
      const res = validateMaterialPayload(docList);
      expect(res.valid).toBe(false);
      expect(res.status).toBe(413);
    });
  });

  describe('validateScanFile', () => {
    it('akzeptiert Scans innerhalb des Limits', () => {
      const mockFile = { size: 5 * 1024 * 1024, name: 'scan.pdf' };
      const res = validateScanFile(mockFile, 'Die Schülerarbeit');
      expect(res.valid).toBe(true);
    });

    it('lehnt zu grosse Scandateien mit HTTP 413 ab', () => {
      const mockOversizedFile = { size: 30 * 1024 * 1024, name: 'huge_scan.pdf' };
      const res = validateScanFile(mockOversizedFile, 'Die Schülerarbeit');
      expect(res.valid).toBe(false);
      expect(res.status).toBe(413);
      expect(res.error).toBe('Die Schülerarbeit überschreitet die maximale Dateigrösse von 25 MB.');
    });

    it('akzeptiert null oder leere Dateiangaben neutral', () => {
      expect(validateScanFile(null).valid).toBe(true);
      expect(validateScanFile(undefined).valid).toBe(true);
    });
  });

  describe('validateRelayPages', () => {
    it('akzeptiert typische Smartphone-Fotouploads', () => {
      const pages = [
        { size: 3 * 1024 * 1024, name: 'page1.jpg' },
        { size: 4 * 1024 * 1024, name: 'page2.jpg' },
      ];
      const res = validateRelayPages(pages);
      expect(res.valid).toBe(true);
    });

    it('lehnt Uploads mit zu vielen Einzelseiten mit HTTP 413 ab', () => {
      process.env.MAX_RELAY_PAGES = '3';
      const pages = [
        { size: 1024, name: 'p1.jpg' },
        { size: 1024, name: 'p2.jpg' },
        { size: 1024, name: 'p3.jpg' },
        { size: 1024, name: 'p4.jpg' },
      ];
      const res = validateRelayPages(pages);
      expect(res.valid).toBe(false);
      expect(res.status).toBe(413);
      expect(res.error).toBe(
        'Zu viele Seiten hochgeladen. Es können maximal 3 Seiten auf einmal verarbeitet werden.'
      );
    });

    it('lehnt eine Einzelseite ab, die das Einzelseitenlimit überschreitet', () => {
      process.env.MAX_RELAY_PAGE_FILE_SIZE_BYTES = '5242880'; // 5 MB
      const pages = [
        { size: 1 * 1024 * 1024, name: 'p1.jpg' },
        { size: 6 * 1024 * 1024, name: 'p2.jpg' },
      ];
      const res = validateRelayPages(pages);
      expect(res.valid).toBe(false);
      expect(res.status).toBe(413);
      expect(res.error).toBe('Seite 2 überschreitet die maximale Dateigrösse von 5 MB.');
    });

    it('lehnt Gesamtupload ab, der das kombinierte Gesamtlimit überschreitet', () => {
      process.env.MAX_RELAY_PAGE_FILE_SIZE_BYTES = '10485760'; // 10 MB pro Seite
      process.env.MAX_RELAY_TOTAL_BYTES = '15728640'; // 15 MB gesamt
      const pages = [
        { size: 9 * 1024 * 1024, name: 'p1.jpg' },
        { size: 9 * 1024 * 1024, name: 'p2.jpg' },
      ];
      const res = validateRelayPages(pages);
      expect(res.valid).toBe(false);
      expect(res.status).toBe(413);
      expect(res.error).toBe('Die Gesamtgrösse aller Seiten überschreitet das Limit von 15 MB.');
    });
  });

  describe('validateRubricOrTemplatePayload', () => {
    it('akzeptiert normale Musterlösungen als Text oder File', () => {
      expect(
        validateRubricOrTemplatePayload('1. Aufgabe: 4 Punkte\n2. Aufgabe: 6 Punkte').valid
      ).toBe(true);
      expect(validateRubricOrTemplatePayload({ size: 2 * 1024 * 1024 }).valid).toBe(true);
    });

    it('lehnt überdimensionierte Text-Musterlösungen ab', () => {
      process.env.MAX_RUBRIC_TEXT_CHARS = '200';
      const oversizedText = 'R'.repeat(201);
      const res = validateRubricOrTemplatePayload(oversizedText, 'Die Musterlösung');
      expect(res.valid).toBe(false);
      expect(res.status).toBe(413);
      expect(res.error).toContain('Die Musterlösung ist zu lang');
    });

    it('lehnt überdimensionierte Musterlösungs-Dateien ab', () => {
      process.env.MAX_SCAN_FILE_SIZE_BYTES = '1048576'; // 1 MB
      const res = validateRubricOrTemplatePayload({ size: 2 * 1024 * 1024 }, 'Die Musterlösung');
      expect(res.valid).toBe(false);
      expect(res.status).toBe(413);
      expect(res.error).toBe('Die Musterlösung überschreitet die maximale Dateigrösse von 1 MB.');
    });
  });

  describe('createPayloadErrorResponse', () => {
    it('erzeugt eine standardisierte NextResponse mit HTTP 413', async () => {
      const response = createPayloadErrorResponse({
        valid: false,
        error: 'Testfehler Dateigrösse',
        status: 413,
      });
      expect(response.status).toBe(413);
      const data = await response.json();
      expect(data.error).toBe('Testfehler Dateigrösse');
    });
  });

  describe('Endpunkt-Integration', () => {
    it('POST /api/exams/generate lehnt übergrosses Unterrichtsmaterial mit 413 ab', async () => {
      vi.mocked(sessionModule.getSession).mockResolvedValue({
        userId: 'teacher-1',
      });

      process.env.MAX_MATERIAL_TEXT_CHARS = '200';
      const req = new Request('http://localhost/api/exams/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          material: 'M'.repeat(300),
          classId: 'c1',
        }),
      });

      const res = await generatePost(req);
      expect(res.status).toBe(413);
      const json = await res.json();
      expect(json.error).toContain('Das Unterrichtsmaterial ist zu lang');
    });

    it('POST /api/correct lehnt übergrosse Schülerarbeit mit 413 ab', async () => {
      vi.mocked(sessionModule.getSession).mockResolvedValue({
        userId: 'teacher-1',
      });

      process.env.GEMINI_API_KEY = 'test-key';
      process.env.MAX_SCAN_FILE_SIZE_BYTES = '1024'; // 1 KB

      const fakeLargeScan = new File(['x'.repeat(2048)], 'scan.pdf', {
        type: 'application/pdf',
      });
      const formData = new FormData();
      formData.append('classId', 'class-1');
      formData.append('studentExam', fakeLargeScan);

      const req = new Request('http://localhost/api/correct', {
        method: 'POST',
        body: formData,
      });

      const res = await correctPost(req);
      expect(res.status).toBe(413);
      const json = await res.json();
      expect(json.error).toContain('Die Schülerarbeit überschreitet die maximale Dateigrösse');
    });

    it('POST /api/mobile-relay/upload lehnt zu viele Seiten mit 413 ab', async () => {
      vi.mocked(jwtModule.verifyMobileRelayToken).mockResolvedValue({
        purpose: 'mobile_relay',
        sessionId: 'sess-1',
        teacherId: 'teacher-1',
        targetMode: 'SUBMISSION',
      });

      process.env.MAX_RELAY_PAGES = '2';

      const formData = new FormData();
      formData.append('token', 'valid-token');
      formData.append('pages', new File(['page1'], 'p1.jpg', { type: 'image/jpeg' }));
      formData.append('pages', new File(['page2'], 'p2.jpg', { type: 'image/jpeg' }));
      formData.append('pages', new File(['page3'], 'p3.jpg', { type: 'image/jpeg' }));

      const req = new Request('http://localhost/api/mobile-relay/upload', {
        method: 'POST',
        body: formData,
      });

      const res = await relayUploadPost(req);
      expect(res.status).toBe(413);
      const json = await res.json();
      expect(json.error).toContain('Zu viele Seiten hochgeladen');
    });

    it('POST /api/exams/parse-rubric lehnt übergrosse Musterlösung mit 413 ab', async () => {
      vi.mocked(sessionModule.getSession).mockResolvedValue({
        userId: 'teacher-1',
      });

      process.env.MAX_RUBRIC_TEXT_CHARS = '100';

      const req = new Request('http://localhost/api/exams/parse-rubric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rubricText: 'R'.repeat(150),
        }),
      });

      const res = await parseRubricPost(req);
      expect(res.status).toBe(413);
      const json = await res.json();
      expect(json.error).toContain('Die Musterlösung ist zu lang');
    });
  });

  describe('validateClassName', () => {
    it('akzeptiert normale Klassennamen problemlos', () => {
      expect(validateClassName('3. Sek A').valid).toBe(true);
      expect(validateClassName('Klasse 9c').valid).toBe(true);
      expect(validateClassName('A'.repeat(MAX_CLASS_NAME_LENGTH)).valid).toBe(true);
    });

    it('lehnt leere oder nur aus Leerzeichen bestehende Namen ab', () => {
      expect(validateClassName('').valid).toBe(false);
      expect(validateClassName('   ').valid).toBe(false);
      expect(validateClassName(null).valid).toBe(false);
      expect(validateClassName(undefined).valid).toBe(false);
      expect(validateClassName('').error).toBe('Klassenname ist erforderlich.');
      expect(validateClassName('').status).toBe(400);
    });

    it('lehnt Klassennamen über dem Maximallimit von 100 Zeichen mit HTTP 400 ab', () => {
      const longName = 'K'.repeat(101);
      const res = validateClassName(longName);
      expect(res.valid).toBe(false);
      expect(res.status).toBe(400);
      expect(res.error).toBe('Der Klassenname ist zu lang. Maximal 100 Zeichen sind erlaubt.');
    });

    it('lehnt 300-Zeichen-Klassennamen ab', () => {
      const hugeName = 'A'.repeat(300);
      const res = validateClassName(hugeName);
      expect(res.valid).toBe(false);
      expect(res.status).toBe(400);
      expect(res.error).toBe('Der Klassenname ist zu lang. Maximal 100 Zeichen sind erlaubt.');
    });
  });

  describe('Schweizer Hochdeutsch (Kein "ß")', () => {
    it('enthält kein "ß" in den Fehlermeldungen und Hilfsfunktionen', () => {
      const testCases = [
        formatMb(25 * 1024 * 1024),
        validateMaterialPayload('X'.repeat(200_000)).error || '',
        validateScanFile({ size: 30 * 1024 * 1024 }).error || '',
        validateRelayPages(Array(20).fill({ size: 100 })).error || '',
        validateRelayPages([{ size: 30 * 1024 * 1024 }]).error || '',
        validateRelayPages([{ size: 30 * 1024 * 1024 }, { size: 30 * 1024 * 1024 }]).error || '',
        validateRubricOrTemplatePayload('Y'.repeat(200_000)).error || '',
        validateClassName('Z'.repeat(150)).error || '',
      ];

      for (const text of testCases) {
        expect(text).not.toContain('ß');
      }
    });

    it('stellt sicher, dass in lib/payload-limits.ts kein "ß" vorkommt', () => {
      const filePath = path.join(process.cwd(), 'lib/payload-limits.ts');
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).not.toContain('ß');
    });
  });
});
