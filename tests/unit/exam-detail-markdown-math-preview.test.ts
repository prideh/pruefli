import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import ExamMarkdownMathPreview from '@/components/ExamMarkdownMathPreview';
import {
  parseExamPreviewBlocks,
  parseExamPreviewInlineTokens,
  renderExamPreviewMath,
} from '@/lib/exam-detail-preview';

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
].join('\n');

const SYNTHETIC_SOLUTION_RUBRIC = [
  '### Musterlösung',
  '**Aufgabe 1**',
  '- Ausgangsrechnung: $8+5$',
  '- Schrittweise Zerlegung über den Zehner: $8+2+3$',
  '- Endergebnis: $13$',
  '- Bewertung: **1 Punkt** für den Zwischenschritt ($8+2+3$), **1 Punkt** für das korrekte Resultat ($13$).',
].join('\n');

function stripHtmlTags(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");
}

describe('Exam Detail Markdown & Math Preview (Aufgabenblatt & Musterloesung)', () => {
  describe('1. Synthetische Schuelervorschau (Aufgabenblatt / TEMPLATE Tab)', () => {
    it('rendert # Pruefung: Grundrechenarten, **Name:** ___, **Punkte:** ____ /6 Punkte, ### Hinweise und Aufzaehlungen vollstaendig ohne Stripping', () => {
      const blocks = parseExamPreviewBlocks(SYNTHETIC_STUDENT_TEMPLATE);

      // Titel und Kopfzeilen duerfen in der Detail-Vorschau NICHT entfernt werden
      expect(blocks[0]).toMatchObject({
        type: 'heading',
        level: 1,
        text: 'Prüfung: Grundrechenarten',
      });
      expect(blocks[1]).toMatchObject({
        type: 'paragraph',
        text: '**Name:** ___',
      });
      expect(blocks[2]).toMatchObject({
        type: 'paragraph',
        text: '**Punkte:** ____ /6 Punkte',
      });
      expect(blocks[3]).toMatchObject({
        type: 'heading',
        level: 3,
        text: 'Hinweise',
      });
      expect(blocks[4]).toMatchObject({
        type: 'list',
        ordered: false,
      });

      const html = renderToStaticMarkup(
        React.createElement(ExamMarkdownMathPreview, {
          content: SYNTHETIC_STUDENT_TEMPLATE,
          testId: 'exam-template-preview',
        })
      );
      const visibleText = stripHtmlTags(html);

      // Semantische Ueberschriften h1 und h3 vorhanden
      expect(html).toMatch(/<h1[^>]*>Prüfung: Grundrechenarten<\/h1>/);
      expect(html).toMatch(/<h3[^>]*>Hinweise<\/h3>/);

      // Fettdruck-Elemente <strong> fuer Name:, Punkte: und Aufgabe 1 (2 Punkte)
      expect(html).toMatch(/<strong[^>]*>Name:<\/strong> ___/);
      expect(html).toMatch(/<strong[^>]*>Punkte:<\/strong> ____ \/6 Punkte/);
      expect(html).toMatch(/<strong[^>]*>Aufgabe 1 \(2 Punkte\)<\/strong>/);

      // Lueckentext-Unterstriche bleiben exakt erhalten und werden nicht als Markdown-Emphasis verschluckt
      expect(visibleText).toContain('Name: ___');
      expect(visibleText).toContain('Punkte: ____ /6 Punkte');

      // Aufzaehlungsliste wird als echte <ul><li>-Struktur gerendert
      expect(html).toContain('<ul');
      expect(html).toMatch(/<li[^>]*>Lies jede Aufgabe sorgfältig durch\.<\/li>/);
      expect(html).toMatch(/<li[^>]*>Schreibe alle Zwischenschritte sauber auf\.<\/li>/);
      expect(html).toMatch(/<li[^>]*>Taschenrechner sind nicht erlaubt\.<\/li>/);

      // Mathematik ($8+5$) wird via KaTeX gerendert
      expect(html).toContain('class="katex"');

      // Keine rohen Markdown-Begrenzer im sichtbaren Text
      expect(visibleText).not.toContain('# Prüfung');
      expect(visibleText).not.toContain('### Hinweise');
      expect(visibleText).not.toContain('**Name:**');
      expect(visibleText).not.toContain('**Punkte:**');
      expect(visibleText).not.toContain('$8+5$');
    });
  });

  describe('2. Synthetische Musterloesungs-Vorschau (Musterloesung & Kriterien / RUBRIC Tab)', () => {
    it('rendert ### Musterloesung, **Aufgabe 1**, $8+5$, $8+2+3$ und $13$ strukturiert und mit KaTeX', () => {
      const html = renderToStaticMarkup(
        React.createElement(ExamMarkdownMathPreview, {
          content: SYNTHETIC_SOLUTION_RUBRIC,
          testId: 'exam-rubric-preview',
        })
      );
      const visibleText = stripHtmlTags(html);

      // ### Musterloesung bleibt als echte h3-Ueberschrift erhalten
      expect(html).toMatch(/<h3[^>]*>Musterlösung<\/h3>/);

      // **Aufgabe 1** und Punkte-Hervorhebungen sind als <strong> formatiert
      expect(html).toMatch(/<strong[^>]*>Aufgabe 1<\/strong>/);
      expect(html).toMatch(/<strong[^>]*>1 Punkt<\/strong>/);

      // Alle 5 Mathe-Ausdruecke ($8+5$, $8+2+3$, $13$, $8+2+3$, $13$) werden als KaTeX gerendert (kein Fallback)
      const katexMatches = html.match(/data-testid="exam-preview-math"/g) || [];
      expect(katexMatches.length).toBe(5);
      expect(html).not.toContain('data-math-fallback="true"');

      // Keine rohen Markdown- oder Dollar-Zeichen im sichtbaren Text
      expect(visibleText).not.toContain('### Musterlösung');
      expect(visibleText).not.toContain('**Aufgabe 1**');
      expect(visibleText).not.toContain('$8+5$');
      expect(visibleText).not.toContain('$8+2+3$');
      expect(visibleText).not.toContain('$13$');
    });
  });

  describe('3. Preservation & Safety Regressions (Review Blockers 1, 2, 3 & Layout Constraints)', () => {
    it('Blocker 1: bewahrt Praefix- und Suffix-Text rund um mehrzeilige und einzeilige $$...$$ sowie \\[...\\] Display-Begrenzer vollstaendig', () => {
      // Fall A: Mehrzeiliges $$ mit Suffix auf der schliessenden Zeile
      const dollarSuffixInput = '$$\n8+5\n$$ KEEP THIS INSTRUCTION';
      const dollarBlocks = parseExamPreviewBlocks(dollarSuffixInput);
      expect(dollarBlocks).toHaveLength(2);
      expect(dollarBlocks[0]).toMatchObject({
        type: 'math-block',
        latex: '8+5',
        isFallback: false,
      });
      expect(dollarBlocks[1]).toMatchObject({
        type: 'paragraph',
        text: 'KEEP THIS INSTRUCTION',
      });

      const dollarHtml = renderToStaticMarkup(
        React.createElement(ExamMarkdownMathPreview, { content: dollarSuffixInput })
      );
      expect(dollarHtml).toContain('class="katex"');
      expect(stripHtmlTags(dollarHtml)).toContain('KEEP THIS INSTRUCTION');

      // Fall B: Mehrzeiliges \[...\] mit Praefix und Suffix
      const bracketPrefixSuffixInput = 'PREFIX INSTRUCTION \\[\n8+5\n\\] KEEP THIS INSTRUCTION';
      const bracketBlocks = parseExamPreviewBlocks(bracketPrefixSuffixInput);
      expect(bracketBlocks).toHaveLength(3);
      expect(bracketBlocks[0]).toMatchObject({
        type: 'paragraph',
        text: 'PREFIX INSTRUCTION',
      });
      expect(bracketBlocks[1]).toMatchObject({
        type: 'math-block',
        latex: '8+5',
        isFallback: false,
      });
      expect(bracketBlocks[2]).toMatchObject({
        type: 'paragraph',
        text: 'KEEP THIS INSTRUCTION',
      });

      // Fall C: Einzeiliges Display-Mathe + Prosa auf derselben Zeile ($$ und \[)
      const sameLineInput = [
        '$$8+5$$ KEEP THIS INSTRUCTION',
        'PREFIX \\[8+2+3\\] SUFFIX INSTRUCTION',
      ].join('\n');
      const sameLineHtml = renderToStaticMarkup(
        React.createElement(ExamMarkdownMathPreview, { content: sameLineInput })
      );
      const sameLineVisible = stripHtmlTags(sameLineHtml);
      expect(sameLineHtml).toContain('class="katex"');
      expect(sameLineVisible).toContain('KEEP THIS INSTRUCTION');
      expect(sameLineVisible).toContain('PREFIX');
      expect(sameLineVisible).toContain('SUFFIX INSTRUCTION');
    });

    it('Blocker 2: behandelt ungeschlossene Display-Begrenzer ($$ und \\[) niemals als gueltiges KaTeX und absorbiert keine spaeteren Aufgaben', () => {
      // Fall A: Ungeschlossenes $$ darf weder als KaTeX gerendert werden noch spaetere Aufgaben verschlucken
      const unclosedDollar = '$$\n8+5\nANOTHER TASK WITHOUT CLOSE';
      const unclosedDollarBlocks = parseExamPreviewBlocks(unclosedDollar);
      expect(unclosedDollarBlocks).toHaveLength(3);
      expect(unclosedDollarBlocks[0]).toMatchObject({
        type: 'math-block',
        raw: '$$',
        isFallback: true,
        html: '',
      });
      expect(unclosedDollarBlocks[1]).toMatchObject({
        type: 'paragraph',
        text: '8+5',
      });
      expect(unclosedDollarBlocks[2]).toMatchObject({
        type: 'paragraph',
        text: 'ANOTHER TASK WITHOUT CLOSE',
      });

      const unclosedDollarHtml = renderToStaticMarkup(
        React.createElement(ExamMarkdownMathPreview, { content: unclosedDollar })
      );
      expect(unclosedDollarHtml).not.toContain('class="katex"');
      expect(unclosedDollarHtml).toContain('data-math-fallback="true"');
      expect(stripHtmlTags(unclosedDollarHtml)).toContain('8+5');
      expect(stripHtmlTags(unclosedDollarHtml)).toContain('ANOTHER TASK WITHOUT CLOSE');

      // Fall B: Ungeschlossenes \[
      const unclosedBracket = '\\[\n8+5\nANOTHER TASK WITHOUT CLOSE';
      const unclosedBracketBlocks = parseExamPreviewBlocks(unclosedBracket);
      expect(unclosedBracketBlocks).toHaveLength(3);
      expect(unclosedBracketBlocks[0]).toMatchObject({
        type: 'math-block',
        raw: '\\[',
        isFallback: true,
        html: '',
      });
      expect(unclosedBracketBlocks[1]).toMatchObject({
        type: 'paragraph',
        text: '8+5',
      });
      expect(unclosedBracketBlocks[2]).toMatchObject({
        type: 'paragraph',
        text: 'ANOTHER TASK WITHOUT CLOSE',
      });

      const unclosedBracketHtml = renderToStaticMarkup(
        React.createElement(ExamMarkdownMathPreview, { content: unclosedBracket })
      );
      expect(unclosedBracketHtml).not.toContain('class="katex"');
      expect(unclosedBracketHtml).toContain('data-math-fallback="true"');
      expect(stripHtmlTags(unclosedBracketHtml)).toContain('ANOTHER TASK WITHOUT CLOSE');

      // Fall C: Ungeschlossenes $$ gefolgt von einer echten Folgeaufgabe mit gueltigem Inline-Mathe
      const unclosedFollowedByValidTask = '$$\n8+5\n**Aufgabe 2:** Berechne $3+4$';
      const mixedHtml = renderToStaticMarkup(
        React.createElement(ExamMarkdownMathPreview, { content: unclosedFollowedByValidTask })
      );
      expect(mixedHtml).toMatch(/<strong[^>]*>Aufgabe 2:<\/strong>/);
      expect(mixedHtml).toContain('class="katex"');

      // Fall D: Mehrzeilige nicht unterstuetzte Befehle in $$...$$ und \[...\]
      const multilineUnsupported = [
        '$$\n\\unsupportedcmd{8+5}\n\\secondbadmacro{13}\n$$',
        '\\[\n\\begin{unknownmatrix}\n8 & 5\n\\end{unknownmatrix}\n\\]',
      ].join('\n');
      const multilineFallbackHtml = renderToStaticMarkup(
        React.createElement(ExamMarkdownMathPreview, { content: multilineUnsupported })
      );
      const fallbackMatches = multilineFallbackHtml.match(/data-math-fallback="true"/g) || [];
      expect(fallbackMatches.length).toBe(2);
      expect(multilineFallbackHtml).toContain('\\unsupportedcmd{8+5}');
      expect(multilineFallbackHtml).toContain('\\secondbadmacro{13}');
      expect(multilineFallbackHtml).toContain('\\begin{unknownmatrix}');
    });

    it('Blocker 3: bewahrt exakte numerische und alphabetische Listen-Marker (z.B. "3. Third task\\n7. Seventh task", gemischte Listen und Interpunktion)', () => {
      const nonConsecutiveNumeric = '3. Third task\n7. Seventh task';
      const blocks = parseExamPreviewBlocks(nonConsecutiveNumeric);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({
        type: 'list',
        ordered: true,
        items: [{ marker: '3.' }, { marker: '7.' }],
      });

      const numericHtml = renderToStaticMarkup(
        React.createElement(ExamMarkdownMathPreview, { content: nonConsecutiveNumeric })
      );
      const visibleNumeric = stripHtmlTags(numericHtml);
      expect(visibleNumeric).toContain('3. Third task');
      expect(visibleNumeric).toContain('7. Seventh task');
      expect(numericHtml).toMatch(/data-testid="exam-preview-list-marker"[^>]*>3\.\s*<\/span>/);
      expect(numericHtml).toMatch(/data-testid="exam-preview-list-marker"[^>]*>7\.\s*<\/span>/);

      // Gemischte Liste mit Punkt- und Klammer-Interpunktion sowie Buchstaben
      const mixedMarkersInput = [
        '3. Dritte Aufgabe ($8+5$)',
        '7) Siebte Aufgabe ($8+2+3$)',
        'a) Teilaufgabe a',
        'b. Teilaufgabe b',
      ].join('\n');
      const mixedHtml = renderToStaticMarkup(
        React.createElement(ExamMarkdownMathPreview, { content: mixedMarkersInput })
      );
      const visibleMixed = stripHtmlTags(mixedHtml);
      expect(visibleMixed).toContain('3. Dritte Aufgabe');
      expect(visibleMixed).toContain('7) Siebte Aufgabe');
      expect(visibleMixed).toContain('a) Teilaufgabe a');
      expect(visibleMixed).toContain('b. Teilaufgabe b');
    });

    it('injektionssicher: fuehrt niemals unsanitized HTML aus (weder in Markdown noch in fehlerhaftem LaTeX)', () => {
      const maliciousInput = [
        '# Titel <script>window.__pwned = true;</script>',
        '**Fett <img src="x" onerror="window.__pwned = true" />**',
        '- Punkt <svg onload="window.__pwned = true"></svg>',
        'Absatz mit <iframe src="javascript:alert(1)"></iframe> und <a href="javascript:alert(1)">Link</a>',
        'Mathe-Fallback mit HTML: $\\unknowncmd{<script>alert(1)</script>}$',
        'KaTeX href Versuch: $\\href{javascript:alert(1)}{Klick}$',
      ].join('\n');

      const html = renderToStaticMarkup(
        React.createElement(ExamMarkdownMathPreview, {
          content: maliciousInput,
          testId: 'exam-xss-preview',
        })
      );

      expect(html).not.toMatch(/<script\b/i);
      expect(html).not.toMatch(/<img\b/i);
      expect(html).not.toMatch(/<svg\b/i);
      expect(html).not.toMatch(/<iframe\b/i);
      expect(html).not.toMatch(/href="javascript:/i);

      expect(html).toContain('&lt;script&gt;window.__pwned = true;&lt;/script&gt;');
      expect(html).toContain(
        '&lt;img src=&quot;x&quot; onerror=&quot;window.__pwned = true&quot; /&gt;'
      );
      expect(html).toContain('&lt;svg onload=&quot;window.__pwned = true&quot;&gt;&lt;/svg&gt;');
      expect(html).toContain('&lt;iframe src=&quot;javascript:alert(1)&quot;&gt;&lt;/iframe&gt;');
    });

    it('bewahrt die unbearbeiteten Rohtexte im Bearbeitungsmodus sowie die bestehenden PDF-/Bild-Container-Constraints in app/exams/[id]/page.tsx', () => {
      const examDetailPagePath = path.resolve(process.cwd(), 'app/exams/[id]/page.tsx');
      const examDetailSource = fs.readFileSync(examDetailPagePath, 'utf8');

      // Vorschau nutzt ExamMarkdownMathPreview fuer TEMPLATE und RUBRIC
      expect(examDetailSource).toContain('testId="exam-template-preview"');
      expect(examDetailSource).toContain('testId="exam-rubric-preview"');

      // Bestehende Non-Text/PDF/Bild-Constraints auf dem RUBRIC-Container bleiben unveraendert erhalten
      expect(examDetailSource).toContain(
        'overflowY: exam?.rubricText?.includes(\'"application/pdf"\')'
      );
      expect(examDetailSource).toContain(
        'maxHeight: exam?.rubricText?.includes(\'"application/pdf"\')'
      );

      // Editiermodus (editingRubric) behaelt die unveraenderten State-Werte templateText und rubricText
      expect(examDetailSource).toContain('value={templateText}');
      expect(examDetailSource).toContain('onChange={(e) => setTemplateText(e.target.value)}');
      expect(examDetailSource).toContain('value={rubricText}');
      expect(examDetailSource).toContain('onChange={(e) => setRubricText(e.target.value)}');

      // Serialisierte PDF- und Bild-Musterloesungen bleiben erhalten
      expect(examDetailSource).toContain('parseSerializedDocumentPayload(exam?.rubricText)');

      // Schweizer Rechtschreibung (kein Eszett) in allen neuen/geaenderten Dateien
      const previewLibSource = fs.readFileSync(
        path.resolve(process.cwd(), 'lib/exam-detail-preview.ts'),
        'utf8'
      );
      const previewComponentSource = fs.readFileSync(
        path.resolve(process.cwd(), 'components/ExamMarkdownMathPreview.tsx'),
        'utf8'
      );
      expect(examDetailSource).not.toMatch(/\u00df/);
      expect(previewLibSource).not.toMatch(/\u00df/);
      expect(previewComponentSource).not.toMatch(/\u00df/);

      // Hilfsfunktionen liefern deterministische Struktur
      const inlineTokens = parseExamPreviewInlineTokens('**Aufgabe 1**: Berechne $8+5$');
      expect(inlineTokens.some((t) => t.type === 'bold')).toBe(true);
      expect(inlineTokens.some((t) => t.type === 'math' && !t.isFallback)).toBe(true);
      expect(renderExamPreviewMath('', false).isFallback).toBe(true);
    });
  });
});
