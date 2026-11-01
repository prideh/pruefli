import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateExamFromMaterial,
  regenerateSingleTask,
  replaceTaskInText,
} from '@/lib/exam-generator';
import {
  parseExamMetadata,
  embedExamMetadata,
  isExamApproved,
  isExamGenerated,
} from '@/lib/exam-meta';
import { clearLlmCache } from '@/lib/llm-cache';

// Mock the Google GenAI SDK
const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: mockGenerateContent,
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
  };
});

describe('Exam Generator from Teaching Material (lib/exam-generator.ts)', () => {
  const teacherId = 'teacher-swiss-001';
  const sampleMaterialText = `
=== Dossier: Lineare Gleichungen (Sekundarstufe I) ===
Kapitel 1: Grundbegriffe
Eine lineare Gleichung hat die Form ax + b = c.

Kapitel 2: Gleichungen mit Klammern (Seite 4)
Beispiel 1: 3(x + 2) = 18 -> 3x + 6 = 18 -> 3x = 12 -> x = 4.
Uebung 2: 4(2x - 1) = 20.

Kapitel 3: Textaufgaben aus dem Alltag (Seite 7)
Aufgabe 5: Ein Velo kostet dreimal so viel wie ein Velohelm...
`;

  const mockGeneratedExamJson = {
    examTitle: 'Mathematik: Lineare Gleichungen',
    examTemplateText: `# Mathematik Prüfung: Lineare Gleichungen\n\n## Aufgabe 1 (4 Punkte)\nLöse die Gleichung: 3(x + 2) = 18.\n\n## Aufgabe 2 (6 Punkte)\nLöse die Textaufgabe vom Velohelm.`,
    rubricText: `# Musterlösung\n\n## Aufgabe 1 (4 Punkte)\n3x + 6 = 18 (2 P.)\n3x = 12 (1 P.)\nx = 4 (1 P.)\n\n## Aufgabe 2 (6 Punkte)\nAnsatz: x + 3x = 400 (3 P.)\nx = 100 (3 P.)`,
    tasks: [
      {
        taskId: '1',
        title: 'Aufgabe 1: Gleichung mit Klammern',
        maxPoints: 4,
        sourceReference: 'Kapitel 2, Seite 4, Beispiel 1',
        taskQuestion: 'Löse die Gleichung: 3(x + 2) = 18.',
        taskSolution: '3x + 6 = 18 -> x = 4 (4 Punkte)',
      },
      {
        taskId: '2',
        title: 'Aufgabe 2: Textaufgabe Velohelm',
        maxPoints: 6,
        sourceReference: 'Kapitel 3, Seite 7, Aufgabe 5',
        taskQuestion: 'Löse die Textaufgabe vom Velohelm.',
        taskSolution: 'Ansatz x + 3x = 400 -> x = 100 (6 Punkte)',
      },
    ],
  };

  beforeEach(async () => {
    await clearLlmCache();
    mockGenerateContent.mockReset();
    process.env.GEMINI_API_KEY = 'test-gemini-key';
  });

  describe('generateExamFromMaterial', () => {
    it('refuses generation when teaching material is missing', async () => {
      // Null / undefined material
      await expect(
        generateExamFromMaterial({
          teacherId,
          material: null as unknown as string,
        })
      ).rejects.toThrow('Unterrichtsmaterial ist erforderlich');

      // Empty string
      await expect(
        generateExamFromMaterial({
          teacherId,
          material: '   ',
        })
      ).rejects.toThrow('Unterrichtsmaterial ist erforderlich');

      // Empty array
      await expect(
        generateExamFromMaterial({
          teacherId,
          material: [],
        })
      ).rejects.toThrow('Unterrichtsmaterial ist erforderlich');

      expect(mockGenerateContent).not.toHaveBeenCalled();
    });

    it('generates a complete exam package with tasks, rubric, template, and source references', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(mockGeneratedExamJson),
      });

      const res = await generateExamFromMaterial({
        teacherId,
        material: sampleMaterialText,
        subject: 'Mathematik',
        topic: 'Lineare Gleichungen',
        stufe: 'Sekundarstufe I',
        totalPoints: 10,
        taskCount: 2,
      });

      expect(res.cached).toBe(false);
      expect(res.examPackage.examTitle).toBe('Mathematik: Lineare Gleichungen');
      expect(res.examPackage.tasks).toHaveLength(2);
      expect(res.examPackage.tasks[0].sourceReference).toBe('Kapitel 2, Seite 4, Beispiel 1');
      expect(res.examPackage.tasks[1].sourceReference).toBe('Kapitel 3, Seite 7, Aufgabe 5');
      expect(res.examPackage.totalPoints).toBe(10);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('serves identical requests from the LLM content-hash cache without calling Gemini', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(mockGeneratedExamJson),
      });

      // First call -> Cache MISS
      const first = await generateExamFromMaterial({
        teacherId,
        material: sampleMaterialText,
        subject: 'Mathematik',
        totalPoints: 10,
        taskCount: 2,
      });
      expect(first.cached).toBe(false);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);

      // Second identical call -> Cache HIT
      const second = await generateExamFromMaterial({
        teacherId,
        material: sampleMaterialText,
        subject: 'Mathematik',
        totalPoints: 10,
        taskCount: 2,
      });
      expect(second.cached).toBe(true);
      expect(second.examPackage.examTitle).toBe(first.examPackage.examTitle);
      expect(second.examPackage.tasks).toEqual(first.examPackage.tasks);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1); // No second model call
    });

    it('produces a different cache key when material or options differ', async () => {
      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify(mockGeneratedExamJson),
      });

      // Call A
      await generateExamFromMaterial({
        teacherId,
        material: sampleMaterialText,
        subject: 'Mathematik',
      });

      // Call B (different material)
      const resB = await generateExamFromMaterial({
        teacherId,
        material: `${sampleMaterialText}\nZusatzkapitel 4: Quadratische Gleichungen`,
        subject: 'Mathematik',
      });

      // Call B was a cache MISS because material differed
      expect(resB.cached).toBe(false);
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });
  });

  describe('regenerateSingleTask', () => {
    const mockSingleTaskJson = {
      taskId: '2',
      title: 'Aufgabe 2 (neu): Geometrische Textaufgabe',
      maxPoints: 6,
      sourceReference: 'Kapitel 3, Seite 8, Beispiel 3b',
      taskQuestion: 'Berechne den Umfang eines Rechtecks mit doppelter Länge.',
      taskSolution: 'Umfang = 2(a + 2a) = 6a (6 Punkte)',
    };

    it('refuses regeneration when material is missing', async () => {
      await expect(
        regenerateSingleTask({
          teacherId,
          material: null as unknown as string,
          taskId: '2',
        })
      ).rejects.toThrow('Unterrichtsmaterial ist für die Neu-Generierung erforderlich');
    });

    it('regenerates a single task with source reference and caches result', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify(mockSingleTaskJson),
      });

      const res = await regenerateSingleTask({
        teacherId,
        material: sampleMaterialText,
        taskId: '2',
        targetMaxPoints: 6,
        instructions: 'Mehr geometrischer Bezug erwünscht',
      });

      expect(res.cached).toBe(false);
      expect(res.task.taskId).toBe('2');
      expect(res.task.title).toBe('Aufgabe 2 (neu): Geometrische Textaufgabe');
      expect(res.task.sourceReference).toBe('Kapitel 3, Seite 8, Beispiel 3b');
      expect(res.task.maxPoints).toBe(6);

      // Second identical call hits cache
      const cachedRes = await regenerateSingleTask({
        teacherId,
        material: sampleMaterialText,
        taskId: '2',
        targetMaxPoints: 6,
        instructions: 'Mehr geometrischer Bezug erwünscht',
      });
      expect(cachedRes.cached).toBe(true);
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });
  });

  describe('replaceTaskInText', () => {
    it('replaces a targeted task in markdown without modifying other tasks', () => {
      const original = `# Aufgabenblatt

## Aufgabe 1 (4 Punkte)
Löse 2x = 10.

## Aufgabe 2 (6 Punkte)
Alte Frage zu Aufgabe 2.

## Aufgabe 3 (5 Punkte)
Löse 5x = 25.`;

      const newTaskContent = `## Aufgabe 2 (6 Punkte)
Neue frische Frage zu Aufgabe 2 mit Geometrie.`;

      const updated = replaceTaskInText(original, '2', newTaskContent);

      expect(updated).toContain('## Aufgabe 1 (4 Punkte)\nLöse 2x = 10.');
      expect(updated).toContain('Neue frische Frage zu Aufgabe 2 mit Geometrie.');
      expect(updated).not.toContain('Alte Frage zu Aufgabe 2.');
      expect(updated).toContain('## Aufgabe 3 (5 Punkte)\nLöse 5x = 25.');
    });

    it('replaces the last task in a markdown document', () => {
      const original = `## Aufgabe 1 (4 Punkte)
Erste Aufgabe.

## Aufgabe 2 (4 Punkte)
Alte letzte Aufgabe.`;

      const newTask = `## Aufgabe 2 (4 Punkte)
Neu formulierte letzte Aufgabe.`;

      const updated = replaceTaskInText(original, '2', newTask);
      expect(updated).toContain('Erste Aufgabe.');
      expect(updated).toContain('Neu formulierte letzte Aufgabe.');
      expect(updated).not.toContain('Alte letzte Aufgabe.');
    });

    it('appends to document if task header is not matched', () => {
      const original = `## Aufgabe 1\nTest`;
      const newTask = `## Aufgabe 99\nNeu`;
      const updated = replaceTaskInText(original, '99', newTask);
      expect(updated).toBe(`## Aufgabe 1\nTest\n\n## Aufgabe 99\nNeu`);
    });
  });

  describe('Exam Metadata & Approval Gate (lib/exam-meta.ts)', () => {
    it('treats manual (non-generated) exams as approved by default', () => {
      const manualExam = { gradingNotes: 'Normale Lehrernotizen ohne KI-Metadaten' };
      expect(isExamGenerated(manualExam)).toBe(false);
      expect(isExamApproved(manualExam)).toBe(true);

      const parsed = parseExamMetadata(manualExam.gradingNotes);
      expect(parsed.metadata.isGenerated).toBe(false);
      expect(parsed.metadata.isApproved).toBe(true);
      expect(parsed.cleanNotes).toBe('Normale Lehrernotizen ohne KI-Metadaten');
    });

    it('embeds and parses generated exam metadata cleanly', () => {
      const meta = {
        isGenerated: true,
        isApproved: false,
        approvedAt: null,
        materialStorageKey: 'exam-materials/teacher-1/file.json',
        generatorParams: { topic: 'Algebra', taskCount: 4, totalPoints: 20 },
        taskSources: { '1': 'S. 4, Bsp. 1', '2': 'S. 7, Aufg. 5' },
      };

      const embedded = embedExamMetadata('Eigene Notizen der Lehrperson', meta);
      expect(embedded).toContain('<!-- PRUEFLI_EXAM_META:');
      expect(embedded).toContain('Eigene Notizen der Lehrperson');

      const parsed = parseExamMetadata(embedded);
      expect(parsed.metadata.isGenerated).toBe(true);
      expect(parsed.metadata.isApproved).toBe(false);
      expect(parsed.metadata.taskSources?.['1']).toBe('S. 4, Bsp. 1');
      expect(parsed.cleanNotes).toBe('Eigene Notizen der Lehrperson');

      // Abwaertskompatibles Parsen von bestehenden GRADEAI_EXAM_META-Dateien
      const legacyEmbedded =
        '<!-- GRADEAI_EXAM_META:{"isGenerated":true,"isApproved":false,"taskSources":{"1":"Legacy"}} --> Alte Notizen';
      const legacyParsed = parseExamMetadata(legacyEmbedded);
      expect(legacyParsed.metadata.isGenerated).toBe(true);
      expect(legacyParsed.metadata.isApproved).toBe(false);
      expect(legacyParsed.metadata.taskSources?.['1']).toBe('Legacy');
      expect(legacyParsed.cleanNotes).toBe('Alte Notizen');

      expect(isExamGenerated({ gradingNotes: embedded })).toBe(true);
      expect(isExamApproved({ gradingNotes: embedded })).toBe(false);
    });

    it('freezes exam once approvedAt is set and isApproved is true', () => {
      const meta = {
        isGenerated: true,
        isApproved: true,
        approvedAt: new Date().toISOString(),
        taskSources: { '1': 'Seite 2' },
      };

      const embedded = embedExamMetadata('', meta);
      expect(isExamGenerated({ gradingNotes: embedded })).toBe(true);
      expect(isExamApproved({ gradingNotes: embedded })).toBe(true);
    });
  });
});
