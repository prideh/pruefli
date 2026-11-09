import { test, expect } from '@playwright/test';

test.describe('Generate Exam from Teaching Material (Teacher-reviewed, Traceable, Frozen)', () => {
  const teacherEmail = 'lehrer@schule.ch';
  const teacherPassword = 'password123';

  test('E2E: Mandatory Material Check -> Review Draft -> Tasks with Sources -> Single-Task Regenerate -> Approval Freeze -> Print Sheet', async ({
    page,
  }) => {
    // 1. Teacher Login
    await page.goto('/login');
    await page
      .getByLabel(/E-Mail/i)
      .first()
      .fill(teacherEmail);
    await page
      .getByLabel(/Passwort/i)
      .first()
      .fill(teacherPassword);
    await page.getByRole('button', { name: /Anmelden|Login/i }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

    // 2. Navigate to Exams page
    await page.goto('/exams');
    await expect(page.getByText('Prüfungsverwaltung')).toBeVisible();

    // 3. Open "Prüfung generieren" Dialog
    const genBtn = page.getByRole('button', { name: /Prüfung generieren/i });
    await expect(genBtn).toBeVisible();
    await genBtn.click();

    await expect(
      page.getByRole('heading', { name: /Prüfung aus Unterrichtsmaterial generieren/i })
    ).toBeVisible();

    // 4. Verification of Mandatory Material: Attempt submit without material
    const submitGenBtn = page.getByRole('button', { name: /Prüfung jetzt generieren/i });
    await submitGenBtn.click();
    await expect(page.getByText(/Unterrichtsmaterial ist erforderlich/i)).toBeVisible();

    // 5. Fill Material Text & Intercept generation API for deterministic testing
    const sampleMaterial = `=== Dossier: Lineare Gleichungen (Sekundarstufe I) ===
Kapitel 1 (Seite 3): ax + b = c.
Kapitel 2 (Seite 5): 2(x + 3) = 14 -> 2x + 6 = 14 -> 2x = 8 -> x = 4.
Kapitel 3 (Seite 9): Textaufgabe zur Altersdifferenz.`;

    await page.getByPlaceholder(/Alternativ: Text des Unterrichtsmaterials/i).fill(sampleMaterial);

    const generatedExamId = 'e2e-generated-exam-' + Date.now();
    await page.route('**/api/exams/generate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          examId: generatedExamId,
          cached: false,
          exam: {
            id: generatedExamId,
            title: 'Lineare Gleichungen (Generiert)',
          },
        }),
      });
    });

    // Mock exam details for the generated exam
    let isApprovedState = false;
    let task2Title = 'Aufgabe 2: Gleichung auflösen';
    let task2Source = 'Kapitel 2, Seite 5, Beispiel 1';

    await page.route(`**/api/exams/${generatedExamId}`, async (route, req) => {
      if (req.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            exam: {
              id: generatedExamId,
              title: 'Lineare Gleichungen (Generiert)',
              classId: 'class-1',
              className: 'Sekundarklasse 3a',
              subject: 'Mathematik',
              maxPoints: 10,
              examTemplateText: `# Lineare Gleichungen\n\n**Name:** _______________________\n**Datum:** _______________________\n**Punkte:** _____ / 10 Punkte\n\n---\n\n### Hinweise:\n- Löse alle Aufgaben **direkt auf diesem Blatt**.\n\n---\n\n## Aufgabe 1 (4 Pkt.)\nLöse die Gleichung:\n$$8 + 5 = \\text{_____}$$\n\n## ${task2Title} (6 Pkt.)\nLöse $\\frac{x + 3}{2} = 7$.`,
              rubricText: `# Musterlösung\n\n## Aufgabe 1 (4 Pkt.)\nx = 4 (4 P.)\n\n## ${task2Title} (6 Pkt.)\n2x + 6 = 14 -> x = 4 (6 P.)`,
              gradingNotes: 'Lehrperson Hinweise',
              isGenerated: true,
              isApproved: isApprovedState,
              approvedAt: isApprovedState ? new Date().toISOString() : null,
              tasks: [
                {
                  id: 't-1',
                  taskId: '1',
                  title: 'Aufgabe 1: Grundgleichung',
                  maxPoints: 4,
                  orderIndex: 0,
                  sourceReference: 'Kapitel 1, Seite 3',
                },
                {
                  id: 't-2',
                  taskId: '2',
                  title: task2Title,
                  maxPoints: 6,
                  orderIndex: 1,
                  sourceReference: task2Source,
                },
              ],
            },
            stats: {
              averageGrade: '—',
              passRate: '—',
              highestGrade: '—',
              lowestGrade: '—',
              stdDev: '0.00',
              totalCompleted: 0,
              gradeDistribution: {},
            },
            roster: [],
            taskAnalysis: null,
          }),
        });
      } else {
        await route.fallback();
      }
    });

    // Mock regenerate single task
    await page.route(`**/api/exams/${generatedExamId}/regenerate-task`, async (route) => {
      task2Title = 'Aufgabe 2 (neu): Geometrischer Gleichungsansatz';
      task2Source = 'Kapitel 2, Seite 6, Übung 4';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          cached: false,
          task: {
            taskId: '2',
            title: task2Title,
            maxPoints: 6,
            sourceReference: task2Source,
            taskQuestion: 'Berechne x anhand des Dreieckumfangs.',
            taskSolution: '3x + 2 = 14 -> x = 4 (6 P.)',
          },
        }),
      });
    });

    // Mock approve route
    await page.route(`**/api/exams/${generatedExamId}/approve`, async (route) => {
      isApprovedState = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: 'Prüfung erfolgreich freigegeben und eingefroren.',
        }),
      });
    });

    // Trigger Generation submit
    await submitGenBtn.click();
    await expect(page).toHaveURL(new RegExp(`/exams/${generatedExamId}`), { timeout: 15000 });

    // 6. Verify Teacher Review Gate: Draft banner is shown, print buttons disabled
    await expect(page.getByText('KI-Entwurf: Freigabe erforderlich')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Prüfung freigeben & einfrieren/i })
    ).toBeVisible();

    // Verify task sheet print button is disabled for unapproved draft
    const printTaskSheetBtn = page.getByRole('button', { name: /Aufgabenblatt drucken/i });
    await expect(printTaskSheetBtn).toBeDisabled();

    // 7. Verify Tasks Table & Traceability (Source References)
    await expect(page.getByText('Prüfungsaufgaben & Bepunktung')).toBeVisible();
    await expect(page.getByText('Kapitel 1, Seite 3')).toBeVisible();
    await expect(page.getByText('Kapitel 2, Seite 5, Beispiel 1')).toBeVisible();

    // 8. Single-Task Regenerate: Click "Neu generieren" for Task 2
    const taskRows = page.getByRole('row');
    const task2Row = taskRows.filter({ hasText: 'Aufgabe 2' });
    const regenBtn = task2Row.getByRole('button', { name: /Neu generieren/i });
    await expect(regenBtn).toBeVisible();
    await regenBtn.click();

    // Dialog opens
    await expect(page.getByRole('heading', { name: /Aufgabe neu generieren/i })).toBeVisible();
    await page.getByPlaceholder(/Mehr Fokus auf/i).fill('Mehr Geometrie-Bezug');
    await page.getByRole('button', { name: 'Aufgabe neu generieren' }).click();

    // Verify updated task title & updated source reference without losing task 1
    await expect(page.getByText('Aufgabe 2 (neu): Geometrischer Gleichungsansatz')).toBeVisible();
    await expect(page.getByText('Kapitel 2, Seite 6, Übung 4')).toBeVisible();
    await expect(page.getByText('Aufgabe 1: Grundgleichung')).toBeVisible(); // Task 1 preserved!

    // 9. Teacher approves and freezes the exam
    const approveBtn = page.getByRole('button', { name: /Prüfung freigeben & einfrieren/i });
    await approveBtn.click();

    // Verify Frozen state: Banner changes to green "Freigegeben & Eingefroren"
    await expect(page.getByText('Freigegeben & Eingefroren')).toBeVisible();
    await expect(page.getByText('Unveränderlich').first()).toBeVisible();

    // "Neu generieren" buttons are now replaced by "Eingefroren" chips
    await expect(page.getByRole('button', { name: /Neu generieren/i })).toHaveCount(0);

    // Print button is now enabled
    await expect(printTaskSheetBtn).toBeEnabled();

    // 10. Open Printable Task Sheet (/exams/[id]/print-task-sheet)
    await page.goto(`/exams/${generatedExamId}/print-task-sheet`);
    await expect(page.getByText('Druckansicht (Aufgabenblatt)')).toBeVisible();
    await expect(page.getByRole('button', { name: /Drucken \/ Als PDF speichern/i })).toBeVisible();
    await expect(page.getByText('Name / Vorname:')).toBeVisible();
    await expect(page.getByText('Lineare Gleichungen (Generiert)')).toBeVisible();

    // Issue #120 verification: Formatted headings, math & stripped duplicate header
    const sheetBody = page.getByTestId('formatted-task-sheet-body');
    await expect(sheetBody).toBeVisible();
    await expect(sheetBody).toContainText('Hinweise:');
    await expect(sheetBody).toContainText('direkt auf diesem Blatt');
    await expect(sheetBody).toContainText('Aufgabe 1 (4 Pkt.)');
    await expect(sheetBody.locator('.katex')).toHaveCount(2);
    await expect(sheetBody.locator('.mfrac')).toBeVisible();

    // Verify no raw Markdown, LaTeX, or duplicate header fields leak into the task sheet body
    const bodyText = (await sheetBody.innerText()) || '';
    expect(bodyText).not.toContain('#');
    expect(bodyText).not.toContain('**');
    expect(bodyText).not.toContain('---');
    expect(bodyText).not.toContain('$$');
    expect(bodyText).not.toContain('\\text');
    expect(bodyText).not.toContain('\\frac');
    expect(bodyText).not.toContain('Name:');
    expect(bodyText).not.toContain('Datum:');
    expect(bodyText).not.toContain('Punkte:');
    expect(bodyText).not.toContain('/ 10 Punkte');

    // Verify QR code badge is OFF by default and can be toggled ON
    await expect(page.getByTestId('smart-exam-qr-badge')).toHaveCount(0);
    await page.getByLabel('QR-Code auf Aufgabenblatt').check();
    await expect(page.getByTestId('smart-exam-qr-badge')).toBeVisible();
  });
});
