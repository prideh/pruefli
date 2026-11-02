import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeGradingHash,
  computeRubricParseHash,
  computeScanIdentificationHash,
  buildLlmCacheKey,
  getCachedLlmResult,
  setCachedLlmResult,
  clearLlmCache,
  canonicalizeJson,
  LLM_PROMPT_VERSIONS,
  type LlmCacheEntry,
} from '@/lib/llm-cache';
import {
  identifyExamAndStudentFromScan,
  DEFAULT_GEMINI_MODEL,
  type ExamCorrectionResult,
} from '@/lib/gemini';

// Mock the Google GenAI SDK to strictly prevent live model calls
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

describe('LLM Result Content-Hash Cache (lib/llm-cache.ts)', () => {
  const teacherAlpha = 'teacher-alpha-123';
  const teacherBeta = 'teacher-beta-456';

  const sampleStudentExam = [
    { mimeType: 'image/jpeg', data: 'BASE64_MOCK_IMAGE_PAGE_1' },
    { mimeType: 'image/jpeg', data: 'BASE64_MOCK_IMAGE_PAGE_2' },
  ];

  const sampleRubric = 'Aufgabe 1: 2x = 10 -> x = 5 (4 Punkte)';
  const modifiedRubric = 'Aufgabe 1: 3x = 12 -> x = 4 (5 Punkte)';

  const sampleCorrectionResult: ExamCorrectionResult = {
    schuelerName: 'Lukas Keller',
    istNameUnsicher: false,
    fach: 'Mathematik',
    datum: '2026-10-30',
    gesamterzieltePunkte: 4,
    gesamtmaximalPunkte: 4,
    note: '6.0',
    aufgaben: [
      {
        aufgabeId: '1',
        titel: 'Aufgabe 1',
        schuelerAntwort: '2x = 10; x = 5',
        erzieltePunkte: 4,
        maximalPunkte: 4,
        status: 'Korrekt',
        lehrerKommentar: 'Sehr sauber geloest.',
        schritte: [
          {
            schrittIndex: 1,
            schrittText: 'x = 5',
            istKorrekt: true,
            fehlerTyp: 'KeinFehler',
            erreichtePunkte: 4,
            maximalPunkte: 4,
            begruendung: 'Exakte Rechnung',
          },
        ],
      },
    ],
    schuelerFeedback: {
      staerken: ['Sichere Termumformung'],
      schwaechen: [],
      hilfreicherTipp: 'Weiter so!',
      uebungsEmpfehlung: 'Lineare Gleichungssysteme vertiefen',
    },
  };

  beforeEach(async () => {
    await clearLlmCache();
    mockGenerateContent.mockReset();
    process.env.GEMINI_API_KEY = 'test-mock-api-key';
  });

  describe('1. Deterministic Hashing & Canonicalization', () => {
    it('erzeugt denselben Hash unabhaengig von der Reihenfolge der Objekt-Schluessel', () => {
      const objA = { z: 1, a: 'hallo', m: [1, 2] };
      const objB = { a: 'hallo', m: [1, 2], z: 1 };

      expect(canonicalizeJson(objA)).toBe(canonicalizeJson(objB));
    });

    it('erzeugt unterschiedliche Hashes bei veraendertem Prompt-Template oder Modell', () => {
      const hash1 = computeGradingHash({
        teacherId: teacherAlpha,
        modelName: 'gemini-3.8-flash',
        promptVersion: 'v1',
        studentPages: sampleStudentExam,
        rubric: sampleRubric,
      });

      const hash2 = computeGradingHash({
        teacherId: teacherAlpha,
        modelName: 'gemini-3.8-pro',
        promptVersion: 'v1',
        studentPages: sampleStudentExam,
        rubric: sampleRubric,
      });

      const hash3 = computeGradingHash({
        teacherId: teacherAlpha,
        modelName: 'gemini-3.8-flash',
        promptVersion: 'v2',
        studentPages: sampleStudentExam,
        rubric: sampleRubric,
      });

      expect(hash1).not.toBe(hash2);
      expect(hash1).not.toBe(hash3);
    });

    it('erzeugt unterschiedliche Hashes bei geaenderten Ausfuehrungsparametern (thinkingLevel, seed, temperature)', () => {
      const baseHash = computeGradingHash({
        teacherId: teacherAlpha,
        modelName: DEFAULT_GEMINI_MODEL,
        studentPages: sampleStudentExam,
        rubric: sampleRubric,
      });

      const highThinkingHash = computeGradingHash({
        teacherId: teacherAlpha,
        modelName: DEFAULT_GEMINI_MODEL,
        studentPages: sampleStudentExam,
        rubric: sampleRubric,
        executionConfig: { thinkingLevel: 'HIGH' },
      });

      const differentSeedHash = computeGradingHash({
        teacherId: teacherAlpha,
        modelName: DEFAULT_GEMINI_MODEL,
        studentPages: sampleStudentExam,
        rubric: sampleRubric,
        executionConfig: { seed: 999 },
      });

      const differentTempHash = computeGradingHash({
        teacherId: teacherAlpha,
        modelName: DEFAULT_GEMINI_MODEL,
        studentPages: sampleStudentExam,
        rubric: sampleRubric,
        executionConfig: { temperature: 0.7 },
      });

      expect(baseHash).not.toBe(highThinkingHash);
      expect(baseHash).not.toBe(differentSeedHash);
      expect(baseHash).not.toBe(differentTempHash);
    });

    it('nutzt Version v6 fuer deterministische Grading-Prompt-Invalidierung', () => {
      expect(LLM_PROMPT_VERSIONS.grading).toContain('v6');
      expect(LLM_PROMPT_VERSIONS.grading).toBe('2026-11-02-grading-v6-deterministic-repeatability');
    });
  });

  describe('2. Scope 1: Same input twice -> exactly one model call', () => {
    it('liefert beim zweiten Aufruf das gecachte Ergebnis ohne erneuten Modellaufruf zurueck', async () => {
      const hash = computeGradingHash({
        teacherId: teacherAlpha,
        modelName: DEFAULT_GEMINI_MODEL,
        promptVersion: LLM_PROMPT_VERSIONS.grading,
        studentPages: sampleStudentExam,
        rubric: sampleRubric,
      });
      const key = buildLlmCacheKey(teacherAlpha, 'grading', hash);

      // Simulation des ersten Modell-Aufrufs
      let modelCallCount = 0;
      async function executeGradingWithCache(bypass = false): Promise<ExamCorrectionResult> {
        if (!bypass) {
          const cached = await getCachedLlmResult<ExamCorrectionResult>(key);
          if (cached) return cached.result;
        }

        modelCallCount++;
        const simulatedResult = { ...sampleCorrectionResult };
        await setCachedLlmResult(key, {
          result: simulatedResult,
          cachedAt: Date.now(),
          cachedAtIso: new Date().toISOString(),
          model: DEFAULT_GEMINI_MODEL,
          hash,
          callType: 'grading',
          promptVersion: LLM_PROMPT_VERSIONS.grading,
          teacherId: teacherAlpha,
        });
        return simulatedResult;
      }

      // 1. Erster Aufruf: Modell wird aufgerufen
      const firstResult = await executeGradingWithCache();
      expect(modelCallCount).toBe(1);
      expect(firstResult.gesamterzieltePunkte).toBe(4);

      // 2. Zweiter Aufruf mit identischen Parametern: Replay aus Cache, kein Modellaufruf
      const secondResult = await executeGradingWithCache();
      expect(modelCallCount).toBe(1); // Call-Count bleibt unveraendert 1
      expect(secondResult).toEqual(firstResult);
    });
  });

  describe('3. Scope 2: Changed rubric -> new model call', () => {
    it('fuehrt bei veraenderter Musterloesung zu einem neuen Content-Hash und frischem Modellaufruf', async () => {
      const hash1 = computeGradingHash({
        teacherId: teacherAlpha,
        modelName: DEFAULT_GEMINI_MODEL,
        promptVersion: LLM_PROMPT_VERSIONS.grading,
        studentPages: sampleStudentExam,
        rubric: sampleRubric,
      });

      const hash2 = computeGradingHash({
        teacherId: teacherAlpha,
        modelName: DEFAULT_GEMINI_MODEL,
        promptVersion: LLM_PROMPT_VERSIONS.grading,
        studentPages: sampleStudentExam,
        rubric: modifiedRubric,
      });

      expect(hash1).not.toBe(hash2);

      const key1 = buildLlmCacheKey(teacherAlpha, 'grading', hash1);
      const key2 = buildLlmCacheKey(teacherAlpha, 'grading', hash2);

      // Speichere Ergebnis fuer Rubric 1
      await setCachedLlmResult(key1, {
        result: sampleCorrectionResult,
        cachedAt: Date.now(),
        cachedAtIso: new Date().toISOString(),
        model: DEFAULT_GEMINI_MODEL,
        hash: hash1,
        callType: 'grading',
        promptVersion: LLM_PROMPT_VERSIONS.grading,
        teacherId: teacherAlpha,
      });

      // Abfrage fuer geaenderte Rubric (Key 2) ergibt Cache-Miss
      const cachedRubric2 = await getCachedLlmResult(key2);
      expect(cachedRubric2).toBeNull();
    });
  });

  describe('4. Scope 2: Overwrite re-grade -> new model call', () => {
    it('umgeht den Cache bei overwrite = true und erzeugt einen frischen Modellaufruf', async () => {
      const hash = computeGradingHash({
        teacherId: teacherAlpha,
        modelName: DEFAULT_GEMINI_MODEL,
        promptVersion: LLM_PROMPT_VERSIONS.grading,
        studentPages: sampleStudentExam,
        rubric: sampleRubric,
      });
      const key = buildLlmCacheKey(teacherAlpha, 'grading', hash);

      // Initiales Ergebnis im Cache
      await setCachedLlmResult(key, {
        result: sampleCorrectionResult,
        cachedAt: Date.now() - 10000,
        cachedAtIso: new Date(Date.now() - 10000).toISOString(),
        model: DEFAULT_GEMINI_MODEL,
        hash,
        callType: 'grading',
        promptVersion: LLM_PROMPT_VERSIONS.grading,
        teacherId: teacherAlpha,
      });

      let modelCalls = 0;
      async function gradeSubmission(overwrite: boolean) {
        if (!overwrite) {
          const cached = await getCachedLlmResult<ExamCorrectionResult>(key);
          if (cached) return { result: cached.result, fresh: false };
        }
        modelCalls++;
        const freshResult: ExamCorrectionResult = {
          ...sampleCorrectionResult,
          note: '5.5',
        };
        await setCachedLlmResult(key, {
          result: freshResult,
          cachedAt: Date.now(),
          cachedAtIso: new Date().toISOString(),
          model: DEFAULT_GEMINI_MODEL,
          hash,
          callType: 'grading',
          promptVersion: LLM_PROMPT_VERSIONS.grading,
          teacherId: teacherAlpha,
        });
        return { result: freshResult, fresh: true };
      }

      // Normaler Aufruf ohne overwrite verwendet Cache
      const normalCall = await gradeSubmission(false);
      expect(normalCall.fresh).toBe(false);
      expect(modelCalls).toBe(0);

      // Re-Grade mit overwrite = true fuehrt frischen Modellaufruf aus
      const overwriteCall = await gradeSubmission(true);
      expect(overwriteCall.fresh).toBe(true);
      expect(modelCalls).toBe(1);
      expect(overwriteCall.result.note).toBe('5.5');
    });
  });

  describe('5. Scope 3: Tenant Isolation (cross-account identical upload -> no sharing)', () => {
    it('isoliert gecachte Resultate strikt pro Lehrperson, selbst bei identischen Scan-Bytes', async () => {
      const hashAlpha = computeGradingHash({
        teacherId: teacherAlpha,
        modelName: DEFAULT_GEMINI_MODEL,
        promptVersion: LLM_PROMPT_VERSIONS.grading,
        studentPages: sampleStudentExam,
        rubric: sampleRubric,
      });

      const hashBeta = computeGradingHash({
        teacherId: teacherBeta,
        modelName: DEFAULT_GEMINI_MODEL,
        promptVersion: LLM_PROMPT_VERSIONS.grading,
        studentPages: sampleStudentExam,
        rubric: sampleRubric,
      });

      // Content-Hashes sind durch Einbettung der teacherId unterschiedlich
      expect(hashAlpha).not.toBe(hashBeta);

      const keyAlpha = buildLlmCacheKey(teacherAlpha, 'grading', hashAlpha);
      const keyBeta = buildLlmCacheKey(teacherBeta, 'grading', hashBeta);

      // Lehrperson Alpha korrigiert und speichert im Cache
      await setCachedLlmResult(keyAlpha, {
        result: sampleCorrectionResult,
        cachedAt: Date.now(),
        cachedAtIso: new Date().toISOString(),
        model: DEFAULT_GEMINI_MODEL,
        hash: hashAlpha,
        callType: 'grading',
        promptVersion: LLM_PROMPT_VERSIONS.grading,
        teacherId: teacherAlpha,
      });

      // Lehrperson Beta laedt exakt dieselbe Datei hoch -> MUSS null zurueckgeben (kein Sharing)
      const cachedForBeta = await getCachedLlmResult(keyBeta);
      expect(cachedForBeta).toBeNull();

      // Lehrperson Alpha erhaelt ihren Cache
      const cachedForAlpha = await getCachedLlmResult<ExamCorrectionResult>(keyAlpha);
      expect(cachedForAlpha).not.toBeNull();
      expect(cachedForAlpha?.result.schuelerName).toBe('Lukas Keller');
    });
  });

  describe('6. Scan Auto-Identification Caching', () => {
    it('verwendet den Cache bei identischem Scan und identischer Kandidatenliste', async () => {
      const candidates = [
        {
          examId: 'ex-1',
          examTitle: 'Algebra 1',
          subject: 'Mathematik',
          classId: 'c-1',
          className: 'Klasse 3a',
          taskTitles: ['Aufgabe 1'],
          studentNames: ['Lukas Keller', 'Anna Meier'],
        },
      ];

      const mockResponse = {
        text: JSON.stringify({
          matchedExamId: 'ex-1',
          isExamMatchCertain: true,
          extractedStudentName: 'Lukas Keller',
          isStudentNameCertain: true,
        }),
      };
      mockGenerateContent.mockResolvedValue(mockResponse);

      // Erster Aufruf: Fuehrt Gemini-Call aus
      const res1 = await identifyExamAndStudentFromScan(sampleStudentExam, candidates, {
        teacherId: teacherAlpha,
      });

      expect(res1.matchedExamId).toBe('ex-1');
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);

      // Zweiter Aufruf: Identischer Scan & Kandidaten -> Replay aus Cache
      const res2 = await identifyExamAndStudentFromScan(sampleStudentExam, candidates, {
        teacherId: teacherAlpha,
      });

      expect(res2.matchedExamId).toBe('ex-1');
      expect(mockGenerateContent).toHaveBeenCalledTimes(1); // Immer noch 1!

      // Aufruf mit bypassCache: Frischer Modellaufruf
      const res3 = await identifyExamAndStudentFromScan(sampleStudentExam, candidates, {
        teacherId: teacherAlpha,
        bypassCache: true,
      });

      expect(res3.matchedExamId).toBe('ex-1');
      expect(mockGenerateContent).toHaveBeenCalledTimes(2); // Jetzt 2!
    });
  });

  describe('7. Rubric Parsing Cache', () => {
    it('berechnet reproduzierbare Hashes fuer identische Musterloesungen', () => {
      const hash1 = computeRubricParseHash({
        teacherId: teacherAlpha,
        modelName: DEFAULT_GEMINI_MODEL,
        promptVersion: LLM_PROMPT_VERSIONS.rubricParse,
        rubricText: sampleRubric,
      });

      const hash2 = computeRubricParseHash({
        teacherId: teacherAlpha,
        modelName: DEFAULT_GEMINI_MODEL,
        promptVersion: LLM_PROMPT_VERSIONS.rubricParse,
        rubricText: sampleRubric,
      });

      expect(hash1).toBe(hash2);

      const hashModified = computeRubricParseHash({
        teacherId: teacherAlpha,
        modelName: DEFAULT_GEMINI_MODEL,
        promptVersion: LLM_PROMPT_VERSIONS.rubricParse,
        rubricText: modifiedRubric,
      });

      expect(hash1).not.toBe(hashModified);
    });
  });

  describe('8. Safety Constraints: Errors and Partial Results are never cached', () => {
    it('speichert keine fehlerhaften Aufrufe im Cache', async () => {
      const candidates = [
        {
          examId: 'ex-1',
          examTitle: 'Algebra 1',
          subject: 'Mathematik',
          classId: 'c-1',
          className: 'Klasse 3a',
          taskTitles: ['Aufgabe 1'],
          studentNames: ['Lukas Keller'],
        },
      ];

      // Gemini schlaegt fehl (z. B. Netzwerk-/Quota-Fehler)
      mockGenerateContent.mockRejectedValueOnce(new Error('Gemini Quota Exceeded'));

      const res = await identifyExamAndStudentFromScan(sampleStudentExam, candidates, {
        teacherId: teacherAlpha,
      });

      expect(res.isExamMatchCertain).toBe(false);

      // Verifiziere, dass im Cache kein Eintrag hinterlegt wurde
      const hash = computeScanIdentificationHash({
        teacherId: teacherAlpha,
        modelName: DEFAULT_GEMINI_MODEL,
        promptVersion: LLM_PROMPT_VERSIONS.scanIdentification,
        pages: sampleStudentExam,
        candidates,
      });
      const key = buildLlmCacheKey(teacherAlpha, 'scan_identification', hash);
      const cached = await getCachedLlmResult(key);

      expect(cached).toBeNull();
    });
  });

  describe('9. Metadata Integrity & Audit Recording', () => {
    it('speichert Modellname und Erstellungszeitstempel zuverlaessig im Cache-Eintrag', async () => {
      const hash = computeGradingHash({
        teacherId: teacherAlpha,
        modelName: DEFAULT_GEMINI_MODEL,
        promptVersion: LLM_PROMPT_VERSIONS.grading,
        studentPages: sampleStudentExam,
        rubric: sampleRubric,
      });
      const key = buildLlmCacheKey(teacherAlpha, 'grading', hash);

      const before = Date.now();
      const entry: LlmCacheEntry<ExamCorrectionResult> = {
        result: sampleCorrectionResult,
        cachedAt: Date.now(),
        cachedAtIso: new Date().toISOString(),
        model: DEFAULT_GEMINI_MODEL,
        hash,
        callType: 'grading',
        promptVersion: LLM_PROMPT_VERSIONS.grading,
        teacherId: teacherAlpha,
      };

      await setCachedLlmResult(key, entry);
      const loaded = await getCachedLlmResult<ExamCorrectionResult>(key);

      expect(loaded).not.toBeNull();
      expect(loaded?.model).toBe(DEFAULT_GEMINI_MODEL);
      expect(loaded?.cachedAt).toBeGreaterThanOrEqual(before);
      expect(loaded?.callType).toBe('grading');
      expect(loaded?.teacherId).toBe(teacherAlpha);
    });
  });
});
