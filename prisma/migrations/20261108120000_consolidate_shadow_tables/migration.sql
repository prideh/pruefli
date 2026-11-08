-- Consolidate runtime shadow tables and add structured columns to Class, Exam, ExamTask, and StepCorrection
ALTER TABLE "Class" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);

ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "isGenerated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "isApproved" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "Exam" ADD COLUMN IF NOT EXISTS "materialStorageKey" TEXT;

ALTER TABLE "StepCorrection" ADD COLUMN IF NOT EXISTS "box2d" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "StepCorrection" ADD COLUMN IF NOT EXISTS "pageNumber" INTEGER;

ALTER TABLE "ExamTask" ADD COLUMN IF NOT EXISTS "sourceReference" TEXT;

CREATE TABLE IF NOT EXISTS "teacher_sessions" (
  "id" TEXT PRIMARY KEY,
  "teacher_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_renewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMP(3),
  "user_agent" TEXT,
  "token_version" INTEGER NOT NULL DEFAULT 1,
  "is_legacy_converted" BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS "idx_teacher_sessions_teacher_id" ON "teacher_sessions"("teacher_id");

CREATE TABLE IF NOT EXISTS "teacher_session_revocations" (
  "teacher_id" TEXT PRIMARY KEY,
  "revoked_before" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "teacher_email_verifications" (
  "teacher_id" TEXT PRIMARY KEY,
  "email" TEXT NOT NULL,
  "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "teacher_federated_identities" (
  "id" TEXT PRIMARY KEY,
  "teacher_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_account_id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("provider", "provider_account_id")
);
CREATE INDEX IF NOT EXISTS "idx_teacher_federated_identities_teacher_id" ON "teacher_federated_identities"("teacher_id");

CREATE TABLE IF NOT EXISTS "class_archives" (
  "class_id" TEXT PRIMARY KEY,
  "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "teacher_subject_preferences" (
  "teacher_id" TEXT PRIMARY KEY,
  "subjects_json" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "class_subject_preferences" (
  "class_id" TEXT PRIMARY KEY,
  "subjects_json" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "relay_documents" (
  "session_id" TEXT PRIMARY KEY,
  "id" TEXT NOT NULL,
  "teacher_id" TEXT NOT NULL,
  "target_mode" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "page_count" INTEGER NOT NULL DEFAULT 1,
  "created_at" BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_relay_documents_teacher_id" ON "relay_documents"("teacher_id");
