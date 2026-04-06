# Contributing to SYZM

## Principles

- Keep all executable code under `src/`.
- Keep business and compliance assumptions documented in `docs/`.
- Never store or log PAN data. Syzm is PCI out-of-scope by design.

## Workflow

1. Create a feature branch.
2. Add tests for behavior changes (at minimum in `src/brain/tests` for scheduling logic).
3. Update docs when product behavior or compliance rules change.
4. Submit PR with:
   - Problem statement
   - Scope of change
   - Testing evidence
   - Risk notes

## Commit Style

Use conventional commits:

- `feat:`
- `fix:`
- `docs:`
- `refactor:`
- `test:`
- `chore:`

## Quality Gate

- Python: `pytest` should pass in `src/brain`.
- TypeScript: `npm run lint` should pass in `src/portal`.
- SQL migrations must be idempotent and forward-only.

