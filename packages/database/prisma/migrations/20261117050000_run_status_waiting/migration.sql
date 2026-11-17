-- A run parked on a wait node. Its own migration: a new enum value cannot be used in the transaction that adds it.
ALTER TYPE "RunStatus" ADD VALUE IF NOT EXISTS 'WAITING';
