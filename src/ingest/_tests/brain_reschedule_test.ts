/**
 * Tests for Brain-driven reschedule behavior in execute-retries.ts.
 *
 * Since execute-retries.ts is a serve() entry point, we test the Brain call
 * logic by extracting and testing the getBrainScheduledAt logic indirectly
 * via a thin test harness that mirrors it.
 *
 * Tests: Brain called with X-Syzm-Key, Brain response used, fallback on error.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { BrainScheduleRequest, BrainScheduleResponse } from "../_shared/types.ts";

// ─── Mirror of getBrainScheduledAt (tested directly) ─────────────────────────
// We can't import from execute-retries.ts (it calls serve() at module level),
// so we replicate the identical function here to test the logic.

async function getBrainScheduledAt(
  request: BrainScheduleRequest,
  brainUrl: string,
  brainApiKey: string,
  fetchImpl: typeof fetch,
): Promise<{ scheduledAt: string; usedFallback: boolean }> {
  try {
    const resp = await fetchImpl(`${brainUrl}/v1/schedule`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Syzm-Key": brainApiKey,
      },
      body: JSON.stringify(request),
    });

    if (!resp.ok) throw new Error(`brain_http_${resp.status}`);

    const body = (await resp.json()) as BrainScheduleResponse;
    if (!body.scheduled_at_utc) throw new Error("brain_missing_scheduled_at");

    return { scheduledAt: body.scheduled_at_utc, usedFallback: false };
  } catch {
    return {
      scheduledAt: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
      usedFallback: true,
    };
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

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

  await getBrainScheduledAt(
    { invoice_id: "inv_1", amount_cents: 1000, retry_count: 1, last_decline_category: "insufficient_funds", processor_history: ["stripe"] },
    "https://brain.internal",
    "test-brain-key",
    mockFetch,
  );

  assertEquals(captured.length, 1);
  assertEquals(captured[0].headers.get("X-Syzm-Key"), "test-brain-key");
});

Deno.test("Brain reschedule: uses Brain-returned scheduled_at", async () => {
  const brainScheduledAt = "2026-06-23T14:30:00Z";

  const mockFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        invoice_id: "inv_2",
        scheduled_at_utc: brainScheduledAt,
        reason: "optimal_window",
        strategy_version: "v2",
        eligible_processors: ["adyen"],
      } as BrainScheduleResponse),
      { status: 200 },
    );

  const { scheduledAt, usedFallback } = await getBrainScheduledAt(
    { invoice_id: "inv_2", amount_cents: 5000, retry_count: 2, last_decline_category: "transient", processor_history: ["stripe", "adyen"] },
    "https://brain.internal",
    "key",
    mockFetch,
  );

  assertEquals(scheduledAt, brainScheduledAt);
  assertEquals(usedFallback, false);
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
      amount_cents: 2000,
      retry_count: 2, // already incremented by caller
      last_decline_category: "do_not_honor",
      processor_history: ["stripe", "adyen"],
    },
    "https://brain.internal",
    "k",
    mockFetch,
  );

  const body = capturedBodies[0] as Record<string, unknown>;
  assertEquals(body.invoice_id, "inv_3");
  assertEquals(body.retry_count, 2);
  assertEquals(body.last_decline_category, "do_not_honor");
  assertEquals((body.processor_history as string[]).length, 2);
});

Deno.test("Brain reschedule: falls back to 90min on Brain HTTP error", async () => {
  const mockFetch: typeof fetch = async () =>
    new Response("Service Unavailable", { status: 503 });

  const before = Date.now();
  const { scheduledAt, usedFallback } = await getBrainScheduledAt(
    { invoice_id: "inv_4", amount_cents: 100, retry_count: 1, last_decline_category: "transient", processor_history: [] },
    "https://brain.internal",
    "k",
    mockFetch,
  );

  assertEquals(usedFallback, true);

  const scheduledMs = new Date(scheduledAt).getTime();
  const expectedMs = before + 90 * 60 * 1000;
  // Allow 5 second slop for test execution time
  assertEquals(scheduledMs >= expectedMs - 1000 && scheduledMs <= expectedMs + 5000, true);
});

Deno.test("Brain reschedule: falls back to 90min on network error", async () => {
  const mockFetch: typeof fetch = async () => {
    throw new Error("network_unreachable");
  };

  const { usedFallback } = await getBrainScheduledAt(
    { invoice_id: "inv_5", amount_cents: 100, retry_count: 1, last_decline_category: "transient", processor_history: [] },
    "https://brain.internal",
    "k",
    mockFetch,
  );

  assertEquals(usedFallback, true);
});

Deno.test("Brain reschedule: sends POST to correct URL", async () => {
  const capturedUrls: string[] = [];

  const mockFetch: typeof fetch = async (input, init) => {
    capturedUrls.push(typeof input === "string" ? input : (input as Request).url);
    return new Response(
      JSON.stringify({ invoice_id: "x", scheduled_at_utc: "2026-06-22T00:00:00Z", reason: "r", strategy_version: "v1", eligible_processors: [] }),
      { status: 200 },
    );
  };

  await getBrainScheduledAt(
    { invoice_id: "x", amount_cents: 0, retry_count: 0, last_decline_category: "unknown", processor_history: [] },
    "https://brain.syzm.internal",
    "k",
    mockFetch,
  );

  assertEquals(capturedUrls[0], "https://brain.syzm.internal/v1/schedule");
});
