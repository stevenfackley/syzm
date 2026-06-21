import Link from "next/link";
import { FOOTER_LINKS, PROOF, SITE } from "@/lib/site";

export default function Footer() {
  return (
    <footer className="relative z-10 mt-32 border-t border-white/8">
      <div className="container-x grid gap-12 py-16 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="max-w-sm">
          <div className="font-display text-lg font-extrabold tracking-tight">
            {SITE.wordmark}
            <span className="text-teal">.</span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted">{SITE.subhead}</p>
          <p className="mt-4 text-xs text-dim">{PROOF.betaLine}</p>
        </div>

        {FOOTER_LINKS.map((col) => (
          <div key={col.heading}>
            <h3 className="font-display text-xs uppercase tracking-[0.18em] text-dim">{col.heading}</h3>
            <ul className="mt-4 space-y-2.5">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-muted transition-colors hover:text-teal">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="container-x flex flex-col gap-2 border-t border-white/8 py-6 text-xs text-dim sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} Syzm. Recovering revenue you already earned.</p>
        <p>Works behind {SITE ? "Stripe · Adyen · Braintree" : ""} — no billing migration required.</p>
      </div>
    </footer>
  );
}
