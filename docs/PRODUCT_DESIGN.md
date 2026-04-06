# Product Design Document (PDD)

## User Flows

## 1. Syzm Audit

1. User uploads CSV with failed transactions.
2. Syzm parses and computes "Seismic Shift" (recoverable opportunity).
3. User receives instant summary and optional PDF business case.

## 2. Recovery Dashboard

1. User opens dashboard after integration.
2. Dashboard displays:
   - Revenue saved today
   - Lifetime churn reduction
   - Retry success by processor and region

## 3. Integration Panel

1. User generates API keys and webhook URLs.
2. User configures Stripe/Adyen/Braintree webhook targets.
3. System validates incoming events and confirms health.

## UX Goals

- First value in under 5 minutes.
- Finance-readable metrics before technical setup is complete.
- Visual framing as "found money" and "retention insurance."

