import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isPdfFile,
  inspectPdfBytes,
  computeSegmentsFromStartPages,
  toggleStartPageMarker,
  extractPdfPageRange,
  splitPdfByStartPages,
  splitPdfFileToFiles,
  createMultiPagePdf,
  resolveUnconfirmedStudentSuggestion,
} from '@/lib/pdf-batch';
import { extractDocumentText } from '@/lib/document-validation';
import { GET as getSubmissions } from '@/app/api/submissions/route';
import * as sessionModule from '@/lib/session';
import { db } from '@/lib/db';

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/cache', () => ({
  serverCache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    invalidateTags: vi.fn().mockResolvedValue(undefined),
  },
  CacheTags: {
    teacher: vi.fn((id: string) => `teacher:${id}`),
    submissions: vi.fn((id: string) => `submissions:${id}`),
  },
  invalidateSubmissionCache: vi.fn().mockResolvedValue(undefined),
  invalidateLogsCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/db', () => ({
  db: {
    submission: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    student: {
      findMany: vi.fn(),
    },
    exam: {
      findMany: vi.fn(),
    },
  },
}));

describe('Batch-Scan (#83): PDF-Klassensatz lokal zerlegen und mit Namens-Vorschlägen zuordnen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Lokale PDF-Inspektion & Unterscheidung Einseitig vs. Mehrseitig vs. Bild', () => {
    it('erkennt Bilddateien, einseitige PDFs und mehrseitige PDFs rein lokal ohne KI-Aufrufe', () => {
      const jpgBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      expect(isPdfFile({ name: 'scan.jpg', type: 'image/jpeg' }, jpgBytes)).toBe(false);
      expect(inspectPdfBytes(jpgBytes)).toEqual({
        isPdf: false,
        pageCount: 0,
        pages: [],
      });

      const singlePagePdf = createMultiPagePdf([{ label: 'Einzelseite Arbeit' }]);
      expect(isPdfFile({ name: 'einzel.pdf', type: 'application/pdf' }, singlePagePdf)).toBe(true);
      const singleInspection = inspectPdfBytes(singlePagePdf);
      expect(singleInspection.isPdf).toBe(true);
      expect(singleInspection.pageCount).toBe(1);
      expect(singleInspection.pages).toHaveLength(1);
      expect(singleInspection.pages[0].pageNumber).toBe(1);

      const multiPagePdf = createMultiPagePdf([
        { label: 'Schueler A - Blatt 1' },
        { label: 'Schueler A - Blatt 2' },
        { label: 'Schueler B - Blatt 1' },
        { label: 'Schueler C - Blatt 1' },
        { label: 'Schueler C - Blatt 2' },
      ]);
      const multiInspection = inspectPdfBytes(multiPagePdf);
      expect(multiInspection.isPdf).toBe(true);
      expect(multiInspection.pageCount).toBe(5);
      expect(multiInspection.pages).toHaveLength(5);

      // Jede Seite liefert ein eigenständiges 1-seitiges PDF für die Thumbnail-Seitenübersicht
      for (let i = 0; i < 5; i++) {
        const pageDesc = multiInspection.pages[i];
        expect(pageDesc.pageNumber).toBe(i + 1);
        expect(pageDesc.width).toBe(595);
        expect(pageDesc.height).toBe(842);
        const thumbInspection = inspectPdfBytes(pageDesc.singlePagePdfBytes);
        expect(thumbInspection.isPdf).toBe(true);
        expect(thumbInspection.pageCount).toBe(1);
      }
    });
  });

  describe('2. Manuelle Blattgrenzen-Markierung & Seitenbereich-Gruppierung', () => {
    it('fixiert Seite 1 als Start der ersten Arbeit und schaltet weitere Startseiten manuell um', () => {
      let starts = [1];
      // Seite 1 kann nicht abgewählt werden
      starts = toggleStartPageMarker(6, starts, 1);
      expect(starts).toEqual([1]);

      // Lehrperson markiert Seite 3 und Seite 6 als Beginn neuer Arbeiten
      starts = toggleStartPageMarker(6, starts, 6);
      starts = toggleStartPageMarker(6, starts, 3);
      expect(starts).toEqual([1, 3, 6]);

      const segments = computeSegmentsFromStartPages(6, starts);
      expect(segments).toEqual([
        {
          workIndex: 1,
          startPage: 1,
          endPage: 2,
          pageCount: 2,
          pageNumbers: [1, 2],
        },
        {
          workIndex: 2,
          startPage: 3,
          endPage: 5,
          pageCount: 3,
          pageNumbers: [3, 4, 5],
        },
        {
          workIndex: 3,
          startPage: 6,
          endPage: 6,
          pageCount: 1,
          pageNumbers: [6],
        },
      ]);

      // Erneutes Klicken auf Seite 3 hebt die Markierung auf und gruppiert Seiten 1..5 zusammen
      starts = toggleStartPageMarker(6, starts, 3);
      expect(starts).toEqual([1, 6]);
      expect(computeSegmentsFromStartPages(6, starts)).toEqual([
        {
          workIndex: 1,
          startPage: 1,
          endPage: 5,
          pageCount: 5,
          pageNumbers: [1, 2, 3, 4, 5],
        },
        {
          workIndex: 2,
          startPage: 6,
          endPage: 6,
          pageCount: 1,
          pageNumbers: [6],
        },
      ]);
    });

    it('zerlegt ein mehrseitiges Klassensatz-PDF exakt nach den markierten Seitenbereichen in eigenständige PDF-Dateien', async () => {
      const classSetBytes = createMultiPagePdf([
        { label: 'Arbeit Alpha Seite 1' },
        { label: 'Arbeit Alpha Seite 2' },
        { label: 'Arbeit Beta Seite 1' },
        { label: 'Arbeit Gamma Seite 1' },
        { label: 'Arbeit Gamma Seite 2' },
        { label: 'Arbeit Gamma Seite 3' },
      ]);

      const works = splitPdfByStartPages(classSetBytes, [1, 3, 4], 'Mathe_Klassensatz_2a.pdf');
      expect(works).toHaveLength(3);

      // Arbeit 1: Seiten 1-2 (2 Seiten gruppiert)
      expect(works[0].fileName).toBe('Mathe_Klassensatz_2a_Arbeit-1_S1-2.pdf');
      expect(works[0].startPage).toBe(1);
      expect(works[0].endPage).toBe(2);
      expect(works[0].pageCount).toBe(2);
      expect(inspectPdfBytes(works[0].pdfBytes).pageCount).toBe(2);
      const textWork1 = extractDocumentText(Buffer.from(works[0].pdfBytes));
      expect(textWork1).toContain('Arbeit Alpha Seite 1');
      expect(textWork1).toContain('Arbeit Alpha Seite 2');
      expect(textWork1).not.toContain('Arbeit Beta');
      expect(textWork1).not.toContain('Arbeit Gamma');

      // Arbeit 2: Seite 3 (1 Seite)
      expect(works[1].fileName).toBe('Mathe_Klassensatz_2a_Arbeit-2_S3.pdf');
      expect(works[1].startPage).toBe(3);
      expect(works[1].endPage).toBe(3);
      expect(works[1].pageCount).toBe(1);
      expect(inspectPdfBytes(works[1].pdfBytes).pageCount).toBe(1);
      const textWork2 = extractDocumentText(Buffer.from(works[1].pdfBytes));
      expect(textWork2).toContain('Arbeit Beta Seite 1');
      expect(textWork2).not.toContain('Arbeit Alpha');
      expect(textWork2).not.toContain('Arbeit Gamma');

      // Arbeit 3: Seiten 4-6 (3 Seiten gruppiert)
      expect(works[2].fileName).toBe('Mathe_Klassensatz_2a_Arbeit-3_S4-6.pdf');
      expect(works[2].startPage).toBe(4);
      expect(works[2].endPage).toBe(6);
      expect(works[2].pageCount).toBe(3);
      expect(inspectPdfBytes(works[2].pdfBytes).pageCount).toBe(3);
      const textWork3 = extractDocumentText(Buffer.from(works[2].pdfBytes));
      expect(textWork3).toContain('Arbeit Gamma Seite 1');
      expect(textWork3).toContain('Arbeit Gamma Seite 2');
      expect(textWork3).toContain('Arbeit Gamma Seite 3');
      expect(textWork3).not.toContain('Arbeit Alpha');

      // Prüfe auch File-Erzeugung via splitPdfFileToFiles
      const copy = new Uint8Array(classSetBytes.byteLength);
      copy.set(classSetBytes);
      const inputFile = new File([copy.buffer], 'Mathe_Klassensatz_2a.pdf', {
        type: 'application/pdf',
      });
      const { files } = await splitPdfFileToFiles(inputFile, [1, 3, 4]);
      expect(files).toHaveLength(3);
      expect(files[0].name).toBe('Mathe_Klassensatz_2a_Arbeit-1_S1-2.pdf');
      expect(files[1].name).toBe('Mathe_Klassensatz_2a_Arbeit-2_S3.pdf');
      expect(files[2].name).toBe('Mathe_Klassensatz_2a_Arbeit-3_S4-6.pdf');
    });

    it('extrahiert einzelne Seitenbereiche via extractPdfPageRange fehlerfrei', () => {
      const pdfBytes = createMultiPagePdf(4);
      const range2to3 = extractPdfPageRange(pdfBytes, 2, 3);
      expect(inspectPdfBytes(range2to3).pageCount).toBe(2);
    });
  });

  describe('3. Namens-Vorschläge & Verbindliche Bestätigung ("Zuordnung ausstehend")', () => {
    const classStudents = [
      { id: 'stu-1', name: 'Lukas Müller' },
      { id: 'stu-2', name: 'Anna Meier' },
      { id: 'stu-3', name: 'Sophie Keller' },
      { id: 'stu-4', name: 'Noah Müller' },
    ];

    it('schlägt Namen via exact/normalized Match, Teil-Match und Sibling-Logik vor, übernimmt sie aber NIEMALS ohne Bestätigung', () => {
      // 1. Exakter / normalisierter Treffer -> suggestedStudentId gesetzt, aber studentId bleibt null!
      const exactSuggestion = resolveUnconfirmedStudentSuggestion({
        extractedStudentName: 'Müller Lukas',
        isAiNameUncertain: false,
        classStudents,
      });
      expect(exactSuggestion).toEqual({
        studentId: null,
        suggestedStudentId: 'stu-1',
        isStudentMatchUncertain: true,
        confidence: 'HIGH',
      });

      // 1b. Teil-Token-Treffer ("Mueller Lukas" matched eindeutig auf "Lukas") -> suggestedStudentId gesetzt, studentId bleibt null!
      const partialTokenSuggestion = resolveUnconfirmedStudentSuggestion({
        extractedStudentName: 'Mueller Lukas',
        isAiNameUncertain: false,
        classStudents,
      });
      expect(partialTokenSuggestion).toEqual({
        studentId: null,
        suggestedStudentId: 'stu-1',
        isStudentMatchUncertain: true,
        confidence: 'LOW',
      });

      // 2. Unsicherheits-Flag der KI -> suggestedStudentId gesetzt, studentId bleibt null
      const uncertainSuggestion = resolveUnconfirmedStudentSuggestion({
        extractedStudentName: 'Anna Meier',
        isAiNameUncertain: true,
        classStudents,
      });
      expect(uncertainSuggestion).toEqual({
        studentId: null,
        suggestedStudentId: 'stu-2',
        isStudentMatchUncertain: true,
        confidence: 'LOW',
      });

      // 3. Mehrdeutiger Nachname ("Müller" passt auf Lukas Müller und Noah Müller) -> kein Vorschlag (null), Zuordnung ausstehend
      const ambiguousSuggestion = resolveUnconfirmedStudentSuggestion({
        extractedStudentName: 'Müller',
        isAiNameUncertain: false,
        classStudents,
      });
      expect(ambiguousSuggestion).toEqual({
        studentId: null,
        suggestedStudentId: null,
        isStudentMatchUncertain: true,
        confidence: 'NONE',
      });

      // 4. Nicht auflösbarer Name -> kein Vorschlag (null), Zuordnung ausstehend
      const unknownSuggestion = resolveUnconfirmedStudentSuggestion({
        extractedStudentName: 'Unbekannter Name',
        isAiNameUncertain: false,
        classStudents,
      });
      expect(unknownSuggestion).toEqual({
        studentId: null,
        suggestedStudentId: null,
        isStudentMatchUncertain: true,
        confidence: 'NONE',
      });

      // 5. Sibling-Logik: Wenn eine Geschwister-Abgabe mit gleichem extrahiertem Namen bereits einem Schüler zugeordnet wurde
      const siblingSuggestion = resolveUnconfirmedStudentSuggestion({
        extractedStudentName: 'Spitzname Luki',
        isAiNameUncertain: true,
        classStudents,
        currentSubmission: {
          id: 'sub-new',
          examId: 'exam-1',
          status: 'COMPLETED',
          earnedPoints: 15,
          gradeRounded: '4.8',
        },
        siblingSubmissions: [
          {
            id: 'sub-confirmed',
            examId: 'exam-1',
            studentId: 'stu-1',
            extractedStudentName: 'Spitzname Luki',
            status: 'COMPLETED',
            earnedPoints: 15,
            gradeRounded: '4.8',
          },
        ],
      });
      expect(siblingSuggestion.studentId).toBeNull();
      expect(siblingSuggestion.suggestedStudentId).toBe('stu-1');
      expect(siblingSuggestion.isStudentMatchUncertain).toBe(true);
    });

    it('liefert in GET /api/submissions unbestätigte Klassensatz-Arbeiten als "Nicht zugeordnet" mit vorbefülltem suggestedStudentId', async () => {
      vi.mocked(sessionModule.getSession).mockResolvedValue({ userId: 'teacher-1' });
      vi.mocked(db.submission.count).mockResolvedValue(2);
      vi.mocked(db.student.findMany).mockResolvedValue([
        { id: 'stu-1', name: 'Lukas Müller', classId: 'class-1' },
        { id: 'stu-2', name: 'Anna Meier', classId: 'class-1' },
      ] as unknown as Awaited<ReturnType<typeof db.student.findMany>>);
      vi.mocked(db.exam.findMany).mockResolvedValue([
        {
          id: 'exam-1',
          title: 'Bruchrechnen',
          subject: 'Mathematik',
          classId: 'class-1',
          class: { name: '2a Sek' },
        },
      ] as unknown as Awaited<ReturnType<typeof db.exam.findMany>>);

      vi.mocked(db.submission.findMany).mockResolvedValue([
        {
          id: 'sub-work-1',
          examId: 'exam-1',
          studentId: null,
          targetStudentId: null,
          student: null,
          extractedStudentName: 'Lukas Müller',
          suggestedStudentId: 'stu-1',
          isStudentMatchUncertain: true,
          isExamMatchUncertain: false,
          status: 'COMPLETED',
          earnedPoints: 18,
          gradeRaw: 5.5,
          gradeRounded: '5.5',
          createdAt: new Date('2026-10-10T10:00:00Z'),
          exam: {
            id: 'exam-1',
            title: 'Bruchrechnen',
            subject: 'Mathematik',
            maxPoints: 20,
            classId: 'class-1',
            class: { name: '2a Sek' },
          },
          tasks: [],
        },
        {
          id: 'sub-work-2',
          examId: 'exam-1',
          studentId: null,
          targetStudentId: null,
          student: null,
          extractedStudentName: 'Unleserlich',
          suggestedStudentId: null,
          isStudentMatchUncertain: true,
          isExamMatchUncertain: false,
          status: 'COMPLETED',
          earnedPoints: 14,
          gradeRaw: 4.5,
          gradeRounded: '4.5',
          createdAt: new Date('2026-10-10T10:01:00Z'),
          exam: {
            id: 'exam-1',
            title: 'Bruchrechnen',
            subject: 'Mathematik',
            maxPoints: 20,
            classId: 'class-1',
            class: { name: '2a Sek' },
          },
          tasks: [],
        },
      ] as unknown as Awaited<ReturnType<typeof db.submission.findMany>>);

      const res = await getSubmissions(new Request('http://localhost/api/submissions'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.submissions).toHaveLength(2);

      // Arbeit 1 hat Vorschlag stu-1, ist aber noch "Nicht zugeordnet" (wartet auf Bestätigung)
      expect(data.submissions[0].studentName).toBe('Nicht zugeordnet');
      expect(data.submissions[0].assignedStudentId).toBeNull();
      expect(data.submissions[0].suggestedStudentId).toBe('stu-1');
      expect(data.submissions[0].extractedStudentName).toBe('Lukas Müller');

      // Arbeit 2 hat keinen auflösbaren Namen -> landet ebenfalls in "Zuordnung ausstehend" ohne Vorschlag
      expect(data.submissions[1].studentName).toBe('Nicht zugeordnet');
      expect(data.submissions[1].assignedStudentId).toBeNull();
      expect(data.submissions[1].suggestedStudentId).toBeNull();
    });
  });
});
