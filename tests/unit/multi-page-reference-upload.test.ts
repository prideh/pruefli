import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';
import {
  appendReferenceFiles,
  moveReferenceFile,
  removeReferenceFileAt,
  formatReferenceFilesSummary,
  serializeReferenceFiles,
  extractFormDataReferenceInput,
  resolveReferenceMimeType,
} from '@/lib/reference-upload';
import { parseSerializedDocumentPayload, isSerializedDocumentPayload } from '@/lib/grading';
import { parseSerializedReferenceMaterial, appendReferenceMaterialToContents } from '@/lib/gemini';
import { validateRubricOrTemplatePayload } from '@/lib/payload-limits';
import { validateReferenceUpload } from '@/lib/document-validation';
import { getRateLimitStore } from '@/lib/rate-limit';
import { clearLlmCache } from '@/lib/llm-cache';
import { markEmailVerified } from '@/lib/email-verification';

const {
  mockGetSession,
  mockRunLiveGeminiCorrection,
  mockGeminiGenerateContent,
  mockExamFindFirst,
  mockExamFindUnique,
  mockExamCreate,
  mockClassFindFirst,
  mockSubmissionCreate,
  mockSubmissionUpdate,
  mockCorrectionLogCreate,
  mockCorrectionLogUpdate,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockRunLiveGeminiCorrection: vi.fn(),
  mockGeminiGenerateContent: vi.fn(),
  mockExamFindFirst: vi.fn(),
  mockExamFindUnique: vi.fn(),
  mockExamCreate: vi.fn(),
  mockClassFindFirst: vi.fn(),
  mockSubmissionCreate: vi.fn(),
  mockSubmissionUpdate: vi.fn(),
  mockCorrectionLogCreate: vi.fn(),
  mockCorrectionLogUpdate: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent: (...args: unknown[]) => mockGeminiGenerateContent(...args),
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

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: (cb: () => unknown) => {
      void cb();
    },
  };
});

vi.mock('@/lib/session', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

vi.mock('@/lib/storage', () => ({
  getStorageAdapter: () => ({
    write: vi.fn().mockResolvedValue('/uploads/mock-scan.png'),
    read: vi.fn(),
    delete: vi.fn(),
  }),
}));

vi.mock('@/lib/gemini', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gemini')>();
  return {
    ...actual,
    runLiveGeminiCorrection: (...args: unknown[]) => mockRunLiveGeminiCorrection(...args),
  };
});

vi.mock('@/lib/db', () => {
  const dbMock = {
    class: {
      findFirst: (...args: unknown[]) => mockClassFindFirst(...args),
    },
    exam: {
      findFirst: (...args: unknown[]) => mockExamFindFirst(...args),
      findUnique: (...args: unknown[]) => mockExamFindUnique(...args),
      create: (...args: unknown[]) => mockExamCreate(...args),
      update: vi.fn().mockResolvedValue({}),
    },
    student: {
      findFirst: vi.fn().mockResolvedValue({ id: 'student-1', name: 'Anna Meier' }),
      findMany: vi.fn().mockResolvedValue([{ id: 'student-1', name: 'Anna Meier' }]),
    },
    submission: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: (...args: unknown[]) => mockSubmissionCreate(...args),
      update: (...args: unknown[]) => mockSubmissionUpdate(...args),
    },
    taskCorrection: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    stepCorrection: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    correctionLog: {
      create: (...args: unknown[]) => mockCorrectionLogCreate(...args),
      update: (...args: unknown[]) => mockCorrectionLogUpdate(...args),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(dbMock)),
  };
  return { db: dbMock };
});

import { POST as correctPost } from '@/app/api/correct/route';

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

function createTestPng(seedOffset = 0, blank = false): Buffer {
  const width = 64;
  const height = 64;
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
      if (blank) {
        rawScanlines[offset++] = 255;
      } else {
        const isStroke =
          (x + y + seedOffset) % 7 === 0 || (y % 11 === seedOffset % 5 && x > 6 && x < width - 6);
        rawScanlines[offset++] = isStroke ? 20 : 250;
      }
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

function createTestPdf(text = 'Aufgabe 1: 2x + 4 = 10 (4 Punkte)'): Buffer {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\nstream\n(${text}) Tj\nendstream\n%%EOF`,
    'utf-8'
  );
}

describe('Mehrseitiger Direkt-Upload fuer Musterloesung & Vorlagenpruefung (Issue #125)', () => {
  beforeEach(async () => {
    await clearLlmCache();
    await getRateLimitStore().reset();
    await markEmailVerified('teacher-125', 'teacher125@schule.ch');
    process.env.GEMINI_API_KEY = 'test-gemini-key-125';

    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue({
      userId: 'teacher-125',
      email: 'teacher125@schule.ch',
      name: 'Lehrperson 125',
    });

    mockGeminiGenerateContent.mockReset();
    mockGeminiGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        isExamRelated: true,
        documentType: 'RUBRIC_OR_SOLUTION',
        confidence: 'HIGH',
        detectedSummary: 'Musterlösung mit Aufgaben',
        canOverride: true,
      }),
    });

    mockRunLiveGeminiCorrection.mockReset();
    mockRunLiveGeminiCorrection.mockResolvedValue({
      schuelerName: 'Anna Meier',
      istNameUnsicher: false,
      gesamtErreichtePunkte: 18,
      gesamtmaximalPunkte: 20,
      gesamtbewertung: {
        staerken: ['Sauberer Lösungsweg'],
        schwaechen: [],
        hilfreicherTipp: 'Weiter so!',
        uebungsempfehlung: 'Keine',
      },
      aufgaben: [
        {
          aufgabeId: '1',
          titel: 'Aufgabe 1',
          schuelerAntwort: 'x = 3',
          erzieltePunkte: 18,
          maximalPunkte: 20,
          status: 'Korrekt',
          lehrerKommentar: 'Richtig gelöst.',
          schritte: [],
        },
      ],
    });

    mockClassFindFirst.mockReset();
    mockClassFindFirst.mockResolvedValue({
      id: 'class-125',
      name: '3a Gymnasium',
      teacherId: 'teacher-125',
    });

    mockExamFindFirst.mockReset();
    mockExamFindFirst.mockResolvedValue(null);

    mockExamCreate.mockReset();
    mockExamCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'exam-created-125',
      ...data,
    }));

    mockExamFindUnique.mockReset();
    mockExamFindUnique.mockResolvedValue({
      id: 'exam-created-125',
      title: 'Algebra Prüfung',
      subject: 'Mathematik',
      maxPoints: 20,
      tasks: [],
    });

    mockSubmissionCreate.mockReset();
    mockSubmissionCreate.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: data.id || 'sub-125',
        ...data,
      })
    );

    mockSubmissionUpdate.mockReset();
    mockSubmissionUpdate.mockResolvedValue({});

    mockCorrectionLogCreate.mockReset();
    mockCorrectionLogCreate.mockResolvedValue({ id: 'log-125' });

    mockCorrectionLogUpdate.mockReset();
    mockCorrectionLogUpdate.mockResolvedValue({});
  });

  describe('1. UI-Vertrag: multiple-Attribut und Seitenverwaltung im Wizard', () => {
    it('setzt multiple auf rubricFile und examTemplateFile im Dashboard-Wizard sowie in den Prüfungsdialogen', () => {
      const dashboardSource = fs.readFileSync(
        path.join(process.cwd(), 'app/dashboard/page.tsx'),
        'utf-8'
      );

      // Beide File-Inputs im Wizard müssen `multiple` besitzen
      expect(dashboardSource).toMatch(
        /<input[\s\S]*?type="file"[\s\S]*?multiple[\s\S]*?id="rubricFile"/
      );
      expect(dashboardSource).toMatch(
        /<input[\s\S]*?type="file"[\s\S]*?multiple[\s\S]*?id="examTemplateFile"/
      );

      // Seiten-Reihenfolge & "+ Seite"-Aktion müssen im Wizard vorhanden sein und auf 360px einzeilig bleiben
      expect(dashboardSource).toContain('data-testid="rubric-add-page-btn"');
      expect(dashboardSource).toMatch(
        /data-testid="rubric-add-page-btn"[\s\S]*?whiteSpace:\s*'nowrap'[\s\S]*?flexShrink:\s*0/
      );
      expect(dashboardSource).toContain('data-testid="rubric-pages-list"');
      expect(dashboardSource).toContain('data-testid="template-add-page-btn"');
      expect(dashboardSource).toMatch(
        /data-testid="template-add-page-btn"[\s\S]*?whiteSpace:\s*'nowrap'[\s\S]*?flexShrink:\s*0/
      );
      expect(dashboardSource).toContain('data-testid="template-pages-list"');

      // Auch in /exams und /exams/[id] ist multiple gesetzt
      const examsPageSource = fs.readFileSync(
        path.join(process.cwd(), 'app/exams/page.tsx'),
        'utf-8'
      );
      expect(examsPageSource).toMatch(
        /<input[\s\S]*?type="file"[\s\S]*?multiple[\s\S]*?id="dialogRubricFile"/
      );

      const examDetailSource = fs.readFileSync(
        path.join(process.cwd(), 'app/exams/[id]/page.tsx'),
        'utf-8'
      );
      expect(examDetailSource).toMatch(
        /<input[\s\S]*?type="file"[\s\S]*?multiple[\s\S]*?id="editRubricFile"/
      );

      // Schweizer Rechtschreibung (kein Eszett)
      const refUploadSource = fs.readFileSync(
        path.join(process.cwd(), 'lib/reference-upload.ts'),
        'utf-8'
      );
      expect(refUploadSource).not.toContain('\u00df');
      expect(dashboardSource).not.toContain('\u00df');
    });
  });

  describe('2. Seiten-Assemblierung, Sortierung und Serialisierung (lib/reference-upload.ts)', () => {
    it('sammelt mehrere fotografierte Seiten in exakter Reihenfolge (Einzelschritt + weiteres Hinzufügen) und dedupliziert Duplikate', () => {
      const p1 = new File([new Uint8Array(createTestPng(1))], 'seite-1.jpg', {
        type: 'image/jpeg',
        lastModified: 1000,
      });
      const p2 = new File([new Uint8Array(createTestPng(2))], 'seite-2.jpg', {
        type: 'image/jpeg',
        lastModified: 2000,
      });
      const p3 = new File([new Uint8Array(createTestPng(3))], 'seite-3.jpg', {
        type: 'image/jpeg',
        lastModified: 3000,
      });

      // Schritt 1: 2 Fotos auf einmal auswählen
      let pages = appendReferenceFiles([], [p1, p2]);
      expect(pages.map((f) => f.name)).toEqual(['seite-1.jpg', 'seite-2.jpg']);

      // Schritt 2: 3. Foto über "+ Seite" anhängen (inkl. versehentlichem Duplikat von p2)
      pages = appendReferenceFiles(pages, [p2, p3]);
      expect(pages.map((f) => f.name)).toEqual(['seite-1.jpg', 'seite-2.jpg', 'seite-3.jpg']);

      // Schritt 3: Reihenfolge ändern (Seite 3 nach oben auf Index 1 schieben)
      pages = moveReferenceFile(pages, 2, 1);
      expect(pages.map((f) => f.name)).toEqual(['seite-1.jpg', 'seite-3.jpg', 'seite-2.jpg']);

      // Schritt 4: Einzelne Seite entfernen
      pages = removeReferenceFileAt(pages, 1);
      expect(pages.map((f) => f.name)).toEqual(['seite-1.jpg', 'seite-2.jpg']);

      expect(formatReferenceFilesSummary([p1], 'rubric')).toBe('Musterlösung: seite-1.jpg');
      expect(formatReferenceFilesSummary(pages, 'rubric')).toBe('Musterlösung (2 Seiten)');
      expect(formatReferenceFilesSummary([p1], 'template')).toBe('seite-1.jpg');
      expect(formatReferenceFilesSummary(pages, 'template')).toBe('Vorlage (2 Seiten)');
    });

    it('serialisiert mehrere Bildseiten als geordnetes mehrseitiges Referenzdokument fuer Gemini und Preview', async () => {
      const png1 = createTestPng(10);
      const png2 = createTestPng(20);
      const png3 = createTestPng(30);

      const f1 = new File([new Uint8Array(png1)], 'loesung-s1.png', { type: 'image/png' });
      const f2 = new File([new Uint8Array(png2)], 'loesung-s2.png', { type: 'image/png' });
      const f3 = new File([new Uint8Array(png3)], 'loesung-s3.png', { type: 'image/png' });

      const result = await serializeReferenceFiles([f1, f2, f3]);
      expect(result.pageCount).toBe(3);
      expect(result.fileNameSummary).toBe(
        '3 Seiten (loesung-s1.png, loesung-s2.png, loesung-s3.png)'
      );
      expect(isSerializedDocumentPayload(result.storedText)).toBe(true);

      const parsedDoc = parseSerializedDocumentPayload(result.storedText);
      expect(parsedDoc?.kind).toBe('multi');
      if (parsedDoc?.kind === 'multi') {
        expect(parsedDoc.pages.map((p) => p.name)).toEqual([
          'loesung-s1.png',
          'loesung-s2.png',
          'loesung-s3.png',
        ]);
        expect(parsedDoc.pages.map((p) => p.data)).toEqual([
          png1.toString('base64'),
          png2.toString('base64'),
          png3.toString('base64'),
        ]);
      }

      const geminiParsed = parseSerializedReferenceMaterial(result.storedText);
      expect(Array.isArray(geminiParsed)).toBe(true);

      const contents: (string | { inlineData: { mimeType: string; data: string } })[] = [];
      appendReferenceMaterialToContents(contents, result.storedText);
      expect(contents).toEqual([
        '--- Referenzdokument Seite 1 ---',
        { inlineData: { mimeType: 'image/png', data: png1.toString('base64') } },
        '--- Referenzdokument Seite 2 ---',
        { inlineData: { mimeType: 'image/png', data: png2.toString('base64') } },
        '--- Referenzdokument Seite 3 ---',
        { inlineData: { mimeType: 'image/png', data: png3.toString('base64') } },
      ]);
    });

    it('bewahrt bestehende Einzel-PDF- und Text-Flows unverändert', async () => {
      const pdfBuf = createTestPdf();
      const pdfFile = new File([new Uint8Array(pdfBuf)], 'musterloesung.pdf', {
        type: 'application/pdf',
      });

      const pdfSerialized = await serializeReferenceFiles([pdfFile]);
      expect(pdfSerialized.pageCount).toBe(1);
      expect(parseSerializedDocumentPayload(pdfSerialized.storedText)).toEqual({
        kind: 'single',
        page: {
          name: 'musterloesung.pdf',
          mimeType: 'application/pdf',
          data: pdfBuf.toString('base64'),
        },
      });

      const txtContent =
        'Aufgabe 1: 4x - 12 = 8 => x = 5 (3 Punkte)\nAufgabe 2: y = 2x + 1 (4 Punkte)';
      const txtFile = new File([txtContent], 'erwartungshorizont.txt', {
        type: 'text/plain',
      });

      const txtSerialized = await serializeReferenceFiles([txtFile]);
      expect(txtSerialized.pageCount).toBe(1);
      expect(txtSerialized.param).toBe(txtContent);
      expect(txtSerialized.storedText).toBe(txtContent);
      expect(isSerializedDocumentPayload(txtSerialized.storedText)).toBe(false);

      // Auch falls der mobile Browser keinen MIME-Type setzt, erkennt resolveReferenceMimeType die Dateiendung
      expect(resolveReferenceMimeType({ name: 'scan.JPG', type: '' })).toBe('image/jpeg');
      expect(resolveReferenceMimeType({ name: 'vorlage.PDF', type: '' })).toBe('application/pdf');
      expect(resolveReferenceMimeType({ name: 'notizen.txt', type: '' })).toBe('text/plain');
    });
  });

  describe('3. POST /api/correct End-to-End mit mehrseitiger Musterloesung & Vorlagenpruefung', () => {
    it('verarbeitet mehrere fotografierte Seiten fuer Musterloesung UND Vorlagenpruefung als je ein geordnetes Dokument', async () => {
      const studentPng = createTestPng(1);
      const rubricPage1 = createTestPng(11);
      const rubricPage2 = createTestPng(12);
      const rubricPage3 = createTestPng(13);
      const templatePage1 = createTestPng(21);
      const templatePage2 = createTestPng(22);

      const formData = new FormData();
      formData.append('classId', 'class-125');
      formData.append('studentId', 'student-1');
      formData.append('examTitle', 'Mehrseitige Geometrie-Prüfung');
      formData.append('examSubject', 'Mathematik');
      formData.append('maxPoints', '20');
      formData.append(
        'studentExam',
        new File([new Uint8Array(studentPng)], 'schueler.png', { type: 'image/png' })
      );

      // 3 geordnete Seiten für Musterlösung
      formData.append(
        'rubric',
        new File([new Uint8Array(rubricPage1)], 'ml-seite-1.png', { type: 'image/png' })
      );
      formData.append(
        'rubric',
        new File([new Uint8Array(rubricPage2)], 'ml-seite-2.png', { type: 'image/png' })
      );
      formData.append(
        'rubric',
        new File([new Uint8Array(rubricPage3)], 'ml-seite-3.png', { type: 'image/png' })
      );

      // 2 geordnete Seiten für Vorlagenprüfung
      formData.append(
        'examTemplate',
        new File([new Uint8Array(templatePage1)], 'vorlage-s1.png', { type: 'image/png' })
      );
      formData.append(
        'examTemplate',
        new File([new Uint8Array(templatePage2)], 'vorlage-s2.png', { type: 'image/png' })
      );

      const extractedRubric = extractFormDataReferenceInput(formData, 'rubric');
      expect(Array.isArray(extractedRubric)).toBe(true);
      expect((extractedRubric as File[]).map((f) => f.name)).toEqual([
        'ml-seite-1.png',
        'ml-seite-2.png',
        'ml-seite-3.png',
      ]);

      const req = new Request('http://localhost/api/correct', {
        method: 'POST',
        body: formData,
      });

      const res = await correctPost(req);
      expect(res.status).toBe(200);

      // Warte kurz auf den asynchronen after()-Korrekturpfad
      await new Promise((r) => setTimeout(r, 30));

      expect(mockExamCreate).toHaveBeenCalledTimes(1);
      const createdExamData = mockExamCreate.mock.calls[0][0].data;

      // Musterlösung in DB als 3-seitiges geordnetes Dokument gespeichert
      const savedRubricPages = JSON.parse(createdExamData.rubricText);
      expect(savedRubricPages).toHaveLength(3);
      expect(savedRubricPages.map((p: { name: string }) => p.name)).toEqual([
        'ml-seite-1.png',
        'ml-seite-2.png',
        'ml-seite-3.png',
      ]);
      expect(savedRubricPages.map((p: { data: string }) => p.data)).toEqual([
        rubricPage1.toString('base64'),
        rubricPage2.toString('base64'),
        rubricPage3.toString('base64'),
      ]);

      // Vorlagenprüfung in DB als 2-seitiges geordnetes Dokument gespeichert
      const savedTemplatePages = JSON.parse(createdExamData.examTemplateText);
      expect(savedTemplatePages).toHaveLength(2);
      expect(savedTemplatePages.map((p: { name: string }) => p.name)).toEqual([
        'vorlage-s1.png',
        'vorlage-s2.png',
      ]);
      expect(savedTemplatePages.map((p: { data: string }) => p.data)).toEqual([
        templatePage1.toString('base64'),
        templatePage2.toString('base64'),
      ]);

      // Gemini erhält sowohl die 3-seitige Musterlösung als auch die 2-seitige Vorlage in exakter Reihenfolge
      expect(mockRunLiveGeminiCorrection).toHaveBeenCalledTimes(1);
      const [, passedRubric, , , , , , passedMaterialOptions] =
        mockRunLiveGeminiCorrection.mock.calls[0];

      expect(Array.isArray(passedRubric)).toBe(true);
      expect(passedRubric.map((p: { name: string }) => p.name)).toEqual([
        'ml-seite-1.png',
        'ml-seite-2.png',
        'ml-seite-3.png',
      ]);

      expect(Array.isArray(passedMaterialOptions?.examTemplate)).toBe(true);
      expect(passedMaterialOptions.examTemplate.map((p: { name: string }) => p.name)).toEqual([
        'vorlage-s1.png',
        'vorlage-s2.png',
      ]);
    });

    it('akzeptiert weiterhin Einzel-PDF und Textdatei (.txt) fuer Musterloesung und Vorlage in POST /api/correct', async () => {
      const studentPng = createTestPng(2);
      const txtRubric = new File(
        ['Aufgabe 1: 2x = 10 => x = 5 (5 Punkte)\nAufgabe 2: 3y = 9 => y = 3 (5 Punkte)'],
        'musterloesung.txt',
        { type: 'text/plain' }
      );
      const pdfTemplate = new File(
        [new Uint8Array(createTestPdf('Aufgabenblatt Mathematik'))],
        'aufgabenblatt.pdf',
        { type: 'application/pdf' }
      );

      const formData = new FormData();
      formData.append('classId', 'class-125');
      formData.append('studentId', 'student-1');
      formData.append('examTitle', 'Text-und-PDF-Prüfung');
      formData.append('examSubject', 'Mathematik');
      formData.append('maxPoints', '10');
      formData.append(
        'studentExam',
        new File([new Uint8Array(studentPng)], 'schueler.png', { type: 'image/png' })
      );
      formData.append('rubric', txtRubric);
      formData.append('examTemplate', pdfTemplate);

      const req = new Request('http://localhost/api/correct', {
        method: 'POST',
        body: formData,
      });

      const res = await correctPost(req);
      expect(res.status).toBe(200);

      await new Promise((r) => setTimeout(r, 30));

      expect(mockExamCreate).toHaveBeenCalledTimes(1);
      const createdExamData = mockExamCreate.mock.calls[0][0].data;
      expect(createdExamData.rubricText).toContain('Aufgabe 1: 2x = 10');
      expect(JSON.parse(createdExamData.examTemplateText)).toMatchObject({
        name: 'aufgabenblatt.pdf',
        mimeType: 'application/pdf',
      });
    });

    it('lehnt mehrseitige Musterloesung ab, wenn eine Folgeseite leer oder ein Nicht-Pruefungsdokument ist', async () => {
      const validPage1 = new File([new Uint8Array(createTestPng(1))], 'seite-1.png', {
        type: 'image/png',
      });
      const blankPage2 = new File([new Uint8Array(createTestPng(2, true))], 'seite-2-leer.png', {
        type: 'image/png',
      });

      const validation = await validateReferenceUpload(
        [validPage1, blankPage2],
        'Die Musterlösung',
        { skipAiClassification: true }
      );
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('BLANK_SCAN');

      // Grössenlimit-Prüfung für Datei-Arrays
      const oversizedPages = Array.from({ length: 16 }, (_, i) => ({
        name: `s${i + 1}.jpg`,
        size: 1024,
      }));
      const limitCheck = validateRubricOrTemplatePayload(oversizedPages, 'Die Musterlösung');
      expect(limitCheck.valid).toBe(false);
      expect(limitCheck.status).toBe(413);
    });
  });
});
