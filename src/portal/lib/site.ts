/** Site-wide copy, navigation, and product facts. Keep marketing claims honest. */

export const SITE = {
  name: "Syzm",
  wordmark: "SYZM",
  url: "https://syzm.com",
  tagline: "ML payment recovery",
  // The headline lifted verbatim from the sales narrative.
  headline: "Stop letting issuing banks decide your retention rate.",
  subhead:
    "Syzm sits behind your Stripe, Adyen, or Braintree stack and uses ML-timed retries to recover the revenue false-positive declines quietly leak every month. Profit center — not a cost center.",
  primaryCta: { label: "Get your free audit", href: "/audit" },
  secondaryCta: { label: "See how Syzm Brain works", href: "/how-it-works" },
} as const;

export const NAV: { label: string; href: string }[] = [
  { label: "How it works", href: "/how-it-works" },
  { label: "Compare", href: "/compare" },
  { label: "Pricing", href: "/pricing" },
  { label: "Security", href: "/security" },
];

export const PROCESSORS = ["Stripe", "Adyen", "Braintree"] as const;

export const PRICING = {
  platformMonthly: 1000,
  successFeePct: 5,
  guaranteeDays: 90,
} as const;

/** Honest status — Syzm is in private beta. Do not invent logos or certifications. */
export const PROOF = {
  betaLine: "In private beta with design-partner streaming services.",
  // Blended recovery rate produced by the default decline mix (~26%). Shown as an estimate.
  blendedRecoveryEstimatePct: 26,
} as const;

export interface Feature {
  key: string;
  title: string;
  blurb: string;
}

export const FEATURES: Feature[] = [
  {
    key: "ingest",
    title: "Webhook ingestion",
    blurb: "Every soft decline from Stripe, Adyen, and Braintree, captured and normalized in real time — signature-verified, no raw card data.",
  },
  {
    key: "brain",
    title: "Syzm Brain",
    blurb: "An ML model predicts the optimal retry moment per decline code, issuer, and region — not a fixed cron interval.",
  },
  {
    key: "cross",
    title: "Cross-processor recovery",
    blurb: "When one processor path is blocked, Syzm routes the retry through an alternate gateway. Stripe-native retries can't do that.",
  },
  {
    key: "compliant",
    title: "Compliant by default",
    blurb: "Visa retry limits and US issuer maintenance blackouts enforced automatically, so recovery never turns into scheme fines.",
  },
];

/** Competitor framing for the comparison page. Differentiators, not disparagement. */
export interface Competitor {
  name: string;
  kind: string;
  processorAgnostic: boolean;
  mlTimed: boolean;
  note: string;
}

export const COMPETITORS: Competitor[] = [
  { name: "Syzm", kind: "Involuntary-churn infrastructure", processorAgnostic: true, mlTimed: true, note: "Streaming-specialized, behind any stack." },
  { name: "Stripe smart retries", kind: "Native to one processor", processorAgnostic: false, mlTimed: true, note: "Locked to Stripe; can't route around a blocked path." },
  { name: "Butter Payments", kind: "Horizontal recovery", processorAgnostic: true, mlTimed: true, note: "Generalist; not tuned to streaming decline patterns." },
  { name: "Gravy", kind: "Recovery + retention", processorAgnostic: false, mlTimed: false, note: "Heavier integration; single-processor leaning." },
  { name: "FlexPay", kind: "Recovery", processorAgnostic: true, mlTimed: true, note: "Enterprise-focused; longer onboarding." },
];

export const FOOTER_LINKS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "How it works", href: "/how-it-works" },
      { label: "Free audit", href: "/audit" },
      { label: "Pricing", href: "/pricing" },
      { label: "Compare", href: "/compare" },
    ],
  },
  {
    heading: "Trust",
    links: [
      { label: "Security", href: "/security" },
      { label: "Dashboard", href: "/dashboard" },
      { label: "Integrations", href: "/integrations" },
    ],
  },
];
