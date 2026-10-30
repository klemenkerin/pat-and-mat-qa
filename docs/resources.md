# Resource IDs (no secrets)

| Resource | ID | Notes |
|---|---|---|
| Vendor "Green Dragons" (slug `your-team-qa`) | `01a18e31-8ed8-75b8-b2e5-e1e71eb3c5a8` | created 2026-10-30 |
| Coworker "Pat - Structured data QA" (slug `pat-structured-data-qa`) | `01a18e40-3f26-743b-b191-e710204e055f` | capability `tasks`, personal access |
| Coworker: QA · Images | | Part 4 |
| TUM organization ID / slug | | Step 3.9 |
| Structured Agent (primary) "Expose: Advanced Web Research" | `cmmdca97d000304icco9htf5n` | listed 1 credit; chosen by Claude with the human's OK; spike pending |
| Structured Agent (backup) "Ask the Crowd: Survey (Bansumi)" | `cmnr6sr2l000d04jyi3hl3lrj` | listed 1 credit |
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
