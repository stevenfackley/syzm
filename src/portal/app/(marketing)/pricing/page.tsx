import type { Metadata } from "next";
import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { PRICING, PROCESSORS, PROOF } from "@/lib/site";
import { formatDollars, formatPct } from "@/lib/utils";
import { FaqList } from "./FaqList";
import { IncludedList } from "./IncludedList";

export const metadata: Metadata = {
  title: "Pricing",
};

// ── Worked example — labelled as illustration ─────────────────────────────
const EXAMPLE_RECOVERED = 5_000;
const EXAMPLE_SUCCESS_FEE = (EXAMPLE_RECOVERED * PRICING.successFeePct) / 100;
const EXAMPLE_PLATFORM = PRICING.platformMonthly;
const EXAMPLE_TOTAL_COST = EXAMPLE_SUCCESS_FEE + EXAMPLE_PLATFORM;
const EXAMPLE_NET = EXAMPLE_RECOVERED - EXAMPLE_TOTAL_COST;

export default function PricingPage() {
  return (
    <main>
      {/* ── 1. HERO ───────────────────────────────────────────────────── */}
      <section className="container-x pt-32 pb-20 text-center">
        <Reveal>
          <span className="eyebrow">Pricing</span>
        </Reveal>
        <Reveal delay={0.06}>
          <h1 className="mt-5 font-display text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl text-balance">
            You pay when{" "}
            <span className="ink-gradient">we recover.</span>
          </h1>
        </Reveal>
        <Reveal delay={0.12}>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted text-balance">
            Syzm&apos;s incentives are wired to yours. The more revenue we recover, the more you pay — and the more you keep. A genuine profit center, not a recurring expense.
          </p>
        </Reveal>
      </section>

      {/* ── 2. PRICING CARD ───────────────────────────────────────────── */}
      <section className="container-x pb-20">
        <Reveal>
          <div className="panel relative mx-auto max-w-2xl overflow-hidden p-8 sm:p-12">
            {/* grid texture */}
            <div className="pointer-events-none absolute inset-0 grid-bg opacity-40" aria-hidden />

            <div className="relative grid gap-8 sm:grid-cols-2">
              {/* Platform fee */}
              <div className="flex flex-col gap-3">
                <p className="eyebrow">Platform fee</p>
                <p className="font-display text-4xl font-extrabold tabular-nums">
                  {formatDollars(PRICING.platformMonthly)}
                  <span className="ml-1 text-xl font-medium text-muted">/mo</span>
                </p>
                <p className="text-sm text-muted">
                  Flat access to the full platform — all processors, Syzm Brain, dashboard, and compliance automation.
                </p>
              </div>

              {/* Success fee — gold/glowing */}
              <div
                className="flex flex-col gap-3 rounded-2xl p-5"
                style={{
                  background: "rgba(255, 209, 102, 0.06)",
                  border: "1px solid rgba(255, 209, 102, 0.2)",
                  boxShadow: "0 0 50px -6px rgba(255, 209, 102, 0.3)",
                }}
              >
                <p className="eyebrow" style={{ color: "var(--color-gold)" }}>
                  Success fee
                </p>
                <p
                  className="font-display text-4xl font-extrabold tabular-nums"
                  style={{ color: "var(--color-gold)", textShadow: "0 0 30px rgba(255,209,102,.5)" }}
                >
                  {formatPct(PRICING.successFeePct)}
                  <span
                    className="ml-1 text-xl font-medium"
                    style={{ color: "var(--color-gold-soft)" }}
                  >
                    of recovered revenue
                  </span>
                </p>
                <p className="text-sm" style={{ color: "var(--color-gold-soft)" }}>
                  Charged only when a retry succeeds and the charge settles. No recovery — no fee.
                </p>
              </div>
            </div>

            {/* Divider */}
            <div className="relative my-8 hairline" />

            {/* Included items — client component for stagger animation */}
            <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-dim">
              Everything included
            </p>
            <IncludedList processors={[...PROCESSORS]} />
          </div>
        </Reveal>
      </section>

      {/* ── 3. RISK REVERSAL / GUARANTEE ──────────────────────────────── */}
      <section className="relative overflow-hidden py-16">
        <div
          className="pointer-events-none absolute inset-0"
          aria-hidden
          style={{
            background:
              "radial-gradient(ellipse 60% 80% at 50% 50%, rgba(42,223,186,0.07), transparent 70%)",
          }}
        />
        <Reveal>
          <div className="container-x relative">
            <div
              className="mx-auto max-w-3xl rounded-2xl px-8 py-10 text-center sm:px-16 sm:py-14"
              style={{
                background: "rgba(42, 223, 186, 0.05)",
                border: "1px solid rgba(42, 223, 186, 0.18)",
                boxShadow:
                  "0 0 0 1px rgba(42, 223, 186, 0.08), 0 24px 60px -24px rgba(42, 223, 186, 0.25)",
              }}
            >
              <span className="eyebrow">Risk-free guarantee</span>
              <h2 className="mt-4 font-display text-3xl font-extrabold sm:text-4xl">
                {PRICING.guaranteeDays}-day money-back guarantee
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-muted text-balance">
                If net recovered revenue doesn&apos;t exceed your platform fee in the first{" "}
                <strong className="text-ink">{PRICING.guaranteeDays} days</strong>, you pay nothing
                — not the platform fee, not a success fee. We stand behind the recovery or we
                don&apos;t get paid.
              </p>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── 4. WORKED EXAMPLE ─────────────────────────────────────────── */}
      <section className="container-x py-20">
        <Reveal>
          <div className="mx-auto max-w-2xl">
            <span className="eyebrow">Worked example</span>
            <h2 className="mt-4 font-display text-3xl font-extrabold sm:text-4xl">
              The math — plainly.
            </h2>
            <p className="mt-3 text-muted">
              A streaming company with {formatDollars(1_000_000, { compact: true })} MRR integrates
              Syzm. Numbers below are illustrative.
            </p>

            <div className="panel mt-8 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="hairline border-t-0">
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-widest text-dim">
                      Line item
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-widest text-dim">
                      Amount / mo
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="hairline">
                    <td className="px-6 py-4 text-muted">Revenue recovered by Syzm</td>
                    <td
                      className="px-6 py-4 text-right font-semibold tabular-nums"
                      style={{ color: "var(--color-gold)", textShadow: "0 0 20px rgba(255,209,102,.35)" }}
                    >
                      +{formatDollars(EXAMPLE_RECOVERED)}
                    </td>
                  </tr>
                  <tr className="hairline">
                    <td className="px-6 py-4 text-muted">
                      Success fee ({formatPct(PRICING.successFeePct)} of{" "}
                      {formatDollars(EXAMPLE_RECOVERED)})
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-ink">
                      -{formatDollars(EXAMPLE_SUCCESS_FEE)}
                    </td>
                  </tr>
                  <tr className="hairline">
                    <td className="px-6 py-4 text-muted">Platform fee</td>
                    <td className="px-6 py-4 text-right tabular-nums text-ink">
                      -{formatDollars(EXAMPLE_PLATFORM)}
                    </td>
                  </tr>
                  <tr style={{ background: "rgba(42, 223, 186, 0.04)" }}>
                    <td className="px-6 py-5 font-semibold text-ink">Net gain to your business</td>
                    <td className="px-6 py-5 text-right font-display text-xl font-extrabold tabular-nums text-teal">
                      +{formatDollars(EXAMPLE_NET)}
                      <span className="ml-1 text-sm font-medium text-muted">/mo</span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="px-6 py-4 text-xs text-dim hairline">
                Illustration only. Actual recovery depends on your decline mix, processor, and
                subscriber volume. {PROOF.betaLine}
              </p>
            </div>

            <Reveal delay={0.1}>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                {(
                  [
                    {
                      label: "Syzm total cost",
                      value: formatDollars(EXAMPLE_TOTAL_COST) + "/mo",
                      note: "platform + success fee",
                      highlight: false,
                    },
                    {
                      label: "You keep",
                      value: formatDollars(EXAMPLE_NET) + "/mo",
                      note: "revenue you were losing",
                      highlight: true,
                    },
                    {
                      label: "ROI",
                      value: (EXAMPLE_NET / EXAMPLE_TOTAL_COST).toFixed(1) + "x",
                      note: "per dollar spent on Syzm",
                      highlight: false,
                    },
                  ] as const
                ).map(({ label, value, note, highlight }) => (
                  <div
                    key={label}
                    className="rounded-xl p-4 text-center"
                    style={{
                      background: highlight
                        ? "rgba(255, 209, 102, 0.06)"
                        : "rgba(255,255,255,0.03)",
                      border: highlight
                        ? "1px solid rgba(255, 209, 102, 0.18)"
                        : "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <p className="text-xs text-dim">{label}</p>
                    <p
                      className="mt-1 font-display text-2xl font-extrabold tabular-nums"
                      style={highlight ? { color: "var(--color-gold)" } : {}}
                    >
                      {value}
                    </p>
                    <p className="mt-0.5 text-xs text-dim">{note}</p>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </Reveal>
      </section>

      {/* ── 5. FAQ ────────────────────────────────────────────────────── */}
      <section className="container-x pb-24">
        <Reveal>
          <div className="mx-auto max-w-2xl">
            <span className="eyebrow">FAQ</span>
            <h2 className="mt-4 font-display text-3xl font-extrabold sm:text-4xl">
              Common questions
            </h2>
            <FaqList />
          </div>
        </Reveal>
      </section>

      {/* ── 6. CLOSING CTA ────────────────────────────────────────────── */}
      <section className="container-x pb-28">
        <Reveal>
          <div
            className="relative mx-auto max-w-3xl overflow-hidden rounded-3xl px-8 py-16 text-center sm:px-16"
            style={{
              background:
                "linear-gradient(135deg, rgba(42,223,186,0.08), rgba(255,209,102,0.04))",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div className="pointer-events-none absolute inset-0 grid-bg opacity-30" aria-hidden />
            <div className="relative">
              <span className="eyebrow">No commitment</span>
              <h2 className="mt-4 font-display text-3xl font-extrabold sm:text-4xl">
                See your number first.
              </h2>
              <p className="mx-auto mt-4 max-w-md text-muted text-balance">
                Upload a CSV of failed transactions and get a free recovery estimate — before you
                sign anything.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link href="/audit" className="btn btn-primary px-6 py-3 text-base">
                  Get your free audit
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M5 12h14M13 6l6 6-6 6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </Link>
              </div>
              <p className="mt-4 text-xs text-dim">
                No card data required. No setup. Results in 90 seconds.
              </p>
            </div>
          </div>
        </Reveal>
      </section>
    </main>
  );
}
