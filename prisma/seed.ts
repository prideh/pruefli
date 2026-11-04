/* eslint-disable no-console */
import { PrismaClient } from '../lib/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import crypto from 'crypto';

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/grade_ai?schema=public';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Native scrypt hashing identical to lib/auth.ts
function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

async function main() {
  console.log('🌱 Start seeding simplified high-fidelity database...');

  // 1. Create Default Teacher
  const email = 'lehrer@schule.ch';
  const name = 'Frau Meier';
  const passwordHash = await hashPassword('password123');

  const teacher = await prisma.teacher.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name,
      passwordHash,
    },
  });

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS teacher_email_verifications (
      teacher_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      verified_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await prisma.$executeRawUnsafe(
    `INSERT INTO teacher_email_verifications (teacher_id, email, verified_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (teacher_id) DO UPDATE SET email = EXCLUDED.email, verified_at = NOW();`,
    teacher.id,
    email
  );

  console.log(`👤 Default teacher: ${teacher.name} (${teacher.email})`);

  // Clean existing classes for this teacher to prevent primary key / unique constraint failures on re-run
  const existingClasses = await prisma.class.findMany({
    where: { teacherId: teacher.id },
  });

  for (const c of existingClasses) {
    await prisma.class.delete({ where: { id: c.id } });
  }
  console.log('🧹 Cleaned existing class data for seed freshness.');

  // 2. Create Single Class
  const schoolClass = await prisma.class.create({
    data: {
      name: 'Klasse 9a',
      teacherId: teacher.id,
    },
  });
  console.log(`🏫 Class created: ${schoolClass.name}`);

  // 3. Enroll exactly 2 Students
  const studentNames = ['Max Mustermann', 'Sarah Tobler'];
  const enrolledStudents: { id: string; name: string }[] = [];

  for (const name of studentNames) {
    const student = await prisma.student.create({
      data: {
        name,
        classId: schoolClass.id,
      },
    });
    enrolledStudents.push(student);
    console.log(`🎓 Student enrolled: ${student.name} in ${schoolClass.name}`);
  }

  // 4. Create 2 Exams
  // Exam 1: Klasse 9a Math 1
  const exam1 = await prisma.exam.create({
    data: {
      title: 'Mathematik Klassenarbeit 1: Lineare Gleichungen',
      subject: 'Mathematik',
      rubricText:
        'Aufgabe 1: 3x - 5 = 10 -> x = 5. (5 Punkte)\nAufgabe 2: 2(x+3) = 14 -> x = 4. (5 Punkte)\nAufgabe 3: Lineares System x+y=5, x-y=1 -> x=3, y=2. (10 Punkte)',
      maxPoints: 20,
      classId: schoolClass.id,
    },
  });

  // Exam 2: Klasse 9a Math 2
  await prisma.exam.create({
    data: {
      title: 'Mathematik Klassenarbeit 2: Quadratische Funktionen',
      subject: 'Mathematik',
      rubricText:
        'Aufgabe 1: x^2 - 4 = 0 -> x = ±2. (5 Punkte)\nAufgabe 2: Scheitelpunkt bestimmen f(x)=(x-3)^2 + 1 -> S(3,1). (10 Punkte)',
      maxPoints: 15,
      classId: schoolClass.id,
    },
  });

  console.log('📝 Exams created.');

  // 5. Seed 2 Completed Submissions for Exam 1 (for Speed-Grading & Uncertainty Review E2E tests)
  await prisma.submission.create({
    data: {
      examId: exam1.id,
      studentId: enrolledStudents[0].id,
      status: 'COMPLETED',
      earnedPoints: 15,
      gradeRaw: 4.75,
      gradeRounded: '4.8',
      strengths: ['Sichere Äquivalenzumformungen bei linearen Gleichungen'],
      weaknesses: ['Vorzeichenfehler beim Einsetzen in Gleichungssystemen'],
      helpfulTip: 'Prüfe deine Lösung immer durch Einsetzen in die Ausgangsgleichung.',
      exerciseRecommendation: 'Übungsblatt 3: Lineare Gleichungssysteme (Aufgaben 1–4).',
      tasks: {
        create: [
          {
            taskId: '1',
            title: 'Aufgabe 1: Lineare Gleichung',
            studentAnswer: '3x - 5 = 10 | +5\n3x = 15 | :3\nx = 5',
            erzieltePunkte: 5,
            maximalPunkte: 5,
            status: 'Korrekt',
            lehrerKommentar: 'Vorbildlicher Lösungsweg.',
            orderIndex: 0,
            schritte: {
              create: [
                {
                  schrittIndex: 0,
                  schrittText: '3x = 15 -> x = 5',
                  istKorrekt: true,
                  fehlerTyp: 'KeinFehler',
                  erreichtePunkte: 5,
                  maximalPunkte: 5,
                  begruendung: 'Äquivalenzumformung und Endergebnis komplett korrekt.',
                  istUnsicher: false,
                },
              ],
            },
          },
          {
            taskId: '2',
            title: 'Aufgabe 2: Klammergleichung',
            studentAnswer: '2(x+3) = 14\n2x + 6 = 14\n2x = 8 -> x = 4',
            erzieltePunkte: 10,
            maximalPunkte: 15,
            status: 'Folgefehler',
            lehrerKommentar: 'Zwischenschritt leicht unleserlich, Folgeschritt korrekt.',
            orderIndex: 1,
            schritte: {
              create: [
                {
                  schrittIndex: 0,
                  schrittText: '2x + 6 = 14 -> x = 4',
                  istKorrekt: false,
                  fehlerTyp: 'Folgefehler',
                  erreichtePunkte: 10,
                  maximalPunkte: 15,
                  begruendung: 'Handschrift bei Ziffer 6 schwer lesbar, Ergebnis stimmt.',
                  istUnsicher: true,
                  unsicherheitsGrund: 'Handschrift bei Zwischenschritt schwer entzifferbar',
                },
              ],
            },
          },
        ],
      },
    },
  });

  await prisma.submission.create({
    data: {
      examId: exam1.id,
      studentId: enrolledStudents[1].id,
      status: 'COMPLETED',
      earnedPoints: 18,
      gradeRaw: 5.5,
      gradeRounded: '5.5',
      strengths: ['Sehr strukturierte Darstellung aller Rechenschritte'],
      weaknesses: ['Kleiner Flüchtigkeitsfehler bei Aufgabe 3'],
      helpfulTip: 'Achte bei Textaufgaben auf die Antwortsätze.',
      exerciseRecommendation: 'Zusatzaufgaben Kapitel 4.',
      tasks: {
        create: [
          {
            taskId: '1',
            title: 'Aufgabe 1: Lineare Gleichung',
            studentAnswer: '3x = 15 -> x = 5',
            erzieltePunkte: 18,
            maximalPunkte: 20,
            status: 'Korrekt',
            lehrerKommentar: 'Sehr gut gelöst!',
            orderIndex: 0,
            schritte: {
              create: [
                {
                  schrittIndex: 0,
                  schrittText: '3x = 15 -> x = 5',
                  istKorrekt: true,
                  fehlerTyp: 'KeinFehler',
                  erreichtePunkte: 18,
                  maximalPunkte: 20,
                  begruendung: 'Fast volle Punktzahl erreicht.',
                  istUnsicher: false,
                },
              ],
            },
          },
        ],
      },
    },
  });

  console.log('✅ Submissions, task corrections, and step corrections successfully seeded.');
  console.log('🎉 Simplified Database Seeding finished successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
