#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Reproduzierbares Browser-Verifikations- und Screenshot-Skript fuer die
 * Markdown- und KaTeX-Vorschau auf der Pruefungs-Detailseite (/exams/[id]).
 *
 * Prueft im echten Chromium-Browser (Desktop 1280x900 & Mobile 390x844):
 * 1. Aufgabenblatt-Vorschau (TEMPLATE): # Pruefung: Grundrechenarten, **Name:** ___,
 *    **Punkte:** ____ /6 Punkte, ### Hinweise, Aufzaehlungsliste, nicht-fortlaufende
 *    Aufgabennummerierung (3., 7.) sowie KaTeX-Mathematik ($8+5$).
 * 2. Musterloesungs-Vorschau (RUBRIC): ### Musterloesung, **Aufgabe 1**, $8+5$,
 *    $8+2+3$, $13$, Display-Mathematik mit Suffix-Text auf der schliessenden Zeile.
 * 3. Bearbeitungsmodus (Bearbeiten): Unveraenderte Beibehaltung des editierbaren
 *    Markdown-/LaTeX-Quelltexts.
 */

import { chromium } from '@playwright/test';
import { SignJWT } from 'jose';
import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_DIR =
  process.env.PREVIEW_ARTIFACT_DIR ||
  path.resolve(process.cwd(), 'review-artifacts/exam-detail-preview');

const SYNTHETIC_STUDENT_TEMPLATE = [
  '# Prüfung: Grundrechenarten',
  '**Name:** ___',
  '**Punkte:** ____ /6 Punkte',
  '',
  '### Hinweise',
  '- Lies jede Aufgabe sorgfältig durch.',
  '- Schreibe alle Zwischenschritte sauber auf.',
  '- Taschenrechner sind nicht erlaubt.',
  '',
  '**Aufgabe 1 (2 Punkte)**',
  'Berechne die Summe von $8+5$ mit Zehnerübergang.',
  'Rechnung: ____________',
  '',
  '**Aufgabe 2 (4 Punkte)**',
  '3. Teilaufgabe: $8+5 = 8+2+3 = 13$',
  '7. Teilaufgabe: $7+6 = 7+3+3 = 13$',
].join('\n');

const SYNTHETIC_SOLUTION_RUBRIC = [
  '### Musterlösung',
  '**Aufgabe 1**',
  '- Ausgangsrechnung: $8+5$',
  '- Schrittweise Zerlegung über den Zehner: $8+2+3$',
  '- Endergebnis: $13$',
  '- Bewertung: **1 Punkt** für den Zwischenschritt ($8+2+3$), **1 Punkt** für das korrekte Resultat ($13$).',
  '',
  '**Aufgabe 2**',
  '$$',
  '8 + 5 = 8 + 2 + 3 = 13',
  '$$ Bewertungshinweis: Zwischenschritt gibt 1 Punkt.',
].join('\n');

const MOCK_EXAM = {
  id: 'exam-preview-demo',
  title: 'Prüfung: Grundrechenarten',
  classId: 'class-demo-1',
  className: 'Primar 2a',
  isClassArchived: false,
  subject: 'Mathematik',
  maxPoints: 6,
  isGenerated: false,
  isApproved: true,
  approvedAt: null,
  gradingFormula: 'LINEAR_60',
  gradeRounding: '0.1',
  examTemplateText: SYNTHETIC_STUDENT_TEMPLATE,
  rubricText: SYNTHETIC_SOLUTION_RUBRIC,
  gradingNotes: 'Teilpunkte bei erkennbarem Zwischenschritt über den Zehner vergeben.',
  tasks: [
    {
      id: 't-1',
      taskId: '1',
      title: 'Aufgabe 1: Addition mit Zehnerübergang',
      maxPoints: 2,
      orderIndex: 0,
    },
    {
      id: 't-2',
      taskId: '2',
      title: 'Aufgabe 2: Schrittweise Zerlegung',
      maxPoints: 4,
      orderIndex: 1,
    },
  ],
};

const MOCK_API_RESPONSE = {
  exam: MOCK_EXAM,
  stats: {
    averageGrade: '-',
    passRate: '0%',
    highestGrade: '-',
    lowestGrade: '-',
    stdDev: '-',
    totalCompleted: 0,
    totalStudents: 2,
    gradeDistribution: {
      '6': 0,
      '5': 0,
      '4': 0,
      '3': 0,
      '2': 0,
      '1': 0,
    },
  },
  roster: [
    {
      studentId: 'stu-1',
      studentName: 'Anna Muster',
      status: 'UNSTARTED',
      earnedPoints: '-',
      grade: '-',
      date: '-',
    },
    {
      studentId: 'stu-2',
      studentName: 'Lukas Beispiel',
      status: 'UNSTARTED',
      earnedPoints: '-',
      grade: '-',
      date: '-',
    },
  ],
  failedSubmissions: [],
  taskAnalysis: null,
};

async function run() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const baseUrl = process.env.BASE_URL || 'http://localhost:3419';
  const jwtSecret =
    process.env.JWT_SECRET || 'pruefli-dev-secret-key-safe-fallback-only-for-local-dev';
  const sessionToken = await new SignJWT({
    userId: 'teacher-1',
    email: 'demo@pruefli.ch',
    name: 'Lehrperson Demo',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(new TextEncoder().encode(jwtSecret));

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-proxy-server'],
  });

  try {
    for (const viewportConfig of [
      { name: 'desktop', width: 1280, height: 900 },
      { name: 'mobile', width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({
        viewport: { width: viewportConfig.width, height: viewportConfig.height },
        deviceScaleFactor: 2,
      });
      await context.addCookies([
        {
          name: 'grade_ai_session',
          value: sessionToken,
          url: baseUrl,
        },
      ]);
      const page = await context.newPage();

      await page.route('**/api/auth/me', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            authenticated: true,
            teacher: {
              id: 'teacher-1',
              name: 'Lehrperson Demo',
              email: 'demo@pruefli.ch',
              emailVerified: true,
              schoolSystem: 'CH_6_1',
              subjects: ['Mathematik', 'Deutsch'],
            },
          }),
        });
      });

      await page.route('**/api/exams/exam-preview-demo*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_API_RESPONSE),
        });
      });

      await page.route('**/api/exams', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ exams: [MOCK_EXAM] }),
        });
      });

      await page.route('**/api/classes*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            classes: [
              {
                id: 'class-demo-1',
                name: 'Primar 2a',
                students: [],
                _count: { students: 2, exams: 1 },
              },
            ],
          }),
        });
      });

      await page.route('**/api/submissions*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ submissions: [] }),
        });
      });

      await page.route('**/api/students*', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ students: [] }),
        });
      });

      await page.goto(`${baseUrl}/exams/exam-preview-demo`, { waitUntil: 'domcontentloaded' });

      // 1. Default tab is TEMPLATE ("Aufgabenblatt (Schüler)")
      const templatePreview = page.getByTestId('exam-template-preview');
      await templatePreview.waitFor({ state: 'visible', timeout: 15000 });
      await templatePreview.scrollIntoViewIfNeeded();

      const templateText = await templatePreview.innerText();
      if (
        templateText.includes('# Prüfung:') ||
        templateText.includes('### Hinweise') ||
        templateText.includes('**Name:**') ||
        templateText.includes('$8+5$')
      ) {
        throw new Error(`Raw Markdown/LaTeX still visible in student preview: ${templateText}`);
      }
      if (
        !templateText.includes('Prüfung: Grundrechenarten') ||
        !templateText.includes('Name: ___') ||
        !templateText.includes('Punkte: ____ /6 Punkte') ||
        !templateText.includes('Hinweise') ||
        !templateText.includes('3.') ||
        !templateText.includes('7.')
      ) {
        throw new Error(
          `Expected student preview headers, blanks, or non-consecutive list markers missing: ${templateText}`
        );
      }

      const studentPath = path.join(
        OUTPUT_DIR,
        `exam_detail_student_preview_${viewportConfig.name}.png`
      );
      await page.screenshot({ path: studentPath, fullPage: false });
      console.log(`Saved ${studentPath}`);

      // 2. Switch to Solution tab ("Musterlösung & Kriterien")
      await page.getByRole('button', { name: /Musterlösung & Kriterien/i }).click();
      const rubricPreview = page.getByTestId('exam-rubric-preview');
      await rubricPreview.waitFor({ state: 'visible', timeout: 10000 });
      await rubricPreview.scrollIntoViewIfNeeded();

      const rubricText = await rubricPreview.innerText();
      if (rubricText.includes('### Musterlösung') || rubricText.includes('$8+5$')) {
        throw new Error(`Raw Markdown/LaTeX still visible in solution tab: ${rubricText}`);
      }
      if (!rubricText.includes('Bewertungshinweis: Zwischenschritt gibt 1 Punkt.')) {
        throw new Error(
          `Closing-line suffix after display math was dropped in solution tab: ${rubricText}`
        );
      }
      const rubricKatexCount = await rubricPreview.locator('.katex').count();
      if (rubricKatexCount < 4) {
        throw new Error(`Expected >= 4 KaTeX elements in solution tab, got ${rubricKatexCount}`);
      }

      const solutionPath = path.join(
        OUTPUT_DIR,
        `exam_detail_solution_preview_${viewportConfig.name}.png`
      );
      await page.screenshot({ path: solutionPath, fullPage: false });
      console.log(`Saved ${solutionPath}`);

      // 3. Verify clicking "Bearbeiten" preserves exact raw Markdown/LaTeX source
      if (viewportConfig.name === 'desktop') {
        await page.getByRole('button', { name: /^Bearbeiten$/i }).click();
        const rubricField = page.getByLabel(/Musterlösung \(Stufe 2\)/i);
        await rubricField.waitFor({ state: 'visible', timeout: 5000 });
        const rawRubricVal = await rubricField.inputValue();
        if (rawRubricVal !== SYNTHETIC_SOLUTION_RUBRIC) {
          throw new Error('Editable rubric source was altered!');
        }
        await page.getByRole('button', { name: /Aufgabenblatt \(Schüler\)/i }).click();
        const templateField = page.getByRole('textbox', {
          name: /Aufgabenblatt für Schülerinnen und Schüler/i,
        });
        await templateField.waitFor({ state: 'visible', timeout: 5000 });
        const rawTemplateVal = await templateField.inputValue();
        if (rawTemplateVal !== SYNTHETIC_STUDENT_TEMPLATE) {
          throw new Error('Editable template source was altered!');
        }
        console.log('Verified editable source preservation in Bearbeiten mode.');
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
