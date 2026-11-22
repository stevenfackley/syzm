/**
 * Tests for _shared/brain.ts — the Brain /v1/schedule client.
 *
 * getBrainScheduledAt is the retry worker's call (execute-retries.ts): it falls
 * back to 90 minutes on any failure. requestBrainSchedule is the webhook's call
 * (webhook.ts): it throws, which fails the ingest with a 500.
 *
 * The clock is passed in, so no test here reads the real time.
 */

import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getBrainScheduledAt, requestBrainSchedule } from "../_shared/brain.ts";
import type { LogLevel } from "../_shared/http.ts";
import type { BrainScheduleRequest, BrainScheduleResponse, NormalizedDecline } from "../_shared/types.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

type LogLine = { level: LogLevel; event: string; extra?: Record<string, unknown> };

function captureLog() {
  const lines: LogLine[] = [];
  const log = (level: LogLevel, event: string, extra?: Record<string, unknown>) => {
    lines.push({ level, event, extra });
  };
  return { lines, log };
}

const NOW_MS = Date.parse("2026-06-23T10:00:00Z");
const fixedNow = () => NOW_MS;
const FALLBACK = "2026-06-23T11:30:00.000Z"; // NOW_MS + 90 minutes

function brainOk(body: Partial<BrainScheduleResponse>): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
}

function request(overrides: Partial<BrainScheduleRequest> = {}): BrainScheduleRequest {
  return {
    invoice_id: "inv_1",
    decline_code: "insufficient_funds",
    region: "US",
    retry_count: 1,
    original_amount_cents: 1000,
    processor_origin: "stripe",
    processor_history: ["stripe"],
    ...overrides,
  };
}

// ─── getBrainScheduledAt (retry worker) ──────────────────────────────────────

Deno.test("Brain reschedule: sends X-Syzm-Key header", async () => {
  const captured: Request[] = [];

  const mockFetch: typeof fetch = async (input, init) => {
    captured.push(new Request(typeof input === "string" ? input : input.toString(), init));
    return new Response(
      JSON.stringify({
        invoice_id: "inv_1",
        scheduled_at_utc: "2026-06-22T10:00:00Z",
        reason: "ml_predicted",
        strategy_version: "v2",
        eligible_processors: ["stripe"],
      } as BrainScheduleResponse),
      { status: 200 },
    );
  };

  await getBrainScheduledAt(request(), "https://brain.internal", "test-brain-key", captureLog().log, mockFetch, fixedNow);

  assertEquals(captured.length, 1);
  assertEquals(captured[0].method, "POST");
  assertEquals(captured[0].headers.get("X-Syzm-Key"), "test-brain-key");
  assertEquals(captured[0].headers.get("Content-Type"), "application/json");
});

Deno.test("Brain reschedule: uses Brain-returned scheduled_at and logs it", async () => {
  const brainScheduledAt = "2026-06-23T14:30:00Z";
  const { lines, log } = captureLog();

  const scheduledAt = await getBrainScheduledAt(
    request({ invoice_id: "inv_2" }),
    "https://brain.internal",
    "key",
    log,
    brainOk({ invoice_id: "inv_2", scheduled_at_utc: brainScheduledAt, reason: "optimal_window" }),
    fixedNow,
  );

  assertEquals(scheduledAt, brainScheduledAt);
  assertEquals(lines, [{
    level: "info",
    event: "brain_schedule_ok",
    extra: { invoice_id: "inv_2", scheduled_at: brainScheduledAt, reason: "optimal_window" },
  }]);
});

Deno.test("Brain reschedule: sends correct payload shape (retry_count+1 incremented by caller)", async () => {
  const capturedBodies: unknown[] = [];

  const mockFetch: typeof fetch = async (_input, init) => {
    capturedBodies.push(JSON.parse((init as RequestInit)?.body as string));
    return new Response(
      JSON.stringify({
        invoice_id: "inv_3",
        scheduled_at_utc: "2026-06-24T09:00:00Z",
        reason: "ml",
        strategy_version: "v2",
        eligible_processors: ["stripe"],
      }),
      { status: 200 },
    );
  };

  await getBrainScheduledAt(
    {
      invoice_id: "inv_3",
      decline_code: "do_not_honor",
      region: "GB",
      retry_count: 2, // already incremented by caller
      original_amount_cents: 2000,
      processor_origin: "stripe",
      processor_history: ["stripe", "adyen"],
    },
    "https://brain.internal",
    "k",
    captureLog().log,
    mockFetch,
    fixedNow,
  );

  // Field names must match the Brain's ScheduleRequest (src/brain/app/schemas.py):
  // pydantic ignores unknown keys, so a misnamed field silently scores as its default.
  const body = capturedBodies[0] as Record<string, unknown>;
  assertEquals(body.invoice_id, "inv_3");
  assertEquals(body.retry_count, 2);
  assertEquals(body.decline_code, "do_not_honor");
  assertEquals(body.original_amount_cents, 2000);
  assertEquals(body.region, "GB");
  assertEquals(body.processor_origin, "stripe");
  assertEquals((body.processor_history as string[]).length, 2);
  assertEquals("amount_cents" in body, false);
  assertEquals("last_decline_category" in body, false);
});

Deno.test("Brain reschedule: falls back to 90min on Brain HTTP error", async () => {
  const mockFetch: typeof fetch = async () => new Response("Service Unavailable", { status: 503 });
  const { lines, log } = captureLog();

  const scheduledAt = await getBrainScheduledAt(
    request({ invoice_id: "inv_4" }),
    "https://brain.internal",
    "k",
    log,
    mockFetch,
    fixedNow,
  );

  assertEquals(scheduledAt, FALLBACK);
  assertEquals(lines, [{
    level: "error",
    event: "brain_schedule_fallback",
    extra: { invoice_id: "inv_4", brain_error: "brain_http_503", fallback_minutes: 90 },
  }]);
});

Deno.test("Brain reschedule: falls back to 90min on network error", async () => {
  const mockFetch: typeof fetch = async () => {
    throw new Error("network_unreachable");
  };
  const { lines, log } = captureLog();

  const scheduledAt = await getBrainScheduledAt(request(), "https://brain.internal", "k", log, mockFetch, fixedNow);

  assertEquals(scheduledAt, FALLBACK);
  assertEquals(lines[0].extra?.brain_error, "network_unreachable");
});

Deno.test("Brain reschedule: falls back when the answer has no scheduled_at_utc", async () => {
  const { lines, log } = captureLog();

  const scheduledAt = await getBrainScheduledAt(
    request(),
    "https://brain.internal",
    "k",
    log,
    brainOk({ invoice_id: "inv_1", reason: "r" }),
    fixedNow,
  );

  assertEquals(scheduledAt, FALLBACK);
  assertEquals(lines.map((l) => l.event), ["brain_schedule_fallback"]);
  assertEquals(lines[0].extra?.brain_error, "brain_missing_scheduled_at");
});

Deno.test("Brain reschedule: falls back when the body is not JSON or is null", async () => {
  for (const text of ["<html>bad gateway</html>", "null"]) {
    const { lines, log } = captureLog();
    const mockFetch: typeof fetch = async () => new Response(text, { status: 200 });

    const scheduledAt = await getBrainScheduledAt(request(), "https://brain.internal", "k", log, mockFetch, fixedNow);

    assertEquals(scheduledAt, FALLBACK, text);
    assertEquals(lines.map((l) => l.event), ["brain_schedule_fallback"], text);
  }
});

Deno.test("Brain reschedule: the fallback clock is read after the Brain call fails", async () => {
  // A slow failing call must not schedule from the moment the call started.
  let clockMs = NOW_MS;
  const mockFetch: typeof fetch = async () => {
    clockMs += 30_000; // the Brain took 30 s to fail
    return new Response("timeout", { status: 504 });
  };

  const scheduledAt = await getBrainScheduledAt(
    request(),
    "https://brain.internal",
    "k",
    captureLog().log,
    mockFetch,
    () => clockMs,
  );

  assertEquals(scheduledAt, "2026-06-23T11:30:30.000Z");
});

Deno.test("Brain reschedule: sends POST to correct URL", async () => {
  const capturedUrls: string[] = [];

  const mockFetch: typeof fetch = async (input) => {
    capturedUrls.push(typeof input === "string" ? input : (input as Request).url);
    return new Response(
      JSON.stringify({ invoice_id: "x", scheduled_at_utc: "2026-06-22T00:00:00Z", reason: "r", strategy_version: "v1", eligible_processors: [] }),
      { status: 200 },
    );
  };

  await getBrainScheduledAt(
    request({ invoice_id: "x", decline_code: null, retry_count: 0, original_amount_cents: 0, processor_history: [] }),
    "https://brain.syzm.internal",
    "k",
    captureLog().log,
    mockFetch,
    fixedNow,
  );

  assertEquals(capturedUrls[0], "https://brain.syzm.internal/v1/schedule");
});

// ─── requestBrainSchedule (webhook) ──────────────────────────────────────────

const normalized: NormalizedDecline = {
  invoice_id: "in_42",
  processor_event_id: "evt_42",
  decline_code: "insufficient_funds",
  decline_category: "insufficient_funds",
  bank_bin: "42424242",
  region: "US",
  retry_count: 0,
  original_amount_cents: 1999,
  processor_origin: "stripe",
  processor_history: ["stripe"],
  soft_decline: true,
};

Deno.test("Webhook schedule: sends only the Brain's request fields, with the key, to /v1/schedule", async () => {
  const captured: Request[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    captured.push(new Request(typeof input === "string" ? input : input.toString(), init));
    return new Response(JSON.stringify({ scheduled_at_utc: "2026-06-23T12:00:00Z" }), { status: 200 });
  };

  await requestBrainSchedule(normalized, "https://brain.internal", "wh-key", captureLog().log, mockFetch);

  assertEquals(captured.length, 1);
  assertEquals(captured[0].url, "https://brain.internal/v1/schedule");
  assertEquals(captured[0].method, "POST");
  assertEquals(captured[0].headers.get("X-Syzm-Key"), "wh-key");
  assertEquals(captured[0].headers.get("Content-Type"), "application/json");
  // bank_bin, decline_category, processor_event_id and soft_decline stay out.
  assertEquals(await captured[0].json(), {
    invoice_id: "in_42",
    decline_code: "insufficient_funds",
    region: "US",
    retry_count: 0,
    original_amount_cents: 1999,
    processor_origin: "stripe",
    processor_history: ["stripe"],
  });
});

Deno.test("Webhook schedule: returns the Brain's answer as is, even without scheduled_at_utc", async () => {
  const { lines, log } = captureLog();

  const answer = await requestBrainSchedule(
    normalized,
    "https://brain.internal",
    "k",
    log,
    brainOk({ invoice_id: "in_42", reason: "r", strategy_version: "v2" }),
  );

  assertEquals(answer, { invoice_id: "in_42", reason: "r", strategy_version: "v2" } as unknown as BrainScheduleResponse);
  assertEquals(lines, []);
});

Deno.test("Webhook schedule: a non-2xx answer is logged and thrown", async () => {
  const { lines, log } = captureLog();
  const mockFetch: typeof fetch = async () => new Response("Service Unavailable", { status: 503 });

  await assertRejects(
    () => requestBrainSchedule(normalized, "https://brain.internal", "k", log, mockFetch),
    Error,
    "brain_schedule_failed_503",
  );
  assertEquals(lines, [{ level: "error", event: "brain_schedule_failed", extra: { status: 503 } }]);
});

Deno.test("Webhook schedule: a network error or a non-JSON body is thrown without a log line", async () => {
  const { lines, log } = captureLog();
  const down: typeof fetch = async () => {
    throw new TypeError("network_unreachable");
  };
  const html: typeof fetch = async () => new Response("<html>oops</html>", { status: 200 });

  await assertRejects(
    () => requestBrainSchedule(normalized, "https://brain.internal", "k", log, down),
    TypeError,
    "network_unreachable",
  );
  await assertRejects(() => requestBrainSchedule(normalized, "https://brain.internal", "k", log, html), SyntaxError);
  assertEquals(lines, []);
});
