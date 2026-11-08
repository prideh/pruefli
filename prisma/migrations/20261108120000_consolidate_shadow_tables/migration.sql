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
  "sid" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "revoke_reason" TEXT
);
CREATE INDEX IF NOT EXISTS "idx_teacher_sessions_user_id" ON "teacher_sessions"("user_id");

CREATE TABLE IF NOT EXISTS "teacher_session_revocations" (
  "user_id" TEXT PRIMARY KEY,
  "revoked_before_unix" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "teacher_email_verifications" (
  "teacher_id" TEXT PRIMARY KEY,
  "email_verified" BOOLEAN NOT NULL DEFAULT TRUE,
  "email_verified_at" TIMESTAMP(3),
  "verification_token_hash" TEXT,
  "verification_sent_at" TIMESTAMP(3),
  "verification_expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "idx_teacher_email_verifications_token_hash" ON "teacher_email_verifications"("verification_token_hash");

CREATE TABLE IF NOT EXISTS "teacher_federated_identities" (
  "id" TEXT PRIMARY KEY,
  "teacher_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_subject" TEXT NOT NULL,
  "provider_email" TEXT,
  "tenant_id" TEXT,
  "display_name" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_login_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("provider", "provider_subject")
);
CREATE INDEX IF NOT EXISTS "idx_teacher_federated_identities_teacher_id" ON "teacher_federated_identities"("teacher_id");

CREATE TABLE IF NOT EXISTS "class_archives" (
  "class_id" TEXT PRIMARY KEY,
  "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "teacher_subject_preferences" (
  "teacher_id" TEXT PRIMARY KEY,
  "subjects" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "class_subject_preferences" (
  "class_id" TEXT PRIMARY KEY,
  "subjects" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
