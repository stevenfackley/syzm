-- ============================================================
-- 006_dashboard_views.sql
-- Provides the views read by the portal dashboard.  All views are
-- tenant-filtered: because RLS is enabled on both base tables, any
-- SELECT against these views automatically sees only the rows
-- belonging to the current tenant (auth JWT or app.tenant_id GUC).
-- The service role sees all rows.
--
-- Views:
--   syzm_dashboard_metrics    — KPI roll-ups for the dashboard header
--   syzm_decline_intelligence — decline-category breakdown for the
--                               "Decline Intelligence" UI panel
-- ============================================================

-- ---------------------------------------------------------------
-- Ensure the executor can write outcome rows to syzm_metrics.
-- 001_init.sql already creates the table; this block adds any
-- missing columns that the executor is expected to write.
-- ---------------------------------------------------------------

-- Amount recovered on this date (in cents).  Already present in 001
-- as recovered_cents.  No change needed.

-- Number of failed attempts on this date that were NOT recovered.
ALTER TABLE syzm_metrics
  ADD COLUMN IF NOT EXISTS failed_total INT NOT NULL DEFAULT 0;

-- Processor origin for per-processor breakdowns.
ALTER TABLE syzm_metrics
  ADD COLUMN IF NOT EXISTS processor_origin TEXT
    CHECK (processor_origin IN ('stripe', 'adyen', 'braintree'));

-- Geographic region for per-region breakdowns.
ALTER TABLE syzm_metrics
  ADD COLUMN IF NOT EXISTS region TEXT;

COMMENT ON TABLE syzm_metrics IS
  'Daily aggregate outcomes written by the executor after each retry batch. '
  'One row per (metric_date, customer_id, processor_origin, region) combination. '
  'The UNIQUE constraint on (metric_date, customer_id) from 001_init.sql is '
  'superseded here; if processor_origin/region granularity is added a new '
  'unique key may be needed — revisit when the executor is updated.';

-- ---------------------------------------------------------------
-- VIEW: syzm_dashboard_metrics
-- Portal reads this for the KPI header cards.
-- RLS on syzm_recovery_queue and syzm_metrics propagates automatically.
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW syzm_dashboard_metrics AS
WITH queue_today AS (
  -- Retry outcomes from the live queue (today only)
  SELECT
    COUNT(*) FILTER (WHERE status = 'recovered')                        AS recovered_count_today,
    SUM(original_amount_cents) FILTER (WHERE status = 'recovered')      AS revenue_saved_today_cents,
    COUNT(*) FILTER (WHERE status IN ('recovered','exhausted','retrying','pending')) AS total_attempted_today
  FROM syzm_recovery_queue
  WHERE created_at >= CURRENT_DATE
    AND created_at <  CURRENT_DATE + INTERVAL '1 day'
),
metrics_lifetime AS (
  SELECT
    COALESCE(SUM(recovered_cents), 0)            AS lifetime_recovered_cents,
    COALESCE(SUM(attempts_total), 0)             AS lifetime_attempts,
    COALESCE(SUM(recovered_total), 0)            AS lifetime_recovered,
    COALESCE(AVG(churn_reduction_percent), 0)    AS avg_churn_reduction
  FROM syzm_metrics
),
queue_by_processor AS (
  -- Retry-success rate broken out by processor (all-time from queue)
  SELECT
    processor_origin,
    COUNT(*) FILTER (WHERE status = 'recovered')                    AS recovered,
    COUNT(*) FILTER (WHERE status IN ('recovered','exhausted'))     AS terminal
  FROM syzm_recovery_queue
  GROUP BY processor_origin
),
queue_by_region AS (
  -- Retry-success rate broken out by region (all-time from queue)
  SELECT
    region,
    COUNT(*) FILTER (WHERE status = 'recovered')                    AS recovered,
    COUNT(*) FILTER (WHERE status IN ('recovered','exhausted'))     AS terminal
  FROM syzm_recovery_queue
  GROUP BY region
)
SELECT
  -- Today
  COALESCE(qt.revenue_saved_today_cents, 0)                         AS revenue_saved_today_cents,
  COALESCE(qt.recovered_count_today, 0)                             AS recovered_count_today,
  COALESCE(qt.total_attempted_today, 0)                             AS attempted_today,
  CASE
    WHEN COALESCE(qt.total_attempted_today, 0) = 0 THEN 0
    ELSE ROUND(
      qt.recovered_count_today::NUMERIC / qt.total_attempted_today * 100,
      2
    )
  END                                                               AS recovery_rate_today_pct,

  -- Lifetime
  ml.lifetime_recovered_cents,
  ml.lifetime_attempts,
  ml.lifetime_recovered,
  CASE
    WHEN ml.lifetime_attempts = 0 THEN 0
    ELSE ROUND(ml.lifetime_recovered::NUMERIC / ml.lifetime_attempts * 100, 2)
  END                                                               AS recovery_rate_lifetime_pct,
  ROUND(ml.avg_churn_reduction, 2)                                  AS lifetime_churn_reduction_pct,

  -- Per-processor success rates (as JSON for flexible frontend consumption)
  (
    SELECT jsonb_object_agg(
      processor_origin,
      jsonb_build_object(
        'recovered', recovered,
        'terminal',  terminal,
        'rate_pct',  CASE WHEN terminal = 0 THEN 0
                     ELSE ROUND(recovered::NUMERIC / terminal * 100, 2) END
      )
    )
    FROM queue_by_processor
  )                                                                 AS success_by_processor,

  -- Per-region success rates (as JSON)
  (
    SELECT jsonb_object_agg(
      region,
      jsonb_build_object(
        'recovered', recovered,
        'terminal',  terminal,
        'rate_pct',  CASE WHEN terminal = 0 THEN 0
                     ELSE ROUND(recovered::NUMERIC / terminal * 100, 2) END
      )
    )
    FROM queue_by_region
  )                                                                 AS success_by_region

FROM queue_today qt
CROSS JOIN metrics_lifetime ml;

COMMENT ON VIEW syzm_dashboard_metrics IS
  'Tenant-filtered KPI roll-up for the portal dashboard header. '
  'Reads syzm_recovery_queue (live outcomes) and syzm_metrics (executor aggregates). '
  'RLS on both base tables enforces tenant isolation automatically. '
  'Portal queries this view with the tenant JWT — no WHERE clause needed.';

-- ---------------------------------------------------------------
-- VIEW: syzm_decline_intelligence
-- Decline-category breakdown for the "Decline Intelligence" panel.
-- Groups by decline_code (raw processor code) and computes counts
-- and total amount at risk per category.
-- ---------------------------------------------------------------
CREATE OR REPLACE VIEW syzm_decline_intelligence AS
SELECT
  COALESCE(decline_code, 'unknown')               AS decline_category,
  processor_origin,
  region,
  COUNT(*)                                         AS attempt_count,
  COUNT(*) FILTER (WHERE status = 'recovered')     AS recovered_count,
  COUNT(*) FILTER (WHERE status = 'exhausted')     AS exhausted_count,
  COUNT(*) FILTER (WHERE status IN ('pending','retrying')) AS in_flight_count,
  COALESCE(SUM(original_amount_cents), 0)          AS total_amount_cents,
  COALESCE(SUM(original_amount_cents)
    FILTER (WHERE status = 'recovered'), 0)        AS recovered_amount_cents,
  CASE
    WHEN COUNT(*) = 0 THEN 0
    ELSE ROUND(
      COUNT(*) FILTER (WHERE status = 'recovered')::NUMERIC / COUNT(*) * 100,
      2
    )
  END                                              AS recovery_rate_pct
FROM syzm_recovery_queue
GROUP BY
  COALESCE(decline_code, 'unknown'),
  processor_origin,
  region
ORDER BY total_amount_cents DESC;

COMMENT ON VIEW syzm_decline_intelligence IS
  'Tenant-filtered decline-category breakdown for the Decline Intelligence UI. '
  'Groups queue rows by (decline_code, processor_origin, region). '
  'The portal should filter client-side by processor/region or add a WHERE clause '
  'on this view to narrow scope; RLS handles tenant filtering automatically.';
