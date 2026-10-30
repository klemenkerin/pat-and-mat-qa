# Runbook: live gates (run these in your Mac terminal)

All commands run from the repo root with Node 24 and Sokosumi CLI **1.1.0** (1.0.4 is broken against current Preprod: `--personal` commands return 404 on `/v1/users/me/workspace-access`), logged in with `sokosumi --preprod auth login`.
Never paste keys into chat, commits or Task text.

## Gate 1.3: baseline template run
See docs/IMPLEMENTATION_PLAN.md Step 1.3 (terminal A `npm start`, terminal B `npm run worker`, then create a Task).

## Gate 1.4: per-worker state dir
```bash
cp .env.structured.example .env.structured     # set COWORKER_ID=<structured coworker id>; keep QA_MODE=template
npm start                                       # terminal A (Eve, template mode only)
npm run worker:structured                       # terminal B → journals appear in .local/structured/
sokosumi --preprod tasks create --personal --coworker-id <ID> --name "baseline 2" --description "Suggest five team names." --status READY --json
npm run worker:structured                       # in a 3rd terminal → must fail with "Worker already running"
```

## Gate 2.2: read-only Sokosumi check (worker may be stopped)
```bash
node --env-file=.env --env-file=.env.structured scripts/live-sokosumi-check.mjs <BASELINE_TASK_ID>
```

## Gate 2.3: model check
```bash
node --env-file=.env scripts/live-llm-check.mjs        # → {"answer":5} and "LLM check OK"
```

## Gate 1.5: hire spike (stop the worker first)
```bash
node --env-file=.env --env-file=.env.structured scripts/spike-hire.mjs --agent <STRUCTURED_AGENT_ID> --max-credits <N>
# optional refund probe on the finished spike job:
node --env-file=.env --env-file=.env.structured scripts/spike-hire.mjs --agent <ID> --max-credits <N> --refund
```
Send back `.local/spike/<timestamp>/findings.json` (it contains no secrets). Repeat once with an image agent.

## Gates 3.3–3.8: structured QA end-to-end
1. Fill `config/agents.json` with your groups (ids + names; the spike's schema.json can go into `inputSchema`).
2. In `.env.structured` set `QA_MODE=structured`. Optional: `QA_STOP_AFTER=approved` (Gate 3.3) or `job-terminal` (Gate 3.4).
3. Run the worker: `npm run worker:structured` (Eve is not needed in QA mode).
4. Act as the customer in another terminal:
```bash
node scripts/customer.mjs create --coworker <STRUCTURED_COWORKER_ID> --agent <AGENT_ID> --max-credits <N> \
  --brief "CSV of 20 EU electricity day-ahead prices with columns date (YYYY-MM-DD), country (DE, AT or CH) and price_eur"
node scripts/customer.mjs watch <TASK_ID>          # shows the proposed contract
node scripts/customer.mjs approve <TASK_ID>        # or: --changes "require 30 rows"
```
Journals and artefacts: `.local/structured/qa-<TASK_ID>.json` and `.local/structured/qa-<TASK_ID>/attempt-N/`.
