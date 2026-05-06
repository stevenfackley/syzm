# Decisions

ADR log. Append-only.

---

## 2026-04-28 — Initial Dependabot enrolment

**Status:** accepted
**Context:** Repo was missing `.github/dependabot.yml`; added per workspace dependabot-sweep-policy. Stack: pip (`/src/brain`), npm (`/src/portal`), docker (`/src/brain/Dockerfile`). No CI workflows yet.
**Decision:** Per-ecosystem entries, weekly Monday scan, minor/patch grouped, majors separate.
**Consequences:** Expect first wave of PRs across all three ecosystems after the config lands.

---

## 2026-04-28 — Dependabot sweep: python 3.12→3.14, xgboost 2→3, pytest 8→9, eslint 9→10, eslint-config-next 15→16, @types/node 22→25, plus minors

**Status:** accepted (awareness-only stub per saved sweep policy)
**Context:** First post-enrolment sweep. Repo is dormant per workspace CLAUDE.md (last commit 2026-04-05); no deploy pipeline so blast radius is local only.
**Decision:** Auto-merge per policy.
**Consequences — majors to watch:**
- **python 3.12-slim → 3.14-slim** (Docker, PR #1, skips 3.13):
  - **3.13:** experimental free-threaded build (no GIL); we don't opt in.
  - **3.14:** PEP 779 makes free-threaded builds officially supported. Default Docker tag still defaults to GIL build.
  - Watch: deprecated `typing.io`/`typing.re` warnings; some C-extension wheels may lag — `pip install` may need to compile if a dep hasn't published 3.14 wheels.
- **xgboost 2.1.4 → 3.2.0** (PR #5):
  - **v3:** removed legacy `xgboost.train(..., evals=...)` parameter alias `eval_set`; switch any reference to `evals`.
  - GPU API: `gpu_id` → `device='cuda:N'` (we're CPU-only here, so no impact).
  - Booster save format defaults to JSON; legacy binary still readable.
- **pytest 8.4.2 → 9.0.3** (PR #7):
  - `pytest.warns()` stricter; `--strict-markers` is the default. Unknown markers now ERROR.
  - `tmpdir`/`tmp_path` retention semantics tightened. Tests must clean up explicitly.
- **eslint 9 → 10** + **eslint-config-next 15 → 16** (PRs #6, #8):
  - Drops Node 18; needs Node 20.10+. Flat config still default.
  - `eslint-config-next 16` aligns with ESLint 10 plugin protocol.
- **@types/node 22 → 25** (PR #4): pure types; build-only.
**Why no review:** dormant repo, no prod traffic, reverts free.
