import Link from "next/link";

const APP_NAV = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Audit", href: "/audit" },
  { label: "Integrations", href: "/integrations" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-white/8 bg-bg/80 backdrop-blur-xl">
        <div className="container-x flex h-16 items-center justify-between">
          <Link href="/" className="font-display text-lg font-extrabold tracking-tight">
            SYZM<span className="text-teal">.</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm text-muted">
            {APP_NAV.map((item) => (
              <Link key={item.href} href={item.href} className="transition-colors hover:text-ink">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="container-x py-12">{children}</main>
    </div>
  );
}
