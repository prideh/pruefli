import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import path from 'path';

function createTestSessionToken(userId: string): string {
  const secret = process.env.JWT_SECRET || 'pruefli-dev-secret-key-safe-fallback';
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      iat: now,
      exp: now + 7 * 24 * 60 * 60,
    })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

const FEEDBACK_SHEETS_PAYLOAD = {
  examTitle: 'Bruchrechnen 1',
  subject: 'Mathematik',
  className: 'Sek 2a',
  totalCount: 2,
  completedCount: 2,
  ungradedCount: 0,
  sheets: [
    {
      submissionId: 'sub-1',
      examId: 'exam-123',
      examTitle: 'Bruchrechnen 1',
      fach: 'Mathematik',
      className: 'Sek 2a',
      schuelerName: 'Anna Beispiel',
      datum: '08.11.2026',
      gesamterzieltePunkte: 18,
      gesamtmaximalPunkte: 20,
      note: '5.5',
      aufgaben: [
        {
          aufgabeId: '1',
          titel: 'Aufgabe 1: Brüche kürzen',
          schuelerAntwort: '3/4',
          erzieltePunkte: 4,
          maximalPunkte: 4,
          status: 'Korrekt',
          lehrerKommentar: 'Sehr sauber gelöst.',
        },
      ],
      schuelerFeedback: {
        staerken: ['Sicheres Kürzen'],
        schwaechen: ['Vorzeichen bei Textaufgaben'],
        hilfreicherTipp: 'Zwischenschritte immer notieren.',
        uebungsEmpfehlung: 'Übungsblatt 3, Aufgaben 1–4.',
      },
    },
    {
      submissionId: 'sub-2',
      examId: 'exam-123',
      examTitle: 'Bruchrechnen 1',
      fach: 'Mathematik',
      className: 'Sek 2a',
      schuelerName: 'Ben Muster',
      datum: '08.11.2026',
      gesamterzieltePunkte: 15,
      gesamtmaximalPunkte: 20,
      note: '4.8',
      aufgaben: [
        {
          aufgabeId: '1',
          titel: 'Aufgabe 1: Brüche kürzen',
          schuelerAntwort: '6/8',
          erzieltePunkte: 3,
          maximalPunkte: 4,
          status: 'Folgefehler',
          lehrerKommentar: 'Nicht vollständig gekürzt.',
        },
      ],
      schuelerFeedback: {
        staerken: ['Guter Ansatz'],
        schwaechen: ['Endresultat vollständig kürzen'],
        hilfreicherTipp: 'Prüfe den grössten gemeinsamen Teiler.',
        uebungsEmpfehlung: 'Übungsblatt 2, Aufgaben 5–8.',
      },
    },
  ],
};

const SUBMISSION_SUB2_PAYLOAD = {
  id: 'sub-2',
  examId: 'exam-123',
  examTitle: 'Bruchrechnen 1',
  classId: 'class-1',
  className: 'Sek 2a',
  studentId: 'student-2',
  schuelerName: 'Ben Muster',
  fach: 'Mathematik',
  datum: '08.11.2026',
  gesamterzieltePunkte: 15,
  gesamtmaximalPunkte: 20,
  note: '4.8',
  gradingFormula: 'LINEAR_60',
  gradeRounding: '0.1',
  studentExamUrl: null,
  aufgaben: [
    {
      aufgabeId: '1',
      titel: 'Aufgabe 1: Brüche kürzen',
      schuelerAntwort: '6/8',
      erzieltePunkte: 3,
      maximalPunkte: 4,
      status: 'Folgefehler',
      lehrerKommentar: 'Nicht vollständig gekürzt.',
      schritte: [
        {
          schrittId: '1a',
          beschreibung: 'Zähler und Nenner durch 2 geteilt',
          punkte: 3,
          istKorrekt: true,
          istUnsicher: false,
        },
      ],
    },
  ],
  schuelerFeedback: {
    staerken: ['Guter Ansatz'],
    schwaechen: ['Endresultat vollständig kürzen'],
    hilfreicherTipp: 'Prüfe den grössten gemeinsamen Teiler.',
    uebungsEmpfehlung: 'Übungsblatt 2, Aufgaben 5–8.',
  },
  siblingSubmissions: [
    {
      id: 'sub-1',
      studentName: 'Anna Beispiel',
      status: 'COMPLETED',
      grade: '5.5',
      uncertainStepsCount: 0,
      tasks: [],
    },
    {
      id: 'sub-2',
      studentName: 'Ben Muster',
      status: 'COMPLETED',
      grade: '4.8',
      uncertainStepsCount: 0,
      tasks: [],
    },
  ],
};

test.describe('Issue #119 Browser Integration & Pixel Verification', () => {
  test.beforeEach(async ({ page }) => {
    const token = createTestSessionToken('teacher-119');
    await page.context().addCookies([
      {
        name: 'grade_ai_session',
        value: token,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);

    await page.route('**/api/auth/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          authenticated: true,
          teacher: {
            id: 'teacher-119',
            name: 'Lehrperson Test',
            email: 'teacher@schule.ch',
            emailVerified: true,
            paidAiVerificationRequired: false,
          },
        }),
      })
    );
  });

  test('1. Clicking "Feedback drucken" on /correct/sub-2 navigates to /exams/exam-123/print?submissionId=sub-2 without opening about:blank and renders ONLY Ben Muster', async ({
    page,
  }) => {
    const openedPopups: string[] = [];
    page.context().on('page', (newPage) => {
      openedPopups.push(newPage.url());
    });

    await page.route('**/api/submissions/sub-2', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SUBMISSION_SUB2_PAYLOAD),
      })
    );

    await page.route('**/api/exams/exam-123/feedback-sheets', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(FEEDBACK_SHEETS_PAYLOAD),
      })
    );

    await page.goto('/correct/sub-2');
    const printBtn = page.getByRole('button', { name: 'Feedback drucken' });
    await expect(printBtn).toBeVisible();

    await printBtn.click();

    await expect(page).toHaveURL(/\/exams\/exam-123\/print\?submissionId=sub-2$/);
    expect(openedPopups).toHaveLength(0);

    await expect(page.locator('.print-page')).toHaveCount(1);
    await expect(page.getByText('Schüler: Ben Muster')).toBeVisible();
    await expect(page.getByText('Nicht vollständig gekürzt.')).toBeVisible();
    await expect(page.getByText('Anna Beispiel')).toHaveCount(0);

    const backToCorrectLink = page.getByRole('link', { name: 'Zurück zur Korrektur' });
    await expect(backToCorrectLink).toBeVisible();
    await expect(backToCorrectLink).toHaveAttribute('href', '/correct/sub-2');

    const triggerPrintBtn = page.getByRole('button', { name: 'Jetzt drucken (1 Schüler/innen)' });
    await expect(triggerPrintBtn).toBeVisible();
    await expect(triggerPrintBtn).toBeEnabled();

    const screenshotDir = process.env.ISSUE_119_SCREENSHOT_DIR;
    if (screenshotDir) {
      await page.screenshot({
        path: path.join(screenshotDir, 'issue_119_single_student_print.png'),
        fullPage: true,
      });
    }
  });

  test('2. Direct SSR + hydration load of /exams/exam-123/print?submissionId=sub-2 preserves targetSubmissionId and renders ONLY Ben Muster', async ({
    page,
  }) => {
    await page.route('**/api/exams/exam-123/feedback-sheets', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(FEEDBACK_SHEETS_PAYLOAD),
      })
    );

    await page.goto('/exams/exam-123/print?submissionId=sub-2');
    await expect(page.locator('.print-page')).toHaveCount(1);
    await expect(page.getByText('Schüler: Ben Muster')).toBeVisible();
    await expect(page.getByText('Anna Beispiel')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Jetzt drucken (1 Schüler/innen)' })
    ).toBeEnabled();
  });

  test('3. Missing or invalid submissionId (/exams/exam-123/print?submissionId=sub-missing-999) renders 0 student sheets, shows explicit not-found state, and disables print button', async ({
    page,
  }) => {
    await page.route('**/api/exams/exam-123/feedback-sheets', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(FEEDBACK_SHEETS_PAYLOAD),
      })
    );

    await page.goto('/exams/exam-123/print?submissionId=sub-missing-999');

    await expect(page.getByTestId('print-target-not-found')).toBeVisible();
    await expect(page.getByText('Gewünschter Feedback-Bericht nicht gefunden')).toBeVisible();
    await expect(page.locator('.print-page')).toHaveCount(0);
    await expect(page.getByText('Anna Beispiel')).toHaveCount(0);
    await expect(page.getByText('Ben Muster')).toHaveCount(0);

    const triggerPrintBtn = page.getByRole('button', { name: 'Jetzt drucken (0 Schüler/innen)' });
    await expect(triggerPrintBtn).toBeVisible();
    await expect(triggerPrintBtn).toBeDisabled();

    const screenshotDir = process.env.ISSUE_119_SCREENSHOT_DIR;
    if (screenshotDir) {
      await page.screenshot({
        path: path.join(screenshotDir, 'issue_119_missing_target_print.png'),
        fullPage: true,
      });
    }
  });

  test('4. /exams list failure shows non-redundant recovery hint and keeps "Prüfung generieren" and "Manuell anlegen" enabled when classes load', async ({
    page,
  }) => {
    await page.route('**/api/exams', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Fehler beim Laden der Prüfungen.' }),
      })
    );
    await page.route('**/api/classes', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          classes: [
            {
              id: 'class-1',
              name: 'Sek 2a',
              subjects: ['Mathematik'],
              _count: { students: 12, exams: 1 },
            },
          ],
        }),
      })
    );
    await page.route('**/api/subjects', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ savedSubjects: ['Mathematik'] }),
      })
    );

    await page.goto('/exams');

    await expect(page.getByText('Fehler beim Laden der Prüfungen', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Bitte Verbindung prüfen und erneut versuchen.', { exact: true })
    ).toBeVisible();
    await expect(page.getByText('Fehler beim Laden der Prüfungen.', { exact: true })).toHaveCount(
      0
    );

    await expect(page.getByRole('button', { name: 'Prüfung generieren' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Manuell anlegen' })).toBeEnabled();
  });
});
