/**
 * Tests for _shared/guards.ts — retry eligibility guards.
 *
 * Covers: fraud/lost_stolen blocked, max retries, Sunday blackout window,
 * and the happy path (allowed).
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkRetryGuards } from "../_shared/guards.ts";

// ─── Fraud / lost_stolen ──────────────────────────────────────────────────────

Deno.test("guards: fraud category is blocked", () => {
  const result = checkRetryGuards("fraud", 0);
  assertEquals(result.allowed, false);
  if (!result.allowed) {
    assertEquals(result.violation.reason, "fraud_or_stolen");
  }
});

Deno.test("guards: lost_stolen category is blocked", () => {
  const result = checkRetryGuards("lost_stolen", 0);
  assertEquals(result.allowed, false);
  if (!result.allowed) {
    assertEquals(result.violation.reason, "fraud_or_stolen");
  }
});

// ─── Max retries ──────────────────────────────────────────────────────────────

Deno.test("guards: retry_count=4 is blocked (Visa cap)", () => {
  const result = checkRetryGuards("insufficient_funds", 4);
  assertEquals(result.allowed, false);
  if (!result.allowed) {
    assertEquals(result.violation.reason, "max_retries_exceeded");
  }
});

Deno.test("guards: retry_count=3 is allowed", () => {
  const result = checkRetryGuards("insufficient_funds", 3);
  assertEquals(result.allowed, true);
});

// ─── Sunday blackout ─────────────────────────────────────────────────────────

Deno.test("guards: Sunday 06:00 UTC is blocked (blackout)", () => {
  // Sunday = day 0; 06:00 UTC falls inside 05:00–08:00 window
  const sunday0600 = new Date("2026-06-21T06:00:00Z"); // 2026-06-21 is a Sunday
  const result = checkRetryGuards("do_not_honor", 1, sunday0600);
  assertEquals(result.allowed, false);
  if (!result.allowed) {
    assertEquals(result.violation.reason, "bank_blackout_window");
  }
});

Deno.test("guards: Sunday 04:00 UTC is allowed (before blackout)", () => {
  const sunday0400 = new Date("2026-06-21T04:00:00Z");
  const result = checkRetryGuards("do_not_honor", 1, sunday0400);
  assertEquals(result.allowed, true);
});

Deno.test("guards: Sunday 08:00 UTC is allowed (after blackout)", () => {
  const sunday0800 = new Date("2026-06-21T08:00:00Z");
  const result = checkRetryGuards("do_not_honor", 1, sunday0800);
  assertEquals(result.allowed, true);
});

Deno.test("guards: Monday 06:00 UTC is allowed (not Sunday)", () => {
  const monday0600 = new Date("2026-06-22T06:00:00Z"); // Monday
  const result = checkRetryGuards("do_not_honor", 1, monday0600);
  assertEquals(result.allowed, true);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

Deno.test("guards: normal retry is allowed", () => {
  const tuesday = new Date("2026-06-23T10:00:00Z"); // Tuesday midday
  const result = checkRetryGuards("insufficient_funds", 1, tuesday);
  assertEquals(result.allowed, true);
});

Deno.test("guards: retry_count=0 with unknown category is allowed", () => {
  const result = checkRetryGuards("unknown", 0);
  assertEquals(result.allowed, true);
});
