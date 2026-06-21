"use client";

import Link from "next/link";
import { SITE, FEATURES } from "@/lib/site";
import { Reveal, RevealGroup, revealChild } from "@/components/Reveal";
import { motion } from "motion/react";

/* ------------------------------------------------------------------ */
/* Inline SVG icons — no emoji, no external deps                        */
/* ------------------------------------------------------------------ */

function IconWebhook() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3C7.03 3 3 7.03 3 12s4.03 9 9 9 9-4.03 9-9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M17 3l2 2-2 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 5H14a3 3 0 00-3 3v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="11" cy="15" r="1.5" fill="currentColor" />
    </svg>
  );
}

function IconBrain() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 4a4 4 0 00-4 4c0 .7.18 1.36.5 1.93A4 4 0 004 14a4 4 0 004 4v.5a1.5 1.5 0 003 0V18a4 4 0 004-4 4 4 0 00-4.5-3.97c.32-.57.5-1.23.5-1.93a4 4 0 00-4-4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 14h8M12 10v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconRoute() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 7h3a2 2 0 012 2v6a2 2 0 002 2h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M4 17h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="18" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="18" cy="17" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M20 9v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="1.5 2" />
    </svg>
  );
}

function IconDollar() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3v18M9 6h4.5a2.5 2.5 0 010 5H9m0 0h5a2.5 2.5 0 010 5H9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3L4 7v5c0 4.4 3.4 8.5 8 9.5 4.6-1 8-5.1 8-9.5V7l-8-4z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Pipeline step data                                                   */
/* ------------------------------------------------------------------ */

const STEPS = [
  {
    num: "01",
    icon: <IconWebhook />,
    title: FEATURES[0].title,
    body: "Every soft decline fires a webhook — Syzm ingests it in real time, verifies the signature, and normalizes it across processors. No raw card data touches your servers or ours.",
    tag: "Real-time",
    isGold: false,
  },
  {
    num: "02",
    icon: <IconBrain />,
    title: FEATURES[1].title,
    body: "Syzm Brain is an ML model trained on decline patterns across codes, issuers, and regions. It predicts the moment that specific issuer is most likely to approve a retry — not a fixed 72-hour cron.",
    tag: "ML-timed",
    isGold: false,
  },
  {
    num: "03",
    icon: <IconRoute />,
    title: FEATURES[2].title,
    body: "When a Stripe path is blocked — think high-risk BIN, velocity flag, processor downtime — Syzm reroutes the retry through Adyen or Braintree. Stripe-native smart retries can't leave Stripe.",
    tag: "Processor-agnostic",
    isGold: false,
  },
  {
    num: "04",
    icon: <IconDollar />,
    title: "Recovered and reported",
    body: "A successful charge closes the loop. Every recovered transaction surfaces in a finance-readable dashboard: amount, decline code, processor path, and recovery latency. No digging in Stripe logs.",
    tag: "Revenue visible",
    isGold: true,
  },
] as const;

/* ------------------------------------------------------------------ */
/* Decline categories                                                   */
/* ------------------------------------------------------------------ */

type DeclineColor = "teal" | "gold" | "danger";

const DECLINE_CATEGORIES: {
  label: string;
  note: string;
  retries: boolean;
  color: DeclineColor;
}[] = [
  { label: "Insufficient funds", note: "Retried — most likely to recover on payday timing", retries: true, color: "teal" },
  { label: "Issuer transient", note: "Retried — temporary hold, clears in hours", retries: true, color: "teal" },
  { label: "Do-not-honor", note: "Retried with ML timing — often a false positive", retries: true, color: "teal" },
  { label: "Expired card", note: "Flagged for dunning — card update needed", retries: false, color: "gold" },
  { label: "Authentication required", note: "Flagged — 3DS flow surfaced to user", retries: false, color: "gold" },
  { label: "Velocity / duplicate", note: "Retried after cooling window", retries: true, color: "teal" },
  { label: "Fraud / lost / stolen", note: "Never retried — protects the merchant", retries: false, color: "danger" },
];

const DOT_STYLE: Record<DeclineColor, React.CSSProperties> = {
  teal: { background: "var(--color-teal)", boxShadow: "0 0 6px var(--color-teal)" },
  gold: { background: "var(--color-gold)", boxShadow: "0 0 6px var(--color-gold)" },
  danger: { background: "var(--color-danger)", boxShadow: "0 0 6px var(--color-danger)" },
};

const BADGE_STYLE: Record<string, React.CSSProperties> = {
  retried: { background: "rgba(42,223,186,0.1)", color: "var(--color-teal)" },
  flagged: { background: "rgba(255,209,102,0.1)", color: "var(--color-gold)" },
  never: { background: "rgba(255,107,107,0.1)", color: "var(--color-danger)" },
};

/* ------------------------------------------------------------------ */
/* View component                                                       */
/* ------------------------------------------------------------------ */

export default function HowItWorksView() {
  return (
    <>
      {/* ── 1. HERO ── */}
      <section className="container-x pb-24 pt-32">
        <Reveal>
          <span className="eyebrow">How it works</span>
        </Reveal>
        <Reveal delay={0.06}>
          <h1 className="mt-4 max-w-2xl font-display text-5xl font-extrabold leading-[1.04] sm:text-6xl">
            Recovery, from{" "}
            <span className="ink-gradient">decline to dollar.</span>
          </h1>
        </Reveal>
        <Reveal delay={0.12}>
          <p className="mt-5 max-w-xl text-lg text-muted">
            Syzm sits behind your existing Stripe, Adyen, or Braintree stack. No billing migration,
            no card-data handling — just ML-timed retries that find the revenue false-positive
            declines quietly leak every month.
          </p>
        </Reveal>
      </section>

      {/* ── 2. PIPELINE STEPS ── */}
      <section className="container-x pb-28">
        <div className="relative">
          {/* Vertical connector line */}
          <div
            className="absolute left-[27px] top-10 hidden w-px md:block"
            style={{
              height: "calc(100% - 5rem)",
              background:
                "linear-gradient(180deg, rgba(42,223,186,0.5) 0%, rgba(255,209,102,0.4) 80%, transparent 100%)",
            }}
            aria-hidden
          />

          <RevealGroup className="space-y-10">
            {STEPS.map((step) => (
              <motion.div
                key={step.num}
                variants={revealChild}
                className="relative flex gap-6 md:gap-8"
              >
                {/* Step node */}
                <div className="relative z-10 flex-shrink-0">
                  <div
                    className="flex h-14 w-14 items-center justify-center rounded-full border border-white/10"
                    style={
                      step.isGold
                        ? {
                            background: "linear-gradient(135deg, rgba(255,209,102,0.12), rgba(42,223,186,0.08))",
                            boxShadow: "0 0 28px -6px rgba(255,209,102,0.4)",
                            color: "var(--color-gold)",
                          }
                        : {
                            background: "rgba(42,223,186,0.08)",
                            boxShadow: "0 0 28px -8px rgba(42,223,186,0.4)",
                            color: "var(--color-teal)",
                          }
                    }
                  >
                    {step.icon}
                  </div>
                </div>

                {/* Card */}
                <div className="panel flex-1 p-6 md:p-7">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p
                      className="font-mono text-xs font-bold tracking-widest"
                      style={{ color: "rgba(255,255,255,0.18)" }}
                    >
                      {step.num}
                    </p>
                    <span
                      className="pill"
                      style={
                        step.isGold
                          ? {
                              background: "rgba(255,209,102,0.1)",
                              color: "var(--color-gold)",
                              borderColor: "rgba(255,209,102,0.22)",
                            }
                          : undefined
                      }
                    >
                      {step.tag}
                    </span>
                  </div>
                  <h2 className="mt-2 font-display text-xl font-bold">{step.title}</h2>
                  <p className="mt-2 text-muted">{step.body}</p>
                </div>
              </motion.div>
            ))}
          </RevealGroup>
        </div>
      </section>

      {/* ── 3. SETUP ── */}
      <section className="container-x pb-28">
        <div className="panel grid-bg overflow-hidden p-8 md:p-10">
          <Reveal>
            <span className="eyebrow">
              <IconClock />
              Live in under five minutes
            </span>
          </Reveal>
          <Reveal delay={0.06}>
            <h2 className="mt-4 max-w-lg font-display text-3xl font-bold">
              Point a webhook. Drop in API keys. Done.
            </h2>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="mt-3 max-w-prose text-muted">
              No billing-engine migration. No card-data tokenization. No new payment page.
              Syzm hooks into your existing processor events — one endpoint per processor,
              read-only API keys to initiate retries, and Syzm Brain starts learning your
              decline patterns from day one.
            </p>
          </Reveal>

          <RevealGroup className="mt-8 grid gap-4 sm:grid-cols-3">
            {(
              [
                {
                  step: "1",
                  title: "Register webhook",
                  body: "Add Syzm's endpoint to your Stripe / Adyen / Braintree dashboard. One URL, signature-verified.",
                },
                {
                  step: "2",
                  title: "Paste API keys",
                  body: "Read-only keys for charge initiation. No access to card data or customer PII.",
                },
                {
                  step: "3",
                  title: "Recovery starts",
                  body: "First retries typically fire within hours. Revenue shows in your dashboard the same day.",
                },
              ] as const
            ).map((item) => (
              <motion.div key={item.step} variants={revealChild} className="panel-2 p-5">
                <p className="font-display text-3xl font-extrabold text-teal opacity-40">
                  {item.step}
                </p>
                <p className="mt-2 font-semibold">{item.title}</p>
                <p className="mt-1 text-sm text-muted">{item.body}</p>
              </motion.div>
            ))}
          </RevealGroup>
        </div>
      </section>

      {/* ── 4. DECLINE INTELLIGENCE ── */}
      <section className="container-x pb-28">
        <Reveal>
          <span className="eyebrow">Decline intelligence</span>
        </Reveal>
        <Reveal delay={0.06}>
          <h2 className="mt-4 max-w-lg font-display text-3xl font-bold">
            Not all declines are the same.{" "}
            <span className="ink-gradient">Syzm knows the difference.</span>
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="mt-3 max-w-prose text-muted">
            Syzm categorizes every decline before deciding whether — and when — to retry.
            Fraud, lost, and stolen cards are never retried. Recoverable codes get ML-timed
            retries. Edge cases get flagged for your dunning flow.
          </p>
        </Reveal>

        <RevealGroup className="mt-8 space-y-2">
          {DECLINE_CATEGORIES.map((cat) => {
            const badgeKey = cat.retries ? "retried" : cat.color === "danger" ? "never" : "flagged";
            const badgeLabel = cat.retries ? "Retried" : cat.color === "danger" ? "Never retried" : "Flagged";
            return (
              <motion.div
                key={cat.label}
                variants={revealChild}
                className="flex items-center justify-between gap-4 rounded-xl border border-white/8 bg-surface px-5 py-3.5"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={DOT_STYLE[cat.color]}
                    aria-hidden
                  />
                  <span className="font-medium">{cat.label}</span>
                </div>
                <div className="flex items-center gap-3 text-right">
                  <span className="hidden text-sm text-dim sm:block">{cat.note}</span>
                  <span
                    className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold"
                    style={BADGE_STYLE[badgeKey]}
                  >
                    {badgeLabel}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </RevealGroup>
      </section>

      {/* ── 5. COMPLIANCE ── */}
      <section className="container-x pb-28">
        <div className="panel overflow-hidden p-8 md:p-10">
          <div className="flex items-start gap-4">
            <div
              className="mt-1 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
              style={{ background: "rgba(42,223,186,0.1)", border: "1px solid rgba(42,223,186,0.2)", color: "var(--color-teal)" }}
            >
              <IconShield />
            </div>
            <div className="flex-1">
              <Reveal>
                <span className="eyebrow">Compliant by default</span>
              </Reveal>
              <Reveal delay={0.06}>
                <h2 className="mt-3 max-w-xl font-display text-3xl font-bold">
                  Recovery that never becomes a fine.
                </h2>
              </Reveal>
              <Reveal delay={0.1}>
                <p className="mt-3 max-w-prose text-muted">
                  Syzm enforces Visa retry rules automatically — fewer than four attempts per
                  declined transaction, per network mandate. It also skips US issuer maintenance
                  blackout windows, so retries land when the issuer is actually available.
                  No scheme fines, no manual compliance overhead.
                </p>
              </Reveal>

              <RevealGroup className="mt-7 grid gap-4 sm:grid-cols-2">
                {(
                  [
                    {
                      title: "Visa retry limits",
                      body: "Max 4 attempts enforced per transaction. Syzm tracks the counter so you don't have to.",
                    },
                    {
                      title: "Issuer blackout windows",
                      body: "US issuer maintenance windows (~2–5 AM EST) are automatically skipped — retries fire after the window.",
                    },
                    {
                      title: "Fraud signal passthrough",
                      body: "Fraud, lost, and stolen decline codes are recorded and never retried — protects your merchant account health.",
                    },
                    {
                      title: "Audit trail",
                      body: "Every attempt, outcome, and compliance gate logged with timestamps. Exportable for your finance team.",
                    },
                  ] as const
                ).map((item) => (
                  <motion.div key={item.title} variants={revealChild} className="panel-2 p-5">
                    <p className="font-semibold">{item.title}</p>
                    <p className="mt-1 text-sm text-muted">{item.body}</p>
                  </motion.div>
                ))}
              </RevealGroup>
            </div>
          </div>
        </div>
      </section>

      {/* ── 6. CTA ── */}
      <section className="container-x pb-32">
        <Reveal>
          <div className="panel-2 relative overflow-hidden rounded-2xl px-8 py-14 text-center md:px-16">
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(60% 70% at 50% 0%, rgba(42,223,186,0.15) 0%, transparent 70%)",
              }}
              aria-hidden
            />
            <span className="eyebrow relative z-10">Private beta</span>
            <h2 className="relative z-10 mt-4 font-display text-4xl font-extrabold sm:text-5xl">
              See what Syzm would{" "}
              <span className="ink-gradient">recover for you.</span>
            </h2>
            <p className="relative z-10 mx-auto mt-4 max-w-lg text-muted">
              Upload a CSV of failed transactions and get a finance-readable estimate in 90 seconds.
              No setup, no card data, no commitment.
            </p>
            <div className="relative z-10 mt-8 flex flex-wrap items-center justify-center gap-4">
              <Link href={SITE.primaryCta.href} className="btn btn-primary px-6 py-3 text-base">
                {SITE.primaryCta.label}
                <IconChevronRight />
              </Link>
              <Link href="/pricing" className="btn btn-ghost px-6 py-3 text-base">
                See pricing
              </Link>
            </div>
          </div>
        </Reveal>
      </section>
    </>
  );
}
