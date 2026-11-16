-- pgvector is created by the cluster init script on real databases; this makes fresh and shadow databases work too
-- (creating it needs a role allowed to: the shadow DB connection uses the superuser, see .env.example).
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ScoreSource" AS ENUM ('RULES', 'MANUAL');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "score_overridden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "site_visit_requested" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ai_assistants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL DEFAULT 'Assistant',
    "business_identity" TEXT NOT NULL DEFAULT '',
    "business_description" TEXT NOT NULL DEFAULT '',
    "languages" TEXT[] DEFAULT ARRAY['en']::TEXT[],
    "tone" TEXT NOT NULL DEFAULT 'friendly',
    "welcome_message" TEXT NOT NULL DEFAULT '',
    "system_instructions" TEXT NOT NULL DEFAULT '',
    "working_hours" JSONB NOT NULL DEFAULT '{}',
    "handover_rules" JSONB NOT NULL DEFAULT '{}',
    "allowed_tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "model" TEXT,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "max_reply_chars" INTEGER NOT NULL DEFAULT 600,
    "fallback_message" TEXT NOT NULL DEFAULT 'Thanks for your message. A member of our team will get back to you shortly.',
    "disclosure_text" TEXT NOT NULL DEFAULT '',
    "monthly_token_cap" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_assistants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "trigger_message_id" UUID,
    "status" "AiRunStatus" NOT NULL DEFAULT 'RUNNING',
    "model" TEXT,
    "prompt_version" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER,
    "error" TEXT,
    "trace" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_tool_executions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "tool" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_tool_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT,
    "uploaded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "embedding_model" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoring_rule_sets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "rules" JSONB NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scoring_rule_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_scores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "temperature" TEXT NOT NULL,
    "breakdown" JSONB NOT NULL,
    "rule_version" INTEGER NOT NULL,
    "source" "ScoreSource" NOT NULL,
    "reason" TEXT,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_assistants_tenant_id_key" ON "ai_assistants"("tenant_id");

-- CreateIndex
CREATE INDEX "ai_runs_tenant_id_created_at_idx" ON "ai_runs"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_runs_tenant_id_conversation_id_created_at_idx" ON "ai_runs"("tenant_id", "conversation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ai_tool_executions_tenant_id_run_id_idx" ON "ai_tool_executions"("tenant_id", "run_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_tool_executions_tenant_id_idempotency_key_key" ON "ai_tool_executions"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "knowledge_documents_tenant_id_status_idx" ON "knowledge_documents"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "knowledge_chunks_tenant_id_document_id_idx" ON "knowledge_chunks"("tenant_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "scoring_rule_sets_tenant_id_version_key" ON "scoring_rule_sets"("tenant_id", "version");

-- CreateIndex
CREATE INDEX "lead_scores_tenant_id_lead_id_created_at_idx" ON "lead_scores"("tenant_id", "lead_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
