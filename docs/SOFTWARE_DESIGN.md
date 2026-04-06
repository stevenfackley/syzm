# Software Design Document (SDD)

## Architecture

- Ledger: Supabase PostgreSQL + Edge Functions + `pg_cron`
- Brain: FastAPI + XGBoost inference service on AWS
- Data Lake: Cloudflare R2 for parquet logs and model artifacts

## Runtime Components

## Ingest Path

1. Processor webhook arrives at Edge Function.
2. Event is normalized and soft declines are enqueued in `syzm_recovery_queue`.
3. Edge calls `Syzm Brain` for optimal retry timestamp.

## Execution Path

1. `pg_cron` triggers execution loop once per minute.
2. Edge function loads due queue rows with `status='pending'`.
3. Retry attempt is sent via selected processor adapter.
4. Queue row is updated to `recovered`, `pending` (rescheduled), or `exhausted`.

## Model Path

1. Feature vector built from decline metadata (code, region, BIN features, retry history).
2. Brain returns UTC retry timestamp.
3. Compliance filters enforce:
   - max retries under 4
   - Sunday 01:00-03:00 EST blackout

## Data Contracts

- Queue table is source of truth for retry lifecycle.
- Metrics table stores aggregates for dashboard and reporting.
- Audit runs table stores upload-derived opportunity estimates.

