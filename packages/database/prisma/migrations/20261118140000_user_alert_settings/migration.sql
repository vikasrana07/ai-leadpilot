-- Per-person alert settings (sound and desktop alerts for new notifications). Personal, not per workspace: a person can belong to several
-- workspaces and wants the same choice in all of them, on every device. No tenant_id, so no row-level security (like mfa_credentials); a
-- person's row is read and written only for the signed-in user, never from input. A missing row means the defaults.
CREATE TABLE user_alert_settings (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sound_enabled   boolean NOT NULL DEFAULT true,
  sound_volume    int NOT NULL DEFAULT 50 CHECK (sound_volume BETWEEN 0 AND 100),
  desktop_enabled boolean NOT NULL DEFAULT true,
  updated_at      timestamptz(3) NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON user_alert_settings TO leadpilot_app;
