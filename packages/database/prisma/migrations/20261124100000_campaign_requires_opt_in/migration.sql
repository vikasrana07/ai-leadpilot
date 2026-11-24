-- Broadcast campaigns now require an explicit WhatsApp opt-in (audit S-01).
-- Leads with no consent record are skipped with their own status/counter, separate from leads who opted out.
ALTER TYPE "BroadcastRecipientStatus" ADD VALUE IF NOT EXISTS 'SKIPPED_NO_CONSENT';
ALTER TABLE "broadcast_campaigns" ADD COLUMN "no_consent_count" INTEGER NOT NULL DEFAULT 0;
