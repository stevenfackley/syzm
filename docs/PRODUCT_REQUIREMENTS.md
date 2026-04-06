# Product Requirements Document (PRD)

## Vision

Syzm eliminates involuntary churn for mid-tier streaming services by replacing static retry logic with an ML-driven retry timing engine ("Syzm Brain").

## Target Persona

- Revenue Operations Manager
- CFO / VP Finance
- Billing platform owners for Tier 2/3 streaming companies

## Functional Requirements

## R1: Real-Time Webhook Ingestion

- Process Stripe, Adyen, and Braintree decline webhooks.
- Target throughput: `10k+ requests/sec` with ingestion path optimized for low-latency queue writes.
- API behavior: idempotent enqueue with durable retry metadata.

## R2: Predictive Scheduling

- Inference endpoint returns `scheduled_at` in UTC for each soft decline.
- Initial model family: XGBoost.
- Fallback behavior required if model artifact is unavailable.

## R3: Processor Agnosticism

- Retry attempts must support routing across multiple processors.
- Queue row keeps processor history to avoid repeating blocked paths.

## R4: PCI Out-of-Scope

- No raw PAN handling in Syzm systems.
- Inputs should use tokenized references and non-sensitive metadata.

## R5: Shadow Audit Portal

- Self-service CSV upload for historical failed transactions.
- Output:
  - Estimated monthly recoverable revenue
  - Estimated involuntary churn reduction
  - Downloadable/emailed business-case report

