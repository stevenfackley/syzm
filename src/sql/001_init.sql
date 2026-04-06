-- SYZM core schema
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS syzm_recovery_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id TEXT NOT NULL,
  decline_code TEXT,
  bank_bin TEXT,
  region TEXT NOT NULL DEFAULT 'US',
  retry_count INT NOT NULL DEFAULT 0 CHECK (retry_count >= 0 AND retry_count < 4),
  original_amount_cents INT NOT NULL DEFAULT 0,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'retrying', 'recovered', 'exhausted')),
  processor_origin TEXT NOT NULL CHECK (processor_origin IN ('stripe', 'adyen', 'braintree')),
  processor_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  schedule_reason TEXT,
  strategy_version TEXT,
  processor_reference TEXT,
  last_decline_code TEXT,
  recovered_at TIMESTAMPTZ,
  exhausted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_syzm_queue_scheduled_status
  ON syzm_recovery_queue (status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_syzm_queue_invoice
  ON syzm_recovery_queue (invoice_id);

CREATE TABLE IF NOT EXISTS syzm_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date DATE NOT NULL,
  customer_id TEXT,
  attempts_total INT NOT NULL DEFAULT 0,
  recovered_total INT NOT NULL DEFAULT 0,
  recovered_cents BIGINT NOT NULL DEFAULT 0,
  churn_reduction_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (metric_date, customer_id)
);

CREATE TABLE IF NOT EXISTS syzm_audit_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT,
  uploaded_rows INT NOT NULL DEFAULT 0,
  failed_amount_cents BIGINT NOT NULL DEFAULT 0,
  recoverable_monthly_cents BIGINT NOT NULL DEFAULT 0,
  churn_reduction_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  source_filename TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION syzm_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_syzm_touch_updated_at ON syzm_recovery_queue;
CREATE TRIGGER trg_syzm_touch_updated_at
BEFORE UPDATE ON syzm_recovery_queue
FOR EACH ROW
EXECUTE FUNCTION syzm_touch_updated_at();

