"use client";

import Link from "next/link";
import { useState } from "react";
import { formatUsd, formatPct, cn } from "@/lib/utils";

interface Segment {
  category: string;
  label: string;
  failedCents: number;
  rate: number;
  recoverableCents: number;
}
interface AuditResult {
  rows: number;
  failedAmountCents: number;
  recoverableMonthlyCents: number;
  churnReductionPercent: number;
  blendedRate: number;
  band: { lowCents: number; highCents: number };
  segments: Segment[];
  usedDeclineCodes: boolean;
  disclaimer: string;
}

export default function AuditPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return setError("Select a CSV of failed transactions first.");
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/audit", { method: "POST", body: form });
      const payload = (await res.json()) as AuditResult & { error?: string };
      if (!res.ok) throw new Error(payload.error ?? "Audit failed");
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audit failed");
    } finally {
      setLoading(false);
    }
  }

  const maxSeg = result ? Math.max(...result.segments.map((s) => s.recoverableCents), 1) : 1;

  return (
    <section className="container-x grid gap-12 pb-24 pt-32 lg:grid-cols-2 lg:gap-16">
      {/* Left: pitch + upload */}
      <div>
        <span className="pill">The Syzm Audit</span>
        <h1 className="mt-5 font-display text-4xl font-extrabold leading-[1.05] sm:text-5xl">
          See your <span className="ink-gradient">Seismic Shift</span> in 90 seconds.
        </h1>
        <p className="mt-5 max-w-md text-muted">
          Upload a CSV of failed transactions. Syzm buckets them by decline reason and estimates the revenue
          well-timed retries would recover — finance-readable, before any technical setup.
        </p>

        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <label
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-bg/40 px-6 py-10 text-center transition-colors hover:border-teal/40",
              file && "border-teal/50",
            )}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="text-teal" aria-hidden>
              <path d="M12 16V4m0 0L8 8m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-sm font-medium text-ink">{file ? file.name : "Drop your failed-transactions CSV"}</span>
            <span className="text-xs text-dim">Columns: amount_cents + optional decline_code</span>
          </label>

          <button type="submit" disabled={loading} className="btn btn-primary w-full disabled:opacity-50">
            {loading ? "Analyzing…" : "Generate recovery estimate"}
          </button>
          {error && <p className="text-sm text-danger">{error}</p>}
          <p className="text-xs text-dim">No card data required. Tokenized references and amounts only.</p>
        </form>
      </div>

      {/* Right: result */}
      <div className="panel grid-bg relative overflow-hidden p-7">
        {!result ? (
          <div className="flex h-full min-h-[22rem] flex-col items-center justify-center text-center">
            <p className="text-sm text-dim">Your estimate appears here.</p>
            <p className="mt-2 max-w-xs text-xs text-dim">
              We never store your file — it&apos;s parsed in-request and discarded.
            </p>
          </div>
        ) : (
          <div>
            <p className="text-xs uppercase tracking-wider text-dim">Estimated recoverable / month</p>
            <p className="mt-1 font-display text-5xl font-extrabold tabular-nums text-gold" style={{ textShadow: "0 0 50px rgba(255,209,102,.45)" }}>
              {formatUsd(result.recoverableMonthlyCents)}
            </p>
            <p className="mt-1 text-sm text-muted">
              Range {formatUsd(result.band.lowCents, { compact: true })}–{formatUsd(result.band.highCents, { compact: true })} ·{" "}
              {formatPct(result.blendedRate * 100, 1)} blended recovery · {result.rows.toLocaleString()} rows
              {result.usedDeclineCodes ? " · segmented by your decline codes" : " · default decline mix"}
            </p>

            <div className="mt-6 space-y-2.5">
              {result.segments
                .slice()
                .sort((a, b) => b.recoverableCents - a.recoverableCents)
                .map((s) => (
                  <div key={s.category}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted">{s.label}</span>
                      <span className="tabular-nums text-ink">{formatUsd(s.recoverableCents)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/6">
                      <div className="h-full rounded-full bg-teal" style={{ width: `${(s.recoverableCents / maxSeg) * 100}%` }} />
                    </div>
                  </div>
                ))}
            </div>

            <Link href="/pricing" className="btn btn-primary mt-7 w-full">
              Turn this into recovered revenue →
            </Link>
            <p className="mt-3 text-xs text-dim">{result.disclaimer}</p>
          </div>
        )}
      </div>
    </section>
  );
}
