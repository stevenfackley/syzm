# SQL Migrations

Apply in order.  Each migration is idempotent (uses `IF NOT EXISTS`, `ON CONFLICT`, `CREATE OR REPLACE`).  Never re-apply 001/002 to a live database — they were run once at project init.

| # | File | Purpose |
|---|------|---------|
| 1 | `001_init.sql` | Core schema: `syzm_recovery_queue`, `syzm_metrics`, `syzm_audit_runs`, updated-at trigger |
| 2 | `002_cron.sql` | pg_cron/pg_net setup — **contains placeholder literals; superseded by 005** |
| 3 | `003_idempotency.sql` | `processor_event_id` column + UNIQUE index; composite active-row guard |
| 4 | `004_multitenancy_rls.sql` | `tenant_id` on queue, generated `tenant_id` on metrics, RLS policies |
| 5 | `005_cron_parameterized.sql` | Replaces the 002 placeholder job; reads URL + key from Vault |
| 6 | `006_dashboard_views.sql` | `syzm_dashboard_metrics` + `syzm_decline_intelligence` views |

---

## Idempotency (003)

The ingest layer MUST supply `processor_event_id` (the upstream webhook event id, e.g. Stripe `evt_xxx`) on every INSERT:

```sql
INSERT INTO syzm_recovery_queue (invoice_id, ..., processor_event_id, tenant_id, ...)
VALUES (...)
ON CONFLICT (processor_event_id) DO NOTHING;
```

A second webhook delivery for the same event is silently dropped.  A secondary composite index on `(invoice_id, retry_count) WHERE status IN ('pending','retrying')` prevents a concurrent second insert from enqueuing the same retry depth.

---

## Multi-Tenancy + RLS (004)

### Naming decision

`syzm_metrics` shipped with `customer_id`.  The canonical term across the rest of the system is `tenant_id`.  Migration 004 adds a **generated column** `tenant_id` to `syzm_metrics` that is always equal to `customer_id` — both names work, no data duplication.  New code should use `tenant_id`; `customer_id` is kept for backward compatibility.

### How tenant context is set

**Option A — Supabase Auth (portal users)**

The JWT issued to each tenant must carry `{ "tenant_id": "acme" }`.  Set this in the Supabase Auth hook or via custom claims.  RLS policies call `auth.jwt() ->> 'tenant_id'` automatically.

**Option B — service-role executor / server-side**

Before any tenant-scoped query the executor or API layer must run:

```sql
SET LOCAL app.tenant_id = '<tenant_id>';
```

`SET LOCAL` scopes the GUC to the current transaction.  The `syzm_current_tenant_id()` function reads it as a fallback when there is no JWT claim.

**Service role bypasses RLS** — the executor Edge Function must use the service-role key so it can iterate all tenants during the cron loop.  Portal clients must use the anon/user JWT so RLS is enforced.

### RLS summary

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `syzm_recovery_queue` | own rows | own rows | own rows | blocked (no policy) |
| `syzm_metrics` | own rows | service role only | service role only | service role only |

---

## Cron Setup (005)

### One-time secret registration (run once, not committed)

```sql
-- Run as project owner in Supabase SQL editor:
SELECT vault.create_secret(
  'https://<YOUR_PROJECT_REF>.supabase.co',
  'syzm_executor_base_url',
  'Syzm executor Edge Function base URL'
);

SELECT vault.create_secret(
  '<YOUR_SERVICE_ROLE_KEY>',
  'syzm_service_key',
  'Syzm executor service-role JWT'
);
```

Then apply `005_cron_parameterized.sql`.  The cron job reads both secrets from `vault.decrypted_secrets` on every tick — key rotation takes effect within one minute, no SQL edits required.

### Fallback (no Vault / pgsodium)

See the comment block at the bottom of `005_cron_parameterized.sql` for a `syzm_config` table approach.

---

## Dashboard Views (006)

### `syzm_dashboard_metrics`

Single-row view aggregating:

- `revenue_saved_today_cents` — sum of `original_amount_cents` for today's recovered rows
- `recovered_count_today`, `attempted_today`, `recovery_rate_today_pct`
- `lifetime_recovered_cents`, `lifetime_churn_reduction_pct`, `recovery_rate_lifetime_pct`
- `success_by_processor` — JSONB `{ stripe: { recovered, terminal, rate_pct }, ... }`
- `success_by_region` — same structure keyed by region

Portal query:
```sql
SELECT * FROM syzm_dashboard_metrics;
-- No WHERE needed; RLS on base tables handles tenant filtering.
```

### `syzm_decline_intelligence`

Grouped by `(decline_category, processor_origin, region)`:

- `attempt_count`, `recovered_count`, `exhausted_count`, `in_flight_count`
- `total_amount_cents`, `recovered_amount_cents`, `recovery_rate_pct`

Portal query:
```sql
SELECT * FROM syzm_decline_intelligence
WHERE processor_origin = 'stripe'   -- optional client-side filter
ORDER BY total_amount_cents DESC;
```

Both views inherit tenant isolation from RLS on `syzm_recovery_queue` and `syzm_metrics` — no additional filtering logic needed in application code.
