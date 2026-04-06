# Architecture Overview

## System Diagram (Text)

1. Processor webhooks -> Supabase Edge ingress (`src/ingest/webhook.ts`)
2. Ingress normalizes event + calls Brain (`src/brain/app/main.py`) for retry timestamp
3. Queue entry written to Postgres (`src/sql/001_init.sql`)
4. `pg_cron` triggers execution loop (`src/sql/002_cron.sql`)
5. Execution loop processes due retries and updates status
6. Metrics and audit runs power dashboard and sales workflows

## Design Decisions

- Keep Brain stateless and horizontally scalable.
- Keep queue state in Postgres for auditable lifecycle transitions.
- Use R2 for long-term training data and model artifacts.
- Enforce compliance in both data model and business logic layers.

## Scalability Notes

- Ingestion path should support request buffering if webhook burst exceeds insert throughput.
- Brain service should scale by CPU and maintain model warm-cache.
- Retry execution should shard by customer and processor to prevent hot partitions.

