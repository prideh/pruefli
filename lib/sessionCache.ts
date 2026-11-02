import { clearDataCache } from './dataCache';

export interface SessionLifecycleMetadata {
  id: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  remainingSeconds: number | null;
  expiringSoon: boolean;
}

export interface TeacherSession {
  id: string;
  name: string;
  email: string;
  isEmailVerified?: boolean;
  liveSendingEnabled?: boolean;
  session?: SessionLifecycleMetadata | null;
}

let cachedTeacher: TeacherSession | null = null;
let hasCheckedAuth = false;
const inMemoryDraftFallback = new Map<string, string>();

export function getCachedTeacher(): TeacherSession | null {
  if (typeof window === 'undefined') return null;
  return cachedTeacher;
}

export function setCachedTeacher(teacher: TeacherSession | null) {
  if (typeof window === 'undefined') return;
  cachedTeacher = teacher;
  hasCheckedAuth = true;
}

export function getHasCheckedAuth(): boolean {
  if (typeof window === 'undefined') return false;
  return hasCheckedAuth;
}

export function clearSessionCache() {
  clearDataCache();
  if (typeof window === 'undefined') return;
  cachedTeacher = null;
  hasCheckedAuth = false;
}

/**
 * Validates that a candidate return URL is strictly a safe internal application path
 * and cannot be abused as an Open Redirect (rejects external URLs, protocol-relative URLs,
 * control characters, and auth loop routes).
 */
export function isSafeReturnUrl(url: string | null | undefined): url is string {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith('/')) return false;
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) return false;
  if (/[\r\n\t\0]/.test(trimmed)) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return false;

  const pathOnly = trimmed.split('?')[0].split('#')[0];
  if (pathOnly === '/login' || pathOnly === '/register') {
    return false;
  }

  return true;
}

/**
 * Resolves a candidate return URL to a guaranteed safe internal path,
 * defaulting to `/dashboard` when invalid or absent.
 */
export function resolveSafeReturnUrl(
  returnTo: string | null | undefined,
  fallback = '/dashboard'
): string {
  if (isSafeReturnUrl(returnTo)) {
    return returnTo.trim();
  }
  return fallback;
}

/**
 * Builds a `/login` redirect URL preserving a safe internal `returnTo` path
 * and optional expiry/revocation reason.
 */
export function buildLoginRedirectUrl(
  currentPath?: string | null,
  reason?: 'expired' | 'revoked' | string
): string {
  const params = new URLSearchParams();
  if (isSafeReturnUrl(currentPath) && currentPath.trim() !== '/dashboard') {
    params.set('returnTo', currentPath.trim());
  }
  if (reason) {
    params.set('reason', reason);
  }
  const query = params.toString();
  return query ? `/login?${query}` : '/login';
}

export interface CorrectionWorkspaceDraft<TTask = unknown, TFeedback = unknown> {
  submissionId: string;
  aufgaben: TTask;
  schuelerFeedback: TFeedback;
  savedAt: string;
}

const CORRECTION_DRAFT_PREFIX = 'pruefli_correction_draft_';

/**
 * Saves unsaved Correction Workspace changes locally before re-authentication
 * so a session expiry during grading never causes silent data loss.
 */
export function saveCorrectionDraft<TTask = unknown, TFeedback = unknown>(
  submissionId: string,
  draft: { aufgaben: TTask; schuelerFeedback: TFeedback; savedAt?: string }
): boolean {
  if (!submissionId) return false;
  const key = `${CORRECTION_DRAFT_PREFIX}${submissionId}`;
  const payload: CorrectionWorkspaceDraft<TTask, TFeedback> = {
    submissionId,
    aufgaben: draft.aufgaben,
    schuelerFeedback: draft.schuelerFeedback,
    savedAt: draft.savedAt || new Date().toISOString(),
  };
  const serialized = JSON.stringify(payload);
  inMemoryDraftFallback.set(key, serialized);

  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.setItem(key, serialized);
    } catch {
      // In-memory fallback remains active if storage quota is exceeded
    }
  }
  return true;
}

/**
 * Loads a previously backed-up Correction Workspace draft for the given submission ID.
 */
export function loadCorrectionDraft<TTask = unknown, TFeedback = unknown>(
  submissionId: string
): CorrectionWorkspaceDraft<TTask, TFeedback> | null {
  if (!submissionId) return null;
  const key = `${CORRECTION_DRAFT_PREFIX}${submissionId}`;
  let raw: string | null = null;

  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      raw = window.sessionStorage.getItem(key);
    } catch {
      raw = null;
    }
  }
  if (!raw) {
    raw = inMemoryDraftFallback.get(key) ?? null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as CorrectionWorkspaceDraft<TTask, TFeedback>;
    if (!parsed || parsed.submissionId !== submissionId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Clears any local Correction Workspace draft once changes have been saved to PostgreSQL.
 */
export function clearCorrectionDraft(submissionId?: string): void {
  if (!submissionId) {
    inMemoryDraftFallback.clear();
    return;
  }
  const key = `${CORRECTION_DRAFT_PREFIX}${submissionId}`;
  inMemoryDraftFallback.delete(key);
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // Ignore storage access errors
    }
  }
}
