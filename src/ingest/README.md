# Supabase Edge Functions (Ingest)

## Files

- `webhook.ts`: Processor webhook ingest endpoint
- `execute-retries.ts`: Queue execution loop endpoint called by `pg_cron`
- `_shared/`: Shared env/types/processor adapters

## Local Run (Deno)

```bash
deno run --allow-net --allow-env webhook.ts
deno run --allow-net --allow-env execute-retries.ts
```

For Supabase local dev, wire these into your `supabase/functions` project layout or symlink this directory.

