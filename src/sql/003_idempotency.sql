-- ============================================================
-- 003_idempotency.sql
-- Adds processor_event_id for ingest-level deduplication and a
-- composite guard on (invoice_id, retry_count) to prevent double
-- charges from concurrent webhook delivery.
--
-- INGEST UPSERT PATTERN:
--   INSERT INTO syzm_recovery_queue (..., processor_event_id, ...)
--   VALUES (...)
--   ON CONFLICT (processor_event_id) DO NOTHING;
--
-- This is idempotent: applying the migration to a db that already
-- has the column / indexes is a no-op.
-- ============================================================

-- 1. Add the idempotency key column.
--    NULL-able so existing rows are unaffected; new ingest MUST supply it.
ALTER TABLE syzm_recovery_queue
  ADD COLUMN IF NOT EXISTS processor_event_id TEXT;

-- 2. Unique index on the idempotency key.
--    Partial (WHERE processor_event_id IS NOT NULL) so old NULL rows
--    don't block the constraint — only new, keyed rows are guarded.
CREATE UNIQUE INDEX IF NOT EXISTS uidx_syzm_queue_event_id
  ON syzm_recovery_queue (processor_event_id)
  WHERE processor_event_id IS NOT NULL;

-- 3. Composite guard: each invoice may have at most one active row
--    per retry attempt.  Prevents a second webhook for the same
--    failed charge from enqueuing a duplicate retry at the same depth.
--    Partial: only 'pending' / 'retrying' rows compete; recovered /
--    exhausted rows are historical and may share (invoice_id, retry_count).
CREATE UNIQUE INDEX IF NOT EXISTS uidx_syzm_queue_invoice_retry_active
  ON syzm_recovery_queue (invoice_id, retry_count)
  WHERE status IN ('pending', 'retrying');

-- 4. Comment for discoverability
COMMENT ON COLUMN syzm_recovery_queue.processor_event_id IS
  'Idempotency key sourced from the upstream processor webhook event id '
  '(e.g. Stripe event id: evt_xxx).  Ingest layer upserts ON CONFLICT '
  '(processor_event_id) DO NOTHING to prevent duplicate queue rows from '
  'repeated webhook delivery.';
