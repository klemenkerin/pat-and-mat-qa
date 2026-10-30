# Implementation Plan: QA Coworkers on Sokosumi / Masumi (Cardano)

> **Audience:** an autonomous coding agent (Claude Code or similar) with terminal access, working together with a human team at the TUM Blockchain & AI Hackathon (Munich, 30–31 Oct 2026, Cardano / Masumi track).
> **How to use this file:** read Part 0 completely before writing any code. Then execute the steps in Parts 1–5 **strictly in order**. Every step ends with a **TEST GATE**. Do not start the next step until every check in the current gate passes. If a gate fails, fix only the code from the current step. Everything before it was proven to work, so a failure is almost always caused by the newest change.
> **Status markers used below:**
> `[VERIFIED-SRC]` = confirmed by reading the official source code (Sokosumi monorepo, CLI 1.0.4 package, Masumi payment-service contracts, hackathon template).
> `[VERIFIED-DOC]` = confirmed in official documentation.
> `[UNVERIFIED]` = plausible but not yet tested live. The plan contains a step that tests it before anything depends on it.
> `[HUMAN]` = needs a human (browser login, web approval, funding, a decision). Stop and ask; never fake it.

---

## Part 0 — Context (read fully before coding)

### 0.1 What we are building (product)

Buyers on the Sokosumi agent marketplace (people or other AI agents) hire **service Agents** to produce outputs. Today the buyer has to check every output personally and then accept it or start a dispute. That does not scale when an agent hires ten other agents.

We build **QA (quality-assurance) Coworkers** that act as a middleman:

1. A customer gives our QA Coworker a **Task**: "Get me X from service Agent Y".
2. The QA Coworker turns the customer's brief into a machine-checkable **acceptance contract**, and the customer approves it. This is the "meeting". Marketplace Agents cannot negotiate (they only accept a fixed input form), so the agreement happens between the QA Coworker and the customer, and the approved requirements are written into the service Agent's input.
3. The QA Coworker **hires the service Agent itself**, inside the customer's Task. Sokosumi bills the hire to the Task owner's (the customer's) workspace credits.
4. When the service Agent returns, the QA Coworker **verifies the output against the contract with deterministic code**.
5. **Pass:** the Task completes with the deliverable plus a QA report. **Fail:** the QA Coworker requests a refund for that Job (fire-and-forget), writes a corrected brief that names the exact failures, and rehires. It repeats until the output passes or the retry budget is used up. In the latter case the Task is marked FAILED with the full report.

We build **two specialist QA Coworkers** to show that the pattern scales, one per output type:

- **QA Agent 1 — Structured data** (CSV, JSON): parse, schema, types, date/time formats, row counts, nulls, uniqueness, enums, ranges. **Build this first.**
- **QA Agent 2 — Images** (MVP scope chosen by the team):
  - **Technical metadata**: format, width, height, file size (cheap, deterministic).
  - **Text in the image (OCR)**: if the customer's prompt requires *exact* text, check that the OCR text matches it (normalised, with a small tolerance for OCR noise). If the prompt only *describes* the text, check that the OCR text matches the idea, using a **text-only** LLM judgement on the OCR output.
  - **Objects**: extract the objects the customer's prompt names. Each must be detected in the image above a score threshold, otherwise the check fails.
  - **No vision-LLM API in the MVP.** Detection uses a local open-vocabulary detector (see 0.7).

Core design rule: **code decides, the LLM explains.** The LLM drafts and revises contracts, extracts object nouns, writes rehire feedback, and makes the single fuzzy "does this OCR text match the described idea" call. Every other pass/fail verdict comes from deterministic code. The LLM never spends credits on its own: hiring, refunding and retry budgets are controlled by code.

### 0.2 Platform glossary (Sokosumi / Masumi) `[VERIFIED-SRC: sokosumi/GLOSSARY.md]`

| Term | Meaning | How we use it |
|---|---|---|
| **Agent** | A marketplace listing in the Masumi registry. It implements the MIP-003 API (`POST /start_job`, `GET /status`, `GET /availability`, `GET /input_schema`, optional `POST /provide_input`). A user or a Coworker **hires** an Agent, which creates a **Job**. | The service agents we check. |
| **Job** | One run of an Agent. Statuses: `started`, `processing`, `input_required`, `result_pending`, `completed`, `failed`, `payment_pending`, `payment_failed`, `refund_pending`, `refund_resolved`, `dispute_pending`, `dispute_resolved`. Terminal: `completed`, `failed`, `refund_resolved`, `dispute_resolved`. Output = `result` (text, usually markdown) plus `files` (signed URLs) plus `links`. | What we validate. |
| **Coworker** | A vendor's AI actor that works on **Tasks**. It authenticates with a `coworker_…` API key. It is not hired; Tasks are assigned to it. | Our two QA agents. |
| **Task** | Work assigned to a Coworker. It has `status` (`DRAFT`, `READY`, `RUNNING`, `INPUT_REQUIRED`, `COMPLETED`, `FAILED`, `CANCELED`, …), **events** (comments, status changes, `masumiPayment`), files and linked Jobs. | The QA case file. |
| **Vendor** | The organisation that owns Coworkers. Each account can create one self-service Vendor. | Our team's vendor. |
| **Workspace** | Personal Workspace or an Organization Workspace (for example the TUM Workspace). Credits are per workspace. | Test in Personal first, then TUM. |
| **MPS** | Masumi Payment Service: a self-hosted node with Postgres and Cardano wallets for on-chain escrow. | Optional only (paid QA Task). |

### 0.3 Facts about the platform that shape the design

1. **A Coworker can hire an Agent inside a Task it is assigned to.** `POST /v1/tasks/{taskId}/jobs` with body `{agentId, inputSchema, inputData, maxCredits?, name?}`. Core rejects the call unless the caller is a Coworker or Soko Bot. The Job's owner is the Task owner (`createAgentJobForUser({owner:{ownerId: task.ownerId, …}})`), and the hire is billed to the owner's workspace credits. `[VERIFIED-SRC: apps/core/src/routes/v1/tasks/[id]/jobs/post.ts, apps/core/src/helpers/job.ts, apps/core/src/schemas/task.schema.ts (createTaskJobRequestSchema = createJobRequestSchema + agentId)]` **Whether hiring is live on Preprod is `[UNVERIFIED]`. Step 1.5 tests it before anything depends on it.** The Sokosumi glossary says the web catalog is "discovery only while app Hire is off". The API route exists, but it also requires the Agent to have a purchase-ready Cardano V2 payment source, plus a seat and credits for the owner.
2. **`inputData` value types:** `string | number | boolean | string[] | number[]`, keyed by input field id. `inputSchema` is the Agent's MIP-003 input schema. Fetch it with `GET /v1/agents/{id}/input-schema` and pass it through unchanged. `[VERIFIED-SRC: schemas/job.schema.ts createJobRequestSchema]`
3. **Direct Jobs have no "rerun with feedback" command.** A retry means a new hire with a corrected brief. `[VERIFIED-SRC: CLI skill apps/cli/skills/agents/SKILL.md: "Direct jobs have no documented feedback-reply command. Do not invent one."]`
4. **Refund:** `POST /v1/jobs/{id}/refund`, only for `PAID` Jobs that already have an on-chain purchase. A Coworker may call it only on Jobs inside a Task assigned to it, **and only with context headers**: `X-Context-User-Id: <task.ownerId>`, plus `X-Context-Organization-Id: <task.organizationId>` in an organization workspace. Without context headers the call returns 403 ("Context headers (X-Context-User-Id) are required"). `[VERIFIED-SRC: routes/v1/jobs/[id]/refund/post.ts, helpers/access-control.ts requireJobCollaboration, middleware/coworker-context.ts]`
5. **Refunds are slow once a result exists.** In the Masumi payment-v2 escrow, a buyer refund request **after** the seller has submitted a result moves the escrow to `Disputed`. Money moves only if (a) the seller calls `AuthorizeRefund`, (b) the buyer calls `AuthorizeWithdrawal` (the seller gets paid), or (c) after `externalDisputeUnlockTime` the Masumi admin multisig splits the funds. The only automatic refund is "no result submitted by `submitResultTime`". **Therefore: request the refund, do not wait for it, rehire immediately.** `[VERIFIED-SRC: masumi-payment-service/smart-contracts/payment-v2/validators/vested_pay.ak]`
6. **Task statuses a Coworker may set:** a Coworker (an agent auth context) may move its Task to any status, including `INPUT_REQUIRED`, `RUNNING`, `COMPLETED` and `FAILED`. A person can never set `INPUT_REQUIRED`. When the customer replies with a comment, the status **does not change automatically**: the Coworker must detect the reply and set `RUNNING` again. `[VERIFIED-SRC: helpers/task-selectable-statuses.ts; CLI skill coworker/SKILL.md "the assigned coworker controls the next task transition"]`
7. **Task events** (`POST /v1/tasks/{id}/events`) accept `comment`, `status` and an optional `masumiPayment`. The template already posts `{status:'COMPLETED', comment}` and plain comments. `[VERIFIED-SRC: template paid-task.mjs and comments.mjs; core tasks/[id]/events/schema.ts]`
8. **Coworker HTTP client:** the CLI 1.0.4 package exports `createCoworkerHttpClient({apiKey, contextUserId?})`. It talks to the **Preprod** API only, requires paths that start with `/v1/`, rejects redirects, and returns `{get, post, put, patch}`. `contextUserId` sets `X-Context-User-Id`. **The client cannot set `X-Context-Organization-Id`**, so for organization-workspace refunds use a small `fetch` wrapper that sends both headers (see Step 3.7). `[VERIFIED-SRC: @masumi_network/sokosumi@1.0.4 dist/src/api/http-client.js]`
9. **Other exports in CLI 1.0.4** (loaded by the template's `sokosumi-runtime.mjs` from the global CLI install):
   - `coworker/runtime-credentials.js`: `readRuntimeCredential(coworkerId)`
   - `api/http-client.js`: `createCoworkerHttpClient`
   - `api/services/task-service.js`: `fetchTask`, `fetchTasks`, `fetchTaskJobs`, `fetchTaskEvents`, `createTaskEvent`, `createTask`
   - `api/services/job-service.js`: `fetchJob`, `fetchJobEvents`, `fetchJobFiles`, `fetchJobLinks`, `fetchJobInputRequest`, `submitJobInput`
   - `api/services/agent-service.js`: `fetchAgents`, `fetchAgentInputSchema`, `createAgentJob` (this last one is the direct user hire; **we use `POST /v1/tasks/{id}/jobs` instead**)

   `[VERIFIED-SRC]`
10. **Job result integrity (MIP-004):** each Job exposes `result`, `resultHash` and `identifierFromPurchaser`. Masumi's standard is `sha256(identifierFromPurchaser + ";" + output)`. Report the hash check as **informational** (`pass`/`unverifiable`), never as a blocking failure: implementations differ. `[VERIFIED-SRC: core schemas/job.schema.ts; masumi-skills references/agentic-services.md]`
11. **Worker model:** the template's worker **polls** Sokosumi every 5 s and makes outbound calls only. No public URL is needed, and everything runs on a laptop. `[VERIFIED-SRC: template worker.mjs]`
12. **Polling etiquette:** poll Jobs at most every 10 s. `[VERIFIED-DOC: masumi-skills sokosumi-marketplace.md "Poll /jobs/{id} max every 10s"]`

### 0.4 Architecture

```
Customer (human / Soko Bot / script using Sokosumi CLI or API)
   │  creates Task (assigned to QA Coworker), replies "APPROVE" to contract
   ▼
Sokosumi Core (Preprod API)  ◄──────── polls / posts (outbound only) ────────┐
   │  Task events, Task jobs, Job status/result/files, refund               │
   ▼                                                                        │
QA worker process (one per Coworker)                                        │
   ├─ worker.mjs           poll loop; per-task journaled state machine      │
   ├─ qa/pipeline.mjs      phases (Part 0.6)                                │
   ├─ qa/sokosumi.mjs      adapter (CLI 1.0.4 modules + fetch) ─────────────┘
   ├─ qa/llm.mjs           AI SDK generateText → JSON → Zod validation
   ├─ qa/contract/*.mjs    Zod contract schemas + markdown rendering
   ├─ qa/validators/structured/*   (Agent 1)
   └─ qa/validators/image/*        (Agent 2: sharp, tesseract.js, transformers.js)
Optional: Eve dev server (template `npm start`) for chat-style follow-up replies only.
Optional: Masumi Payment Service (Postgres) for the paid QA Task (template flow).
```

**One codebase, two workers.** Both workers run from the same repository. Each has its own env overlay (`.env.structured`, `.env.image`) that sets `QA_MODE`, `COWORKER_ID` and `STATE_DIR` (`.local/structured`, `.local/image`). This keeps journals and lock files separate. Shared settings (model keys) live in `.env`.

### 0.5 Hard constraints and conventions (follow them always)

- **Start from the official template**, `https://github.com/masumi-network/tum-hackathon-quickstart`. Keep its working paths, its pinned dependency versions, and its rules in `AGENTS.md`. Add dependencies (pinned exact versions) only where this plan says so.
- **Node.js 24** (the CLI requires `24.x`). **Sokosumi CLI exactly `1.0.4`**, installed globally (`npm install --global @masumi_network/sokosumi@1.0.4`). The template imports modules from that version. Do **not** upgrade to 1.1.0.
- **Always use `--preprod`** with the CLI. Never touch mainnet.
- **Secrets:** never print, log, commit or paste them into a Task or comment. Coworker runtime keys live only in the CLI's OS credential vault (`runtime key-import`); never inspect the vault. Model keys go in `.env` (mode 600). `.env`, `.env.structured`, `.env.image`, `.local/` and `docs/*-state.json` must be git-ignored. The `*.example` env files are committed.
- **External writes** (creating Vendors, Coworkers or Tasks, hiring, refunding, payments) cost credits or create records. Do them only in the steps that say so, and only within the authorization the humans gave in the kickoff prompt (budget caps). If uncertain, ask.
- **Idempotence and journaling:** before every external write, persist a `*-pending` phase in the Task journal. After success, persist the result. On restart, a `*-pending` phase means "uncertain outcome". Inspect the remote state (Task events and Task jobs) before retrying, and never blindly repeat a hire or refund. This is the template's own pattern; keep it.
- **One worker per Coworker.** The template's `worker-lock.mjs` enforces this; keep it, scoped per `STATE_DIR`.
- **Language:** plain ESM JavaScript (`.mjs`) with JSDoc types, matching the template. Tests use `node:test` and `node:assert/strict`. No TypeScript build step.
- **Tests:** every step adds automated tests. `npm test` must stay green at every gate. Live tests (they hit Preprod or the model API) go in `scripts/` as explicit commands and are never part of `npm test`.

### 0.6 The QA Task state machine (shared by both agents)

Journal file: `${STATE_DIR}/<taskId>.json`. Phases (append-only history plus current `phase`):

```
received
 → request-parsed            (customer description parsed into QaRequest)
 → contract-drafting  → contract-drafted
 → approval-posting   → awaiting-approval      (Task status INPUT_REQUIRED, contract posted as comment)
       ↺ customer edits → contract-revised → awaiting-approval   (max 3 rounds)
 → approved                  (customer comment "APPROVE…", or request.autoApprove=true)
 → hire-pending → hired      (attempt n; jobId recorded)
 → job-polling → job-terminal
 → verifying → verified(pass|fail)
   pass → completing → completed            (Task COMPLETED, result = deliverable + QA report)
   fail & budget left → refund-pending → refund-requested|refund-skipped
                      → rebrief → hire-pending (attempt n+1)
   fail & budget spent → failing → failed   (Task FAILED, comment = full report)
```

Each attempt record: `{n, jobId, hiredAt, inputData, jobStatus, deliverableRef, report, refund:{status, error?}}`.

### 0.7 Object detection model choice (team asked for a comparison)

Requirement: detect **arbitrary nouns from the customer's prompt** ("bicycle", "red umbrella", "logo", "price tag") in Node.js, simple to integrate, not too heavy, and runnable on a laptop CPU.

| Option | Vocabulary | Integration in our Node stack | Size (weights) | License | Fit |
|---|---|---|---|---|---|
| **Ultralytics YOLO26n / YOLO11n** (latest Ultralytics family is YOLO26, Jan 2026) | **Closed set: 80 COCO classes** (person, car, dog, bicycle, …). "logo", "banner", "mountain" etc. are impossible without retraining. | Export to ONNX once with Python `ultralytics`, then write your own pre-processing (letterbox) and decode in `onnxruntime-node`. | ~5–10 MB | **AGPL-3.0** (enterprise licence needed for closed commercial use) | Fast and accurate, but cannot handle open prompts. **Not chosen for the MVP.** Possible later as a fast path for COCO nouns. |
| **YOLOE-26 / YOLO-World (Ultralytics, open-vocabulary)** | Open vocabulary via text prompts | Text classes set with `set_classes()` are **baked into exported weights**, so per-request prompts need a Python runtime (a sidecar service). Alternatively a community ONNX export with dynamic CLIP text features and a separate CLIP text encoder, plus your own NMS. | ~50–180 MB | AGPL-3.0 | Good accuracy, but adds a Python sidecar or complex glue. **Not chosen for the MVP.** |
| **Grounding DINO tiny** via `@huggingface/transformers` (`onnx-community/grounding-dino-tiny-ONNX`) | Open vocabulary (text prompts like `"a bicycle."`) | **One npm package, one call**: `pipeline('zero-shot-object-detection', model)`. Pure Node, no Python. | q4f16 ≈151 MB, int8/quantized ≈204 MB, fp16 ≈360 MB | Apache-2.0 | **Primary candidate.** Strongest open-vocab accuracy of the JS-native options; slower on CPU. |
| **OWLv2 base** (`Xenova/owlv2-base-patch16`) | Open vocabulary | Same single pipeline call | q4f16 ≈128 MB, quantized ≈155 MB | Apache-2.0 | **Fallback candidate.** Good accuracy; scores tend to be low, so thresholds need calibration. |
| OWL-ViT base/32 (`Xenova/owlvit-base-patch32`) | Open vocabulary | Same single pipeline call | ~150 MB quantized | Apache-2.0 | Fastest JS option but weakest. Last resort. |

**Decision:** use `@huggingface/transformers` (v4.3.2, pinned) with the `zero-shot-object-detection` pipeline. Ship **Grounding DINO tiny** as the default and **OWLv2** as the switchable fallback (`DETECTOR_MODEL` env). Step 4.6 benchmarks both on a labelled fixture set and records the final choice and thresholds in `docs/detector-choice.md`. Rationale: open vocabulary is mandatory for "objects mentioned in the prompt"; this path needs no Python and no custom tensor decoding, and the licences are permissive. transformers.js v4.3.2 contains `grounding-dino`, `owlv2` and `owlvit` model support, and it depends on `onnxruntime-node` 1.30.0 and `sharp` ^0.35.4 `[VERIFIED-SRC: package inspected]`.

### 0.8 Reference documentation (consult when needed)

Template and hackathon:
- Template repo (README, AGENTS.md, all `*.mjs`): https://github.com/masumi-network/tum-hackathon-quickstart
- Hackathon guide (skill file `tum-hackathon-agent`, also at https://www.masumi.network/tum-hackathon), agent brief at https://www.masumi.network/tum-hackathon/agent, submission checklist at https://www.masumi.network/tum-hackathon/submission
- Event rules and prizes: https://hackathon.tum-blockchain.com/ and https://hackathon.tum-blockchain.com/prizes

Sokosumi (marketplace, Coworkers, Tasks, Jobs):
- Monorepo: https://github.com/masumi-network/sokosumi. Key files:
  - `GLOSSARY.md`
  - `apps/cli/skills/{sokosumi,coworker,tasks,jobs,agents,watch}/SKILL.md` (bundled with the CLI, see `sokosumi skills path`)
  - `apps/core/src/routes/v1/tasks/[id]/jobs/post.ts` (Coworker hire inside a Task)
  - `apps/core/src/routes/v1/jobs/[id]/refund/post.ts`
  - `apps/core/src/routes/v1/tasks/[id]/events/schema.ts`
  - `apps/core/src/helpers/access-control.ts` (`requireTaskCollaboration`, `requireJobCollaboration`)
  - `apps/core/src/helpers/task-selectable-statuses.ts`
  - `apps/core/src/schemas/job.schema.ts`
- CLI package: `@masumi_network/sokosumi@1.0.4` (inspect `$(npm root -g)/@masumi_network/sokosumi/dist/src/**` for exact function signatures)
- Live OpenAPI (needs auth): `https://api.preprod.sokosumi.com/v1/openapi.json`
- Docs: https://www.masumi.network/dev/sokosumi/api-reference.md and https://docs.sokosumi.com

Masumi (payments, MIP-003, escrow):
- Masumi skill: https://github.com/masumi-network/masumi-skills (`skill/SKILL.md`, `skill/references/*.md`)
- MIP-003 Agentic Service API: https://www.masumi.network/dev/masumi/documentation/technical-documentation/agentic-service-api.md
- Refunds & disputes: https://docs.masumi.network/core-concepts/refunds-and-disputes
- Payment service and escrow contract: https://github.com/masumi-network/masumi-payment-service (`smart-contracts/payment-v2/validators/vested_pay.ak`)

Libraries:
- Eve agent framework (template): docs bundled at `node_modules/eve/docs/` (tools in `agent/tools/*.ts`, see `docs/tools/overview.mdx`); repo https://github.com/vercel/eve
- AI SDK (`ai` 7.x, already in the template): `generateText`; the provider is `@ai-sdk/openai-compatible` (already in the template)
- transformers.js: https://huggingface.co/docs/transformers.js. Model cards: https://huggingface.co/onnx-community/grounding-dino-tiny-ONNX, https://huggingface.co/Xenova/owlv2-base-patch16, https://huggingface.co/Xenova/owlvit-base-patch32
- tesseract.js v7: https://github.com/naptha/tesseract.js (`docs/api.md`: `createWorker('eng')`, `worker.recognize(image, {}, {blocks:true})`; by default only `text` is returned, and you request `blocks` for word/line confidences)
- sharp: https://sharp.pixelplumbing.com/ (`metadata()`, `resize`, `grayscale`, `normalise`, SVG→PNG rendering for fixtures)
- Ultralytics (rejected alternative, for reference): https://docs.ultralytics.com/models/yolo26/ and https://docs.ultralytics.com/models/yoloe/

### 0.9 Final repository layout (target)

```
tum-hackathon-quickstart/            (the template, extended)
├─ AGENTS.md  README.md  package.json  package-lock.json
├─ .env.example  .env.structured.example  .env.image.example
├─ agent/ (Eve: agent.ts, instructions.md)          # template; instructions adapted in Step 3.10
├─ worker.mjs                                       # modified: QA pipeline
├─ start.mjs client.mjs comments.mjs sokosumi-runtime.mjs task-target.mjs worker-lock.mjs  (template)
├─ paid-task.mjs payment-registration.mjs settlement.mjs agent-api.mjs ... (template, untouched unless Part 5)
├─ qa/
│  ├─ config.mjs        journal.mjs      sokosumi.mjs     llm.mjs
│  ├─ request.mjs       draft.mjs        approval.mjs     hire.mjs
│  ├─ extract.mjs       report.mjs       rebrief.mjs      pipeline.mjs
│  ├─ contract/structured.mjs  contract/image.mjs  contract/render.mjs
│  └─ validators/
│     ├─ structured/{parse.mjs, schema.mjs, checks.mjs, index.mjs}
│     └─ image/{acquire.mjs, metadata.mjs, ocr.mjs, textmatch.mjs, detector.mjs, objects.mjs, index.mjs}
├─ config/agents.json               # catalog snapshot of the team's service-agent groups
├─ scripts/
│  ├─ spike-hire.mjs  customer.mjs  live-llm-check.mjs  bench-detector.mjs  make-image-fixtures.mjs
├─ test/
│  ├─ *.test.mjs
│  └─ fixtures/{structured/*, images/*, contracts/*}
└─ docs/
   ├─ spike-findings.md  detector-choice.md  demo.md
```

---

## Part 1 — Foundation (both agents depend on this)

### Step 1.0 — Prerequisites check

**Goal:** confirm the toolchain before touching code.

Actions:
1. `node -v` must print `v24.x`. If not, stop and ask the human to install Node 24 `[HUMAN]`.
2. `git --version`.
3. `npm install --global @masumi_network/sokosumi@1.0.4`, then `sokosumi --version` prints `1.0.4`.
4. `sokosumi skills path` prints an absolute path ending in `/skills`.
5. Check that `.env` will receive the model provider values from the humans: `ZAI_API_KEY`, `ZAI_BASE_URL`, `ZAI_MODEL` (an OpenAI-compatible **text** model). Ask the humans for them if they are missing `[HUMAN]`.

**TEST GATE 1.0**
- [ ] Node 24, git, and CLI 1.0.4 are confirmed.
- [ ] `sokosumi skills path` works.

### Step 1.1 — Clone and baseline the template

Actions:
1. `git clone https://github.com/masumi-network/tum-hackathon-quickstart.git && cd tum-hackathon-quickstart`
2. `npm ci`
3. `cp .env.example .env && chmod 600 .env`. The humans fill the model values (or give them to you through a secure channel; never echo them).
4. Read `README.md`, `AGENTS.md`, `worker.mjs`, `client.mjs`, `comments.mjs`, `sokosumi-runtime.mjs`, `task-target.mjs`, `paid-task.mjs` and `agent-api.mjs` completely.
5. `git checkout -b qa-agents`

**TEST GATE 1.1**
- [ ] `npm test` passes unchanged (template tests).
- [ ] `git status` shows `.env` as ignored (not untracked).

### Step 1.2 — Sokosumi account, Vendor, first Coworker (QA · Structured Data)

Mostly CLI, but the login is `[HUMAN]`.

1. `[HUMAN]` The human runs `sokosumi --preprod auth login` (a browser opens and they sign in to their own Preprod account, created at https://preprod.sokosumi.com/signup).
2. `sokosumi --preprod auth whoami --json`: confirm the email with the human.
3. Discover existing records:
   `sokosumi --preprod workspaces list --json`, `sokosumi --preprod vendors me --json`, `sokosumi --preprod coworkers list --scope owned --json`.
4. Creating a Vendor requires organization membership. `[HUMAN]` The human joins the TUM Workspace through the invite link https://preprod.sokosumi.com/join/GTAHB3OQFWgg8rGetMfleiqgeL6_ltdW if not already a member. Re-check `workspaces list`.
5. If no administered Vendor exists: `sokosumi --preprod vendors create --name "<TEAM_NAME> QA" --slug <unused-slug> --json`. Save the Vendor ID to `docs/resources.md` (IDs only, no secrets).
6. Register the structured Coworker (personal access first):
   `sokosumi --preprod coworkers register --vendor-id <VENDOR_ID> --name "QA · Structured Data" --capability tasks --personal --json`. Save the Coworker ID.
   On resume, reuse it: `sokosumi --preprod coworkers connect <COWORKER_ID> --vendor-id <VENDOR_ID> --personal --json`.
7. Import the runtime key once (pipe it straight into the vault; never print it):
   `sokosumi --preprod coworkers api-key <COWORKER_ID> --json | sokosumi --preprod runtime key-import --coworker-id <COWORKER_ID> --api-key-stdin`
   If it fails, stop and report. Do not create more keys until the vault issue is fixed.
8. `sokosumi --preprod workspaces list --personal --json`: the human checks in the web app (Personal Workspace selected) that the Coworker's personal access is `GRANTED` `[HUMAN]` if a grant approval is shown.

**TEST GATE 1.2**
- [ ] `coworkers list --scope owned` contains "QA · Structured Data".
- [ ] The key import returned success.
- [ ] `docs/resources.md` lists the Vendor and Coworker IDs.

### Step 1.3 — Run the unmodified template end to end (proves the account and vault work)

1. Set `COWORKER_ID` in `.env`; keep `PAID_TASKS_ENABLED=false`.
2. Terminal A: `npm start` (Eve). Terminal B: `npm run worker`. Wait for `Continuous worker running`.
3. `[HUMAN]` Check that the Personal Workspace has Preprod credits (https://preprod.sokosumi.com/billing?tab=credits).
4. Create a Task as the human account:
   `sokosumi --preprod tasks create --personal --coworker-id <COWORKER_ID> --name "baseline" --description "Suggest five team names for a QA agent project." --status READY --json`
5. Poll `sokosumi --preprod tasks get <TASK_ID> --json` until `COMPLETED`.
6. If the worker reports `grant_required`, follow the skill's recovery steps (approve the Vendor grant as the Personal Workspace owner `[HUMAN]`, move a `{"phase":"starting"}`-only journal aside, restart).

**TEST GATE 1.3**
- [ ] The Task is `COMPLETED` with a saved result. Record the Task ID in `docs/resources.md`.
- [ ] Stop both processes before continuing.

### Step 1.4 — Refactor for multiple Coworkers (no behaviour change)

**Goal:** two independent workers can share one repo.

1. Create `qa/config.mjs`. It parses the env and validates with Zod (already a dependency):
   - `QA_MODE` ∈ `template|structured|image` (default `template`)
   - `STATE_DIR` (default `.local`)
   - `COWORKER_ID` (required)
   - `QA_MAX_ATTEMPTS_DEFAULT=3`, `QA_MAX_CREDITS_PER_HIRE_DEFAULT=50`, `QA_JOB_POLL_SECONDS=12`, `QA_JOB_TIMEOUT_MINUTES=30`, `QA_APPROVAL_TIMEOUT_MINUTES=60`, `QA_MAX_REVISION_ROUNDS=3`
   - image-only: `DETECTOR_MODEL` (default `onnx-community/grounding-dino-tiny-ONNX`), `DETECTOR_DTYPE` (default `q8`), `DETECTOR_THRESHOLD` (default `0.30`, calibrated in 4.6), `OCR_LANG=eng`, `OCR_EXACT_MAX_EDIT_RATIO=0.05`
2. Replace every hard-coded `.local/` path in `worker.mjs`, `comments.mjs` and `worker-lock.mjs` (lock path argument) with `${STATE_DIR}/…`. Leave `paid-task.mjs`, `agent-api.mjs` and `payment-registration.mjs` alone, because payments are only used by the structured Coworker and its `STATE_DIR` stays `.local/structured`. Where they write `.local/<task>.json`, pass the path in via the existing `save` callback the worker supplies.
3. Add env overlays `.env.structured.example` and `.env.image.example`:
   ```
   QA_MODE=structured
   COWORKER_ID=
   STATE_DIR=.local/structured
   ```
   Add `.env.structured` and `.env.image` to `.gitignore`.
4. Add npm scripts. Later `--env-file` values override earlier ones:
   ```json
   "worker:structured": "node --env-file-if-exists=.env --env-file-if-exists=.env.structured worker.mjs",
   "worker:image": "node --env-file-if-exists=.env --env-file-if-exists=.env.image worker.mjs",
   "test": "node --env-file-if-exists=.env --test \"*.test.mjs\" \"test/**/*.test.mjs\""
   ```
5. `QA_MODE=template` must keep today's behaviour (the team-name assistant) exactly.

**TEST GATE 1.4**
- [ ] `npm test` is green, and the new unit tests for `qa/config.mjs` cover defaults, invalid mode and missing `COWORKER_ID`.
- [ ] With `.env.structured` (`QA_MODE=template`, `STATE_DIR=.local/structured`), `npm run worker:structured` completes a new baseline Task (repeat 1.3 steps 4–5) and the journal lands in `.local/structured/`.
- [ ] Starting a second `worker:structured` concurrently fails with "Worker already running".

### Step 1.5 — SPIKE: hire a service Agent from inside a Task (the biggest unknown)

**Goal:** prove `POST /v1/tasks/{id}/jobs` works on Preprod for one cheap Agent from the team's structured-data group, and learn the real output shape. **If this gate fails, stop and tell the humans** (see Fallback at the end of this step).

1. `[HUMAN]` The humans tell you which Agents form the "structured" and "image" groups (names or IDs). List the catalog with the human login: `sokosumi --preprod agents list --json > .local/agents-raw.json`. Build `config/agents.json`:
   ```json
   { "structured": [{"id":"…","name":"…","credits":12,"notes":"returns CSV in markdown"}],
     "image":      [{"id":"…","name":"…","credits":30}] }
   ```
   No secrets go in this file, so it may be committed.
2. Write `scripts/spike-hire.mjs` (a one-off, run manually). With `QA_MODE=template` and the worker **stopped**:
   1. Create a Task as the human: `tasks create --personal --coworker-id <STRUCT_COWORKER_ID> --name "spike" --description "spike" --status READY --json`.
   2. Start it as the Coworker: `sokosumi --preprod runtime start <TASK_ID> --coworker-id <ID> --personal --json` (it must return `RUNNING`).
   3. Load runtime modules through `loadSokosumiRuntime()` (template) and build `runtime = createCoworkerHttpClient({apiKey: readRuntimeCredential(COWORKER_ID)})`.
   4. `GET /v1/agents/{agentId}/input-schema` with the Coworker client and record the response shape. **If this returns 401/403**, record it. Fallback: fetch the input schema once with the human's account (the human copies the agent form fields from the web UI, or you use the CLI's core client), and store it in `config/agents.json` under `inputSchema`.
   5. Build `inputData` for the Agent's text field with a tiny brief, for example "Return a CSV with columns date (yyyy-MM-dd) and value (number), 5 rows."
   6. `POST /v1/tasks/{taskId}/jobs` with `{agentId, inputSchema, inputData, maxCredits: <agent.credits + small margin>, name: "spike"}`. Record the response.
   7. Poll `GET /v1/jobs/{jobId}` every 12 s until a terminal status, or for at most 30 min. Then `GET /v1/jobs/{jobId}/files` and `/links`.
   8. Complete the spike Task: `runtime complete <TASK_ID> --coworker-id <ID> --personal --result-file <file>`.
3. Write `docs/spike-findings.md`:
   - HTTP statuses
   - job status timeline with timestamps
   - credits charged
   - where the output was (`result` markdown, CSV in a code fence, files, links)
   - whether `resultHash` and `identifierFromPurchaser` are present
   - jobType (`PAID`/`FREE`)
   - any error bodies, with secrets redacted
4. **Optional refund probe** (only if the humans allow spending): call `POST /v1/jobs/{jobId}/refund` with `createCoworkerHttpClient({apiKey, contextUserId: task.ownerId})` on the spike Job. Record the status code and body. Expected: 200 with `refund_pending`, or 422 if the job isn't PAID or has no purchase. Do this on a completed spike Job only.

**TEST GATE 1.5**
- [ ] One Job reached `completed` and its output is captured in `.local/spike/`.
- [ ] `docs/spike-findings.md` exists and is specific.
- [ ] You know the exact path to the deliverable (field and format) for at least one structured Agent, and ideally one image Agent (repeat sub-steps 2.1–2.8 with an image Agent).

**Fallback if hiring is blocked on Preprod** (report it to the humans first `[HUMAN]`): add a local **mock service agent**, `scripts/mock-service.mjs`. It is a tiny HTTP server, or a function behind the same `hire.mjs` interface, that returns canned good or bad CSV, JSON and images. Behind `QA_HIRE_BACKEND=sokosumi|mock`, everything else in this plan stays identical. The demo must state clearly that the marketplace hire was replaced by a mock.

---

## Part 2 — Shared QA core

### Step 2.1 — Journal + phase engine (pure, no network)

Files: `qa/journal.mjs`, `qa/pipeline.mjs` (skeleton), tests.

- `journal.mjs`: `load(taskId)`, `save(taskId, state)` with an atomic write (write `*.tmp`, `fsync`, rename; mode `0o600`), `transition(state, nextPhase, patch)`. Phase changes append to `state.history` with ISO timestamps.
- `pipeline.mjs`: `advance(task, state, deps)`. `deps` holds every side-effecting function (sokosumi adapter, llm, validators, clock), so tests inject fakes. Implement only the transitions from 0.6, with fakes for everything.
- Rule: any phase ending in `-pending` found at startup means **uncertain**. `advance` must call `deps.sokosumi.reconcile(taskId, state)`, which inspects Task jobs and events to see if the write happened, before doing anything else.

**TEST GATE 2.1**
- [ ] Unit tests drive a fake Task through: happy path (pass on attempt 1); fail→rehire→pass; fail×3→FAILED; customer edit round→approve; `hire-pending` on restart reconciles to `hired` when the fake Task already has a Job (no double hire); approval timeout → FAILED with an explanatory comment.
- [ ] `npm test` is green.

### Step 2.2 — Sokosumi adapter `qa/sokosumi.mjs`

Wrap all remote calls in one module so the pipeline never touches HTTP directly:

```js
// sketch — use loadSokosumiRuntime() from the template
const rt = await loadSokosumiRuntime();
const client = rt.createCoworkerHttpClient({ apiKey: rt.readRuntimeCredential(coworkerId) });
export const api = {
  getTask: (id) => client.get(`/v1/tasks/${enc(id)}`),
  listTaskEvents: (id) => rt.fetchTaskEvents(client, id),          // paginated by the CLI helper
  postEvent: (id, body) => client.post(`/v1/tasks/${enc(id)}/events`, body), // {comment?, status?}
  listTaskJobs: (id) => rt.fetchTaskJobs(client, id),
  getAgentInputSchema: (agentId) => client.get(`/v1/agents/${enc(agentId)}/input-schema`),
  hire: (taskId, body) => client.post(`/v1/tasks/${enc(taskId)}/jobs`, body), // {agentId,inputSchema,inputData,maxCredits,name}
  getJob: (jobId) => client.get(`/v1/jobs/${enc(jobId)}`),
  getJobFiles: (jobId) => client.get(`/v1/jobs/${enc(jobId)}/files`),
  getJobLinks: (jobId) => client.get(`/v1/jobs/${enc(jobId)}/links`),
  requestRefund: (task, jobId) => refundWithContext(task, jobId),  // see Step 3.7
};
```

- Starting and completing Tasks keeps using the template's CLI calls (`runtime start`, `runtime complete --result-file`), so behaviour stays identical to the tested template. Use `postEvent(id, {status:'FAILED', comment})` for failure and `{status:'INPUT_REQUIRED', comment}` / `{status:'RUNNING'}` for approval.
- Before every write, call the template's `verifyRuntimeTask(client, taskId, target)` (it checks that the Task is still assigned to this Coworker and workspace).
- `reconcile(taskId, state)`: compare the journal against `listTaskJobs` and `listTaskEvents` (look for our own events by a marker string such as `[qa:<phase>:<attempt>]` embedded at the end of every comment we post).
- Redact tokens from every error message (the CLI's errors are already redacted; keep it that way).

**TEST GATE 2.2**
- [ ] Unit tests with a fake `client` assert the exact paths and bodies.
- [ ] Live read-only check `scripts/live-sokosumi-check.mjs <TASK_ID>` (the baseline Task from 1.3) prints Task status, event count and job count without errors.

### Step 2.3 — LLM adapter `qa/llm.mjs`

- `generateJson({system, prompt, schema /* zod */, maxRetries=1})`: call `generateText` from `ai` with `createOpenAICompatible({name:'zai', baseURL, apiKey}).chatModel(ZAI_MODEL)`. Instruct the model to output **only** a JSON object. Extract the first `{…}` block, `JSON.parse` it, and validate with Zod. On failure, retry once with the Zod error appended. Do **not** rely on provider JSON-schema mode (not all OpenAI-compatible providers enforce it).
- Temperature 0 where the provider supports it.
- Log the token usage numbers (not prompts) to the journal.

**TEST GATE 2.3**
- [ ] Unit tests with a fake model function: valid JSON; JSON wrapped in prose; invalid then valid on retry; invalid twice → throws a typed error.
- [ ] Live `node --env-file=.env scripts/live-llm-check.mjs` returns a valid object for a toy schema `{answer: number}` ("What is 2+3?").

### Step 2.4 — Customer request format `qa/request.mjs`

The customer's Task `description` may contain a fenced JSON block (preferred, for agent customers) or free text (for humans):

````
```qa-request
{ "agentId": "<service agent id>",       // optional if the brief names a group default
  "brief": "CSV of 50 EU electricity day-ahead prices, columns date (yyyy-MM-dd), country (DE|AT|CH), price_eur",
  "autoApprove": false,                   // agent customers may skip the approval round
  "maxAttempts": 3,
  "maxCreditsPerHire": 50 }
```
````

- Parse the fenced block when present (validate with Zod). Otherwise ask the LLM to extract `{agentId?, brief}` from the free text, and default the rest from config.
- If `agentId` is missing, take the first Agent of this mode's group in `config/agents.json`, and say so in the contract comment.
- Unknown `agentId` (not in this mode's group) → Task `FAILED` with comment "agent not in the <mode> QA group; supported: …".

**TEST GATE 2.4**
- [ ] Unit tests: fenced JSON; free text (fake LLM); missing agentId → default; foreign agentId → error.

### Step 2.5 — Demo customer script `scripts/customer.mjs`

Uses the **human** CLI login (not the Coworker key):
- `node scripts/customer.mjs create --mode structured --agent <id> --brief "…" [--auto-approve]` → runs `sokosumi --preprod tasks create --personal --coworker-id <id> --name … --description "<text>" --status READY --json`. CLI 1.0.4 takes the description inline (`--description TEXT`; `--description-file` exists only in newer CLI versions). Pass it with `execFileSync` argument arrays, not a shell string, so quotes and newlines in the fenced `qa-request` block survive.
- `node scripts/customer.mjs approve <TASK_ID> [--changes "…"]` → `tasks comment <TASK_ID> --comment "APPROVE" --json` (or the requested changes).
- `node scripts/customer.mjs watch <TASK_ID>` → polls `tasks get` and `tasks events` and prints new events once, until a terminal status.

**TEST GATE 2.5**
- [ ] `create` against the worker running in `QA_MODE=template` produces a Task that completes (template behaviour). `watch` prints events and exits on `COMPLETED`.

---

## Part 3 — QA Agent 1: Structured data (build, test, demo-ready before Part 4)

### Step 3.1 — Structured contract schema `qa/contract/structured.mjs`

Zod schema (version it):

```js
StructuredContract = {
  kind: 'structured', version: 1,
  agentId: string, brief: string,                   // what we ask the service agent
  output: {
    format: 'csv' | 'json',
    source: 'auto' | 'result' | 'file',            // where to find the data in the Job
    csv?:  { delimiter: ',' | ';' | '\t' (default ','), header: boolean (default true) },
    json?: { root: 'array' | 'object', recordsPath?: string /* dot path to the records array */ }
  },
  records?: { min?: int>=0, max?: int>=0, exact?: int>=0 },
  fields: Array<{
    name: string,
    type: 'string'|'integer'|'number'|'boolean'|'date'|'datetime'|'time'|'enum'|'email'|'url',
    required: boolean (default true),
    format?: string,          // Luxon tokens for date/datetime/time, e.g. 'yyyy-MM-dd', "yyyy-MM-dd'T'HH:mm:ssZZ", 'HH:mm'
    enum?: string[], min?: number, max?: number, pattern?: string /* JS regex source */,
    maxNullRate?: number (0..1, default 0)
  }>,
  unique?: string[][],         // each inner array = one composite key
  allowExtraFields: boolean (default false),
  retry: { maxAttempts: 1..5, maxCreditsPerHire: number },
  notes?: string               // human-readable assumptions
}
```

Also `renderContractMarkdown(contract)` in `qa/contract/render.mjs`: a compact, numbered list of acceptance criteria (one line each) that is shown to the customer and reused in rebriefs.

**TEST GATE 3.1**
- [ ] Valid and invalid fixture contracts in `test/fixtures/contracts/` parse or fail as expected.
- [ ] Renderer snapshot test (stable ordering).

### Step 3.2 — Contract drafting `qa/draft.mjs` (structured)

- Inputs: `QaRequest`, the Agent's description (from `config/agents.json`) and its input schema.
- The LLM prompt asks it to produce a **StructuredContract** that encodes only what the brief states or clearly implies. Ambiguities become explicit defaults recorded in `notes` (for example "assumed comma delimiter").
- Code post-processing (deterministic):
  - Clamp `retry` to the request or defaults.
  - If the brief contains a number of rows ("50 rows", "top 10"), require `records.exact` or `min`/`max` to reflect it. Use a regex cross-check, and re-ask the LLM once if it is missing.
  - If the brief names a date format literally (`yyyy-MM-dd`, `ISO 8601`, `DD.MM.YYYY`), normalise it to a Luxon format and set it on every date field.
- `reviseContract(contract, customerComment)`: the LLM applies the requested changes, and the result is validated again.

**TEST GATE 3.2**
- [ ] Unit tests with a fake LLM cover the post-processing rules.
- [ ] Live check `scripts/live-draft.mjs` with 3 fixture briefs (CSV with dates, JSON array of products, CSV with enum column) prints valid contracts. A human eyeballs that they make sense.

### Step 3.3 — Approval loop `qa/approval.mjs`

- Post one comment: header "Proposed acceptance contract (attempt budget N, max credits per hire M)", the rendered criteria, a fenced `json` copy of the contract, and the instruction: "Reply `APPROVE` to start, or reply with the changes you want." Set status `INPUT_REQUIRED` in the same event, and append the marker `[qa:contract:v<k>]`.
- When `request.autoApprove === true`: post the contract as an informational comment, do not set `INPUT_REQUIRED`, and go straight to `approved`.
- On each poll in `awaiting-approval`, read Task events newer than the contract event. Consider only events whose `actor.type === 'user'` and that carry a non-empty `comment` (this is the template's `comments.mjs` filter).
  - The comment matches `/^\s*approve\b/i` → `approved`. Post `{status:'RUNNING', comment:'Contract approved. Hiring <agent> (attempt 1/N). [qa:approved]'}`.
  - Otherwise → `reviseContract` → post the new version (v+1). Allow at most `QA_MAX_REVISION_ROUNDS`; when exceeded → FAILED with an explanation.
  - No reply within `QA_APPROVAL_TIMEOUT_MINUTES` → FAILED ("approval timed out").
- **Disable the template's generic `reply()` (comments.mjs) for QA modes.** Otherwise it would answer the approval comments with the Eve model. Keep it for `QA_MODE=template`.

**TEST GATE 3.3**
- [ ] Unit tests with fake events: approve; change→revise→approve; 4 change rounds→FAILED; timeout→FAILED; comments from the Coworker itself are ignored.
- [ ] **Live:** run `npm run worker:structured` with `QA_MODE=structured`, with the pipeline stopping after `approved` (feature flag `QA_STOP_AFTER=approved`). Then `customer.mjs create …` → the contract comment appears and the Task shows `INPUT_REQUIRED` in the web UI → `customer.mjs approve` → the Task shows `RUNNING`. Record the Task ID.

### Step 3.4 — Hire builder `qa/hire.mjs`

- `buildInputData(inputSchema, contract, attempt, previousFailures)`:
  - Find the Agent's fields in `inputSchema.input_data` (MIP-003 typed array `{id, type, name, data, validations}`).
  - If there is exactly one free-text field (`string`, `text`, `textarea`), put the full **service brief** there: the original brief + "Hard requirements:" + the numbered criteria from `renderContractMarkdown` + (for attempts > 1) "Your previous attempt was rejected for these reasons:" + fix instructions.
  - Otherwise ask the LLM to map the brief to the fields (JSON object keyed by field id). Then validate in code: every required field present; types match (`number`, `boolean`, `option` values inside `data.values`); strings within `validations.max`.
  - If the schema can't be satisfied → attempt error → FAILED with a clear explanation (don't burn credits).
- `hire(taskId, contract, attempt)`: journal `hire-pending` (with the `inputData`) → `api.hire(...)` with `maxCredits = contract.retry.maxCreditsPerHire` and `name = "QA attempt <n>"` → journal `hired` with `jobId`.
- `pollJob(jobId)`: every `QA_JOB_POLL_SECONDS` (≥10). Terminal states per 0.2. Timeout → the attempt fails with reason `timeout` (no refund call; escrow auto-refunds if no result is ever submitted).
- If a Job enters `input_required`: MVP behaviour is to treat the attempt as failed with reason "agent requested interactive input; not supported" (do not answer on the customer's behalf).

**TEST GATE 3.4**
- [ ] Unit tests for `buildInputData` with fixture schemas: single text field; text + option field; missing required → error; option value outside `values` → error.
- [ ] **Live:** with `QA_STOP_AFTER=job-terminal`, one full approve→hire→poll cycle against a structured Agent. The journal shows `jobId`, the terminal status and the raw result saved to `${STATE_DIR}/<task>/attempt-1/`.

### Step 3.5 — Deliverable extraction `qa/extract.mjs`

- Input: Job JSON + files + links. Output: `{kind:'csv'|'json'|'unknown', text, origin:'file'|'result-fence'|'result-raw'|'link', name?, sha256}`.
- Order (follow `contract.output.source`, `auto` = this order):
  1. Job files whose name or MIME matches the format → download the signed URL with `fetch` (timeout 30 s, max 20 MB) → UTF-8 decode, strip BOM.
  2. Fenced code blocks in `result` labelled `csv`/`json` (or unlabelled but parseable).
  3. The whole `result` text, if it parses.
  4. Links ending in `.csv`/`.json`.
- Save the extracted deliverable to `${STATE_DIR}/<task>/attempt-n/deliverable.<ext>`.
- If the data came wrapped in prose rather than delivered cleanly, record a `warn` finding "data embedded in markdown".

**TEST GATE 3.5**
- [ ] Unit tests with fixtures: CSV in a ```csv fence plus prose; raw JSON result; two fences (the first matching one wins); file preferred over fence; nothing parseable → `unknown`.
- [ ] Re-run extraction on the real spike output from Step 1.5 and get the right `kind`.

### Step 3.6 — Structured validator pack `qa/validators/structured/*`

Dependencies to add (exact versions; check the latest with `npm view <pkg> version` and pin it): `csv-parse` (sync API), `ajv` + `ajv-formats`, `luxon`.

Checks. Each check returns `{id, criterion, status:'pass'|'fail'|'warn'|'skip', expected, observed, evidence: string[] (≤5 examples), fix?: string}`:

| id | Check | Fails when |
|---|---|---|
| `parse` | strict CSV parse (declared delimiter, header, consistent column count) / strict `JSON.parse`; for JSON, resolve `recordsPath` | parse error (stop the remaining checks; report line and column) |
| `fields.present` | all contract fields exist | missing field names |
| `fields.extra` | no undeclared fields when `allowExtraFields=false` | extra names |
| `records.count` | count vs `exact`/`min`/`max` | out of range |
| `types` | per value: integer/number (locale-safe: reject `1,5` when number is expected), boolean, email, url, enum, pattern, min/max | count and examples per field |
| `dates` | Luxon `DateTime.fromFormat(v, format, {zone:'utc'})` must be `isValid`, and re-formatting must equal the original (rejects `2026-2-3` for `yyyy-MM-dd`) | count and examples |
| `nulls` | empty / `null` / `NA` / `N/A` rate per field ≤ `maxNullRate`; required fields allow none | rate exceeded |
| `unique` | composite keys unique | duplicates with row numbers |
| `integrity.hash` | recompute `sha256(identifierFromPurchaser + ";" + result)` vs `resultHash` | never fails: `pass` or `warn: unverifiable` |

`qa/report.mjs`: build `{verdict, attempt, jobId, agentId, deliverable:{origin, sha256}, checks[], summary, fixInstructions[]}`, and `renderReportMarkdown(report)` (a table of checks, then up to 5 examples each). `verdict = fail` if any check is `fail`.

**TEST GATE 3.6**
- [ ] Fixtures in `test/fixtures/structured/`: `good.csv`, `bad-dates.csv` (mixed `dd.MM.yyyy`), `short.csv` (38 rows of 50), `dupes.csv`, `extra-col.csv`, `semicolon.csv`, `good.json`, `bad-types.json`, `nested.json` (recordsPath). Each produces the expected check statuses.
- [ ] Report markdown snapshot test.
- [ ] Performance: 10,000-row CSV validated in < 2 s.

### Step 3.7 — Retry loop: refund + rebrief + rehire

- `qa/rebrief.mjs`: turn failed checks into **fix instructions**. Use deterministic templates first ("Column `date`: 14 of 55 values use dd.MM.yyyy; required format yyyy-MM-dd"). Optionally let the LLM polish the wording, but **never drop a failed criterion** (assert in code that each failed check id appears in the output).
- Refund (best-effort, never blocks the loop):
  1. Journal `refund-pending`.
  2. Personal workspace: `createCoworkerHttpClient({apiKey, contextUserId: task.ownerId}).post('/v1/jobs/<jobId>/refund')`.
     Organization workspace: plain `fetch('https://api.preprod.sokosumi.com/v1/jobs/<jobId>/refund', {method:'POST', redirect:'error', headers:{Authorization:`Bearer ${key}`, 'X-Context-User-Id': task.ownerId, 'X-Context-Organization-Id': task.organizationId}})`. Read the key with `readRuntimeCredential`, keep it in memory only, and never log it.
  3. 200 → `refund-requested` (store the returned job status). 422 (not PAID / no purchase yet) → `refund-skipped` with reason. Any other error → `refund-failed` with a redacted message. **In all cases continue to rehire.**
- Budget: stop when `attempt == maxAttempts`. Also stop early if a Job fails with `INSUFFICIENT_CREDITS` (HTTP 402 on hire) → Task FAILED "out of credits".
- Post one progress comment per attempt: `Attempt n/N failed: <one-line summary>. Refund: <status>. Rehiring with corrected brief. [qa:attempt:n]`.

**TEST GATE 3.7**
- [ ] Unit tests: rebrief contains every failed id; refund 200/422/500 paths all continue; budget stop; 402 stop; restart in `refund-pending` reconciles using Job status (`refund_pending`/`dispute_pending` means already requested).
- [ ] **Live:** use a deliberately strict contract (for example `records.exact` = 1 more than the agent usually returns, or a date format the agent rarely uses) so attempt 1 fails. Confirm: the refund call result is recorded, attempt 2 is hired with the corrected brief, and both Jobs appear under the Task (`sokosumi --preprod tasks jobs <TASK_ID> --json`).

### Step 3.8 — Completion and failure

- Pass: write `${STATE_DIR}/<task>/result.md`. It contains a short verdict line, the deliverable (inline in a fenced block if ≤ 200 KB, otherwise the first 200 lines plus the file link from the Job), and the QA report markdown. The whole file must be ≤ 1 MiB (the CLI limit). Then `runtime complete <task> --result-file result.md` (template path).
- Fail (budget spent): `postEvent({status:'FAILED', comment: <full report of last attempt + attempts table>})`.
- After completion, if `QA_MODE` ≠ template and the customer comments, MVP behaviour is to answer with one static pointer comment ("The QA report is in the result; open a new Task to rerun"). Optional upgrade in Step 3.10.

**TEST GATE 3.8 (end-to-end Agent 1)**
- [ ] Live E2E #1 (happy): `customer.mjs create --mode structured --agent <id> --brief "<realistic brief>"` → approve → `COMPLETED` with result.md containing the data and an all-pass report.
- [ ] Live E2E #2 (retry): strict contract → attempt 1 fail → attempt 2 pass (or FAILED after budget, with a full report). Both runs are recorded in `docs/demo.md` with Task IDs.
- [ ] Kill the worker mid-poll (Ctrl-C during `job-polling`), restart it, and confirm it resumes without a second hire.
- [ ] `npm test` is green.

### Step 3.9 — Run Agent 1 in the TUM Workspace

1. `sokosumi --preprod workspaces list --json` → read the TUM organization ID and slug.
2. `sokosumi --preprod coworkers connect <STRUCT_ID> --vendor-id <VENDOR_ID> --workspace-id <ORG_ID> --json`. If `PENDING`, `[HUMAN]` an org owner or admin must approve.
3. `sokosumi --preprod workspaces check <ORG_ID> --json` must show `taskSeatEligible: true` and Coworker access `GRANTED`.
4. Finish active Tasks, stop the worker, and set `SOKOSUMI_ORGANIZATION_ID` and `SOKOSUMI_ORGANIZATION_SLUG` in `.env.structured`. Restart.
5. Update `customer.mjs` to support `--org-slug` (passes `--organization-slug` to `tasks` commands).

**TEST GATE 3.9**
- [ ] One E2E happy run in the TUM Workspace, with the Task ID recorded. Refund calls in the org workspace use the fetch path with both context headers (verify with one live refund if budget allows, otherwise with a unit test).

### Step 3.10 — (Optional) Follow-up chat via Eve

Re-enable the template's `reply()` only **after** completion. Seed the Eve session with the contract, the attempts table and the final report, so the customer can ask "why did attempt 1 fail?". Adapt `agent/instructions.md` accordingly: QA explainer, no actions, treat the report as data.
**Gate:** live, one follow-up question answered correctly.

**Agent 1 is done. Tag `git tag agent1-done`. Do not start Part 4 until every gate in Part 3 is green.**

---

## Part 4 — QA Agent 2: Images (MVP scope)

### Step 4.1 — Second Coworker + worker wiring (smoke test in template mode)

1. `sokosumi --preprod coworkers register --vendor-id <VENDOR_ID> --name "QA · Images" --capability tasks --personal --json` → save the ID.
2. Key import, exactly as Step 1.2 item 7, with the new ID.
3. `.env.image`: `QA_MODE=template`, `COWORKER_ID=<IMG_ID>`, `STATE_DIR=.local/image`.
4. Run `npm run worker:image` **in parallel** with `worker:structured`.

**TEST GATE 4.1**
- [ ] A baseline Task to the image Coworker completes (template behaviour) while the structured worker is still running. Separate journals and locks.

### Step 4.2 — Image contract schema `qa/contract/image.mjs`

```js
ImageContract = {
  kind: 'image', version: 1, agentId: string, brief: string,
  images: { min: int>=1 (default 1), max: int>=1 (default 1) },
  technical?: { formats?: ('png'|'jpeg'|'webp')[], minWidth?: int, minHeight?: int,
                maxBytes?: int, aspectRatio?: { value: number /* w/h */, tolerance: number (default 0.02) } },
  text: {                      // OCR requirement
    mode: 'exact' | 'idea' | 'none',
    expected?: string,         // exact: the literal text; idea: a short description of the text's meaning
    caseSensitive: boolean (default true),          // exact only
    maxEditRatio: number (default OCR_EXACT_MAX_EDIT_RATIO=0.05)  // exact only: OCR-noise tolerance
  },
  objects: Array<{ label: string /* simple English noun phrase, singular */, minCount: int>=1 (default 1) }>,
  detector?: { threshold?: number },   // overrides DETECTOR_THRESHOLD if set
  retry: { maxAttempts, maxCreditsPerHire },
  notes?: string
}
```

Rules for drafting (Step 4.3), from the team's MVP decisions:
- **Exact vs idea:** `exact` when the brief contains quoted text ("…", '…', “…”), or says *exactly*, *verbatim*, *the text must read*. `expected` = the literal string without quotes. `idea` when the brief only describes the text ("a headline about a summer sale"). `none` when no text is requested.
- **Objects:** only concrete, visible, detectable nouns that the brief explicitly names ("a dog", "two bicycles", "a red car" → label "car", note the colour in `notes`, and leave colour unchecked in the MVP). Ignore abstract words (style, mood, "modern", "minimalist"). Counts come from number words ("two bicycles" → minCount 2).

**TEST GATE 4.2**
- [ ] Schema unit tests and renderer snapshot.

### Step 4.3 — Image contract drafting (LLM + deterministic cross-checks)

- The LLM produces an `ImageContract` from the brief.
- Code cross-checks:
  - (a) Every quoted substring in the brief must become `text.mode='exact'` with that exact `expected`. Code overrides the LLM if it disagrees.
  - (b) If there is no quoted text and the LLM said `exact`, downgrade to `idea`.
  - (c) Object labels are lowercased, trimmed, singularised with a tiny rule set (`-ies`→`-y`, `-s`→`` for words longer than 3 chars, with an exceptions list: glass, bus, …), and de-duplicated.
- Approval loop: reuse `qa/approval.mjs` unchanged.

**TEST GATE 4.3**
- [ ] Unit tests (fake LLM) for overrides (a)–(c).
- [ ] Live: briefs
  - `Poster with the text "SUMMER SALE -50%" and a bicycle`
  - `Banner announcing a coffee discount, show a cup of coffee and a croissant`
  - `Photo of two dogs on a beach, no text`

  give the expected modes and objects.

### Step 4.4 — Image acquisition `qa/validators/image/acquire.mjs`

- Add `sharp` as a direct dependency, pinned to the same version transformers.js uses (`npm ls sharp` after installing transformers.js in 4.6; install sharp now with the latest 0.35.x and align later).
- From the Job: files with image MIME or extension; markdown image links `![](url)` and plain URLs ending in png/jpg/jpeg/webp in `result`; Job links. Download (timeout 30 s, max 25 MB each), detect the real format with `sharp(buf).metadata()` (ignore the declared MIME), and save to `${STATE_DIR}/<task>/attempt-n/img-<k>.<ext>` with sha256.
- Count check: number of valid images vs `images.min`/`max`.

**TEST GATE 4.4**
- [ ] Unit tests with a local HTTP server serving fixtures: PNG file, JPEG via a markdown link, broken/HTML response rejected, oversize rejected.
- [ ] Run against the image spike Job output from 1.5 (if available).

### Step 4.5 — Technical metadata + OCR + text matching

**Fixtures first:** `scripts/make-image-fixtures.mjs` renders deterministic test images with sharp from SVG (`<svg><rect …/><text font-family="DejaVu Sans, Arial" font-size="96">SUMMER SALE -50%</text></svg>` → PNG). Make:
- `text-exact.png` ("SUMMER SALE -50%")
- `text-typo.png` ("SUMMER SAIE -50%")
- `text-other.png` ("WINTER DEALS")
- `text-coffee.png` ("Coffee 20% off today")
- `no-text.png`
- `small.png` (200×100)

Commit the generated PNGs so tests don't depend on system fonts.

`metadata.mjs` (sharp): format, width, height, bytes, aspect ratio → checks `technical.*`.

`ocr.mjs` (tesseract.js v7, pinned):
- Singleton worker: `const worker = await createWorker(OCR_LANG)`, created once at worker start (the first run downloads `eng.traineddata` from the jsDelivr CDN; for offline use set `langPath` and run the download in setup).
- Pre-process with sharp: if width < 1000 px, resize so width = 1000 (keep aspect); grayscale; normalise; PNG buffer.
- `const { data } = await worker.recognize(buf, {}, { blocks: true })` → `text`, overall `confidence`, and words with confidence from the `blocks` tree. Drop words with confidence < 40 from the "clean text" used for matching, but keep the raw text in the report.
- Terminate the worker on process exit.

`textmatch.mjs`:
- `normalise(s, {caseSensitive})`: Unicode NFKC; unify quotes (`“”„"`→`"`, `‘’'`→`'`) and dashes (`–—−`→`-`); collapse all whitespace to single spaces; trim; lowercase unless `caseSensitive`.
- **exact mode:** approximate substring match. Compute the minimum Levenshtein distance between `expected` and **any substring** of the OCR text (Sellers' algorithm: DP where row 0 is all zeros, answer = min of the last row). Pass if `distance / expected.length ≤ maxEditRatio`. Report the best-matching OCR substring, the distance and the ratio. Rationale: "exact" means the service must render the exact string, but OCR occasionally misreads a character in long text, so the tolerance absorbs that noise. With the default 0.05, strings under 20 characters allow **zero** differences, and a 40-character string allows 2. OCR can't tell an agent's typo from its own misread, so for short strings we deliberately err on the strict side. Keep the default at 0.05 and make it visible in the contract.
- **idea mode:** if the OCR clean text is empty → fail ("no legible text found"). Otherwise call `llm.generateJson` with the system prompt: "You compare OCR text extracted from an image with a description of what the text should communicate. OCR may contain small recognition errors. Answer whether the text conveys the described idea." Schema: `{matches: boolean, confidence: 0..1, reason: string (≤200 chars)}`. Pass if `matches && confidence ≥ 0.6`. This is the only LLM judgement in the image verdict, and the report labels it as `judged by LLM from OCR text`.
- **none mode:** skip (no check).

**TEST GATE 4.5**
- [ ] Unit tests for `normalise` and the approximate-substring distance (hand-computed cases, including expected text embedded in a longer OCR string).
- [ ] OCR tests on fixtures (these run the real tesseract, so mark them with a `{ timeout: 60000 }` option and keep them in `npm test` only if the total runtime is under 60 s; otherwise put them in `npm run test:slow`):
  - `text-exact.png` passes exact "SUMMER SALE -50%"
  - `text-typo.png` → distance 1 / 16 chars = 0.0625 > 0.05 → fails (correct: the agent misspelled it)
  - `text-other.png` fails
  - `no-text.png` → idea mode fails with "no legible text"
- [ ] Live idea-mode test: `text-coffee.png` vs "a discount on coffee" → pass; vs "a shoe sale" → fail.

### Step 4.6 — Object detector `qa/validators/image/detector.mjs` + benchmark and choice

Dependency: `@huggingface/transformers@4.3.2` (pinned). It brings `onnxruntime-node` 1.30.0 and `sharp`; align the direct `sharp` dependency with it.

```js
import { pipeline, RawImage } from '@huggingface/transformers';
let detectorPromise;
export function getDetector() {
  detectorPromise ??= pipeline('zero-shot-object-detection', process.env.DETECTOR_MODEL, { dtype: process.env.DETECTOR_DTYPE });
  return detectorPromise;            // first call downloads weights to the HF cache (~150–360 MB)
}
export async function detect(imagePath, labels, { threshold }) {
  const det = await getDetector();
  const image = await RawImage.read(imagePath);
  const isGroundingDino = /grounding-dino/i.test(process.env.DETECTOR_MODEL);
  const prompts = labels.map(l => isGroundingDino ? `a ${l}.` : `a photo of a ${l}`);
  const out = await det(image, prompts, { threshold });
  // map each output label back to the contract label by index or by stripping 'a ', 'a photo of a ', trailing '.'
  return out.map(o => ({ label: backToContractLabel(o.label), score: o.score, box: o.box }));
}
```

- Verify the label round-trip empirically: Grounding DINO returns the phrase text (for example `"a cat"`) per the model card. Write the mapping defensively and unit-test it with recorded outputs.
- Warm up at worker start (load the model and run one tiny image) so the first Task isn't slow. Log the load time.
- `objects.mjs`: for each contract object, count detections with `score ≥ threshold` (merge overlapping boxes of the same label with IoU > 0.5 before counting). Pass if count ≥ `minCount`. The report lists the top-3 scores per label.

**Benchmark (decides model + threshold):** `scripts/bench-detector.mjs`
- Fixture set `test/fixtures/images/detect/` with `labels.json` listing, per image, `present` and `absent` labels. Use 8–12 photos: freely licensed images from COCO val2017 (for example `http://images.cocodataset.org/val2017/000000039769.jpg`, two cats on a couch with remotes), plus a few the team provides that match their image agents' typical outputs `[HUMAN: optional, recommended]`. Include absent labels that are plausible distractors (for example "dog" on the cat image).
- For each model in `[onnx-community/grounding-dino-tiny-ONNX (q8), Xenova/owlv2-base-patch16 (q8)]`: run all images and all labels at threshold 0.05. Record each label's max score, the per-image latency (warm), and the model load time.
- Pick the threshold per model that maximises accuracy (present label max-score ≥ t, absent label max-score < t). Pick the model with the higher accuracy. If the accuracy difference is under 5 percentage points, choose the one with lower latency. A latency budget > 8 s per image (warm, laptop CPU) disqualifies a model.
- Write `docs/detector-choice.md`: a table of results, the chosen `DETECTOR_MODEL`, `DETECTOR_DTYPE` and `DETECTOR_THRESHOLD`, and hardware notes. Update `.env.image.example` defaults.

**TEST GATE 4.6**
- [ ] `npm run bench:detector` completes, and `docs/detector-choice.md` is written with the chosen model and threshold.
- [ ] A detector test (slow suite) on 3 fixtures with the chosen config: all present labels pass, all absent labels fail.
- [ ] Memory check: worker RSS after warm-up is logged (expect several hundred MB; fine on a laptop).

### Step 4.7 — Image validator pack + report

`qa/validators/image/index.mjs` runs, per image, in this order (cheap first; skip later checks on an early hard failure only for `parse`-level problems):

1. `images.count`
2. `technical.*` (format, minWidth, minHeight, maxBytes, aspectRatio)
3. `text` (exact | idea | none)
4. `objects` (each label as its own check: `objects.<label>`)
5. `integrity.hash` (informational, same as Agent 1)

Multiple images: the MVP rule is that **every** image must pass every check (state this in the contract render). The report has one table per image. Fix instructions use deterministic templates, for example: `Text must read exactly "SUMMER SALE -50%"; found "SUMMER SAIE -50%" (1 character differs).` / `Required object "bicycle" not detected (best score 0.12 < 0.30). Make the bicycle clearly visible.` / `Image is 800×600; minimum width is 1200 px.`

**TEST GATE 4.7**
- [ ] Unit test: a full validator run on fixtures with a fake detector and fake LLM gives the expected verdicts.
- [ ] Integration (slow suite): real OCR plus the real detector on 2 fixtures gives the expected report.

### Step 4.8 — Wire into the pipeline (`QA_MODE=image`) + E2E

- `pipeline.mjs` picks contract module, drafting rules, extractor and validator pack by `QA_MODE`. Everything else (approval, hire, poll, refund, rebrief, complete) is shared, unchanged code from Part 3.
- Result file: verdict + image links (Job file URLs) + local hashes + the report. Do not inline image bytes.

**TEST GATE 4.8 (end-to-end Agent 2)**
- [ ] Live E2E happy run with an image Agent from the team's group, using a brief that the Agent should satisfy (exact text + 1 object) → `COMPLETED`.
- [ ] Live E2E retry run: a brief that is likely to fail first (for example exact text with special characters) → a fail report with OCR evidence → rehire with the corrected brief.
- [ ] Both workers run concurrently without interference. `npm test` is green.
- [ ] Task IDs recorded in `docs/demo.md`.

### Step 4.9 — Image Coworker in the TUM Workspace

Same as Step 3.9 with the image Coworker. **Gate:** one E2E run in the TUM Workspace.

**Agent 2 is done. Tag `git tag agent2-done`.**

---

## Part 5 — Optional extras and submission

### Step 5.1 — (Optional) Paid QA Task on Preprod (template flow, structured Coworker only)

Follow the template README section "Optional Preprod payments" and the skill's step 5 **exactly**:
1. A dedicated Masumi Payment Service (Postgres via Docker), its own DB, encryption key and selling wallet.
2. Fund it with test ADA `[HUMAN]` (faucet / Masumi dispenser).
3. A wallet-scoped key via `payment-registration.mjs key`, then registration.
4. `AGENT_AUTHOR` set.
5. `npm run api`, `PAID_TASKS_ENABLED=true`.

The template's paid flow runs before the model answer. Integrate it so that the QA pipeline starts after `FundsLocked` (reuse `paid-task.mjs` stages; replace its `answer(...)` call with the QA pipeline run, and keep its deadlines: `submitResultTime` is 20 min in the template, so raise it only if your QA run needs longer, and keep `unlockTime` and `externalDisputeUnlockTime` ordered).

**Gate:** one paid QA Task. Save the Task ID, the payment transaction hash and the seller receipt (`sokosumi --preprod runtime receipt <TASK_ID> --coworker-id <ID> --json` → `settled: true` with `txHash`).

### Step 5.2 — Demo + submission

- `docs/demo.md`: the 4-minute script (structured happy + retry, image retry), with the commands from `customer.mjs`.
- README: what it is, architecture diagram (text), exact run commands for both workers, how a customer creates a QA Task, limits (refunds become disputes; MVP checks; detector accuracy), and the submission checklist items from https://www.masumi.network/tum-hackathon/submission.
- Final gate: a fresh clone + `npm ci` + `npm test` is green; secrets are absent from git history (`git log -p | grep -iE "coworker_|ADMIN_KEY|mnemonic|ZAI_API_KEY="` returns nothing meaningful).

---

## Appendix A — Prompts (starting points; keep them in `qa/prompts/*.md`)

**Structured contract drafter (system):** "You convert a customer's data request into a strict acceptance contract (JSON) for a data-producing AI agent. Encode only requirements that the request states or clearly implies. When something is ambiguous, choose the most common convention and record the assumption in `notes`. Output only a JSON object matching the provided schema." Then attach: the schema description, the brief, the agent description and the agent's input field names.

**Image contract drafter (system):** "You convert a customer's image request into an acceptance contract (JSON). Text: if the request quotes text or demands exact wording, use mode `exact` with the literal text; if it only describes the text's meaning, use `idea` with a one-sentence description; otherwise `none`. Objects: list only concrete, visible, detectable nouns the request explicitly names, as singular lowercase English noun phrases, with counts from number words. Ignore style, mood and colour (record them in `notes`). Output only JSON."

**Contract reviser:** "Apply the customer's requested changes to this contract. Change nothing else. Output the full updated contract as JSON."

**Rebrief polisher (optional):** "Rewrite these fix instructions as a clear, polite brief for the agent. Keep every instruction and every number. Do not add requirements."

**OCR idea judge:** see Step 4.5.

## Appendix B — Known risks and how the plan handles them

| Risk | Handling |
|---|---|
| Hiring disabled or empty on Preprod | Step 1.5 spike first; mock fallback behind `QA_HIRE_BACKEND` |
| Agent input schemas vary | `buildInputData` validation; fail fast without spending credits |
| Refund becomes a dispute and never settles during the event | Fire-and-forget; show `refund_pending`/`dispute_pending` in the report |
| Credits run out mid-demo | Per-hire `maxCredits`, attempt budget, 402 → clean FAILED |
| Agents wrap data in markdown | `extract.mjs` order + `warn` finding |
| OCR noise vs exact text | `maxEditRatio` (default 0.05), visible in the contract and report |
| Detector false negatives on small objects | Benchmark-chosen threshold; the report shows best scores; the fix instruction asks for a clearly visible object |
| Worker crash mid-write | `*-pending` phases + `reconcile()` before any retry |
| CLI/template drift | Pin CLI 1.0.4 and all deps; no upgrades |
