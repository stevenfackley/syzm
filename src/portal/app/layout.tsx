import type { Metadata } from "next";
import { Syne, DM_Sans } from "next/font/google";
import "./globals.css";

const syne = Syne({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-syne",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-dm-sans",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://syzm.com"),
  title: {
    default: "Syzm — ML payment recovery that turns failed charges into recovered revenue",
    template: "%s · Syzm",
  },
  description:
    "Syzm sits behind your Stripe, Adyen, or Braintree stack and uses ML-timed retries to recover the revenue false-positive declines leak every month. Profit center, not a cost center.",
  keywords: [
    "payment recovery",
    "involuntary churn",
    "failed payments",
    "dunning",
    "smart retries",
    "subscription revenue",
  ],
  openGraph: {
    type: "website",
    title: "Syzm — stop letting issuing banks decide your retention rate",
    description:
      "ML-timed retries that recover the revenue false-positive declines leak every month. Behind your existing Stripe, Adyen, or Braintree stack.",
    siteName: "Syzm",
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${syne.variable} ${dmSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
