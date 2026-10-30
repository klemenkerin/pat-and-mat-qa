# Spike findings (Step 1.5): hiring an Agent from inside a Task on Preprod

Run 2026-10-30 by Claude Code on Klemen's Mac (Node 24, CLI 1.1.0). Raw evidence: `.local/spike/2026-10-30T20-24-15-850Z/` (hire) and `.local/spike/2026-10-30T20-36-06-545Z/` (job, result, files, links, refund). No secrets in either.

| What | Value |
|---|---|
| Agent | "Expose: Advanced Web Research" `cmmdca97d000304icco9htf5n` |
| Task (personal, owner Klemen) | `01a18e7c-1187-771b-a8fe-d009dd3d04ad`, completed by the Coworker after the spike |
| Job | `01a18e7c-3932-713c-a6c8-9bdc0e39bdc3`, name `QA attempt 1` |
| Brief | 5-row CSV `date,value` of DAX closing prices, `yyyy-MM-dd`, csv code block |
| jobType / credits | `PAID`, **1 credit** (hire sent `maxCredits: 20`) |
| Total spend so far | 1 credit (of the 100-credit budget) |

## Answers to the open questions (HANDOFF §2.3)

1. **Does `POST /v1/tasks/{taskId}/jobs` work?** **Yes.** The Coworker key hired the Agent inside its Task; the response was the Job with status `payment_pending`, credits 1. The Job is billed to the Task owner and shows under the Task in the web app.
2. **Can the Coworker key read `GET /v1/agents/{id}/input-schema`?** **Yes**, without context headers. Shape: `{input_data:[{id,type,name,data,validations}]}`. This Agent has `info` (type `none`, display only), `research_question` (textarea, required) and `additional_context` (textarea, optional). `buildInputData` already skips `none` and fills the single required text field. Note: "Ask the Crowd: Survey" (`cmnr6sr2l000d04jyi3hl3lrj`) and "Expose: Instagram Page Analysis" return **422** on this route, so they are probably not hireable.
3. **Real Job output shape.**
   - `result`: 10.5 KB markdown research report. The deliverable is a ```` ```csv ```` fenced block under `## CSV Data Output`. The report also contains prose with commas and German number formats, so fence-first extraction matters. `extract.mjs` gets `origin: result-fence`, `delivery.clean: warn`, and all checks pass (regression fixture `test/fixtures/structured/live/advanced-web-research-dax.md`).
   - `/files`: `[]`. `/links`: 10 source URLs `{id, createdAt, updatedAt, jobId, url, title}` (citations, not deliverables).
   - `resultHash` present; `identifierFromPurchaser` present. `sha256(identifierFromPurchaser + ";" + result)` does **not** match, so `integrity.hash` = `warn: unverifiable`, as designed.
   - Timeline (job events): INITIATED 20:24:28Z → AWAITING_PAYMENT 20:24:33Z → RUNNING 20:26:33Z → COMPLETED 20:29:33Z (**about 5 min** hire-to-result).
   - **Gotcha:** the top-level `status` stayed `payment_pending` (`onChainStatus: null`) for several minutes **after** the Agent completed. By 20:36Z it read `completed` / `onChainStatus: RESULT_SUBMITTED`. The pipeline now uses `effectiveJobStatus()`: `payment_pending` with `completedAt` and a non-empty `result` counts as completed (raw status kept in the journal as `rawJobStatus`).
   - Escrow times on this Job: payBy +45 min, submitResult +4 h, unlock +10 h, externalDisputeUnlock +16 h.
4. **Does `GET /v1/tasks/{id}/jobs` return the `name` we pass?** **Yes** (`"QA attempt 1"`), and it works with the bare Coworker key. Crash reconciliation by name stays as built.
5. **Does `POST /v1/jobs/{id}/refund` with `X-Context-User-Id` work for a Coworker?** **Yes:** `requested` → job status `refund_pending` (called after the result was submitted, so on-chain this becomes a dispute; we do not wait for it).

## Surprise: job reads need the owner context
`GET /v1/jobs/{id}` (and `/files`, `/links`) with the bare Coworker key → **403 "Workspace is missing"**. With `X-Context-User-Id: <task owner>` they work. The adapter now sends the owner context for all job routes (CLI client in personal workspaces, `fetch` with both context headers in organization workspaces). `getJob/getJobFiles/getJobLinks` take `(task, jobId)`.

## Web app notes
The web app opened in the TUM-Hackathon organization by default ("Assigned seat required", "Your credits are used up"). The spike Task and Job are in the **Personal** workspace (switch via the workspace menu, top left).

## Not covered yet
No image Agent was spiked: the only image Agent on Preprod is "Stock Photos Agent" (500 credits), above the 20-credit-per-hire cap. Decision pending with the human.
