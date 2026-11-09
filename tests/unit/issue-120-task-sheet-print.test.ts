import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  formatLatexMath,
  parseInlineTaskSheetTokens,
  parseTaskSheetBlocks,
  renderLatexMath,
  renderTaskSheetToPlainText,
  sanitizeExamTemplateText,
  stripDuplicateWorksheetHeader,
  stripInlineMarkdown,
} from '@/lib/task-sheet-print';

const ISSUE_120_RAW_FIXTURE = `# Prüfung: Grundrechenarten

**Name:** ______________________ **Datum:** ____________
**Punkte:** _____ / 6 Punkte

---

### Hinweise:
- Löse alle Aufgaben direkt auf diesem Blatt.
- Schreibe den vollständigen **Rechnungsweg** sauber auf.

---

### Aufgabe 1: Addition (2 Punkte)
Berechne die folgende Summe:
$$8 + 5 = \\text{_____}$$

_____________________________

---

### Aufgabe 2: Subtraktion und Multiplikation (2 Punkte)
Löse die beiden Rechnungen:
a) $$19 - 7 = \\text{_____}$$
b) $6 \\cdot 4 = \\underline{\\hspace{2cm}}$

### Aufgabe 3: Bruchrechnen und Wurzeln (2 Punkte)
Berechne $\\frac{3}{4} + \\frac{1}{4} = \\text{_____}$ sowie $\\sqrt{16} + 3^2 = \\text{_____}$.`;

describe('Issue #120: Task Sheet Print Rendering, KaTeX Math Semantics & Duplicate Header Stripping', () => {
  it('strips duplicate title and Name/Datum/Punkte header lines (including trailing "/ 6 Punkte" suffix) from examTemplateText preamble', () => {
    const stripped = stripDuplicateWorksheetHeader(ISSUE_120_RAW_FIXTURE, {
      examTitle: 'Prüfung: Grundrechenarten',
    });

    expect(stripped).not.toContain('# Prüfung: Grundrechenarten');
    expect(stripped).not.toMatch(/\*\*Name:\*\*/);
    expect(stripped).not.toMatch(/\*\*Datum:\*\*/);
    expect(stripped).not.toMatch(/\*\*Punkte:\*\*/);
    expect(stripped).not.toContain('/ 6 Punkte');
    expect(stripped).not.toMatch(/^---/);

    expect(stripped).toContain('### Hinweise:');
    expect(stripped).toContain('### Aufgabe 1: Addition (2 Punkte)');
    expect(stripped).toContain('### Aufgabe 2: Subtraktion und Multiplikation (2 Punkte)');
    expect(stripped).toContain('### Aufgabe 3: Bruchrechnen und Wurzeln (2 Punkte)');
  });

  it('strips multi-line, pipe-separated, and bulleted header metadata while keeping legitimate instructions', () => {
    const variantHeader = `## Lernzielkontrolle: Brüche
- **Name / Vorname:** ________________________
- **Klasse:** 6a | **Fach:** Mathematik | **Datum:** __________
- **Erreichte Punkte:** ____ / 12 P. | **Note:** ______
---
**Hilfsmittel:** Geodreieck und Zirkel (kein Taschenrechner).

### Aufgabe 1 (4 Punkte)
Zeichne einen Winkel von $45^\\circ$.`;

    const stripped = stripDuplicateWorksheetHeader(variantHeader, {
      examTitle: 'Brüche',
    });

    expect(stripped).not.toContain('Lernzielkontrolle: Brüche');
    expect(stripped).not.toContain('Name / Vorname');
    expect(stripped).not.toContain('Erreichte Punkte');
    expect(stripped).not.toContain('Note:');

    expect(stripped).toContain('Hilfsmittel:');
    expect(stripped).toContain('Geodreieck und Zirkel');
    expect(stripped).toContain('### Aufgabe 1 (4 Punkte)');
  });

  it('strips preamble points lines across "/ 6 Punkte", decimal comma/dot, and unit variants while preserving legitimate task points and instructions', () => {
    // 1. Exact live-QA reproduction preamble
    const liveQaCase = `# Prüfung: Grundrechenarten
**Name:** ___ **Datum:** ___
**Punkte:** _____ / 6 Punkte

### Aufgabe 1: Addition (2 Punkte)
Berechne $4 + 2 = \\text{_____}$.`;

    const strippedLiveQa = stripDuplicateWorksheetHeader(liveQaCase, {
      examTitle: 'Prüfung: Grundrechenarten',
    });
    expect(strippedLiveQa).toBe(
      `### Aufgabe 1: Addition (2 Punkte)\nBerechne $4 + 2 = \\text{_____}$.`
    );

    // 2. Positive variants: integer, comma decimal, dot decimal, Punkt/Punkte/Punkten/Pkt./Pt./P., "von"/"aus", and standalone score line
    const positivePointsPreambles = [
      '**Punkte:** _____ / 6 Punkte',
      '**Punkte:** ___ / 6,5 Punkte',
      '**Punkte:** ___ / 6.5 Punkte',
      '**Punkte:** _____ / 12,5 Pkt.',
      '**Punkte:** _____ / 10 P.',
      '**Punkte:** _____ / 10 Pt.',
      '**Punkte:** ___ / 1 Punkt',
      '**Punkte:** _____ von 6 Punkten',
      '**Punkte:** _____ aus 15,5 Punkten',
      '**Erreichte Punkte:** _____ / 20 Punkte',
      '**Max. Punkte:** 6,5 Punkte',
      '**Gesamtpunkte:** 12 Punkte',
      '**Name:** ___ **Datum:** ___ **Punkte:** _____ / 6 Punkte',
      'Punkte: ______ / 8,5 Punkte | Note: ______',
      '_____ / 6 Punkte',
      '/ 6,5 Punkte',
    ];

    for (const pointsLine of positivePointsPreambles) {
      const sample = `# Prüfung: Grundrechenarten\n${pointsLine}\n\n### Aufgabe 1 (2 Punkte)\nRechne.`;
      const result = stripDuplicateWorksheetHeader(sample, {
        examTitle: 'Prüfung: Grundrechenarten',
      });
      expect(result).toBe('### Aufgabe 1 (2 Punkte)\nRechne.');
    }

    // 3. Negative controls: legitimate preamble instructions mentioning points and task headings/subtasks with points MUST be preserved
    const negativeControlDoc = `# Prüfung: Grundrechenarten
**Name:** ___ **Datum:** ___
**Punkte:** _____ / 6 Punkte
---
### Hinweise:
- Für jede korrekte Lösung gibt es 2 Punkte (insgesamt 6 Punkte).
- Bei Aufgabe 2 werden 1,5 Punkte für den Lösungsweg vergeben.
- **Bewertung:** Maximal 6 Punkte erreichbar; Teilpunkte (0,5 Punkte) sind möglich.
- **Punkteverteilung:** Aufgabe 1 zählt 2 Punkte, Aufgabe 2 zählt 2,5 Punkte, Aufgabe 3 zählt 1,5 Punkte.

### Aufgabe 1: Addition (2 Punkte)
Löse die Rechnung (je 1 Punkt):
a) $3 + 3 = \\text{_____}$ (1 Punkt)
b) $5 + 4 = \\text{_____}$ (1 Punkt)

### Aufgabe 2: Dezimalzahlen (2,5 Punkte)
Berechne (2.5 Pkt.):
$$1,5 + 2,5 = \\text{_____}$$

### Aufgabe 3: Textaufgabe (1.5 Punkte)
Erkläre deinen Rechenweg für volle 1,5 Punkte.`;

    const strippedNegative = stripDuplicateWorksheetHeader(negativeControlDoc, {
      examTitle: 'Prüfung: Grundrechenarten',
    });

    // Preamble duplicate header stripped
    expect(strippedNegative).not.toContain('# Prüfung: Grundrechenarten');
    expect(strippedNegative).not.toContain('**Name:**');
    expect(strippedNegative).not.toContain('**Punkte:** _____ / 6 Punkte');

    // Legitimate preamble instructions mentioning points preserved intact
    expect(strippedNegative).toContain(
      '- Für jede korrekte Lösung gibt es 2 Punkte (insgesamt 6 Punkte).'
    );
    expect(strippedNegative).toContain(
      '- Bei Aufgabe 2 werden 1,5 Punkte für den Lösungsweg vergeben.'
    );
    expect(strippedNegative).toContain(
      '- **Bewertung:** Maximal 6 Punkte erreichbar; Teilpunkte (0,5 Punkte) sind möglich.'
    );
    expect(strippedNegative).toContain(
      '- **Punkteverteilung:** Aufgabe 1 zählt 2 Punkte, Aufgabe 2 zählt 2,5 Punkte, Aufgabe 3 zählt 1,5 Punkte.'
    );

    // Task headings and inline point annotations preserved intact
    expect(strippedNegative).toContain('### Aufgabe 1: Addition (2 Punkte)');
    expect(strippedNegative).toContain('Löse die Rechnung (je 1 Punkt):');
    expect(strippedNegative).toContain('a) $3 + 3 = \\text{_____}$ (1 Punkt)');
    expect(strippedNegative).toContain('### Aufgabe 2: Dezimalzahlen (2,5 Punkte)');
    expect(strippedNegative).toContain('Berechne (2.5 Pkt.):');
    expect(strippedNegative).toContain('### Aufgabe 3: Textaufgabe (1.5 Punkte)');
    expect(strippedNegative).toContain('Erkläre deinen Rechenweg für volle 1,5 Punkte.');
  });

  it('renders real KaTeX HTML for standard worksheet math and preserves answer blanks', () => {
    const addition = renderLatexMath('$$8 + 5 = \\text{_____}$$', { displayMode: true });
    expect(addition.isFallback).toBe(false);
    expect(addition.html).toContain('katex-display');
    expect(addition.html).toContain('_____');
    expect(addition.text).toBe('8 + 5 = _____');

    const multiplication = renderLatexMath('$6 \\cdot 4 = \\underline{\\hspace{2cm}}$');
    expect(multiplication.isFallback).toBe(false);
    expect(multiplication.html).toContain('katex');
    expect(multiplication.text).toBe('6 · 4 = ________');
  });

  it('preserves mathematical scope and notation on semantic edge cases in both KaTeX and formatLatexMath', () => {
    // 1. \sqrt{a}b: radical applies ONLY to a, with b outside the radical
    const sqrtScope = renderLatexMath('\\sqrt{a}b');
    expect(sqrtScope.isFallback).toBe(false);
    expect(sqrtScope.html).toContain('mord sqrt');
    // Verify 'b' is rendered after the closing sqrt span, not inside the radicand
    const sqrtCloseIdx = sqrtScope.html.indexOf('</svg>');
    const bSpanIdx = sqrtScope.html.indexOf('<span class="mord mathnormal">b</span>');
    expect(sqrtCloseIdx).toBeGreaterThan(0);
    expect(bSpanIdx).toBeGreaterThan(sqrtCloseIdx);
    expect(formatLatexMath('\\sqrt{a}b')).toBe('√(a)b');
    expect(formatLatexMath('\\sqrt{a}b')).not.toBe('√ab');

    // 2. \overline{AB}: preserves overline notation in KaTeX (.katex-overline / .overline-line) and Unicode combining overline
    const overline = renderLatexMath('\\overline{AB}');
    expect(overline.isFallback).toBe(false);
    expect(overline.html).toContain('katex-overline');
    expect(overline.html).toContain('overline-line');
    expect(formatLatexMath('\\overline{AB}')).toBe('A\u0305B\u0305');
    expect(formatLatexMath('\\overline{AB}')).not.toBe('overlineAB');

    // 3. \begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}: preserves matrix table and parentheses delimiters
    const matrixExpr = '\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}';
    const matrix = renderLatexMath(matrixExpr, { displayMode: true });
    expect(matrix.isFallback).toBe(false);
    expect(matrix.html).toContain('mtable');
    expect(matrix.html).toContain('(');
    expect(matrix.html).toContain(')');
    expect(formatLatexMath(matrixExpr)).toBe('((1, 2); (3, 4))');

    // 4. \frac{1}{2}x: renders stacked fraction 1/2 followed by x in KaTeX, and unambiguous (1/2)x in plain text
    const fracScope = renderLatexMath('\\frac{1}{2}x');
    expect(fracScope.isFallback).toBe(false);
    expect(fracScope.html).toContain('mfrac');
    expect(fracScope.html).toContain('frac-line');
    expect(fracScope.html).toContain('<span class="mord mathnormal">x</span>');
    expect(formatLatexMath('\\frac{1}{2}x')).toBe('(1/2)x');
    expect(formatLatexMath('\\frac{1}{2}x')).not.toBe('1/2x');
  });

  it('uses an explicit bounded fallback for unsupported LaTeX commands instead of silently stripping commands or braces', () => {
    const unsupported = renderLatexMath('\\unknownmacro{x + y}');
    expect(unsupported.isFallback).toBe(true);
    expect(unsupported.latex).toBe('\\unknownmacro{x + y}');
    expect(unsupported.text).toBe('\\unknownmacro{x + y}');
    expect(unsupported.html).toContain('data-math-fallback="true"');
    expect(unsupported.html).toContain('\\unknownmacro{x + y}');

    // formatLatexMath also preserves unknown commands and grouping intact
    expect(formatLatexMath('\\unknownmacro{x + y}')).toBe('\\unknownmacro{x + y}');
  });

  it('parses multi-line display math blocks (including pmatrix) and inline math tokens cleanly', () => {
    const multiLineTemplate = `### Aufgabe 1: Matrizen und Geometrie (4 Punkte)
Gegeben sei die Strecke $\\overline{AB}$, der Term $\\sqrt{a}b$ sowie $\\frac{1}{2}x$:
$$
M = \\begin{pmatrix}
1 & 2 \\\\
3 & 4
\\end{pmatrix}
$$`;

    const blocks = parseTaskSheetBlocks(multiLineTemplate);
    const mathBlocks = blocks.filter((b) => b.type === 'math');
    expect(mathBlocks).toHaveLength(1);
    expect(mathBlocks[0].isFallback).toBe(false);
    expect(mathBlocks[0].html).toContain('mtable');
    expect(mathBlocks[0].text).toBe('M = ((1, 2); (3, 4))');

    const paragraph = blocks.find((b) => b.type === 'paragraph');
    expect(paragraph).toBeDefined();
    const inlineMathTokens = paragraph!.tokens.filter((t) => t.type === 'math');
    expect(inlineMathTokens).toHaveLength(3);
    expect(inlineMathTokens[0].content).toBe('A\u0305B\u0305');
    expect(inlineMathTokens[1].content).toBe('√(a)b');
    expect(inlineMathTokens[2].content).toBe('(1/2)x');
  });

  it('parses the full Issue #120 fixture into structured blocks with zero raw Markdown or raw LaTeX leakage', () => {
    const blocks = parseTaskSheetBlocks(ISSUE_120_RAW_FIXTURE, {
      examTitle: 'Prüfung: Grundrechenarten',
    });

    const plainRendered = renderTaskSheetToPlainText(blocks);

    expect(plainRendered).not.toContain('#');
    expect(plainRendered).not.toContain('**');
    expect(plainRendered).not.toContain('$$');
    expect(plainRendered).not.toContain('\\text');
    expect(plainRendered).not.toContain('\\frac');
    expect(plainRendered).not.toContain('\\sqrt');
    expect(plainRendered).not.toContain('\\cdot');

    expect(plainRendered).toContain('Hinweise:');
    expect(plainRendered).toContain('Aufgabe 1: Addition (2 Punkte)');
    expect(plainRendered).toContain('8 + 5 = _____');
    expect(plainRendered).toContain('a) 19 - 7 = _____');
    expect(plainRendered).toContain('b) 6 · 4 = ________');
    expect(plainRendered).toContain('3/4 + 1/4 = _____');
    expect(plainRendered).toContain('√16 + 3² = _____');

    const sanitized = sanitizeExamTemplateText(ISSUE_120_RAW_FIXTURE, {
      examTitle: 'Prüfung: Grundrechenarten',
    });
    expect(sanitized).toBe(plainRendered);
  });

  it('parses inline bold, italic, and code tokens while preserving answer blanks (_____)', () => {
    const line = 'Schreibe den **Rechnungsweg** für `x + y` auf: __________';
    const tokens = parseInlineTaskSheetTokens(line);

    expect(tokens.some((t) => t.type === 'bold' && t.content === 'Rechnungsweg')).toBe(true);
    expect(tokens.some((t) => t.type === 'code' && t.content === 'x + y')).toBe(true);
    expect(tokens.map((t) => t.content).join('')).toBe(
      'Schreibe den Rechnungsweg für x + y auf: __________'
    );
    expect(stripInlineMarkdown(line)).toBe('Schreibe den Rechnungsweg für x + y auf: __________');
  });

  it('keeps print-task-sheet page wired to KaTeX CSS, structured blocks, teacher approval gate, and optional QR toggle without mutating lib/exam-generator.ts', () => {
    const pagePath = path.resolve(process.cwd(), 'app/exams/[id]/print-task-sheet/page.tsx');
    const pageSource = fs.readFileSync(pagePath, 'utf-8');

    expect(pageSource).toContain("import 'katex/dist/katex.min.css'");
    expect(pageSource).toContain('parseTaskSheetBlocks');
    expect(pageSource).toContain('data-testid="formatted-task-sheet-body"');
    expect(pageSource).toContain('data-testid="task-sheet-math-block"');
    expect(pageSource).toContain('data-testid="task-sheet-inline-math"');
    expect(pageSource).toContain('data-testid="task-sheet-math-fallback"');

    // Teacher approval gate preserved
    expect(pageSource).toContain('const isApproved = exam.isApproved !== false;');
    expect(pageSource).toContain('Drucken nicht möglich: Prüfung noch nicht freigegeben');

    // QR code toggle default OFF and optional ON preserved
    expect(pageSource).toContain('useState<boolean>(false)');
    expect(pageSource).toContain('QR-Code auf Aufgabenblatt');
    expect(pageSource).toContain('showQrSheet && qrDataUrl');

    // Verify lib/exam-generator.ts does not destructively rewrite generated content via task-sheet-print
    const generatorPath = path.resolve(process.cwd(), 'lib/exam-generator.ts');
    const generatorSource = fs.readFileSync(generatorPath, 'utf-8');
    expect(generatorSource).not.toContain('task-sheet-print');
  });
});
