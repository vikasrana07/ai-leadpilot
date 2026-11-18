-- A WhatsApp channel connected with Facebook (Embedded Signup) whose token was revoked or has expired is not "broken settings the owner
-- can fix by editing": it must be connected again. NEEDS_RECONNECT tells the app and the owner exactly that. Sending already requires an
-- ACTIVE channel, so this status blocks sends like ERROR and DISABLED do. (ALTER TYPE ... ADD VALUE cannot be used in the same transaction;
-- the health-check function that reads channels lives in the next migration.)
ALTER TYPE "ChannelStatus" ADD VALUE IF NOT EXISTS 'NEEDS_RECONNECT';
