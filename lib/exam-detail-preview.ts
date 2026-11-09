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

const BARE_LATEX_COMMANDS =
  '(?:frac|dfrac|tfrac|sqrt|times|div|cdot|pm|mp|leq|le|geq|ge|neq|ne|approx|equiv|sim|propto|infty|partial|nabla|forall|exists|in|notin|subset|subseteq|cup|cap|setminus|emptyset|to|rightarrow|leftarrow|Rightarrow|Leftarrow|leftrightarrow|Leftrightarrow|mapsto|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|ln|log|exp|lim|sum|prod|int|binom|vec|hat|bar|tilde|overline|underline|underbrace|overbrace|text|textbf|textit|mathrm|mathbf|mathit|mathbb|mathcal)';

const INLINE_MATH_AND_MARKDOWN_REGEX = new RegExp(
  [
    // 1. Display-Mathematik $$...$$
    '(\\$\\$[\\s\\S]+?\\$\\$)',
    // 2. Display-Mathematik \\[...\\]
    '(\\\\\\[[\\s\\S]+?\\\\\\])',
    // 3. Inline-Mathematik \\(...\\)
    '(\\\\\\([\\s\\S]+?\\\\\\))',
    // 4. Inline-Mathematik $...$ (einzeilig, erlaubt auch einzelne Zahlen/Variablen wie $13$ oder $8+5$)
    '(\\$(?!\\$)(?:\\\\\\$|[^$\\n])+?\\$(?!\\$))',
    // 5. Inline-Code `...`
    '(`[^`\\n]+?`)',
    // 6. Fettdruck **...** (bewusst KEIN __...__, damit Lueckentext-Unterstriche ___ unveraendert bleiben)
    '(\\*\\*[^\\n]+?\\*\\*)',
    // 7. Kursivdruck *...* (bewusst KEIN _..._, damit Lueckentext-Unterstriche ___ unveraendert bleiben)
    '(\\*(?!\\*)[^*\\n]+?\\*(?!\\*))',
    // 8. Freistehende bekannte LaTeX-Befehle ohne $-Begrenzer (z.B. \frac{1}{2})
    `(\\\\${BARE_LATEX_COMMANDS}\\b(?:\\s*\\[[^\\]\\n]*\\])*(?:\\s*\\{(?:[^{}\\n]|\\{[^{}\\n]*\\})*\\})*(?:\\s*[_^]\\s*(?:\\{[^{}\\n]*\\}|[a-zA-Z0-9]))*)`,
  ].join('|'),
  'g'
);

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
      tokens.push({
        type: 'text',
        text: text.slice(lastIndex, match.index),
      });
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
    } else if (match[8]) {
      // Freistehender bekannter LaTeX-Befehl
      const rendered = renderExamPreviewMath(fullMatch, false);
      tokens.push({
        type: 'math',
        latex: fullMatch.trim(),
        raw: fullMatch,
        displayMode: false,
        html: rendered.html,
        isFallback: rendered.isFallback,
      });
    } else {
      tokens.push({
        type: 'text',
        text: fullMatch,
      });
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({
      type: 'text',
      text: text.slice(lastIndex),
    });
  }

  return tokens;
}

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
  const lines = normalized.split('\n');
  const blocks: ExamPreviewBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // 1. Mehrzeiliger oder einzeiliger Display-Mathematik-Block $$...$$ oder \[...\]
    if (trimmed.startsWith('$$') || trimmed.startsWith('\\[')) {
      const isDollar = trimmed.startsWith('$$');
      const closeDelim = isDollar ? '$$' : '\\]';

      if (trimmed.length > 4 && trimmed.endsWith(closeDelim)) {
        const latex = trimmed.slice(2, -2);
        const rendered = renderExamPreviewMath(latex, true);
        blocks.push({
          type: 'math-block',
          latex: latex.trim(),
          raw: trimmed,
          html: rendered.html,
          isFallback: rendered.isFallback,
        });
        i++;
        continue;
      }

      const mathLines: string[] = [trimmed.slice(2)];
      const rawLines: string[] = [rawLine];
      i++;
      while (i < lines.length) {
        const currentRaw = lines[i];
        const currentTrimmed = currentRaw.trim();
        rawLines.push(currentRaw);
        const closeIndex = currentTrimmed.indexOf(closeDelim);
        if (closeIndex !== -1) {
          mathLines.push(currentTrimmed.slice(0, closeIndex));
          i++;
          break;
        }
        mathLines.push(currentRaw);
        i++;
      }
      const latex = mathLines.join('\n');
      const rawBlock = rawLines.join('\n').trim();
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

    // 2. Horizontale Trennlinie (--- oder ***; ___ bleibt als Antwortlinie im Absatz erhalten)
    if (/^(?:-{3,}|\*{3,})$/.test(trimmed)) {
      blocks.push({ type: 'divider' });
      i++;
      continue;
    }

    // 3. Markdown-Ueberschriften (#, ##, ###, ####)
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
      i++;
      continue;
    }

    // 4. Ungeordnete Aufzaehlungsliste (- ..., * ..., + ..., • ...)
    const unorderedMatch = trimmed.match(/^([-*+•])\s+(.+)$/);
    if (unorderedMatch) {
      const items: ExamPreviewListItem[] = [];
      while (i < lines.length) {
        const currentTrimmed = lines[i].trim();
        const itemMatch = currentTrimmed.match(/^([-*+•])\s+(.+)$/);
        if (!itemMatch) break;
        items.push({
          marker: itemMatch[1],
          tokens: parseExamPreviewInlineTokens(itemMatch[2].trim()),
        });
        i++;
      }
      blocks.push({
        type: 'list',
        ordered: false,
        items,
      });
      continue;
    }

    // 5. Geordnete oder alphabetische Liste (1. ..., 1) ..., a) ...)
    const orderedMatch = trimmed.match(/^((?:\d+[.)]|[a-zA-Z]\)))\s+(.+)$/);
    if (orderedMatch) {
      const items: ExamPreviewListItem[] = [];
      while (i < lines.length) {
        const currentTrimmed = lines[i].trim();
        const itemMatch = currentTrimmed.match(/^((?:\d+[.)]|[a-zA-Z]\)))\s+(.+)$/);
        if (!itemMatch) break;
        items.push({
          marker: itemMatch[1],
          tokens: parseExamPreviewInlineTokens(itemMatch[2].trim()),
        });
        i++;
      }
      blocks.push({
        type: 'list',
        ordered: true,
        items,
      });
      continue;
    }

    // 6. Standard-Absatz (inkl. **Name:** ___, **Punkte:** ____ /6 Punkte, **Aufgabe 1**, Rechnungen)
    blocks.push({
      type: 'paragraph',
      text: trimmed,
      tokens: parseExamPreviewInlineTokens(trimmed),
    });
    i++;
  }

  return blocks;
}
