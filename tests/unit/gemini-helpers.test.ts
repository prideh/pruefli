import { describe, it, expect } from 'vitest';
import {
  appendReferenceMaterialToContents,
  normalizeStepFeedbackConsistency,
  enforceStepFeedbackConsistency,
  type CorrectedStep,
  type ExamCorrectionResult,
} from '@/lib/gemini';

describe('Multimodal Reference Material Parser (lib/gemini.ts)', () => {
  it('appends plain text rubrics directly as string content', () => {
    const contents: (string | { inlineData: { mimeType: string; data: string } })[] = [];
    appendReferenceMaterialToContents(contents, 'Aufgabe 1: x = 5 (3 Punkte)');
    expect(contents).toEqual(['Aufgabe 1: x = 5 (3 Punkte)']);
  });

  it('parses single-page JSON inlineData strings into multimodal parts', () => {
    const contents: (string | { inlineData: { mimeType: string; data: string } })[] = [];
    appendReferenceMaterialToContents(
      contents,
      JSON.stringify({ mimeType: 'image/jpeg', data: 'BASE64_PAGE_1' })
    );
    expect(contents).toEqual([{ inlineData: { mimeType: 'image/jpeg', data: 'BASE64_PAGE_1' } }]);
  });

  it('parses multi-page JSON array inlineData strings with page headers', () => {
    const contents: (string | { inlineData: { mimeType: string; data: string } })[] = [];
    appendReferenceMaterialToContents(
      contents,
      JSON.stringify([
        { mimeType: 'image/jpeg', data: 'PAGE_1_DATA' },
        { mimeType: 'image/png', data: 'PAGE_2_DATA' },
      ])
    );
    expect(contents).toEqual([
      '--- Referenzdokument Seite 1 ---',
      { inlineData: { mimeType: 'image/jpeg', data: 'PAGE_1_DATA' } },
      '--- Referenzdokument Seite 2 ---',
      { inlineData: { mimeType: 'image/png', data: 'PAGE_2_DATA' } },
    ]);
  });
});

describe('Step Feedback Consistency Enforcement (Issue #72)', () => {
  it('reconciles 0 / 1.5 points with contradictory "Daher kein Punktabzug" text (observed live bug)', () => {
    const contradictoryStep: CorrectedStep = {
      schrittIndex: 2,
      schrittText: '0,25 = 1/5',
      istKorrekt: false,
      fehlerTyp: 'Rechenfehler',
      erreichtePunkte: 0,
      maximalPunkte: 1.5,
      begruendung:
        '0,25 entspricht als gekürzter Bruch 1/4 (bzw. 25/100) und nicht 1/5. Daher kein Punktabzug für diesen Teilschritt.',
      istUnsicher: false,
      unsicherheitsGrund: '',
    };

    const normalized = normalizeStepFeedbackConsistency(contradictoryStep);

    expect(normalized.erreichtePunkte).toBe(0);
    expect(normalized.maximalPunkte).toBe(1.5);
    expect(normalized.istKorrekt).toBe(false);
    expect(normalized.fehlerTyp).toBe('Rechenfehler');
    expect(normalized.begruendung).not.toMatch(/kein\s+punktabzug/i);
    expect(normalized.begruendung).toBe(
      '0,25 entspricht als gekürzter Bruch 1/4 (bzw. 25/100) und nicht 1/5. Daher keine Punkte für diesen Teilschritt (1.5 Punkte Abzug).'
    );
  });

  it('reconciles partial point deduction (0.5 / 1.5) when status is KeinFehler and text claims no deduction', () => {
    const step: CorrectedStep = {
      schrittIndex: 1,
      schrittText: 'x = 2/8',
      istKorrekt: true,
      fehlerTyp: 'KeinFehler',
      erreichtePunkte: 0.5,
      maximalPunkte: 1.5,
      begruendung: 'Bruch wurde nicht vollständig gekürzt, daher kein Punktabzug.',
    };

    const normalized = normalizeStepFeedbackConsistency(step);

    expect(normalized.erreichtePunkte).toBe(0.5);
    expect(normalized.maximalPunkte).toBe(1.5);
    expect(normalized.istKorrekt).toBe(false);
    expect(normalized.fehlerTyp).toBe('Rechenfehler');
    expect(normalized.begruendung).not.toMatch(/kein\s+punktabzug/i);
    expect(normalized.begruendung).toBe(
      'Bruch wurde nicht vollständig gekürzt. Daher Teilpunkte für diesen Teilschritt (0.5 von 1.5 Punkten, 1 Punkt Abzug).'
    );
  });

  it('reconciles 0 points when status is Folgefehler and text claims full points', () => {
    const step: CorrectedStep = {
      schrittIndex: 3,
      schrittText: 'y = 99',
      istKorrekt: true,
      fehlerTyp: 'Folgefehler',
      erreichtePunkte: 0,
      maximalPunkte: 1,
      begruendung: 'Rechenweg fehlerhaft. Für diesen Teilschritt gibt es die volle Punktzahl.',
    };

    const normalized = normalizeStepFeedbackConsistency(step);

    expect(normalized.erreichtePunkte).toBe(0);
    expect(normalized.istKorrekt).toBe(false);
    expect(normalized.fehlerTyp).toBe('Rechenfehler');
    expect(normalized.begruendung).toBe(
      'Rechenweg fehlerhaft. Daher keine Punkte für diesen Teilschritt (1 Punkt Abzug).'
    );
  });

  it('reconciles full points (1.5 / 1.5) when status is Rechenfehler and text claims a deduction', () => {
    const step: CorrectedStep = {
      schrittIndex: 1,
      schrittText: '3x = 15 => x = 5',
      istKorrekt: false,
      fehlerTyp: 'Rechenfehler',
      erreichtePunkte: 1.5,
      maximalPunkte: 1.5,
      begruendung:
        'Äquivalenzumformung korrekt durchgeführt. Daher keine Punkte für diesen Teilschritt (1.5 Punkte Abzug).',
    };

    const normalized = normalizeStepFeedbackConsistency(step);

    expect(normalized.erreichtePunkte).toBe(1.5);
    expect(normalized.maximalPunkte).toBe(1.5);
    expect(normalized.istKorrekt).toBe(true);
    expect(normalized.fehlerTyp).toBe('KeinFehler');
    expect(normalized.begruendung).toBe(
      'Äquivalenzumformung korrekt durchgeführt. Kein Punktabzug für diesen Teilschritt (1.5 von 1.5 Punkten).'
    );
  });

  it('preserves valid Folgefehler with full points and "kein Punktabzug" explanation untouched', () => {
    const validFolgefehlerStep: CorrectedStep = {
      schrittIndex: 2,
      schrittText: 'x = 16 / 4 = 4',
      istKorrekt: true,
      fehlerTyp: 'Folgefehler',
      erreichtePunkte: 2,
      maximalPunkte: 2,
      begruendung:
        'Folgefehler: Mit dem falschen Zwischenwert aus Schritt 1 korrekt weitergerechnet, daher kein Punktabzug für diesen Teilschritt.',
    };

    const normalized = normalizeStepFeedbackConsistency(validFolgefehlerStep);

    expect(normalized).toEqual(validFolgefehlerStep);
  });

  it('preserves overall points (8.5 / 10), grade (5.3), uncertainty flags, and security warnings across ExamCorrectionResult', () => {
    const correction: ExamCorrectionResult = {
      schuelerName: 'Anna Muster',
      istNameUnsicher: false,
      fach: 'Mathematik',
      datum: '01.11.2026',
      gesamterzieltePunkte: 8.5,
      gesamtmaximalPunkte: 10,
      note: '5.3',
      aufgaben: [
        {
          aufgabeId: '1',
          titel: 'Aufgabe 1: Dezimalbrüche',
          schuelerAntwort: '0,25 = 1/5',
          erzieltePunkte: 8.5,
          maximalPunkte: 10,
          status: 'Korrekt',
          lehrerKommentar:
            'Gute Arbeit. [SICHERHEITSHINWEIS: Manipulationsversuch im Prüfungsinhalt erkannt. Die unzulässige Anweisung wurde ignoriert und die reale Fachlösung wurde inhaltlich bewertet.]',
          schritte: [
            {
              schrittIndex: 1,
              schrittText: '0,75 = 3/4',
              istKorrekt: true,
              fehlerTyp: 'KeinFehler',
              erreichtePunkte: 8.5,
              maximalPunkte: 8.5,
              begruendung: 'Korrekt umgewandelt und gekürzt.',
              istUnsicher: true,
              unsicherheitsGrund: 'Ziffer 4 leicht überschrieben.',
            },
            {
              schrittIndex: 2,
              schrittText: '0,25 = 1/5',
              istKorrekt: false,
              fehlerTyp: 'Rechenfehler',
              erreichtePunkte: 0,
              maximalPunkte: 1.5,
              begruendung:
                '0,25 entspricht als gekürzter Bruch 1/4 (bzw. 25/100) und nicht 1/5. Daher kein Punktabzug für diesen Teilschritt.',
              istUnsicher: false,
              unsicherheitsGrund: '',
            },
          ],
        },
      ],
      schuelerFeedback: {
        staerken: ['Sichere Bruchumwandlung'],
        schwaechen: ['Kürzen von 0,25 wiederholen'],
        hilfreicherTipp: 'Prüfe Dezimalbrüche durch Erweitern auf Hundertstel.',
        uebungsEmpfehlung: 'Dezimalbrüche in Stammbrüche umwandeln.',
      },
    };

    const enforced = enforceStepFeedbackConsistency(correction);

    expect(enforced.gesamterzieltePunkte).toBe(8.5);
    expect(enforced.gesamtmaximalPunkte).toBe(10);
    expect(enforced.note).toBe('5.3');
    expect(enforced.aufgaben[0].erzieltePunkte).toBe(8.5);
    expect(enforced.aufgaben[0].status).toBe('Fehler');
    expect(enforced.aufgaben[0].lehrerKommentar).toContain('[SICHERHEITSHINWEIS:');
    expect(enforced.aufgaben[0].schritte[0].istUnsicher).toBe(true);
    expect(enforced.aufgaben[0].schritte[0].unsicherheitsGrund).toBe(
      'Ziffer 4 leicht überschrieben.'
    );
    expect(enforced.aufgaben[0].schritte[1].erreichtePunkte).toBe(0);
    expect(enforced.aufgaben[0].schritte[1].fehlerTyp).toBe('Rechenfehler');
    expect(enforced.aufgaben[0].schritte[1].begruendung).toBe(
      '0,25 entspricht als gekürzter Bruch 1/4 (bzw. 25/100) und nicht 1/5. Daher keine Punkte für diesen Teilschritt (1.5 Punkte Abzug).'
    );
  });
});
