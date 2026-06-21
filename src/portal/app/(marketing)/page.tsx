import Link from "next/link";
import RecoveryFlow from "@/components/interactives/RecoveryFlow";
import RoiEstimator from "@/components/interactives/RoiEstimator";
import RetryTimeline from "@/components/interactives/RetryTimeline";
import { Reveal } from "@/components/Reveal";
import { SITE, PROCESSORS, PROOF, FEATURES, PRICING } from "@/lib/site";
import { DECLINE_CATEGORIES, CATEGORY_LABEL, DO_NOT_RETRY } from "@/lib/recovery-model";
import { formatDollars } from "@/lib/utils";

export default function HomePage() {
  return (
    <>
      {/* ===== Hero ===== */}
      <section className="relative overflow-hidden">
        <div className="grid-bg pointer-events-none absolute inset-0 -z-10 opacity-70" aria-hidden />
        <div className="container-x grid items-center gap-12 pb-20 pt-36 lg:grid-cols-[1.1fr_0.9fr] lg:pb-28 lg:pt-44">
          <div>
            <Reveal>
              <span className="eyebrow">ML payment recovery</span>
            </Reveal>
            <Reveal delay={0.08}>
              <h1 className="mt-5 font-display text-5xl font-extrabold leading-[1.03] text-balance sm:text-6xl">
                Stop letting issuing banks decide your <span className="ink-gradient">retention rate</span>.
              </h1>
            </Reveal>
            <Reveal delay={0.16}>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">{SITE.subhead}</p>
            </Reveal>
            <Reveal delay={0.24}>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href={SITE.primaryCta.href} className="btn btn-primary">
                  {SITE.primaryCta.label} →
                </Link>
                <Link href={SITE.secondaryCta.href} className="btn btn-ghost">
                  {SITE.secondaryCta.label}
                </Link>
              </div>
            </Reveal>
          </div>
          <RecoveryFlow />
        </div>
      </section>

      {/* ===== Trust strip ===== */}
      <section className="border-y border-white/8 bg-bg-soft/40">
        <div className="container-x flex flex-wrap items-center justify-between gap-4 py-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-xs uppercase tracking-wider text-dim">Works behind</span>
            {PROCESSORS.map((p) => (
              <span key={p} className="font-display text-lg font-bold text-muted">
                {p}
              </span>
            ))}
          </div>
          <span className="text-xs text-dim">{PROOF.betaLine}</span>
        </div>
      </section>

      {/* ===== Problem ===== */}
      <section className="container-x py-24 sm:py-32">
        <Reveal>
          <span className="eyebrow">The leak you can&apos;t see</span>
          <h2 className="mt-4 max-w-3xl font-display text-3xl font-extrabold leading-tight sm:text-4xl">
            Most failed subscription payments aren&apos;t lost customers. They&apos;re good cards, wrongly declined.
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="mt-6 max-w-2xl text-lg text-muted">
            Soft declines — insufficient funds, issuer timeouts, do-not-honor — are recoverable if you retry at the
            right moment, on the right processor, within the card-network rules. Static dunning gets the timing wrong
            and quietly bleeds revenue you already earned.
          </p>
        </Reveal>
      </section>

      {/* ===== How it works (teaser) ===== */}
      <section className="container-x pb-24 sm:pb-32">
        <SectionHead eyebrow="How it works" title="Four moves, behind your existing stack." />
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <Reveal key={f.key} delay={i * 0.06}>
              <article className="panel h-full p-6">
                <span className="font-display text-sm font-bold text-teal">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-3 font-display text-lg font-bold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.blurb}</p>
              </article>
            </Reveal>
          ))}
        </div>
        <div className="mt-8">
          <Link href="/how-it-works" className="text-sm font-semibold text-teal hover:text-gold">
            See the full pipeline →
          </Link>
        </div>
      </section>

      {/* ===== Retry timeline (pinned interactive) ===== */}
      <RetryTimeline />

      {/* ===== Syzm Brain / decline intelligence ===== */}
      <section className="container-x py-24 sm:py-32">
        <div className="grid gap-12 lg:grid-cols-2">
          <Reveal>
            <div>
              <span className="eyebrow">Syzm Brain</span>
              <h2 className="mt-4 font-display text-3xl font-extrabold leading-tight sm:text-4xl">
                It reads the <span className="ink-gradient">decline</span>, not just the clock.
              </h2>
              <p className="mt-6 text-lg text-muted">
                Every decline is categorized and scored. The model predicts the optimal retry window per decline code,
                issuer, and region — and routes across processors when a path is blocked. Fraud and lost/stolen cards
                are never retried.
              </p>
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="panel grid grid-cols-2 gap-2.5 p-6">
              {DECLINE_CATEGORIES.map((c) => {
                const noRetry = DO_NOT_RETRY.includes(c);
                return (
                  <div
                    key={c}
                    className={
                      "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs " +
                      (noRetry ? "border-danger/30 bg-danger/5 text-danger" : "border-white/8 bg-white/[0.02] text-muted")
                    }
                  >
                    <span className={"h-1.5 w-1.5 rounded-full " + (noRetry ? "bg-danger" : "bg-teal")} />
                    {CATEGORY_LABEL[c]}
                    {noRetry && <span className="ml-auto text-[0.6rem] uppercase">never retried</span>}
                  </div>
                );
              })}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ===== ROI estimator ===== */}
      <section className="container-x pb-24 sm:pb-32">
        <SectionHead
          eyebrow="Run your numbers"
          title="See what you're leaking — live."
          sub="Industry-default decline mix. Your exact figure comes from the free audit."
        />
        <div className="mt-12">
          <RoiEstimator />
        </div>
      </section>

      {/* ===== Comparison teaser ===== */}
      <section className="container-x pb-24 sm:pb-32">
        <div className="panel grid-bg overflow-hidden p-8 sm:p-12">
          <Reveal>
            <span className="eyebrow">Not native retries. Not a generalist.</span>
            <h2 className="mt-4 max-w-2xl font-display text-3xl font-extrabold leading-tight sm:text-4xl">
              Processor-agnostic recovery, specialized for streaming.
            </h2>
            <p className="mt-5 max-w-xl text-muted">
              Stripe&apos;s native retries can&apos;t route around a blocked processor. Horizontal tools aren&apos;t
              tuned to streaming decline patterns. Syzm is both — behind whatever stack you already run.
            </p>
            <Link href="/compare" className="mt-6 inline-block text-sm font-semibold text-teal hover:text-gold">
              Compare the alternatives →
            </Link>
          </Reveal>
        </div>
      </section>

      {/* ===== Pricing + Security teasers ===== */}
      <section className="container-x grid gap-5 pb-24 sm:pb-32 lg:grid-cols-2">
        <Reveal>
          <article className="panel flex h-full flex-col p-8">
            <span className="eyebrow">Pricing</span>
            <h3 className="mt-3 font-display text-2xl font-extrabold">Profit center, not cost center.</h3>
            <p className="mt-3 text-muted">
              {formatDollars(PRICING.platformMonthly)}/mo platform fee + {PRICING.successFeePct}% of what Syzm
              recovers. You pay more only when you make more — backed by a {PRICING.guaranteeDays}-day recovery
              guarantee.
            </p>
            <Link href="/pricing" className="mt-auto pt-6 text-sm font-semibold text-teal hover:text-gold">
              See pricing →
            </Link>
          </article>
        </Reveal>
        <Reveal delay={0.08}>
          <article className="panel flex h-full flex-col p-8">
            <span className="eyebrow">Security &amp; trust</span>
            <h3 className="mt-3 font-display text-2xl font-extrabold">Built to sit behind your money.</h3>
            <p className="mt-3 text-muted">
              No raw card data — tokenized references only. Signature-verified webhooks, an authenticated scoring API,
              tenant-isolated data, and scheme-compliant retries by default.
            </p>
            <Link href="/security" className="mt-auto pt-6 text-sm font-semibold text-teal hover:text-gold">
              Review security →
            </Link>
          </article>
        </Reveal>
      </section>

      {/* ===== Final CTA ===== */}
      <section className="container-x pb-32">
        <div className="panel grid-bg relative overflow-hidden p-10 text-center sm:p-16">
          <Reveal>
            <h2 className="mx-auto max-w-2xl font-display text-4xl font-extrabold leading-tight text-balance sm:text-5xl">
              Find your <span className="ink-gradient">Seismic Shift</span>.
            </h2>
            <p className="mx-auto mt-5 max-w-lg text-lg text-muted">
              Upload a CSV of failed transactions and see the revenue Syzm would recover — in about 90 seconds, before
              you talk to anyone.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/audit" className="btn btn-primary">
                Get your free audit →
              </Link>
              <Link href="/how-it-works" className="btn btn-ghost">
                How it works
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}

function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <Reveal>
      <span className="eyebrow">{eyebrow}</span>
      <h2 className="mt-4 max-w-2xl font-display text-3xl font-extrabold leading-tight sm:text-4xl">{title}</h2>
      {sub && <p className="mt-4 max-w-xl text-muted">{sub}</p>}
    </Reveal>
  );
}
