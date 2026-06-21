import type { Metadata } from "next";
import Link from "next/link";
import { COMPETITORS, PROCESSORS, SITE } from "@/lib/site";
import { Reveal } from "@/components/Reveal";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Compare",
};

// ── Inline SVG icons ────────────────────────────────────────────────────────

function IconCheck({ className }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <circle cx="9" cy="9" r="8.5" stroke="currentColor" strokeOpacity="0.18" />
      <path
        d="M5.5 9.25l2.5 2.5 4.5-5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconX({ className }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <circle cx="9" cy="9" r="8.5" stroke="currentColor" strokeOpacity="0.14" />
      <path
        d="M6.5 6.5l5 5M11.5 6.5l-5 5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── Section: Hero ────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="container-x pb-20 pt-32">
      <Reveal>
        <span className="eyebrow">Compare</span>
      </Reveal>

      <Reveal delay={0.05}>
        <h1 className="mt-4 max-w-2xl font-display text-4xl font-extrabold leading-[1.06] sm:text-5xl lg:text-6xl">
          Not native retries.{" "}
          <span className="ink-gradient">Not a generalist.</span>
        </h1>
      </Reveal>

      <Reveal delay={0.1}>
        <p className="mt-5 max-w-xl text-lg text-muted text-balance">
          Most recovery tools are either locked to a single processor, or built for
          generic SaaS. Syzm is different on two axes: it routes retries across{" "}
          <span className="text-ink font-medium">any processor stack</span>, and
          every timing model is calibrated to{" "}
          <span className="text-ink font-medium">streaming-specific</span> decline
          patterns.
        </p>
      </Reveal>

      <Reveal delay={0.15}>
        <div className="mt-8 flex flex-wrap gap-2.5">
          {PROCESSORS.map((p) => (
            <span key={p} className="pill">
              {p}
            </span>
          ))}
          <span className="pill">More</span>
        </div>
      </Reveal>
    </section>
  );
}

// ── Section: Comparison table ────────────────────────────────────────────────

function CompareTable() {
  return (
    <section className="container-x pb-24">
      <Reveal>
        <div className="overflow-x-auto rounded-2xl border border-white/8">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-white/8 bg-surface/60">
                <th className="py-3.5 pl-6 pr-4 text-left font-medium text-dim tracking-wide">
                  Tool
                </th>
                <th className="px-4 py-3.5 text-center font-medium text-dim tracking-wide">
                  Processor-agnostic
                </th>
                <th className="px-4 py-3.5 text-center font-medium text-dim tracking-wide">
                  ML-timed retries
                </th>
                <th className="px-4 py-3.5 text-left font-medium text-dim tracking-wide">
                  Category
                </th>
                <th className="py-3.5 pl-4 pr-6 text-left font-medium text-dim tracking-wide">
                  Notes
                </th>
              </tr>
            </thead>
            <tbody>
              {COMPETITORS.map((c, i) => {
                const isSyzm = i === 0;
                return (
                  <tr
                    key={c.name}
                    className={cn(
                      "border-b border-white/8 transition-colors",
                      isSyzm
                        ? "bg-teal/5 last:border-b-0"
                        : "hover:bg-white/[0.015] last:border-b-0",
                    )}
                  >
                    {/* Name */}
                    <td className="py-4 pl-6 pr-4">
                      <span
                        className={cn(
                          "font-semibold",
                          isSyzm ? "text-teal" : "text-ink",
                        )}
                      >
                        {c.name}
                      </span>
                      {isSyzm && (
                        <span
                          className="ml-2 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest"
                          style={{
                            background: "rgba(42,223,186,0.14)",
                            color: "var(--color-teal)",
                            border: "1px solid rgba(42,223,186,0.28)",
                          }}
                        >
                          Us
                        </span>
                      )}
                    </td>

                    {/* Processor-agnostic */}
                    <td className="px-4 py-4 text-center">
                      {c.processorAgnostic ? (
                        <span className="inline-flex justify-center text-teal">
                          <IconCheck />
                          <span className="sr-only">Yes</span>
                        </span>
                      ) : (
                        <span className="inline-flex justify-center text-dim">
                          <IconX />
                          <span className="sr-only">No</span>
                        </span>
                      )}
                    </td>

                    {/* ML-timed */}
                    <td className="px-4 py-4 text-center">
                      {c.mlTimed ? (
                        <span className="inline-flex justify-center text-teal">
                          <IconCheck />
                          <span className="sr-only">Yes</span>
                        </span>
                      ) : (
                        <span className="inline-flex justify-center text-dim">
                          <IconX />
                          <span className="sr-only">No</span>
                        </span>
                      )}
                    </td>

                    {/* Category */}
                    <td className="px-4 py-4 text-muted">{c.kind}</td>

                    {/* Note */}
                    <td className="py-4 pl-4 pr-6 text-dim">{c.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-dim">
          Competitor data is based on public documentation as of 2026. Capabilities
          change — verify with each vendor.
        </p>
      </Reveal>
    </section>
  );
}

// ── Section: Differentiator cards ────────────────────────────────────────────

interface DiffCardProps {
  icon: React.ReactNode;
  title: string;
  body: string;
  delay?: number;
}

function DiffCard({ icon, title, body, delay = 0 }: DiffCardProps) {
  return (
    <Reveal delay={delay} className="h-full">
      <div className="panel flex h-full flex-col gap-4 p-7">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-xl"
          style={{ background: "rgba(42,223,186,0.1)", color: "var(--color-teal)" }}
        >
          {icon}
        </div>
        <h3 className="font-display text-lg font-bold text-ink">{title}</h3>
        <p className="text-sm text-muted leading-relaxed">{body}</p>
      </div>
    </Reveal>
  );
}

function IconRoute() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M3 10h14M3 10l4-4M3 10l4 4M17 5h-4a2 2 0 00-2 2v6a2 2 0 002 2h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconStream() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M2 6h4l3 8 3-11 3 8 2-5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M10 2L4 5v5c0 3.87 2.55 7.5 6 8.5 3.45-1 6-4.63 6-8.5V5l-6-3z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 10.5l2 2 3-3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DifferentiatorCards() {
  return (
    <section className="container-x pb-24">
      <Reveal>
        <h2 className="mb-10 font-display text-2xl font-bold text-ink sm:text-3xl">
          Where Syzm is different
        </h2>
      </Reveal>

      <div className="grid gap-5 sm:grid-cols-3">
        <DiffCard
          delay={0}
          icon={<IconRoute />}
          title="Processor-agnostic routing"
          body="When Stripe soft-declines a charge, Syzm can route the retry through Adyen or Braintree. Stripe's native Smart Retries can't leave Stripe. One blocked path no longer means a churned subscriber."
        />
        <DiffCard
          delay={0.07}
          icon={<IconStream />}
          title="Streaming-specialized"
          body="Monthly-billed streaming has its own decline taxonomy — card-updater lag, issuer maintenance windows, weekend dip patterns. Syzm's ML model is trained on that mix, not generic SaaS cohorts."
        />
        <DiffCard
          delay={0.14}
          icon={<IconShield />}
          title="Compliant by default"
          body="Visa Retry Advice limits and US issuer blackout windows are enforced in the retry engine automatically. Recovery never accumulates scheme fines or chargeback risk."
        />
      </div>
    </section>
  );
}

// ── Section: Behind your stack ───────────────────────────────────────────────

function BehindYourStack() {
  return (
    <section className="container-x pb-24">
      <Reveal>
        <div
          className="relative overflow-hidden rounded-2xl border border-white/8 px-8 py-10 sm:px-12"
          style={{
            background:
              "linear-gradient(135deg, rgba(42,223,186,0.07) 0%, rgba(17,23,51,0) 60%), var(--color-surface)",
          }}
        >
          {/* Subtle grid overlay */}
          <div className="pointer-events-none absolute inset-0 grid-bg opacity-40" />

          <div className="relative grid gap-8 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <span className="eyebrow">No migration required</span>
              <h2 className="mt-3 font-display text-2xl font-bold text-ink sm:text-3xl text-balance">
                Syzm sits behind your existing processor stack — not in front of it.
              </h2>
              <p className="mt-3 max-w-prose text-muted text-balance">
                Connect via webhook in an afternoon. No card-vault migration, no
                processor swap, no downtime. Your current Stripe, Adyen, or Braintree
                setup stays exactly as-is — Syzm handles the recovery layer.
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap gap-3 sm:flex-col">
              {PROCESSORS.map((p) => (
                <div
                  key={p}
                  className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-ink"
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: "var(--color-teal)" }}
                  />
                  {p}
                </div>
              ))}
              <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-dim">
                <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
                More coming
              </div>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

// ── Section: Closing CTA ─────────────────────────────────────────────────────

function ClosingCta() {
  return (
    <section className="container-x pb-32">
      <Reveal>
        <div className="flex flex-col items-center gap-6 text-center">
          <h2 className="max-w-xl font-display text-3xl font-extrabold text-ink sm:text-4xl text-balance">
            See exactly how much{" "}
            <span className="ink-gradient">your stack leaks</span> every month.
          </h2>
          <p className="max-w-md text-muted text-balance">
            Upload a CSV of failed charges. In 90 seconds you get a segmented
            recovery estimate — no card data required, no commitment.
          </p>
          <Link
            href={SITE.primaryCta.href}
            className="btn btn-primary px-8 py-3.5 text-base"
          >
            {SITE.primaryCta.label}
          </Link>
          <p className="text-xs text-dim">{SITE.tagline} · private beta</p>
        </div>
      </Reveal>
    </section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ComparePage() {
  return (
    <main>
      <Hero />
      <CompareTable />
      <DifferentiatorCards />
      <BehindYourStack />
      <ClosingCta />
    </main>
  );
}
