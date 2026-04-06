import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "SYZM Portal",
  description: "ML-driven payment recovery for streaming infrastructure",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="container">
          <header className="nav">
            <Link href="/">
              <strong>SYZM</strong>
            </Link>
            <nav className="nav-links">
              <Link href="/audit">Audit</Link>
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/integrations">Integrations</Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}

