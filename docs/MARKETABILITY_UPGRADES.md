# Syzm — Top 10 Marketability Upgrades

Synthesized from three inputs: a **code audit** (what's actually built), a **docs/GTM audit**, and a **6-model Perplexity council** (GPT‑5.4, Claude Sonnet 4.6, Gemini 3.1 Pro, nemotron, kimi, sonar). Ranked by impact on winning demos and closing deals. Each item notes **why it matters**, whether it's **table‑stakes or a differentiator**, and **status** after this work session.

> Honest framing: the single biggest finding was that the product was mostly scaffold — payment execution was a `Math.random()` stub, the ML model file didn't exist, webhooks were unverified, the Brain API was unauthenticated, and the dashboard showed hardcoded numbers. A beautiful site on top of that gets killed in the first technical eval. So the list is split: **make it real & safe** before **make it sell**.

---

## The ranked list

### 1. Make recovery actually work — *table‑stakes* — ✅ shipped
Execution was a `Math.abs(hash()) % 100 > 35` fake. Replaced with **real Stripe / Adyen / Braintree REST calls** (idempotency keys, tokenized refs only) and **Brain‑driven retry timing on every reschedule** (was a hardcoded 90‑min fallback). The core value prop now exists. *Where: `src/ingest`.*

### 2. Survive a security / procurement review — *table‑stakes* — ✅ shipped
Was: unverified webhooks, anonymous Brain API open to `0.0.0.0/0`, no tenant isolation. Now: **HMAC signature verification + replay protection** on all three processors, **API‑key auth** on the Brain, **Postgres RLS multi‑tenancy**, **idempotent** dedupe to prevent double charges, and a public **/security** page stating the real posture. *Where: `src/ingest`, `src/brain`, `src/sql`, `/security`.*

### 3. A credible, segmented audit — *differentiator* — ✅ shipped
The audit (the GTM wedge) used a flat **0.5%** multiplier — indefensible. Now a **decline‑category‑segmented estimator** (insufficient‑funds ~35%, do‑not‑honor ~22%, transient ~45%, … fraud 0% never retried) with a confidence band, mirrored in the Brain and the marketing ROI tools. *Where: `src/brain/recovery_model.py`, `lib/recovery-model.ts`, `/audit`.*

### 4. Productize the audit as a public PLG wedge — *differentiator* — ✅ shipped
The best asset Syzm has. Now an **ungated, 90‑second** `/audit`: upload a CSV → "Seismic Shift" number + per‑segment breakdown, no sales gate. Plus a live **ROI estimator** on the homepage. *Where: `/audit`, homepage ROI section.*

### 5. Pricing transparency + risk reversal — *table‑stakes* — ✅ shipped
"Contact us" adds weeks to every deal. Now a **/pricing** page: `$1,000/mo + 5% of recovered revenue`, profit‑center framing, a worked $1M‑MRR example, and a **90‑day recovery guarantee** ("recover more than the platform fee or pay nothing"). *Where: `/pricing`.*

### 6. Real dashboard data — *table‑stakes* — ✅ shipped
Hardcoded constants (`revenueSavedToday = 18234`) fail the instant a buyer opens DevTools. Now wired to the **`syzm_dashboard_metrics`** view with honest empty states when not connected; a **`syzm_decline_intelligence`** view backs decline‑code transparency. *Where: `src/sql`, `/dashboard`.*

### 7. Escape "sounds like Stripe, but smaller" — *differentiator* — ✅ shipped
Council's sharpest point. Positioned as **involuntary‑churn infrastructure**, **processor‑agnostic** (route around a blocked path — Stripe‑native retries can't), and a **streaming vertical‑specialist**. New **/compare** page vs Stripe / Butter / Gravy / FlexPay. *Where: `/compare`, homepage.*

### 8. Observability, tests & CI — *table‑stakes* — ✅ shipped
SOC 2 and enterprise reviews demand evidence of testing and monitoring. Added **structured JSON logging + correlation IDs**, **92 passing unit tests** (43 brain / 49 ingest), and a **GitHub Actions CI** (pytest, deno test, portal build, gitleaks secret scan). *Where: `src/brain`, `src/ingest`, `.github/workflows/ci.yml`.*

### 9. Compliant‑by‑default as a marketing angle — *differentiator* — ✅ shipped
Visa's retry‑fine enforcement is a real fear. Syzm enforces **<4 retries** and skips the **US issuer maintenance blackout** automatically, and never retries fraud/lost/stolen. Now surfaced in copy across `/how-it-works`, `/security`, `/compare`. *Where: `src/ingest/_shared/guards.ts`, marketing copy.*

### 10. SOC 2 + GDPR/DPA — *table‑stakes* — ⏳ roadmap (cannot be coded)
A hard procurement gate, especially for EU streamers. **Cannot be faked** — the `/security` page lists SOC 2 Type I, a signed DPA, EU data residency, and pen‑testing as **explicitly in‑progress**, not earned. This is the top non‑engineering priority.

---

## Still TODO — needs data or process, not code
- **Published recovery benchmarks** with methodology (anonymized aggregate from the 3 design partners). Competitors openly claim "recover 30–70% of failed payments"; Syzm currently shows an illustrative ~26% blended estimate.
- **A design‑partner case study** (even anonymized: "a Tier‑2 SVOD with 500k subs recovered $X/mo").
- **SOC 2 Type I** (~3–4 months) and a **DPA + EU data‑residency** option.
- **Network‑tokenization** surfaced as a marketed feature (independent +2–4% auth lift) rather than a compliance footnote.

## Council positioning guidance (verbatim themes)
- Defeat the **"sounds like Stripe, but smaller"** frame in every GTM asset.
- Frame as **pure involuntary‑churn infrastructure** — "we don't build cancel flows; we recover failed payments before the customer notices" (avoids Churnkey/voluntary‑churn confusion).
- Win as a **streaming specialist**, not on price parity with horizontal tools (Butter).
- Note distribution gaps competitors exploit (e.g., FlexPay on Azure Marketplace).
