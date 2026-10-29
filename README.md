# SYZM <sub>`>o)`</sub>

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

Apply `src/sql/001` through `src/sql/007` in order. See [`src/sql/README.md`](src/sql/README.md) for details: `002_cron.sql` holds placeholder literals and is superseded by `005_cron_parameterized.sql`, which needs the Vault secrets registered first.

## Configuration

Copy `.env.example` to `.env` and update secrets. `.env.example` is the authoritative list.

Required values:

- `SYZM_SUPABASE_URL`
- `SYZM_SUPABASE_SERVICE_ROLE_KEY`
- `SYZM_BRAIN_URL`
- `SYZM_STRIPE_API_KEY`
- `SYZM_ADYEN_API_KEY`
- `SYZM_BRAINTREE_API_KEY`
- `SYZM_BRAIN_API_KEY` (Brain scoring API auth, sent as `X-Syzm-Key`)
- Webhook verification: `SYZM_STRIPE_WEBHOOK_SECRET`, `SYZM_ADYEN_HMAC_KEY`, `SYZM_ADYEN_MERCHANT_ACCOUNT`, `SYZM_BRAINTREE_PUBLIC_KEY`, `SYZM_BRAINTREE_PRIVATE_KEY`, `SYZM_BRAINTREE_MERCHANT_ID`
- Portal: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

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
- Webhook signature verification is implemented in `src/ingest/_shared/verify.ts` (Stripe signatures carry a timestamp tolerance for replay protection); `src/ingest/webhook.ts` returns 401 on a failed check.
- Processor retry calls in `src/ingest/_shared/processors.ts` call the live REST APIs directly. Adyen (`checkout-test.adyen.com`) and Braintree (sandbox GraphQL) still point at test/sandbox endpoints, and Braintree carries a TODO to move to the official SDK.

