"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { estimateRecoverable } from "@/lib/recovery-model";
import { PRICING } from "@/lib/site";
import { formatDollars, formatPct } from "@/lib/utils";

export default function RoiEstimator() {
  const [mrr, setMrr] = useState(1_000_000);
  const [declineRate, setDeclineRate] = useState(7);

  const r = useMemo(() => {
    const failedMonthly = mrr * (declineRate / 100);
    const est = estimateRecoverable(Math.round(failedMonthly * 100));
    const recoveredMonthly = est.recoverableCents / 100;
    const successFee = recoveredMonthly * (PRICING.successFeePct / 100);
    const syzmCost = successFee + PRICING.platformMonthly;
    return {
      failedMonthly,
      recoveredMonthly,
      recoveredAnnual: recoveredMonthly * 12,
      blendedRate: est.blendedRate,
      syzmCost,
      youKeep: Math.max(0, recoveredMonthly - syzmCost),
    };
  }, [mrr, declineRate]);

  return (
    <div className="panel grid gap-8 p-7 md:grid-cols-2 md:p-9">
      {/* controls */}
      <div className="flex flex-col justify-center gap-7">
        <Field label="Monthly recurring revenue" value={formatDollars(mrr, { compact: mrr >= 1_000_000 })}>
          <input
            type="range" min={100_000} max={10_000_000} step={50_000}
            value={mrr} onChange={(e) => setMrr(Number(e.target.value))}
            className="w-full accent-teal" aria-label="Monthly recurring revenue"
          />
        </Field>
        <Field label="Monthly payment-decline rate" value={formatPct(declineRate)}>
          <input
            type="range" min={2} max={15} step={0.5}
            value={declineRate} onChange={(e) => setDeclineRate(Number(e.target.value))}
            className="w-full accent-teal" aria-label="Monthly decline rate"
          />
        </Field>
        <p className="text-xs text-dim">
          ~{formatDollars(r.failedMonthly, { compact: true })}/mo in failed charges · {formatPct(r.blendedRate * 100, 0)} blended
          recovery (industry-default mix).
        </p>
      </div>

      {/* result */}
      <div className="panel-2 flex flex-col justify-center gap-1 p-6">
        <p className="text-[0.7rem] uppercase tracking-[0.18em] text-dim">Recoverable revenue</p>
        <p className="font-display text-4xl font-extrabold tabular-nums text-gold" style={{ textShadow: "0 0 45px rgba(255,209,102,.4)" }}>
          {formatDollars(r.recoveredMonthly)}<span className="text-lg text-muted">/mo</span>
        </p>
        <p className="text-sm text-muted">{formatDollars(r.recoveredAnnual)} a year you&apos;re currently leaking.</p>

        <div className="mt-5 space-y-2 border-t border-white/8 pt-4 text-sm">
          <Row label={`Syzm cost (${formatDollars(PRICING.platformMonthly)} + ${PRICING.successFeePct}%)`} value={`−${formatDollars(r.syzmCost)}`} />
          <Row label="You keep" value={formatDollars(r.youKeep)} strong />
        </div>

        <Link href="/audit" className="btn btn-primary mt-6">Get your exact number →</Link>
      </div>
    </div>
  );
}

function Field({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted">{label}</span>
        <span className="font-display text-lg font-bold tabular-nums text-ink">{value}</span>
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className={strong ? "font-display text-lg font-bold tabular-nums text-teal" : "tabular-nums text-ink"}>{value}</span>
    </div>
  );
}
