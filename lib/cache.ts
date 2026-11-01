/**
 * In-process server-side response cache with per-tenant keys and tag-based invalidation.
 * Designed for single-instance Render deployment with a clean interface that can be
 * backed by a distributed store (e.g. Redis) without call-site changes.
 */

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  tags: string[];
}

export interface CacheOptions {
  /** Time-to-live in milliseconds as a safety net (default: 60,000ms = 1 minute). */
  ttlMs?: number;
  /** Domain tags for bulk and relational invalidation. */
  tags?: string[];
}

export interface ServerCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: CacheOptions): Promise<void>;
  delete(key: string): Promise<void>;
  invalidateTags(tags: string | string[]): Promise<void>;
  invalidatePrefix(prefix: string): Promise<void>;
  clear(): Promise<void>;
  size(): Promise<number>;
}

const DEFAULT_TTL_MS = 60_000; // 60 seconds safety net
const MAX_CACHE_ENTRIES = 5_000;

class InMemoryCacheStore implements ServerCache {
  private store: Map<string, CacheEntry<unknown>>;
  private tagIndex: Map<string, Set<string>>;

  constructor() {
    this.store = new Map();
    this.tagIndex = new Map();
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.removeEntry(key, entry.tags);
      return null;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, options?: CacheOptions): Promise<void> {
    // If cache is at capacity, purge expired entries first
    if (this.store.size >= MAX_CACHE_ENTRIES) {
      this.purgeExpired();
      // If still full, drop oldest 10% entries
      if (this.store.size >= MAX_CACHE_ENTRIES) {
        const dropCount = Math.max(1, Math.floor(MAX_CACHE_ENTRIES * 0.1));
        const keysToDrop = Array.from(this.store.keys()).slice(0, dropCount);
        for (const k of keysToDrop) {
          const e = this.store.get(k);
          this.removeEntry(k, e?.tags || []);
        }
      }
    }

    // Clean up existing entry tags if key is being overwritten
    const existing = this.store.get(key);
    if (existing) {
      this.removeEntry(key, existing.tags);
    }

    const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
    const expiresAt = Date.now() + ttlMs;
    const tags = options?.tags || [];

    this.store.set(key, { value, expiresAt, tags });

    for (const tag of tags) {
      let keySet = this.tagIndex.get(tag);
      if (!keySet) {
        keySet = new Set();
        this.tagIndex.set(tag, keySet);
      }
      keySet.add(key);
    }
  }

  async delete(key: string): Promise<void> {
    const entry = this.store.get(key);
    if (entry) {
      this.removeEntry(key, entry.tags);
    }
  }

  async invalidateTags(tags: string | string[]): Promise<void> {
    const tagList = Array.isArray(tags) ? tags : [tags];
    const keysToDelete = new Set<string>();

    for (const tag of tagList) {
      const keys = this.tagIndex.get(tag);
      if (keys) {
        for (const k of keys) {
          keysToDelete.add(k);
        }
      }
    }

    for (const key of keysToDelete) {
      const entry = this.store.get(key);
      if (entry) {
        this.removeEntry(key, entry.tags);
      }
    }
  }

  async invalidatePrefix(prefix: string): Promise<void> {
    const keysToDelete: string[] = [];
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      const entry = this.store.get(key);
      if (entry) {
        this.removeEntry(key, entry.tags);
      }
    }
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.tagIndex.clear();
  }

  async size(): Promise<number> {
    return this.store.size;
  }

  private removeEntry(key: string, tags: string[]): void {
    this.store.delete(key);
    for (const tag of tags) {
      const set = this.tagIndex.get(tag);
      if (set) {
        set.delete(key);
        if (set.size === 0) {
          this.tagIndex.delete(tag);
        }
      }
    }
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.removeEntry(key, entry.tags);
      }
    }
  }
}

// Global cache instance across hot module reloads and requests
const globalForCache = globalThis as unknown as {
  __pruefliServerCache?: ServerCache;
  __gradeAiServerCache?: ServerCache;
};

export const serverCache: ServerCache =
  globalForCache.__pruefliServerCache ??
  globalForCache.__gradeAiServerCache ??
  new InMemoryCacheStore();

if (process.env.NODE_ENV !== 'production') {
  globalForCache.__pruefliServerCache = serverCache;
}

/**
 * Standardised tag names for relational cache invalidation.
 * All keys and tags are strictly scoped per teacher (tenant isolation).
 */
export const CacheTags = {
  teacher: (teacherId: string) => `teacher:${teacherId}`,
  classes: (teacherId: string) => `teacher:${teacherId}:classes`,
  class: (teacherId: string, classId: string) => `teacher:${teacherId}:class:${classId}`,
  exams: (teacherId: string) => `teacher:${teacherId}:exams`,
  exam: (teacherId: string, examId: string) => `teacher:${teacherId}:exam:${examId}`,
  students: (teacherId: string) => `teacher:${teacherId}:students`,
  student: (teacherId: string, studentId: string) => `teacher:${teacherId}:student:${studentId}`,
  submissions: (teacherId: string) => `teacher:${teacherId}:submissions`,
  submission: (teacherId: string, submissionId: string) =>
    `teacher:${teacherId}:submission:${submissionId}`,
  logs: (teacherId: string) => `teacher:${teacherId}:logs`,
};

/**
 * Invalidation on class mutation (create, update, delete).
 */
export async function invalidateClassCache(teacherId: string, classId?: string): Promise<void> {
  const tags = [
    CacheTags.classes(teacherId),
    CacheTags.exams(teacherId),
    CacheTags.submissions(teacherId),
  ];
  if (classId) {
    tags.push(CacheTags.class(teacherId, classId));
  }
  await serverCache.invalidateTags(tags);
}

/**
 * Invalidation on student mutation (create, update, transfer, delete).
 */
export async function invalidateStudentCache(
  teacherId: string,
  studentId?: string,
  classId?: string
): Promise<void> {
  const tags = [
    CacheTags.classes(teacherId),
    CacheTags.students(teacherId),
    CacheTags.submissions(teacherId),
    CacheTags.exams(teacherId),
  ];
  if (classId) {
    tags.push(CacheTags.class(teacherId, classId));
  }
  if (studentId) {
    tags.push(CacheTags.student(teacherId, studentId));
  }
  await serverCache.invalidateTags(tags);
}

/**
 * Invalidation on exam mutation (create, duplicate, update, delete).
 */
export async function invalidateExamCache(
  teacherId: string,
  examId?: string,
  classId?: string
): Promise<void> {
  const tags = [
    CacheTags.exams(teacherId),
    CacheTags.classes(teacherId),
    CacheTags.submissions(teacherId),
  ];
  if (examId) {
    tags.push(CacheTags.exam(teacherId, examId));
  }
  if (classId) {
    tags.push(CacheTags.class(teacherId, classId));
  }
  await serverCache.invalidateTags(tags);
}

/**
 * Invalidation on submission mutation (create, update, replace, reassign, delete, add-task).
 * Completely invalidates exam statistics, class aggregates, student trajectory, and submission lists.
 */
export async function invalidateSubmissionCache(
  teacherId: string,
  options?: {
    submissionId?: string | null;
    examId?: string | null;
    classId?: string | null;
    studentId?: string | null;
  }
): Promise<void> {
  const tags = [
    CacheTags.submissions(teacherId),
    CacheTags.classes(teacherId),
    CacheTags.exams(teacherId),
    CacheTags.students(teacherId),
  ];
  if (options?.submissionId) {
    tags.push(CacheTags.submission(teacherId, options.submissionId));
  }
  if (options?.examId) {
    tags.push(CacheTags.exam(teacherId, options.examId));
  }
  if (options?.classId) {
    tags.push(CacheTags.class(teacherId, options.classId));
  }
  if (options?.studentId) {
    tags.push(CacheTags.student(teacherId, options.studentId));
  }
  await serverCache.invalidateTags(tags);
}

/**
 * Invalidation on correction log updates.
 */
export async function invalidateLogsCache(teacherId: string): Promise<void> {
  await serverCache.invalidateTags(CacheTags.logs(teacherId));
}
