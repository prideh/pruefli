import { describe, it, expect, vi, beforeEach } from 'vitest';
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';
import {
  appendReferenceMaterialToContents,
  parseSerializedReferenceMaterial,
  DEFAULT_GEMINI_MODEL,
} from '@/lib/gemini';
import { parseSerializedDocumentPayload, isSerializedDocumentPayload } from '@/lib/grading';
import { computeRubricParseHash, clearLlmCache, LLM_PROMPT_VERSIONS } from '@/lib/llm-cache';
import { getRateLimitStore } from '@/lib/rate-limit';
import { markEmailVerified } from '@/lib/email-verification';

const mockGetSession = vi.fn();
vi.mock('@/lib/session', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

const mockGenerateContent = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent: (...args: unknown[]) => mockGenerateContent(...args),
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

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createContentPng(width = 64, height = 64, seedOffset = 0): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 0;

  const ihdrType = Buffer.from('IHDR');
  const ihdrCrc = Buffer.alloc(4);
  ihdrCrc.writeUInt32BE(crc32(Buffer.concat([ihdrType, ihdrData])));
  const ihdrLen = Buffer.alloc(4);
  ihdrLen.writeUInt32BE(13);
  const ihdrChunk = Buffer.concat([ihdrLen, ihdrType, ihdrData, ihdrCrc]);

  const rawScanlines = Buffer.alloc(height * (1 + width));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawScanlines[offset++] = 0;
    for (let x = 0; x < width; x++) {
      // Simulate dark ink strokes on white background so image is non-blank
      const isStroke = (x + y + seedOffset) % 7 === 0 || (y % 12 === 3 && x > 8 && x < width - 8);
      rawScanlines[offset++] = isStroke ? 20 : 250;
    }
  }

  const compressed = zlib.deflateSync(rawScanlines);
  const idatLen = Buffer.alloc(4);
  idatLen.writeUInt32BE(compressed.length);
  const idatType = Buffer.from('IDAT');
  const idatCrc = Buffer.alloc(4);
  idatCrc.writeUInt32BE(crc32(Buffer.concat([idatType, compressed])));
  const idatChunk = Buffer.concat([idatLen, idatType, compressed, idatCrc]);

  const iendLen = Buffer.alloc(4);
  iendLen.writeUInt32BE(0);
  const iendType = Buffer.from('IEND');
  const iendCrc = Buffer.alloc(4);
  iendCrc.writeUInt32BE(crc32(iendType));
  const iendChunk = Buffer.concat([iendLen, iendType, iendCrc]);

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

describe('Aufgabenstruktur-Extraktion aus Bild-Musterloesung (#68)', () => {
  beforeEach(async () => {
    await clearLlmCache();
    await getRateLimitStore().reset();
    await markEmailVerified('teacher-1', 'teacher1@schule.ch');
    await markEmailVerified('teacher-e2e-68', 'qa@pruefli.ch');
    mockGenerateContent.mockReset();
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue({
      userId: 'teacher-e2e-68',
      email: 'qa@pruefli.ch',
      name: 'QA Lehrperson',
    });
    process.env.GEMINI_API_KEY = 'test-gemini-key-68';
  });

  describe('1. Serialisierte Referenzdokumente (unabhaengig von JSON-Key-Reihenfolge)', () => {
    it('parst {"name":"...","mimeType":"...","data":"..."} als inlineData statt als rohen Base64-Text', () => {
      const pngBase64 = createContentPng().toString('base64');
      // Exakt das Format, das FileReader in app/exams/page.tsx mit vorangestelltem "name" erzeugt hat
      const serializedNameFirst = JSON.stringify({
        name: 'musterloesung-e2e.png',
        mimeType: 'image/png',
        data: pngBase64,
      });

      const parsed = parseSerializedReferenceMaterial(serializedNameFirst);
      expect(parsed).not.toBeNull();
      expect(Array.isArray(parsed)).toBe(false);
      expect(parsed).toMatchObject({
        name: 'musterloesung-e2e.png',
        mimeType: 'image/png',
        data: pngBase64,
      });

      const contents: (string | { inlineData: { mimeType: string; data: string } })[] = [];
      appendReferenceMaterialToContents(contents, serializedNameFirst);

      expect(contents).toHaveLength(1);
      expect(contents[0]).toEqual({
        inlineData: {
          mimeType: 'image/png',
          data: pngBase64,
        },
      });
    });

    it('parst mehrseitige Bild-Musterloesungen mit beliebiger Key-Reihenfolge vollstaendig als inlineData-Seiten', () => {
      const page1Base64 = createContentPng(64, 64, 1).toString('base64');
      const page2Base64 = createContentPng(64, 64, 2).toString('base64');
      const multiPagePayload = JSON.stringify([
        { name: 'musterloesung-s1.png', mimeType: 'image/png', data: page1Base64 },
        { name: 'musterloesung-s2.png', mimeType: 'image/png', data: page2Base64 },
      ]);

      const contents: (string | { inlineData: { mimeType: string; data: string } })[] = [];
      appendReferenceMaterialToContents(contents, multiPagePayload);

      expect(contents).toEqual([
        '--- Referenzdokument Seite 1 ---',
        { inlineData: { mimeType: 'image/png', data: page1Base64 } },
        '--- Referenzdokument Seite 2 ---',
        { inlineData: { mimeType: 'image/png', data: page2Base64 } },
      ]);
    });

    it('erkennt serialisierte Dokumente im Client-Helper isSerializedDocumentPayload / parseSerializedDocumentPayload', () => {
      const nameFirst = JSON.stringify({
        name: 'musterloesung-e2e.png',
        mimeType: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUg==',
      });
      const mimeFirst = JSON.stringify({
        mimeType: 'application/pdf',
        data: 'JVBERi0xLjQK',
        name: 'loesung.pdf',
      });
      const multi = JSON.stringify([
        { name: 's1.jpg', mimeType: 'image/jpeg', data: '/9j/4AAQ' },
        { name: 's2.jpg', mimeType: 'image/jpeg', data: '/9j/4BBB' },
      ]);

      expect(isSerializedDocumentPayload(nameFirst)).toBe(true);
      expect(isSerializedDocumentPayload(mimeFirst)).toBe(true);
      expect(isSerializedDocumentPayload(multi)).toBe(true);
      expect(isSerializedDocumentPayload('Aufgabe 1: 2x = 8 (4 Punkte)')).toBe(false);

      expect(parseSerializedDocumentPayload(nameFirst)).toEqual({
        kind: 'single',
        page: {
          name: 'musterloesung-e2e.png',
          mimeType: 'image/png',
          data: 'iVBORw0KGgoAAAANSUhEUg==',
        },
      });
      expect(parseSerializedDocumentPayload(multi)?.kind).toBe('multi');
    });

    it('erzeugt identische Content-Hashes fuer dieselben Bilddaten unabhaengig von Dateiname oder Key-Reihenfolge', () => {
      const pngBase64 = createContentPng().toString('base64');
      const payloadA = JSON.stringify({
        name: 'musterloesung-e2e.png',
        mimeType: 'image/png',
        data: pngBase64,
      });
      const payloadB = JSON.stringify({
        mimeType: 'image/png',
        data: pngBase64,
        name: 'andere-datei.png',
      });
      const payloadC = {
        mimeType: 'image/png',
        data: pngBase64,
      };

      const hashA = computeRubricParseHash({
        teacherId: 'teacher-1',
        modelName: DEFAULT_GEMINI_MODEL,
        promptVersion: LLM_PROMPT_VERSIONS.rubricParse,
        rubricText: payloadA,
      });
      const hashB = computeRubricParseHash({
        teacherId: 'teacher-1',
        modelName: DEFAULT_GEMINI_MODEL,
        promptVersion: LLM_PROMPT_VERSIONS.rubricParse,
        rubricText: payloadB,
      });
      const hashC = computeRubricParseHash({
        teacherId: 'teacher-1',
        modelName: DEFAULT_GEMINI_MODEL,
        promptVersion: LLM_PROMPT_VERSIONS.rubricParse,
        rubricText: payloadC,
      });

      expect(hashA).toBe(hashB);
      expect(hashB).toBe(hashC);
    });
  });

  describe('2. /api/exams/parse-rubric End-to-End mit mehraufgabigen und mehrseitigen Bild-Musterloesungen', () => {
    it('extrahiert aus einer Bild-Musterloesung (musterloesung-e2e.png) alle 3 Aufgaben (4/3/3 = 10 P.) nach erfolgreicher Klassifizierung', async () => {
      const pngBase64 = createContentPng(80, 80, 3).toString('base64');
      const rubricPayload = JSON.stringify({
        name: 'musterloesung-e2e.png',
        mimeType: 'image/png',
        data: pngBase64,
      });

      // 1. Aufruf: Dokument-Klassifizierung (validateReferenceUpload -> classifyDocumentWithGemini)
      // 2. Aufruf: Aufgabenstruktur-Extraktion (/api/exams/parse-rubric)
      mockGenerateContent
        .mockResolvedValueOnce({
          text: JSON.stringify({
            isExamRelated: true,
            documentType: 'RUBRIC_OR_SOLUTION',
            confidence: 'HIGH',
            detectedSummary: 'Musterloesung Mathematik mit 3 Aufgaben (10 Punkte)',
            rejectionReason: '',
          }),
        })
        .mockResolvedValueOnce({
          text: JSON.stringify([
            { taskId: '1', title: 'Aufgabe 1: Lineare Gleichungen', maxPoints: 4 },
            { taskId: '2', title: 'Aufgabe 2: Quadratische Funktion', maxPoints: 3 },
            { taskId: '3', title: 'Aufgabe 3: Textaufgabe Geometrie', maxPoints: 3 },
          ]),
        });

      const { POST } = await import('@/app/api/exams/parse-rubric/route');
      const req = new Request('http://localhost/api/exams/parse-rubric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rubricText: rubricPayload }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.tasks).toHaveLength(3);
      expect(data.tasks).toEqual([
        { taskId: '1', title: 'Aufgabe 1: Lineare Gleichungen', maxPoints: 4 },
        { taskId: '2', title: 'Aufgabe 2: Quadratische Funktion', maxPoints: 3 },
        { taskId: '3', title: 'Aufgabe 3: Textaufgabe Geometrie', maxPoints: 3 },
      ]);

      const totalPoints = data.tasks.reduce(
        (sum: number, t: { maxPoints: number }) => sum + t.maxPoints,
        0
      );
      expect(totalPoints).toBe(10);

      // Verifiziere, dass der 2. Gemini-Call (Extraktion) das Bild wirklich als inlineData erhalten hat
      // und NICHT als rohen JSON-String!
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
      const extractionCallArgs = mockGenerateContent.mock.calls[1][0];
      const extractionContents = extractionCallArgs.contents as unknown[];
      expect(extractionContents[0]).toEqual({
        inlineData: {
          mimeType: 'image/png',
          data: pngBase64,
        },
      });
      // Kein Element in contents darf der rohe Base64-JSON-String sein
      for (const item of extractionContents) {
        if (typeof item === 'string') {
          expect(item).not.toContain('"mimeType"');
          expect(item).not.toContain(pngBase64);
        }
      }
    });

    it('extrahiert aus einer mehrseitigen Bild-Musterloesung (2 Seiten, 3 Aufgaben 4/3/3 = 10 P.) alle Seiten und Aufgaben', async () => {
      const page1Base64 = createContentPng(80, 80, 10).toString('base64');
      const page2Base64 = createContentPng(80, 80, 20).toString('base64');
      const multiPageRubric = JSON.stringify([
        { name: 'musterloesung-seite1.png', mimeType: 'image/png', data: page1Base64 },
        { name: 'musterloesung-seite2.png', mimeType: 'image/png', data: page2Base64 },
      ]);

      // Klassifizierung fuer Seite 1 + Seite 2, danach Extraktion ueber beide Seiten
      mockGenerateContent
        .mockResolvedValueOnce({
          text: JSON.stringify({
            isExamRelated: true,
            documentType: 'RUBRIC_OR_SOLUTION',
            confidence: 'HIGH',
            detectedSummary: 'Musterloesung Seite 1 (Aufgaben 1 und 2)',
            rejectionReason: '',
          }),
        })
        .mockResolvedValueOnce({
          text: JSON.stringify({
            isExamRelated: true,
            documentType: 'RUBRIC_OR_SOLUTION',
            confidence: 'HIGH',
            detectedSummary: 'Musterloesung Seite 2 (Aufgabe 3 mit Stoertext am Ende)',
            rejectionReason: '',
          }),
        })
        .mockResolvedValueOnce({
          text: JSON.stringify([
            { taskId: '1', title: 'Aufgabe 1', maxPoints: 4 },
            { taskId: '2', title: 'Aufgabe 2', maxPoints: 3 },
            { taskId: '3', title: 'Aufgabe 3', maxPoints: 3 },
          ]),
        });

      const { POST } = await import('@/app/api/exams/parse-rubric/route');
      const req = new Request('http://localhost/api/exams/parse-rubric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rubricText: multiPageRubric }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.success).toBe(true);
      expect(data.tasks).toHaveLength(3);
      const totalPoints = data.tasks.reduce(
        (sum: number, t: { maxPoints: number }) => sum + t.maxPoints,
        0
      );
      expect(totalPoints).toBe(10);

      // Verifiziere, dass beide Seiten als inlineData an den Extraktions-Aufruf uebergeben wurden
      expect(mockGenerateContent).toHaveBeenCalledTimes(3);
      const extractionCallArgs = mockGenerateContent.mock.calls[2][0];
      const extractionContents = extractionCallArgs.contents as unknown[];
      expect(extractionContents[0]).toBe('--- Referenzdokument Seite 1 ---');
      expect(extractionContents[1]).toEqual({
        inlineData: { mimeType: 'image/png', data: page1Base64 },
      });
      expect(extractionContents[2]).toBe('--- Referenzdokument Seite 2 ---');
      expect(extractionContents[3]).toEqual({
        inlineData: { mimeType: 'image/png', data: page2Base64 },
      });
    });

    it('lehnt eine Einverstaendniserklaerung als Bild weiterhin zuverlaessig vor der Extraktion ab', async () => {
      const pngBase64 = createContentPng(80, 80, 5).toString('base64');
      const consentPayload = JSON.stringify({
        name: 'scan-dokument.png',
        mimeType: 'image/png',
        data: pngBase64,
      });

      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          isExamRelated: false,
          documentType: 'CONSENT_FORM',
          confidence: 'HIGH',
          detectedSummary: 'Einverstaendniserklaerung fuer Schulausflug',
          rejectionReason:
            'Das hochgeladene Dokument ist eine Einverstaendniserklaerung und keine Musterloesung.',
        }),
      });

      const { POST } = await import('@/app/api/exams/parse-rubric/route');
      const req = new Request('http://localhost/api/exams/parse-rubric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rubricText: consentPayload }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.reason).toBe('NON_EXAM_DOCUMENT');
      expect(data.canOverride).toBe(true);
      // Extraktions-Aufruf darf nicht stattfinden
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });
  });
});
