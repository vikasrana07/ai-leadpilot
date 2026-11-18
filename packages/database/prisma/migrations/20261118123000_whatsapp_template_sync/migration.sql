-- WhatsApp template sync (Embedded Signup, ADR 0012): templates can now come from Meta. `source` says where a row came from ('manual' = typed in
-- by the workspace, the only kind that existed before; 'meta' = synced), `approval_status` is Meta's status for synced rows (NULL for manual rows,
-- which the workspace vouches for), `synced_at` is when it was last confirmed. The app role already has full rights on this table.
ALTER TABLE whatsapp_templates
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS approval_status text,
  ADD COLUMN IF NOT EXISTS synced_at timestamptz(3);
