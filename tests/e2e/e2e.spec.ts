import { test, expect } from '@playwright/test';
import { signEmailVerificationToken } from '@/lib/jwt';

test.describe('Full E2E Teacher & Mobile QR Relay Workflows', () => {
  const uniqueSuffix = Date.now();
  const teacherEmail = `e2e.teacher.${uniqueSuffix}@schule.ch`;
  const teacherPassword = 'SwissPruefliPassword2026!';
  const teacherName = 'Herr Dr. Schweizer';
  let kontoAClassId = '';
  let kontoAExamId = '';

  test('1. Teacher Registration -> Decluttered Dashboard -> Class & Student Creation -> Exam & CSV Export -> Mobile QR Relay Handover', async ({
    page,
  }) => {
    // --- STEP 0: Verify Landingpage-Header logged-out & logged-in across Desktop & Mobile (#71) ---
    for (const vp of [
      { width: 1280, height: 800 },
      { width: 375, height: 667 },
    ]) {
      await page.setViewportSize(vp);
      await page.goto('/');
      const header = page.locator('header');
      await expect(
        header
          .getByRole('button', { name: 'Login' })
          .or(header.getByRole('link', { name: 'Login' }))
          .first()
      ).toBeVisible();
      await expect(
        header
          .getByRole('button', { name: 'Registrieren' })
          .or(header.getByRole('link', { name: 'Registrieren' }))
          .first()
      ).toBeVisible();
      await expect(header.getByText('Zum Workspace')).toHaveCount(0);
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    // --- STEP 1: Register a new teacher -> Verify #113 Password Confirmation + #114 Visible Step 2 + #110 Paid-AI Gate + #98 Opt-In Gate -> Confirm via Link -> Full Access ---
    await page.goto('/register');
    await page.getByLabel(/Name/i).first().fill(teacherName);
    await page
      .getByLabel(/E-Mail/i)
      .first()
      .fill(teacherEmail);
    await page
      .getByLabel(/^Passwort$/i)
      .first()
      .fill(teacherPassword);

    // Issue #113: Mismatched password confirmation is rejected client-side and server-side
    await page.getByLabel(/Passwort wiederholen/i).fill('AbweichendesPasswort123!');
    await page
      .getByRole('button', { name: /Registrieren|Konto erstellen|Account erstellen/i })
      .click();
    await expect(page.getByTestId('register-error-alert')).toContainText(
      /Passwörter stimmen nicht überein/i
    );

    const mismatchApiRes = await page.request.post('/api/auth/register', {
      data: {
        name: teacherName,
        email: teacherEmail,
        password: teacherPassword,
        confirmPassword: 'AbweichendesPasswort123!',
      },
    });
    expect(mismatchApiRes.status()).toBe(400);
    const mismatchApiJson = await mismatchApiRes.json();
    expect(mismatchApiJson.error).toContain('Passwörter stimmen nicht überein');

    // Fill matching password confirmation and submit registration
    await page.getByLabel(/Passwort wiederholen/i).fill(teacherPassword);
    await page
      .getByRole('button', { name: /Registrieren|Konto erstellen|Account erstellen/i })
      .click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

    // Issue #114: Fresh account without classes still shows Step ② ("Prüfung & Musterlösung") visibly between Step ① and Step ③
    await expect(page.getByTestId('correction-step-2-card')).toBeVisible();
    await expect(page.getByText('Prüfung & Musterlösung')).toBeVisible();
    await expect(page.getByTestId('step-2-class-hint')).toBeVisible();

    // Issue #110 (Default mode without all-or-nothing gate):
    // Manual browsing & setup remain open, while paid AI entry points show banner + disabled trigger
    await expect(page.getByTestId('email-verification-gate')).toHaveCount(0);
    await expect(page.getByText('Prüfungskorrektur starten')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Klassen' }).first()).toBeVisible();
    await expect(page.getByTestId('paid-ai-verification-banner').first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Bestätigungs-E-Mail erneut senden/i }).first()
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Smartphone-Kamera \(Universal-QR-Scan\)/i })
    ).toBeDisabled();

    // Issue #112: On 390x844 mobile viewport, verification banners use full width without character-wide wrapping or horizontal overflow
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileBannerBox = await page
      .getByTestId('paid-ai-verification-banner')
      .first()
      .locator('.MuiAlert-message')
      .boundingBox();
    expect(mobileBannerBox).not.toBeNull();
    expect(mobileBannerBox!.width).toBeGreaterThanOrEqual(240);
    const mobileScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(mobileScrollWidth).toBeLessThanOrEqual(390);
    await page.setViewportSize({ width: 1280, height: 800 });

    // Non-LLM route remains allowed (200 OK) for unverified account in default mode (#110)
    const allowedClassesRes = await page.request.get('/api/classes');
    expect(allowedClassesRes.status()).toBe(200);

    // Direct call to paid LLM route is rejected with 403 EMAIL_VERIFICATION_REQUIRED (#110)
    const blockedAiRes = await page.request.post('/api/exams/generate', {
      data: { materialText: 'Lehrplan Algebra Kapitel 1' },
    });
    expect(blockedAiRes.status()).toBe(403);
    const blockedAiJson = await blockedAiRes.json();
    expect(blockedAiJson.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    expect(blockedAiJson.emailVerificationRequired).toBe(true);

    const meResDefault = await page.request.get('/api/auth/me');
    expect(meResDefault.status()).toBe(200);
    const meJsonDefault = await meResDefault.json();
    expect(meJsonDefault.isEmailVerified).toBe(false);
    expect(meJsonDefault.paidAiVerificationRequired).toBe(true);
    expect(meJsonDefault.emailVerificationRequired).toBe(false);

    // Optional all-or-nothing gate (#98) when explicitly opted in via cookie
    await page.context().addCookies([
      {
        name: 'pruefli_enforce_email_verification',
        value: 'true',
        domain: 'localhost',
        path: '/',
      },
    ]);
    await page.reload();

    // Unverified teacher with #98 cookie lands on restricted "E-Mail bestätigen" view
    await expect(page.getByTestId('email-verification-gate')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'E-Mail bestätigen' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Bestätigung erneut senden/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abmelden' })).toBeVisible();
    await expect(page.getByText('Prüfungskorrektur starten')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Klassen' })).toHaveCount(0);

    // Server-side API enforcement with #98 cookie rejects unverified account with HTTP 403
    const blockedClassesRes = await page.request.get('/api/classes');
    expect(blockedClassesRes.status()).toBe(403);
    const blockedClassesJson = await blockedClassesRes.json();
    expect(blockedClassesJson.code).toBe('EMAIL_VERIFICATION_REQUIRED');

    // Confirm email via verification link -> unlocks full access + paid AI controls
    const meResBefore = await page.request.get('/api/auth/me');
    expect(meResBefore.status()).toBe(200);
    const meJsonBefore = await meResBefore.json();
    expect(meJsonBefore.isEmailVerified).toBe(false);
    expect(meJsonBefore.emailVerificationRequired).toBe(true);

    const verificationToken = await signEmailVerificationToken({
      teacherId: meJsonBefore.teacher.id,
      email: teacherEmail,
    });

    await page.goto(`/verify-email?token=${encodeURIComponent(verificationToken)}`);
    await expect(page.getByText('E-Mail-Adresse erfolgreich bestätigt!')).toBeVisible();
    await page.getByRole('button', { name: /Weiter zum Dashboard/i }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    await expect(page.getByTestId('email-verification-gate')).toHaveCount(0);
    await expect(page.getByTestId('paid-ai-verification-banner')).toHaveCount(0);
    await expect(page.getByText('Prüfungskorrektur starten')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Smartphone-Kamera \(Universal-QR-Scan\)/i })
    ).toBeEnabled();

    // Verify sidebar does NOT show cluttering "Protokoll" link
    await expect(page.getByRole('link', { name: 'Protokoll' })).toHaveCount(0);

    // Verify logged-in teachers visiting '/' are redirected server-side directly to '/dashboard' (#85)
    for (const vp of [
      { width: 1280, height: 800 },
      { width: 375, height: 667 },
    ]) {
      await page.setViewportSize(vp);
      await page.goto('/');
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
      await expect(page.getByText('Prüfungskorrektur starten')).toBeVisible();
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    // --- STEP 2: Create a Class & Add Students ---
    await page.goto('/classes');
    await page
      .getByRole('button', { name: /Klasse erstellen/i })
      .first()
      .click();
    await page.getByLabel(/Klassenbezeichnung|Klassenname/i).fill('Gymnasium 10b');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Erstellen|Speichern/i })
      .click();

    await expect(page.getByText('Gymnasium 10b').first()).toBeVisible();
    await page
      .getByRole('link', { name: /Details & (Klassenliste|Roster)/i })
      .or(page.getByRole('button', { name: /Details & (Klassenliste|Roster)/i }))
      .first()
      .click();
    await expect(page).toHaveURL(/\/classes\/.+/);
    kontoAClassId = new URL(page.url()).pathname.split('/').pop() || '';
    expect(kontoAClassId).toBeTruthy();

    // Add a student to the class
    const addStudentBtn = page.getByRole('button', { name: /Schüler.*hinzufügen/i }).first();
    if (await addStudentBtn.isVisible()) {
      await addStudentBtn.click();
      await page.getByLabel(/Name/i).last().fill('Lukas Keller');
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /Einschreiben|Hinzufügen|Speichern/i })
        .click();
      await expect(page.getByText('Lukas Keller').first()).toBeVisible();
    }

    // --- STEP 3: Create an Exam & Verify Exam Details + CSV Export ---
    await page.goto('/exams');
    await page
      .getByRole('button', { name: /Neue Prüfung|Prüfung anlegen/i })
      .first()
      .click();
    await page.getByLabel(/Prüfungstitel/i).fill('Algebra Prüfung 1');
    await page
      .getByPlaceholder(/Gib Formeln|Trage hier die Musterlösung/i)
      .fill('Aufgabe 1: 2x = 10 -> x = 5 (4 Punkte)');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Anlegen|Prüfung anlegen/i })
      .click();

    await expect(page.getByText('Algebra Prüfung 1').first()).toBeVisible();
    await page
      .getByRole('link', { name: /Musterlösung & (Stats|Statistiken)/i })
      .or(page.getByRole('button', { name: /Musterlösung & (Stats|Statistiken)/i }))
      .first()
      .click();
    await expect(page).toHaveURL(/\/exams\/.+/);
    kontoAExamId = new URL(page.url()).pathname.split('/').pop() || '';
    expect(kontoAExamId).toBeTruthy();

    // Verify new "Korrektur-Fortschritt" KPI card (replaced Standardabweichung)
    await expect(page.getByText('Korrektur-Fortschritt')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Notenliste exportieren \(CSV\)/i })
    ).toBeVisible();

    // --- STEP 4: Verify Mobile QR Relay Token Generation & Document Scan Handover ---
    const relayRes = await page.request.post('/api/mobile-relay', {
      data: {
        targetMode: 'RUBRIC',
      },
    });
    expect(relayRes.status()).toBe(200);
    const relayJson = await relayRes.json();
    expect(relayJson.token).toBeTruthy();

    // Open the mobile scanner page with the generated token
    await page.goto(`/scan/${encodeURIComponent(relayJson.token)}`);
    await expect(page.getByText(/Smartphone-Scanner|GradeAi Mobile Scanner/i)).toBeVisible();
    await expect(page.getByText(new RegExp(teacherName))).toBeVisible();

    // Upload a simulated 1x1 JPEG image as a scanned Musterlösung (RUBRIC) via the relay upload API
    const minimalPngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const imageBuffer = Buffer.from(minimalPngBase64, 'base64');

    const uploadRes = await page.request.post('/api/mobile-relay/upload', {
      multipart: {
        token: relayJson.token,
        targetMode: 'RUBRIC',
        pages: {
          name: 'musterloesung.png',
          mimeType: 'image/png',
          buffer: imageBuffer,
        },
      },
    });
    expect(uploadRes.status()).toBe(200);
    const uploadJson = await uploadRes.json();
    expect(uploadJson.targetMode).toBe('RUBRIC');
    expect(uploadJson.pagesCount).toBe(1);

    // Verify desktop polling endpoint (/api/mobile-relay?token=...) now returns the scannedDocument
    const pollRes = await page.request.get(
      `/api/mobile-relay?token=${encodeURIComponent(relayJson.token)}`
    );
    expect(pollRes.status()).toBe(200);
    const pollJson = await pollRes.json();
    expect(pollJson.scannedDocument).not.toBeNull();
    expect(pollJson.scannedDocument.targetMode).toBe('RUBRIC');
    expect(pollJson.scannedDocument.pageCount).toBe(1);
  });

  test('2. Seeded Teacher Login (Konto B) -> Two-Account Isolation (#103) -> Correction Workspace (/correct/[id]) -> Resolve AI Uncertainty -> Speed-Grading Sibling Navigation', async ({
    page,
  }) => {
    await page.goto('/login');
    await page
      .getByLabel(/E-Mail/i)
      .first()
      .fill('lehrer@schule.ch');
    await page
      .getByLabel(/Passwort/i)
      .first()
      .fill('password123');
    await page.getByRole('button', { name: /Anmelden|Login/i }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

    // --- Two-Account Isolation Check (#103): Konto B (lehrer@schule.ch) cannot read or modify Konto A's resources ---
    const [bClassesRes, bExamsRes] = await Promise.all([
      page.request.get('/api/classes'),
      page.request.get('/api/exams'),
    ]);
    expect(bClassesRes.status()).toBe(200);
    expect(bExamsRes.status()).toBe(200);
    const bClassesText = await bClassesRes.text();
    const bExamsText = await bExamsRes.text();
    expect(bClassesText).not.toContain('Gymnasium 10b');
    expect(bExamsText).not.toContain('Algebra Prüfung 1');

    if (kontoAClassId) {
      const foreignClassDetail = await page.request.get(`/api/classes/${kontoAClassId}`);
      expect(foreignClassDetail.status()).toBe(404);
      const foreignClassUpdate = await page.request.put(`/api/classes/${kontoAClassId}`, {
        data: { name: 'Konto B Manipulation' },
      });
      expect(foreignClassUpdate.status()).toBe(404);
    }

    if (kontoAExamId) {
      const foreignExamDetail = await page.request.get(`/api/exams/${kontoAExamId}`);
      expect(foreignExamDetail.status()).toBe(403);
      const foreignExamUpdate = await page.request.put(`/api/exams/${kontoAExamId}`, {
        data: { title: 'Konto B Manipulation', maxPoints: 10 },
      });
      expect(foreignExamUpdate.status()).toBe(403);
      const foreignExamDelete = await page.request.delete(`/api/exams/${kontoAExamId}`);
      expect(foreignExamDelete.status()).toBe(403);
    }

    // Open Max Mustermann's seeded submission (has the uncertain KI step) in the Correction Workspace
    const maxRow = page.getByRole('row', { name: /Max Mustermann/i });
    const openWorkspaceBtn = maxRow.getByRole('button', { name: /Workspace öffnen/i });
    await expect(openWorkspaceBtn).toBeVisible();
    await openWorkspaceBtn.click();

    await expect(page).toHaveURL(/\/correct\/.+/);
    await expect(page.getByText(/KI-Unsicherheit erkannt/i)).toBeVisible();

    // Jump to the uncertain task and confirm review
    const jumpBtn = page.getByRole('button', { name: /Zur Aufgabe springen/i });
    if (await jumpBtn.isVisible()) {
      await jumpBtn.click();
    }
    const resolveBtn = page.getByRole('button', { name: /Als geprüft bestätigen/i });
    await expect(resolveBtn).toBeVisible();
    await resolveBtn.click();

    // Banner should disappear once resolved
    await expect(page.getByText(/KI-Unsicherheit erkannt/i)).toHaveCount(0);

    // Navigate to sibling student via Speed-Grading button
    const nextStudentBtn = page.getByRole('button', { name: /Nächste\/r \(Sarah Tobler\)/i });
    await expect(nextStudentBtn).toBeVisible();
    await nextStudentBtn.click();
    await expect(page.getByText(/Sehr gut gelöst!/i).first()).toBeVisible();
  });

  test('3. Duplicate Registration Recovery (#99), Password-Reset Request & Email Verification Landing Page', async ({
    page,
  }) => {
    // 0. Duplicate email registration shows recovery paths (resend verification, OAuth sign-in, password reset) (#99)
    await page.goto('/register');
    await page.getByLabel(/Name/i).first().fill(teacherName);
    await page
      .getByLabel(/E-Mail/i)
      .first()
      .fill(teacherEmail);
    await page
      .getByLabel(/^Passwort$/i)
      .first()
      .fill(teacherPassword);
    await page.getByLabel(/Passwort wiederholen/i).fill(teacherPassword);
    await page
      .getByRole('button', { name: /Registrieren|Konto erstellen|Account erstellen/i })
      .click();

    const errorAlert = page.getByTestId('register-error-alert');
    await expect(errorAlert).toBeVisible();
    await expect(errorAlert).toContainText(/Google oder Microsoft/i);
    await expect(errorAlert).toContainText(/Passwort-Zurücksetzen/i);

    const resendFromErrorBtn = errorAlert.getByRole('button', {
      name: /Bestätigungs-E-Mail erneut senden/i,
    });
    await expect(resendFromErrorBtn).toBeVisible();
    await resendFromErrorBtn.click();
    await expect(page.getByTestId('register-resend-feedback')).toBeVisible();

    // 1. Forgot password request
    await page.goto('/login');
    await page.getByRole('link', { name: /Passwort vergessen\?/i }).click();
    await expect(page).toHaveURL(/\/forgot-password/);

    await page.getByLabel(/E-Mail-Adresse/i).fill(teacherEmail);
    await page.getByRole('button', { name: /Link zum Zurücksetzen senden/i }).click();
    await expect(
      page
        .getByText(/E-Mail-Versand ist derzeit nicht aktiv|Falls ein (Account|Konto) mit/i)
        .first()
    ).toBeVisible();

    // 2. Verification page renders gracefully on invalid/missing token
    await page.goto('/verify-email');
    await expect(page.getByText(/Bestätigung fehlgeschlagen/i)).toBeVisible();
    await expect(page.getByText(/Neuen Bestätigungs-Link anfordern/i)).toBeVisible();
  });
});
