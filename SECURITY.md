# Security Policy

## Reporting

Report vulnerabilities to `security@syzm.ai`.  
Include reproduction steps, impact, and affected component.

## Scope Priorities

1. Webhook signature verification and replay protection
2. API key storage/rotation
3. Queue tampering or privilege escalation paths
4. Data leakage from logs or exports

## Sensitive Data Rules

- Never ingest raw PAN, CVV, or full card track data.
- Store only tokenized/payment-processor references and non-PCI metadata.
- Redact IDs in logs when possible.

## Response Targets

- Acknowledge report: within 2 business days
- Triage classification: within 5 business days
- High/Critical patch target: within 14 calendar days

