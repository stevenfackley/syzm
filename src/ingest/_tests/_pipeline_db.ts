/**
 * A real Postgres for the pipeline tests: PGlite (Postgres compiled to
 * WebAssembly, in process) with the committed migrations from src/sql applied,
 * plus a QueueTable over it that issues the same select / update / insert the
 * supabase-js table gateway (_shared/queue.ts) sends through PostgREST.
 *
 * Applied in order: 001, 003, 004, 006, 007, 008.
 * Left out: 002 and 005. They schedule the pg_cron job that calls the worker
 *   over HTTP (pg_cron, pg_net and Vault); the tests start worker runs directly.
 * Adjusted: 001's `CREATE EXTENSION pgcrypto` is dropped, because PGlite loads
 *   extensions from disk and CI runs `deno test --allow-env --allow-net` (no
 *   file reads); gen_random_uuid() is built into PostgreSQL 13+. 004 gets a
 *   stub auth.jwt(), which Supabase provides.
 *
 * The migrations and the PGlite binaries are module imports (deno.json
 * "unstable": ["raw-imports"]) for the same reason: no file reads at run time.
 * The tests connect as the superuser, so RLS is bypassed, as it is for the
 * service-role key the webhook and the worker use.
 */

import { PGlite } from "npm:@electric-sql/pglite@0.5.16";
import pgliteWasm from "npm:@electric-sql/pglite@0.5.16/pglite.wasm" with { type: "bytes" };
import initdbWasm from "npm:@electric-sql/pglite@0.5.16/initdb.wasm" with { type: "bytes" };
import pgliteData from "npm:@electric-sql/pglite@0.5.16/pglite.data" with { type: "bytes" };

import m001 from "../../sql/001_init.sql" with { type: "text" };
import m003 from "../../sql/003_idempotency.sql" with { type: "text" };
import m004 from "../../sql/004_multitenancy_rls.sql" with { type: "text" };
import m006 from "../../sql/006_dashboard_views.sql" with { type: "text" };
import m007 from "../../sql/007_reconcile_ingest_columns.sql" with { type: "text" };
import m008 from "../../sql/008_retry_pipeline_states.sql" with { type: "text" };

import { QUEUE_TABLE, type DbError, type QueueTable, type RowFilter } from "../_shared/queue.ts";

const PGCRYPTO = "CREATE EXTENSION IF NOT EXISTS pgcrypto;";

const SUPABASE_STUB = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT NULL::jsonb $$;
`;

export const MIGRATIONS: ReadonlyArray<[string, string]> = [
  ["001_init.sql", m001],
  ["003_idempotency.sql", m003],
  ["004_multitenancy_rls.sql", m004],
  ["006_dashboard_views.sql", m006],
  ["007_reconcile_ingest_columns.sql", m007],
  ["008_retry_pipeline_states.sql", m008],
];

let compiled: Promise<[WebAssembly.Module, WebAssembly.Module]> | undefined;

export type PipelineDb = {
  db: PGlite;
  table: QueueTable;
  rows(): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
};

/** A fresh database with the migrations applied (through `upTo`, default all). */
export async function openPipelineDb(upTo = MIGRATIONS.length): Promise<PipelineDb> {
  compiled ??= Promise.all([WebAssembly.compile(pgliteWasm), WebAssembly.compile(initdbWasm)]);
  const [pgliteWasmModule, initdbWasmModule] = await compiled;
  const db = await PGlite.create({ pgliteWasmModule, initdbWasmModule, fsBundle: new Blob([pgliteData]) });

  await db.exec(SUPABASE_STUB);
  for (const [name, sql] of MIGRATIONS.slice(0, upTo)) {
    await db.exec(applicable(name, sql));
  }

  return {
    db,
    table: pgliteQueueTable(db),
    async rows() {
      const r = await db.query<{ row: Record<string, unknown> }>(
        `SELECT to_jsonb(q) AS row FROM ${QUEUE_TABLE} q ORDER BY created_at, invoice_id`,
      );
      return r.rows.map((x) => x.row);
    },
    close: () => db.close(),
  };
}

function applicable(name: string, sql: string): string {
  if (name !== "001_init.sql") return sql;
  if (sql.split(PGCRYPTO).length !== 2) throw new Error(`001_init.sql no longer has exactly one "${PGCRYPTO}"`);
  return sql.replace(PGCRYPTO, "");
}

// ─── QueueTable over PGlite ──────────────────────────────────────────────────
//
// Values travel as JSON and are typed by json_populate_record against the
// table's own row type, as PostgREST types its JSON body; filters compare a
// column with the same column of a populated record.

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`not a column name: ${name}`);
  return `"${name}"`;
}

function populated(param: string): string {
  return `json_populate_record(NULL::${QUEUE_TABLE}, ${param}::json)`;
}

function where(filter: RowFilter, firstParam: number): { sql: string; params: string[] } {
  const parts: string[] = [];
  const params: string[] = [];
  const operators: Array<[keyof RowFilter, string]> = [["eq", "="], ["lt", "<"], ["lte", "<="]];
  for (const [key, operator] of operators) {
    const values = filter[key];
    if (!values || Object.keys(values).length === 0) continue;
    const param = `$${firstParam + params.length}`;
    params.push(JSON.stringify(values));
    for (const column of Object.keys(values)) {
      parts.push(`q.${ident(column)} ${operator} (${populated(param)}).${ident(column)}`);
    }
  }
  return { sql: parts.length > 0 ? parts.join(" AND ") : "TRUE", params };
}

function dbError(err: unknown): DbError {
  const e = err as { message?: string; code?: string };
  return { message: e.message ?? String(err), code: e.code };
}

export function pgliteQueueTable(db: PGlite): QueueTable {
  return {
    async select(columns, filter, limit) {
      const w = where(filter, 1);
      try {
        const r = await db.query<{ row: Record<string, unknown> }>(
          `SELECT to_jsonb(s) AS row FROM (
             SELECT ${columns.map(ident).join(", ")} FROM ${QUEUE_TABLE} q WHERE ${w.sql} LIMIT ${Number(limit)}
           ) s`,
          w.params,
        );
        return { rows: r.rows.map((x) => x.row), error: null };
      } catch (err) {
        return { rows: [], error: dbError(err) };
      }
    },
    async update(patch, filter) {
      const columns = Object.keys(patch).map(ident).join(", ");
      const w = where(filter, 2);
      try {
        const r = await db.query<{ n: number }>(
          `WITH changed AS (
             UPDATE ${QUEUE_TABLE} q SET (${columns}) = (SELECT ${columns} FROM ${populated("$1")})
             WHERE ${w.sql} RETURNING 1
           ) SELECT count(*)::int AS n FROM changed`,
          [JSON.stringify(patch), ...w.params],
        );
        return { count: r.rows[0].n, error: null };
      } catch (err) {
        return { count: 0, error: dbError(err) };
      }
    },
    async insert(row) {
      const columns = Object.keys(row).map(ident).join(", ");
      try {
        await db.query(
          `INSERT INTO ${QUEUE_TABLE} (${columns}) SELECT ${columns} FROM ${populated("$1")}`,
          [JSON.stringify(row)],
        );
        return { error: null };
      } catch (err) {
        return { error: dbError(err) };
      }
    },
  };
}
