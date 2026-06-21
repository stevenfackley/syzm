"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

interface Attempt {
  t: string;
  ok?: boolean;
}

const STATIC: Attempt[] = [
  { t: "+0h" },
  { t: "+24h" },
  { t: "+72h" },
  { t: "+120h" },
];

const SYZM: Attempt[] = [
  { t: "+0h" },
  { t: "post-blackout" },
  { t: "Tue 9:02a · payday", ok: true },
];

export default function RetryTimeline() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const dots = gsap.utils.toArray<HTMLElement>(".rt-dot");
      gsap.set(dots, { opacity: 0.2, scale: 0.85 });
      gsap.set(".rt-out", { opacity: 0, y: 8 });

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: root.current,
          start: "top top",
          end: "+=130%",
          pin: true,
          scrub: 0.6,
        },
      });

      dots.forEach((el) => tl.to(el, { opacity: 1, scale: 1, duration: 0.5 }, ">-0.15"));
      tl.to(".rt-out", { opacity: 1, y: 0, duration: 0.6, stagger: 0.2 }, ">");
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <div ref={root} className="flex min-h-screen flex-col justify-center py-16">
      <div className="container-x">
        <p className="eyebrow">Timing is the product</p>
        <h2 className="mt-3 max-w-2xl font-display text-3xl font-extrabold sm:text-4xl">
          The same four declines. <span className="ink-gradient">Two outcomes.</span>
        </h2>
        <p className="mt-3 max-w-xl text-muted">
          Static dunning retries on a fixed clock and keeps hitting the same wall. Syzm waits for the moment the
          charge will actually clear.
        </p>

        <div className="mt-12 space-y-10">
          <Track
            kind="static"
            title="Static dunning"
            subtitle="fixed 24h / 72h schedule"
            attempts={STATIC}
            outcome="Customer churns — revenue lost"
          />
          <Track
            kind="syzm"
            title="Syzm · ML-timed"
            subtitle="retries placed where they clear"
            attempts={SYZM}
            outcome="Recovered on attempt 3 — within Visa limits"
          />
        </div>
      </div>
    </div>
  );
}

function Track({
  kind,
  title,
  subtitle,
  attempts,
  outcome,
}: {
  kind: "static" | "syzm";
  title: string;
  subtitle: string;
  attempts: Attempt[];
  outcome: string;
}) {
  const won = kind === "syzm";
  return (
    <div className="panel p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-bold">{title}</h3>
        <span className="text-xs text-dim">{subtitle}</span>
      </div>

      <div className="relative mt-7 flex items-center justify-between">
        <div className="absolute inset-x-3 top-4 h-px bg-white/10" aria-hidden />
        {attempts.map((a, i) => {
          const success = a.ok;
          const fail = !a.ok;
          return (
            <div key={i} className="rt-dot relative z-10 flex flex-col items-center gap-2">
              <span
                className={
                  "flex h-9 w-9 items-center justify-center rounded-full border " +
                  (success
                    ? "border-gold/50 bg-gold/15 text-gold"
                    : "border-danger/40 bg-danger/10 text-danger")
                }
                style={success ? { boxShadow: "0 0 26px -6px rgba(255,209,102,.55)" } : undefined}
              >
                {success ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                ) : (
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
                )}
              </span>
              <span className="whitespace-nowrap text-[0.68rem] text-muted">{a.t}</span>
              {fail && <span className="text-[0.6rem] uppercase tracking-wide text-dim">declined</span>}
            </div>
          );
        })}
      </div>

      <div className={"rt-out mt-6 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold " + (won ? "bg-gold/12 text-gold" : "bg-danger/10 text-danger")}>
        {outcome}
      </div>
    </div>
  );
}
