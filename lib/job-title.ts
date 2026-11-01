export interface DashboardJobLike {
  studentName: string;
  examTitle: string;
  className: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | string;
  errorMessage?: string | null;
}

export function isDuplicateSubmissionError(errorMessage?: string | null): boolean {
  if (!errorMessage) return false;
  return /existiert bereits eine Korrektur|bereits eine Korrektur|DUPLICATE_SUBMISSION/i.test(
    errorMessage
  );
}

/**
 * Ermittelt den Anzeigetitel fuer eine Korrektur-Jobkarte im Dashboard.
 *
 * Logik:
 * - FAILED + Duplikat-Hinweis + Name im Fehlertext: "<Schuelername> — <Pruefung> (<Klasse>)"
 * - FAILED + Duplikat-Hinweis ohne Name: "Duplikat erkannt (<Pruefung>) (<Klasse>)"
 * - FAILED + nicht zugeordnet: "Korrektur fehlgeschlagen (<Pruefung>) (<Klasse>)"
 * - PENDING / PROCESSING + nicht zugeordnet: "🤖 Auto-Match läuft... (<Pruefung>) (<Klasse>)"
 * - COMPLETED oder andere Status / bereits zugeordnet: "<Schuelername> — <Pruefung> (<Klasse>)"
 */
export function getDashboardJobTitle(job: DashboardJobLike): string {
  const shortExamTitle = job.examTitle ? job.examTitle.split(':')[0] : '';

  if (job.studentName === 'Nicht zugeordnet') {
    if (job.status === 'FAILED') {
      if (isDuplicateSubmissionError(job.errorMessage)) {
        const nameMatch = job.errorMessage?.match(/Für Schüler\/in\s+"([^"]+)"/i);
        const extractedName = nameMatch?.[1]?.trim();
        if (extractedName) {
          return `${extractedName} — ${job.examTitle} (${job.className})`;
        }
        return `Duplikat erkannt (${shortExamTitle}) (${job.className})`;
      }
      return `Korrektur fehlgeschlagen (${shortExamTitle}) (${job.className})`;
    }
    if (job.status === 'PENDING' || job.status === 'PROCESSING') {
      return `🤖 Auto-Match läuft... (${shortExamTitle}) (${job.className})`;
    }
  }

  return `${job.studentName} — ${job.examTitle} (${job.className})`;
}
