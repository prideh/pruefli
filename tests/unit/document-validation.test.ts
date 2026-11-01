import { describe, it, expect, vi, beforeEach } from 'vitest';
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';
import {
  detectBlankOrEmptyImage,
  isNonExamDocument,
  validateDocument,
  validateStudentExamUpload,
  validateReferenceUpload,
  validateExamMaterialInput,
} from '@/lib/document-validation';
import * as geminiModule from '@/lib/gemini';
import { clearLlmCache } from '@/lib/llm-cache';

/**
 * CRC32 computation for PNG chunks
 */
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

/**
 * Creates a valid, well-formed grayscale PNG buffer for testing image pixel analysis.
 */
function createTestPng(
  width: number,
  height: number,
  pixelFn: (x: number, y: number) => number
): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk: width (4), height (4), depth=8 (1), color=0 grayscale (1), comp=0, filter=0, interlace=0
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bits per pixel
  ihdrData[9] = 0; // Grayscale
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const ihdrType = Buffer.from('IHDR');
  const ihdrCrc = Buffer.alloc(4);
  ihdrCrc.writeUInt32BE(crc32(Buffer.concat([ihdrType, ihdrData])));

  const ihdrLen = Buffer.alloc(4);
  ihdrLen.writeUInt32BE(13);
  const ihdrChunk = Buffer.concat([ihdrLen, ihdrType, ihdrData, ihdrCrc]);

  // Scanlines: each line starts with filter byte 0 followed by width pixel bytes
  const rawScanlines = Buffer.alloc(height * (1 + width));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawScanlines[offset++] = 0; // Filter None
    for (let x = 0; x < width; x++) {
      rawScanlines[offset++] = pixelFn(x, y);
    }
  }

  const compressed = zlib.deflateSync(rawScanlines);
  const idatLen = Buffer.alloc(4);
  idatLen.writeUInt32BE(compressed.length);
  const idatType = Buffer.from('IDAT');
  const idatCrc = Buffer.alloc(4);
  idatCrc.writeUInt32BE(crc32(Buffer.concat([idatType, compressed])));
  const idatChunk = Buffer.concat([idatLen, idatType, compressed, idatCrc]);

  // IEND chunk
  const iendLen = Buffer.alloc(4);
  iendLen.writeUInt32BE(0);
  const iendType = Buffer.from('IEND');
  const iendCrc = Buffer.alloc(4);
  iendCrc.writeUInt32BE(crc32(iendType));
  const iendChunk = Buffer.concat([iendLen, iendType, iendCrc]);

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

describe('Dokumenttyp-Erkennung & Validierungs-Gate (lib/document-validation.ts)', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEY;
    await clearLlmCache();
    vi.restoreAllMocks();
  });

  describe('Kontrollmatrix: Bildanalyse leer vs. beschrieben (detectBlankOrEmptyImage)', () => {
    it('erkennt echtes leeres weisses Blatt als leer (Grund: BLANK_SCAN)', () => {
      // 100x100 rein weisses Blatt (255) ohne Tinte
      const blankWhitePng = createTestPng(100, 100, () => 255);
      const res = detectBlankOrEmptyImage(blankWhitePng);
      expect(res.isBlank).toBe(true);
      expect(res.reason).toContain('vollständig leer oder unbeschrieben');
      expect(res.reason).not.toMatch(/\u00df/);
    });

    it('erkennt echtes leeres schwarzes Blatt (z. B. abgedeckte Kamera) als leer', () => {
      // 100x100 rein schwarzes Bild (0)
      const blankBlackPng = createTestPng(100, 100, () => 0);
      const res = detectBlankOrEmptyImage(blankBlackPng);
      expect(res.isBlank).toBe(true);
      expect(res.reason).toContain('vollständig leer oder unbeschrieben');
      expect(res.reason).not.toMatch(/\u00df/);
    });

    it('erkennt einfarbig graues Bild (Standardabweichung ~ 0) als leer', () => {
      // 100x100 komplett einfarbig grau (128)
      const uniformGrayPng = createTestPng(100, 100, () => 128);
      const res = detectBlankOrEmptyImage(uniformGrayPng);
      expect(res.isBlank).toBe(true);
      expect(res.reason).toContain('vollständig leer oder unbeschrieben');
    });

    it('lehnt ein Dokument mit gedrucktem Text (z. B. Einverständniserklärung) NICHT fälschlich als leer ab', () => {
      // Ein Dokument mit weissem Hintergrund (255) und schwarzem Text (0):
      // QA-Befund vom 01.11.2026: Einverständnisformular wurde irreführend als "leer" abgewiesen.
      // Mit der Korrektur muss isBlank = false sein!
      const documentWithTextPng = createTestPng(100, 100, (x, y) => {
        // Schwarzer Text auf 4 Zeilen
        if ((y === 20 || y === 40 || y === 60 || y === 80) && x > 10 && x < 90) {
          return 0; // Schwarze Schrift
        }
        return 255; // Weisser Hintergrund
      });

      const res = detectBlankOrEmptyImage(documentWithTextPng);
      expect(res.isBlank).toBe(false);
    });

    it('akzeptiert eine spärlich beschriebene aber gültige Antwortseite (z. B. ein handschriftliches x = 4)', () => {
      // Eine Seite, auf der nur wenige Zeichen stehen (z. B. 0.3% schwarze Pixel)
      const sparseWritingPng = createTestPng(100, 100, (x, y) => {
        if (x >= 45 && x <= 55 && y >= 45 && y <= 55 && (x === 50 || y === 50)) {
          return 0; // Kurze handschriftliche Rechnung
        }
        return 255;
      });

      const res = detectBlankOrEmptyImage(sparseWritingPng);
      expect(res.isBlank).toBe(false);
    });
  });

  describe('Kontrollmatrix: Heuristische Erkennung von Nicht-Prüfungsdokumenten (isNonExamDocument)', () => {
    it('erkennt Einverständniserklärung anhand des Dateinamens mit Grund Dokumenttyp', () => {
      const res = isNonExamDocument({ name: 'einverstaendniserklaerung_fotos.pdf' });
      expect(res.isNonExam).toBe(true);
      expect(res.detectedCategory).toBe('Einverständniserklärung');
      expect(res.reason).toContain('Einverständniserklärung');
      expect(res.reason).toContain('nicht als Prüfung');
      expect(res.reason).not.toMatch(/\u00df/);
    });

    it('erkennt englische Einverständniserklärung (Declaration of Consent) anhand des Dateinamens', () => {
      const res = isNonExamDocument({ name: 'parental-consent-form.png' });
      expect(res.isNonExam).toBe(true);
      expect(res.detectedCategory).toBe('Einverständniserklärung');
    });

    it('erkennt Datenschutzerklärung / Privacy Policy anhand des Dateinamens', () => {
      const res = isNonExamDocument({ name: 'datenschutzerklaerung_schule.pdf' });
      expect(res.isNonExam).toBe(true);
      expect(res.detectedCategory).toBe('Datenschutzerklärung');
    });

    it('erkennt Rechnung / Quittung anhand des Dateinamens', () => {
      const res = isNonExamDocument({ name: 'rechnung_schulbuecher_2026.pdf' });
      expect(res.isNonExam).toBe(true);
      expect(res.detectedCategory).toBe('Rechnung / Beleg');
    });

    it('erkennt ärztliches Attest / Krankmeldung anhand des Dateinamens', () => {
      const res = isNonExamDocument({ name: 'arztzeugnis_mustermann.jpg' });
      expect(res.isNonExam).toBe(true);
      expect(res.detectedCategory).toBe('Ärztliches Attest');
    });

    it('erkennt Einverständniserklärung anhand des Textinhalts', () => {
      const consentText =
        'Hiermit willige ich ein, dass Fotos meines Kindes für den Schuljahresbericht verwendet werden dürfen. Unterschrift der Erziehungsberechtigten: _________';
      const res = isNonExamDocument({ text: consentText });
      expect(res.isNonExam).toBe(true);
      expect(res.detectedCategory).toBe('Einverständniserklärung');
      expect(res.reason).toContain('Einverständniserklärung');
    });

    it('akzeptiert echte Prüfungstexte mit Aufgaben und Punkten', () => {
      const examText =
        'Mathematik Klassenarbeit 1\nAufgabe 1: Löse 4x - 8 = 16 (4 Punkte)\nAufgabe 2: Bestimme die Nullstellen von f(x) (6 Punkte)';
      const res = isNonExamDocument({ text: examText });
      expect(res.isNonExam).toBe(false);
    });

    it('akzeptiert eine echte Musterlösung', () => {
      const rubricText =
        'Erwartungshorizont / Musterlösung:\nAufgabe 1: 4x = 24 => x = 6 (4 Punkte)\nAufgabe 2: x1 = 2, x2 = -2 (6 Punkte)';
      const res = isNonExamDocument({ text: rubricText });
      expect(res.isNonExam).toBe(false);
    });
  });

  describe('KI-Dokumenttyp-Klassifizierung & Override-Option (validateDocument & Gemini)', () => {
    it('klassifiziert Nicht-Prüfungsdokumente via KI und liefert HTTP 400 mit canOverride: true', async () => {
      process.env.GEMINI_API_KEY = 'test-key';

      // Mocke KI-Klassifikation für ein administratives Nicht-Prüfungs-Dokument (z. B. Einverständniserklärung-Scan)
      vi.spyOn(geminiModule, 'classifyDocumentWithGemini').mockResolvedValue({
        isExamRelated: false,
        documentType: 'CONSENT_FORM',
        confidence: 'HIGH',
        detectedSummary: 'Einverständniserklärung für Medienaufnahmen der Schule',
        rejectionReason:
          'Das hochgeladene Dokument wurde als Einverständniserklärung erkannt und enthält keine Prüfungsaufgaben.',
        canOverride: true,
      });

      const samplePng = createTestPng(100, 100, (x, y) => (y % 20 === 0 ? 0 : 255));
      const res = await validateDocument({
        buffer: samplePng,
        name: 'scan_001.png',
        mimeType: 'image/png',
      });

      expect(res.valid).toBe(false);
      expect(res.status).toBe(400);
      expect(res.reason).toBe('NON_EXAM_DOCUMENT');
      expect(res.canOverride).toBe(true);
      expect(res.classification?.documentType).toBe('CONSENT_FORM');
      expect(res.error).toContain('Einverständniserklärung');
      expect(res.error).not.toMatch(/\u00df/);
    });

    it('lässt Nicht-Prüfungsdokumente bei explizitem overrideDocumentType: true durch', async () => {
      process.env.GEMINI_API_KEY = 'test-key';

      vi.spyOn(geminiModule, 'classifyDocumentWithGemini').mockResolvedValue({
        isExamRelated: false,
        documentType: 'CONSENT_FORM',
        confidence: 'HIGH',
        detectedSummary: 'Einverständniserklärung',
        rejectionReason: 'Nicht-Prüfungsdokument erkannt.',
        canOverride: true,
      });

      const samplePng = createTestPng(100, 100, (x, y) => (y % 20 === 0 ? 0 : 255));
      const res = await validateDocument(
        {
          buffer: samplePng,
          name: 'scan_001.png',
          mimeType: 'image/png',
        },
        { overrideDocumentType: true } // Lehrperson klickt "Trotzdem als Prüfung behandeln"
      );

      expect(res.valid).toBe(true);
    });

    it('akzeptiert eine echte synthetische Prüfung bei KI-Klassifikation', async () => {
      process.env.GEMINI_API_KEY = 'test-key';

      vi.spyOn(geminiModule, 'classifyDocumentWithGemini').mockResolvedValue({
        isExamRelated: true,
        documentType: 'STUDENT_EXAM',
        confidence: 'HIGH',
        detectedSummary: 'Handschriftliche Schülerarbeit zu linearer Algebra',
        rejectionReason: '',
        canOverride: true,
      });

      const samplePng = createTestPng(100, 100, (x, y) => (y % 15 === 0 ? 0 : 255));
      const res = await validateDocument({
        buffer: samplePng,
        name: 'schueler_scan_01.png',
        mimeType: 'image/png',
      });

      expect(res.valid).toBe(true);
    });

    it('behandelt mehrdeutige Formate (AMBIGUOUS) mit canOverride: true statt stillem Blockieren', async () => {
      process.env.GEMINI_API_KEY = 'test-key';

      vi.spyOn(geminiModule, 'classifyDocumentWithGemini').mockResolvedValue({
        isExamRelated: false,
        documentType: 'AMBIGUOUS',
        confidence: 'LOW',
        detectedSummary: 'Ungewöhnliches Notizblatt oder Skizze',
        rejectionReason:
          'Das Dokument weist ein ungewöhnliches Format auf und konnte nicht zweifelsfrei als Prüfung erkannt werden.',
        canOverride: true,
      });

      const samplePng = createTestPng(100, 100, (x, y) => (y % 25 === 0 ? 0 : 255));
      const res = await validateDocument({
        buffer: samplePng,
        name: 'skizzen_001.png',
        mimeType: 'image/png',
      });

      expect(res.valid).toBe(false);
      expect(res.status).toBe(400);
      expect(res.reason).toBe('NON_EXAM_DOCUMENT');
      expect(res.canOverride).toBe(true);
      expect(res.classification?.documentType).toBe('AMBIGUOUS');
    });
  });

  describe('Ergänzung 1 (01.11.2026): Erkennung auch für Referenz-/Musterlösungs-Uploads', () => {
    it('lehnt Einverständniserklärung bei validateReferenceUpload ab', async () => {
      const consentBuffer = Buffer.from(
        '%PDF-1.4\n/Title (Einverstaendniserklaerung Foto und Video)\nstream\nHiermit willige ich ein.\nendstream'
      );
      const res = await validateReferenceUpload(
        {
          name: 'consent_form.pdf',
          type: 'application/pdf',
          size: consentBuffer.length,
          arrayBuffer: async () => Uint8Array.from(consentBuffer).buffer,
        },
        'Die Musterlösung'
      );

      expect(res.valid).toBe(false);
      expect(res.status).toBe(400);
      expect(res.reason).toBe('NON_EXAM_DOCUMENT');
      expect(res.error).toContain('Einverständniserklärung');
      expect(res.error).not.toMatch(/\u00df/);
    });

    it('akzeptiert Musterlösung bei validateReferenceUpload bei Override', async () => {
      const consentBuffer = Buffer.from(
        '%PDF-1.4\n/Title (Einverstaendniserklaerung Foto und Video)\nstream\nHiermit willige ich ein.\nendstream'
      );
      const res = await validateReferenceUpload(
        {
          name: 'consent_form.pdf',
          type: 'application/pdf',
          size: consentBuffer.length,
          arrayBuffer: async () => Uint8Array.from(consentBuffer).buffer,
        },
        'Die Musterlösung',
        { overrideDocumentType: true }
      );

      expect(res.valid).toBe(true);
    });

    it('lehnt base64-JSON-Payload einer Einverständniserklärung bei validateReferenceUpload ab', async () => {
      const consentPng = createTestPng(100, 100, (x, y) => (y % 15 === 0 ? 0 : 255));
      const payload = JSON.stringify({
        name: 'Einverstaendniserklaerung_Klasse4.png',
        mimeType: 'image/png',
        data: consentPng.toString('base64'),
      });

      const res = await validateReferenceUpload(payload, 'Die Musterlösung');
      expect(res.valid).toBe(false);
      expect(res.status).toBe(400);
      expect(res.reason).toBe('NON_EXAM_DOCUMENT');
      expect(res.canOverride).toBe(true);
      expect(res.error).toContain('Einverständniserklärung');
      expect(res.error).not.toMatch(/\u00df/);
    });

    it('akzeptiert base64-JSON-Payload einer Einverständniserklärung bei explizitem Override', async () => {
      const consentPng = createTestPng(100, 100, (x, y) => (y % 15 === 0 ? 0 : 255));
      const payload = JSON.stringify({
        name: 'Einverstaendniserklaerung_Klasse4.png',
        mimeType: 'image/png',
        data: consentPng.toString('base64'),
      });

      const res = await validateReferenceUpload(payload, 'Die Musterlösung', {
        overrideDocumentType: true,
      });
      expect(res.valid).toBe(true);
    });

    it('akzeptiert eine gültige Musterlösung als base64-JSON-Payload ohne Regression', async () => {
      const validPng = createTestPng(100, 100, (x, y) => (y % 15 === 0 ? 0 : 255));
      const payload = JSON.stringify({
        name: 'Musterloesung_Mathematik.png',
        mimeType: 'image/png',
        data: validPng.toString('base64'),
      });

      const res = await validateReferenceUpload(payload, 'Die Musterlösung');
      expect(res.valid).toBe(true);
    });

    it('prüft auch Unterrichtsmaterial bei validateExamMaterialInput', async () => {
      const res = await validateExamMaterialInput(
        'Datenschutzerklärung: Die Nutzung unserer Schulplattform unterliegt den Bestimmungen...',
        { overrideDocumentType: false }
      );
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('NON_EXAM_DOCUMENT');
    });
  });

  describe('Ergänzung 2 (01.11.2026): Korrekte Ablehnungsgründe (leer vs. Dokumenttyp)', () => {
    it('unterscheidet klar zwischen echtem leeren Blatt (Grund: BLANK_SCAN) und Nicht-Prüfung mit Inhalt (Grund: NON_EXAM_DOCUMENT)', async () => {
      // 1. Echtes leeres Blatt: Grund muss BLANK_SCAN sein
      const genuineBlankPng = createTestPng(100, 100, () => 255);
      const blankRes = await validateStudentExamUpload(genuineBlankPng, 'Die Schülerarbeit');
      expect(blankRes.valid).toBe(false);
      expect(blankRes.reason).toBe('BLANK_SCAN');
      expect(blankRes.error).toContain('leer');

      // 2. Einverständniserklärung mit Inhalt: Grund darf NICHT 'BLANK_SCAN' sein, sondern 'NON_EXAM_DOCUMENT'
      const consentPng = createTestPng(100, 100, (x, y) => (y % 15 === 0 ? 0 : 255));
      const consentRes = await validateStudentExamUpload(
        {
          name: 'einverstaendnis.png',
          type: 'image/png',
          size: consentPng.length,
          arrayBuffer: async () => Uint8Array.from(consentPng).buffer,
        },
        'Die Schülerarbeit'
      );
      expect(consentRes.valid).toBe(false);
      expect(consentRes.reason).toBe('NON_EXAM_DOCUMENT');
      expect(consentRes.error).toContain('Einverständniserklärung');
      expect(consentRes.error).not.toContain('vollständig leer');
    });
  });

  describe('Schweizer Hochdeutsch Sprachkonventionen (Striktes "ss", kein Eszett)', () => {
    it('verwendet in allen Fehlermeldungen und Begründungen ausnahmslos "ss" statt Eszett', () => {
      const nonExamRes = isNonExamDocument({ name: 'einverstaendnis.pdf' });
      expect(nonExamRes.reason).not.toMatch(/\u00df/);

      const blankRes = detectBlankOrEmptyImage(createTestPng(100, 100, () => 255));
      expect(blankRes.reason).not.toMatch(/\u00df/);
    });
  });
});
