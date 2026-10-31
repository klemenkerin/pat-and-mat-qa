# HANDOFF — QA Coworkers on Sokosumi / Masumi (TUM Blockchain & AI Hackathon 2026)

> **Who this is for:** the coding agent (Claude Code) taking over this repository on Klemen's Mac, plus the human team.
> **Read order:** this file completely → `docs/IMPLEMENTATION_PLAN.md` (the full step-by-step plan with test gates) → `docs/RUNBOOK.md` (live-gate commands) → `docs/resources.md` (IDs and gate log).
> **Written:** Fri 30 Oct 2026, ~21:00 Europe/Berlin, by the Claude session that researched the platform, wrote the plan and built Parts 1–3 in a cloud workspace. That workspace had **no access to the Sokosumi API, Hugging Face or the user's keychain**. Every live step so far was run by the human in their Mac terminal. You (Claude Code on the Mac) can now run everything directly.
> **Event:** TUM Blockchain & AI Hackathon, Munich, 30–31 Oct 2026, Cardano / Masumi track. Team / Vendor name: "Green Dragons". Human lead: Klemen.

---

## 1. What we are building (product, in one page)

Buyers on the **Sokosumi** agent marketplace (people or other AI agents) hire **service Agents** that produce outputs. Today the buyer must inspect every output and accept it or start a dispute, which doesn't scale when an agent hires ten agents. We build **QA (quality-assurance) Coworkers** that sit in the middle:

1. A customer gives our QA Coworker a **Task** ("get me X from service Agent Y").
2. The QA Coworker turns the brief into a machine-checkable **acceptance contract** and asks the customer to approve it. This is the "meeting". Marketplace Agents can't negotiate (they only have a fixed input form), so the agreement is between QA Coworker and customer. The approved requirements are then written into the service Agent's input.
3. The QA Coworker **hires the service Agent itself, inside the customer's Task**. Sokosumi bills the hire to the Task owner's (customer's) workspace credits.
4. When the Job finishes, the QA Coworker **verifies the output against the contract with deterministic code**.
5. **Pass** → Task COMPLETED with deliverable + QA report. **Fail** → request a refund on that Job (fire-and-forget), write a corrected brief listing the exact failures, rehire. Repeat until it passes or the retry budget is spent, then Task FAILED with the full report.

We build **two specialist QA Coworkers** (mentors' advice: show the pattern scales by output type):
- **Agent 1: Structured data (CSV / JSON).** Parse, fields present/extra, record count, types, date formats, nulls, enums, ranges, uniqueness. **Built (code complete, unit-tested); live gates pending.**
- **Agent 2: Images.** **Not started.** The team decided this MVP scope:
  - technical metadata (format, size, dimensions) with sharp;
  - **OCR text**: if the customer's prompt quotes text or demands exact wording, check the exact text (normalised, small OCR-noise tolerance). If it only *describes* the text, a **text-only** LLM judges whether the OCR text matches the idea;
  - **objects**: objects named in the prompt must be detected above a threshold;
  - **no vision-LLM API in the MVP**.
  - Detector decision (see §5.6): `@huggingface/transformers` zero-shot detection, **Grounding DINO tiny** default, **OWLv2** fallback. Not YOLO.

**Core design rule: code decides, the LLM explains.** The LLM drafts and revises contracts, maps briefs to agent input forms (only when the form is ambiguous), parses free-text requests, and makes the single fuzzy "OCR text matches described idea" judgement. Every other verdict is deterministic. The LLM never spends credits on its own: hiring, refunds and budgets are code-controlled.

---

## 2. Current status (exact)

### 2.1 Gate log (updated 2026-10-30, evening; full evidence in `docs/resources.md`)
| Gate | What | Status | Evidence |
|---|---|---|---|
| 1.0–1.3 | Toolchain, template, account/Vendor/Coworker, template E2E | ✅ | `docs/resources.md` |
| 1.4 | Per-Coworker worker | ✅ | rerun after stale processes were stopped |
| 1.5 | SPIKE: Coworker hires an Agent inside a Task | ✅ | `docs/spike-findings.md` (hire works; Job reads need owner context; 500-char input limit) |
| 2.1–2.5 | QA core (journal, adapter, LLM, request, customer script) | ✅ | unit + live checks |
| 3.1–3.8 | Structured QA Coworker (Pat), incl. live happy run, retry loop with refund, crash/restart | ✅ | `docs/demo.md`; tag `agent1-personal` |
| 3.9 | Structured Coworker in the TUM Workspace | ❌ | needs org approval / seat `[HUMAN]` |
| 3.10 | Optional Eve follow-up chat | ❌ optional | |
| 4.1–4.6 | Image Coworker (Mat), image contract, acquisition, OCR, detector benchmark (OWLv2 @ 0.15) | ✅ | `docs/detector-choice.md` |
| 4.7 | Image validator pack + report | ✅ | unit + slow suite |
| 4.8 | Image mode E2E (live), happy + retry, both workers concurrently | ✅ | `docs/demo.md`; image hire = local stand-in (`QA_HIRE_BACKEND=mock`, §4.6) |
| 4.9 | Image Coworker in the TUM Workspace | ❌ | same `[HUMAN]` steps as 3.9 |
| Part 5 | Optional paid QA Task; README, demo, submission | ❌ | README is still the template's |

**Tests:** `npm test` → 149 pass; `npm run test:slow` → 6 pass (downloads ~155 MB of models on first run). Credits used: ~8 of the 100-credit budget.

### 2.2 What the human has set up (Mac)
- Node 24 via nvm. **They must be on Node 24 in every terminal** (`nvm use 24`; recommended `nvm alias default 24`). A Node 26 shell caused `spawnSync sokosumi ENOENT`, because global npm packages are per nvm version.
- `npm install --global @masumi_network/sokosumi@1.1.0`; logged in with `sokosumi --preprod auth login` (OAuth, browser).
- Vendor "Green Dragons" `01a18e31-8ed8-75b8-b2e5-e1e71eb3c5a8` (slug `your-team-qa`).
- Coworker "Pat - Structured data QA" `01a18e40-3f26-743b-b191-e710204e055f` (slug `pat-structured-data-qa`, capability `tasks`, personal access, `isWhitelisted:false`). Runtime key imported into the macOS keychain via `runtime key-import`.
- User id (Task owner) `01a18e1e-c415-7388-b980-7ceb710c98c4`.
- `.env` (git-ignored, mode 600): model provider = **OpenAI** through the template's OpenAI-compatible provider: `ZAI_BASE_URL=https://api.openai.com/v1`, `ZAI_MODEL=gpt-5.4-nano`, `ZAI_CONTEXT_WINDOW_TOKENS=400000`, `LLM_TEMPERATURE=` (blank), `ZAI_API_KEY` set. `COWORKER_ID` set to the structured Coworker. **Never print or read the key.**
- `.env.structured` (git-ignored): `QA_MODE=structured`, `COWORKER_ID=01a18e40-…`, `STATE_DIR=.local/structured`, org fields blank.
- `config/agents.json`: structured = "Expose: Advanced Web Research" `cmmdca97d000304icco9htf5n` (1 credit, chosen by the agent with the human's OK); image = local stand-in `local-image-standin` (mock), because Preprod's only image Agent costs 500 credits.
- Image Coworker "Mat - Image QA" (slug `iris-image-qa`, renamed from Iris on 2026-10-31) `01a18eb7-c523-7195-a1e5-238f76defa8b` (`.env.image`: `QA_MODE=image`, `QA_HIRE_BACKEND=mock`, `STATE_DIR=.local/image`).
- **Credit budget:** Preprod only, at most 20 credits per hire and 100 in total.

### 2.3 Spike questions
All five were answered by the Gate 1.5 spike: see `docs/spike-findings.md`.

---

## 3. Repository and how to work in it

- **Location (Mac):** `~/Documents/Projekti/tum-hackathon/image-qa` (the folder name is historical; it holds both agents).
- **Origin:** a clone of https://github.com/masumi-network/tum-hackathon-quickstart. **Branch `qa-agents`.** `origin` still points at the upstream Masumi repo. **Never push there.** For submission the team needs their own GitHub repo: add a new remote, e.g. `git remote rename origin upstream && git remote add origin <team repo>`. Ask the human.
- **Commits so far** were made in the cloud workspace and synced into the folder via tarballs in **`.sync/`** (git-ignored; safe to delete now). From now on, commit normally in the folder. The cloud session will not sync again.
- **Commit attribution used so far:** messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Use your own standard attribution going forward.
- Template rules in `AGENTS.md` still apply (pinned deps, authorization before external writes, credentials only in vault/.env, never inspect the vault, no claims without evidence). **Exception: the template pins CLI 1.0.4. Use 1.1.0** (§4.1).

### 3.1 File map (what exists and what it does)
```
worker.mjs            template worker. Loads qa/config.mjs; if QA_MODE != template → `await import('./qa-worker.mjs')`.
                      Otherwise template behaviour, with all state under STATE_DIR (statePath()).
qa-worker.mjs         QA poll loop: lock per STATE_DIR, journal, live adapter, LLM, catalog, mode, pipeline.
                      Lists tasks with the HUMAN CLI login (`sokosumi --preprod tasks list --coworker-id …`), as the template does.
                      New work only from READY; advances non-terminal journals while the Task is READY/RUNNING/INPUT_REQUIRED.
state-dir.mjs         STATE_DIR (relative, inside project; default .local) + statePath().
comments.mjs, paid-task.mjs   template, changed only to use statePath(). paid-task still reads .local/mps-runtime.env (shared node config).
qa/config.mjs         Zod-validated env: QA_MODE, COWORKER_ID, QA_MAX_ATTEMPTS_DEFAULT=3, QA_MAX_CREDITS_PER_HIRE_DEFAULT=50,
                      QA_JOB_POLL_SECONDS=12 (min 10), QA_JOB_TIMEOUT_MINUTES=30, QA_APPROVAL_TIMEOUT_MINUTES=60,
                      QA_MAX_REVISION_ROUNDS=3, QA_STOP_AFTER (phase name, for live gates), QA_HIRE_BACKEND=sokosumi|mock
                      (mock = local stand-in image Agent, qa/mock/), DETECTOR_MODEL, DETECTOR_DTYPE=q8, DETECTOR_THRESHOLD=0.15, OCR_LANG=eng,
                      OCR_EXACT_MAX_EDIT_RATIO=0.05. Blank env values = defaults.
qa/journal.mjs        Atomic JSON journal per task: ${STATE_DIR}/qa-<taskId>.json; artefacts in ${STATE_DIR}/qa-<taskId>/attempt-N/.
qa/pipeline.mjs       The QA state machine (see §4.3). All side effects via injected deps → fully unit-tested with fakes.
qa/sokosumi.mjs       Adapter: CLI runtime start/complete (via `sokosumi --preprod runtime …`), Coworker HTTP client for everything else.
                      Refund: personal → CLI client with contextUserId=task owner; org → direct fetch with X-Context-User-Id +
                      X-Context-Organization-Id (CLI client can't send the org header). Owner = task.ownerId ?? task.userId.
qa/live.mjs           Builds the real adapter from the vault key (loadSokosumiRuntime() from the template).
qa/llm.mjs            generateJson({system,prompt,schema}) via AI SDK generateText + @ai-sdk/openai-compatible (ZAI_* env).
                      Extracts first balanced JSON object, validates with Zod, retries once with the error appended.
                      Temperature only sent if LLM_TEMPERATURE is set (GPT-5.x rejects custom temperature).
qa/request.mjs        Customer request: ```qa-request {json}``` block (strict Zod) or free text → LLM extraction. formatQaRequest().
qa/catalog.mjs        config/agents.json groups {structured:[…], image:[…]}; resolve(mode, agentId?) → agent | first | null.
qa/hire.mjs           MIP-003 input schema handling (input_data / input_groups), composeServiceBrief(), buildInputData()
                      (deterministic for one obvious text field; LLM mapping + code validation otherwise), validateInputData().
qa/extract.mjs        Find the structured deliverable: matching Job file → fenced block in result → whole result → link. sha256.
qa/validators/structured/index.mjs  All structured checks (§4.4). Luxon for dates (strict round-trip), csv-parse/sync.
qa/report.mjs         buildReport (verdict/summary/checks), renderReportMarkdown, fixInstructions (one per failed check, never dropped).
qa/contract/structured.mjs  Zod StructuredContract (strict) incl. cross-field rules.
qa/contract/render.mjs      Numbered acceptance criteria (shown to customer, reused in rebriefs). Snapshot-tested.
qa/modes/structured.mjs     Mode object used by the pipeline: parseRequest, draftContract (LLM + postProcess: brief row count →
                      records; literal date formats; YYYY→yyyy normalisation), reviseContract, renderContract, buildInputData,
                      verify (writes job.json, deliverable.<ext>, report.json into attempt dir), fixInstructions, renderReport,
                      renderResult (≤1 MiB; inlines data ≤200 KB else first 200 lines).
qa/modes/image.mjs    DOES NOT EXIST YET (qa-worker imports it for QA_MODE=image; must export createImageMode({llm,config}),
                      optionally warmUp()).
config/agents.json    empty groups. Fill it.
scripts/run-gates-1.sh       unattended Gates 2.3, 2.2, 1.4 → .local/gate-logs/gates-1-<time>.log
scripts/spike-hire.mjs       Step 1.5 spike → .local/spike/<time>/findings.json (+ schema/hire/job/files/links/result)
scripts/customer.mjs         demo customer: create (with qa-request block) | approve [--changes] | watch. Uses the human login.
scripts/live-llm-check.mjs, scripts/live-sokosumi-check.mjs   live checks.
docs/IMPLEMENTATION_PLAN.md  full plan (Parts 0–5, gates). Contains a CLI 1.1.0 update note in §0.5/0.6.
docs/RUNBOOK.md, docs/resources.md, docs/evidence/baseline-task.json
test/…                 node:test suites; test/helpers/fakes.mjs has an in-memory Sokosumi + fake mode + fake clock.
```

### 3.2 Commands
```bash
nvm use 24
npm ci                                   # deps pinned exactly (csv-parse 7.0.3, luxon 3.7.2 added)
npm test                                 # unit tests, no network
bash scripts/run-gates-1.sh              # Gates 2.3, 2.2, 1.4 (starts/stops Eve + workers itself)
node --env-file=.env --env-file=.env.structured scripts/spike-hire.mjs --agent <ID> --max-credits <N> [--refund]
npm run worker:structured                # QA worker (QA_MODE from .env.structured); Eve NOT needed in QA mode
node scripts/customer.mjs create --coworker <CW> --agent <AGENT> --max-credits <N> --brief "…" [--auto-approve]
node scripts/customer.mjs watch <TASK>; node scripts/customer.mjs approve <TASK> [--changes "…"]
```
`--env-file` order: later files override earlier ones (verified). Shell env vars are NOT overridden by env files.

---

## 4. Decisions, verified facts and gotchas (read carefully)

### 4.1 Sokosumi CLI must be 1.1.0 (not 1.0.4)
On 30 Oct 2026 Preprod Core removed `GET /v1/users/me/workspace-access` (now `GET/POST /v1/users/me/workspaces`). CLI 1.0.4 (pinned by the template and the hackathon skill) calls the old route, so **every `--personal` command fails** with `404 route_not_found` (`coworkers register --personal`, `runtime start --personal`, `tasks create --personal`, …). 1.1.0 uses the new route. Verified as a drop-in for the template: same package layout (`skills/` next to `dist/`, so `sokosumi-runtime.mjs` works), identical `createCoworkerHttpClient`, identical vault code (`runtime-credentials.js` byte-identical), same `runtime start` JSON (includes `description`), same `tasks list` JSON (`{tasks}`), same command surface (plus extra `tasks update/link/...`).

### 4.2 Platform facts (verified in source; "LIVE" = also seen on Preprod)
- **Agent vs Coworker** (Sokosumi glossary): an *Agent* is a Masumi-registry MIP-003 listing that you **hire** (creating a *Job*). A *Coworker* is a vendor AI actor that receives *Tasks*. Our QA agents are Coworkers. Service agents are Agents.
- **Coworker hire inside its Task:** `POST /v1/tasks/{taskId}/jobs` body `{agentId, inputSchema, inputData, maxCredits?, name?, projectId?}`. Only Coworker/Soko Bot auth. Job owner = Task owner, billed to the owner's workspace. `inputData` values: string | number | boolean | string[] | number[]. (core `routes/v1/tasks/[id]/jobs/post.ts`, `helpers/job.ts createAgentJobForUser`, `schemas/task.schema.ts`). The hire also requires the Agent to have a purchase-ready Cardano V2 payment source and the owner to have a seat and credits.
- **No rerun/feedback for Jobs.** A retry is a new hire. (CLI skill `agents/SKILL.md`.)
- **Refund:** `POST /v1/jobs/{id}/refund`, only for PAID Jobs with an on-chain purchase (else 422). A Coworker may call it only for Jobs in a Task assigned to it **and only with `X-Context-User-Id` (= task owner)**, plus `X-Context-Organization-Id` in org workspaces. Without context headers → 403. (`jobs/[id]/refund/post.ts`, `helpers/access-control.ts requireJobCollaboration`, `middleware/coworker-context.ts`.)
- **Escrow reality (Masumi payment-v2 `vested_pay.ak`):** a refund request **after** the seller submitted a result moves the escrow to `Disputed`, and **nothing auto-pays**. Money moves only if the seller `AuthorizeRefund`s, the buyer `AuthorizeWithdrawal`s, or after `externalDisputeUnlockTime` the Masumi admin multisig splits funds (any proportion). The only automatic refund is "no result by `submitResultTime`". The seller can resubmit a result while Disputed, but MIP-003 Agents have no endpoint to receive feedback. **Hence: request the refund, don't wait for it, rehire immediately.** Show `refund_pending`/`dispute_pending` in the demo.
- **Task statuses:** a Coworker may set any status, including `INPUT_REQUIRED`, `RUNNING`, `COMPLETED`, `FAILED`. A person can never set `INPUT_REQUIRED`. A customer comment does **not** change status: the Coworker must detect it and set `RUNNING`. (`helpers/task-selectable-statuses.ts`.)
- **Task events** `POST /v1/tasks/{id}/events` accept `comment`, `status`, `masumiPayment`. **LIVE:** event shape `{id, actor:{type:'user'|'coworker', id}, comment, status, createdAt, channel, origin}`. `runtime complete` posts the result text as the COMPLETED event's comment.
- **LIVE Task shape:** owner is **`userId`** (no `ownerId`), assignee `coworkerId`, `organizationId` null for personal, plus `events`, `jobs`, `totalCredits` in the CLI's `tasks get`.
- **Coworker HTTP client (CLI):** Preprod only, paths must start with `/v1/`, rejects redirects, no `%` in decoded path segments, returns `{get,post,put,patch}`. Errors are `CoreApiError` with `.status` and redacted `.body`.
- **Job:** statuses `started, processing, input_required, result_pending, completed, failed, payment_pending, payment_failed, refund_pending, refund_resolved, dispute_pending, dispute_resolved`. Output: `result` (text), `/files` (signed URLs), `/links`; `resultHash`, `identifierFromPurchaser`. The MIP-004 hash is `sha256(identifierFromPurchaser + ";" + output)`. The integrity check is **informational only** (pass / warn "unverifiable" / skip), because schemes differ.
- **Polling:** Jobs at most every 10 s (we use 12 s). The worker loop polls Tasks every 5 s (template).

### 4.3 QA state machine (qa/pipeline.mjs)
Phases: `received → start-pending → started → request-parsed → contract-drafted → (approval-posting → awaiting-approval ↺ revisions) | auto-approve → approved → hire-pending → job-polling → verifying → verified → (completing → completed) | (refund-pending → rebrief → approved → hire-pending …) | (failing → failed)`.
- **Idempotent comments:** every comment we post ends with a marker `[qa:<key>]` (`contract:vN`, `approved:vN`, `revising:vN`, `attempt:N:failed`, `final:failed`). `postOnce()` checks existing events for the marker before posting, so restarts never double-post.
- **Approval:** posts the contract (rendered criteria + fenced JSON) with status `INPUT_REQUIRED`, records all existing event ids, then waits for a **new** event with `actor.type==='user'` and a non-empty comment. `/^\s*approve\b/i` → approved (posts `RUNNING`). Anything else → `reviseContract` (max `QA_MAX_REVISION_ROUNDS`). Timeout → FAILED. `autoApprove:true` in the request skips INPUT_REQUIRED (for agent customers and fast demos).
- **Hire:** journal saves `inputData` before the hire. On restart in `hire-pending`, a Job named `QA attempt <n>` not yet recorded is **adopted** (no double hire; see open question 4). HTTP 402 / "insufficient credits" → FAILED "Out of credits".
- **Job outcomes:** `completed` → verify. `failed/refund_resolved/dispute_resolved/payment_failed`, `input_required` (unsupported in MVP) or timeout → the attempt fails with a `job.status` report and **no refund call** (nothing to dispute).
- **Retry:** fail + budget left → refund (best-effort; result recorded as requested/skipped/failed) → progress comment with full report → `approved` with `pendingFixInstructions` → next attempt's brief includes "Your previous attempt was rejected. Fix ALL of these issues: …". Fail on the last attempt → FAILED with attempts table + last report.
- **Complete:** `runtime complete --result-file ${STATE_DIR}/qa-<task>/result.md` (≤1 MiB enforced).
- **QA_STOP_AFTER=<phase>** halts when that phase is reached: `approved` = Gate 3.3 (contract agreed, nothing hired); `verifying` = Gate 3.4 (hired, Job completed, not yet validated); `verified` = after validation.

### 4.4 Structured contract and checks
Contract (strict Zod, `qa/contract/structured.mjs`):
- `{kind:'structured', version:1, agentId, brief, output:{format:'csv'|'json', source:'auto'|'result'|'file', csv?:{delimiter:','|';'|'\t', header}, json?:{root:'array'|'object', recordsPath?}}, records?:{exact}|{min,max}, fields:[{name, type: string|integer|number|boolean|date|datetime|time|enum|email|url, required=true, format? (Luxon tokens or 'ISO'), enum?, min?, max?, pattern?, maxNullRate=0}], unique?:[[…]], allowExtraFields=false, retry:{maxAttempts 1–5, maxCreditsPerHire}, notes?}`
- Rules: date/datetime/time need `format`; enum needs values; no duplicate fields; unique keys must exist; `exact` excludes `min`/`max`.

Check ids:
- `deliverable.found`
- `delivery.clean` (warn)
- `parse`
- `fields.present`
- `fields.extra`
- `records.count`
- `field.<name>.values`
- `field.<name>.nulls`
- `unique.<a+b>`
- `integrity.hash` (informational)

Value rules:
- CSV numbers need a decimal point; a decimal comma is named explicitly.
- JSON numbers must be numbers; "number given as a string" is reported.
- Dates must parse AND round-trip exactly (rejects `2026-2-3` for `yyyy-MM-dd`).
- Null tokens: empty, `null`, `NA`, `N/A`, `none`, `nan`.

CSV detection: ≥2 rows, ≥2 columns, and (when a header is expected) the header contains at least one contract field name. This stops prose with commas from being read as CSV.

**Deviation from plan:** `ajv` was not used. Per-value checks are hand-written (simpler, better messages).

### 4.5 Other implementation decisions
- Plain ESM `.mjs` + JSDoc, `node:test`. No TypeScript build. Deps pinned exactly.
- **One repo, two workers:** env overlays `.env.structured` / `.env.image` set `QA_MODE`, `COWORKER_ID`, `STATE_DIR`. Journals and the worker lock live under `STATE_DIR`, so both workers run concurrently.
- In QA mode **Eve is not used**. LLM calls go straight through the AI SDK. The template's generic comment-reply (`comments.mjs reply()`) is **not** active in QA mode (it would answer approval comments). Optional Step 3.10 re-enables chat after completion.
- Customer request format: a fenced block
  ````
  ```qa-request
  {"agentId":"…","brief":"…","autoApprove":false,"maxAttempts":3,"maxCreditsPerHire":50}
  ```
  ````
  (strict JSON, no comments). Free text also works (LLM extraction). Unknown agentId or empty catalog → FAILED with the supported list.
- LLM provider: any OpenAI-compatible API via the template's `ZAI_*` variables. The human chose **OpenAI** (`gpt-5.4-nano` now; recommend `gpt-5.4-mini`, or the dated `gpt-5.4-mini-2026-03-17` so OpenAI's data-sharing free tokens apply if the org opted in). Claude API also works: `https://api.anthropic.com/v1/` with a Console API key, e.g. `claude-haiku-5-5`. **Eve needs `ZAI_CONTEXT_WINDOW_TOKENS`** for models missing from its catalog. Otherwise `npm start` fails with "Cannot compile agent compaction … model "zai/…" does not have known AI Gateway context window metadata".

### 4.6 Image agent decisions (for Part 4)
- **Detector:** transformers.js v4.3.2 (`@huggingface/transformers@4.3.2`, pinned) `pipeline('zero-shot-object-detection', DETECTOR_MODEL, {dtype})`. Default `onnx-community/grounding-dino-tiny-ONNX` (q8 ≈204 MB, q4f16 ≈151 MB; prompts like `"a bicycle."`, returns phrase labels like `"a bicycle"`). Fallback `Xenova/owlv2-base-patch16` (quantized ≈155 MB; prompts `"a photo of a bicycle"`; low scores, calibrate). transformers.js 4.3.2 includes `grounding-dino`, `owlv2`, `owlvit`, and depends on onnxruntime-node 1.30.0 and sharp ^0.35.4.
- **Rejected:** Ultralytics YOLO26/YOLO11, which are closed-set (80 COCO classes: no "logo", "banner", "price tag"), require a Python ONNX export plus custom decoding, and are AGPL-3.0. YOLOE-26/YOLO-World are open-vocab, but classes are baked in at export, so per-request prompts need a Python sidecar (also AGPL).
- **Step 4.6 benchmark decides** model + threshold on a labelled fixture set (present/absent labels). Write `docs/detector-choice.md`.
- **OCR:** tesseract.js **7.0.0**, `createWorker('eng')` singleton, `worker.recognize(buf, {}, {blocks:true})` (v7 returns only `text` unless `blocks` is requested). Language data downloads from jsDelivr on first use (can't be pre-cached in the cloud workspace; do it on the Mac). Pre-process: upscale to width ≥1000, grayscale, normalise.
- **Exact text:** normalise (NFKC; unify quotes and dashes; collapse whitespace; case-sensitive by default), then approximate-substring Levenshtein (Sellers). Pass if distance/len ≤ 0.05. Note: strings < 20 chars allow **zero** differences (deliberately strict).
- **Idea text:** empty OCR → fail. Otherwise a text-only LLM returns `{matches, confidence, reason}`; pass if matches and confidence ≥ 0.6. Labelled "judged by LLM from OCR text".
- **Drafting rules:** quoted text in the brief → `exact` (code overrides the LLM); no quotes + LLM says exact → downgrade to `idea`; objects = concrete nouns only, singularised, counts from number words; colour/style go to `notes` (unchecked in MVP).
- **Fixtures:** render text PNGs from SVG with sharp and commit the PNGs (fonts vary by system).
- **Image service Agent (decided 2026-10-30 with the human):** Preprod has no affordable image Agent (only "Stock Photos Agent", 500 credits > 20-credit cap). We build a **local stand-in image Agent** behind `QA_HIRE_BACKEND=mock`, with a MIP-003-shaped input form. Backend A (first): compose the image from the brief with sharp (rendered text plus free-licensed object photos), free and offline. Optional later, if time allows: real generation (local SD-Turbo on the M2 Pro, or OpenAI images if the human's key allows). The demo states that the image hire is a local stand-in.
- Everything else (approval, hire, poll, refund, rebrief, complete) reuses the shared pipeline unchanged. Implement `qa/modes/image.mjs` with the same interface as `qa/modes/structured.mjs` (+ optional `warmUp()` to load the detector and OCR worker at start).

---

## 5. What to do next (in order)

1. **Sanity:** `nvm use 24 && sokosumi --version` (→ 1.1.0) `&& npm ci && npm test` (expect 149 pass).
2. **Gates 3.9 / 4.9, TUM Workspace** `[HUMAN approvals]`: `workspaces list` → `coworkers connect <CW> --vendor-id <V> --workspace-id <ORG>` for Pat and Mat → an org owner/admin approves → `workspaces check <ORG>` (`taskSeatEligible:true`, GRANTED) → set `SOKOSUMI_ORGANIZATION_ID/SLUG` in `.env.structured` / `.env.image` → one E2E run each with `customer.mjs … --org-slug <slug>`. Then `git tag agent1-done` / `agent2-done`.
3. **Optional:** real image generation behind the stand-in's input form (SD-Turbo locally or OpenAI images); Eve follow-up chat (3.10); paid QA Task (5.1, needs Docker/Postgres, Blockfrost key, test ADA `[HUMAN]`).
4. **Step 5.2:** rewrite README (what, architecture, run commands for both workers, limits incl. the mock image hire), final demo script, secrets check, team GitHub remote `[HUMAN]`, submission checklist (https://www.masumi.network/tum-hackathon/submission).

## 6. Things only the human can do `[HUMAN]` (stop and ask)
- Browser login: `sokosumi --preprod auth login` (if the session expires).
- Web approvals: Vendor grant in the Personal Workspace (if a `grant_required` appears); org owner/admin approval of Coworker access in the TUM Workspace.
- Credits top-up on Preprod billing; deciding the credit budget.
- Model API keys (OpenAI/Claude) and any billing on those platforms.
- Optional payments: funding wallets with test ADA (faucet / Masumi dispenser), Blockfrost key.
- Creating the team's GitHub repo / remote for submission; anything mainnet (never).

## 7. Hard rules (from the plan + template)
- Preprod only (`--preprod`). Never mainnet.
- Never print, log, commit or paste keys. Runtime keys stay in the CLI vault; never inspect it. `.env*` (except `*.example`), `.local/`, `.sync/` are git-ignored.
- Before each external write, journal a `*-pending` phase; on restart, reconcile with remote state before retrying. Never blindly repeat a hire or refund.
- One worker per Coworker (lock under `STATE_DIR`).
- Every step adds unit tests; `npm test` green at every gate. Live checks live in `scripts/`, never in `npm test`.
- Don't claim live success without evidence (Task IDs, logs). Record evidence in `docs/resources.md` / `docs/demo.md`.

## 8. References
- Plan: `docs/IMPLEMENTATION_PLAN.md` (§0.3 platform facts, §0.7 detector comparison, §0.8 links, Parts 1–5 with gates, Appendix A prompts, Appendix B risks).
- Earlier research doc (Claude Docs artifact): https://claude.ai/artifact/2UKGByCsKJ66YSAJfZctRy
- Template: https://github.com/masumi-network/tum-hackathon-quickstart
- Sokosumi monorepo (glossary, CLI skills, Core routes): https://github.com/masumi-network/sokosumi
- Masumi payment service + escrow contract: https://github.com/masumi-network/masumi-payment-service (`smart-contracts/payment-v2/validators/vested_pay.ak`)
- Masumi skills: https://github.com/masumi-network/masumi-skills
- Masumi refunds/disputes: https://docs.masumi.network/core-concepts/refunds-and-disputes
- Hackathon: https://www.masumi.network/tum-hackathon, https://hackathon.tum-blockchain.com/
- Bundled CLI skills: `$(sokosumi skills path)/{sokosumi,coworker,tasks,jobs,agents,watch}/SKILL.md`
- Eve docs: `node_modules/eve/docs/`
