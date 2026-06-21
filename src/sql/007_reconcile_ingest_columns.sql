-- 007: reconcile columns the ingest/execution layer reads and writes.
--
-- The hardened ingest functions (src/ingest) persist a tokenized payment
-- reference and a normalized decline category on each queue row. Neither
-- existed in 001_init; this migration adds them. Append-only, idempotent.

ALTER TABLE syzm_recovery_queue
  ADD COLUMN IF NOT EXISTS payment_token TEXT,
  ADD COLUMN IF NOT EXISTS decline_category TEXT;

COMMENT ON COLUMN syzm_recovery_queue.payment_token IS
  'Tokenized payment reference (processor token / payment_method id) used to '
  're-attempt the charge. Never a raw PAN — keeps Syzm out of PCI CHD scope.';

COMMENT ON COLUMN syzm_recovery_queue.decline_category IS
  'Normalized Syzm decline category: insufficient_funds, do_not_honor, transient, '
  'velocity, expired_card, invalid_data, fraud, authentication, unknown. Mirrors '
  'the Brain category vocabulary. Codes mapping to fraud are never retried.';

-- Index supports the decline-intelligence view grouping by category.
CREATE INDEX IF NOT EXISTS idx_syzm_queue_decline_category
  ON syzm_recovery_queue (decline_category)
  WHERE decline_category IS NOT NULL;
