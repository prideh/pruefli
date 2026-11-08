import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import { PrismaClient, Prisma } from '@/lib/generated/prisma/client';

interface SqliteStatementSync {
  all(...params: (string | number | null)[]): Record<string, unknown>[];
  run(...params: (string | number | null)[]): { changes?: number | bigint };
}

interface DatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatementSync;
}

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as {
  DatabaseSync: new (location: string) => DatabaseSync;
};

/**
 * Issue #117 Regression Suite:
 * Verifies that the generated Prisma Client and all affected API routes (/api/classes,
 * /api/classes/[id], /api/exams, /api/exams/[id], /api/submissions, /api/submissions/[id])
 * operate against the pre-sweep physical database schema (migrations up to
 * 20261030213800_reconcile_schema) with existing records, without relying on
 * `prisma db push` of unapplied core-table columns (such as Exam.isGenerated or Class.archivedAt).
 */

const PRE_SWEEP_MIGRATIONS = [
  '20260523152144_init',
  '20261029103000_add_step_uncertainty',
  '20261029110000_add_pruefai_features',
  '20261030213800_reconcile_schema',
] as const;

const UNAPPLIED_SWEEP_CORE_COLUMNS: Record<string, string[]> = {
  Class: ['archivedAt'],
  Exam: ['isGenerated', 'isApproved', 'approvedAt', 'materialStorageKey'],
  StepCorrection: ['box2d', 'pageNumber'],
  ExamTask: ['sourceReference'],
};

/**
 * Parses the historical pre-sweep migration SQL files to extract the exact physical
 * columns per core table present before 20261108120000_consolidate_shadow_tables.
 */
function extractPreSweepPhysicalColumns(): Map<string, Set<string>> {
  const tableColumns = new Map<string, Set<string>>();

  for (const migDir of PRE_SWEEP_MIGRATIONS) {
    const sqlPath = path.join(process.cwd(), 'prisma/migrations', migDir, 'migration.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');

    // Parse CREATE TABLE "<Table>" ( ... );
    const createRegex = /CREATE\s+TABLE\s+"([^"]+)"\s*\(([\s\S]*?)\);/g;
    let match: RegExpExecArray | null;
    while ((match = createRegex.exec(sql)) !== null) {
      const tableName = match[1];
      const body = match[2];
      const cols = tableColumns.get(tableName) ?? new Set<string>();
      for (const rawLine of body.split('\n')) {
        const line = rawLine.trim();
        if (
          !line ||
          line.startsWith('CONSTRAINT') ||
          line.startsWith('PRIMARY') ||
          line.startsWith('FOREIGN')
        ) {
          continue;
        }
        const colMatch = /^"([^"]+)"\s+/.exec(line);
        if (colMatch) {
          cols.add(colMatch[1]);
        }
      }
      tableColumns.set(tableName, cols);
    }

    // Parse ALTER TABLE "<Table>" ... ADD COLUMN [IF NOT EXISTS] "<col>" ...
    const alterBlocks = sql.split(';');
    for (const block of alterBlocks) {
      const tableMatch = /ALTER\s+TABLE\s+"([^"]+)"/i.exec(block);
      if (!tableMatch) continue;
      const tableName = tableMatch[1];
      const cols = tableColumns.get(tableName);
      if (!cols) continue;

      const addColRegex = /ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+"([^"]+)"/gi;
      let addMatch: RegExpExecArray | null;
      while ((addMatch = addColRegex.exec(block)) !== null) {
        cols.add(addMatch[1]);
      }

      const dropColRegex = /DROP\s+COLUMN(?:\s+IF\s+EXISTS)?\s+"([^"]+)"/gi;
      let dropMatch: RegExpExecArray | null;
      while ((dropMatch = dropColRegex.exec(block)) !== null) {
        cols.delete(dropMatch[1]);
      }
    }
  }

  return tableColumns;
}

/**
 * Builds an in-memory SQLite database whose core tables have the exact physical columns
 * extracted from the 4 pre-sweep migrations (20260523152144_init .. 20261030213800_reconcile_schema).
 */
function createPreSweepPhysicalDatabase(): {
  sqlite: DatabaseSync;
  physicalColumns: Map<string, Set<string>>;
} {
  const physicalColumns = extractPreSweepPhysicalColumns();
  const sqlite = new DatabaseSync(':memory:');

  for (const [tableName, cols] of physicalColumns.entries()) {
    const colDefs = Array.from(cols).map((col) => {
      if (col === 'id') return `"id" TEXT PRIMARY KEY`;
      if (col === 'orderIndex' || col === 'schrittIndex' || col === 'durationMs')
        return `"${col}" INTEGER DEFAULT 0`;
      if (
        col === 'maxPoints' ||
        col === 'earnedPoints' ||
        col === 'gradeRaw' ||
        col === 'erzieltePunkte' ||
        col === 'maximalPunkte' ||
        col === 'erreichtePunkte'
      ) {
        return `"${col}" REAL DEFAULT 0`;
      }
      if (col.startsWith('is') || col.startsWith('ist')) return `"${col}" INTEGER DEFAULT 0`;
      if (col === 'strengths' || col === 'weaknesses') return `"${col}" TEXT DEFAULT '[]'`;
      return `"${col}" TEXT`;
    });
    sqlite.exec(`CREATE TABLE "${tableName}" (${colDefs.join(', ')});`);
  }

  return { sqlite, physicalColumns };
}

function inferPrismaColumnType(val: unknown, colName: string): number {
  // @prisma/driver-adapter-utils ColumnTypeEnum values:
  // Int32=0, Int64=1, Float=2, Double=3, Boolean=5, Text=7, DateTime=10, TextArray=71
  if (colName === 'createdAt' || colName === 'updatedAt') return 10;
  if (colName === 'strengths' || colName === 'weaknesses') return 71;
  if (colName.startsWith('is') || colName.startsWith('ist')) return 5;
  if (colName === 'orderIndex' || colName === 'schrittIndex' || colName === 'durationMs') return 0;
  if (
    colName === 'maxPoints' ||
    colName === 'earnedPoints' ||
    colName === 'gradeRaw' ||
    colName === 'erzieltePunkte' ||
    colName === 'maximalPunkte' ||
    colName === 'erreichtePunkte'
  ) {
    return 3;
  }
  if (typeof val === 'number') {
    return Number.isInteger(val) ? 1 : 3;
  }
  return 7;
}

/**
 * Creates a real PrismaClient instance backed by the pre-sweep physical SQLite schema.
 * Any reference to a column not present in the pre-sweep migrations immediately throws
 * a Prisma P2022-equivalent error (`The column <Table>.<column> does not exist in the current database`).
 */
function createPreSweepPrismaClient(
  sqlite: DatabaseSync,
  physicalColumns: Map<string, Set<string>>
): { prisma: PrismaClient; executedQueries: string[] } {
  const executedQueries: string[] = [];

  const verifySqlAgainstPreSweepSchema = (sql: string) => {
    const colRefRegex = /"public"\."([^"]+)"\."([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = colRefRegex.exec(sql)) !== null) {
      const [, table, column] = m;
      const allowed = physicalColumns.get(table);
      if (allowed && !allowed.has(column)) {
        const err = new Error(
          `PrismaClientKnownRequestError P2022: The column ${table}.${column} does not exist in the current database.`
        ) as Error & { code?: string };
        err.code = 'P2022';
        throw err;
      }
    }
  };

  const runQueryRaw = async (q: { sql: string; args: unknown[] }) => {
    executedQueries.push(q.sql);
    verifySqlAgainstPreSweepSchema(q.sql);

    let sqliteSql = q.sql.replace(/"public"\./g, '');
    const params: (string | number | null)[] = [];
    sqliteSql = sqliteSql.replace(/\$(\d+)/g, (_, idx) => {
      const raw = q.args[Number(idx) - 1];
      if (raw === undefined || raw === null) {
        params.push(null);
      } else if (typeof raw === 'boolean') {
        params.push(raw ? 1 : 0);
      } else if (raw instanceof Date) {
        params.push(raw.toISOString());
      } else if (Array.isArray(raw)) {
        params.push(JSON.stringify(raw));
      } else {
        params.push(raw as string | number);
      }
      return '?';
    });
    sqliteSql = sqliteSql.replace(/(?<!LIMIT\s+\S+\s+)OFFSET\s+\?/gi, 'LIMIT -1 OFFSET ?');
    sqliteSql = sqliteSql.replace(/::text/gi, '');
    sqliteSql = sqliteSql.replace(/CAST\(\?\s+AS\s+(?:"[^"]+"\.)?"[^"]+"\)/gi, '?');

    const stmt = sqlite.prepare(sqliteSql);
    const rowsObj = stmt.all(...params) as Record<string, unknown>[];
    if (rowsObj.length === 0) {
      return { columnNames: [], columnTypes: [], rows: [] };
    }
    const columnNames = Object.keys(rowsObj[0]);
    const columnTypes = columnNames.map((c) => inferPrismaColumnType(rowsObj[0][c], c));
    const rows = rowsObj.map((r) =>
      columnNames.map((c) => {
        const val = r[c];
        if ((c.startsWith('is') || c.startsWith('ist')) && typeof val === 'number') {
          return val === 1;
        }
        if ((c === 'strengths' || c === 'weaknesses') && typeof val === 'string') {
          try {
            return JSON.parse(val);
          } catch {
            return [];
          }
        }
        return val;
      })
    );
    return { columnNames, columnTypes, rows };
  };

  const runExecuteRaw = async (q: { sql: string; args: unknown[] }) => {
    executedQueries.push(q.sql);
    verifySqlAgainstPreSweepSchema(q.sql);

    let sqliteSql = q.sql.replace(/"public"\./g, '');
    const params: (string | number | null)[] = [];
    sqliteSql = sqliteSql.replace(/\$(\d+)/g, (_, idx) => {
      const raw = q.args[Number(idx) - 1];
      if (raw === undefined || raw === null) {
        params.push(null);
      } else if (typeof raw === 'boolean') {
        params.push(raw ? 1 : 0);
      } else if (raw instanceof Date) {
        params.push(raw.toISOString());
      } else if (Array.isArray(raw)) {
        params.push(JSON.stringify(raw));
      } else {
        params.push(raw as string | number);
      }
      return '?';
    });
    const stmt = sqlite.prepare(sqliteSql);
    const res = stmt.run(...params);
    return Number(res.changes ?? 0);
  };

  const connection = {
    provider: 'postgres' as const,
    adapterName: '@prisma/adapter-pg',
    queryRaw: runQueryRaw,
    executeRaw: runExecuteRaw,
    async executeScript() {},
    async startTransaction() {
      return {
        provider: 'postgres' as const,
        adapterName: '@prisma/adapter-pg',
        options: { usePhantomQuery: true },
        queryRaw: runQueryRaw,
        executeRaw: runExecuteRaw,
        async commit() {},
        async rollback() {},
      };
    },
    getConnectionInfo() {
      return { schemaName: 'public', supportsRelationJoins: false };
    },
    async dispose() {},
  };

  const adapterFactory = {
    provider: 'postgres' as const,
    adapterName: '@prisma/adapter-pg',
    async connect() {
      return connection;
    },
  };

  const prisma = new PrismaClient({ adapter: adapterFactory as never });
  return { prisma, executedQueries };
}

function seedExistingPreSweepRecords(sqlite: DatabaseSync) {
  const iso = '2026-10-15T08:30:00.000Z';
  sqlite.exec(`
    INSERT INTO "Teacher" ("id", "email", "passwordHash", "name", "createdAt", "updatedAt")
    VALUES ('teacher-existing-1', 'lehrer@schule.ch', 'scrypt:salt:hash', 'Prof. Hans Muster', '${iso}', '${iso}');

    INSERT INTO "Class" ("id", "name", "teacherId", "createdAt", "updatedAt")
    VALUES ('class-existing-1', 'Klasse 9b', 'teacher-existing-1', '${iso}', '${iso}');

    INSERT INTO "Student" ("id", "name", "classId", "createdAt", "updatedAt")
    VALUES ('student-existing-1', 'Anna Muster', 'class-existing-1', '${iso}', '${iso}');

    INSERT INTO "Exam" (
      "id", "title", "subject", "rubricText", "examTemplateText", "gradingNotes",
      "gradingFormula", "gradeRounding", "maxPoints", "classId", "createdAt", "updatedAt"
    )
    VALUES (
      'exam-existing-1',
      'Mathematik Klassenarbeit 1',
      'Mathematik',
      'Aufgabe 1: 2x = 8 => x = 4 (10 Punkte)',
      NULL,
      '<!-- GRADEAI_EXAM_META:{"isGenerated":true,"isApproved":true,"approvedAt":"2026-10-15T09:00:00.000Z","taskSources":{"1":"Kapitel 2, Seite 14"}} --> Halbpunkte erlaubt',
      'LINEAR_60',
      '0.1',
      10.0,
      'class-existing-1',
      '${iso}',
      '${iso}'
    );

    INSERT INTO "ExamTask" ("id", "examId", "taskId", "title", "maxPoints", "orderIndex", "createdAt", "updatedAt")
    VALUES ('task-existing-1', 'exam-existing-1', '1', 'Aufgabe 1: Gleichungen', 10.0, 0, '${iso}', '${iso}');

    INSERT INTO "Submission" (
      "id", "examId", "studentId", "targetStudentId", "extractedStudentName", "suggestedStudentId",
      "isStudentMatchUncertain", "isExamMatchUncertain", "status",
      "earnedPoints", "gradeRaw", "gradeRounded", "strengths", "weaknesses",
      "helpfulTip", "exerciseRecommendation", "errorMessage", "studentExamUrl", "createdAt", "updatedAt"
    )
    VALUES (
      'sub-existing-1',
      'exam-existing-1',
      'student-existing-1',
      'student-existing-1',
      'Anna Muster',
      NULL,
      0,
      0,
      'COMPLETED',
      9.0,
      5.5,
      '5.5',
      '["Saubere Umformung"]',
      '["Keine"]',
      'Weiter so!',
      'Kapitel 3',
      NULL,
      '/uploads/scan-1.pdf',
      '${iso}',
      '${iso}'
    );

    INSERT INTO "TaskCorrection" (
      "id", "submissionId", "taskId", "title", "studentAnswer",
      "erzieltePunkte", "maximalPunkte", "status", "lehrerKommentar", "orderIndex", "createdAt", "updatedAt"
    )
    VALUES (
      'tc-existing-1',
      'sub-existing-1',
      '1',
      'Aufgabe 1: Gleichungen',
      '2x = 8 => x = 4',
      9.0,
      10.0,
      'Korrekt',
      'Sehr gut gelöst',
      0,
      '${iso}',
      '${iso}'
    );

    INSERT INTO "StepCorrection" (
      "id", "taskCorrectionId", "schrittIndex", "schrittText", "istKorrekt",
      "fehlerTyp", "erreichtePunkte", "maximalPunkte", "begruendung",
      "istUnsicher", "unsicherheitsGrund", "createdAt", "updatedAt"
    )
    VALUES (
      'sc-existing-1',
      'tc-existing-1',
      0,
      'x = 4',
      1,
      'KeinFehler',
      9.0,
      10.0,
      'Korrekte Division durch 2',
      1,
      'Handschrift bei Ziffer 4 leicht verwischt',
      '${iso}',
      '${iso}'
    );

    INSERT INTO "CorrectionLog" (
      "id", "createdAt", "submissionId", "teacherId", "className", "examTitle",
      "studentName", "modelUsed", "durationMs", "status", "actionType", "errorMessage"
    )
    VALUES (
      'log-existing-1',
      '${iso}',
      'sub-existing-1',
      'teacher-existing-1',
      'Klasse 9b',
      'Mathematik Klassenarbeit 1',
      'Anna Muster',
      'gemini-3.8-flash',
      1420,
      'COMPLETED',
      'ERSTELLT',
      NULL
    );
  `);
}

// Mock session and email verification so real route handlers execute against our pre-sweep PrismaClient
const activeDbRef: { current: PrismaClient | null } = { current: null };

vi.mock('@/lib/db', () => ({
  get db() {
    return activeDbRef.current;
  },
}));

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(async () => ({
    userId: 'teacher-existing-1',
    email: 'lehrer@schule.ch',
    name: 'Prof. Hans Muster',
  })),
}));

vi.mock('@/lib/email-verification', () => ({
  requireVerifiedEmailForApi: vi.fn(async () => null),
  isEmailVerified: vi.fn(async () => true),
}));

describe('Issue #117 Regression: Pre-Sweep Physical Schema Compatibility (P2022 Prevention)', () => {
  it('stellt sicher, dass alle generierten Core-Model ScalarFieldEnums exakt dem Pre-Sweep-Migrationsstand (20261030213800_reconcile_schema) entsprechen', () => {
    const physicalColumns = extractPreSweepPhysicalColumns();

    const modelEnumMap: Record<string, Record<string, string>> = {
      Teacher: Prisma.TeacherScalarFieldEnum,
      Class: Prisma.ClassScalarFieldEnum,
      Student: Prisma.StudentScalarFieldEnum,
      Exam: Prisma.ExamScalarFieldEnum,
      ExamTask: Prisma.ExamTaskScalarFieldEnum,
      Submission: Prisma.SubmissionScalarFieldEnum,
      TaskCorrection: Prisma.TaskCorrectionScalarFieldEnum,
      StepCorrection: Prisma.StepCorrectionScalarFieldEnum,
      CorrectionLog: Prisma.CorrectionLogScalarFieldEnum,
    };

    for (const [modelName, scalarEnum] of Object.entries(modelEnumMap)) {
      const physicalSet = physicalColumns.get(modelName);
      expect(physicalSet, `Missing pre-sweep table ${modelName}`).toBeDefined();
      const generatedFields = Object.values(scalarEnum).sort();
      const expectedPhysicalFields = Array.from(physicalSet!).sort();
      expect(generatedFields).toEqual(expectedPhysicalFields);
    }

    // Explicitly assert none of the 8 unapplied sweep columns exist in the generated client
    for (const [modelName, forbiddenCols] of Object.entries(UNAPPLIED_SWEEP_CORE_COLUMNS)) {
      const generatedFields = Object.values(modelEnumMap[modelName]);
      for (const col of forbiddenCols) {
        expect(generatedFields).not.toContain(col);
      }
    }
  });

  it('beweist, dass der Pre-Sweep-Adapter P2022 wirft, falls eine Abfrage unmigrierte Spalten wie Exam.isGenerated oder Class.archivedAt anfordert', async () => {
    const { sqlite, physicalColumns } = createPreSweepPhysicalDatabase();
    const { prisma } = createPreSweepPrismaClient(sqlite, physicalColumns);

    await expect(
      prisma.$queryRawUnsafe('SELECT "public"."Exam"."isGenerated" FROM "public"."Exam"')
    ).rejects.toThrow(/P2022|Exam\.isGenerated does not exist/);

    await expect(
      prisma.$queryRawUnsafe('SELECT "public"."Class"."archivedAt" FROM "public"."Class"')
    ).rejects.toThrow(/P2022|Class\.archivedAt does not exist/);
  });

  describe('Reale API-Routen und Prisma-Abfragen gegen Pre-Sweep-Datenbank mit Bestandsdaten', () => {
    let sqlite: DatabaseSync;
    let executedQueries: string[];

    beforeEach(async () => {
      const { serverCache } = await import('@/lib/cache');
      await serverCache.clear();
      const built = createPreSweepPhysicalDatabase();
      sqlite = built.sqlite;
      seedExistingPreSweepRecords(sqlite);
      const clientBundle = createPreSweepPrismaClient(sqlite, built.physicalColumns);
      activeDbRef.current = clientBundle.prisma;
      executedQueries = clientBundle.executedQueries;
    });

    it('laedt bestehende Klassenliste (/api/classes GET) und bestehende Klassendetails (/api/classes/[id] GET) ohne P2022', async () => {
      const { GET: getClasses } = await import('@/app/api/classes/route');
      const { GET: getClassById } = await import('@/app/api/classes/[id]/route');

      const listRes = await getClasses(new Request('http://localhost/api/classes'));
      expect(listRes.status).toBe(200);
      const listJson = await listRes.json();
      expect(listJson.classes).toHaveLength(1);
      expect(listJson.classes[0].id).toBe('class-existing-1');
      expect(listJson.classes[0].name).toBe('Klasse 9b');
      expect(listJson.classes[0].averageGrade).toBe('5.50');

      const detailRes = await getClassById(
        new Request('http://localhost/api/classes/class-existing-1'),
        { params: Promise.resolve({ id: 'class-existing-1' }) }
      );
      expect(detailRes.status).toBe(200);
      const detailJson = await detailRes.json();
      expect(detailJson.class.id).toBe('class-existing-1');
      expect(detailJson.class.name).toBe('Klasse 9b');
      expect(detailJson.students).toHaveLength(1);
      expect(detailJson.students[0].name).toBe('Anna Muster');
      expect(detailJson.exams).toHaveLength(1);
      expect(detailJson.exams[0].title).toBe('Mathematik Klassenarbeit 1');
      expect(executedQueries.some((q) => q.includes('isGenerated'))).toBe(false);
      expect(executedQueries.some((q) => q.includes('archivedAt'))).toBe(false);
    });

    it('erstellt eine neue Klasse (/api/classes POST) und laedt deren Klassendetails (/api/classes/[id] GET) ohne P2022', async () => {
      const { POST: createClass } = await import('@/app/api/classes/route');
      const { GET: getClassById } = await import('@/app/api/classes/[id]/route');

      const createReq = new Request('http://localhost/api/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Klasse 10a' }),
      });
      const createRes = await createClass(createReq);
      expect(createRes.status).toBe(200);
      const createJson = await createRes.json();
      expect(createJson.success).toBe(true);
      const newClassId = createJson.class.id;
      expect(newClassId).toBeTruthy();

      const detailRes = await getClassById(
        new Request(`http://localhost/api/classes/${newClassId}`),
        { params: Promise.resolve({ id: newClassId }) }
      );
      expect(detailRes.status).toBe(200);
      const detailJson = await detailRes.json();
      expect(detailJson.class.id).toBe(newClassId);
      expect(detailJson.class.name).toBe('Klasse 10a');
      expect(detailJson.students).toEqual([]);
      expect(detailJson.exams).toEqual([]);
    });

    it('laedt Pruefungsliste (/api/exams GET) und Pruefungsdetails (/api/exams/[id] GET) inkl. eingebetteter Metadaten ohne P2022', async () => {
      const { GET: getExams } = await import('@/app/api/exams/route');
      const { GET: getExamById } = await import('@/app/api/exams/[id]/route');

      const listRes = await getExams(new Request('http://localhost/api/exams'));
      expect(listRes.status).toBe(200);
      const listJson = await listRes.json();
      expect(listJson.exams).toHaveLength(1);
      expect(listJson.exams[0].id).toBe('exam-existing-1');
      expect(listJson.exams[0].isGenerated).toBe(true);
      expect(listJson.exams[0].isApproved).toBe(true);
      expect(listJson.exams[0].gradingNotes).toBe('Halbpunkte erlaubt');

      const detailRes = await getExamById(
        new Request('http://localhost/api/exams/exam-existing-1'),
        { params: Promise.resolve({ id: 'exam-existing-1' }) }
      );
      expect(detailRes.status).toBe(200);
      const detailJson = await detailRes.json();
      expect(detailJson.exam.id).toBe('exam-existing-1');
      expect(detailJson.exam.isGenerated).toBe(true);
      expect(detailJson.exam.isApproved).toBe(true);
      expect(detailJson.exam.tasks).toHaveLength(1);
      expect(detailJson.exam.tasks[0].sourceReference).toBe('Kapitel 2, Seite 14');
      expect(executedQueries.some((q) => q.includes('isGenerated'))).toBe(false);
      expect(executedQueries.some((q) => q.includes('sourceReference'))).toBe(false);
      expect(executedQueries.some((q) => q.includes('box2d'))).toBe(false);
    });

    it('laedt Korrekturen-Liste (/api/submissions GET) und Korrektur-Details (/api/submissions/[id] GET) ohne P2022', async () => {
      const { GET: getSubmissions } = await import('@/app/api/submissions/route');
      const { GET: getSubmissionById } = await import('@/app/api/submissions/[id]/route');

      const listRes = await getSubmissions(new Request('http://localhost/api/submissions'));
      expect(listRes.status).toBe(200);
      const listJson = await listRes.json();
      expect(listJson.submissions).toHaveLength(1);
      expect(listJson.submissions[0].id).toBe('sub-existing-1');
      expect(listJson.submissions[0].studentName).toBe('Anna Muster');
      expect(listJson.submissions[0].uncertainStepsCount).toBe(1);

      const detailRes = await getSubmissionById(
        new Request('http://localhost/api/submissions/sub-existing-1'),
        { params: Promise.resolve({ id: 'sub-existing-1' }) }
      );
      expect(detailRes.status).toBe(200);
      const detailJson = await detailRes.json();
      expect(detailJson.id).toBe('sub-existing-1');
      expect(detailJson.schuelerName).toBe('Anna Muster');
      expect(detailJson.siblingSubmissions).toHaveLength(1);
      expect(detailJson.aufgaben).toHaveLength(1);
      expect(detailJson.aufgaben[0].schritte).toHaveLength(1);
      expect(executedQueries.some((q) => q.includes('isGenerated'))).toBe(false);
      expect(executedQueries.some((q) => q.includes('box2d'))).toBe(false);
      expect(executedQueries.some((q) => q.includes('pageNumber'))).toBe(false);
    });
  });
});
