/**
 * Logging and response helpers shared by the edge-function entry points
 * (webhook.ts, execute-retries.ts).
 */

export type LogLevel = "info" | "warn" | "error";

export type Logger = (level: LogLevel, event: string, extra?: Record<string, unknown>) => void;

/** A structured JSON logger that stamps every line with the correlation id. */
export function makeLogger(correlationId: string): Logger {
  return function log(
    level: LogLevel,
    event: string,
    extra?: Record<string, unknown>,
  ) {
    const entry = JSON.stringify({ level, event, correlation_id: correlationId, ...extra });
    if (level === "error") {
      console.error(entry);
    } else if (level === "warn") {
      console.warn(entry);
    } else {
      console.log(entry);
    }
  };
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
