# Demo runs (live, Sokosumi Preprod, Personal Workspace)

## Structured QA Coworker ("Pat - Structured data QA")

### Happy path: Gate 3.8 #1
- Task `01a18e9b-9fa1-72e5-91f9-194fac885e3f` (2026-10-30), service Agent "Expose: Advanced Web Research" `cmmdca97d000304icco9htf5n`.
- Brief: CSV of DAX, CAC 40 and FTSE 100 closing prices for the last 5 trading days; columns date (YYYY-MM-DD), index (DAX/CAC40/FTSE100), close; 15 rows.
- Flow: contract v1 → INPUT_REQUIRED → customer `APPROVE` → hired Job `01a18e9b-f6af-70e6-8dbe-2e646968e621` (1 credit) → result after ~6.5 min → 11 checks pass (1 warning: data wrapped in markdown) → Task COMPLETED with the CSV and the QA report.
- Run in gate steps (QA_STOP_AFTER approved → verifying → verified → none), so the worker was restarted between phases and resumed from the journal each time.

### Auto-approve run + crash/restart (Gate 3.7 attempt, 3.8 #3)
- Task `01a18ea3-3294-7133-a9fb-ff6734dc6a90` (2026-10-30): same brief but `close` as an integer; `autoApprove`, max 2 attempts.
- Worker killed while polling attempt 1 and restarted: resumed the same Job `01a18ea3-7b77-76a2-9549-fc147dba6f0f`, no second hire.
- The Agent complied (integers), so attempt 1 passed and the Task COMPLETED. The retry path was not exercised by this run.

### Retry loop: Gate 3.7 / 3.8 #2 (best demo run)
- Task `01a18ea9-a005-707c-9e22-1ea7f4b3afa3` (2026-10-30): 20 trading days × DAX/CAC40/FTSE100 = exactly 60 rows; `autoApprove`, max 2 attempts.
- Attempt 1, Job `01a18ea9-e71c-711d-b584-8a0c30bedcc4`: the Agent returned **9 rows** → `records.count` fails → refund requested → job `refund_pending` → comment "Attempt 1/2 failed: 1 of 13 checks failed: records.count".
- Rebrief: "Return exactly 60 records (you returned 9)." The service brief exceeded the Agent's 500-char cap, so it was split: research_question 192 chars + additional_context 365 chars.
- Attempt 2, Job `01a18eaf-d8d6-734b-bca7-cc9ce156be0d`: 60 rows, all checks pass → Task COMPLETED "QA PASSED … attempt 2 of max 2".

## Agent 2: QA · Images (Mat, Coworker `01a18eb7-c523-7195-a1e5-238f76defa8b`)

The image hire is a **local stand-in** (`QA_HIRE_BACKEND=mock`, Agent `local-image-standin`): Preprod has no affordable image Agent. The Sokosumi Task, contract approval, events and completion are real; only the Job runs locally (no payment, refund "skipped"). The stand-in composes the image from COCO photos plus rendered text and, like many image models, drops symbols from the text until a rehire asks for the exact text.

### Happy run with contract revision (Gate 4.8 #1)
- Task `01a18ed2-01b4-76ab-8ef0-6fb665e274b2` (2026-10-30): poster "ADOPT A CAT TODAY" + a cat, PNG, at least 1000 px wide.
- Contract v1 drifted (1024×768, 5 MB cap; copied from the prompt's example shape). The customer replied with changes → v2 with 1000 px width (it still kept the size cap; fixed afterwards by drafting rule (d), commit `7fcceb2`) → `APPROVE`.
- Mock Job `mock-29ac4d62-…`: 1200×800 PNG; OCR "ADOPT A CAT TODAY" (0 differences), OWLv2 found 2 cats (0.30, 0.28) → all 6 checks pass → Task COMPLETED.

### Retry loop (Gate 4.8 #2, best image demo run)
- Task `01a18ed8-c30e-75ef-b96d-551a78dae7c9` (2026-10-30): "CAT TOYS -50%!" + two cats, PNG; `autoApprove`, max 3 attempts. Contract (with rule (d)): PNG only, exact text, 2× cat.
- Attempt 1, `mock-c05a2177-…`: OCR read "CAT TOYS 50" → `text` fails (3 characters differ), cats pass → comment "Attempt 1/3 failed … Refund: skipped (mock job: nothing was paid)" with the report.
- Rebrief: `Text must read exactly "CAT TOYS -50%!"; found "CAT TOYS 50" …` → attempt 2, `mock-7c9eb1d9-…`: all checks pass → Task COMPLETED.
- `worker:structured` (Eve) was running the whole time.
