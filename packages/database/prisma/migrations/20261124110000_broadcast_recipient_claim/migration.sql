-- Leased claim for broadcast dispatch (audit S-02): a dispatcher moves rows PENDING -> QUEUED with claimed_at inside one statement
-- (FOR UPDATE SKIP LOCKED), so two workers or a retried job can never pick the same recipient.
ALTER TABLE "broadcast_recipients" ADD COLUMN "claimed_at" TIMESTAMPTZ(3);
