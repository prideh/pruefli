import katex from 'katex';

export type ExamPreviewInlineToken =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string; children: ExamPreviewInlineToken[] }
  | { type: 'italic'; text: string; children: ExamPreviewInlineToken[] }
  | { type: 'code'; text: string }
  | {
      type: 'math';
      latex: string;
      raw: string;
      displayMode: boolean;
      html: string;
      isFallback: boolean;
    };

export interface ExamPreviewListItem {
  marker: string;
  tokens: ExamPreviewInlineToken[];
}

export type ExamPreviewBlock =
  | {
      type: 'heading';
      level: 1 | 2 | 3 | 4;
      text: string;
      tokens: ExamPreviewInlineToken[];
    }
  | {
      type: 'paragraph';
      text: string;
      tokens: ExamPreviewInlineToken[];
    }
  | {
      type: 'list';
      ordered: boolean;
      items: ExamPreviewListItem[];
    }
  | {
      type: 'math-block';
      latex: string;
      raw: string;
      html: string;
      isFallback: boolean;
    }
  | {
      type: 'divider';
    };

/**
 * Bereitet einen LaTeX-Ausdruck fuer KaTeX vor:
 * - Mehrfache Unterstriche (___) als Lueckentext-Linie (\underline{\hspace{2em}})
 * - Unescapte Unterstriche innerhalb von \text{...} als \_
 */
export function preprocessPreviewLatex(latex: string): string {
  let processed = latex.replace(/\\text\{([^{}]*)\}/g, (_match, inner: string) => {
    const escapedInner = inner
      .replace(/_{3,}/g, '\\underline{\\hspace{1.5em}}')
      .replace(/(?<!\\)_/g, '\\_');
    return `\\text{${escapedInner}}`;
  });

  processed = processed.replace(/_{3,}/g, '\\underline{\\hspace{2em}}');

  return processed.trim();
}

/**
 * Rendert einen LaTeX-Ausdruck sicher mit KaTeX zu HTML.
 * Bei nicht unterstuetzten Befehlen oder Syntaxfehlern wird isFallback = true
 * zurueckgegeben, sodass der Aufrufer den Ausdruck unveraendert (verbatim) als
 * sicheren Text-Fallback darstellt.
 */
export function renderExamPreviewMath(
  latex: string,
  displayMode: boolean
): { html: string; isFallback: boolean } {
  const cleaned = preprocessPreviewLatex(latex);
  if (!cleaned) {
    return { html: '', isFallback: true };
  }

  try {
    const html = katex.renderToString(cleaned, {
      displayMode,
      throwOnError: true,
      strict: 'ignore',
      trust: false,
      output: 'html',
    });
    return { html, isFallback: false };
  } catch {
    return { html: '', isFallback: true };
  }
}

const INLINE_MATH_AND_MARKDOWN_REGEX = new RegExp(
  [
    // 1. Display-Mathematik $$...$$ (einzeilig geschlossen)
    '(\\$\\$(?:\\\\\\$|[^$\\n])+?\\$\\$)',
    // 2. Display-Mathematik \\[...\\] (einzeilig geschlossen)
    '(\\\\\\[[\\s\\S]+?\\\\\\])',
    // 3. Inline-Mathematik \\(...\\) (einzeilig geschlossen)
    '(\\\\\\([\\s\\S]+?\\\\\\))',
    // 4. Inline-Mathematik $...$ (einzeilig geschlossen, erlaubt einzelne Zahlen/Variablen wie $13$ oder $8+5$)
    '(\\$(?!\\$)(?:\\\\\\$|[^$\\n])+?\\$(?!\\$))',
    // 5. Inline-Code `...`
    '(`[^`\\n]+?`)',
    // 6. Fettdruck **...** (bewusst KEIN __...__, damit Lueckentext-Unterstriche ___ unveraendert bleiben)
    '(\\*\\*[^\\n]+?\\*\\*)',
    // 7. Kursivdruck *...* (bewusst KEIN _..._, damit Lueckentext-Unterstriche ___ unveraendert bleiben)
    '(\\*(?!\\*)[^*\\n]+?\\*(?!\\*))',
  ].join('|'),
  'g'
);

/**
 * Prueft ein verbleibendes Textsegment auf ungeschlossene Mathematik-Begrenzer
 * ($$, \[, \(, $) und stellt diese sicher als Verbatim-Fallback (isFallback: true) dar,
 * anstatt sie stillschweigend zu verwerfen oder als gueltiges KaTeX zu interpretieren.
 */
function splitPlainSegmentWithUnclosedMathFallback(segment: string): ExamPreviewInlineToken[] {
  if (!segment) return [];

  const unclosedMatch = /(\$\$|\\\[|\\\(|(?<!\\)\$)/.exec(segment);
  if (!unclosedMatch || unclosedMatch.index === undefined) {
    return [{ type: 'text', text: segment }];
  }

  const result: ExamPreviewInlineToken[] = [];
  const idx = unclosedMatch.index;
  if (idx > 0) {
    result.push({
      type: 'text',
      text: segment.slice(0, idx),
    });
  }

  const unclosedRaw = segment.slice(idx);
  const isDisplay = unclosedRaw.startsWith('$$') || unclosedRaw.startsWith('\\[');
  result.push({
    type: 'math',
    latex: unclosedRaw.trim(),
    raw: unclosedRaw,
    displayMode: isDisplay,
    html: '',
    isFallback: true,
  });

  return result;
}

/**
 * Parst Inline-Elemente (Mathematik, **Fett**, *Kursiv*, `Code`) ohne jegliches
 * HTML-Parsing: Rohes HTML im Text bleibt immer als reines Text-Token erhalten
 * und wird von React automatisch escaped.
 */
export function parseExamPreviewInlineTokens(
  text: string,
  allowNestedEmphasis = true
): ExamPreviewInlineToken[] {
  if (!text) return [];

  const tokens: ExamPreviewInlineToken[] = [];
  let lastIndex = 0;

  const regex = new RegExp(INLINE_MATH_AND_MARKDOWN_REGEX.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(...splitPlainSegmentWithUnclosedMathFallback(text.slice(lastIndex, match.index)));
    }

    const fullMatch = match[0];

    if (match[1]) {
      // $$...$$
      const latex = fullMatch.slice(2, -2);
      const rendered = renderExamPreviewMath(latex, true);
      tokens.push({
        type: 'math',
        latex: latex.trim(),
        raw: fullMatch,
        displayMode: true,
        html: rendered.html,
        isFallback: rendered.isFallback,
      });
    } else if (match[2]) {
      // \[...\]
      const latex = fullMatch.slice(2, -2);
      const rendered = renderExamPreviewMath(latex, true);
      tokens.push({
        type: 'math',
        latex: latex.trim(),
        raw: fullMatch,
        displayMode: true,
        html: rendered.html,
        isFallback: rendered.isFallback,
      });
    } else if (match[3]) {
      // \(...\)
      const latex = fullMatch.slice(2, -2);
      const rendered = renderExamPreviewMath(latex, false);
      tokens.push({
        type: 'math',
        latex: latex.trim(),
        raw: fullMatch,
        displayMode: false,
        html: rendered.html,
        isFallback: rendered.isFallback,
      });
    } else if (match[4]) {
      // $...$
      const latex = fullMatch.slice(1, -1);
      const rendered = renderExamPreviewMath(latex, false);
      tokens.push({
        type: 'math',
        latex: latex.trim(),
        raw: fullMatch,
        displayMode: false,
        html: rendered.html,
        isFallback: rendered.isFallback,
      });
    } else if (match[5]) {
      // `...`
      tokens.push({
        type: 'code',
        text: fullMatch.slice(1, -1),
      });
    } else if (match[6] && allowNestedEmphasis) {
      // **...**
      const inner = fullMatch.slice(2, -2);
      tokens.push({
        type: 'bold',
        text: inner,
        children: parseExamPreviewInlineTokens(inner, false),
      });
    } else if (match[7] && allowNestedEmphasis) {
      // *...*
      const inner = fullMatch.slice(1, -1);
      tokens.push({
        type: 'italic',
        text: inner,
        children: parseExamPreviewInlineTokens(inner, false),
      });
    } else {
      tokens.push(...splitPlainSegmentWithUnclosedMathFallback(fullMatch));
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push(...splitPlainSegmentWithUnclosedMathFallback(text.slice(lastIndex)));
  }

  return tokens;
}

/**
 * Sucht auf einer Zeile nach einem geoeffneten, aber auf derselben Zeile NICHT
 * geschlossenen Display-Mathematik-Begrenzer ($$ oder \[).
 */
function findUnclosedDisplayDelimiterOnLine(
  line: string
): { openDelim: '$$' | '\\['; closeDelim: '$$' | '\\]'; index: number } | null {
  let pos = 0;
  while (pos < line.length) {
    if (line.startsWith('$$', pos)) {
      const closeIdx = line.indexOf('$$', pos + 2);
      if (closeIdx === -1) {
        return { openDelim: '$$', closeDelim: '$$', index: pos };
      }
      pos = closeIdx + 2;
      continue;
    }
    if (line.startsWith('\\[', pos)) {
      const closeIdx = line.indexOf('\\]', pos + 2);
      if (closeIdx === -1) {
        return { openDelim: '\\[', closeDelim: '\\]', index: pos };
      }
      pos = closeIdx + 2;
      continue;
    }
    pos++;
  }
  return null;
}

/**
 * Prueft, ob eine Zeile eine strukturelle Markdown-Blockgrenze darstellt, die
 * von einem mehrzeiligen Mathematik-Block ohne explizites Schliessen niemals
 * verschluckt werden darf.
 */
function isStructuralMarkdownBoundary(trimmedLine: string): boolean {
  if (!trimmedLine) return true;
  if (/^(?:-{3,}|\*{3,})$/.test(trimmedLine)) return true;
  if (/^#{1,6}\s+/.test(trimmedLine)) return true;
  if (/^(?:\*\*)?(?:Aufgabe|Teilaufgabe|Task|Frage|Musterlösung|Hinweise)\b/i.test(trimmedLine)) {
    return true;
  }
  if (/^(?:[-*+•]|(?:\d+|[a-zA-Z])[.)])\s+/.test(trimmedLine)) return true;
  // Reine Prosa-Zeile aus mehreren Gross-/Kleinbuchstaben-Woertern ohne LaTeX-/Rechensymbole
  if (
    /^[A-Za-zÄÖÜäöü][A-Za-zÄÖÜäöü0-9,.;:!?()'" -]+$/.test(trimmedLine) &&
    /\s/.test(trimmedLine) &&
    !/[\\^_=+*/<>|{}]/.test(trimmedLine)
  ) {
    return true;
  }
  return false;
}

/**
 * Sucht in den nachfolgenden Zeilen nach dem passenden schliessenden Begrenzer
 * ($$ oder \]). Bricht ab, sobald eine strukturelle Blockgrenze oder eine
 * nachfolgende Aufgaben-/Prosazeile ohne Schliessen erreicht wird, damit
 * ungeschlossene Begrenzer niemals spaetere Aufgaben verschlucken.
 */
function findClosingDisplayLine(
  queue: string[],
  closeDelim: '$$' | '\\]'
): { lineIndex: number; charIndex: number } | null {
  for (let k = 0; k < queue.length; k++) {
    const candidateRaw = queue[k];
    const candidateTrimmed = candidateRaw.trim();
    const charIndex = candidateRaw.indexOf(closeDelim);
    if (charIndex !== -1) {
      return { lineIndex: k, charIndex };
    }
    if (isStructuralMarkdownBoundary(candidateTrimmed)) {
      return null;
    }
  }
  return null;
}

const ORDERED_LIST_ITEM_REGEX = /^((?:\d+|[a-zA-Z])[.)])\s+(.+)$/;
const UNORDERED_LIST_ITEM_REGEX = /^([-*+•])\s+(.+)$/;

/**
 * Zerlegt den Vorlagen- oder Musterloesungstext fuer die Vorschau auf der
 * Pruefungs-Detailseite (/exams/[id]) in strukturierte Bloecke.
 *
 * WICHTIG: Im Gegensatz zum Schueler-Druckbogen (/print-task-sheet) werden hier
 * KEINE Kopfzeilen, Titel (# Pruefung: ...), Name/Punkte-Zeilen (**Name:** ___,
 * **Punkte:** ____ /6 Punkte) oder Loesungs-Ueberschriften (### Musterloesung)
 * entfernt. Alle Inhalte bleiben vollstaendig erhalten und werden lesbar
 * formatiert.
 */
export function parseExamPreviewBlocks(rawText: string): ExamPreviewBlock[] {
  if (!rawText || typeof rawText !== 'string') return [];

  const normalized = rawText.replace(/\r\n/g, '\n');
  const queue = normalized.split('\n');
  const blocks: ExamPreviewBlock[] = [];

  while (queue.length > 0) {
    const rawLine = queue.shift()!;
    const trimmed = rawLine.trim();

    if (!trimmed) {
      continue;
    }

    // 1. Pruefe auf mehrzeilige oder ungeschlossene Display-Mathematik ($$ oder \[)
    const unclosed = findUnclosedDisplayDelimiterOnLine(trimmed);
    if (unclosed) {
      const closingMatch = findClosingDisplayLine(queue, unclosed.closeDelim);

      if (closingMatch) {
        // Es existiert ein gueltiger schliessender Begrenzer in Zeile closingMatch.lineIndex.
        // Falls vor dem oeffnenden Begrenzer auf derselben Zeile noch Praefix-Text steht,
        // verarbeiten wir zuerst den Praefix-Text und danach den Display-Block.
        if (unclosed.index > 0) {
          const prefixText = trimmed.slice(0, unclosed.index).trim();
          const restFromDelimiter = trimmed.slice(unclosed.index);
          queue.unshift(restFromDelimiter);
          if (prefixText) {
            queue.unshift(prefixText);
          }
          continue;
        }

        // unclosed.index === 0: Zeile beginnt mit $$ oder \[
        const consumedLines = queue.splice(0, closingMatch.lineIndex + 1);
        const closingRawLine = consumedLines[consumedLines.length - 1];
        const beforeCloseOnClosingLine = closingRawLine.slice(0, closingMatch.charIndex);
        const afterCloseSuffix = closingRawLine
          .slice(closingMatch.charIndex + unclosed.closeDelim.length)
          .trim();

        // Suffix nach dem schliessenden $$ oder \] auf derselben Zeile bewahren!
        if (afterCloseSuffix) {
          queue.unshift(afterCloseSuffix);
        }

        const firstLineLatex = trimmed.slice(unclosed.openDelim.length);
        const middleLines = consumedLines.slice(0, -1);
        const mathParts: string[] = [];
        if (firstLineLatex.trim()) mathParts.push(firstLineLatex);
        mathParts.push(...middleLines);
        if (beforeCloseOnClosingLine.trim()) mathParts.push(beforeCloseOnClosingLine);

        const latex = mathParts.join('\n');
        const rawBlockLines = [
          rawLine,
          ...middleLines,
          closingRawLine.slice(0, closingMatch.charIndex + unclosed.closeDelim.length),
        ];
        const rawBlock = rawBlockLines.join('\n').trim();
        const rendered = renderExamPreviewMath(latex, true);

        blocks.push({
          type: 'math-block',
          latex: latex.trim(),
          raw: rawBlock,
          html: rendered.html,
          isFallback: rendered.isFallback,
        });
        continue;
      }

      // Kein schliessender Begrenzer gefunden (ungeschlossenes $$ oder \[):
      // Niemals nachfolgende Zeilen/Aufgaben als Mathematik absorbieren!
      if (unclosed.index === 0) {
        blocks.push({
          type: 'math-block',
          latex: trimmed,
          raw: trimmed,
          html: '',
          isFallback: true,
        });
        continue;
      }
    }

    // 2. Einzeiliger, vollstaendig geschlossener Display-Mathematik-Block ohne Praefix/Suffix
    if (trimmed.startsWith('$$') || trimmed.startsWith('\\[')) {
      const openDelim = trimmed.startsWith('$$') ? '$$' : '\\[';
      const closeDelim = openDelim === '$$' ? '$$' : '\\]';
      const firstCloseIdx = trimmed.indexOf(closeDelim, openDelim.length);

      // Nur als eigenstaendigen math-block behandeln, wenn der schliessende Begrenzer
      // exakt am Zeilenende steht (kein nachfolgender Suffix-Text auf derselben Zeile).
      if (firstCloseIdx !== -1 && firstCloseIdx === trimmed.length - closeDelim.length) {
        const latex = trimmed.slice(openDelim.length, -closeDelim.length);
        const rendered = renderExamPreviewMath(latex, true);
        blocks.push({
          type: 'math-block',
          latex: latex.trim(),
          raw: trimmed,
          html: rendered.html,
          isFallback: rendered.isFallback,
        });
        continue;
      }
    }

    // 3. Horizontale Trennlinie (--- oder ***; ___ bleibt als Antwortlinie im Absatz erhalten)
    if (/^(?:-{3,}|\*{3,})$/.test(trimmed)) {
      blocks.push({ type: 'divider' });
      continue;
    }

    // 4. Markdown-Ueberschriften (#, ##, ###, ####)
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const rawLevel = headingMatch[1].length;
      const level = Math.min(Math.max(rawLevel, 1), 4) as 1 | 2 | 3 | 4;
      const headingText = headingMatch[2].trim();
      blocks.push({
        type: 'heading',
        level,
        text: headingText,
        tokens: parseExamPreviewInlineTokens(headingText),
      });
      continue;
    }

    // 5. Ungeordnete Aufzaehlungsliste (- ..., * ..., + ..., • ...)
    const unorderedMatch = trimmed.match(UNORDERED_LIST_ITEM_REGEX);
    if (unorderedMatch) {
      const items: ExamPreviewListItem[] = [
        {
          marker: unorderedMatch[1],
          tokens: parseExamPreviewInlineTokens(unorderedMatch[2].trim()),
        },
      ];
      while (queue.length > 0) {
        const nextTrimmed = queue[0].trim();
        const itemMatch = nextTrimmed.match(UNORDERED_LIST_ITEM_REGEX);
        if (!itemMatch) break;
        queue.shift();
        items.push({
          marker: itemMatch[1],
          tokens: parseExamPreviewInlineTokens(itemMatch[2].trim()),
        });
      }
      blocks.push({
        type: 'list',
        ordered: false,
        items,
      });
      continue;
    }

    // 6. Geordnete oder alphabetische Liste (1. ..., 3. ..., 7. ..., 1) ..., a) ..., b. ...)
    const orderedMatch = trimmed.match(ORDERED_LIST_ITEM_REGEX);
    if (orderedMatch) {
      const items: ExamPreviewListItem[] = [
        {
          marker: orderedMatch[1],
          tokens: parseExamPreviewInlineTokens(orderedMatch[2].trim()),
        },
      ];
      while (queue.length > 0) {
        const nextTrimmed = queue[0].trim();
        const itemMatch = nextTrimmed.match(ORDERED_LIST_ITEM_REGEX);
        if (!itemMatch) break;
        queue.shift();
        items.push({
          marker: itemMatch[1],
          tokens: parseExamPreviewInlineTokens(itemMatch[2].trim()),
        });
      }
      blocks.push({
        type: 'list',
        ordered: true,
        items,
      });
      continue;
    }

    // 7. Standard-Absatz (inkl. **Name:** ___, **Punkte:** ____ /6 Punkte, **Aufgabe 1**, Inline-/Same-Line-Mathe)
    blocks.push({
      type: 'paragraph',
      text: trimmed,
      tokens: parseExamPreviewInlineTokens(trimmed),
    });
  }

  return blocks;
}
