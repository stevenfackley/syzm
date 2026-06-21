"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { NAV, SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

export default function MarketingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-colors duration-300",
        scrolled ? "border-b border-white/8 bg-bg/70 backdrop-blur-xl" : "border-b border-transparent",
      )}
    >
      <div className="container-x flex h-16 items-center justify-between">
        <Link href="/" className="font-display text-lg font-extrabold tracking-tight">
          {SITE.wordmark}
          <span className="text-teal">.</span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm text-muted transition-colors hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link href="/dashboard" className="text-sm text-muted transition-colors hover:text-ink">
            Sign in
          </Link>
          <Link href={SITE.primaryCta.href} className="btn btn-primary text-sm">
            {SITE.primaryCta.label}
          </Link>
        </div>

        <button
          type="button"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 md:hidden"
        >
          <span className="sr-only">Menu</span>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
            <path d={open ? "M4 4l10 10M14 4L4 14" : "M2 5h14M2 9h14M2 13h14"} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="border-t border-white/8 bg-bg/95 backdrop-blur-xl md:hidden">
          <nav className="container-x flex flex-col gap-1 py-4">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-2.5 text-sm text-muted hover:bg-white/5 hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
            <Link href={SITE.primaryCta.href} onClick={() => setOpen(false)} className="btn btn-primary mt-2 text-sm">
              {SITE.primaryCta.label}
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
