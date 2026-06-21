-- ============================================================
-- 005_cron_parameterized.sql
-- Replaces the placeholder cron job from 002_cron.sql with one
-- that reads the executor URL and service key from Supabase Vault
-- (vault.decrypted_secrets) instead of hard-coded literals.
--
-- ────────────────────────────────────────────────────────────
-- ONE-TIME SETUP (run once by a superuser / project owner;
-- do NOT commit real values — use the Supabase dashboard or CLI):
--
--   -- Store the Edge Function base URL (no path):
--   SELECT vault.create_secret(
--     'https://<YOUR_PROJECT_REF>.supabase.co',   -- value
--     'syzm_executor_base_url',                    -- name
--     'Syzm executor Edge Function base URL'       -- description
--   );
--
--   -- Store the service-role key:
--   SELECT vault.create_secret(
--     '<YOUR_SERVICE_ROLE_KEY>',
--     'syzm_service_key',
--     'Syzm executor service-role JWT'
--   );
--
-- After running this migration the cron job reads those secrets
-- at schedule time — no SQL editing required when keys rotate.
-- ────────────────────────────────────────────────────────────
--
-- If Vault is not available (self-hosted Postgres without pgsodium),
-- fall back to a syzm_config table approach — see the comment at the
-- bottom of this file.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------
-- Remove the placeholder job from 002_cron.sql if it still exists.
-- cron.unschedule is idempotent when given a name — it returns false
-- if the job does not exist rather than raising an error.
-- ---------------------------------------------------------------
SELECT cron.unschedule('syzm-execution-loop')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'syzm-execution-loop'
);

-- ---------------------------------------------------------------
-- (Re)schedule the job using Vault-sourced secrets.
--
-- The inner DO block is evaluated at schedule time by pg_cron,
-- not at migration time, so the secrets are read fresh on every
-- tick.  This also means key rotation takes effect within one
-- cron interval without any schema change.
-- ---------------------------------------------------------------
SELECT cron.schedule(
  'syzm-execution-loop',           -- job name
  '* * * * *',                     -- every minute
  $CRON$
    DO $$
    DECLARE
      v_base_url  TEXT;
      v_svc_key   TEXT;
    BEGIN
      -- Read secrets from Vault (requires pgsodium + vault extension).
      -- vault.decrypted_secrets decrypts on the fly; the result is
      -- never stored in plaintext in pg_cron.job.command.
      SELECT decrypted_secret INTO v_base_url
        FROM vault.decrypted_secrets
       WHERE name = 'syzm_executor_base_url'
       LIMIT 1;

      SELECT decrypted_secret INTO v_svc_key
        FROM vault.decrypted_secrets
       WHERE name = 'syzm_service_key'
       LIMIT 1;

      -- Abort cleanly if secrets are missing — avoids firing a broken request.
      IF v_base_url IS NULL OR v_svc_key IS NULL THEN
        RAISE WARNING 'syzm-execution-loop: vault secrets not found, skipping tick';
        RETURN;
      END IF;

      -- Fire the Edge Function.
      PERFORM net.http_post(
        url     := v_base_url || '/functions/v1/execute-retries',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || v_svc_key,
          'Content-Type',  'application/json'
        ),
        body    := '{}'::jsonb
      );
    END;
    $$
  $CRON$
)
ON CONFLICT (jobname) DO UPDATE
  SET schedule = EXCLUDED.schedule,
      command  = EXCLUDED.command;

-- ---------------------------------------------------------------
-- FALLBACK: syzm_config table (no Vault / pgsodium)
-- If pgsodium is not available, store config in a table instead:
--
--   CREATE TABLE IF NOT EXISTS syzm_config (
--     key   TEXT PRIMARY KEY,
--     value TEXT NOT NULL
--   );
--   -- Populate via Supabase dashboard environment / init script:
--   INSERT INTO syzm_config (key, value)
--     VALUES ('executor_base_url', 'https://...'),
--            ('service_key',       '<key>')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
--
-- Then in the cron body replace vault.decrypted_secrets SELECTs with:
--   SELECT value INTO v_base_url FROM syzm_config WHERE key = 'executor_base_url';
--   SELECT value INTO v_svc_key  FROM syzm_config WHERE key = 'service_key';
--
-- WARNING: syzm_config values are stored in plaintext in Postgres.
-- Restrict access with GRANT / RLS if you use this fallback.
-- ---------------------------------------------------------------
