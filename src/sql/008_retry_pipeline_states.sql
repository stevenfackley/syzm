-- ============================================================
-- 008_retry_pipeline_states.sql
-- Lines the queue schema up with what the ingest webhook and the retry
-- worker write, and gives the worker a claim, so a row that was charged
-- is never dispatched again.
--
-- Against 001-007 the pipeline could not run end to end:
--   * correlation_id did not exist, so the webhook insert and the worker's
--     due-row select both failed.
--   * CHECK (retry_count < 4) rejected the worker's write after a fourth
--     attempt, so a row charged on its fourth attempt stayed 'pending' and
--     was dispatched again on every cron tick (every minute). An exhausted
--     row did the same.
--   * the status CHECK had no 'blocked' or 'error', so those writes failed
--     and the rows were dispatched again on every tick.
--   * nothing stopped a second row for the same invoice, so the processor's
--     webhook for a retry the worker had just made opened a second retry
--     sequence for an invoice that was already being retried.
--
-- Append-only and idempotent, like 003-007.
-- ============================================================

-- 1. Columns the ingest code reads and writes.
ALTER TABLE syzm_recovery_queue
  ADD COLUMN IF NOT EXISTS correlation_id TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_started_at TIMESTAMPTZ;

COMMENT ON COLUMN syzm_recovery_queue.correlation_id IS
  'Request id of the webhook delivery that created the row. The retry worker '
  'logs its attempts on the row under the same id.';

COMMENT ON COLUMN syzm_recovery_queue.claimed_at IS
  'When a retry worker last claimed the row (status retrying) to charge it. '
  'A claim older than the worker''s stale window means that worker died; a later '
  'run takes the row over and repeats the same attempt with the same idempotency key.';

COMMENT ON COLUMN syzm_recovery_queue.attempt_started_at IS
  'When the current attempt was first claimed. A takeover repeats the attempt only '
  'while the processor still remembers its idempotency key, counted from this time.';

-- 2. Status: the terminal states the worker writes ('blocked': the decline
--    must not be retried; 'error': the row cannot be retried safely).
ALTER TABLE syzm_recovery_queue
  DROP CONSTRAINT IF EXISTS syzm_recovery_queue_status_check;
ALTER TABLE syzm_recovery_queue
  ADD CONSTRAINT syzm_recovery_queue_status_check
  CHECK (status IN ('pending', 'retrying', 'recovered', 'exhausted', 'blocked', 'error'));

-- 3. retry_count is the number of attempts made. A finished row may record
--    the fourth; a row that can still be dispatched may not (the Visa cap
--    001 meant to enforce).
ALTER TABLE syzm_recovery_queue
  DROP CONSTRAINT IF EXISTS syzm_recovery_queue_retry_count_check;
ALTER TABLE syzm_recovery_queue
  ADD CONSTRAINT syzm_recovery_queue_retry_count_check
  CHECK (retry_count BETWEEN 0 AND 4 AND (retry_count < 4 OR status NOT IN ('pending', 'retrying')));

-- 4. A claimed row carries its claim times; without them the stale-claim
--    takeover would never see it. Nothing wrote 'retrying' before this
--    migration, so the backfill only covers rows set by hand.
UPDATE syzm_recovery_queue
   SET claimed_at = COALESCE(claimed_at, updated_at),
       attempt_started_at = COALESCE(attempt_started_at, updated_at)
 WHERE status = 'retrying' AND (claimed_at IS NULL OR attempt_started_at IS NULL);

ALTER TABLE syzm_recovery_queue
  DROP CONSTRAINT IF EXISTS syzm_recovery_queue_claim_check;
ALTER TABLE syzm_recovery_queue
  ADD CONSTRAINT syzm_recovery_queue_claim_check
  CHECK (status <> 'retrying' OR (claimed_at IS NOT NULL AND attempt_started_at IS NOT NULL));

-- 5. One row per invoice, in any status. A later decline webhook for an
--    invoice that is being retried, was recovered, or was finished is a
--    duplicate: the insert fails with unique_violation (23505) and the
--    webhook drops it. NULLS NOT DISTINCT (PostgreSQL 15+) so rows without
--    a tenant_id still collide.
--    Fails if duplicates already exist; dedupe them first.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_syzm_queue_invoice_once
  ON syzm_recovery_queue (tenant_id, processor_origin, invoice_id) NULLS NOT DISTINCT;
