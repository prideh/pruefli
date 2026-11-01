'use client';

import { useSyncExternalStore, useCallback, useEffect } from 'react';

export interface CacheEntry<T = unknown> {
  data: T | undefined;
  timestamp: number;
  error: Error | null;
  loading: boolean;
  isValidating: boolean;
}

export type CacheListener = () => void;

// In-memory session cache - zero persistence to localStorage or sessionStorage
const dataStore = new Map<string, CacheEntry<unknown>>();
const inflightRequests = new Map<string, Promise<unknown>>();
const keyListeners = new Map<string, Set<CacheListener>>();

const emptyEntry: CacheEntry<unknown> = {
  data: undefined,
  timestamp: 0,
  error: null,
  loading: false,
  isValidating: false,
};

function getOrCreateEntry<T>(key: string, initialData?: T): CacheEntry<T> {
  let entry = dataStore.get(key) as CacheEntry<T> | undefined;
  if (!entry) {
    entry = {
      data: initialData,
      timestamp: initialData !== undefined ? Date.now() : 0,
      error: null,
      loading: initialData === undefined,
      isValidating: false,
    };
    dataStore.set(key, entry as CacheEntry<unknown>);
  }
  return entry;
}

export function getCachedData<T>(key: string): T | undefined {
  const entry = dataStore.get(key);
  if (!entry) return undefined;
  return entry.data as T;
}

export function setCachedData<T>(key: string, data: T): void {
  dataStore.set(key, {
    data,
    timestamp: Date.now(),
    error: null,
    loading: false,
    isValidating: false,
  });
  notifyListeners(key);
}

export function removeCachedData(key: string): void {
  dataStore.delete(key);
  inflightRequests.delete(key);
  notifyListeners(key);
}

export function clearDataCache(): void {
  dataStore.clear();
  inflightRequests.clear();
  keyListeners.forEach((listenerSet) => {
    listenerSet.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.error('Error in cache listener:', err);
      }
    });
  });
}

function notifyListeners(key: string): void {
  const listeners = keyListeners.get(key);
  if (listeners) {
    listeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.error('Error in cache listener:', err);
      }
    });
  }
}

export function subscribeToCacheKey(key: string, listener: CacheListener): () => void {
  let listeners = keyListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    keyListeners.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners && listeners.size === 0) {
      keyListeners.delete(key);
    }
  };
}

async function defaultFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Fehler beim Laden (${res.status})`);
  }
  return res.json();
}

export async function fetchWithCache<T>(
  key: string,
  fetcher?: (url: string) => Promise<T>
): Promise<T> {
  // Deduplicate concurrent in-flight requests
  const existingPromise = inflightRequests.get(key);
  if (existingPromise) {
    return existingPromise as Promise<T>;
  }

  const existingEntry = dataStore.get(key);
  dataStore.set(key, {
    data: existingEntry?.data as T | undefined,
    timestamp: existingEntry?.timestamp || 0,
    error: null,
    loading: existingEntry?.data === undefined,
    isValidating: true,
  });
  notifyListeners(key);

  const fn = fetcher || defaultFetcher;
  const promise = (async () => {
    try {
      const data = await fn(key);
      dataStore.set(key, {
        data,
        timestamp: Date.now(),
        error: null,
        loading: false,
        isValidating: false,
      });
      notifyListeners(key);
      return data;
    } catch (err) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      // Invalidate stale data on failure so errors are not masked
      dataStore.set(key, {
        data: undefined,
        timestamp: Date.now(),
        error: errorObj,
        loading: false,
        isValidating: false,
      });
      notifyListeners(key);
      throw errorObj;
    } finally {
      inflightRequests.delete(key);
    }
  })();

  inflightRequests.set(key, promise);
  return promise;
}

export async function mutateCache<T>(
  key: string,
  dataOrUpdater?: T | ((prev: T | undefined) => T),
  shouldRevalidate = true
): Promise<T | undefined> {
  if (dataOrUpdater !== undefined) {
    let nextData: T;
    if (typeof dataOrUpdater === 'function') {
      const prevData = getCachedData<T>(key);
      nextData = (dataOrUpdater as (prev: T | undefined) => T)(prevData);
    } else {
      nextData = dataOrUpdater;
    }
    setCachedData(key, nextData);
  }

  if (shouldRevalidate) {
    return fetchWithCache<T>(key);
  }

  return getCachedData<T>(key);
}

export function invalidateCache(pattern?: string | RegExp | ((key: string) => boolean)): void {
  if (!pattern) {
    clearDataCache();
    return;
  }

  const keysToInvalidate: string[] = [];
  for (const key of Array.from(dataStore.keys())) {
    let matches = false;
    if (typeof pattern === 'string') {
      matches = key === pattern || key.startsWith(pattern);
    } else if (pattern instanceof RegExp) {
      matches = pattern.test(key);
    } else if (typeof pattern === 'function') {
      matches = pattern(key);
    }
    if (matches) {
      keysToInvalidate.push(key);
    }
  }

  for (const key of Array.from(keyListeners.keys())) {
    if (!keysToInvalidate.includes(key)) {
      let matches = false;
      if (typeof pattern === 'string') {
        matches = key === pattern || key.startsWith(pattern);
      } else if (pattern instanceof RegExp) {
        matches = pattern.test(key);
      } else if (typeof pattern === 'function') {
        matches = pattern(key);
      }
      if (matches) {
        keysToInvalidate.push(key);
      }
    }
  }

  for (const key of keysToInvalidate) {
    removeCachedData(key);
  }
}

// Invalidation domain helpers for cross-page consistency
export function invalidateClasses(classId?: string | null): void {
  if (classId) {
    invalidateCache(`/api/classes/${classId}`);
  }
  invalidateCache('/api/classes');
}

export function invalidateExams(examId?: string | null, classId?: string | null): void {
  if (examId) {
    invalidateCache(`/api/exams/${examId}`);
  }
  invalidateCache('/api/exams');
  invalidateCache('/api/subjects');
  invalidateClasses(classId);
}

export function invalidateSubjects(): void {
  invalidateCache('/api/subjects');
}

export function invalidateSubmissions(
  submissionId?: string | null,
  examId?: string | null,
  classId?: string | null,
  studentId?: string | null
): void {
  if (submissionId) {
    invalidateCache(`/api/submissions/${submissionId}`);
  }
  invalidateCache('/api/submissions');
  if (examId) {
    invalidateCache(`/api/exams/${examId}`);
  }
  invalidateCache('/api/exams');
  if (classId) {
    invalidateClasses(classId);
  } else {
    invalidateCache('/api/classes');
  }
  if (studentId) {
    invalidateCache(`/api/students/${studentId}`);
  }
  invalidateCache('/api/students');
  invalidateCache('/api/logs');
}

export function invalidateStudents(studentId?: string | null, classId?: string | null): void {
  if (studentId) {
    invalidateCache(`/api/students/${studentId}`);
  }
  invalidateCache('/api/students');
  invalidateClasses(classId);
}

export function invalidateLogs(): void {
  invalidateCache('/api/logs');
}

export interface UseDataCacheOptions<T> {
  initialData?: T;
  revalidateOnMount?: boolean;
  enabled?: boolean;
  onSuccess?: (data: T) => void;
  onError?: (error: Error) => void;
}

export interface UseDataCacheResult<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  isValidating: boolean;
  mutate: (
    newData?: T | ((prev: T | undefined) => T),
    shouldRevalidate?: boolean
  ) => Promise<T | undefined>;
  revalidate: () => Promise<T | undefined>;
}

export function useDataCache<T>(
  key: string | null,
  fetcher?: (url: string) => Promise<T>,
  options?: UseDataCacheOptions<T>
): UseDataCacheResult<T> {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!key) return () => {};
      return subscribeToCacheKey(key, onStoreChange);
    },
    [key]
  );

  const getSnapshot = useCallback(() => {
    if (!key) return emptyEntry as CacheEntry<T>;
    return getOrCreateEntry<T>(key, options?.initialData);
  }, [key, options?.initialData]);

  const getServerSnapshot = useCallback(() => {
    return emptyEntry as CacheEntry<T>;
  }, []);

  const entry = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const revalidate = useCallback(async (): Promise<T | undefined> => {
    if (!key) return undefined;
    if (options?.enabled === false) return undefined;

    try {
      const result = await fetchWithCache<T>(key, fetcher);
      options?.onSuccess?.(result);
      return result;
    } catch (err: unknown) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      options?.onError?.(errorObj);
      return undefined;
    }
  }, [key, fetcher, options]);

  const mutate = useCallback(
    async (
      newData?: T | ((prev: T | undefined) => T),
      shouldRevalidate = true
    ): Promise<T | undefined> => {
      if (!key) return undefined;
      return mutateCache<T>(key, newData, shouldRevalidate);
    },
    [key]
  );

  useEffect(() => {
    if (!key || options?.enabled === false) {
      return;
    }

    if (options?.revalidateOnMount !== false) {
      revalidate().catch(() => {});
    }
  }, [key, options?.enabled, options?.revalidateOnMount, revalidate]);

  return {
    data: entry.data,
    error: entry.error ? entry.error.message : null,
    loading: entry.loading,
    isValidating: entry.isValidating,
    mutate,
    revalidate,
  };
}
