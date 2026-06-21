import Link from "next/link";
import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";

export const metadata: Metadata = {
  title: "Security & trust",
};

/* ── inline SVG primitives ───────────────────────────────────────── */

function IconCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="7.5" stroke="currentColor" strokeOpacity="0.3" />
      <path d="M4.5 8l2.5 2.5L11.5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3L4 7v5c0 5 3.5 9.4 8 10.6C16.5 21.4 20 17 20 12V7L12 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 11V7a4 4 0 118 0v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="16" r="1.5" fill="currentColor" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── shipped controls data ───────────────────────────────────────── */

interface Control {
  title: string;
  body: string;
}

const SHIPPED_CONTROLS: Control[] = [
  {
    title: "No raw card data",
    body: "Syzm works exclusively with tokenized references and amounts — a PAN never touches our stack, keeping Syzm out of PCI cardholder-data scope.",
  },
  {
    title: "Signature-verified webhooks",
    body: "Every Stripe, Adyen, and Braintree decline event is HMAC signature-verified with replay protection before any processing occurs.",
  },
  {
    title: "Authenticated scoring API",
    body: "Syzm Brain requires an API key on every request. There is no anonymous or unauthenticated access path.",
  },
  {
    title: "Tenant isolation via RLS",
    body: "Postgres row-level security enforces hard tenant boundaries — every customer's recovery data is segregated at the database layer.",
  },
  {
    title: "Idempotent event processing",
    body: "Duplicate event delivery is detected and discarded before execution, preventing double-charge scenarios.",
  },
  {
    title: "Scheme-compliant retry logic",
    body: "Visa retry limits and US issuer maintenance blackout windows are enforced automatically — recovery never converts to scheme fines.",
  },
];

/* ── roadmap items ───────────────────────────────────────────────── */

interface RoadmapItem {
  title: string;
  status: string;
  detail: string;
}

const ROADMAP: RoadmapItem[] = [
  {
    title: "SOC 2 Type I",
    status: "In progress",
    detail: "Audit scoping underway. No report has been issued yet.",
  },
  {
    title: "DPA & GDPR data-residency",
    status: "Planned",
    detail: "A signed Data Processing Agreement and EU-region storage option for customers who require it.",
  },
  {
    title: "Penetration testing",
    status: "Planned",
    detail: "Third-party pentest scheduled prior to general availability.",
  },
];

/* ── page ────────────────────────────────────────────────────────── */

export default function SecurityPage() {
  return (
    <div className="pb-32 pt-32">
      {/* 1 · Hero */}
      <section className="container-x text-center">
        <Reveal>
          <span className="eyebrow">Security &amp; Trust</span>
        </Reveal>
        <Reveal delay={0.07}>
          <h1 className="mt-5 font-display text-4xl font-extrabold leading-[1.06] tracking-tight sm:text-5xl lg:text-6xl text-balance">
            Built to sit behind{" "}
            <span className="ink-gradient">your money.</span>
          </h1>
        </Reveal>
        <Reveal delay={0.14}>
          <p className="mt-6 mx-auto max-w-2xl text-lg text-muted text-balance">
            Syzm is designed to minimise its blast radius around payments. This page describes exactly what we ship today — and what we have not finished yet. We will not claim a certification we have not earned.
          </p>
        </Reveal>
      </section>

      {/* 2 · Shipped controls */}
      <section className="container-x mt-24">
        <Reveal>
          <div className="flex items-center gap-3 mb-8">
            <span className="text-teal">
              <IconShield />
            </span>
            <h2 className="font-display text-2xl font-bold">
              Shipped today
            </h2>
            <span className="pill">Live in production</span>
          </div>
          <p className="text-muted max-w-xl -mt-4 mb-10">
            These controls are implemented and running on every request, right now.
          </p>
        </Reveal>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SHIPPED_CONTROLS.map((ctrl, i) => (
            <Reveal key={ctrl.title} delay={i * 0.05}>
              <ControlCard ctrl={ctrl} />
            </Reveal>
          ))}
        </div>
      </section>

      {/* 3 · Roadmap */}
      <section className="container-x mt-24">
        <Reveal>
          <div className="flex items-center gap-3 mb-8">
            <span className="text-dim">
              <IconClock />
            </span>
            <h2 className="font-display text-2xl font-bold text-muted">
              On the roadmap
            </h2>
          </div>
          <p className="text-dim max-w-xl -mt-4 mb-10 text-sm">
            The items below are not complete. We list them here so procurement teams know what is planned and can ask us directly about timelines.
          </p>
        </Reveal>

        <div className="flex flex-col gap-3">
          {ROADMAP.map((item, i) => (
            <Reveal key={item.title} delay={i * 0.05}>
              <RoadmapRow item={item} />
            </Reveal>
          ))}
        </div>
      </section>

      {/* 4 · Data handling */}
      <section className="container-x mt-24">
        <Reveal>
          <h2 className="font-display text-2xl font-bold mb-6">
            What data Syzm handles
          </h2>
        </Reveal>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Reveal delay={0.06}>
            <div className="panel p-6 h-full">
              <p className="text-xs uppercase tracking-widest text-teal mb-3">We store</p>
              <ul className="space-y-2.5 text-sm text-muted">
                {[
                  "Tokenized payment references (not PANs)",
                  "Transaction amounts and currencies",
                  "Decline codes and metadata",
                  "Retry timestamps and outcomes",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-teal">
                    <span className="mt-0.5 shrink-0"><IconCheck /></span>
                    <span className="text-muted">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal delay={0.12}>
            <div className="panel p-6 h-full border-danger/20">
              <p className="text-xs uppercase tracking-widest text-danger mb-3">We never store</p>
              <ul className="space-y-2.5 text-sm text-muted">
                {[
                  "Primary account numbers (PANs)",
                  "CVV / CVC security codes",
                  "Full cardholder names or addresses",
                  "Bank account numbers",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="mt-0.5 shrink-0 text-danger">
                      <circle cx="8" cy="8" r="7.5" stroke="currentColor" strokeOpacity="0.3" />
                      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal delay={0.18}>
            <div className="panel p-6 h-full">
              <p className="text-xs uppercase tracking-widest text-dim mb-3">Audit CSV uploads</p>
              <p className="text-sm text-muted">
                When you use the free audit tool, your CSV is parsed in-request and discarded immediately. We do not write it to disk or any persistent store.
              </p>
              <p className="mt-4 text-sm text-muted">
                The audit result (aggregate statistics only) is returned to your browser — no raw rows leave the parser.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* 5 · Responsible disclosure */}
      <section className="container-x mt-24">
        <Reveal>
          <div className="panel p-8 flex flex-col sm:flex-row items-start gap-6">
            <span className="text-teal shrink-0 mt-0.5">
              <IconLock />
            </span>
            <div>
              <h2 className="font-display text-xl font-bold mb-2">
                Responsible disclosure
              </h2>
              <p className="text-muted text-sm max-w-prose">
                If you discover a security issue, please report it to{" "}
                <a
                  href="mailto:security@syzm.com"
                  className="text-teal underline underline-offset-2 hover:text-gold transition-colors"
                >
                  security@syzm.com
                </a>
                . We aim to acknowledge valid reports within 48 hours and resolve confirmed vulnerabilities before public disclosure. We do not offer a formal bug-bounty programme yet, but we take every report seriously.
              </p>
            </div>
          </div>
        </Reveal>
      </section>

      {/* 6 · Closing CTA */}
      <section className="container-x mt-24 text-center">
        <Reveal>
          <h2 className="font-display text-3xl font-extrabold text-balance">
            See how Syzm recovers revenue
          </h2>
          <p className="mt-4 text-muted max-w-md mx-auto text-balance">
            Upload a CSV of failed transactions and get a free recovery estimate — no card data required.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link href="/audit" className="btn btn-primary">
              Get your free audit
            </Link>
            <Link href="/how-it-works" className="btn btn-ghost">
              See how Syzm Brain works
            </Link>
          </div>
        </Reveal>
      </section>
    </div>
  );
}

/* ── sub-components (co-located, no shared file touches) ─────────── */

function ControlCard({ ctrl }: { ctrl: Control }) {
  return (
    <div className="panel p-5 flex flex-col gap-3 h-full">
      <span className="text-teal">
        <IconCheck />
      </span>
      <h3 className="font-display font-semibold text-base text-ink leading-snug">
        {ctrl.title}
      </h3>
      <p className="text-sm text-muted leading-relaxed">{ctrl.body}</p>
    </div>
  );
}

function RoadmapRow({ item }: { item: RoadmapItem }) {
  const statusColor =
    item.status === "In progress"
      ? "bg-gold/10 text-gold border-gold/25"
      : "bg-white/5 text-dim border-white/10";

  return (
    <div className="panel-2 flex flex-col sm:flex-row sm:items-center gap-3 px-5 py-4">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold shrink-0 ${statusColor}`}
      >
        <IconClock />
        {item.status}
      </span>
      <span className="font-medium text-muted">{item.title}</span>
      <span className="text-sm text-dim sm:ml-auto sm:text-right max-w-sm">
        {item.detail}
      </span>
    </div>
  );
}
