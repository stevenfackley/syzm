/**
 * Tests for _shared/http.ts — the logger and JSON response helper both entry
 * points use.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { json, makeLogger } from "../_shared/http.ts";

type Captured = { stream: "log" | "warn" | "error"; line: string };

/** Run fn with console.log/warn/error captured, restoring them afterwards. */
function captureConsole(fn: () => void): Captured[] {
  const captured: Captured[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = (line: string) => captured.push({ stream: "log", line });
  console.warn = (line: string) => captured.push({ stream: "warn", line });
  console.error = (line: string) => captured.push({ stream: "error", line });
  try {
    fn();
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
  return captured;
}

Deno.test("makeLogger: each level goes to its own console stream", () => {
  const log = makeLogger("corr-1");
  const captured = captureConsole(() => {
    log("info", "a");
    log("warn", "b");
    log("error", "c");
  });

  assertEquals(captured.map((c) => c.stream), ["log", "warn", "error"]);
});

Deno.test("makeLogger: writes one JSON line with level, event, correlation id and extras", () => {
  const log = makeLogger("corr-2");
  const captured = captureConsole(() => log("info", "webhook_accepted", { invoice_id: "inv_1" }));

  assertEquals(captured.length, 1);
  assertEquals(
    captured[0].line,
    '{"level":"info","event":"webhook_accepted","correlation_id":"corr-2","invoice_id":"inv_1"}',
  );
});

Deno.test("makeLogger: an extra field overrides the stamped ones (spread comes last)", () => {
  const log = makeLogger("corr-3");
  const captured = captureConsole(() => log("warn", "e", { correlation_id: "row-corr" }));

  assertEquals(JSON.parse(captured[0].line).correlation_id, "row-corr");
});

Deno.test("json: serializes the body with a JSON content type", async () => {
  const resp = json({ accepted: true }, 202);

  assertEquals(resp.status, 202);
  assertEquals(resp.headers.get("content-type"), "application/json");
  assertEquals(await resp.text(), '{"accepted":true}');
});

Deno.test("json: status defaults to 200", async () => {
  const resp = json({ processed: 0 });

  assertEquals(resp.status, 200);
  await resp.body?.cancel();
});
