import { test, expect } from '@playwright/test';
import crypto from 'crypto';

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

const DUMMY_QR_SVG =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="210" height="210" viewBox="0 0 210 210"><rect width="210" height="210" fill="#fff"/><rect x="20" y="20" width="60" height="60" fill="#000"/><rect x="130" y="20" width="60" height="60" fill="#000"/><rect x="20" y="130" width="60" height="60" fill="#000"/><rect x="90" y="90" width="30" height="30" fill="#000"/></svg>'
  );

test.describe('Issue #129 Narrow-Mobile QR Dialog Layout & Overflow Regression', () => {
  test.beforeEach(async ({ page }) => {
    const token = createTestSessionToken('teacher-129');
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
            id: 'teacher-129',
            name: 'Lehrperson Test',
            email: 'teacher@schule.ch',
            emailVerified: true,
            paidAiVerificationRequired: false,
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
              _count: { students: 12, exams: 1 },
            },
          ],
        }),
      })
    );

    await page.route('**/api/exams', (route) =>
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

    await page.route('**/api/mobile-relay*', (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            token: 'relay-token-129',
            qrDataUrl: DUMMY_QR_SVG,
            scanUrl: 'https://pruefli.ch/scan/relay-token-129',
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ scannedDocument: null }),
      });
    });
  });

  for (const vp of [
    { name: 'iPhone 390x844', width: 390, height: 844 },
    { name: 'iPhone Safari chrome 390x664', width: 390, height: 664 },
    { name: 'iPhone SE 375x667', width: 375, height: 667 },
    { name: 'Compact mobile 320x568', width: 320, height: 568 },
  ]) {
    test(`renders RUBRIC QR dialog without horizontal overflow or step-chip clipping at ${vp.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/exams');

      await page.getByRole('button', { name: 'Manuell anlegen' }).click();
      const scanQrBtn = page.getByRole('button', { name: 'Per Smartphone scannen (QR)' });
      await scanQrBtn.scrollIntoViewIfNeeded();
      await scanQrBtn.click();

      const qrDialog = page
        .getByRole('dialog')
        .filter({ hasText: 'Musterlösung per QR-Kamera scannen' });
      await expect(qrDialog).toBeVisible();
      await expect(qrDialog.locator('img[alt="QR-Code für Smartphone-Kamera"]')).toBeVisible();

      const step1Chip = qrDialog
        .locator('.MuiChip-root')
        .filter({ hasText: '1. QR-Code mit Handy scannen' });
      const step2Chip = qrDialog
        .locator('.MuiChip-root')
        .filter({ hasText: '2. Seiten abfotografieren' });

      await step2Chip.scrollIntoViewIfNeeded();
      await expect(step1Chip).toBeVisible();
      await expect(step2Chip).toBeVisible();

      const layoutCheck = await qrDialog.evaluate((dialogEl) => {
        const dialogRect = dialogEl.getBoundingClientRect();
        const contentEl = dialogEl.querySelector('.MuiDialogContent-root') as HTMLElement | null;
        const qrImg = dialogEl.querySelector('img[alt="QR-Code für Smartphone-Kamera"]');
        const qrBoxEl = qrImg?.parentElement?.parentElement as HTMLElement | null;
        const qrBoxRect = qrBoxEl ? qrBoxEl.getBoundingClientRect() : null;

        const chips = Array.from(dialogEl.querySelectorAll('.MuiChip-root')).map((chip) => {
          const label = chip.querySelector('.MuiChip-label') as HTMLElement | null;
          const chipRect = chip.getBoundingClientRect();
          return {
            text: chip.textContent,
            isTruncated: label ? label.scrollWidth > label.clientWidth + 1 : false,
            withinQrBoxHorizontally: qrBoxRect
              ? chipRect.left >= qrBoxRect.left - 1 && chipRect.right <= qrBoxRect.right + 1
              : false,
            withinDialogHorizontally:
              chipRect.left >= dialogRect.left - 1 && chipRect.right <= dialogRect.right + 1,
          };
        });

        return {
          dialogFitsViewport:
            dialogRect.top >= 0 &&
            dialogRect.left >= 0 &&
            dialogRect.right <= window.innerWidth + 1 &&
            dialogRect.bottom <= window.innerHeight + 1,
          dialogHorizontalOverflow: dialogEl.scrollWidth > dialogEl.clientWidth + 1,
          contentHorizontalOverflow: contentEl
            ? contentEl.scrollWidth > contentEl.clientWidth + 1
            : false,
          qrBoxHorizontalOverflow: qrBoxEl ? qrBoxEl.scrollWidth > qrBoxEl.clientWidth + 1 : false,
          chips,
        };
      });

      expect(layoutCheck.dialogFitsViewport).toBe(true);
      expect(layoutCheck.dialogHorizontalOverflow).toBe(false);
      expect(layoutCheck.contentHorizontalOverflow).toBe(false);
      expect(layoutCheck.qrBoxHorizontalOverflow).toBe(false);
      expect(layoutCheck.chips).toHaveLength(2);
      for (const chip of layoutCheck.chips) {
        expect(chip.isTruncated).toBe(false);
        expect(chip.withinQrBoxHorizontally).toBe(true);
        expect(chip.withinDialogHorizontally).toBe(true);
      }

      await expect(qrDialog.getByRole('button', { name: 'Fertig' })).toBeVisible();
    });
  }
});
