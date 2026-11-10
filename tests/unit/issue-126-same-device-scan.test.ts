import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Buffer } from 'node:buffer';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import {
  isMobileScannerClient,
  getSameDeviceUploadCopy,
  type QrTargetMode,
} from '@/components/QrScannerDialog';
import { POST as relayUploadPost } from '@/app/api/mobile-relay/upload/route';
import { getScannedRelayDocument, resetRelayStoreForTests } from '@/lib/relay-store';
import * as jwtModule from '@/lib/jwt';
import { markEmailVerified } from '@/lib/email-verification';

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    after: vi.fn(),
  };
});

vi.mock('@/lib/jwt', () => ({
  verifyMobileRelayToken: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkAiRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  createRateLimitResponse: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    exam: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({ id: 'exam-1' }),
    },
  },
}));

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

function createNonBlankPng(width = 64, height = 64): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  const raw = Buffer.alloc(height * (1 + width * 3), 255);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0; // filter type None
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 3;
      const isInk = (x + y) % 7 === 0;
      const val = isInk ? 25 : 250;
      raw[px] = val;
      raw[px + 1] = val;
      raw[px + 2] = val;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    header,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('Issue #126: QR-Scan-Dialog Same-Device-Pfad in allen Modi', () => {
  beforeEach(async () => {
    resetRelayStoreForTests();
    await markEmailVerified('teacher-126', 'teacher126@schule.ch');
  });

  describe('1. Geräteerkennung (isMobileScannerClient)', () => {
    it('erkennt Smartphones über User-Agent oder schmalen/Touch-Viewport zuverlässig', () => {
      expect(
        isMobileScannerClient(
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
          false
        )
      ).toBe(true);
      expect(
        isMobileScannerClient(
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36',
          false
        )
      ).toBe(true);
      expect(
        isMobileScannerClient(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          true
        )
      ).toBe(true);
      expect(
        isMobileScannerClient(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          false
        )
      ).toBe(false);
      expect(isMobileScannerClient(undefined, false)).toBe(false);
    });
  });

  describe('2. Kurze, modusspezifische Same-Device-Texte (getSameDeviceUploadCopy)', () => {
    it('liefert für alle 5 Scan-Modi kurze, präzise Texte in Schweizer Rechtschreibung (ohne Eszett)', () => {
      const modes: QrTargetMode[] = [
        'RUBRIC',
        'EXAM_TEMPLATE',
        'SUBMISSION',
        'APPEND_SUBMISSION',
        'REPLACE_SUBMISSION',
      ];

      for (const mode of modes) {
        const copy = getSameDeviceUploadCopy(mode, 'Lukas Meier');
        expect(copy.title.length).toBeGreaterThan(5);
        expect(copy.title.length).toBeLessThanOrEqual(50);
        expect(copy.subtitle.length).toBeGreaterThan(10);
        expect(copy.subtitle.length).toBeLessThanOrEqual(75);
        expect(copy.title).not.toMatch(/\u00df/);
        expect(copy.subtitle).not.toMatch(/\u00df/);
      }

      expect(getSameDeviceUploadCopy('RUBRIC').title).toContain('Musterlösung');
      expect(getSameDeviceUploadCopy('EXAM_TEMPLATE').title).toContain('Vorlage');
      expect(getSameDeviceUploadCopy('APPEND_SUBMISSION', 'Mia').title).toContain('Mia');
      expect(getSameDeviceUploadCopy('REPLACE_SUBMISSION', 'Mia').title).toContain('Mia');
      expect(getSameDeviceUploadCopy('SUBMISSION').title).toContain('PDF oder Bilder');
    });
  });

  describe('3. QrScannerDialog: Same-Device-Aktionen, Direkt-Upload & Produktions-Direktlink in allen Modi', () => {
    const dialogPath = path.resolve(process.cwd(), 'components/QrScannerDialog.tsx');
    const dialogSource = fs.readFileSync(dialogPath, 'utf-8');
    const scanPagePath = path.resolve(process.cwd(), 'app/scan/[token]/page.tsx');
    const scanPageSource = fs.readFileSync(scanPagePath, 'utf-8');

    it('rendert "Auf diesem Gerät scannen", Kamera-Capture und Datei-Upload in allen Modi (nicht mehr auf SUBMISSION/REPLACE_SUBMISSION mit examId beschränkt)', () => {
      expect(dialogSource).not.toContain(
        "(targetMode === 'SUBMISSION' || targetMode === 'REPLACE_SUBMISSION') && examId && ("
      );
      expect(dialogSource).toContain('data-testid="same-device-scan-section"');
      expect(dialogSource).toContain('data-testid="same-device-scan-button"');
      expect(dialogSource).toContain('Auf diesem Gerät scannen');
      expect(dialogSource).toContain('data-testid="same-device-camera-input"');
      expect(dialogSource).toContain('capture="environment"');
      expect(dialogSource).toContain('data-testid="same-device-camera-button"');
      expect(dialogSource).toContain('data-testid="same-device-file-input"');
      expect(dialogSource).toContain('data-testid="same-device-upload-button"');
    });

    it('zeigt den kopierbaren Direktlink auch in Production (sobald scanUrl vorhanden ist) und beschränkt nur customOrigin auf isDevMode', () => {
      expect(dialogSource).not.toContain('{isDevMode && scanUrl && (');
      expect(dialogSource).toContain('{scanUrl && (');
      expect(dialogSource).toContain('data-testid="same-device-direct-link"');
      expect(dialogSource).toContain('handleCopyUrl');
      expect(dialogSource).toContain('{isDevMode && (');
      expect(dialogSource).toContain('customOrigin');
    });

    it('verarbeitet RUBRIC und EXAM_TEMPLATE direkt beim Upload im selben Dialog via onDocumentScanned und synchronisiert bei Tab-Rückkehr (focus/visibilitychange)', () => {
      expect(dialogSource).toContain("if (targetMode === 'RUBRIC' || targetMode === 'EXAM_TEMPLATE')");
      expect(dialogSource).toContain('onDocumentScanned(scannedDoc.payload, effectiveCount, targetMode)');
      expect(dialogSource).toContain("window.addEventListener('focus', handleVisibilityOrFocus)");
      expect(dialogSource).toContain(
        "document.addEventListener('visibilitychange', handleVisibilityOrFocus)"
      );
    });

    it('bewahrt den bestehenden Zwei-Geräte-QR-Relay vollständig und hält alle Texte frei von Eszett', () => {
      expect(dialogSource).toContain('alt="QR-Code für Smartphone-Kamera"');
      expect(dialogSource).toContain('label="1. QR-Code mit Handy scannen"');
      expect(dialogSource).toContain('label="2. Seiten abfotografieren"');
      expect(dialogSource).not.toMatch(/\u00df/);
      expect(scanPageSource).toContain('pendingOverrideRelayFiles');
      expect(scanPageSource).not.toMatch(/\u00df/);
    });
  });

  describe('4. POST /api/mobile-relay/upload: Direkte Rückgabe von scannedDocument für Same-Device RUBRIC & EXAM_TEMPLATE', () => {
    it('liefert bei RUBRIC und EXAM_TEMPLATE sowohl das serialisierte scannedDocument in der Response als auch im Relay-Store', async () => {
      for (const mode of ['RUBRIC', 'EXAM_TEMPLATE'] as const) {
        const sessionId = `sess-126-${mode}`;
        vi.mocked(jwtModule.verifyMobileRelayToken).mockResolvedValue({
          purpose: 'mobile_relay',
          sessionId,
          teacherId: 'teacher-126',
          targetMode: mode,
        });

        const pngBuf = createNonBlankPng(64, 64);
        const file = new File([new Uint8Array(pngBuf)], `${mode.toLowerCase()}-scan.png`, {
          type: 'image/png',
        });

        const formData = new FormData();
        formData.append('token', 'valid-relay-token');
        formData.append('targetMode', mode);
        formData.append('pages', file);

        const req = new Request('http://localhost/api/mobile-relay/upload', {
          method: 'POST',
          body: formData,
        });

        const res = await relayUploadPost(req);
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.targetMode).toBe(mode);
        expect(json.pagesCount).toBe(1);
        expect(json.status).toBe('DOCUMENT_TRANSFERRED');
        expect(json.scannedDocument).toBeDefined();
        expect(json.scannedDocument.targetMode).toBe(mode);
        expect(json.scannedDocument.pageCount).toBe(1);
        expect(typeof json.scannedDocument.id).toBe('string');
        expect(typeof json.scannedDocument.payload).toBe('string');

        const parsedPayload = JSON.parse(json.scannedDocument.payload);
        expect(parsedPayload.mimeType).toBe('image/png');
        expect(parsedPayload.data.length).toBeGreaterThan(20);

        const storedDoc = getScannedRelayDocument(sessionId, 'teacher-126');
        expect(storedDoc).not.toBeNull();
        expect(storedDoc?.id).toBe(json.scannedDocument.id);
        expect(storedDoc?.payload).toBe(json.scannedDocument.payload);
      }
    });
  });
});
