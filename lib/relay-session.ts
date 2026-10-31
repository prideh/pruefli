export interface RelayStudentOption {
  id: string;
  name: string;
}

export interface RelayExamOption {
  id: string;
  title: string;
  subject: string;
  classId: string;
  className: string;
  students: RelayStudentOption[];
}

export interface RecentMobileUpload {
  id: string;
  studentName: string;
  examTitle: string;
  className: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  grade: string | null;
  earnedPoints?: number | null;
  maxPoints?: number | null;
  uncertainStepsCount?: number;
  isExamMatchUncertain: boolean;
  isStudentMatchUncertain: boolean;
  time: string;
}

export type ActiveScanMode =
  | 'SUBMISSION'
  | 'RUBRIC'
  | 'EXAM_TEMPLATE'
  | 'APPEND_SUBMISSION'
  | 'REPLACE_SUBMISSION';

export interface RelaySessionData {
  teacherName?: string;
  exams?: RelayExamOption[];
  recentUploads?: RecentMobileUpload[];
  lockedExamId?: string;
  lockedStudentId?: string;
  lockedStudentName?: string;
  lockedSubmissionId?: string;
  targetMode?: ActiveScanMode;
  error?: string;
}

export interface RelaySessionParseResult {
  success: boolean;
  data?: RelaySessionData;
  error?: string;
  isTokenExpired?: boolean;
}

/**
 * Returns a standardized message for genuine network failures (e.g. offline, DNS failure, connection refused).
 */
export function getRelayNetworkErrorMessage(): string {
  return 'Netzwerkfehler: Verbindung zum Server fehlgeschlagen.';
}

/**
 * Parses the response from GET /api/mobile-relay, distinguishing between:
 * - Successful JSON response
 * - Token expired / invalid (401 or token error message)
 * - HTTP error status with JSON body (e.g. 500, 403, 404)
 * - HTTP error status with non-JSON body (e.g. 502/503 HTML proxy/spin-up error)
 * - JSON parse error on 200 OK (invalid JSON body)
 */
export async function parseRelaySessionResponse(res: Response): Promise<RelaySessionParseResult> {
  let text = '';
  try {
    text = await res.text();
  } catch {
    return {
      success: false,
      error: `Serverfehler (HTTP ${res.status}): Antwort konnte nicht gelesen werden.`,
      isTokenExpired: res.status === 401,
    };
  }

  const hasText = Boolean(text && text.trim().length > 0);
  let data: RelaySessionData | null = null;
  let isJson = false;

  if (hasText) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        data = parsed as RelaySessionData;
      }
      isJson = true;
    } catch {
      isJson = false;
    }
  }

  // HTTP Success (200-299)
  if (res.ok) {
    if (!isJson) {
      return {
        success: false,
        error: 'Serverantwort konnte nicht verarbeitet werden (ungültiges JSON-Format).',
        isTokenExpired: false,
      };
    }
    return {
      success: true,
      data: data || {},
    };
  }

  // HTTP Error (>= 400)
  const isTokenExpired =
    res.status === 401 ||
    (typeof data?.error === 'string' &&
      (data.error.toLowerCase().includes('abgelaufen') ||
        data.error.toLowerCase().includes('ungültig')));

  if (isTokenExpired) {
    return {
      success: false,
      error:
        (typeof data?.error === 'string' && data.error.trim()) ||
        'Dieser QR-Code ist abgelaufen oder ungültig. Bitte generiere auf dem Desktop einen neuen QR-Code.',
      isTokenExpired: true,
    };
  }

  if (hasText && !isJson) {
    return {
      success: false,
      error: `Serverfehler (HTTP ${res.status}): Antwort ist kein valides JSON.`,
      isTokenExpired: false,
    };
  }

  if (isJson && typeof data?.error === 'string' && data.error.trim()) {
    return {
      success: false,
      error: data.error.trim(),
      isTokenExpired: false,
    };
  }

  return {
    success: false,
    error: `Serverfehler (HTTP ${res.status}).`,
    isTokenExpired: false,
  };
}
