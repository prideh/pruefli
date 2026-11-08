import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseExamMetadata,
  embedExamMetadata,
  resolveExamMetadataFromRecord,
  isExamApproved,
  isExamGenerated,
} from '@/lib/exam-meta';
import {
  isStorageReferencePointer,
  extractStorageReferenceKey,
  offloadReferenceMaterialToStorage,
  resolveStoredReferenceMaterial,
  type StorageAdapter,
} from '@/lib/storage';
import {
  saveScannedRelayDocument,
  getScannedRelayDocument,
  getScannedRelayDocumentAsync,
  resetRelayStoreForTests,
} from '@/lib/relay-store';
import {
  STALE_PROCESSING_TIMEOUT_MS,
  STALE_PROCESSING_RECOVERY_MESSAGE,
  isSubmissionStaleProcessing,
} from '@/lib/stale-submissions';
import { SUBJECT_PROFILES, evaluateStemStepModality } from '@/lib/grading';
import { computeEveryNPagesStartPages, detectPageOneHeaderStarts } from '@/lib/pdf-batch';
import { SECURITY_HEADERS } from '@/proxy';

describe('Technical & Product Gaps Sweep 1', () => {
  describe('1. Prisma Schema Shadow-Table Consolidation & Structured Exam Metadata', () => {
    it('definiert alle vormals losen Runtime-Tabellen explizit in prisma/schema.prisma', () => {
      const schemaPath = path.join(process.cwd(), 'prisma/schema.prisma');
      const schemaContent = fs.readFileSync(schemaPath, 'utf-8');

      expect(schemaContent).toContain('@@map("teacher_sessions")');
      expect(schemaContent).toContain('@@map("teacher_session_revocations")');
      expect(schemaContent).toContain('@@map("teacher_email_verifications")');
      expect(schemaContent).toContain('@@map("teacher_federated_identities")');
      expect(schemaContent).toContain('@@map("class_archives")');
      expect(schemaContent).toContain('@@map("teacher_subject_preferences")');
      expect(schemaContent).toContain('@@map("class_subject_preferences")');
      expect(schemaContent).toContain('@@map("relay_documents")');
      expect(schemaContent).toContain('isGenerated');
      expect(schemaContent).toContain('isApproved');
      expect(schemaContent).toContain('box2d');
      expect(schemaContent).not.toContain('\u00df');
    });

    it('resolveExamMetadataFromRecord kombiniert strukturierte Datenbank-Spalten und eingebettete Metadaten abwaertskompatibel', () => {
      const embedded = embedExamMetadata('Halbpunkte erlaubt', {
        isGenerated: true,
        isApproved: false,
        approvedAt: null,
        taskSources: { '1': 'Kapitel 1.2' },
      });

      const resolvedUnapproved = resolveExamMetadataFromRecord({
        gradingNotes: embedded,
        isGenerated: true,
        isApproved: false,
        tasks: [{ taskId: '2', sourceReference: 'Seite 4' }],
      });
      expect(resolvedUnapproved.metadata.isGenerated).toBe(true);
      expect(resolvedUnapproved.metadata.isApproved).toBe(false);
      expect(resolvedUnapproved.metadata.taskSources).toEqual({
        '1': 'Kapitel 1.2',
        '2': 'Seite 4',
      });
      expect(resolvedUnapproved.cleanNotes).toBe('Halbpunkte erlaubt');
      expect(isExamGenerated({ gradingNotes: embedded })).toBe(true);
      expect(isExamApproved({ gradingNotes: embedded })).toBe(false);

      const parsedLegacy = parseExamMetadata(embedded);
      expect(parsedLegacy.metadata.isGenerated).toBe(true);
    });
  });

  describe('2. Storage-Backed Reference Material Offloading', () => {
    it('lagert grosse serialisierte Base64-Referenzdokumente in den StorageAdapter aus und loest sie transparent auf', async () => {
      const memoryMap = new Map<string, Buffer>();
      const mockAdapter: StorageAdapter = {
        async write(key, data) {
          memoryMap.set(key, data);
          return `/uploads/${key}`;
        },
        async read(key) {
          const buf = memoryMap.get(key);
          return buf ? { buffer: buf, contentType: 'application/json' } : null;
        },
        async delete(key) {
          return memoryMap.delete(key);
        },
        async exists(key) {
          return memoryMap.has(key);
        },
        getUrl(key) {
          return `/uploads/${key}`;
        },
      };

      const plainRubric = 'Aufgabe 1: 2x = 8 => x = 4 (2 Punkte)';
      const plainResult = await offloadReferenceMaterialToStorage(plainRubric, {
        minBytesThreshold: 10,
        adapter: mockAdapter,
      });
      expect(plainResult.storageKey).toBeNull();
      expect(plainResult.storedValue).toBe(plainRubric);

      const serializedDoc = JSON.stringify({
        name: 'musterloesung.pdf',
        mimeType: 'application/pdf',
        data: 'JVBERi0xLjQK'.repeat(50),
      });
      const offloaded = await offloadReferenceMaterialToStorage(serializedDoc, {
        minBytesThreshold: 64,
        adapter: mockAdapter,
      });
      expect(offloaded.storageKey).toMatch(/^references\/ref-[a-f0-9]{64}\.json$/);
      expect(isStorageReferencePointer(offloaded.storedValue)).toBe(true);
      expect(extractStorageReferenceKey(offloaded.storedValue)).toBe(offloaded.storageKey);

      const resolved = await resolveStoredReferenceMaterial(offloaded.storedValue, {
        adapter: mockAdapter,
      });
      expect(resolved).toBe(serializedDoc);
    });
  });

  describe('3. Persistent & In-Memory QR Relay Store', () => {
    beforeEach(() => {
      resetRelayStoreForTests();
    });

    it('speichert und liest Relay-Dokumente synchron und asynchron mandantenisoliert', async () => {
      saveScannedRelayDocument({
        id: 'doc-1',
        sessionId: 'sess-123',
        teacherId: 'teacher-1',
        targetMode: 'RUBRIC',
        payload: JSON.stringify({ mimeType: 'image/jpeg', data: 'abc' }),
        pageCount: 2,
        createdAt: Date.now(),
      });

      const syncHit = getScannedRelayDocument('sess-123', 'teacher-1');
      expect(syncHit?.id).toBe('doc-1');
      expect(getScannedRelayDocument('sess-123', 'other-teacher')).toBeNull();

      const asyncHit = await getScannedRelayDocumentAsync('sess-123', 'teacher-1');
      expect(asyncHit?.pageCount).toBe(2);
    });
  });

  describe('4. Hardened Content-Security-Policy (CSP)', () => {
    it('definiert eine aktive Content-Security-Policy in SECURITY_HEADERS', () => {
      const csp = SECURITY_HEADERS['Content-Security-Policy'];
      expect(csp).toBeDefined();
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("media-src 'self' blob: mediastream:");
      expect(csp).toContain("object-src 'none'");
    });
  });

  describe('5. Stale Background PROCESSING Submission Recovery', () => {
    it('erkennt verwaiste PROCESSING-Submissions nach Ablauf von STALE_PROCESSING_TIMEOUT_MS', () => {
      const now = Date.now();
      expect(
        isSubmissionStaleProcessing(
          {
            status: 'PROCESSING',
            updatedAt: new Date(now - STALE_PROCESSING_TIMEOUT_MS - 10_000),
          },
          now
        )
      ).toBe(true);

      expect(
        isSubmissionStaleProcessing(
          {
            status: 'PROCESSING',
            updatedAt: new Date(now - 30_000),
          },
          now
        )
      ).toBe(false);

      expect(
        isSubmissionStaleProcessing(
          {
            status: 'COMPLETED',
            updatedAt: new Date(now - STALE_PROCESSING_TIMEOUT_MS - 60_000),
          },
          now
        )
      ).toBe(false);

      expect(STALE_PROCESSING_RECOVERY_MESSAGE).not.toContain('\u00df');
    });
  });

  describe('6. STEM Modality Verification Engine (Physik, Chemie, Geometrie)', () => {
    it('enthaelt keine "in Vorbereitung"-Platzhalter mehr in den Fachprofil-Beschreibungen', () => {
      for (const profile of SUBJECT_PROFILES) {
        expect(profile.supportDescription).not.toMatch(/in Vorbereitung/i);
        expect(profile.supportDescription).not.toContain('ß');
      }
    });

    it('begrenzt reine Einheitenabzuege in Physik/Geometrie auf maximal 0.5 Punkte', () => {
      const check = evaluateStemStepModality({
        subject: 'Physik',
        schrittText: 'F = 12 * 9.81 = 117.72',
        begruendung: 'Zahlenwert korrekt, aber Einheit fehlt.',
        erreichtePunkte: 0,
        maximalPunkte: 2,
      });

      expect(check.isUnitOnlyDeduction).toBe(true);
      expect(check.cappedEarnedPoints).toBe(1.5);
      expect(check.normalizedReason).toContain('0.5 Punkte');
    });
  });

  describe('7. Interactive Red-Ink Scan Overlay (Rotstift-Overlay)', () => {
    it('integriert den interaktiven Rotstift-Overlay-Schalter und die Aufgaben-Markierungen in der Korrekturansicht', () => {
      const workspacePath = path.join(process.cwd(), 'app/correct/[id]/page.tsx');
      const source = fs.readFileSync(workspacePath, 'utf-8');
      expect(source).toContain('data-testid="toggle-red-ink-overlay"');
      expect(source).toContain('data-testid="scan-red-ink-overlay"');
      expect(source).toContain('Rotstift-Overlay');
      expect(source).not.toContain('ß');
    });
  });

  describe('8. Multi-Page N-Split & Local Header Boundary Detection in PDF Batch Splitter', () => {
    it('berechnet Startseiten fuer 3-seitige und 4-seitige Klausuren korrekt', () => {
      expect(computeEveryNPagesStartPages(9, 3)).toEqual([1, 4, 7]);
      expect(computeEveryNPagesStartPages(8, 4)).toEqual([1, 5]);
    });

    it('erkennt lokale Seitenkoepfe ("Seite 1", "Blatt 1", "Name:") ohne KI-Aufruf', () => {
      const pages = [
        { pageNumber: 1, extractedTextPreview: 'Mathematik Prüfung - Seite 1 / 2 - Name: Anna' },
        { pageNumber: 2, extractedTextPreview: 'Mathematik Prüfung - Seite 2 / 2' },
        { pageNumber: 3, extractedTextPreview: 'Mathematik Prüfung - Seite 1 / 2 - Name: Ben' },
        { pageNumber: 4, extractedTextPreview: 'Mathematik Prüfung - Seite 2 / 2' },
      ];
      expect(detectPageOneHeaderStarts(pages)).toEqual([1, 3]);
    });
  });
});
