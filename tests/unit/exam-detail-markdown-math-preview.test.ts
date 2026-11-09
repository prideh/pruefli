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

  describe('3. Negative & Safety Regressions (Unsupported Math Fallback, XSS/HTML Escaping, Edit Preservation)', () => {
    it('faellt bei nicht unterstuetzten LaTeX-Makros oder unbalancierten Klammern sicher und verbatim auf Code-Text zurueck', () => {
      const unsupportedContent = [
        '### Aufgabe mit Speziallatex',
        'Inline unbekannt: $\\unsupportedmacro{8+5}$ und unbalanciert $\\frac{8+5}{2$',
        '$$\\begin{unknownmatrix} 8 & 5 \\end{unknownmatrix}$$',
        'Valide Rechnung daneben: $8+5=13$',
      ].join('\n');

      const html = renderToStaticMarkup(
        React.createElement(ExamMarkdownMathPreview, {
          content: unsupportedContent,
          testId: 'exam-fallback-preview',
        })
      );

      const fallbackMatches = html.match(/data-math-fallback="true"/g) || [];
      expect(fallbackMatches.length).toBe(3);
      expect(html).toContain('$\\unsupportedmacro{8+5}$');
      expect(html).toContain('$\\frac{8+5}{2$');
      expect(html).toContain('$$\\begin{unknownmatrix} 8 &amp; 5 \\end{unknownmatrix}$$');

      // Valide Mathematik im selben Dokument wird trotzdem normal mit KaTeX gerendert
      expect(html).toContain('class="katex"');
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

      // Keine einzigen echten <script>, <img>, <svg>, <iframe> oder javascript:-<a> Tags im erzeugten HTML
      expect(html).not.toMatch(/<script\b/i);
      expect(html).not.toMatch(/<img\b/i);
      expect(html).not.toMatch(/<svg\b/i);
      expect(html).not.toMatch(/<iframe\b/i);
      expect(html).not.toMatch(/href="javascript:/i);

      // Stattdessen sind die rohen Tags als HTML-Entities (&lt;script&gt; etc.) sicher escaped
      expect(html).toContain('&lt;script&gt;window.__pwned = true;&lt;/script&gt;');
      expect(html).toContain(
        '&lt;img src=&quot;x&quot; onerror=&quot;window.__pwned = true&quot; /&gt;'
      );
      expect(html).toContain('&lt;svg onload=&quot;window.__pwned = true&quot;&gt;&lt;/svg&gt;');
      expect(html).toContain('&lt;iframe src=&quot;javascript:alert(1)&quot;&gt;&lt;/iframe&gt;');
    });

    it('bewahrt die unbearbeiteten Rohtexte im Bearbeitungsmodus von app/exams/[id]/page.tsx und vermeidet Datei-Konflikte mit #120', () => {
      const examDetailPagePath = path.resolve(process.cwd(), 'app/exams/[id]/page.tsx');
      const examDetailSource = fs.readFileSync(examDetailPagePath, 'utf8');

      // Vorschau nutzt ExamMarkdownMathPreview fuer TEMPLATE und RUBRIC
      expect(examDetailSource).toContain('testId="exam-template-preview"');
      expect(examDetailSource).toContain('testId="exam-rubric-preview"');

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

    it('unterstuetzt geordnete Listen (1., a)), Display-Mathematik ($$...$$, \\[...\\]), Luecken in Mathe ($8 + ___ = 13$) und Leerzustaende', () => {
      const mixedContent = [
        '## Teilaufgaben',
        '1. Erste Rechnung: $x_1 + x_2 = 13$',
        '2. Zweite Rechnung: $8 + ___ = 13$',
        '---',
        'a) Zerlegung *schrittweise* mit `Zehnerübergang`: $8+2+3$',
        'b) Ergebnis prüfen: $\\text{Summe: ___}$',
        '$$8 + 5 = 8 + 2 + 3 = 13$$',
      ].join('\n');

      const html = renderToStaticMarkup(
        React.createElement(ExamMarkdownMathPreview, {
          content: mixedContent,
          testId: 'exam-mixed-preview',
        })
      );

      expect(html).toMatch(/<h2[^>]*>Teilaufgaben<\/h2>/);
      expect(html).toContain('<ol');
      expect(html).toContain('<hr');
      expect(html).toMatch(/<em[^>]*>schrittweise<\/em>/);
      expect(html).toMatch(/<code[^>]*>Zehnerübergang<\/code>/);
      expect(html).toContain('data-testid="exam-preview-math-block"');
      expect(html).not.toContain('data-math-fallback="true"');

      const emptyHtml = renderToStaticMarkup(
        React.createElement(ExamMarkdownMathPreview, {
          content: '   ',
          emptyText: 'Keine Musterlösung hinterlegt.',
          testId: 'exam-empty-preview',
        })
      );
      expect(emptyHtml).toContain('Keine Musterlösung hinterlegt.');
    });
  });
});
