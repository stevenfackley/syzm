/**
 * syzm_recovery_queue access for the webhook and the retry worker.
 *
 * Both reach the table only through QueueTable: a select, update or insert
 * with equality and range filters, which is the shape of one PostgREST call.
 * Production wires supabaseQueueTable; the pipeline tests run the same calls
 * against the committed migrations in an embedded Postgres.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const QUEUE_TABLE = "syzm_recovery_queue";

export type DbError = { message: string; code?: string };

/** Column filters, ANDed: column = value, column < value, column <= value. */
export type RowFilter = {
  eq?: Record<string, string | number>;
  lt?: Record<string, string | number>;
  lte?: Record<string, string | number>;
};

export type QueueTable = {
  select(
    columns: readonly string[],
    filter: RowFilter,
    limit: number,
  ): Promise<{ rows: Record<string, unknown>[]; error: DbError | null }>;
  /** `count` is the number of rows changed: 0 when no row matched the filter. */
  update(patch: Record<string, unknown>, filter: RowFilter): Promise<{ count: number; error: DbError | null }>;
  insert(row: Record<string, unknown>): Promise<{ error: DbError | null }>;
};

/** Postgres unique_violation; PostgREST passes the SQLSTATE through as the error code. */
export const UNIQUE_VIOLATION = "23505";

// The query builders are generic over the database schema, which this project
// does not generate types for.
// deno-lint-ignore no-explicit-any
type Builder = any;

function applyFilter(query: Builder, filter: RowFilter): Builder {
  let q = query;
  for (const [column, value] of Object.entries(filter.eq ?? {})) q = q.eq(column, value);
  for (const [column, value] of Object.entries(filter.lt ?? {})) q = q.lt(column, value);
  for (const [column, value] of Object.entries(filter.lte ?? {})) q = q.lte(column, value);
  return q;
}

function toDbError(error: { message: string; code?: string } | null): DbError | null {
  return error ? { message: error.message, code: error.code } : null;
}

export function supabaseQueueTable(client: SupabaseClient): QueueTable {
  return {
    async select(columns, filter, limit) {
      const query = applyFilter(client.from(QUEUE_TABLE).select(columns.join(", ")), filter);
      const { data, error } = await query.limit(limit);
      return { rows: (data ?? []) as Record<string, unknown>[], error: toDbError(error) };
    },
    async update(patch, filter) {
      const query = applyFilter(client.from(QUEUE_TABLE).update(patch), filter);
      const { data, error } = await query.select("id");
      return { count: (data ?? []).length, error: toDbError(error) };
    },
    async insert(row) {
      const { error } = await client.from(QUEUE_TABLE).insert(row);
      return { error: toDbError(error) };
    },
  };
}
