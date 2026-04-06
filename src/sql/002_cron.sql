-- Requires Supabase extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Execute due retries every minute
-- Replace URL and service token in production environments.
SELECT cron.schedule(
  'syzm-execution-loop',
  '* * * * *',
  $$
    SELECT net.http_post(
      url := 'https://[YOUR_EDGE_FUNCTION].supabase.co/functions/v1/execute-retries',
      headers := jsonb_build_object(
        'Authorization', 'Bearer [SERVICE_KEY]',
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
)
ON CONFLICT DO NOTHING;

