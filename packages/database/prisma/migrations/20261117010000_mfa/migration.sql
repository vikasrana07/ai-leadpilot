-- MFA (TOTP) credentials and single-use recovery codes. Created in one step; the table shapes follow schema.prisma.
CREATE TABLE "mfa_credentials" (
  "subject_type" TEXT NOT NULL,
  "subject_id" UUID NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "wrapped_key" TEXT NOT NULL,
  "key_id" TEXT NOT NULL,
  "confirmed_at" TIMESTAMPTZ(3),
  "last_used_step" BIGINT NOT NULL DEFAULT 0,
  "failed_attempts" INTEGER NOT NULL DEFAULT 0,
  "locked_until" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mfa_credentials_pkey" PRIMARY KEY ("subject_type", "subject_id"),
  CONSTRAINT "mfa_credentials_subject_type_check" CHECK ("subject_type" IN ('user', 'platform_admin'))
);
CREATE TABLE "mfa_recovery_codes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "subject_type" TEXT NOT NULL,
  "subject_id" UUID NOT NULL,
  "code_hash" TEXT NOT NULL,
  "used_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mfa_recovery_codes_subject_type_check" CHECK ("subject_type" IN ('user', 'platform_admin'))
);
CREATE UNIQUE INDEX "mfa_recovery_codes_subject_type_subject_id_code_hash_key" ON "mfa_recovery_codes"("subject_type", "subject_id", "code_hash");
GRANT SELECT, INSERT, UPDATE, DELETE ON "mfa_credentials", "mfa_recovery_codes" TO leadpilot_app;
