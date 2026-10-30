# CLAUDE.md

This repo is the Green Dragons' TUM Blockchain & AI Hackathon (30–31 Oct 2026) entry: **QA Coworkers on Sokosumi/Masumi (Cardano Preprod)**.

**Before doing anything, read `docs/HANDOFF.md` completely.** It holds the full context, current gate status, decisions and next steps. Then use `docs/IMPLEMENTATION_PLAN.md` (step-by-step plan with test gates), `docs/RUNBOOK.md` (live commands) and `docs/resources.md` (IDs and gate log).

Non-negotiables:
- Node 24 (`nvm use 24`). Sokosumi CLI **1.1.0** (1.0.4 is broken against current Preprod). Always `--preprod`; never mainnet.
- Never print, log, commit or paste secrets (`.env`, `.env.*`, the CLI vault). Never inspect the credential vault.
- Follow the plan's gates in order; `npm test` must stay green; record live evidence in `docs/resources.md`.
- External writes (Tasks, hires, refunds, payments) only within the credit budget the human gave; stop and ask for `[HUMAN]` steps.
- `origin` points at the upstream Masumi template; never push there.
- The template's `AGENTS.md` rules also apply.
