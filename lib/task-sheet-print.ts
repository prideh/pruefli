import katex from 'katex';

export interface RenderedLatexMath {
  latex: string;
  html: string;
  text: string;
  isFallback: boolean;
}

export type InlineTaskSheetToken = InlineToken;

export type InlineToken =
  | { type: 'text'; content: string }
  | { type: 'bold'; content: string; tokens?: InlineToken[] }
  | { type: 'italic'; content: string; tokens?: InlineToken[] }
  | { type: 'code'; content: string }
  | {
      type: 'math';
      latex: string;
      html: string;
      content: string;
      isFallback: boolean;
    };

export interface TaskSheetHeadingBlock {
  type: 'heading';
  level: 1 | 2 | 3;
  variant: 'task' | 'section';
  text: string;
  tokens: InlineToken[];
}

export interface TaskSheetParagraphBlock {
  type: 'paragraph';
  text: string;
  tokens: InlineToken[];
}

export interface TaskSheetMathBlock {
  type: 'math';
  latex: string;
  html: string;
  text: string;
  isFallback: boolean;
}

export interface TaskSheetListItem {
  marker?: string;
  text: string;
  tokens: InlineToken[];
}

export interface TaskSheetListBlock {
  type: 'list';
  ordered: boolean;
  items: TaskSheetListItem[];
}

export interface TaskSheetDividerBlock {
  type: 'divider';
}

export interface TaskSheetAnswerLinesBlock {
  type: 'answer-lines';
  count: number;
}

export type TaskSheetBlock =
  | TaskSheetHeadingBlock
  | TaskSheetParagraphBlock
  | TaskSheetMathBlock
  | TaskSheetListBlock
  | TaskSheetDividerBlock
  | TaskSheetAnswerLinesBlock;

const SUPERSCRIPT_MAP: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  n: 'ⁿ',
  i: 'ⁱ',
};

const SUBSCRIPT_MAP: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  a: 'ₐ',
  e: 'ₑ',
  i: 'ᵢ',
  j: 'ⱼ',
  k: 'ₖ',
  m: 'ₘ',
  n: 'ₙ',
  o: 'ₒ',
  p: 'ₚ',
  r: 'ᵣ',
  s: 'ₛ',
  t: 'ₜ',
  u: 'ᵤ',
  v: 'ᵥ',
  x: 'ₓ',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function stripMathDelimiters(expr: string): string {
  const out = expr.trim();
  if (out.startsWith('$$') && out.endsWith('$$') && out.length >= 4) {
    return out.slice(2, -2).trim();
  }
  if (out.startsWith('$') && out.endsWith('$') && out.length >= 2) {
    return out.slice(1, -1).trim();
  }
  if (out.startsWith('\\[') && out.endsWith('\\]') && out.length >= 4) {
    return out.slice(2, -2).trim();
  }
  if (out.startsWith('\\(') && out.endsWith('\\)') && out.length >= 4) {
    return out.slice(2, -2).trim();
  }
  return out;
}

/**
 * Normalizes only worksheet fill-in-the-blank underscores so KaTeX can parse
 * AI-generated blanks such as `\text{_____}` or `8 + 5 = _____` without
 * altering mathematical AST structure.
 */
function preprocessLatexForKatex(latex: string): string {
  let out = latex.trim();
  // Escape unescaped underscores inside \text{...}, \textbf{...}, etc.
  out = out.replace(
    /\\(text(?:bf|it|rm|sf|tt)?|mbox)\{([^{}]*)\}/g,
    (_m, cmd: string, inner: string) => {
      const escaped = inner.replace(/(?<!\\)_/g, '\\_');
      return `\\${cmd}{${escaped}}`;
    }
  );
  // Convert 3+ consecutive unescaped underscores used as answer blanks into \text{\_\_\_...}
  out = out.replace(/(?<![\\_])_{3,}/g, (match) => {
    return `\\text{${'\\_'.repeat(match.length)}}`;
  });
  return out;
}

/**
 * Renders a LaTeX math expression using KaTeX (`katex.renderToString`).
 * If KaTeX encounters an unsupported macro or parse error, returns an explicit,
 * bounded fallback (`isFallback: true`) that preserves the original LaTeX source
 * without silently stripping commands or braces.
 */
export function renderLatexMath(
  expr: string,
  options?: { displayMode?: boolean }
): RenderedLatexMath {
  const latex = stripMathDelimiters(expr);
  const displayMode = Boolean(options?.displayMode);

  try {
    const preprocessed = preprocessLatexForKatex(latex);
    const html = katex.renderToString(preprocessed, {
      displayMode,
      throwOnError: true,
      strict: 'ignore',
      output: 'html',
    });
    return {
      latex,
      html,
      text: formatLatexMath(latex),
      isFallback: false,
    };
  } catch {
    return {
      latex,
      html: `<code class="task-sheet-math-fallback" data-math-fallback="true">${escapeHtml(latex)}</code>`,
      text: latex,
      isFallback: true,
    };
  }
}

function toSuperscript(text: string): string | null {
  let out = '';
  for (const ch of text) {
    const mapped = SUPERSCRIPT_MAP[ch];
    if (!mapped) return null;
    out += mapped;
  }
  return out;
}

function toSubscript(text: string): string | null {
  let out = '';
  for (const ch of text) {
    const mapped = SUBSCRIPT_MAP[ch];
    if (!mapped) return null;
    out += mapped;
  }
  return out;
}

/**
 * Converts a LaTeX math snippet into a semantically unambiguous plain-text / Unicode
 * representation while preserving grouping scope, matrix delimiters, overline notation,
 * and any unknown LaTeX commands/braces.
 */
export function formatLatexMath(expr: string): string {
  let out = stripMathDelimiters(expr);

  // Matrix environments: pmatrix, bmatrix, Bmatrix, vmatrix, Vmatrix, matrix
  out = out.replace(
    /\\begin\{(p|b|B|v|V)?matrix\}([\s\S]*?)\\end\{\1?matrix\}/g,
    (_m, kind: string | undefined, body: string) => {
      const rows = body
        .trim()
        .split(/\\\\/)
        .map((r) => r.trim())
        .filter((r) => r.length > 0)
        .map((r) =>
          r
            .split('&')
            .map((cell) => formatLatexMath(cell.trim()))
            .join(', ')
        );
      if (kind === 'p') {
        return `(${rows.map((r) => `(${r})`).join('; ')})`;
      }
      if (kind === 'b') {
        return `[${rows.map((r) => `[${r}]`).join('; ')}]`;
      }
      if (kind === 'B') {
        return `{${rows.map((r) => `{${r}}`).join('; ')}}`;
      }
      if (kind === 'v') {
        return `|${rows.map((r) => `(${r})`).join('; ')}|`;
      }
      if (kind === 'V') {
        return `||${rows.map((r) => `(${r})`).join('; ')}||`;
      }
      return `[${rows.map((r) => `(${r})`).join('; ')}]`;
    }
  );

  // \underline{\hspace{...}} or \hspace{...} -> _____
  out = out.replace(/\\underline\{\\hspace\{[^{}]*\}\}/g, '________');
  out = out.replace(/\\hspace\{[^{}]*\}/g, '____');

  // \text{...}, \textbf{...}, \textit{...}, \textrm{...} -> inner text
  out = out.replace(
    /\\(?:text|textbf|textit|textrm|textsf|texttt|mbox)\{([^{}]*)\}/g,
    (_m, inner: string) => inner.replace(/\\_/g, '_')
  );

  // \underline{...} -> inner text or blank line
  out = out.replace(/\\underline\{([^{}]*)\}/g, (_m, inner: string) => {
    const cleaned = inner.replace(/\\_/g, '_').trim();
    return cleaned.length > 0 ? cleaned : '________';
  });

  // Escaped underscores
  out = out.replace(/\\_/g, '_');

  // \overline{...} -> combining overline for simple tokens, ‾(...) for compound expressions
  out = out.replace(/\\overline\{([^{}]+)\}/g, (_m, inner: string) => {
    const formatted = formatLatexMath(inner.trim());
    if (/^[a-zA-Z0-9]+$/.test(formatted)) {
      return formatted
        .split('')
        .map((ch) => `${ch}\u0305`)
        .join('');
    }
    return `\u203e(${formatted})`;
  });

  // \frac{a}{b} (and \dfrac, \tfrac) -> parenthesize when followed by a factor or compound
  for (let i = 0; i < 3; i++) {
    out = out.replace(
      /\\(?:d|t)?frac\{([^{}]+)\}\{([^{}]+)\}([a-zA-Z0-9(\\√]?)/g,
      (_m, num: string, den: string, nextChar: string) => {
        const cleanNum = formatLatexMath(num.trim());
        const cleanDen = formatLatexMath(den.trim());
        const numPart = /[+\-*/\s]/.test(cleanNum) ? `(${cleanNum})` : cleanNum;
        const denPart = /[+\-*/\s]/.test(cleanDen) ? `(${cleanDen})` : cleanDen;
        const core = `${numPart}/${denPart}`;
        if (nextChar) {
          return `(${core})${nextChar}`;
        }
        return core;
      }
    );
  }

  // \sqrt[n]{x} and \sqrt{x} -> preserve scope with √(...) unless standalone pure number
  out = out.replace(
    /\\sqrt(?:\[([^\]]+)\])?\{([^{}]+)\}([a-zA-Z0-9(\\]?)/g,
    (_m, root: string | undefined, radicand: string, nextChar: string) => {
      const cleanRad = formatLatexMath(radicand.trim());
      const rootSup = root ? (toSuperscript(root.trim()) ?? `^(${root.trim()})`) : '';
      const isSimpleNumber = /^\d+$/.test(cleanRad);
      if (isSimpleNumber && !nextChar) {
        return `${rootSup}√${cleanRad}`;
      }
      return `${rootSup}√(${cleanRad})${nextChar || ''}`;
    }
  );

  // Degrees
  out = out.replace(/\^\{\\circ\}/g, '°');
  out = out.replace(/\^\\circ\b/g, '°');
  out = out.replace(/\\circ\b/g, '°');

  // Common operators and symbols
  const symbolReplacements: Array<[RegExp, string]> = [
    [/\\cdot\b/g, '·'],
    [/\\times\b/g, '×'],
    [/\\div\b/g, ':'],
    [/\\pm\b/g, '±'],
    [/\\mp\b/g, '∓'],
    [/\\leq\b|\\le\b/g, '≤'],
    [/\\geq\b|\\ge\b/g, '≥'],
    [/\\neq\b|\\ne\b/g, '≠'],
    [/\\approx\b/g, '≈'],
    [/\\equiv\b/g, '≡'],
    [/\\sim\b/g, '∼'],
    [/\\rightarrow\b|\\to\b/g, '→'],
    [/\\leftarrow\b/g, '←'],
    [/\\Rightarrow\b/g, '⇒'],
    [/\\Leftrightarrow\b|\\iff\b/g, '⇔'],
    [/\\infty\b/g, '∞'],
    [/\\pi\b/g, 'π'],
    [/\\alpha\b/g, 'α'],
    [/\\beta\b/g, 'β'],
    [/\\gamma\b/g, 'γ'],
    [/\\delta\b/g, 'δ'],
    [/\\Delta\b/g, 'Δ'],
    [/\\epsilon\b|\\varepsilon\b/g, 'ε'],
    [/\\theta\b/g, 'θ'],
    [/\\lambda\b/g, 'λ'],
    [/\\mu\b/g, 'μ'],
    [/\\sigma\b/g, 'σ'],
    [/\\omega\b/g, 'ω'],
    [/\\Omega\b/g, 'Ω'],
    [/\\quad\b|\\qquad\b/g, '  '],
    [/\\,|\\;|\\:|\\!/g, ' '],
    [/\\left\b|\\right\b|\\displaystyle\b|\\textstyle\b|\\scriptstyle\b/g, ''],
    [/\\%/g, '%'],
  ];

  for (const [pattern, replacement] of symbolReplacements) {
    out = out.replace(pattern, replacement);
  }

  // Superscripts: ^{...} or ^x
  out = out.replace(/\^\{([^{}]+)\}/g, (_m, exp: string) => {
    const sup = toSuperscript(exp.trim());
    return sup ?? `^(${exp.trim()})`;
  });
  out = out.replace(/\^([0-9+\-=n])/g, (_m, exp: string) => {
    return toSuperscript(exp) ?? `^${exp}`;
  });

  // Subscripts: _{...} or _x (avoiding ___ blank lines)
  out = out.replace(/([^_])_\{([^{}]+)\}/g, (_m, prev: string, sub: string) => {
    const mapped = toSubscript(sub.trim());
    return `${prev}${mapped ?? `_(${sub.trim()})`}`;
  });
  out = out.replace(/([^_])_([0-9a-zA-Z])(?![_a-zA-Z0-9])/g, (_m, prev: string, sub: string) => {
    const mapped = toSubscript(sub);
    return `${prev}${mapped ?? `_${sub}`}`;
  });

  // Normalize multiple spaces (while preserving unknown \commands and {...} intact)
  out = out.replace(/[ \t]{2,}/g, ' ').trim();

  return out;
}

/**
 * Replaces inline and display LaTeX math segments in arbitrary text with
 * semantically unambiguous plain text (`formatLatexMath`).
 */
export function replaceLatexInText(text: string): string {
  let out = text;

  // Display math $$...$$
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_m, inner: string) => formatLatexMath(inner));

  // Display math \[...\]
  out = out.replace(/\\\[([\s\S]+?)\\\]/g, (_m, inner: string) => formatLatexMath(inner));

  // Inline math \(...\)
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_m, inner: string) => formatLatexMath(inner));

  // Inline math $...$
  out = out.replace(/\$([^$\n]+?)\$/g, (_m, inner: string) => formatLatexMath(inner));

  // Bare LaTeX commands left outside $...$ delimiters
  if (
    /\\(?:frac|dfrac|tfrac|sqrt|overline|text|textbf|textit|textrm|underline|hspace|cdot|times|div|pm|leq|geq|neq|approx|pi|alpha|beta|gamma|delta|Delta|theta|infty|circ|begin\{(?:p|b|B|v|V)?matrix\})/.test(
      out
    )
  ) {
    out = formatLatexMath(out);
  }

  return out;
}

const HEADER_FIELD_LABELS = [
  'name\\s*\\/\\s*vorname',
  'vorname\\s*\\/\\s*name',
  'name',
  'vorname',
  'datum',
  'klasse',
  'fach',
  'erreichte\\s+punkte',
  'max\\.?\\s*punkte',
  'gesamtpunktzahl',
  'gesamtpunkte',
  'punktzahl',
  'punkte',
  'note',
  'unterschrift(?:\\s+der\\s+eltern|\\s+erziehungsberechtigte[rn]?)?',
  'zeit(?:vorgabe)?',
  'dauer',
];

const HEADER_LABEL_REGEX = new RegExp(`^(?:${HEADER_FIELD_LABELS.join('|')})$`, 'i');

function cleanMarkdownFormattingForCheck(line: string): string {
  return line
    .replace(/^[-*+•]\s+/, '')
    .replace(/^[#>]+/, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`/g, '')
    .trim();
}

function isDuplicateMetadataSegment(segment: string): boolean {
  const cleaned = cleanMarkdownFormattingForCheck(segment);
  if (!cleaned) return true;

  const colonIdx = cleaned.indexOf(':');
  if (colonIdx !== -1) {
    const label = cleaned.slice(0, colonIdx).trim();
    const value = cleaned.slice(colonIdx + 1).trim();
    if (HEADER_LABEL_REGEX.test(label)) {
      if (
        value === '' ||
        /^[_\s./\-–—0-9pPtT()[\]]+$/.test(value) ||
        label.toLowerCase() === 'datum' ||
        label.toLowerCase() === 'klasse' ||
        label.toLowerCase() === 'fach'
      ) {
        return true;
      }
    }
  }

  const blankMatch =
    /^([A-Za-zÄÖÜäöü\s/.]+?)\s+[_.]{3,}(?:\s*\/\s*\d+(?:\s*(?:P\.?|Punkte))?)?$/i.exec(cleaned);
  if (blankMatch && HEADER_LABEL_REGEX.test(blankMatch[1].trim())) {
    return true;
  }

  return false;
}

function isDuplicateMetadataLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  if (/^\|?[\s:_-]+\|[\s:|\-_]*$/.test(trimmed)) {
    return false;
  }

  const pipeSegments = trimmed
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

  if (pipeSegments.length >= 1 && pipeSegments.every((seg) => isDuplicateMetadataSegment(seg))) {
    return true;
  }

  const multiSegments = trimmed
    .split(/\s{2,}|\t+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (multiSegments.length >= 2 && multiSegments.every((seg) => isDuplicateMetadataSegment(seg))) {
    return true;
  }

  const multiColonMatches = [
    ...cleanMarkdownFormattingForCheck(trimmed).matchAll(
      new RegExp(`\\b(${HEADER_FIELD_LABELS.join('|')})\\s*:`, 'gi')
    ),
  ];
  if (multiColonMatches.length >= 2) {
    return true;
  }

  return isDuplicateMetadataSegment(trimmed);
}

function normalizeTitleForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/^[#>*\-\s]+/, '')
    .replace(/\*\*/g, '')
    .replace(/^(?:lernzielkontrolle|prüfung|pruefung|test|klausur|arbeitsblatt)\s*[:–—-]?\s*/i, '')
    .replace(/[^a-z0-9äöü]/g, '');
}

function isDuplicateTitleLine(line: string, examTitle?: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  const headingMatch = /^(?:#{1,3}\s+|\*\*)(.+?)(?:\*\*)?$/.exec(trimmed);
  if (!headingMatch) return false;

  const rawHeading = headingMatch[1].replace(/\*\*/g, '').trim();

  if (/^(?:aufgabe|teilaufgabe|übung|uebung|frage)\b/i.test(rawHeading)) {
    return false;
  }
  if (
    /^(?:hinweise?|bearbeitungshinweise?|anleitung|instruktionen?|allgemeines?)\s*:?$/i.test(
      rawHeading
    )
  ) {
    return false;
  }

  if (
    /^(?:prüfung|pruefung|lernzielkontrolle|klassenarbeit|test|klausur)\s*[:–—-]/i.test(rawHeading)
  ) {
    return true;
  }

  if (examTitle) {
    const normHeading = normalizeTitleForComparison(rawHeading);
    const normExamTitle = normalizeTitleForComparison(examTitle);
    if (
      normHeading.length >= 3 &&
      normExamTitle.length >= 3 &&
      (normHeading === normExamTitle ||
        normExamTitle.includes(normHeading) ||
        normHeading.includes(normExamTitle))
    ) {
      return true;
    }
  }

  return false;
}

function isFirstTaskOrSectionLine(line: string): boolean {
  const cleaned = cleanMarkdownFormattingForCheck(line);
  return /^(?:aufgabe|teilaufgabe|übung|uebung|frage|teil)\s*\d+/i.test(cleaned);
}

/**
 * Strips duplicate title and Name/Datum/Klasse/Punkte/Note header blocks
 * from the preamble of `examTemplateText` (before the first task).
 */
export function stripDuplicateWorksheetHeader(
  templateText: string,
  options?: { examTitle?: string }
): string {
  const lines = templateText.replace(/\r\n/g, '\n').split('\n');
  const result: string[] = [];

  let inPreamble = true;
  let strippedAnyPreambleHeader = false;
  let lastNonEmptyWasStripped = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (inPreamble && isFirstTaskOrSectionLine(trimmed)) {
      inPreamble = false;
    }

    if (inPreamble) {
      if (trimmed === '') {
        if (result.length > 0 && result[result.length - 1].trim() !== '') {
          result.push('');
        }
        continue;
      }

      if (isDuplicateTitleLine(trimmed, options?.examTitle)) {
        strippedAnyPreambleHeader = true;
        lastNonEmptyWasStripped = true;
        continue;
      }

      if (isDuplicateMetadataLine(trimmed)) {
        strippedAnyPreambleHeader = true;
        lastNonEmptyWasStripped = true;
        continue;
      }

      if (/^\|?[\s:_-]+\|[\s:|\-_]*$/.test(trimmed) && lastNonEmptyWasStripped) {
        continue;
      }

      if (/^(?:---+|\*\*\*+|___+)$/.test(trimmed)) {
        if (result.filter((l) => l.trim() !== '').length === 0 || lastNonEmptyWasStripped) {
          lastNonEmptyWasStripped = false;
          continue;
        }
      }

      if (
        strippedAnyPreambleHeader &&
        !isDuplicateMetadataLine(trimmed) &&
        result.filter((l) => l.trim() !== '').length > 0
      ) {
        lastNonEmptyWasStripped = false;
      } else {
        lastNonEmptyWasStripped = false;
      }
    }

    result.push(line);
  }

  while (result.length > 0 && result[0].trim() === '') {
    result.shift();
  }
  while (result.length > 0 && /^(?:---+|\*\*\*+|___+)$/.test(result[0].trim())) {
    result.shift();
    while (result.length > 0 && result[0].trim() === '') {
      result.shift();
    }
  }

  return result.join('\n').trim();
}

export function sanitizeExamTemplateText(
  templateText: string,
  options?: { examTitle?: string }
): string {
  const withoutHeader = stripDuplicateWorksheetHeader(templateText, options);
  const blocks = parseTaskSheetBlocks(withoutHeader, options);
  return renderTaskSheetToPlainText(blocks);
}

/**
 * Strips inline Markdown syntax (`**`, `*`, `` ` ``) and formats inline LaTeX
 * for plain-text contexts while preserving answer blanks (`_____`).
 */
export function stripInlineMarkdown(text: string): string {
  let out = replaceLatexInText(text);
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1');
  out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1');
  out = out.replace(/`([^`\n]+)`/g, '$1');
  return out;
}

const BARE_LATEX_COMMAND_REGEX =
  /\\(?:frac|dfrac|tfrac|sqrt|overline|underline\{\\hspace|hspace\{|cdot|times|div|pm|mp|leq|le|geq|ge|neq|ne|approx|equiv|pi|alpha|beta|gamma|delta|Delta|theta|lambda|mu|sigma|omega|Omega|infty|circ|begin\{(?:p|b|B|v|V)?matrix\})\b/;

function tokenizePlainTextWithBareLatex(segment: string): InlineToken[] {
  if (!BARE_LATEX_COMMAND_REGEX.test(segment)) {
    return segment ? [{ type: 'text', content: segment }] : [];
  }

  // Check if the segment starts with a plain label/prefix like "a) " or "Berechne: "
  const prefixMatch = /^(\s*(?:[a-zA-Z0-9]+[.)]\s+)?)([\s\S]+)$/.exec(segment);
  if (prefixMatch && prefixMatch[1]) {
    const prefix = prefixMatch[1];
    const rest = prefixMatch[2];
    const rendered = renderLatexMath(rest, { displayMode: false });
    return [
      { type: 'text', content: prefix },
      {
        type: 'math',
        latex: rendered.latex,
        html: rendered.html,
        content: rendered.text,
        isFallback: rendered.isFallback,
      },
    ];
  }

  const rendered = renderLatexMath(segment, { displayMode: false });
  return [
    {
      type: 'math',
      latex: rendered.latex,
      html: rendered.html,
      content: rendered.text,
      isFallback: rendered.isFallback,
    },
  ];
}

/**
 * Parses a line of text into inline tokens (`text`, `bold`, `italic`, `code`, `math`),
 * rendering math expressions with KaTeX while preserving original source and answer blanks (`_____`).
 */
export function parseInlineTaskSheetTokens(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const tokenRegex =
    /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+?\$|\*\*[^*]+\*\*|(?<!\*)\*[^*\n]+\*(?!\*)|`[^`\n]+`)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(...tokenizePlainTextWithBareLatex(text.slice(lastIndex, match.index)));
    }

    const raw = match[0];
    if (
      (raw.startsWith('$$') && raw.endsWith('$$')) ||
      (raw.startsWith('\\[') && raw.endsWith('\\]')) ||
      (raw.startsWith('\\(') && raw.endsWith('\\)')) ||
      (raw.startsWith('$') && raw.endsWith('$'))
    ) {
      const rendered = renderLatexMath(raw, { displayMode: false });
      tokens.push({
        type: 'math',
        latex: rendered.latex,
        html: rendered.html,
        content: rendered.text,
        isFallback: rendered.isFallback,
      });
    } else if (raw.startsWith('**') && raw.endsWith('**')) {
      const inner = raw.slice(2, -2);
      const innerTokens = parseInlineTaskSheetTokens(inner);
      tokens.push({
        type: 'bold',
        content: innerTokens.map((t) => t.content).join(''),
        tokens: innerTokens,
      });
    } else if (raw.startsWith('*') && raw.endsWith('*')) {
      const inner = raw.slice(1, -1);
      const innerTokens = parseInlineTaskSheetTokens(inner);
      tokens.push({
        type: 'italic',
        content: innerTokens.map((t) => t.content).join(''),
        tokens: innerTokens,
      });
    } else if (raw.startsWith('`') && raw.endsWith('`')) {
      tokens.push({ type: 'code', content: raw.slice(1, -1) });
    } else {
      tokens.push({ type: 'text', content: raw });
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push(...tokenizePlainTextWithBareLatex(text.slice(lastIndex)));
  }

  return tokens.length > 0 ? tokens : [{ type: 'text', content: '' }];
}

function isStandaloneAnswerLine(line: string): boolean {
  const trimmed = line.trim();
  return /^_{10,}$/.test(trimmed) || /^(?:_\s*){10,}$/.test(trimmed);
}

/**
 * Parses `examTemplateText` into structured print blocks (headings, paragraphs,
 * KaTeX display math blocks, lists, dividers, and handwriting answer lines) after
 * stripping any duplicate worksheet header.
 */
export function parseTaskSheetBlocks(
  templateText: string,
  options?: { examTitle?: string }
): TaskSheetBlock[] {
  const stripped = stripDuplicateWorksheetHeader(templateText, options);
  const lines = stripped.split('\n');
  const blocks: TaskSheetBlock[] = [];

  let currentList: TaskSheetListBlock | null = null;
  let pendingAnswerLines = 0;

  const flushList = () => {
    if (currentList && currentList.items.length > 0) {
      blocks.push(currentList);
      currentList = null;
    }
  };

  const flushAnswerLines = () => {
    if (pendingAnswerLines > 0) {
      blocks.push({ type: 'answer-lines', count: pendingAnswerLines });
      pendingAnswerLines = 0;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed === '') {
      flushList();
      flushAnswerLines();
      continue;
    }

    // Standalone handwriting answer lines (e.g. ____________________)
    if (isStandaloneAnswerLine(trimmed)) {
      flushList();
      pendingAnswerLines += 1;
      continue;
    }

    flushAnswerLines();

    // Horizontal rule (`---`, `***`)
    if (/^(?:---+|\*\*\*+)$/.test(trimmed)) {
      flushList();
      if (blocks.length > 0 && blocks[blocks.length - 1].type !== 'divider') {
        blocks.push({ type: 'divider' });
      }
      continue;
    }

    // Display math block: single-line or multi-line $$...$$
    if (trimmed.startsWith('$$')) {
      flushList();
      let rawMath = trimmed;
      if (!(trimmed.endsWith('$$') && trimmed.length >= 4)) {
        const mathLines = [rawLine];
        while (i + 1 < lines.length) {
          i += 1;
          mathLines.push(lines[i]);
          if (lines[i].trim().endsWith('$$')) {
            break;
          }
        }
        rawMath = mathLines.join('\n').trim();
      }
      const rendered = renderLatexMath(rawMath, { displayMode: true });
      blocks.push({
        type: 'math',
        latex: rendered.latex,
        html: rendered.html,
        text: rendered.text,
        isFallback: rendered.isFallback,
      });
      continue;
    }

    // Display math block: single-line or multi-line \[...\]
    if (trimmed.startsWith('\\[')) {
      flushList();
      let rawMath = trimmed;
      if (!(trimmed.endsWith('\\]') && trimmed.length >= 4)) {
        const mathLines = [rawLine];
        while (i + 1 < lines.length) {
          i += 1;
          mathLines.push(lines[i]);
          if (lines[i].trim().endsWith('\\]')) {
            break;
          }
        }
        rawMath = mathLines.join('\n').trim();
      }
      const rendered = renderLatexMath(rawMath, { displayMode: true });
      blocks.push({
        type: 'math',
        latex: rendered.latex,
        html: rendered.html,
        text: rendered.text,
        isFallback: rendered.isFallback,
      });
      continue;
    }

    // Markdown headings (`#`, `##`, `###`, `####`) or standalone bold task/section headings
    const mdHeadingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    const boldTaskHeadingMatch = mdHeadingMatch
      ? null
      : /^\*\*((?:Aufgabe|Teilaufgabe|Übung|Uebung|Frage|Hinweise?|Bearbeitungshinweise?|Anleitung)\b[^*]*)\*\*$/i.exec(
          trimmed
        );

    if (mdHeadingMatch || boldTaskHeadingMatch) {
      flushList();
      const rawHeadingText = mdHeadingMatch
        ? mdHeadingMatch[2].trim()
        : boldTaskHeadingMatch![1].trim();
      const hashCount = mdHeadingMatch ? mdHeadingMatch[1].length : 3;
      const isTaskHeading = /^(?:aufgabe|teilaufgabe|übung|uebung|frage)\b/i.test(
        rawHeadingText.replace(/\*\*/g, '')
      );
      const level: 1 | 2 | 3 = hashCount === 1 ? 1 : isTaskHeading || hashCount === 2 ? 2 : 3;
      const tokens = parseInlineTaskSheetTokens(rawHeadingText);
      const cleanHeadingText = tokens.map((t) => t.content).join('');
      blocks.push({
        type: 'heading',
        level,
        variant: isTaskHeading ? 'task' : 'section',
        text: cleanHeadingText,
        tokens,
      });
      continue;
    }

    // Unordered list items (`- ...`, `* ...`, `• ...`)
    const bulletMatch = /^(?:[-*+•])\s+(.+)$/.exec(trimmed);
    if (bulletMatch) {
      const itemText = bulletMatch[1].trim();
      if (!currentList || currentList.ordered) {
        flushList();
        currentList = { type: 'list', ordered: false, items: [] };
      }
      const tokens = parseInlineTaskSheetTokens(itemText);
      currentList.items.push({
        marker: '•',
        text: tokens.map((t) => t.content).join(''),
        tokens,
      });
      continue;
    }

    // Ordered or lettered sub-items (`1. ...`, `1) ...`, `a) ...`, `b) ...`)
    const orderedMatch = /^([a-zA-Z]\)|[0-9]+[.)])\s+(.+)$/.exec(trimmed);
    if (orderedMatch) {
      const marker = orderedMatch[1];
      const itemText = orderedMatch[2].trim();
      if (!currentList || !currentList.ordered) {
        flushList();
        currentList = { type: 'list', ordered: true, items: [] };
      }
      const tokens = parseInlineTaskSheetTokens(itemText);
      currentList.items.push({
        marker,
        text: tokens.map((t) => t.content).join(''),
        tokens,
      });
      continue;
    }

    flushList();

    const tokens = parseInlineTaskSheetTokens(trimmed);
    blocks.push({
      type: 'paragraph',
      text: tokens.map((t) => t.content).join(''),
      tokens,
    });
  }

  flushList();
  flushAnswerLines();

  return blocks;
}

/**
 * Renders structured `TaskSheetBlock[]` into clean, human-readable plain text.
 */
export function renderTaskSheetToPlainText(blocks: TaskSheetBlock[]): string {
  const sections: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        sections.push(block.text);
        break;
      case 'paragraph':
        sections.push(block.text);
        break;
      case 'math':
        sections.push(`  ${block.text}`);
        break;
      case 'list':
        sections.push(block.items.map((item) => `${item.marker ?? '•'} ${item.text}`).join('\n'));
        break;
      case 'divider':
        break;
      case 'answer-lines':
        sections.push(
          Array.from(
            { length: block.count },
            () => '________________________________________'
          ).join('\n')
        );
        break;
    }
  }

  return sections.join('\n\n').trim();
}
