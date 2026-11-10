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

test.describe('Issue #127: Maximum-Points Input Browser Regression (Desktop & Mobile)', () => {
  test.beforeEach(async ({ page }) => {
    const token = createTestSessionToken('teacher-127');
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
          isEmailVerified: true,
          emailVerificationRequired: false,
          paidAiVerificationRequired: false,
          teacher: {
            id: 'teacher-127',
            name: 'Lehrperson Test',
            email: 'teacher127@schule.ch',
            emailVerified: true,
          },
        }),
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
              _count: { students: 1, exams: 0 },
            },
          ],
        }),
      })
    );

    await page.route('**/api/classes/class-1/students', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          students: [{ id: 'student-1', name: 'Anna Beispiel' }],
        }),
      })
    );

    await page.route('**/api/classes/class-1/exams', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ exams: [] }),
      })
    );

    await page.route('**/api/subjects', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ savedSubjects: ['Mathematik'] }),
      })
    );

    await page.route('**/api/submissions*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ submissions: [], totalExamsCount: 0, allExams: [] }),
      })
    );
  });

  test('1. Dashboard Wizard Maximalpunktzahl allows empty editing, prevents sticky leading zero (017 -> 17), validates on submit, and preserves decimal points across Desktop & Mobile', async ({
    page,
  }) => {
    const submittedExamPayloads: Array<Record<string, unknown>> = [];

    await page.route('**/api/exams', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        submittedExamPayloads.push(body);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            exam: {
              id: `exam-created-${submittedExamPayloads.length}`,
              title: body.title,
              subject: body.subject,
              maxPoints: body.maxPoints,
              classId: body.classId,
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ exams: [] }),
      });
    });

    await page.route('**/api/mobile-relay', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ token: 'mock-relay-token' }),
      })
    );

    for (const vp of [
      { name: 'desktop', width: 1280, height: 800 },
      { name: 'mobile', width: 390, height: 844 },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/dashboard');

      const titleInput = page.getByLabel(/Prüfungstitel/i);
      const maxPointsInput = page.getByLabel(/Maximalpunktzahl/i);
      await expect(maxPointsInput).toBeVisible();
      await expect(maxPointsInput).toHaveValue('20');

      // 1. Clear via Backspace -> field stays empty (''), never snaps back to '0'
      await maxPointsInput.click();
      await maxPointsInput.press('Control+A');
      await maxPointsInput.press('Backspace');
      await expect(maxPointsInput).toHaveValue('');

      const screenshotDir = process.env.ISSUE_127_SCREENSHOT_DIR;
      if (screenshotDir) {
        await maxPointsInput.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(screenshotDir, `issue_127_${vp.name}_empty_edit.png`),
        });
      }

      // 2. While empty, requirement hint is shown and submitting via QR scan validates on submit
      await titleInput.fill('Lineare Gleichungen');
      await expect(page.getByText('Gültige Maximalpunktzahl angeben (Schritt ②)')).toBeVisible();

      const qrScanBtn = page.getByRole('button', { name: 'Mit Smartphone scannen (QR)' });
      await qrScanBtn.click();
      await expect(
        page.getByText('Bitte gib eine gültige Maximalpunktzahl grösser als 0 an.')
      ).toBeVisible();

      // 3. Typing '17' into empty field produces '17' (not '017') and clears the validation error
      await maxPointsInput.click();
      await maxPointsInput.pressSequentially('17');
      await expect(maxPointsInput).toHaveValue('17');
      await expect(
        page.getByText('Bitte gib eine gültige Maximalpunktzahl grösser als 0 an.')
      ).toHaveCount(0);

      // 4. Typing '017' (or prepending '0' before '17') normalizes display & value to '17'
      await maxPointsInput.fill('');
      await maxPointsInput.pressSequentially('017');
      await expect(maxPointsInput).toHaveValue('17');

      await maxPointsInput.evaluate((el: HTMLInputElement) => {
        const nativeValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value'
        )?.set;
        nativeValueSetter?.call(el, '017');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await expect(maxPointsInput).toHaveValue('17');

      if (screenshotDir) {
        await maxPointsInput.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: path.join(screenshotDir, `issue_127_${vp.name}_normalized_17.png`),
        });
      }

      // 5. Decimal scoring semantics (e.g. '17.5') are preserved on submit
      await maxPointsInput.fill('');
      await maxPointsInput.pressSequentially('17.5');
      await expect(maxPointsInput).toHaveValue('17.5');
    }

    // Submit via QR scan trigger on mobile viewport and verify numeric maxPoints (17.5) in API payload
    await page.getByRole('button', { name: 'Mit Smartphone scannen (QR)' }).click();
    await expect.poll(() => submittedExamPayloads.length).toBe(1);
    expect(submittedExamPayloads[0].maxPoints).toBe(17.5);
  });

  test('2. /exams Create Exam dialog Maximale Punkte allows empty editing, normalizes leading zeros, and validates on submit', async ({
    page,
  }) => {
    const createdExamPayloads: Array<Record<string, unknown>> = [];

    await page.route('**/api/exams', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        createdExamPayloads.push(body);
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'exam-new-127',
            title: body?.title,
            maxPoints: body?.maxPoints,
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ exams: [] }),
      });
    });

    await page.goto('/exams');
    await page.getByRole('button', { name: 'Manuell anlegen' }).click();

    const dialog = page.getByRole('dialog');
    const maxPointsInput = dialog.getByLabel(/Maximale Punkte/i);
    await expect(maxPointsInput).toHaveValue('20');

    await maxPointsInput.fill('');
    await expect(maxPointsInput).toHaveValue('');

    await maxPointsInput.pressSequentially('0');
    await expect(maxPointsInput).toHaveValue('0');

    await dialog.getByLabel(/Prüfungstitel/i).fill('Geometrie Test');
    await dialog.getByRole('button', { name: 'Anlegen' }).click();
    await expect(
      dialog.getByText('Bitte gib eine gültige Maximalpunktzahl grösser als 0 an.')
    ).toBeVisible();

    await maxPointsInput.pressSequentially('17');
    await expect(maxPointsInput).toHaveValue('17');
    await expect(
      dialog.getByText('Bitte gib eine gültige Maximalpunktzahl grösser als 0 an.')
    ).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Anlegen' }).click();
    await expect.poll(() => createdExamPayloads.length).toBe(1);
    expect(createdExamPayloads[0].maxPoints).toBe(17);
  });
});
