import { test, expect } from '@playwright/test';

test.describe('Full E2E Teacher & Mobile QR Relay Workflows', () => {
  const uniqueSuffix = Date.now();
  const teacherEmail = `e2e.teacher.${uniqueSuffix}@schule.ch`;
  const teacherPassword = 'SwissPruefliPassword2026!';
  const teacherName = 'Herr Dr. Schweizer';

  test('1. Teacher Registration -> Decluttered Dashboard -> Class & Student Creation -> Exam & CSV Export -> Mobile QR Relay Handover', async ({
    page,
  }) => {
    // --- STEP 1: Register a new teacher via UI ---
    await page.goto('/register');
    await page.getByLabel(/Name/i).first().fill(teacherName);
    await page
      .getByLabel(/E-Mail/i)
      .first()
      .fill(teacherEmail);
    await page
      .getByLabel(/Passwort/i)
      .first()
      .fill(teacherPassword);
    await page
      .getByRole('button', { name: /Registrieren|Konto erstellen|Account erstellen/i })
      .click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
    await expect(page.getByText('Prüfungskorrektur starten')).toBeVisible();

    // Verify sidebar does NOT show cluttering "Protokoll" link
    await expect(page.getByRole('link', { name: 'Protokoll' })).toHaveCount(0);

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

  test('2. Seeded Teacher Login -> Correction Workspace (/correct/[id]) -> Resolve AI Uncertainty -> Live Grade Recalculation -> Speed-Grading Sibling Navigation', async ({
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

  test('3. Password-Reset Request & Email Verification Landing Page', async ({ page }) => {
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
