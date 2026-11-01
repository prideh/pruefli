import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Buffer } from 'node:buffer';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import {
  validateDocument,
  isNonExamDocument,
  detectBlankOrEmptyImage,
} from '@/lib/document-validation';
import { POST as correctPost } from '@/app/api/correct/route';
import { POST as parseRubricPost } from '@/app/api/exams/parse-rubric/route';
import { POST as generatePost } from '@/app/api/exams/generate/route';
import { POST as examsPost } from '@/app/api/exams/route';
import { POST as relayUploadPost } from '@/app/api/mobile-relay/upload/route';
import { POST as replacePost } from '@/app/api/submissions/[id]/replace/route';
import * as geminiModule from '@/lib/gemini';
import * as examGenModule from '@/lib/exam-generator';
import * as sessionModule from '@/lib/session';
import * as jwtModule from '@/lib/jwt';

// =============================================================================
// Instrument and mock model calls to verify NO LLM call occurs in rejection path
// =============================================================================
const mockGeminiGenerateContent = vi.fn();
const mockRunLiveGeminiCorrection = vi.fn();
const mockIdentifyExamAndStudentFromScan = vi.fn();
const mockGenerateExamFromMaterial = vi.fn();

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    after: vi.fn(),
  };
});

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent: mockGeminiGenerateContent,
    };
  },
  Type: {
    OBJECT: 'OBJECT',
    STRING: 'STRING',
    NUMBER: 'NUMBER',
    BOOLEAN: 'BOOLEAN',
    ARRAY: 'ARRAY',
    INTEGER: 'INTEGER',
  },
  ThinkingLevel: {
    LOW: 'LOW',
    HIGH: 'HIGH',
  },
}));

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/jwt', () => ({
  verifyMobileRelayToken: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkAiRateLimit: vi.fn().mockResolvedValue({
    allowed: true,
    limit: 60,
    remaining: 59,
    retryAfterSeconds: 0,
    resetMs: 0,
  }),
  createRateLimitResponse: vi.fn(),
}));

const mockStorageMap = new Map<string, { buffer: Buffer; contentType: string }>();

vi.mock('@/lib/storage', () => ({
  getStorageAdapter: vi.fn(() => ({
    write: vi.fn().mockImplementation(async (fileName: string, buffer: Buffer, mime: string) => {
      mockStorageMap.set(fileName, { buffer, contentType: mime });
      return fileName;
    }),
    read: vi.fn().mockImplementation(async (key: string) => {
      return mockStorageMap.get(key) || null;
    }),
    exists: vi.fn().mockImplementation(async (key: string) => {
      return mockStorageMap.has(key);
    }),
    delete: vi.fn().mockResolvedValue(true),
  })),
}));

vi.mock('@/lib/db', () => ({
  db: {
    class: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: 'class-1', name: '3. Sek A', teacherId: 'teacher-1' }),
    },
    exam: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'exam-1',
        title: 'Mathematik Prüfung',
        subject: 'Mathematik',
        rubricText: '# Musterlösung\nAufgabe 1: 4 Punkte',
        examTemplateText: null,
        gradingNotes: '{"isApproved":true}',
        gradingFormula: 'LINEAR_60',
        gradeRounding: '0.1',
        maxPoints: 20,
        classId: 'class-1',
        class: { id: 'class-1', name: '3. Sek A', teacherId: 'teacher-1', students: [] },
        tasks: [],
      }),
      findUnique: vi.fn().mockResolvedValue({
        id: 'exam-1',
        title: 'Mathematik Prüfung',
        subject: 'Mathematik',
        rubricText: '# Musterlösung\nAufgabe 1: 4 Punkte',
        examTemplateText: null,
        gradingNotes: '{"isApproved":true}',
        gradingFormula: 'LINEAR_60',
        gradeRounding: '0.1',
        maxPoints: 20,
        classId: 'class-1',
        class: { id: 'class-1', name: '3. Sek A', teacherId: 'teacher-1', students: [] },
        tasks: [],
      }),
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'exam-1',
          title: 'Mathematik Prüfung',
          subject: 'Mathematik',
          gradingNotes: '{"isApproved":true}',
          classId: 'class-1',
          class: { id: 'class-1', name: '3. Sek A', teacherId: 'teacher-1', students: [] },
          tasks: [],
        },
      ]),
      create: vi
        .fn()
        .mockResolvedValue({ id: 'exam-new-1', title: 'Neue Prüfung', classId: 'class-1' }),
      update: vi.fn().mockResolvedValue({ id: 'exam-1' }),
    },
    submission: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue({
        id: 'sub-1',
        examId: 'exam-1',
        studentId: 'student-1',
        studentExamUrl: 'stored-scan.pdf',
        exam: {
          id: 'exam-1',
          title: 'Mathematik Prüfung',
          subject: 'Mathematik',
          rubricText: '# Musterlösung\nAufgabe 1: 4 Punkte',
          examTemplateText: null,
          gradingNotes: '{"isApproved":true}',
          classId: 'class-1',
          class: { id: 'class-1', name: '3. Sek A', teacherId: 'teacher-1' },
          tasks: [],
        },
      }),
      create: vi.fn().mockResolvedValue({ id: 'sub-new-1' }),
      update: vi.fn().mockResolvedValue({ id: 'sub-1' }),
    },
    student: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: 'student-1', name: 'Anna Muster', classId: 'class-1' }),
      findUnique: vi
        .fn()
        .mockResolvedValue({ id: 'student-1', name: 'Anna Muster', classId: 'class-1' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    correctionLog: {
      create: vi.fn().mockResolvedValue({ id: 'log-1' }),
      update: vi.fn().mockResolvedValue({ id: 'log-1' }),
    },
    examTask: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb({
        exam: {
          create: vi.fn().mockResolvedValue({ id: 'exam-tx-1' }),
        },
        examTask: {
          createMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      });
    }),
  },
}));

// CRC32 helper for valid PNG generation
function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) {
      c = (c >>> 1) ^ (-(c & 1) & 0xedb88320);
    }
  }
  return ~c >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const crcVal = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * Creates a valid PNG buffer.
 * If blank=true, all pixels are white (255) to simulate an empty scan.
 * If textMeta is provided, embeds a tEXt chunk with the given keyword and text.
 */
function createTestPng(
  options: {
    width?: number;
    height?: number;
    blank?: boolean;
    textMeta?: { keyword: string; text: string };
  } = {}
): Buffer {
  const width = options.width ?? 100;
  const height = options.height ?? 100;
  const blank = options.blank ?? false;

  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // RGB
  ihdrData[10] = 0; // comp
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = makePngChunk('IHDR', ihdrData);

  // Optional tEXt chunk
  let textChunk: Buffer = Buffer.alloc(0);
  if (options.textMeta) {
    const kwBuf = Buffer.from(options.textMeta.keyword, 'ascii');
    const valBuf = Buffer.from(options.textMeta.text, 'utf-8');
    const tData = Buffer.concat([kwBuf, Buffer.from([0]), valBuf]);
    textChunk = makePngChunk('tEXt', tData);
  }

  // IDAT: Scanlines with filter byte 0 + RGB
  const rawScanlines: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0; // Filter None
    for (let x = 0; x < width; x++) {
      const offset = 1 + x * 3;
      if (blank) {
        row[offset] = 255;
        row[offset + 1] = 255;
        row[offset + 2] = 255;
      } else {
        row[offset] = (x * 7 + y * 13) % 256;
        row[offset + 1] = (x * 17 + y * 5) % 256;
        row[offset + 2] = (x * 3 + y * 29) % 256;
      }
    }
    rawScanlines.push(row);
  }

  const deflated = zlib.deflateSync(Buffer.concat(rawScanlines));
  const idatChunk = makePngChunk('IDAT', deflated);

  // IEND
  const iendChunk = makePngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdrChunk, textChunk, idatChunk, iendChunk]);
}

/**
 * Creates a valid test PDF buffer with optional embedded text streams and metadata.
 */
function createTestPdf(content: string, title?: string): Buffer {
  const streamData = `BT /F1 12 Tf 50 700 Td (${content}) Tj ET`;
  const streamDeflated = zlib.deflateSync(Buffer.from(streamData, 'utf-8'));

  const pdfText = `%PDF-1.4
1 0 obj
<< /Title (${title || 'Pruefung'}) >>
endobj
2 0 obj
<< /Length ${streamDeflated.length} /Filter /FlateDecode >>
stream
${streamDeflated.toString('binary')}
endstream
endobj
xref
0 3
0000000000 65535 f 
0000000010 00000 n 
0000000060 00000 n 
trailer
<< /Size 3 /Root 1 0 R >>
startxref
200
%%EOF`;

  return Buffer.from(pdfText, 'binary');
}

describe('Eingabe-Validierung vor jeder Modell-Nutzung (Issue #56)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageMap.clear();
    process.env.GEMINI_API_KEY = 'test-gemini-key';

    vi.mocked(sessionModule.getSession).mockResolvedValue({
      userId: 'teacher-1',
    });

    vi.spyOn(geminiModule, 'runLiveGeminiCorrection').mockImplementation(
      mockRunLiveGeminiCorrection
    );
    vi.spyOn(geminiModule, 'identifyExamAndStudentFromScan').mockImplementation(
      mockIdentifyExamAndStudentFromScan
    );
    vi.spyOn(examGenModule, 'generateExamFromMaterial').mockImplementation(
      mockGenerateExamFromMaterial
    );
  });

  describe('1. Standalone Document & Plausibility Validation (lib/document-validation.ts)', () => {
    it('erkennt Einverständniserklärungen und Consent Forms anhand des Dateinamens', () => {
      const names = [
        'Einverstaendniserklaerung.png',
        'einverstaendnisformular.png',
        'Declaration_of_Consent.pdf',
        'Declaration-of-Consent.png',
        'parental_consent_form.jpg',
        'consent-form.pdf',
        'Datenschutzerklaerung.pdf',
        'Rechnung_10293.pdf',
      ];

      for (const name of names) {
        const check = isNonExamDocument({ name });
        expect(check.isNonExam).toBe(true);
        expect(check.reason).toBeDefined();
        expect(check.reason).not.toContain('ß');
      }
    });

    it('erkennt Einverständniserklärungen im Text von Dokumenten', () => {
      const consentTexts = [
        'Einverständniserklärung zur Veröffentlichung von Schülerfotos.',
        'Declaration of Consent: I hereby grant my consent for data processing.',
        'Hiermit willige ich ein, dass mein Kind an der Schulveranstaltung teilnimmt. Unterschrift der Erziehungsberechtigten:',
      ];

      for (const text of consentTexts) {
        const check = isNonExamDocument({ text });
        expect(check.isNonExam).toBe(true);
        expect(check.reason).toContain('Einverständniserklärung');
        expect(check.reason).not.toContain('ß');
      }
    });

    it('akzeptiert reguläre Prüfungsdokumente mit Aufgaben und Punkten', () => {
      const examText =
        '# Mathematik Prüfung\nAufgabe 1 (4 Punkte): Löse die Gleichung 3x + 6 = 18.\nAufgabe 2 (6 Punkte): Textaufgabe.';
      const check = isNonExamDocument({ text: examText });
      expect(check.isNonExam).toBe(false);
    });

    it('erkennt vollständig leere oder weisse Scans (Blank Scans)', () => {
      const blankPng = createTestPng({ width: 100, height: 100, blank: true });
      const blankCheck = detectBlankOrEmptyImage(blankPng);
      expect(blankCheck.isBlank).toBe(true);
      expect(blankCheck.reason).toContain('vollständig leer');
      expect(blankCheck.reason).not.toContain('ß');

      const validPng = createTestPng({ width: 100, height: 100, blank: false });
      const validCheck = detectBlankOrEmptyImage(validPng);
      expect(validCheck.isBlank).toBe(false);
    });

    it('lehnt Dateien unter 30 Bytes oder mit 0 Bytes als unvollständig ab', async () => {
      const emptyRes = await validateDocument({ buffer: Buffer.alloc(0) });
      expect(emptyRes.valid).toBe(false);
      expect(emptyRes.status).toBe(400);
      expect(emptyRes.reason).toBe('EMPTY');
      expect(emptyRes.error).toContain('0 Bytes');

      const tinyValidHeader = Buffer.from('%PDF-1.4\n%%EOF');
      const tinyRes = await validateDocument({ buffer: tinyValidHeader });
      expect(tinyRes.valid).toBe(false);
      expect(tinyRes.status).toBe(400);
      expect(tinyRes.reason).toBe('TOO_SMALL');
      expect(tinyRes.error).toContain('zu klein');
    });

    it('lehnt beschädigte Dateien ohne gültigen Header ab', async () => {
      const corruptBuf = Buffer.from(
        'NOT_A_VALID_PDF_OR_IMAGE_CONTENT_HERE_AND_MORE_CHARS_TO_PASS_30_BYTES_MINIMUM_LENGTH_CHECK'
      );
      const corruptRes = await validateDocument({ buffer: corruptBuf });
      expect(corruptRes.valid).toBe(false);
      expect(corruptRes.status).toBe(400);
      expect(corruptRes.reason).toBe('INVALID_FORMAT');
      expect(corruptRes.error).toContain('Dateiformat');
    });
  });

  describe('2. POST /api/correct: Upload-Validierung vor Gemini-Aufruf', () => {
    it('lehnt hochgeladene Einverständniserklärung (PNG) mit HTTP 400 ab — OHNE LLM-Call', async () => {
      const consentPng = createTestPng({ width: 100, height: 100, blank: false });
      const consentFile = new File([new Uint8Array(consentPng)], 'Einverstaendnisformular.png', {
        type: 'image/png',
      });

      const formData = new FormData();
      formData.append('classId', 'class-1');
      formData.append('examId', 'exam-1');
      formData.append('studentExam', consentFile);

      const req = new Request('http://localhost/api/correct', {
        method: 'POST',
        body: formData,
      });

      const res = await correctPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Einverständniserklärung');
      expect(json.error).not.toContain('ß');

      // CRITICAL: Instrumentierter Nachweis, dass kein Modell-Call stattfand
      expect(mockGeminiGenerateContent).not.toHaveBeenCalled();
      expect(mockRunLiveGeminiCorrection).not.toHaveBeenCalled();
    });

    it('lehnt Declaration of Consent (PDF) mit HTTP 400 ab — OHNE LLM-Call', async () => {
      const consentPdf = createTestPdf(
        'Declaration of Consent. I hereby give my consent.',
        'Declaration of Consent'
      );
      const consentFile = new File([new Uint8Array(consentPdf)], 'Declaration_of_Consent.pdf', {
        type: 'application/pdf',
      });

      const formData = new FormData();
      formData.append('classId', 'class-1');
      formData.append('examId', 'exam-1');
      formData.append('studentExam', consentFile);

      const req = new Request('http://localhost/api/correct', {
        method: 'POST',
        body: formData,
      });

      const res = await correctPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Einverständniserklärung');

      expect(mockGeminiGenerateContent).not.toHaveBeenCalled();
      expect(mockRunLiveGeminiCorrection).not.toHaveBeenCalled();
    });

    it('lehnt leeren/weissen Scan mit HTTP 400 ab — OHNE LLM-Call', async () => {
      const blankPng = createTestPng({ width: 100, height: 100, blank: true });
      const blankFile = new File([new Uint8Array(blankPng)], 'scan.png', { type: 'image/png' });

      const formData = new FormData();
      formData.append('classId', 'class-1');
      formData.append('examId', 'exam-1');
      formData.append('studentExam', blankFile);

      const req = new Request('http://localhost/api/correct', {
        method: 'POST',
        body: formData,
      });

      const res = await correctPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('vollständig leer');

      expect(mockGeminiGenerateContent).not.toHaveBeenCalled();
      expect(mockRunLiveGeminiCorrection).not.toHaveBeenCalled();
    });

    it('QA-Ergänzung 01.11.2026: lehnt Einverständnisformular als Rubrik-Datei ab — OHNE LLM-Call', async () => {
      const validExamPng = createTestPng({ width: 100, height: 100, blank: false });
      const studentFile = new File([new Uint8Array(validExamPng)], 'schuelerarbeit.png', {
        type: 'image/png',
      });

      const consentRubricPng = createTestPng({ width: 100, height: 100, blank: false });
      const rubricFile = new File(
        [new Uint8Array(consentRubricPng)],
        'Einverstaendnisformular.png',
        {
          type: 'image/png',
        }
      );

      const formData = new FormData();
      formData.append('classId', 'class-1');
      formData.append('examTitle', 'Neue Matheprüfung');
      formData.append('examSubject', 'Mathematik');
      formData.append('studentExam', studentFile);
      formData.append('rubric', rubricFile);

      const req = new Request('http://localhost/api/correct', {
        method: 'POST',
        body: formData,
      });

      const res = await correctPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Einverständniserklärung');

      expect(mockGeminiGenerateContent).not.toHaveBeenCalled();
      expect(mockRunLiveGeminiCorrection).not.toHaveBeenCalled();
    });
  });

  describe('3. POST /api/exams/parse-rubric: Musterlösungs-Validierung vor Modell-Call', () => {
    it('lehnt Einverständniserklärung als Musterlösung ab — OHNE LLM-Call', async () => {
      const req = new Request('http://localhost/api/exams/parse-rubric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rubricText:
            'Einverständniserklärung zur Teilnahme am Schwimmunterricht. Unterschrift der Erziehungsberechtigten:',
        }),
      });

      const res = await parseRubricPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Einverständniserklärung');

      expect(mockGeminiGenerateContent).not.toHaveBeenCalled();
    });

    it('lehnt Einverständnisformular-PNG als Base64-Musterlösung ab — OHNE LLM-Call', async () => {
      const consentPng = createTestPng({
        width: 100,
        height: 100,
        blank: false,
        textMeta: { keyword: 'Title', text: 'Declaration of Consent' },
      });

      const req = new Request('http://localhost/api/exams/parse-rubric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rubricText: JSON.stringify({
            name: 'Einverstaendnisformular.png',
            mimeType: 'image/png',
            data: consentPng.toString('base64'),
          }),
        }),
      });

      const res = await parseRubricPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Einverständniserklärung');

      expect(mockGeminiGenerateContent).not.toHaveBeenCalled();
    });

    it('lehnt leere Musterlösung ab — OHNE LLM-Call', async () => {
      const req = new Request('http://localhost/api/exams/parse-rubric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rubricText: '    ',
        }),
      });

      const res = await parseRubricPost(req);
      expect(res.status).toBe(400);

      expect(mockGeminiGenerateContent).not.toHaveBeenCalled();
    });
  });

  describe('4. POST /api/exams/generate: Unterrichtsmaterial-Validierung vor Modell-Call', () => {
    it('lehnt Einverständniserklärung als Unterrichtsmaterial ab — OHNE LLM-Call', async () => {
      const req = new Request('http://localhost/api/exams/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId: 'class-1',
          material:
            'Einverständniserklärung der Eltern zur Nutzung digitaler Medien an der Schule.',
        }),
      });

      const res = await generatePost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Einverständniserklärung');

      expect(mockGenerateExamFromMaterial).not.toHaveBeenCalled();
      expect(mockGeminiGenerateContent).not.toHaveBeenCalled();
    });

    it('lehnt unleserliches/zu kurzes Unterrichtsmaterial ab — OHNE LLM-Call', async () => {
      const req = new Request('http://localhost/api/exams/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          classId: 'class-1',
          material: '???',
        }),
      });

      const res = await generatePost(req);
      expect(res.status).toBe(400);

      expect(mockGenerateExamFromMaterial).not.toHaveBeenCalled();
      expect(mockGeminiGenerateContent).not.toHaveBeenCalled();
    });
  });

  describe('5. POST /api/mobile-relay/upload: Smartphone-Scan-Validierung vor Modell-Call', () => {
    beforeEach(() => {
      vi.mocked(jwtModule.verifyMobileRelayToken).mockResolvedValue({
        purpose: 'mobile_relay',
        sessionId: 'sess-1',
        teacherId: 'teacher-1',
        targetMode: 'SUBMISSION',
      });
    });

    it('lehnt Einverständnis-Scan beim Smartphone-Upload ab — OHNE LLM-Call', async () => {
      const consentPng = createTestPng({ width: 100, height: 100, blank: false });
      const file = new File([new Uint8Array(consentPng)], 'Einverstaendniserklaerung.png', {
        type: 'image/png',
      });

      const formData = new FormData();
      formData.append('token', 'valid-token');
      formData.append('pages', file);

      const req = new Request('http://localhost/api/mobile-relay/upload', {
        method: 'POST',
        body: formData,
      });

      const res = await relayUploadPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Einverständniserklärung');

      expect(mockIdentifyExamAndStudentFromScan).not.toHaveBeenCalled();
      expect(mockRunLiveGeminiCorrection).not.toHaveBeenCalled();
    });

    it('lehnt Blank-Scan beim Smartphone-Upload ab — OHNE LLM-Call', async () => {
      const blankPng = createTestPng({ width: 100, height: 100, blank: true });
      const file = new File([new Uint8Array(blankPng)], 'scan_p1.png', { type: 'image/png' });

      const formData = new FormData();
      formData.append('token', 'valid-token');
      formData.append('pages', file);

      const req = new Request('http://localhost/api/mobile-relay/upload', {
        method: 'POST',
        body: formData,
      });

      const res = await relayUploadPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('vollständig leer');

      expect(mockIdentifyExamAndStudentFromScan).not.toHaveBeenCalled();
      expect(mockRunLiveGeminiCorrection).not.toHaveBeenCalled();
    });

    it('QA-Ergänzung: lehnt Einverständnisformular bei targetMode=RUBRIC ab', async () => {
      vi.mocked(jwtModule.verifyMobileRelayToken).mockResolvedValue({
        purpose: 'mobile_relay',
        sessionId: 'sess-1',
        teacherId: 'teacher-1',
        targetMode: 'RUBRIC',
      });

      const consentPng = createTestPng({ width: 100, height: 100, blank: false });
      const file = new File([new Uint8Array(consentPng)], 'consent_form.png', {
        type: 'image/png',
      });

      const formData = new FormData();
      formData.append('token', 'valid-token');
      formData.append('targetMode', 'RUBRIC');
      formData.append('pages', file);

      const req = new Request('http://localhost/api/mobile-relay/upload', {
        method: 'POST',
        body: formData,
      });

      const res = await relayUploadPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Einverständniserklärung');

      expect(mockRunLiveGeminiCorrection).not.toHaveBeenCalled();
    });
  });

  describe('6. POST /api/submissions/[id]/replace: Retry-Validierung vor Hintergrund-Call', () => {
    it('lehnt Neustart mit unleserlicher oder Einverständnis-Datei ab — OHNE LLM-Call', async () => {
      const consentPng = createTestPng({
        width: 100,
        height: 100,
        blank: false,
        textMeta: { keyword: 'Title', text: 'Declaration of Consent' },
      });
      mockStorageMap.set('stored-scan.pdf', {
        buffer: consentPng,
        contentType: 'image/png',
      });

      const req = new Request('http://localhost/api/submissions/sub-1/replace', {
        method: 'POST',
      });

      const res = await replacePost(req, { params: Promise.resolve({ id: 'sub-1' }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Einverständniserklärung');

      expect(mockRunLiveGeminiCorrection).not.toHaveBeenCalled();
    });

    it('lehnt Neustart mit leerem/weissem Scan ab — OHNE LLM-Call', async () => {
      const blankPng = createTestPng({ width: 100, height: 100, blank: true });
      mockStorageMap.set('stored-scan.pdf', {
        buffer: blankPng,
        contentType: 'image/png',
      });

      const req = new Request('http://localhost/api/submissions/sub-1/replace', {
        method: 'POST',
      });

      const res = await replacePost(req, { params: Promise.resolve({ id: 'sub-1' }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('vollständig leer');

      expect(mockRunLiveGeminiCorrection).not.toHaveBeenCalled();
    });
  });

  describe('7. POST /api/exams: Referenz-Dokument beim Prüfungs-Anlegen', () => {
    it('lehnt Prüfungserstellung ab, wenn Rubrik eine Einverständniserklärung ist', async () => {
      const req = new Request('http://localhost/api/exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Mathematik Test',
          subject: 'Mathematik',
          classId: 'class-1',
          maxPoints: 20,
          rubricText: 'Einverständniserklärung: Hiermit willige ich ein...',
        }),
      });

      const res = await examsPost(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Einverständniserklärung');
    });
  });

  describe('8. Schweizer Hochdeutsch (Kein "ß")', () => {
    it('stellt sicher, dass in lib/document-validation.ts kein "ß" vorkommt', () => {
      const filePath = path.join(process.cwd(), 'lib/document-validation.ts');
      const content = fs.readFileSync(filePath, 'utf-8');
      expect(content).not.toContain('ß');
    });
  });
});
