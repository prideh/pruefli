import { describe, it, expect, vi, beforeEach } from 'vitest';

const { generateContentStreamMock } = vi.hoisted(() => ({
  generateContentStreamMock: vi.fn(),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContentStream: generateContentStreamMock,
    },
  })),
  Type: {
    OBJECT: 'OBJECT',
    STRING: 'STRING',
    NUMBER: 'NUMBER',
    BOOLEAN: 'BOOLEAN',
    ARRAY: 'ARRAY',
  },
  ThinkingLevel: {
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
  },
}));

import { getSubjectFocusInstruction, runLiveGeminiCorrection } from '@/lib/gemini';

describe('Issue #91: Physik-Korrektur 90-s-Timeout Root-Cause Fix', () => {
  beforeEach(() => {
    generateContentStreamMock.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  it('unterordnet in FACHFOKUS PHYSIK den 0.5-Punkte-Einheitenabzug explizit der Musterloesung (verhindert Widerspruch bei Einheit 1 P.)', () => {
    const physikPrompt = getSubjectFocusInstruction('Physik');
    expect(physikPrompt).toContain('FACHFOKUS PHYSIK:');
    expect(physikPrompt).toContain('Musterlösung');
    expect(physikPrompt).toContain('explizite Punkteverteilung für die Einheit');
    expect(physikPrompt).not.toMatch(/\u00df/);
  });

  it('verwendet ThinkingLevel.LOW bei runLiveGeminiCorrection und wiederholt automatisch bei einem 90-s-Timeout ohne festen Seed', async () => {
    const validPhysicsResponse = {
      referenzTranskript:
        'Aufgabe 1 (4 P.): v = s/t mit s = 100 m, t = 20 s -> 5 m/s; Teilpunkte: Formel 1, Einsetzen 1, Ergebnis 1, Einheit 1.',
      schuelerName: 'Lukas Keller',
      istNameUnsicher: false,
      fach: 'Physik',
      datum: '02.11.2026',
      gesamterzieltePunkte: 3,
      gesamtmaximalPunkte: 4,
      note: '4.8',
      aufgaben: [
        {
          aufgabeId: '1',
          titel: 'Aufgabe 1',
          schuelerAntwort: 'v = s/t\nv = 100 / 20\nv = 5',
          erzieltePunkte: 3,
          maximalPunkte: 4,
          status: 'Fehler',
          lehrerKommentar: 'Formel, Einsetzen und Zahlenwert korrekt; Einheit m/s fehlt.',
          schritte: [
            {
              schrittIndex: 0,
              schrittText: 'v = s/t',
              istKorrekt: true,
              fehlerTyp: 'KeinFehler',
              erreichtePunkte: 1,
              maximalPunkte: 1,
              begruendung: 'Physikalische Formel korrekt aufgestellt.',
              istUnsicher: false,
              unsicherheitsGrund: '',
            },
            {
              schrittIndex: 1,
              schrittText: 'v = 100 / 20',
              istKorrekt: true,
              fehlerTyp: 'KeinFehler',
              erreichtePunkte: 1,
              maximalPunkte: 1,
              begruendung: 'Werte korrekt eingesetzt.',
              istUnsicher: false,
              unsicherheitsGrund: '',
            },
            {
              schrittIndex: 2,
              schrittText: 'v = 5',
              istKorrekt: true,
              fehlerTyp: 'KeinFehler',
              erreichtePunkte: 1,
              maximalPunkte: 1,
              begruendung: 'Zahlenwert 5 korrekt berechnet.',
              istUnsicher: false,
              unsicherheitsGrund: '',
            },
            {
              schrittIndex: 3,
              schrittText: 'Einheit fehlt',
              istKorrekt: false,
              fehlerTyp: 'SonstigerFehler',
              erreichtePunkte: 0,
              maximalPunkte: 1,
              begruendung:
                'Die physikalische Einheit m/s fehlt im Endresultat. Daher keine Punkte für diesen Teilschritt (1 Punkt Abzug).',
              istUnsicher: false,
              unsicherheitsGrund: '',
            },
          ],
        },
      ],
      schuelerFeedback: {
        staerken: ['Korrekte Anwendung der Geschwindigkeitsformel v = s/t.'],
        schwaechen: ['Physikalische Einheit im Endergebnis vergessen.'],
        hilfreicherTipp: 'Schreibe bei Physikaufgaben immer die Einheit (z. B. m/s) zum Ergebnis.',
        uebungsEmpfehlung: 'Übe Aufgaben zur gleichförmigen Bewegung mit Einheitenkontrolle.',
      },
    };

    const timeoutErr = new Error('The operation was aborted due to timeout');
    timeoutErr.name = 'AbortError';

    generateContentStreamMock.mockRejectedValueOnce(timeoutErr).mockImplementationOnce(async () => {
      async function* streamGenerator() {
        yield { text: JSON.stringify(validPhysicsResponse) };
      }
      return streamGenerator();
    });

    const result = await runLiveGeminiCorrection(
      'ZmFrZS1pbWFnZQ==',
      'Aufgabe 1 (4 P.): v = s/t mit s = 100 m, t = 20 s -> 5 m/s; Teilpunkte: Formel 1, Einsetzen 1, Ergebnis 1, Einheit 1.',
      undefined,
      'test-api-key',
      'image/jpeg',
      [{ taskId: '1', title: 'Aufgabe 1', maxPoints: 4 }],
      'Physik'
    );

    expect(generateContentStreamMock).toHaveBeenCalledTimes(2);

    const firstCallConfig = generateContentStreamMock.mock.calls[0][0].config;
    expect(firstCallConfig.thinkingConfig.thinkingLevel).toBe('LOW');
    expect(firstCallConfig.seed).toBe(42);

    const secondCallConfig = generateContentStreamMock.mock.calls[1][0].config;
    expect(secondCallConfig.thinkingConfig.thinkingLevel).toBe('LOW');
    expect(secondCallConfig.seed).toBeUndefined();

    expect(result.gesamterzieltePunkte).toBe(3);
    expect(result.gesamtmaximalPunkte).toBe(4);
    expect(result.aufgaben[0].schritte).toHaveLength(4);
  });
});
