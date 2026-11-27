/**
 * One run of the retry worker (execute-retries.ts), kept in _shared so tests
 * can run it against a real database (execute-retries.ts starts a server when
 * imported).
 *
 * Each due row goes guard -> claim -> charge -> record:
 *   - claim: the row moves from 'pending' to 'retrying' with claimed_at, in one
 *     conditional update. A row another run has claimed is skipped, so two
 *     overlapping runs never charge the same row.
 *   - charge: the request carries an idempotency key made of the row id and
 *     the attempt number, so a repeat of the same attempt is answered by the
 *     processor from its record of the first one instead of charging again.
 *   - record: the outcome is written only while this run still holds the claim.
 * A run that dies after the claim leaves the row 'retrying'. After
 * CLAIM_STALE_AFTER_MS a later run takes it over and repeats the same attempt
 * with the same key, which settles a charge that went through but was never
 * recorded without charging again.
 */

import { getBrainScheduledAt } from "./brain.ts";
import { checkRetryGuards, describeViolation, VISA_MAX_RETRIES } from "./guards.ts";
import { type Logger, makeLogger } from "./http.ts";
import type { RetryAttempt, RetryResult } from "./processors.ts";
import type { QueueTable, RowFilter } from "./queue.ts";
import type { BrainScheduleRequest, DeclineCategory, ProcessorName } from "./types.ts";

export type QueueRow = {
  id: string;
  invoice_id: string;
  retry_count: number;
  original_amount_cents: number;
  region: string;
  processor_origin: ProcessorName;
  processor_history: ProcessorName[] | null;
  status: string;
  decline_category: DeclineCategory | null;
  /** Tokenized payment reference — see processors.ts for per-processor format. */
  payment_token: string | null;
  correlation_id: string | null;
  claimed_at: string | null;
  attempt_started_at: string | null;
};

export const QUEUE_ROW_COLUMNS: readonly string[] = [
  "id",
  "invoice_id",
  "retry_count",
  "original_amount_cents",
  "region",
  "processor_origin",
  "processor_history",
  "status",
  "decline_category",
  "payment_token",
  "correlation_id",
  "claimed_at",
  "attempt_started_at",
];

export const BATCH_LIMIT = 500;

/**
 * A claim older than this belongs to a run that died: an Edge Function run is
 * stopped long before 15 minutes.
 */
export const CLAIM_STALE_AFTER_MS = 15 * 60 * 1000;

/**
 * How long each processor answers a repeated idempotency key from its record
 * of the first request. Stripe removes keys once they are at least 24 hours
 * old; Adyen keeps them at least 7 days. Braintree is left out: this adapter
 * sends the key as a header, which its GraphQL API does not document (it
 * takes an apiRequestKey input field instead). A stale claim is repeated only
 * inside this window, counted from the attempt's first claim; otherwise the
 * first request may have charged and a repeat could charge again, so the row
 * ends in 'error' for reconciliation.
 */
export const IDEMPOTENCY_KEY_LIFETIME_MS: Readonly<Partial<Record<ProcessorName, number>>> = {
  stripe: 23 * 60 * 60 * 1000,
  adyen: 23 * 60 * 60 * 1000,
};

/** Same row and same attempt number give the same key; the next attempt gets a new one. */
export function attemptIdempotencyKey(row: Pick<QueueRow, "id" | "retry_count">): string {
  return `syzm-${row.id}-attempt-${row.retry_count + 1}`;
}

export type RetryWorkerDeps = {
  table: QueueTable;
  charge: (processor: ProcessorName, attempt: RetryAttempt, correlationId: string) => Promise<RetryResult>;
  /** Next attempt time (ISO) for a declined retry. */
  schedule: (request: BrainScheduleRequest, log: Logger) => Promise<string>;
  correlationId: string;
  now?: () => Date;
};

export type BatchSummary = {
  processed: number;
  recovered: number;
  rescheduled: number;
  exhausted: number;
  guarded: number;
  errored: number;
  write_failed: number;
  /** Claimed by another run between the select and this run's claim. */
  skipped: number;
};

export type BatchResult = { ok: true; summary: BatchSummary } | { ok: false; error: "due_fetch_error" };

export async function runRetryBatch(deps: RetryWorkerDeps): Promise<BatchResult> {
  const now = deps.now ?? (() => new Date());
  const log = makeLogger(deps.correlationId);
  const { table } = deps;

  const runStart = now();
  const nowIso = runStart.toISOString();
  const staleBeforeIso = new Date(runStart.getTime() - CLAIM_STALE_AFTER_MS).toISOString();

  const stale = await table.select(
    QUEUE_ROW_COLUMNS,
    { eq: { status: "retrying" }, lt: { claimed_at: staleBeforeIso } },
    BATCH_LIMIT,
  );
  const due = stale.error ? stale : await table.select(
    QUEUE_ROW_COLUMNS,
    { eq: { status: "pending" }, lt: { retry_count: VISA_MAX_RETRIES }, lte: { scheduled_at: nowIso } },
    BATCH_LIMIT,
  );
  const fetchError = stale.error ?? due.error;
  if (fetchError) {
    log("error", "due_fetch_error", { message: fetchError.message });
    return { ok: false, error: "due_fetch_error" };
  }

  const rows = [...stale.rows, ...due.rows].slice(0, BATCH_LIMIT) as unknown as QueueRow[];
  const summary: BatchSummary = {
    processed: rows.length,
    recovered: 0,
    rescheduled: 0,
    exhausted: 0,
    guarded: 0,
    errored: 0,
    write_failed: 0,
    skipped: 0,
  };

  for (const row of rows) {
    const rowCorrelation = row.correlation_id ?? deps.correlationId;
    const rowLog = makeLogger(rowCorrelation);
    // Only a row that still looks exactly as it was read may be written.
    const asRead: RowFilter = {
      eq: {
        id: row.id,
        status: row.status,
        retry_count: row.retry_count,
        ...(row.status === "retrying" && row.claimed_at ? { claimed_at: row.claimed_at } : {}),
      },
    };
    const finish = async (patch: Record<string, unknown>): Promise<void> => {
      const outcome = await writeRow(table, row, { ...patch, ...RELEASE_CLAIM }, asRead, rowLog);
      if (outcome !== "written") summary.write_failed += 1;
    };

    const declineCategory: DeclineCategory = row.decline_category ?? "unknown";
    const guardResult = checkRetryGuards(declineCategory, row.retry_count, now());

    if (!guardResult.allowed) {
      summary.guarded += 1;
      const reason = describeViolation(guardResult.violation, rowCorrelation);
      rowLog("warn", "retry_guard_blocked", {
        invoice_id: row.invoice_id,
        violation: guardResult.violation.reason,
        reason,
      });
      // The blackout only defers: the row is left as it is and the first run
      // after the window picks it up.
      if (guardResult.violation.reason !== "bank_blackout_window") {
        await finish({ status: "blocked", exhausted_at: nowIso, schedule_reason: reason });
      }
      continue;
    }

    if (!row.payment_token) {
      rowLog("error", "missing_payment_token", { invoice_id: row.invoice_id });
      await finish({ status: "error", schedule_reason: "missing_payment_token" });
      continue;
    }

    const nextProcessor = pickNextProcessor(row.processor_origin, row.processor_history ?? []);

    const takeover = row.status === "retrying";
    if (takeover) {
      const attemptAgeMs = runStart.getTime() - Date.parse(row.attempt_started_at ?? "");
      const keyLifetimeMs = IDEMPOTENCY_KEY_LIFETIME_MS[nextProcessor];
      if (keyLifetimeMs === undefined || !(attemptAgeMs < keyLifetimeMs)) {
        rowLog("error", "stale_claim_not_repeatable", {
          invoice_id: row.invoice_id,
          processor: nextProcessor,
          attempt_started_at: row.attempt_started_at,
        });
        await finish({ status: "error", schedule_reason: `stale_claim_not_repeatable:${nextProcessor}` });
        continue;
      }
      rowLog("warn", "stale_claim_taken_over", {
        invoice_id: row.invoice_id,
        processor: nextProcessor,
        claimed_at: row.claimed_at,
      });
    }

    // ── Claim ───────────────────────────────────────────────────────────────
    const claimedAt = now().toISOString();
    const claim = await table.update(
      takeover
        ? { claimed_at: claimedAt }
        : { status: "retrying", claimed_at: claimedAt, attempt_started_at: claimedAt },
      asRead,
    );
    if (claim.error) {
      summary.write_failed += 1;
      rowLog("error", "queue_claim_failed", {
        row_id: row.id,
        invoice_id: row.invoice_id,
        message: claim.error.message,
        code: claim.error.code,
      });
      continue;
    }
    if (claim.count === 0) {
      summary.skipped += 1;
      rowLog("info", "queue_row_taken", { row_id: row.id, invoice_id: row.invoice_id });
      continue;
    }
    const claimed: RowFilter = { eq: { id: row.id, status: "retrying", claimed_at: claimedAt } };

    // ── Charge ──────────────────────────────────────────────────────────────
    let result: RetryResult;
    try {
      result = await deps.charge(
        nextProcessor,
        {
          invoiceId: row.invoice_id,
          amountCents: row.original_amount_cents,
          paymentToken: row.payment_token,
          idempotencyKey: attemptIdempotencyKey(row),
        },
        rowCorrelation,
      );
    } catch (err) {
      // A network error has no known outcome: the charge may have gone
      // through. The row stays claimed; once the claim is stale a later run
      // repeats the attempt with the same key.
      summary.errored += 1;
      rowLog("error", "retry_attempt_error", {
        invoice_id: row.invoice_id,
        processor: nextProcessor,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    // ── Record ──────────────────────────────────────────────────────────────
    const history = [...(row.processor_history ?? []), nextProcessor];
    const newRetryCount = row.retry_count + 1;
    const record = async (patch: Record<string, unknown>): Promise<void> => {
      // A failed write leaves the row claimed: the stale-claim takeover repeats
      // the attempt with the same key and records the processor's answer.
      const outcome = await writeRow(table, row, { ...patch, ...RELEASE_CLAIM }, claimed, rowLog);
      if (outcome !== "written") summary.write_failed += 1;
    };

    if (result.ok) {
      summary.recovered += 1;
      rowLog("info", "retry_recovered", {
        invoice_id: row.invoice_id,
        processor: nextProcessor,
        reference: result.processorReference,
      });
      await record({
        status: "recovered",
        processor_history: history,
        recovered_at: nowIso,
        processor_reference: result.processorReference,
        retry_count: newRetryCount,
      });
      continue;
    }

    if (newRetryCount >= VISA_MAX_RETRIES) {
      summary.exhausted += 1;
      rowLog("info", "retry_exhausted", {
        invoice_id: row.invoice_id,
        retry_count: newRetryCount,
        decline_category: result.declineCategory,
      });
      await record({
        status: "exhausted",
        retry_count: newRetryCount,
        processor_history: history,
        exhausted_at: nowIso,
        decline_category: result.declineCategory,
        last_decline_code: result.rawDeclineCode ?? null,
      });
      continue;
    }

    // ── Brain-driven reschedule ──────────────────────────────────────────────
    summary.rescheduled += 1;
    const nextSchedule = await deps.schedule(
      {
        invoice_id: row.invoice_id,
        decline_code: result.rawDeclineCode ?? null,
        region: row.region,
        retry_count: newRetryCount,
        original_amount_cents: row.original_amount_cents,
        processor_origin: row.processor_origin,
        processor_history: history,
      },
      rowLog,
    );

    rowLog("info", "retry_rescheduled", {
      invoice_id: row.invoice_id,
      retry_count: newRetryCount,
      scheduled_at: nextSchedule,
      decline_category: result.declineCategory,
    });

    await record({
      status: "pending",
      retry_count: newRetryCount,
      processor_history: history,
      scheduled_at: nextSchedule,
      decline_category: result.declineCategory,
      last_decline_code: result.rawDeclineCode ?? null,
    });
  }

  log("info", "batch_complete", { ...summary });
  return { ok: true, summary };
}

/** The Brain client as the worker uses it: a failed call falls back to a fixed delay. */
export function brainSchedule(brainUrl: string, brainApiKey: string): RetryWorkerDeps["schedule"] {
  return (request, log) => getBrainScheduledAt(request, brainUrl, brainApiKey, log);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RELEASE_CLAIM = { claimed_at: null, attempt_started_at: null };

/**
 * Write a queue-row update guarded by `filter`. A failed write, or one that
 * finds the row changed by another run, is logged with the patch (which
 * carries the processor reference for reconciliation).
 */
async function writeRow(
  table: QueueTable,
  row: QueueRow,
  patch: Record<string, unknown>,
  filter: RowFilter,
  log: Logger,
): Promise<"written" | "failed" | "row_changed"> {
  const { count, error } = await table.update(patch, filter);
  if (error) {
    log("error", "queue_update_failed", {
      row_id: row.id,
      invoice_id: row.invoice_id,
      patch,
      message: error.message,
      code: error.code,
    });
    return "failed";
  }
  if (count === 0) {
    log("error", "queue_row_changed", { row_id: row.id, invoice_id: row.invoice_id, patch });
    return "row_changed";
  }
  return "written";
}

export function pickNextProcessor(origin: ProcessorName, history: ProcessorName[]): ProcessorName {
  const route: ProcessorName[] = [origin, "adyen", "braintree", "stripe"];
  for (const processor of route) {
    if (!history.includes(processor)) {
      return processor;
    }
  }
  return origin;
}
