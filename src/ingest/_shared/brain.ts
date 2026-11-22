/**
 * Client for the Brain's POST /v1/schedule. webhook.ts and execute-retries.ts
 * send the same request but treat a failure differently, so each keeps its own
 * function here: the webhook fails the ingest, the retry worker falls back to
 * a fixed delay. Kept in _shared so tests can import it (both entry points
 * start a server when imported).
 */

import type { Logger } from "./http.ts";
import type { BrainScheduleRequest, BrainScheduleResponse, NormalizedDecline } from "./types.ts";

function postSchedule(
  request: BrainScheduleRequest,
  brainUrl: string,
  brainApiKey: string,
  fetchImpl: typeof fetch,
): Promise<Response> {
  return fetchImpl(`${brainUrl}/v1/schedule`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Syzm-Key": brainApiKey,
    },
    body: JSON.stringify(request),
  });
}

/**
 * Webhook policy: schedule a newly ingested decline. A non-2xx answer is logged
 * and thrown; a network error or a body that is not JSON is thrown as is.
 */
export async function requestBrainSchedule(
  payload: NormalizedDecline,
  brainUrl: string,
  brainApiKey: string,
  log: Logger,
  fetchImpl: typeof fetch = fetch,
): Promise<BrainScheduleResponse> {
  const brainRequest: BrainScheduleRequest = {
    invoice_id: payload.invoice_id,
    decline_code: payload.decline_code,
    region: payload.region,
    retry_count: payload.retry_count,
    original_amount_cents: payload.original_amount_cents,
    processor_origin: payload.processor_origin,
    processor_history: payload.processor_history,
  };

  const response = await postSchedule(brainRequest, brainUrl, brainApiKey, fetchImpl);

  if (!response.ok) {
    log("error", "brain_schedule_failed", { status: response.status });
    throw new Error(`brain_schedule_failed_${response.status}`);
  }

  return (await response.json()) as BrainScheduleResponse;
}

/**
 * Retry-worker policy: the next attempt time from the Brain, or 90 minutes from
 * `now()` (read after the failure) when the Brain call fails in any way.
 */
export async function getBrainScheduledAt(
  request: BrainScheduleRequest,
  brainUrl: string,
  brainApiKey: string,
  log: Logger,
  fetchImpl: typeof fetch = fetch,
  now: () => number = () => Date.now(),
): Promise<string> {
  try {
    const resp = await postSchedule(request, brainUrl, brainApiKey, fetchImpl);

    if (!resp.ok) {
      throw new Error(`brain_http_${resp.status}`);
    }

    const body = (await resp.json()) as BrainScheduleResponse;
    if (!body.scheduled_at_utc) {
      throw new Error("brain_missing_scheduled_at");
    }

    log("info", "brain_schedule_ok", {
      invoice_id: request.invoice_id,
      scheduled_at: body.scheduled_at_utc,
      reason: body.reason,
    });

    return body.scheduled_at_utc;
  } catch (err) {
    // Brain is unreachable — log prominently and use 90-min fallback.
    const msg = err instanceof Error ? err.message : String(err);
    log("error", "brain_schedule_fallback", {
      invoice_id: request.invoice_id,
      brain_error: msg,
      fallback_minutes: 90,
    });
    return new Date(now() + 90 * 60 * 1000).toISOString();
  }
}
