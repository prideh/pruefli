import { clearDataCache } from './dataCache';

export interface TeacherSession {
  id: string;
  name: string;
  email: string;
  isEmailVerified?: boolean;
  liveSendingEnabled?: boolean;
}

let cachedTeacher: TeacherSession | null = null;
let hasCheckedAuth = false;

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
