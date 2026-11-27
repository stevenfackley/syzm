/**
 * The retry pipeline end to end against the committed migrations
 * (_pipeline_db.ts): a signed Stripe decline webhook creates the queue row,
 * worker runs charge it through the real processor adapters, and a fake
 * processor network answers them. The fake charges once per idempotency key on
 * Stripe and Adyen, which answer a repeated key from their record of the first
 * request, and on every request on Braintree.
 *
 * Nothing writes payment_token yet (an open owner decision), so each test sets
 * one on the row after the webhook has created it.
 */

import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { type ProcessorCredentials, retryPayment } from "../_shared/processors.ts";
import type { QueueTable } from "../_shared/queue.ts";
import { runRetryBatch } from "../_shared/retry-worker.ts";
import type { ProcessorName } from "../_shared/types.ts";
import { createWebhookHandler } from "../_shared/webhook-handler.ts";
import { MIGRATIONS, openPipelineDb, type PipelineDb } from "./_pipeline_db.ts";

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
/** A Friday afternoon, well outside the Sunday 05:00-08:00 UTC blackout. */
const T0 = Date.parse("2026-11-27T15:00:00.000Z");
const WEBHOOK_SECRET = "whsec_pipeline_test";

const creds: ProcessorCredentials = {
  stripeApiKey: "sk_test_pipeline",
  adyenApiKey: "adyen_test_key",
  adyenMerchantAccount: "TestMerchant",
  braintreePublicKey: "pub",
  braintreePrivateKey: "priv",
  braintreeMerchantId: "merchant1",
};

// ─── Fake processor network ──────────────────────────────────────────────────

/**
 * "decline" is an insufficient-funds decline; { stripeDecline } a Stripe
 * decline with that code. The rest answer without saying what happened:
 *   charge_then_500  the card is charged, the answer is a 500; the key's record holds the charge
 *   fail_500         nothing is charged, the answer is a 500, and nothing is kept under the key
 *   fail_500_cached  nothing is charged, and the 500 is what the key's record replays
 *   gateway_html     a 502 page that is not JSON; nothing charged or kept
 *   conflict_409     a 409 idempotency conflict; nothing charged or kept
 *   charge_then_500_params_changed
 *                    the card is charged, the answer is a 500, and a repeat under the
 *                    key gets Stripe's 400 idempotency_error (its parameters differ)
 *   stripe_processing  Stripe answers a PaymentIntent in status processing; kept
 *   stripe_401       Stripe rejects the API key (401 api_key_expired); nothing kept
 *   stripe_404       Stripe cannot find the customer (404 resource_missing); nothing kept
 *   adyen_received   Adyen answers resultCode Received (not decided yet); kept
 *   braintree_settling  Braintree charges and answers status SETTLING
 */
type Outcome =
  | "approve"
  | "decline"
  | { stripeDecline: string }
  | "charge_then_500"
  | "fail_500"
  | "fail_500_cached"
  | "gateway_html"
  | "conflict_409"
  | "charge_then_500_params_changed"
  | "stripe_processing"
  | "stripe_401"
  | "stripe_404"
  | "adyen_received"
  | "braintree_settling";
type Answer = { status: number; body: unknown; html?: string };

const SERVER_ERROR: Answer = { status: 500, body: { error: { type: "api_error", message: "internal" } } };

function render(processor: ProcessorName, outcome: "approve" | "decline" | { stripeDecline: string }, n: number): Answer {
  if (typeof outcome === "object" && processor !== "stripe") throw new Error(`${processor} got a Stripe decline`);
  switch (processor) {
    case "stripe":
      return outcome === "approve"
        ? { status: 200, body: { id: `pi_${n}`, status: "succeeded" } }
        : {
          status: 402,
          body: {
            error: {
              code: "card_declined",
              decline_code: typeof outcome === "object" ? outcome.stripeDecline : "insufficient_funds",
            },
          },
        };
    case "adyen":
      return outcome === "approve"
        ? { status: 200, body: { resultCode: "Authorised", pspReference: `psp_${n}` } }
        : { status: 200, body: { resultCode: "Refused", refusalReason: "Not enough balance" } };
    case "braintree": {
      const transaction = outcome === "approve"
        ? { id: `bt_${n}`, status: "SUBMITTED_FOR_SETTLEMENT", processorResponse: { legacyCode: "1000", message: "Approved" } }
        : { id: `bt_${n}`, status: "PROCESSOR_DECLINED", processorResponse: { legacyCode: "2001", message: "Insufficient Funds" } };
      return { status: 200, body: { data: { chargeVaultedPaymentMethod: { transaction } } } };
    }
  }
}

class ProcessorNetwork {
  /** Money that moved: one entry per approved charge. */
  readonly charges: Array<{ processor: ProcessorName; key: string }> = [];
  readonly requests: Array<{ processor: ProcessorName; key: string }> = [];
  private readonly remembered = new Map<string, Answer>();
  /** Runs inside the next charge request, after the processor acted and before it answers. */
  duringNextCharge?: () => Promise<void>;
  /** The next answer is lost on the way back (the processor did act). */
  loseNextAnswer = false;
  /** The next request is answered with this before the processor looks at it (no charge, nothing kept). */
  refuseNext?: Answer;

  constructor(private readonly script: Outcome[]) {}

  readonly fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const processor: ProcessorName = url.includes("stripe.com")
      ? "stripe"
      : url.includes("adyen.com")
      ? "adyen"
      : "braintree";
    const key = new Headers(init?.headers).get("Idempotency-Key") ?? "";
    this.requests.push({ processor, key });

    const memo = `${processor} ${key}`;
    if (this.refuseNext) {
      const refusal = this.refuseNext;
      this.refuseNext = undefined;
      return new Response(JSON.stringify(refusal.body), { status: refusal.status });
    }
    let answer = processor === "braintree" ? undefined : this.remembered.get(memo);
    if (!answer) {
      const outcome = this.script.shift();
      if (!outcome) throw new Error(`no scripted outcome left for ${processor}`);
      if (
        outcome === "approve" || outcome === "charge_then_500" || outcome === "charge_then_500_params_changed" ||
        outcome === "braintree_settling"
      ) {
        this.charges.push({ processor, key });
      }
      let kept: Answer | undefined;
      switch (outcome) {
        case "charge_then_500":
          answer = SERVER_ERROR;
          kept = render(processor, "approve", this.requests.length);
          break;
        case "charge_then_500_params_changed":
          answer = SERVER_ERROR;
          kept = { status: 400, body: { error: { type: "idempotency_error", message: "parameters differ" } } };
          break;
        case "stripe_processing":
          answer = kept = { status: 200, body: { id: `pi_${this.requests.length}`, status: "processing" } };
          break;
        case "stripe_401":
          answer = { status: 401, body: { error: { type: "invalid_request_error", code: "api_key_expired" } } };
          break;
        case "stripe_404":
          answer = { status: 404, body: { error: { type: "invalid_request_error", code: "resource_missing" } } };
          break;
        case "adyen_received":
          answer = kept = { status: 200, body: { resultCode: "Received", pspReference: `psp_${this.requests.length}` } };
          break;
        case "braintree_settling":
          answer = {
            status: 200,
            body: {
              data: {
                chargeVaultedPaymentMethod: {
                  transaction: { id: `bt_${this.requests.length}`, status: "SETTLING", processorResponse: { legacyCode: "1000" } },
                },
              },
            },
          };
          break;
        case "fail_500":
          answer = SERVER_ERROR;
          break;
        case "fail_500_cached":
          answer = kept = SERVER_ERROR;
          break;
        case "gateway_html":
          answer = { status: 502, body: null, html: "<html><body>502 Bad Gateway</body></html>" };
          break;
        case "conflict_409":
          answer = { status: 409, body: { error: { type: "idempotency_error", message: "in progress" } } };
          break;
        default:
          answer = kept = render(processor, outcome, this.requests.length);
      }
      if (kept && processor !== "braintree") this.remembered.set(memo, kept);
    }

    const hook = this.duringNextCharge;
    this.duringNextCharge = undefined;
    if (hook) await hook();
    if (this.loseNextAnswer) {
      this.loseNextAnswer = false;
      throw new TypeError("connection reset by peer");
    }
    if (answer.html !== undefined) {
      return new Response(answer.html, { status: answer.status, headers: { "content-type": "text/html" } });
    }
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

// ─── Webhook delivery ────────────────────────────────────────────────────────

const enc = new TextEncoder();

async function stripeSignature(timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${body}`));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** HMAC key the test webhook is configured with for Adyen (hex). */
const ADYEN_HMAC_KEY_HEX = "00";

/** A refused Adyen AUTHORISATION notification, signed the way verify.ts checks it. */
async function adyenRefused(pspReference: string, merchantReference: string): Promise<Record<string, unknown>> {
  const item: Record<string, unknown> = {
    pspReference,
    merchantAccountCode: "TestMerchant",
    merchantReference,
    amount: { value: 1999, currency: "USD" },
    eventCode: "AUTHORISATION",
    success: "false",
    reason: "Not enough balance",
  };
  const fields = [pspReference, "", "TestMerchant", merchantReference, "", "", "AUTHORISATION", "false"];
  const signed = fields.map((f) => f.replace(/\\/g, "\\\\").replace(/:/g, "\\:")).join(":");
  const key = await crypto.subtle.importKey("raw", new Uint8Array([0]), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(signed)));
  item.additionalData = { hmacSignature: btoa(String.fromCharCode(...sig)) };
  return { live: "false", notificationItems: [{ NotificationRequestItem: item }] };
}

function paymentFailed(eventId: string, invoiceId: string, declineCode = "insufficient_funds") {
  return {
    id: eventId,
    type: "payment_intent.payment_failed",
    data: { object: { invoice: invoiceId, amount_due: 1999, last_payment_error: { decline_code: declineCode } } },
  };
}

// ─── Harness ─────────────────────────────────────────────────────────────────

type Pipeline = {
  db: PipelineDb;
  net: ProcessorNetwork;
  clock: { now: () => Date; advance(ms: number): void };
  deliver(event: unknown): Promise<{ status: number; body: Record<string, unknown> }>;
  deliverAdyen(notification: unknown): Promise<{ status: number; body: Record<string, unknown> }>;
  run(table?: QueueTable): ReturnType<typeof runRetryBatch>;
  giveToken(): Promise<void>;
  /** Make the next attempt go to Stripe (a Stripe-origin row's attempts 1 and 2 go elsewhere). */
  routeToStripe(): Promise<void>;
  row(): Promise<Record<string, unknown>>;
};

async function withPipeline(script: Outcome[], fn: (p: Pipeline) => Promise<void>): Promise<void> {
  const db = await openPipelineDb();
  const net = new ProcessorNetwork(script);
  let t = T0;
  const clock = { now: () => new Date(t), advance: (ms: number) => void (t += ms) };

  const webhook = createWebhookHandler({
    table: db.table,
    secrets: {
      stripeWebhookSecret: WEBHOOK_SECRET,
      adyenHmacKey: ADYEN_HMAC_KEY_HEX,
      braintreePublicKey: "pub",
      braintreePrivateKey: "priv",
    },
    schedule: (decline) =>
      Promise.resolve({
        invoice_id: decline.invoice_id,
        scheduled_at_utc: clock.now().toISOString(),
        reason: "test_schedule",
        strategy_version: "test",
        eligible_processors: [],
      }),
  });

  const pipeline: Pipeline = {
    db,
    net,
    clock,
    async deliver(event) {
      const body = JSON.stringify(event);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const res = await webhook(
        new Request("https://ingest.test/functions/v1/webhook/stripe", {
          method: "POST",
          headers: { "stripe-signature": `t=${timestamp},v1=${await stripeSignature(timestamp, body)}` },
          body,
        }),
      );
      return { status: res.status, body: await res.json() };
    },
    async deliverAdyen(notification) {
      const res = await webhook(
        new Request("https://ingest.test/functions/v1/webhook/adyen", {
          method: "POST",
          body: JSON.stringify(notification),
        }),
      );
      return { status: res.status, body: await res.json() };
    },
    run: (table = db.table) =>
      runRetryBatch({
        table,
        charge: (processor, attempt, correlationId) => retryPayment(processor, attempt, creds, correlationId, net.fetch),
        schedule: () => Promise.resolve(new Date(clock.now().getTime() + DAY).toISOString()),
        correlationId: "batch-test",
        now: clock.now,
      }),
    async giveToken() {
      await db.db.exec("UPDATE syzm_recovery_queue SET payment_token = 'pm_1|cus_1' WHERE payment_token IS NULL");
    },
    async routeToStripe() {
      await db.db.exec(`UPDATE syzm_recovery_queue SET processor_history = '["stripe","adyen","braintree"]'::jsonb`);
    },
    async row() {
      const rows = await db.rows();
      assertEquals(rows.length, 1, "one queue row");
      return rows[0];
    },
  };

  try {
    await fn(pipeline);
  } finally {
    await db.close();
  }
}

/** Ingest one decline and make the row chargeable. */
async function ingest(p: Pipeline, invoiceId = "in_1"): Promise<void> {
  const res = await p.deliver(paymentFailed("evt_1", invoiceId));
  assertEquals(res, { status: 202, body: { accepted: true, scheduled_at_utc: new Date(T0).toISOString() } });
  await p.giveToken();
}

/** A table that dies (like a killed worker) on the write that records an attempt. */
function crashingOnRecord(table: QueueTable): QueueTable {
  return {
    ...table,
    update(patch, filter) {
      if (patch.attempt_started_at === null && filter.eq?.status === "retrying") {
        throw new Error("worker killed before recording the attempt");
      }
      return table.update(patch, filter);
    },
  };
}

function okSummary(result: Awaited<ReturnType<typeof runRetryBatch>>) {
  if (!result.ok) throw new Error(`run failed: ${result.error}`);
  return result.summary;
}

// ─── Schema ──────────────────────────────────────────────────────────────────

Deno.test("pipeline: the migrations apply in order, and 008 applies twice", async () => {
  const db = await openPipelineDb();
  try {
    await db.db.exec(MIGRATIONS[MIGRATIONS.length - 1][1]);
  } finally {
    await db.close();
  }
});

Deno.test("pipeline: without 008 the schema rejects what the webhook and the worker write", async () => {
  const db = await openPipelineDb(MIGRATIONS.length - 1);
  try {
    const select = await db.table.select(["id", "correlation_id"], { eq: { status: "pending" } }, 1);
    assertEquals(select.error?.code, "42703"); // undefined_column: the worker's due-row select
    const insert = await db.table.insert({
      invoice_id: "in_old",
      processor_event_id: "evt_old",
      scheduled_at: new Date(T0).toISOString(),
      processor_origin: "stripe",
      correlation_id: "c",
    });
    assertEquals(insert.error?.code, "42703"); // the webhook's insert

    await db.db.exec(
      `INSERT INTO syzm_recovery_queue (invoice_id, retry_count, scheduled_at, processor_origin)
       VALUES ('in_old', 3, now(), 'stripe')`,
    );
    for (const status of ["recovered", "exhausted"]) {
      const write = await db.table.update({ status, retry_count: 4 }, { eq: { invoice_id: "in_old" } });
      assertEquals(write.error?.code, "23514", status); // check_violation: retry_count < 4
    }
    for (const status of ["blocked", "error"]) {
      const write = await db.table.update({ status }, { eq: { invoice_id: "in_old" } });
      assertEquals(write.error?.code, "23514", status); // check_violation: status list
    }
  } finally {
    await db.close();
  }
});

// ─── Charges ─────────────────────────────────────────────────────────────────

Deno.test("pipeline: success on attempt 1 is recorded once and never dispatched again", async () => {
  await withPipeline(["approve"], async (p) => {
    await ingest(p);

    const first = okSummary(await p.run());
    assertEquals([first.processed, first.recovered], [1, 1]);
    const row = await p.row();
    assertEquals([row.status, row.retry_count, row.claimed_at, row.attempt_started_at], ["recovered", 1, null, null]);
    assertEquals(typeof row.processor_reference, "string");

    for (let i = 0; i < 3; i++) {
      p.clock.advance(DAY);
      assertEquals(okSummary(await p.run()).processed, 0);
    }
    assertEquals(p.net.charges.length, 1);
    assertEquals(p.net.requests.length, 1);
  });
});

Deno.test("pipeline: success on the fourth (last allowed) attempt is recorded and never dispatched again", async () => {
  await withPipeline(["decline", "decline", "decline", "approve"], async (p) => {
    await ingest(p);

    for (let attempt = 1; attempt <= 3; attempt++) {
      assertEquals(okSummary(await p.run()).rescheduled, 1, `attempt ${attempt}`);
      const row = await p.row();
      assertEquals([row.status, row.retry_count], ["pending", attempt]);
      p.clock.advance(DAY);
    }

    assertEquals(okSummary(await p.run()).recovered, 1);
    const row = await p.row();
    assertEquals([row.status, row.retry_count], ["recovered", 4]);
    assertEquals(row.processor_history, ["stripe", "adyen", "braintree", "stripe", "stripe"]);

    for (let i = 0; i < 3; i++) {
      p.clock.advance(MINUTE);
      assertEquals(okSummary(await p.run()).processed, 0);
    }
    assertEquals(p.net.charges.length, 1);
    assertEquals(p.net.requests.length, 4);
    // Each attempt went out under its own key; attempts 3 and 4 both go to Stripe.
    assertEquals(new Set(p.net.requests.map((r) => r.key)).size, 4);
  });
});

Deno.test("pipeline: a decline on every attempt ends exhausted after four and is never dispatched again", async () => {
  await withPipeline(["decline", "decline", "decline", "decline"], async (p) => {
    await ingest(p);

    for (let attempt = 1; attempt <= 4; attempt++) {
      await p.run();
      p.clock.advance(DAY);
    }
    const row = await p.row();
    assertEquals([row.status, row.retry_count, row.last_decline_code], ["exhausted", 4, "insufficient_funds"]);

    p.clock.advance(DAY);
    assertEquals(okSummary(await p.run()).processed, 0);
    assertEquals(p.net.requests.length, 4);
    assertEquals(p.net.charges.length, 0);
  });
});

// ─── Webhooks ────────────────────────────────────────────────────────────────

Deno.test("pipeline: a duplicate webhook delivery does not add a row", async () => {
  await withPipeline([], async (p) => {
    const event = paymentFailed("evt_dup", "in_dup");
    assertEquals((await p.deliver(event)).body.accepted, true);
    assertEquals(await p.deliver(event), { status: 202, body: { accepted: false, reason: "duplicate" } });
    // Another event for the same invoice is a duplicate too: the invoice has its row.
    assertEquals(
      await p.deliver(paymentFailed("evt_dup_2", "in_dup")),
      { status: 202, body: { accepted: false, reason: "duplicate" } },
    );
    assertEquals((await p.db.rows()).length, 1);
  });
});

Deno.test("pipeline: a decline webhook that arrives before the worker records its attempt opens no second row", async () => {
  await withPipeline(["decline", "approve"], async (p) => {
    await ingest(p);

    // The processor's webhook for the worker's own attempt lands while the
    // worker is still waiting on the processor.
    let early: Awaited<ReturnType<Pipeline["deliver"]>> | undefined;
    p.net.duringNextCharge = async () => {
      early = await p.deliver(paymentFailed("evt_attempt_1", "in_1"));
    };
    assertEquals(okSummary(await p.run()).rescheduled, 1);
    assertEquals(early, { status: 202, body: { accepted: false, reason: "duplicate" } });
    assertEquals([(await p.row()).status, (await p.row()).retry_count], ["pending", 1]);

    // A late redelivery after the attempt was recorded changes nothing either.
    assertEquals((await p.deliver(paymentFailed("evt_attempt_1", "in_1"))).body.reason, "duplicate");

    p.clock.advance(DAY);
    assertEquals(okSummary(await p.run()).recovered, 1);
    // Nor after the invoice was recovered.
    assertEquals((await p.deliver(paymentFailed("evt_late", "in_1"))).body.reason, "duplicate");

    p.clock.advance(DAY);
    assertEquals(okSummary(await p.run()).processed, 0);
    assertEquals(p.net.charges.length, 1);
  });
});

Deno.test("pipeline: Stripe's decline of the worker's own retry is acknowledged and not queued", async () => {
  await withPipeline(["decline"], async (p) => {
    await ingest(p);
    await p.routeToStripe();
    await p.run(); // the worker's create-path PaymentIntent is declined
    const ownKey = p.net.requests[0].key;

    // Stripe's payment_intent.payment_failed for that PaymentIntent: no
    // invoice on it, but the worker's metadata.
    const event = {
      id: "evt_own_retry",
      type: "payment_intent.payment_failed",
      data: {
        object: {
          id: "pi_own",
          amount: 1999,
          metadata: { syzm_attempt_key: ownKey, syzm_queue_row_id: (await p.row()).id },
          last_payment_error: { type: "card_error", code: "card_declined", decline_code: "insufficient_funds" },
        },
      },
    };
    assertEquals(await p.deliver(event), { status: 202, body: { accepted: false, reason: "own_retry" } });
    assertEquals((await p.db.rows()).length, 1);

    // A customer's own decline for another invoice is still queued.
    assertEquals((await p.deliver(paymentFailed("evt_customer", "in_2"))).body.accepted, true);
    assertEquals((await p.db.rows()).length, 2);
  });
});

Deno.test("pipeline: Adyen's refusal of the worker's own retry is acknowledged and not queued", async () => {
  await withPipeline([], async (p) => {
    const ownKey = "syzm-0b7e2a40-6c5d-4f1e-9a3b-2c1d0e9f8a7b-attempt-2";
    assertEquals(
      await p.deliverAdyen(await adyenRefused("PSP_OWN", ownKey)),
      { status: 202, body: { accepted: false, reason: "own_retry" } },
    );
    assertEquals((await p.db.rows()).length, 0);

    // A customer's refused payment with an ordinary reference is queued.
    assertEquals((await p.deliverAdyen(await adyenRefused("PSP_CUST", "INV-1001"))).body.accepted, true);
    const rows = await p.db.rows();
    assertEquals(rows.map((r) => [r.invoice_id, r.processor_origin]), [["INV-1001", "adyen"]]);
  });
});

// ─── Crashes and overlapping runs ────────────────────────────────────────────

Deno.test("pipeline: a worker killed between the charge and the record does not charge twice", async () => {
  await withPipeline(["approve"], async (p) => {
    await ingest(p);

    await assertRejects(() => p.run(crashingOnRecord(p.db.table)), Error, "worker killed");
    assertEquals(p.net.charges.length, 1);
    assertEquals((await p.row()).status, "retrying");

    // Inside the stale window the claimed row is left alone.
    p.clock.advance(14 * MINUTE);
    assertEquals(okSummary(await p.run()).processed, 0);
    assertEquals(p.net.requests.length, 1);

    // After it, the next run repeats the attempt with the same key; the
    // processor answers from its record and nothing is charged again.
    p.clock.advance(2 * MINUTE);
    assertEquals(okSummary(await p.run()).recovered, 1);
    const row = await p.row();
    assertEquals([row.status, row.retry_count, row.claimed_at], ["recovered", 1, null]);
    assertEquals(p.net.requests.length, 2);
    assertEquals(p.net.requests[0].key, p.net.requests[1].key);
    assertEquals(p.net.charges.length, 1);

    p.clock.advance(DAY);
    assertEquals(okSummary(await p.run()).processed, 0);
  });
});

Deno.test("pipeline: a lost processor answer is settled by repeating the same attempt", async () => {
  await withPipeline(["approve"], async (p) => {
    await ingest(p);

    p.net.loseNextAnswer = true;
    assertEquals(okSummary(await p.run()).errored, 1);
    assertEquals((await p.row()).status, "retrying");

    p.clock.advance(16 * MINUTE);
    assertEquals(okSummary(await p.run()).recovered, 1);
    assertEquals(p.net.charges.length, 1);
    assertEquals(p.net.requests.length, 2);
  });
});

// ─── Answers that do not say whether the card was charged ────────────────────

Deno.test("pipeline: a Stripe 500 after the card was charged is settled under the same key, not charged again", async () => {
  await withPipeline(["charge_then_500"], async (p) => {
    await ingest(p);
    await p.routeToStripe();

    assertEquals(okSummary(await p.run()).errored, 1);
    const claimed = await p.row();
    assertEquals([claimed.status, claimed.retry_count], ["retrying", 0]);
    assertEquals(p.net.charges.length, 1);

    // Recording a decline here would send attempt 2 under a new key.
    p.clock.advance(16 * MINUTE);
    assertEquals(okSummary(await p.run()).recovered, 1);
    const row = await p.row();
    assertEquals([row.status, row.retry_count], ["recovered", 1]);
    assertEquals(p.net.requests.map((r) => r.key), [p.net.requests[0].key, p.net.requests[0].key]);
    assertEquals(p.net.charges.length, 1);
  });
});

Deno.test("pipeline: a Stripe 500 with nothing charged is repeated under the same key and charges once", async () => {
  await withPipeline(["fail_500", "approve"], async (p) => {
    await ingest(p);
    await p.routeToStripe();

    okSummary(await p.run());
    assertEquals([(await p.row()).status, p.net.charges.length], ["retrying", 0]);

    p.clock.advance(16 * MINUTE);
    assertEquals(okSummary(await p.run()).recovered, 1);
    assertEquals(p.net.charges.length, 1);
    assertEquals(new Set(p.net.requests.map((r) => r.key)).size, 1);
  });
});

Deno.test("pipeline: a 500 that never clears ends error, outcome unknown, without a second key", async () => {
  await withPipeline(["fail_500_cached"], async (p) => {
    await ingest(p);
    await p.routeToStripe();

    okSummary(await p.run());
    // Every 15 minutes the same attempt is repeated; Stripe replays the 500.
    for (let i = 0; i < 4; i++) {
      p.clock.advance(16 * MINUTE);
      assertEquals(okSummary(await p.run()).errored, 1);
      assertEquals((await p.row()).status, "retrying");
    }
    p.clock.advance(23 * 60 * MINUTE);
    okSummary(await p.run());
    const row = await p.row();
    assertEquals([row.status, row.retry_count, row.schedule_reason], ["error", 0, "outcome_unknown:stripe"]);
    assertEquals(new Set(p.net.requests.map((r) => r.key)).size, 1);
    assertEquals(p.net.charges.length, 0);

    p.clock.advance(DAY);
    assertEquals(okSummary(await p.run()).processed, 0);
  });
});

Deno.test("pipeline: a gateway page that is not JSON and a 409 take the same path as a 500", async () => {
  for (const unclear of ["gateway_html", "conflict_409"] as const) {
    await withPipeline([unclear, "approve"], async (p) => {
      await ingest(p);
      await p.routeToStripe();

      assertEquals(okSummary(await p.run()).errored, 1, unclear);
      assertEquals((await p.row()).status, "retrying", unclear);

      p.clock.advance(16 * MINUTE);
      assertEquals(okSummary(await p.run()).recovered, 1, unclear);
      assertEquals(new Set(p.net.requests.map((r) => r.key)).size, 1, unclear);
      assertEquals(p.net.charges.length, 1, unclear);
    });
  }
});

Deno.test("pipeline: a Stripe idempotency_error on a repeat does not move the row to a new key", async () => {
  // Attempt 1 is charged and answered 500. Before the repeat, its parameters
  // change (a deploy, a rewritten token); Stripe answers the repeat with an
  // idempotency_error, which says nothing about the first request.
  await withPipeline(["charge_then_500_params_changed", "approve"], async (p) => {
    await ingest(p);
    await p.routeToStripe();

    okSummary(await p.run());
    p.clock.advance(16 * MINUTE);
    assertEquals(okSummary(await p.run()).errored, 1);
    assertEquals([(await p.row()).status, (await p.row()).retry_count], ["retrying", 0]);

    p.clock.advance(23 * 60 * MINUTE);
    okSummary(await p.run());
    assertEquals((await p.row()).schedule_reason, "outcome_unknown:stripe");
    p.clock.advance(DAY);
    assertEquals(okSummary(await p.run()).processed, 0);
    assertEquals(new Set(p.net.requests.map((r) => r.key)).size, 1);
    assertEquals(p.net.charges.length, 1);
  });
});

Deno.test("pipeline: a Stripe PaymentIntent still processing is not recorded as recovered", async () => {
  await withPipeline(["stripe_processing"], async (p) => {
    await ingest(p);
    await p.routeToStripe();

    assertEquals(okSummary(await p.run()).recovered, 0);
    assertEquals((await p.row()).status, "retrying");
    p.clock.advance(16 * MINUTE);
    assertEquals(okSummary(await p.run()).recovered, 0);
    assertEquals((await p.row()).status, "retrying");

    p.clock.advance(23 * 60 * MINUTE);
    okSummary(await p.run());
    const row = await p.row();
    assertEquals([row.status, row.schedule_reason, row.recovered_at], ["error", "outcome_unknown:stripe", null]);
    assertEquals(new Set(p.net.requests.map((r) => r.key)).size, 1);
  });
});

Deno.test("pipeline: an Adyen Received is not a decline: the attempt is not moved to a new key", async () => {
  // A Stripe-origin row's first attempt goes to Adyen.
  await withPipeline(["adyen_received", "approve"], async (p) => {
    await ingest(p);

    assertEquals(okSummary(await p.run()).errored, 1);
    p.clock.advance(16 * MINUTE);
    assertEquals(okSummary(await p.run()).errored, 1); // Adyen answers the key with Received again
    assertEquals([(await p.row()).status, (await p.row()).retry_count], ["retrying", 0]);

    p.clock.advance(23 * 60 * MINUTE);
    okSummary(await p.run());
    assertEquals((await p.row()).schedule_reason, "outcome_unknown:adyen");
    assertEquals(new Set(p.net.requests.map((r) => r.key)).size, 1);
    assertEquals(p.net.requests.map((r) => r.processor), ["adyen", "adyen"]);
  });
});

Deno.test("pipeline: a Braintree charge still settling ends error for a person, not a charge under the next key", async () => {
  // A Stripe-origin row: attempt 1 to Adyen (declined), attempt 2 to Braintree.
  await withPipeline(["decline", "braintree_settling", "approve"], async (p) => {
    await ingest(p);
    await p.run();
    p.clock.advance(DAY);

    assertEquals(okSummary(await p.run()).errored, 1);
    assertEquals((await p.row()).status, "retrying");
    p.clock.advance(16 * MINUTE);
    okSummary(await p.run());
    const row = await p.row();
    assertEquals([row.status, row.retry_count, row.schedule_reason], ["error", 1, "outcome_unknown:braintree"]);
    assertEquals(p.net.requests.map((r) => r.processor), ["adyen", "braintree"]);
    assertEquals(p.net.charges.length, 1);
  });
});

// ─── Answers that refuse the request itself ──────────────────────────────────

Deno.test("pipeline: a Stripe 401 (api_key_expired) does not block, spends no attempt, and keeps the key", async () => {
  await withPipeline(["stripe_401", "approve"], async (p) => {
    await ingest(p);
    await p.routeToStripe();

    assertEquals(okSummary(await p.run()).deferred, 1);
    const released = await p.row();
    assertEquals(
      [released.status, released.retry_count, released.claimed_at, released.attempt_started_at, released.last_decline_code],
      ["pending", 0, null, null, null],
    );
    assertEquals(Date.parse(String(released.scheduled_at)), T0 + 15 * MINUTE);

    p.clock.advance(10 * MINUTE);
    assertEquals(okSummary(await p.run()).processed, 0);

    p.clock.advance(6 * MINUTE);
    assertEquals(okSummary(await p.run()).recovered, 1);
    const row = await p.row();
    assertEquals([row.status, row.retry_count], ["recovered", 1]);
    assertEquals(p.net.requests.length, 2);
    assertEquals(new Set(p.net.requests.map((r) => r.key)).size, 1);
  });
});

Deno.test("pipeline: a 401 on a repeat keeps the attempt's start, so the key window still ends it", async () => {
  await withPipeline(["fail_500"], async (p) => {
    await ingest(p);
    await p.routeToStripe();

    okSummary(await p.run()); // attempt 1 answered 500: parked
    p.clock.advance(16 * MINUTE);
    p.net.refuseNext = { status: 401, body: { error: { type: "invalid_request_error", code: "api_key_expired" } } };
    assertEquals(okSummary(await p.run()).deferred, 1);
    const released = await p.row();
    assertEquals([released.status, released.retry_count], ["pending", 0]);
    assertEquals(Date.parse(String(released.attempt_started_at)), T0);

    // The first request's outcome is still unknown; after 23 hours Stripe may
    // have dropped the key, so the attempt is not sent a third time.
    p.clock.advance(23 * 60 * MINUTE);
    okSummary(await p.run());
    assertEquals((await p.row()).schedule_reason, "outcome_unknown:stripe");
    assertEquals(p.net.requests.length, 2);
  });
});

Deno.test("pipeline: a Stripe 404 that is not a card error spends an attempt and is not read as a decline code", async () => {
  await withPipeline(["stripe_404"], async (p) => {
    await ingest(p);
    await p.routeToStripe();

    assertEquals(okSummary(await p.run()).rescheduled, 1);
    const row = await p.row();
    assertEquals(
      [row.status, row.retry_count, row.decline_category, row.last_decline_code],
      ["pending", 1, "unknown", "resource_missing"],
    );
  });
});

Deno.test("pipeline: a real Stripe decline is still recorded and retried under the next key", async () => {
  await withPipeline(["decline", "approve"], async (p) => {
    await ingest(p);
    await p.routeToStripe();

    assertEquals(okSummary(await p.run()).rescheduled, 1);
    const row = await p.row();
    assertEquals([row.status, row.retry_count, row.last_decline_code], ["pending", 1, "insufficient_funds"]);

    p.clock.advance(DAY);
    assertEquals(okSummary(await p.run()).recovered, 1);
    assertEquals(new Set(p.net.requests.map((r) => r.key)).size, 2);
  });
});

Deno.test("pipeline: a stale claim on a processor that does not honour the key ends in error, not a second charge", async () => {
  // The second attempt of a Stripe-origin row goes to Braintree.
  await withPipeline(["decline", "approve"], async (p) => {
    await ingest(p);
    await p.run(); // attempt 1, declined
    p.clock.advance(DAY);

    await assertRejects(() => p.run(crashingOnRecord(p.db.table)), Error, "worker killed");
    assertEquals(p.net.charges, [{ processor: "braintree", key: p.net.requests[1].key }]);

    p.clock.advance(16 * MINUTE);
    okSummary(await p.run());
    const row = await p.row();
    assertEquals([row.status, row.schedule_reason], ["error", "outcome_unknown:braintree"]);
    assertEquals(p.net.requests.length, 2);
    assertEquals(p.net.charges.length, 1);
  });
});

Deno.test("pipeline: a stale claim older than the processor keeps its keys ends in error", async () => {
  await withPipeline(["approve"], async (p) => {
    await ingest(p);
    await assertRejects(() => p.run(crashingOnRecord(p.db.table)), Error, "worker killed");

    // No worker ran for a day: Stripe and Adyen may have dropped the key.
    p.clock.advance(DAY);
    okSummary(await p.run());
    assertEquals((await p.row()).status, "error");
    assertEquals(p.net.requests.length, 1);
  });
});

Deno.test("pipeline: a run that overlaps another does not touch the row the other has claimed", async () => {
  await withPipeline(["approve"], async (p) => {
    await ingest(p);

    let overlapping: Awaited<ReturnType<typeof runRetryBatch>> | undefined;
    p.net.duringNextCharge = async () => {
      overlapping = await p.run();
    };
    assertEquals(okSummary(await p.run()).recovered, 1);
    assertEquals(okSummary(overlapping!).processed, 0);
    assertEquals(p.net.requests.length, 1);
  });
});

Deno.test("pipeline: an attempt still out after 10 minutes is not taken over", async () => {
  await withPipeline(["approve"], async (p) => {
    await ingest(p);

    let meanwhile: Awaited<ReturnType<typeof runRetryBatch>> | undefined;
    p.net.duringNextCharge = async () => {
      // The processor takes 10 minutes to answer; another run starts meanwhile.
      p.clock.advance(10 * MINUTE);
      meanwhile = await p.run();
    };
    assertEquals(okSummary(await p.run()).recovered, 1);
    assertEquals(okSummary(meanwhile!).processed, 0);
    assertEquals(p.net.requests.length, 1);
  });
});

Deno.test("pipeline: two runs that take over the same stale row repeat the attempt once", async () => {
  await withPipeline(["approve"], async (p) => {
    await ingest(p);
    await assertRejects(() => p.run(crashingOnRecord(p.db.table)), Error, "worker killed");
    p.clock.advance(16 * MINUTE);

    // Both runs read the stale row before either claims it.
    let reads = 0;
    let release: () => void = () => {};
    const bothRead = new Promise<void>((resolve) => (release = resolve));
    const slowStale: QueueTable = {
      ...p.db.table,
      async select(columns, filter, limit) {
        const result = await p.db.table.select(columns, filter, limit);
        if (filter.eq?.status === "retrying") {
          if (++reads === 2) release();
          await bothRead;
        }
        return result;
      },
    };
    const [a, b] = await Promise.all([p.run(slowStale), p.run(slowStale)]);
    const summaries = [okSummary(a), okSummary(b)];
    assertEquals(summaries.map((s) => s.recovered).sort(), [0, 1]);
    assertEquals(summaries.map((s) => s.skipped).sort(), [0, 1]);
    assertEquals(p.net.requests.length, 2); // the first attempt and one repeat
    assertEquals(p.net.charges.length, 1);
  });
});

Deno.test("pipeline: a run whose claim was taken over does not write its outcome", async () => {
  await withPipeline(["decline"], async (p) => {
    await ingest(p);

    // While the charge is out, another run takes the claim (a takeover moves claimed_at).
    p.net.duringNextCharge = async () => {
      await p.db.db.exec("UPDATE syzm_recovery_queue SET claimed_at = claimed_at + interval '1 second'");
    };
    const summary = okSummary(await p.run());
    assertEquals([summary.rescheduled, summary.write_failed], [1, 1]);
    const row = await p.row();
    assertEquals([row.status, row.retry_count, row.last_decline_code], ["retrying", 0, null]);
  });
});

Deno.test("pipeline: two runs that read the same due row charge it once", async () => {
  await withPipeline(["approve"], async (p) => {
    await ingest(p);

    // Both runs read the row before either claims it.
    let reads = 0;
    let release: () => void = () => {};
    const bothRead = new Promise<void>((resolve) => (release = resolve));
    const slowSelect: QueueTable = {
      ...p.db.table,
      async select(columns, filter, limit) {
        const result = await p.db.table.select(columns, filter, limit);
        if (filter.eq?.status === "pending" && ++reads === 2) release();
        if (filter.eq?.status === "pending") await bothRead;
        return result;
      },
    };
    const [a, b] = await Promise.all([p.run(slowSelect), p.run(slowSelect)]);
    const summaries = [okSummary(a), okSummary(b)];
    assertEquals(summaries.map((s) => s.recovered).sort(), [0, 1]);
    assertEquals(summaries.map((s) => s.skipped).sort(), [0, 1]);
    assertEquals(p.net.charges.length, 1);
    assertEquals(p.net.requests.length, 1);
  });
});

// ─── Decline codes (one table for the webhook and the worker) ────────────────

Deno.test("pipeline: the webhook queues a generic_decline and drops a pickup_card", async () => {
  await withPipeline([], async (p) => {
    assertEquals((await p.deliver(paymentFailed("evt_g", "in_g", "generic_decline"))).body.accepted, true);
    assertEquals(
      await p.deliver(paymentFailed("evt_p", "in_p", "pickup_card")),
      { status: 202, body: { accepted: false, reason: "not_soft_decline" } },
    );
    const rows = await p.db.rows();
    assertEquals(rows.map((r) => [r.invoice_id, r.decline_category]), [["in_g", "do_not_honor"]]);
  });
});

Deno.test("pipeline: a Stripe decline that must not be retried ends the row at once", async () => {
  // Attempts 1 and 2 of a Stripe-origin row go to Adyen and Braintree, 3 to Stripe.
  await withPipeline(["decline", "decline", { stripeDecline: "expired_card" }], async (p) => {
    await ingest(p);
    for (let attempt = 1; attempt <= 3; attempt++) {
      await p.run();
      p.clock.advance(DAY);
    }
    const row = await p.row();
    assertEquals(
      [row.status, row.retry_count, row.decline_category, row.schedule_reason],
      ["blocked", 3, "expired_card", "blocked:not_retryable:expired_card"],
    );
    assertEquals(okSummary(await p.run()).processed, 0);
    assertEquals(p.net.requests.length, 3);
  });
});

Deno.test("pipeline: a row from another processor still reaches its own processor after Stripe cannot read its token", async () => {
  // Routing sends a Braintree-origin row to Adyen, then Stripe, then Braintree.
  // Neither of the first two can read a Braintree token; that must not end the row.
  await withPipeline(["approve"], async (p) => {
    const { error } = await p.db.table.insert({
      invoice_id: "bt_inv_1",
      processor_event_id: "bt_evt_1",
      scheduled_at: new Date(T0).toISOString(),
      status: "pending",
      processor_origin: "braintree",
      processor_history: ["braintree"],
      payment_token: "pmt_braintree_only",
    });
    assertEquals(error, null);

    for (let attempt = 1; attempt <= 2; attempt++) {
      assertEquals(okSummary(await p.run()).rescheduled, 1, `attempt ${attempt}`);
      p.clock.advance(DAY);
    }
    assertEquals(okSummary(await p.run()).recovered, 1);
    const row = await p.row();
    assertEquals(row.processor_history, ["braintree", "adyen", "stripe", "braintree"]);
    assertEquals(p.net.requests.map((r) => r.processor), ["braintree"]);
  });
});

// ─── Rows the worker finishes without charging ───────────────────────────────

Deno.test("pipeline: a row without a payment token ends in error and is not dispatched again", async () => {
  await withPipeline([], async (p) => {
    assertEquals((await p.deliver(paymentFailed("evt_nt", "in_nt"))).body.accepted, true);

    okSummary(await p.run());
    const row = await p.row();
    assertEquals([row.status, row.schedule_reason], ["error", "missing_payment_token"]);
    p.clock.advance(MINUTE);
    assertEquals(okSummary(await p.run()).processed, 0);
  });
});

Deno.test("pipeline: a row the guard blocks ends blocked and is not dispatched again", async () => {
  await withPipeline([], async (p) => {
    await ingest(p);
    await p.db.db.exec("UPDATE syzm_recovery_queue SET decline_category = 'fraud'");

    assertEquals(okSummary(await p.run()).guarded, 1);
    const row = await p.row();
    assertEquals([row.status, row.schedule_reason], ["blocked", "blocked:fraud_or_stolen:fraud"]);
    p.clock.advance(MINUTE);
    assertEquals(okSummary(await p.run()).processed, 0);
    assertEquals(p.net.requests.length, 0);
  });
});

Deno.test("pipeline: a row due in the Sunday blackout waits, then is charged after it", async () => {
  await withPipeline(["approve"], async (p) => {
    await ingest(p);
    // Sunday 2026-11-29 06:00 UTC is inside the 05:00-08:00 blackout.
    p.clock.advance(Date.parse("2026-11-29T06:00:00.000Z") - T0);

    assertEquals(okSummary(await p.run()).guarded, 1);
    assertEquals((await p.row()).status, "pending");
    assertEquals(p.net.requests.length, 0);

    p.clock.advance(2 * 60 * MINUTE);
    assertEquals(okSummary(await p.run()).recovered, 1);
  });
});
