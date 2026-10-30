# Resource IDs (no secrets)

| Resource | ID | Notes |
|---|---|---|
| Vendor "Green Dragons" (slug `your-team-qa`) | `01a18e31-8ed8-75b8-b2e5-e1e71eb3c5a8` | created 2026-10-30 |
| Coworker "Pat - Structured data QA" (slug `pat-structured-data-qa`) | `01a18e40-3f26-743b-b191-e710204e055f` | capability `tasks`, personal access |
| Coworker "Iris - Image QA" (slug `iris-image-qa`) | `01a18eb7-c523-7195-a1e5-238f76defa8b` | capability `tasks`, personal access GRANTED; key in CLI vault (2026-10-30) |
| TUM organization ID / slug | | Step 3.9 |
| Structured Agent (primary) "Expose: Advanced Web Research" | `cmmdca97d000304icco9htf5n` | 1 credit per hire (PAID); spiked OK 2026-10-30 |
| Structured Agent (backup) "Ask the Crowd: Survey (Bansumi)" | `cmnr6sr2l000d04jyi3hl3lrj` | input-schema returns 422: probably not hireable |
| Customer user (Klemen) | `01a18e1e-c415-7388-b980-7ceb710c98c4` | Task `userId` = owner |
| Baseline Task (Gate 1.3) | `01a18e55-4cae-749e-af90-258b0aaed74f` | COMPLETED 2026-10-30 19:42:04Z, ~7 s after creation; evidence in docs/evidence/baseline-task.json |

## Gate log
| Gate | Result | Date | Evidence |
|---|---|---|---|
| 1.1 template baseline tests | pass (29/29) | 2026-10-30 | container run |
| 1.2 account, vendor, coworker, key import | pass | 2026-10-30 | IDs above; CLI 1.1.0 required (1.0.4 personal routes return 404) |
| 1.3 template end-to-end | pass | 2026-10-30 | baseline Task COMPLETED |
| 0 sanity (Mac) | pass | 2026-10-30 | Node v24.22.2, CLI 1.1.0, `npm ci`, `npm test` 104/104 |
| 2.3 live model check | pass | 2026-10-30 | `{"answer":5}`, 54 tokens; log `.local/gate-logs/gates-1-20261030-210904.log` |
| 2.2 live read-only Sokosumi check | pass | 2026-10-30 | baseline Task: COMPLETED, 4 events, 0 jobs, actor types user+coworker |
| 1.4 per-Coworker worker | blocked | 2026-10-30 | run 1 invalid: a leftover Gate 1.3 template worker (STATE_DIR `.local`) took Task `01a18e6e-3235-70e9-9e3d-061377b427b6` first; lock refusal check passed. Rerun after stopping it |
| 1.4 per-Coworker worker (rerun) | pass | 2026-10-30 | Task `01a18e76-95b7-712c-9763-c8ca7a543c68` COMPLETED by `worker:structured`; journal in `.local/structured/`; 2nd worker refused ("Worker already running"); 2.3/2.2 passed again; log `.local/gate-logs/gates-1-20261030-211809.log` |
| 1.5 hire spike (structured) | pass | 2026-10-30 | Task `01a18e7c-1187-771b-a8fe-d009dd3d04ad`, Job `01a18e7c-3932-713c-a6c8-9bdc0e39bdc3` (Advanced Web Research) completed in ~5 min, PAID 1 credit, CSV in a csv fence; refund probe → `refund_pending`; details in docs/spike-findings.md. Image spike not run (no affordable image Agent) |
| 3.3 approval loop (live) | pass | 2026-10-30 | Task `01a18e95-a6b3-731b-acfa-3787144ced4a`: contract v1 posted with INPUT_REQUIRED (15 rows; date yyyy-MM-dd; index enum DAX/CAC40/FTSE100; close number ≥0; unique date+index) → customer `APPROVE` → RUNNING "Contract v1 approved…"; 0 jobs (QA_STOP_AFTER=approved) |
| 3.4 hire + poll (live) | pass | 2026-10-30 | Task `01a18e9b-9fa1-72e5-91f9-194fac885e3f`: approved → hired Job `01a18e9b-f6af-70e6-8dbe-2e646968e621` (444-char brief) 20:59:09Z → result 21:05:37Z (raw status still payment_pending, effective completed) → stopped at verifying. Earlier runs `01a18e95-a6b3-731b-acfa-3787144ced4a` and `01a18e97-b42d-7176-afce-4190a870b2f9` FAILED at hire (Agent input > 500 chars, 0 credits). Raw output is written by verify (Gate 3.5), not at 3.4 |
| 3.5/3.6 extraction + validation on live output | pass | 2026-10-30 | Task `01a18e9b-9fa1-72e5-91f9-194fac885e3f` attempt 1: CSV from the result's csv fence (delivery.clean warn), 15 rows, all field/null/unique checks pass, integrity.hash skip (no resultHash while payment_pending); artefacts in `.local/structured/qa-01a18e9b-9fa1-72e5-91f9-194fac885e3f/attempt-1/` |
| 3.8 #1 happy E2E (live) | pass | 2026-10-30 | Task `01a18e9b-9fa1-72e5-91f9-194fac885e3f` COMPLETED: result = verdict + CSV + QA report (docs/demo.md) |
| 3.8 crash/restart (live) | pass | 2026-10-30 | Task `01a18ea3-3294-7133-a9fb-ff6734dc6a90`: worker killed in job-polling (attempt 1, Job `01a18ea3-7b77-76a2-9549-fc147dba6f0f`), restarted 21:07Z; resumed polling the same Job, remote Task still has exactly 1 Job |
| 3.7 retry loop (live) | pass | 2026-10-30 | Task `01a18ea9-a005-707c-9e22-1ea7f4b3afa3`: attempt 1 (9 of 60 rows) failed → refund requested (`refund_pending`) → rebrief split over two fields → attempt 2 passed → COMPLETED; both Jobs under the Task. First try `01a18ea3-3294-7133-a9fb-ff6734dc6a90` passed on attempt 1, so no retry there |
| 4.1 second Coworker + parallel workers | pass | 2026-10-30 | Iris baseline Task `01a18eb8-6189-73dc-9a90-c62ae82b89ad` COMPLETED in template mode while `worker:structured` ran; journals/locks in `.local/image/` and `.local/structured/` |
| 4.2 image contract schema + renderer | pass | 2026-10-30 | unit tests (`test/contract-image.test.mjs`) |
| 4.3 image contract drafting | pass | 2026-10-30 | unit rules (a)-(c) + live `scripts/live-image-draft.mjs`: poster → exact "SUMMER SALE -50%" + bicycle; coffee banner → idea + cup of coffee, croissant; two dogs on a beach → none + 2× dog (beach = scenery) |
| 4.4 image acquisition | pass | 2026-10-30 | unit tests with a local HTTP server: PNG file, JPEG markdown link, mislabelled JPEG detected by content, HTML/oversize/404 rejected, data URLs; signed-URL queries stripped from reports. Live run against a real image Job: n/a (no affordable image Agent) |
| 4.5 metadata + OCR + text matching | pass | 2026-10-30 | unit: normalise, Sellers distance, 5% tolerance, technical checks; real tesseract on committed fixtures (exact passes; "SAIE" typo d=1/16 fails; other text fails; no text → "no legible text"), ~50 ms/image warm; live idea judge (`scripts/live-ocr-idea.mjs`): coffee fixture vs "a discount on coffee" pass (0.98), vs "a shoe sale" fail |
