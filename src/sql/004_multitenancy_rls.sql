-- ============================================================
-- 004_multitenancy_rls.sql
-- Adds tenant isolation to syzm_recovery_queue and syzm_metrics,
-- then enables Row-Level Security on both tables.
--
-- NAMING DECISION:
--   syzm_metrics already has `customer_id TEXT`.
--   We introduce `tenant_id TEXT` on syzm_recovery_queue and add
--   an alias column `tenant_id` to syzm_metrics that mirrors
--   customer_id. A CHECK constraint keeps them in sync.
--   Rationale: "tenant_id" is the canonical auth-layer term; the
--   dashboard and executor always use tenant_id.  customer_id in
--   syzm_metrics is kept for backward compatibility — do not remove it.
--
-- HOW THE APP SETS TENANT CONTEXT:
--   Option A (Supabase Auth / JWT):
--     The JWT issued to each tenant must carry claim  { "tenant_id": "acme" }.
--     Policies reference:  auth.jwt() ->> 'tenant_id'
--     This is the preferred path for portal users.
--
--   Option B (service-role executor / server-side sessions):
--     Before executing tenant-scoped queries the executor must run:
--       SET LOCAL app.tenant_id = '<tenant_id>';
--     Policies reference:  current_setting('app.tenant_id', true)
--     The second arg (true) makes the setting return '' rather than
--     raise an error when not set, so the policy evaluates safely.
--
--   The policies below support BOTH approaches via OR — whichever
--   is non-empty wins.  The service role bypasses RLS entirely.
-- ============================================================

-- ---------------------------------------------------------------
-- syzm_recovery_queue — add tenant_id
-- ---------------------------------------------------------------
ALTER TABLE syzm_recovery_queue
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- Index for tenant-scoped queue scans (status+scheduled_at already indexed;
-- this covers the additional filter the executor applies per tenant).
CREATE INDEX IF NOT EXISTS idx_syzm_queue_tenant
  ON syzm_recovery_queue (tenant_id, status, scheduled_at);

COMMENT ON COLUMN syzm_recovery_queue.tenant_id IS
  'Tenant identifier.  Must be set by the ingest layer on every new row.  '
  'Sourced from the JWT claim "tenant_id" or from app.tenant_id GUC.';

-- ---------------------------------------------------------------
-- syzm_metrics — add tenant_id column that mirrors customer_id
-- ---------------------------------------------------------------
ALTER TABLE syzm_metrics
  ADD COLUMN IF NOT EXISTS tenant_id TEXT
    GENERATED ALWAYS AS (customer_id) STORED;

-- Note: tenant_id is a generated column so the UNIQUE constraint on
-- (metric_date, customer_id) already covers (metric_date, tenant_id).

CREATE INDEX IF NOT EXISTS idx_syzm_metrics_tenant
  ON syzm_metrics (tenant_id, metric_date);

COMMENT ON COLUMN syzm_metrics.tenant_id IS
  'Computed alias for customer_id — the canonical multi-tenancy key used '
  'by RLS policies and the dashboard view.';

-- ---------------------------------------------------------------
-- Helper: resolve tenant from JWT claim or GUC
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION syzm_current_tenant_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT NULLIF(
    COALESCE(
      -- Option A: Supabase JWT claim (will be NULL outside auth sessions)
      NULLIF((auth.jwt() ->> 'tenant_id'), ''),
      -- Option B: session GUC set by executor / API layer
      NULLIF(current_setting('app.tenant_id', true), '')
    ),
    ''
  );
$$;

COMMENT ON FUNCTION syzm_current_tenant_id() IS
  'Returns the active tenant id from either the Supabase JWT claim '
  '"tenant_id" or the session GUC app.tenant_id, whichever is set. '
  'Returns NULL if neither is set (will match no rows under RLS).';

-- ---------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------
ALTER TABLE syzm_recovery_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE syzm_metrics        ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------
-- Policies: syzm_recovery_queue
-- ---------------------------------------------------------------

-- Tenants may SELECT their own rows.
DROP POLICY IF EXISTS syzm_queue_tenant_select ON syzm_recovery_queue;
CREATE POLICY syzm_queue_tenant_select
  ON syzm_recovery_queue
  FOR SELECT
  USING (tenant_id = syzm_current_tenant_id());

-- Tenants may INSERT rows only for themselves.
DROP POLICY IF EXISTS syzm_queue_tenant_insert ON syzm_recovery_queue;
CREATE POLICY syzm_queue_tenant_insert
  ON syzm_recovery_queue
  FOR INSERT
  WITH CHECK (tenant_id = syzm_current_tenant_id());

-- Tenants may UPDATE their own rows (e.g. cancel a pending retry).
DROP POLICY IF EXISTS syzm_queue_tenant_update ON syzm_recovery_queue;
CREATE POLICY syzm_queue_tenant_update
  ON syzm_recovery_queue
  FOR UPDATE
  USING  (tenant_id = syzm_current_tenant_id())
  WITH CHECK (tenant_id = syzm_current_tenant_id());

-- Tenants may NOT delete queue rows; soft-delete via status is enforced
-- by the status CHECK constraint in 001_init.sql.
-- (No DELETE policy → DELETE is denied for non-service-role sessions.)

-- ---------------------------------------------------------------
-- Policies: syzm_metrics
-- ---------------------------------------------------------------

DROP POLICY IF EXISTS syzm_metrics_tenant_select ON syzm_metrics;
CREATE POLICY syzm_metrics_tenant_select
  ON syzm_metrics
  FOR SELECT
  USING (tenant_id = syzm_current_tenant_id());

-- Only the executor (service role) should write metrics rows.
-- Non-service-role INSERT/UPDATE/DELETE on syzm_metrics is blocked by
-- the absence of any permissive policy for those operations.

-- ---------------------------------------------------------------
-- Service-role bypass note
-- ---------------------------------------------------------------
-- Supabase's service_role automatically has BYPASSRLS.
-- The executor Edge Function must use the service_role key so it can
-- read/write across all tenants when running the cron loop.
-- The portal client must use the anon / user JWT so RLS is enforced.
