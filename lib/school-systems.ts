/**
 * Schweizer Schulverwaltungs-Integration (PUPIL, LehrerOffice, Schulnetz / Evento)
 * Deterministischer Parser für Klassenlisten-Importe (CSV, TSV, JSON, Freitext)
 * sowie Format-Generator für Noten- und Leistungs-Exporte.
 */

export type SchoolSystemExportFormat = 'STANDARD_CSV' | 'PUPIL' | 'LEHREROFFICE' | 'SCHULNETZ';

export type DetectedRosterFormat =
  | 'PLAIN_LIST'
  | 'PUPIL'
  | 'LEHREROFFICE'
  | 'SCHULNETZ'
  | 'CSV_TABLE'
  | 'JSON';

export interface SchoolSystemExportOption {
  value: SchoolSystemExportFormat;
  label: string;
  shortLabel: string;
  description: string;
}

export const SCHOOL_SYSTEM_EXPORT_OPTIONS: SchoolSystemExportOption[] = [
  {
    value: 'STANDARD_CSV',
    label: 'Standard CSV (Excel / Übersicht)',
    shortLabel: 'Standard CSV',
    description: 'Klassische prüefli-Notenliste mit Punkten, Note, Status und Korrekturdatum.',
  },
  {
    value: 'PUPIL',
    label: 'PUPIL (pupil.ch) Notenexport',
    shortLabel: 'PUPIL (pupil.ch)',
    description:
      'Optimiert für das Schweizer Schulverwaltungsprogramm PUPIL (Vorname, Nachname, Klasse, Fach, Punkte, Note).',
  },
  {
    value: 'LEHREROFFICE',
    label: 'LehrerOffice Import-Format',
    shortLabel: 'LehrerOffice',
    description:
      'Kompatibel mit LehrerOffice (S_Name, S_Vorname, Klasse, Fach, Prüfung, Punkte, Note).',
  },
  {
    value: 'SCHULNETZ',
    label: 'Schulnetz / Evento Export',
    shortLabel: 'Schulnetz / Evento',
    description:
      'Spaltenstruktur für Schulnetz / Evento (Nachname, Vorname, Klassenbezeichnung, Fach, Note, Punkte).',
  },
];

function stripOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/""/g, '"').trim();
  }
  return trimmed;
}

function splitCsvRow(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(stripOuterQuotes(current));
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(stripOuterQuotes(current));
  return result;
}

function detectDelimiter(headerLine: string): ';' | '\t' | ',' | null {
  if (headerLine.includes('\t')) return '\t';
  if (headerLine.includes(';')) return ';';
  if (headerLine.includes(',')) return ',';
  return null;
}

const FIRST_NAME_HEADERS = new Set([
  'vorname',
  'vornamen',
  'rufname',
  's_vorname',
  'schueler_vorname',
  'schüler_vorname',
  'firstname',
  'first_name',
  'givenname',
]);

const LAST_NAME_HEADERS = new Set([
  'nachname',
  'familienname',
  's_name',
  's_nachname',
  'schueler_name',
  'schüler_name',
  'lastname',
  'last_name',
  'surname',
  'familyname',
]);

const FULL_NAME_HEADERS = new Set([
  'name',
  'schueler',
  'schüler',
  'schueler/in',
  'schüler/in',
  'schuelerin',
  'schülerin',
  'lernende',
  'lernende/r',
  'student',
  'student_name',
  'fullname',
  'full_name',
  'anzeigename',
]);

const NON_NAME_METADATA_HEADERS = new Set([
  'id',
  'pupilid',
  'pupil_id',
  'klasse',
  'klassenbezeichnung',
  'geburtsdatum',
  'geschlecht',
  'email',
  'e-mail',
  'status',
  'ahv',
  'nummer',
  'nr',
]);

function normalizeHeaderToken(raw: string): string {
  return stripOuterQuotes(raw)
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9äöü_/-]/g, '');
}

/**
 * Zerlegt einen kombinierten Namen in Vorname und Nachname.
 * Unterstützt sowohl "Nachname, Vorname" als auch "Vorname Nachname".
 */
export function splitStudentFullName(fullName: string): {
  firstName: string;
  lastName: string;
  normalizedFullName: string;
} {
  const cleaned = stripOuterQuotes(fullName).replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return { firstName: '', lastName: '', normalizedFullName: '' };
  }

  if (cleaned.includes(',')) {
    const [lastPart, ...firstParts] = cleaned
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const firstName = firstParts.join(' ').trim();
    const lastName = (lastPart || '').trim();
    const normalizedFullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    return { firstName, lastName, normalizedFullName };
  }

  const parts = cleaned.split(' ').filter(Boolean);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '', normalizedFullName: parts[0] };
  }

  const lastName = parts[parts.length - 1];
  const firstName = parts.slice(0, -1).join(' ');
  return {
    firstName,
    lastName,
    normalizedFullName: `${firstName} ${lastName}`.trim(),
  };
}

/**
 * Parst beliebige Eingaben (PUPIL CSV/JSON, LehrerOffice CSV/TSV, Schulnetz CSV oder einfache Namensliste)
 * zu einer bereinigten Liste von Schülernamen ("Vorname Nachname").
 */
export function parseSchoolSystemRosterInput(rawText: string): {
  names: string[];
  detectedFormat: DetectedRosterFormat;
} {
  const cleanedRaw = (rawText || '').replace(/^\uFEFF/, '').trim();
  if (!cleanedRaw) {
    return { names: [], detectedFormat: 'PLAIN_LIST' };
  }

  // 1. JSON-Import (z.B. PUPIL API / JSON-Export)
  if (cleanedRaw.startsWith('[') || cleanedRaw.startsWith('{')) {
    try {
      const parsed = JSON.parse(cleanedRaw);
      const records: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.pupils)
          ? parsed.pupils
          : Array.isArray(parsed?.students)
            ? parsed.students
            : Array.isArray(parsed?.data)
              ? parsed.data
              : [];

      if (records.length > 0) {
        const names: string[] = [];
        let hasPupilKeys = false;
        for (const item of records) {
          if (typeof item === 'string') {
            const norm = splitStudentFullName(item).normalizedFullName;
            if (norm) names.push(norm);
            continue;
          }
          if (item && typeof item === 'object') {
            const obj = item as Record<string, unknown>;
            if ('pupilId' in obj || 'PupilId' in obj || 'rufname' in obj || 'Rufname' in obj) {
              hasPupilKeys = true;
            }
            const first = String(
              obj.Vorname ??
                obj.vorname ??
                obj.Rufname ??
                obj.rufname ??
                obj.firstName ??
                obj.first_name ??
                obj.S_Vorname ??
                ''
            ).trim();
            const last = String(
              obj.Nachname ??
                obj.nachname ??
                obj.Familienname ??
                obj.familienname ??
                obj.lastName ??
                obj.last_name ??
                obj.S_Name ??
                ''
            ).trim();
            const full = String(
              obj.Name ?? obj.name ?? obj.fullName ?? obj['Schüler/in'] ?? ''
            ).trim();

            if (first && last) {
              names.push(`${first} ${last}`.replace(/\s+/g, ' ').trim());
            } else if (full) {
              const norm = splitStudentFullName(full).normalizedFullName;
              if (norm) names.push(norm);
            } else if (first || last) {
              names.push((first || last).trim());
            }
          }
        }
        return {
          names,
          detectedFormat: hasPupilKeys ? 'PUPIL' : 'JSON',
        };
      }
    } catch {
      // Kein gültiges JSON -> fahre mit CSV/Text-Parser fort
    }
  }

  const lines = cleanedRaw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { names: [], detectedFormat: 'PLAIN_LIST' };
  }

  const delimiter = detectDelimiter(lines[0]);

  // 2. Tabellen-Format (CSV / TSV aus PUPIL, LehrerOffice oder Schulnetz)
  if (delimiter && (lines[0].includes(';') || lines[0].includes('\t') || lines.length > 1)) {
    const firstRowCells = splitCsvRow(lines[0], delimiter);
    const normalizedHeaders = firstRowCells.map(normalizeHeaderToken);

    const firstIdx = normalizedHeaders.findIndex((h) => FIRST_NAME_HEADERS.has(h));
    const lastIdx = normalizedHeaders.findIndex((h) => LAST_NAME_HEADERS.has(h));
    const fullIdx = normalizedHeaders.findIndex((h) => FULL_NAME_HEADERS.has(h));
    const hasKnownHeader =
      firstIdx !== -1 ||
      lastIdx !== -1 ||
      fullIdx !== -1 ||
      normalizedHeaders.some((h) => NON_NAME_METADATA_HEADERS.has(h));

    if (hasKnownHeader && firstRowCells.length >= 1) {
      let detectedFormat: DetectedRosterFormat = 'CSV_TABLE';
      if (normalizedHeaders.some((h) => h.startsWith('s_'))) {
        detectedFormat = 'LEHREROFFICE';
      } else if (
        normalizedHeaders.some(
          (h) => h.includes('pupil') || h === 'rufname' || h === 'lernende' || h === 'lernende/r'
        )
      ) {
        detectedFormat = 'PUPIL';
      } else if (normalizedHeaders.some((h) => h === 'klassenbezeichnung' || h === 'evento')) {
        detectedFormat = 'SCHULNETZ';
      } else if (firstIdx !== -1 && lastIdx !== -1) {
        detectedFormat = 'PUPIL';
      }

      const dataLines = lines.slice(1);
      const names: string[] = [];

      for (const line of dataLines) {
        const cells = splitCsvRow(line, delimiter);
        if (cells.every((c) => !c.trim())) continue;

        if (firstIdx !== -1 && lastIdx !== -1) {
          const first = (cells[firstIdx] || '').trim();
          const last = (cells[lastIdx] || '').trim();
          const combined = `${first} ${last}`.replace(/\s+/g, ' ').trim();
          if (combined) names.push(combined);
        } else if (fullIdx !== -1) {
          const rawFull = (cells[fullIdx] || '').trim();
          const norm = splitStudentFullName(rawFull).normalizedFullName;
          if (norm) names.push(norm);
        } else if (firstIdx !== -1) {
          const first = (cells[firstIdx] || '').trim();
          if (first) names.push(first);
        } else if (lastIdx !== -1) {
          const last = (cells[lastIdx] || '').trim();
          if (last) names.push(last);
        } else if (cells.length >= 2) {
          const combined = `${cells[0]} ${cells[1]}`.replace(/\s+/g, ' ').trim();
          if (combined) names.push(combined);
        } else if (cells[0]) {
          names.push(cells[0].trim());
        }
      }

      return { names, detectedFormat };
    }

    // Semikolon- oder Tab-getrennte Zeilen ohne Kopfzeile (z.B. "Meier;Anna" oder "Anna;Meier")
    if (delimiter === ';' || delimiter === '\t') {
      const names: string[] = [];
      for (const line of lines) {
        const cells = splitCsvRow(line, delimiter).filter(Boolean);
        if (cells.length >= 2) {
          names.push(`${cells[0]} ${cells[1]}`.replace(/\s+/g, ' ').trim());
        } else if (cells.length === 1) {
          names.push(splitStudentFullName(cells[0]).normalizedFullName);
        }
      }
      return { names: names.filter(Boolean), detectedFormat: 'CSV_TABLE' };
    }
  }

  // 3. Klassische Zeilenliste (ein Name pro Zeile, unterstützt auch "Nachname, Vorname")
  const names = lines
    .map((line) => {
      const normalizedToken = normalizeHeaderToken(line);
      if (
        lines.length > 1 &&
        (FULL_NAME_HEADERS.has(normalizedToken) ||
          FIRST_NAME_HEADERS.has(normalizedToken) ||
          LAST_NAME_HEADERS.has(normalizedToken))
      ) {
        return '';
      }
      return splitStudentFullName(line).normalizedFullName;
    })
    .filter((name) => name.length > 0);

  return { names, detectedFormat: 'PLAIN_LIST' };
}

function escapeCsvCell(value: string): string {
  const cleaned = String(value ?? '');
  if (cleaned.includes(';') || cleaned.includes('"') || cleaned.includes('\n')) {
    return `"${cleaned.replace(/"/g, '""')}"`;
  }
  return cleaned;
}

function translateStatusDe(status: string): string {
  if (status === 'COMPLETED') return 'Abgeschlossen';
  if (status === 'DRAFT') return 'Entwurf';
  if (status === 'FAILED') return 'Fehlgeschlagen';
  if (status === 'PROCESSING' || status === 'PENDING') return 'In Verarbeitung';
  return 'Ungestartet';
}

export interface GradeExportRowInput {
  studentName: string;
  status: string;
  earnedPoints: number | string | null;
  grade: number | string | null;
  date?: string;
  uncertainStepsCount?: number;
}

export interface FormatExamGradeExportParams {
  format: SchoolSystemExportFormat;
  examTitle: string;
  subject?: string | null;
  className?: string | null;
  maxPoints?: number | string | null;
  dateStr?: string;
  rows: GradeExportRowInput[];
}

/**
 * Erzeugt den fertigen Datei-Inhalt (inkl. UTF-8 BOM für Schweizer Umlaute in Excel, PUPIL, LehrerOffice & Schulnetz).
 */
export function formatExamGradeExport(params: FormatExamGradeExportParams): {
  content: string;
  mimeType: string;
  filename: string;
} {
  const {
    format,
    examTitle,
    subject = 'Allgemein',
    className = 'Klasse',
    maxPoints = '',
    dateStr = new Date().toISOString().slice(0, 10),
    rows,
  } = params;

  const safeTitle = `${className || 'Klasse'}_${examTitle || 'Pruefung'}`.replace(
    /[^a-zA-Z0-9äöüÄÖÜ_-]/g,
    '_'
  );

  if (format === 'PUPIL') {
    const header = [
      'Klasse',
      'Fach',
      'Prüfung',
      'Datum',
      'Vorname',
      'Nachname',
      'Schüler/in',
      'Punkte',
      'Maximalpunkte',
      'Note',
      'Status',
    ];
    const csvRows = rows.map((r) => {
      const { firstName, lastName, normalizedFullName } = splitStudentFullName(r.studentName);
      const pts =
        r.earnedPoints !== null && r.earnedPoints !== undefined && r.earnedPoints !== 'N/A'
          ? String(r.earnedPoints)
          : '';
      const gradeStr = r.status === 'COMPLETED' && r.grade !== null ? String(r.grade) : '';
      const rowDate = r.date && r.date !== '—' ? r.date : dateStr;

      return [
        escapeCsvCell(className || ''),
        escapeCsvCell(subject || ''),
        escapeCsvCell(examTitle || ''),
        escapeCsvCell(rowDate),
        escapeCsvCell(firstName),
        escapeCsvCell(lastName),
        escapeCsvCell(normalizedFullName),
        escapeCsvCell(pts),
        escapeCsvCell(String(maxPoints ?? '')),
        escapeCsvCell(gradeStr),
        escapeCsvCell(translateStatusDe(r.status)),
      ].join(';');
    });

    return {
      content: '\uFEFF' + [header.join(';'), ...csvRows].join('\r\n'),
      mimeType: 'text/csv;charset=utf-8;',
      filename: `PUPIL_Notenimport_${safeTitle}.csv`,
    };
  }

  if (format === 'LEHREROFFICE') {
    const header = [
      'S_Name',
      'S_Vorname',
      'Klasse',
      'Fach',
      'Prüfung',
      'Datum',
      'Punkte',
      'MaxPunkte',
      'Note',
      'Bemerkung',
    ];
    const csvRows = rows.map((r) => {
      const { firstName, lastName } = splitStudentFullName(r.studentName);
      const pts =
        r.earnedPoints !== null && r.earnedPoints !== undefined && r.earnedPoints !== 'N/A'
          ? String(r.earnedPoints)
          : '';
      const gradeStr = r.status === 'COMPLETED' && r.grade !== null ? String(r.grade) : '';
      const rowDate = r.date && r.date !== '—' ? r.date : dateStr;
      const noteComment =
        (r.uncertainStepsCount ?? 0) > 0
          ? `${r.uncertainStepsCount} KI-unsichere Schritte geprüft`
          : translateStatusDe(r.status);

      return [
        escapeCsvCell(lastName || firstName),
        escapeCsvCell(lastName ? firstName : ''),
        escapeCsvCell(className || ''),
        escapeCsvCell(subject || ''),
        escapeCsvCell(examTitle || ''),
        escapeCsvCell(rowDate),
        escapeCsvCell(pts),
        escapeCsvCell(String(maxPoints ?? '')),
        escapeCsvCell(gradeStr),
        escapeCsvCell(noteComment),
      ].join(';');
    });

    return {
      content: '\uFEFF' + [header.join(';'), ...csvRows].join('\r\n'),
      mimeType: 'text/csv;charset=utf-8;',
      filename: `LehrerOffice_${safeTitle}.csv`,
    };
  }

  if (format === 'SCHULNETZ') {
    const header = [
      'Nachname',
      'Vorname',
      'Klassenbezeichnung',
      'Fach',
      'Prüfungstitel',
      'Note',
      'Punkte',
      'Maximalpunkte',
      'Status',
    ];
    const csvRows = rows.map((r) => {
      const { firstName, lastName } = splitStudentFullName(r.studentName);
      const pts =
        r.earnedPoints !== null && r.earnedPoints !== undefined && r.earnedPoints !== 'N/A'
          ? String(r.earnedPoints)
          : '';
      const gradeStr = r.status === 'COMPLETED' && r.grade !== null ? String(r.grade) : '';

      return [
        escapeCsvCell(lastName || firstName),
        escapeCsvCell(lastName ? firstName : ''),
        escapeCsvCell(className || ''),
        escapeCsvCell(subject || ''),
        escapeCsvCell(examTitle || ''),
        escapeCsvCell(gradeStr),
        escapeCsvCell(pts),
        escapeCsvCell(String(maxPoints ?? '')),
        escapeCsvCell(translateStatusDe(r.status)),
      ].join(';');
    });

    return {
      content: '\uFEFF' + [header.join(';'), ...csvRows].join('\r\n'),
      mimeType: 'text/csv;charset=utf-8;',
      filename: `Schulnetz_${safeTitle}.csv`,
    };
  }

  // Default: STANDARD_CSV
  const header = [
    'Schüler/in',
    'Status',
    'Erzielte Punkte',
    'Maximalpunkte',
    'Note',
    'Korrekturdatum',
    'KI-Unsichere Schritte',
  ];
  const csvRows = rows.map((r) => [
    `"${String(r.studentName || '').replace(/"/g, '""')}"`,
    translateStatusDe(r.status),
    r.earnedPoints !== null && r.earnedPoints !== undefined && r.earnedPoints !== 'N/A'
      ? String(r.earnedPoints)
      : '',
    String(maxPoints ?? ''),
    r.status === 'COMPLETED' && r.grade !== null ? String(r.grade) : '',
    r.date && r.date !== '—' ? r.date : '',
    String(r.uncertainStepsCount ?? 0),
  ]);

  return {
    content: '\uFEFF' + [header.join(';'), ...csvRows.map((row) => row.join(';'))].join('\r\n'),
    mimeType: 'text/csv;charset=utf-8;',
    filename: `Notenliste_${safeTitle}.csv`,
  };
}
