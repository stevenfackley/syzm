# Critical 2026 Compliance and Technical Constraints

## Mandatory Rules

1. Network tokenization required for optimal approval uplift and PCI posture.
2. Retry attempts must obey Visa retry guidance and internal policy:
   - hard limit: fewer than 4 retries (`retry_count < 4`)
3. US bank maintenance blackout:
   - disallow schedules on Sunday between 01:00 and 03:00 America/New_York

## Enforcement Points In This Scaffold

- SQL constraint on queue table (`retry_count < 4`)
- FastAPI scheduler guard (`RetryExhaustedError` when limit reached)
- FastAPI scheduling blackout shifter for Sunday maintenance window
- Edge execution filter excludes rows at/above retry limit

