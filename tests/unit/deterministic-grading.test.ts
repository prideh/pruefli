import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runLiveGeminiCorrection,
  enforceStepFeedbackConsistency,
  DEFAULT_GEMINI_MODEL,
  buildGradingGenerationConfig,
  type ExamCorrectionResult,
  type CorrectedTask,
} from '@/lib/gemini';
import {
  computeGradingHash,
  computeGradingCacheKey,
  setCachedGradingResult,
  getCachedLlmResult,
  clearLlmCache,
  buildGradingExecutionConfig,
  DEFAULT_GRADING_EXECUTION_CONFIG,
  LLM_PROMPT_VERSIONS,
} from '@/lib/llm-cache';

// Mock @google/genai SDK to inspect call configurations and retry behavior
const mockGenerateContent = vi.fn();
const mockGenerateContentStream = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: mockGenerateContent,
        generateContentStream: mockGenerateContentStream,
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

describe('Deterministische KI-Korrektur & Wiederholbarkeit (Issue #93 & #94)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await clearLlmCache();
    process.env.GEMINI_API_KEY = 'test-mock-api-key';
  });

  describe('1. Execution Configuration & Cache Invalidation', () => {
    it('verankert thinkingLevel, temperature, seed und attempt im Standard-Ausfuehrungs-Config', () => {
      expect(DEFAULT_GRADING_EXECUTION_CONFIG.thinkingLevel).toBe('LOW');
      expect(DEFAULT_GRADING_EXECUTION_CONFIG.temperature).toBe(0.0);
      expect(DEFAULT_GRADING_EXECUTION_CONFIG.seed).toBe(42);
      expect(DEFAULT_GRADING_EXECUTION_CONFIG.attempt).toBe(1);
    });

    it('baut Request-Konfiguration und Cache-Key-Konfiguration aus derselben Quelle (Single Source of Truth)', () => {
      // Versuch 1 (seeded)
      const execConfig1 = buildGradingExecutionConfig(1);
      const genConfig1 = buildGradingGenerationConfig(1);
      expect(execConfig1.thinkingLevel).toBe(DEFAULT_GRADING_EXECUTION_CONFIG.thinkingLevel);
      expect(execConfig1.temperature).toBe(DEFAULT_GRADING_EXECUTION_CONFIG.temperature);
      expect(execConfig1.seed).toBe(DEFAULT_GRADING_EXECUTION_CONFIG.seed);
      expect(execConfig1.attempt).toBe(1);
      expect(genConfig1.thinkingConfig.thinkingLevel).toBe(execConfig1.thinkingLevel);
      expect(genConfig1.temperature).toBe(execConfig1.temperature);
      expect(genConfig1.seed).toBe(execConfig1.seed);

      // Versuch 2 (unseeded Retry)
      const execConfig2 = buildGradingExecutionConfig(2);
      const genConfig2 = buildGradingGenerationConfig(2);
      expect(execConfig2.thinkingLevel).toBe(DEFAULT_GRADING_EXECUTION_CONFIG.thinkingLevel);
      expect(execConfig2.temperature).toBe(DEFAULT_GRADING_EXECUTION_CONFIG.temperature);
      expect(execConfig2.seed).toBeNull();
      expect(execConfig2.attempt).toBe(2);
      expect(genConfig2.thinkingConfig.thinkingLevel).toBe(execConfig2.thinkingLevel);
      expect(genConfig2.temperature).toBe(execConfig2.temperature);
      expect(genConfig2.seed).toBeUndefined();
    });

    it('erzeugt reproduzierbare Hashes fuer identische Eingaben und Parameter', () => {
      const params = {
        teacherId: 'teacher-1',
        modelName: DEFAULT_GEMINI_MODEL,
        studentPages: [{ mimeType: 'image/jpeg', data: 'EXAM_PAGE_1' }],
        rubric: 'Aufgabe 1: 2+2=4 (2 Punkte)',
      };

      const hash1 = computeGradingHash(params);
      const hash2 = computeGradingHash(params);
      expect(hash1).toBe(hash2);
    });

    it('reagiert mit neuem Hash auf jede Aenderung von thinkingLevel, seed oder temperature', () => {
      const base = {
        teacherId: 'teacher-1',
        modelName: DEFAULT_GEMINI_MODEL,
        studentPages: [{ mimeType: 'image/jpeg', data: 'EXAM_PAGE_1' }],
        rubric: 'Aufgabe 1: 2+2=4 (2 Punkte)',
      };

      const hBase = computeGradingHash(base);
      const hHigh = computeGradingHash({
        ...base,
        executionConfig: { thinkingLevel: 'HIGH' },
      });
      const hSeed = computeGradingHash({
        ...base,
        executionConfig: { seed: 100 },
      });
      const hTemp = computeGradingHash({
        ...base,
        executionConfig: { temperature: 0.2 },
      });

      expect(hBase).not.toBe(hHigh);
      expect(hBase).not.toBe(hSeed);
      expect(hBase).not.toBe(hTemp);
    });
  });

  describe('2. Seed & Temperature Consistency in Gemini Calls (incl. Retries)', () => {
    it('uebergibt seed: 42 und temperature: 0.0 im Initialaufruf von runLiveGeminiCorrection', async () => {
      const sampleResponse: ExamCorrectionResult = {
        referenzTranskript: '1. 2+2=4',
        schuelerName: 'Max Muster',
        istNameUnsicher: false,
        fach: 'Mathematik',
        datum: '2026-11-02',
        gesamterzieltePunkte: 2,
        gesamtmaximalPunkte: 2,
        note: '6.0',
        aufgaben: [
          {
            aufgabeId: '1',
            titel: 'Aufgabe 1',
            schuelerAntwort: '2+2 = 4',
            erzieltePunkte: 2,
            maximalPunkte: 2,
            status: 'Korrekt',
            lehrerKommentar: 'Korrekt gerechnet.',
            schritte: [
              {
                schrittIndex: 1,
                schrittText: '2+2=4',
                istKorrekt: true,
                fehlerTyp: 'KeinFehler',
                erreichtePunkte: 2,
                maximalPunkte: 2,
                begruendung: 'Vollstaendig richtig.',
              },
            ],
          },
        ],
        schuelerFeedback: {
          staerken: ['Zuverlaessige Grundrechenarten'],
          schwaechen: [],
          hilfreicherTipp: 'Weiter so!',
          uebungsEmpfehlung: 'Additionen vertiefen',
        },
      };

      // Simuliere erfolgreichen Stream
      mockGenerateContentStream.mockResolvedValueOnce({
        async *[Symbol.asyncIterator]() {
          yield { text: JSON.stringify(sampleResponse) };
        },
      });

      const correctionResult = await runLiveGeminiCorrection('BASE64_IMAGE', 'Rubric: 2+2=4');

      expect(mockGenerateContentStream).toHaveBeenCalledTimes(1);
      const callArgs = mockGenerateContentStream.mock.calls[0][0];
      const expectedGenConfig1 = buildGradingGenerationConfig(1);
      expect(callArgs.config.temperature).toBe(expectedGenConfig1.temperature);
      expect(callArgs.config.seed).toBe(expectedGenConfig1.seed);
      expect(callArgs.config.thinkingConfig.thinkingLevel).toBe(
        expectedGenConfig1.thinkingConfig.thinkingLevel
      );
      expect(correctionResult.attempt).toBe(1);
      expect(correctionResult.executionConfig?.seed).toBe(42);
    });

    it('uebergibt seed: 42 in Versuch 1 und laeuft bei transientem Retry (attempt 2) gemaess Issue #91/93/94 unseeded', async () => {
      const sampleResponse: ExamCorrectionResult = {
        referenzTranskript: '1. 2+2=4',
        schuelerName: 'Max Muster',
        istNameUnsicher: false,
        fach: 'Mathematik',
        datum: '2026-11-02',
        gesamterzieltePunkte: 2,
        gesamtmaximalPunkte: 2,
        note: '6.0',
        aufgaben: [
          {
            aufgabeId: '1',
            titel: 'Aufgabe 1',
            schuelerAntwort: '2+2 = 4',
            erzieltePunkte: 2,
            maximalPunkte: 2,
            status: 'Korrekt',
            lehrerKommentar: 'Korrekt.',
            schritte: [
              {
                schrittIndex: 1,
                schrittText: '2+2=4',
                istKorrekt: true,
                fehlerTyp: 'KeinFehler',
                erreichtePunkte: 2,
                maximalPunkte: 2,
                begruendung: 'Richtig.',
              },
            ],
          },
        ],
        schuelerFeedback: {
          staerken: ['Gut'],
          schwaechen: [],
          hilfreicherTipp: 'Tipp',
          uebungsEmpfehlung: 'Uebung',
        },
      };

      // 1. Aufruf scheitert an transientem Timeout
      const timeoutError = Object.assign(new Error('Headers Timeout'), {
        name: 'HeadersTimeoutError',
        code: 'UND_ERR_HEADERS_TIMEOUT',
      });
      mockGenerateContentStream.mockRejectedValueOnce(timeoutError);

      // 2. Aufruf (Retry) gelingt
      mockGenerateContentStream.mockResolvedValueOnce({
        async *[Symbol.asyncIterator]() {
          yield { text: JSON.stringify(sampleResponse) };
        },
      });

      const correctionResult = await runLiveGeminiCorrection('BASE64_IMAGE', 'Rubric: 2+2=4');

      expect(mockGenerateContentStream).toHaveBeenCalledTimes(2);

      // Versuch 1 nutzt seed: 42; Versuch 2 (Retry) laeuft unseeded (#91 / #93 / #94)
      const attempt1Config = mockGenerateContentStream.mock.calls[0][0].config;
      const attempt2Config = mockGenerateContentStream.mock.calls[1][0].config;
      const expectedGenConfig1 = buildGradingGenerationConfig(1);
      const expectedGenConfig2 = buildGradingGenerationConfig(2);

      expect(attempt1Config.seed).toBe(expectedGenConfig1.seed);
      expect(attempt1Config.temperature).toBe(expectedGenConfig1.temperature);
      expect(attempt1Config.thinkingConfig.thinkingLevel).toBe(
        expectedGenConfig1.thinkingConfig.thinkingLevel
      );

      expect(attempt2Config.seed).toBeUndefined();
      expect(attempt2Config.temperature).toBe(expectedGenConfig2.temperature);
      expect(attempt2Config.thinkingConfig.thinkingLevel).toBe(
        expectedGenConfig2.thinkingConfig.thinkingLevel
      );

      // Das Rueckgabe-Objekt vermerkt wahrheitsgemaess Versuch 2 und die unseeded Konfiguration
      expect(correctionResult.attempt).toBe(2);
      expect(correctionResult.executionConfig?.seed).toBeNull();
      expect(correctionResult.executionConfig?.attempt).toBe(2);
    });
  });

  describe('2b. Ehrliche Schluessel- und Cache-Eintragstrennung (Defekt 2 aus Issue #94)', () => {
    it('unterscheidet den Cache-Key strikt zwischen seeded Versuch 1 und unseeded Versuch 2', () => {
      const baseParams = {
        teacherId: 'teacher-1',
        modelName: DEFAULT_GEMINI_MODEL,
        studentPages: [{ mimeType: 'image/jpeg', data: 'EXAM_PAGE_1' }],
        rubric: 'Aufgabe 1: 2+2=4 (2 Punkte)',
      };

      const hashAttempt1 = computeGradingHash({
        ...baseParams,
        executionConfig: buildGradingExecutionConfig(1),
      });
      const hashAttempt2 = computeGradingHash({
        ...baseParams,
        executionConfig: buildGradingExecutionConfig(2),
      });

      // Die Hashes muessen zwingend voneinander abweichen
      expect(hashAttempt1).not.toBe(hashAttempt2);

      // Default-Aufruf ohne explizites executionConfig entspricht deterministisch Versuch 1
      const defaultHash = computeGradingHash(baseParams);
      expect(defaultHash).toBe(hashAttempt1);
    });

    it('speichert und liest Cache-Eintraege ehrlich getrennt nach tatsaechlich produzierendem Versuch', async () => {
      const studentPages = [{ mimeType: 'image/jpeg', data: 'EXAM_PAGE_PAGE_A' }];
      const baseOptions = {
        teacherId: 'teacher-42',
        modelName: DEFAULT_GEMINI_MODEL,
        studentPages,
        rubric: 'Musterloesung: 5+5=10',
      };

      const mockResultAttempt2: ExamCorrectionResult = {
        schuelerName: 'Lisa Muster',
        fach: 'Mathematik',
        datum: '2026-11-02',
        gesamterzieltePunkte: 2,
        gesamtmaximalPunkte: 2,
        note: '6.0',
        attempt: 2,
        executionConfig: buildGradingExecutionConfig(2),
        aufgaben: [],
        schuelerFeedback: {
          staerken: [],
          schwaechen: [],
          hilfreicherTipp: '',
          uebungsEmpfehlung: '',
        },
      };

      // Speichere das Ergebnis eines unseeded Retrys via setCachedGradingResult
      const { cacheKey: retryKey, hash: retryHash } = await setCachedGradingResult({
        ...baseOptions,
        result: mockResultAttempt2,
      });

      // 1. Der Cache-Key des Retrys darf NICHT dem Key von Versuch 1 entsprechen
      const { cacheKey: initialAttemptKey } = computeGradingCacheKey({
        ...baseOptions,
        attempt: 1,
      });
      expect(retryKey).not.toBe(initialAttemptKey);

      // 2. Ein spaeterer Cache-Lookup fuer den intendierten Versuch 1 (seeded) bleibt ein Cache-Miss!
      // Es wird NIEMALS faelschlich das unseeded Retry-Ergebnis als seeded ausgegeben.
      const lookupAttempt1 = await getCachedLlmResult<ExamCorrectionResult>(initialAttemptKey);
      expect(lookupAttempt1).toBeNull();

      // 3. Unter dem ehrlichen Retry-Key ist der Eintrag mit attempt: 2 und seed: null auffindbar
      const lookupRetry = await getCachedLlmResult<ExamCorrectionResult>(retryKey);
      expect(lookupRetry).not.toBeNull();
      expect(lookupRetry?.attempt).toBe(2);
      expect(lookupRetry?.executionConfig?.seed).toBeNull();
      expect(lookupRetry?.hash).toBe(retryHash);
    });
  });

  describe('3. Mathematical Point Normalization in enforceStepFeedbackConsistency', () => {
    it('normalisiert Aufgabenpunkte und Gesamtpunkte deterministisch auf die exakte Summe der Teilschritte', () => {
      const rawResult: ExamCorrectionResult = {
        schuelerName: 'Anna Meier',
        fach: 'Mathematik',
        datum: '2026-11-02',
        // Modell hat irrtuemlich abweichende erzielte Punkte berechnet
        gesamterzieltePunkte: 10,
        gesamtmaximalPunkte: 7,
        note: '6.0',
        aufgaben: [
          {
            aufgabeId: '1',
            titel: 'Aufgabe 1',
            schuelerAntwort: 'Schritt 1 + Schritt 2',
            erzieltePunkte: 5, // Falsch: Summe der Schritte ist 1.5 + 2.0 = 3.5
            maximalPunkte: 4,
            status: 'Fehler',
            lehrerKommentar: 'Teilweise korrekt.',
            schritte: [
              {
                schrittIndex: 1,
                schrittText: 'Schritt 1',
                istKorrekt: false,
                fehlerTyp: 'Rechenfehler',
                erreichtePunkte: 1.5,
                maximalPunkte: 2.0,
                begruendung: 'Leichter Rechenfehler.',
              },
              {
                schrittIndex: 2,
                schrittText: 'Schritt 2',
                istKorrekt: true,
                fehlerTyp: 'Folgefehler',
                erreichtePunkte: 2.0,
                maximalPunkte: 2.0,
                begruendung: 'Folgefehler korrekt weitergerechnet.',
              },
            ],
          },
          {
            aufgabeId: '2',
            titel: 'Aufgabe 2',
            schuelerAntwort: 'Schritt 1',
            erzieltePunkte: 0,
            maximalPunkte: 3,
            status: 'Fehler',
            lehrerKommentar: 'Nicht bearbeitet.',
            schritte: [
              {
                schrittIndex: 1,
                schrittText: 'Keine Bearbeitung',
                istKorrekt: false,
                fehlerTyp: 'SonstigerFehler',
                erreichtePunkte: 0,
                maximalPunkte: 3,
                begruendung: 'Keine Loesung vorhanden.',
              },
            ],
          },
        ],
        schuelerFeedback: {
          staerken: ['Guter Ansatz'],
          schwaechen: ['Aufgabe 2 fehlt'],
          hilfreicherTipp: 'Alle Aufgaben bearbeiten',
          uebungsEmpfehlung: 'Zeitmanagement',
        },
      };

      const normalized = enforceStepFeedbackConsistency(rawResult);

      // Aufgabe 1: 1.5 + 2.0 = 3.5 Punkte
      expect(normalized.aufgaben[0].erzieltePunkte).toBe(3.5);
      expect(normalized.aufgaben[0].status).toBe('Folgefehler');

      // Aufgabe 2: 0 Punkte
      expect(normalized.aufgaben[1].erzieltePunkte).toBe(0);

      // Gesamterzielte Punkte: 3.5 + 0 = 3.5 Punkte
      expect(normalized.gesamterzieltePunkte).toBe(3.5);

      // Gesamtmaximalpunkte: 4 + 3 = 7 Punkte
      expect(normalized.gesamtmaximalPunkte).toBe(7);

      // Schweizer Note (LINEAR_60): 1 + 5 * (3.5 / 7) = 1 + 2.5 = 3.5
      expect(normalized.note).toBe('3.5');
    });

    it('erhaelt die Schweizer Rechtschreibung (strikt "ss", kein "ß") in allen Feedbackfeldern', () => {
      const task: CorrectedTask = {
        aufgabeId: '1',
        titel: 'Aufgabe 1',
        schuelerAntwort: 'Test',
        erzieltePunkte: 1,
        maximalPunkte: 2,
        status: 'Fehler',
        lehrerKommentar: 'Korrektur mit Fleiss durchgeführt.',
        schritte: [
          {
            schrittIndex: 1,
            schrittText: 'Schritt 1',
            istKorrekt: false,
            fehlerTyp: 'Rechenfehler',
            erreichtePunkte: 1,
            maximalPunkte: 2,
            begruendung: 'Nicht ganz schliesslich gelöst.',
          },
        ],
      };

      const result: ExamCorrectionResult = {
        schuelerName: 'Lukas',
        fach: 'Mathematik',
        datum: '2026-11-02',
        gesamterzieltePunkte: 1,
        gesamtmaximalPunkte: 2,
        note: '3.5',
        aufgaben: [task],
        schuelerFeedback: {
          staerken: ['Grosser Einsatz'],
          schwaechen: [],
          hilfreicherTipp: 'Massstab beachten',
          uebungsEmpfehlung: 'Regelmässig üben',
        },
      };

      const normalized = enforceStepFeedbackConsistency(result);
      const jsonString = JSON.stringify(normalized);
      expect(jsonString).not.toMatch(/\u00df/);
    });
  });
});
