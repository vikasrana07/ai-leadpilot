-- CreateEnum
CREATE TYPE "StageKind" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "Temperature" AS ENUM ('HOT', 'WARM', 'COLD', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "BuyingTimeline" AS ENUM ('UNKNOWN', 'IMMEDIATE', 'WITHIN_30_DAYS', 'ONE_TO_THREE_MONTHS', 'THREE_TO_SIX_MONTHS', 'SIX_PLUS_MONTHS');

-- CreateEnum
CREATE TYPE "PropertyStatus" AS ENUM ('AVAILABLE', 'HELD', 'SOLD');

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "StageKind" NOT NULL DEFAULT 'OPEN',
    "qualifies" BOOLEAN NOT NULL DEFAULT false,
    "can_close_won" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lost_reasons" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "lost_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "entity" TEXT NOT NULL DEFAULT 'lead',
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "phone_norm" TEXT,
    "email" TEXT,
    "email_norm" TEXT,
    "source_id" UUID,
    "stage_id" UUID NOT NULL,
    "temperature" "Temperature" NOT NULL DEFAULT 'UNKNOWN',
    "budget_min_minor" BIGINT,
    "budget_max_minor" BIGINT,
    "location" TEXT,
    "property_type" TEXT,
    "requirements" TEXT,
    "buying_timeline" "BuyingTimeline" NOT NULL DEFAULT 'UNKNOWN',
    "assigned_membership_id" UUID,
    "score" INTEGER,
    "score_updated_at" TIMESTAMPTZ(3),
    "last_contacted_at" TIMESTAMPTZ(3),
    "next_follow_up_at" TIMESTAMPTZ(3),
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "lost_reason_id" UUID,
    "lost_note" TEXT,
    "merged_into_id" UUID,
    "created_by_user_id" UUID,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'neutral',

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_tags" (
    "tenant_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "lead_tags_pkey" PRIMARY KEY ("lead_id","tag_id")
);

-- CreateTable
CREATE TABLE "lead_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_activities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actor_user_id" UUID,
    "data" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stage_transitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "from_stage_id" UUID,
    "to_stage_id" UUID NOT NULL,
    "lost_reason_id" UUID,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stage_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "project" TEXT NOT NULL,
    "unit_label" TEXT,
    "title" TEXT NOT NULL,
    "property_type" TEXT NOT NULL,
    "bedrooms" INTEGER,
    "area_sqft" INTEGER,
    "price_minor" BIGINT NOT NULL,
    "location" TEXT NOT NULL,
    "status" "PropertyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "created_by" UUID NOT NULL,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pipeline_stages_tenant_id_position_idx" ON "pipeline_stages"("tenant_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_tenant_id_key_key" ON "pipeline_stages"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "lost_reasons_tenant_id_idx" ON "lost_reasons"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "lost_reasons_tenant_id_name_key" ON "lost_reasons"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "lead_sources_tenant_id_idx" ON "lead_sources"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_sources_tenant_id_key_key" ON "lead_sources"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "custom_field_definitions_tenant_id_idx" ON "custom_field_definitions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_definitions_tenant_id_entity_key_key" ON "custom_field_definitions"("tenant_id", "entity", "key");

-- CreateIndex
CREATE INDEX "leads_tenant_id_deleted_at_created_at_idx" ON "leads"("tenant_id", "deleted_at", "created_at" DESC);

-- CreateIndex
CREATE INDEX "leads_tenant_id_stage_id_idx" ON "leads"("tenant_id", "stage_id");

-- CreateIndex
CREATE INDEX "leads_tenant_id_assigned_membership_id_idx" ON "leads"("tenant_id", "assigned_membership_id");

-- CreateIndex
CREATE INDEX "leads_tenant_id_phone_norm_idx" ON "leads"("tenant_id", "phone_norm");

-- CreateIndex
CREATE INDEX "leads_tenant_id_email_norm_idx" ON "leads"("tenant_id", "email_norm");

-- CreateIndex
CREATE INDEX "leads_tenant_id_next_follow_up_at_idx" ON "leads"("tenant_id", "next_follow_up_at");

-- CreateIndex
CREATE INDEX "tags_tenant_id_idx" ON "tags"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tags_tenant_id_name_key" ON "tags"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "lead_tags_tenant_id_idx" ON "lead_tags"("tenant_id");

-- CreateIndex
CREATE INDEX "lead_notes_tenant_id_lead_id_created_at_idx" ON "lead_notes"("tenant_id", "lead_id", "created_at");

-- CreateIndex
CREATE INDEX "lead_activities_tenant_id_lead_id_created_at_idx" ON "lead_activities"("tenant_id", "lead_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "stage_transitions_tenant_id_lead_id_created_at_idx" ON "stage_transitions"("tenant_id", "lead_id", "created_at");

-- CreateIndex
CREATE INDEX "stage_transitions_tenant_id_to_stage_id_created_at_idx" ON "stage_transitions"("tenant_id", "to_stage_id", "created_at");

-- CreateIndex
CREATE INDEX "properties_tenant_id_status_idx" ON "properties"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "properties_tenant_id_location_idx" ON "properties"("tenant_id", "location");

-- CreateIndex
CREATE INDEX "properties_tenant_id_price_minor_idx" ON "properties"("tenant_id", "price_minor");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_tenant_id_idx" ON "api_keys"("tenant_id");

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "pipeline_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tags" ADD CONSTRAINT "lead_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stage_transitions" ADD CONSTRAINT "stage_transitions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
