# SYZM

ML-driven payment recovery platform for streaming businesses.  
Syzm ingests soft declines from processors, predicts the best retry window, and executes retries across gateway routes while enforcing 2026 compliance constraints.

## What Is Included

- `src/brain`: FastAPI inference service ("Syzm Brain") with retry scheduling logic.
- `src/ingest`: Supabase Edge Function scaffolding for webhook ingest and retry execution.
- `src/portal`: Next.js self-service audit portal (`/audit`) + dashboard + integration UI.
- `src/sql`: Postgres schema and `pg_cron` execution loop migration.
- `src/infra`: Docker and Terraform scaffolding for local/dev/prod infra.
- `docs`: Product, design, roadmap, financial, and compliance documentation.

## Core Guarantees Implemented In Scaffold

- Retry guard: `retry_count < 4` is enforced in both SQL and app logic.
- Sunday US maintenance blackout: retries are automatically moved out of `01:00-03:00` America/New_York.
- Processor-agnostic routing hooks: queue supports processor history and failover attempts.
- PCI out-of-scope posture: queue stores non-PAN metadata only.

## Quick Start

## 1) Syzm Brain (FastAPI)

```bash
cd src/brain
python -m venv .venv
source .venv/bin/activate  # on Windows use .venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
```

Health endpoint: `GET http://localhost:8080/healthz`

## 2) Audit Portal (Next.js)

```bash
cd src/portal
npm install
npm run dev
```

Open `http://localhost:3000`.

## 3) SQL Bootstrap

Run in order:

1. `src/sql/001_init.sql`
2. `src/sql/002_cron.sql`

## Configuration

Copy `.env.example` to `.env` and update secrets.

Required values:

- `SYZM_SUPABASE_URL`
- `SYZM_SUPABASE_SERVICE_ROLE_KEY`
- `SYZM_BRAIN_URL`
- `SYZM_STRIPE_API_KEY`
- `SYZM_ADYEN_API_KEY`
- `SYZM_BRAINTREE_API_KEY`

## Project Layout

```text
syzm/
├─ docs/
├─ src/
│  ├─ brain/
│  ├─ ingest/
│  ├─ portal/
│  ├─ sql/
│  ├─ infra/
│  └─ shared/
├─ README.md
├─ CONTRIBUTING.md
├─ SECURITY.md
├─ CODE_OF_CONDUCT.md
├─ CHANGELOG.md
└─ LICENSE
```

## Production Notes

- This scaffold is intentionally implementation-ready but not production-complete.
- Signature verification for processor webhooks is left as a marked TODO in `src/ingest/webhook.ts`.
- Processor retry calls in `src/ingest/_shared/processors.ts` are stubs and should be swapped for official SDK calls.

