"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { formatUsd } from "@/lib/utils";

function useCountUp(target: number, duration = 1600) {
  const [value, setValue] = useState(0);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(id);
    }
    let raf = 0;
    let start: number | null = null;
    const tick = (t: number) => {
      if (start === null) start = t;
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

const NODE = "flex flex-col items-center gap-2 text-center";

export default function RecoveryFlow() {
  const recovered = useCountUp(4_820_000); // cents → $48,200

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.8, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="panel grid-bg relative w-full overflow-hidden p-6 sm:p-8"
    >
      {/* counter */}
      <p className="text-[0.7rem] uppercase tracking-[0.18em] text-dim">Recovered this month</p>
      <div className="mt-1 flex items-baseline gap-3">
        <span
          className="font-display text-4xl font-extrabold tabular-nums text-gold sm:text-5xl"
          style={{ textShadow: "0 0 50px rgba(255,209,102,.45)" }}
        >
          {formatUsd(recovered)}
        </span>
        <span className="pill">Seismic Shift</span>
      </div>

      {/* flow diagram */}
      <div className="relative mt-9 grid grid-cols-3 items-start gap-2">
        {/* connector line behind the nodes */}
        <svg className="pointer-events-none absolute inset-x-0 top-5 -z-0 h-8 w-full" viewBox="0 0 300 32" preserveAspectRatio="none" aria-hidden>
          <line x1="50" y1="16" x2="150" y2="16" stroke="var(--color-teal)" strokeWidth="1.5" strokeDasharray="5 7" style={{ animation: "syzm-flow 1.1s linear infinite" }} />
          <line x1="150" y1="16" x2="250" y2="16" stroke="var(--color-gold)" strokeWidth="1.5" strokeDasharray="5 7" style={{ animation: "syzm-flow 1.1s linear infinite" }} />
        </svg>

        <div className={NODE}>
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-danger/40 bg-danger/10 text-danger">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </span>
          <span className="text-xs font-medium text-ink">Declined charge</span>
          <span className="text-[0.68rem] text-dim">false positive</span>
        </div>

        <div className={NODE}>
          <span className="relative z-10 flex h-11 w-11 items-center justify-center rounded-full border border-teal/50 bg-teal/12 text-teal" style={{ animation: "syzm-pulse 2.8s ease-in-out infinite" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 3a4 4 0 014 4 4 4 0 010 8 4 4 0 01-8 0 4 4 0 010-8 4 4 0 014-4z" stroke="currentColor" strokeWidth="1.6" /><circle cx="12" cy="11" r="1.5" fill="currentColor" /></svg>
          </span>
          <span className="text-xs font-medium text-ink">Syzm Brain</span>
          <span className="text-[0.68rem] text-dim">predicts optimal retry</span>
        </div>

        <div className={NODE}>
          <span className="flex h-11 w-11 items-center justify-center rounded-full border border-gold/50 bg-gold/12 text-gold" style={{ boxShadow: "0 0 30px -6px rgba(255,209,102,.5)" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <span className="text-xs font-medium text-ink">Recovered</span>
          <span className="text-[0.68rem] text-dim">charge succeeds</span>
        </div>
      </div>

      <p className="mt-8 text-center text-[0.7rem] italic text-dim">Illustrative — your number comes from the audit.</p>
    </motion.div>
  );
}
