# SQL Migrations

Execution order:

1. `001_init.sql`
2. `002_cron.sql`

These scripts create the recovery queue, metrics tables, and the `pg_cron` execution loop.

