# Resource IDs (no secrets)

| Resource | ID | Notes |
|---|---|---|
| Vendor "Green Dragons" (slug `your-team-qa`) | `01a18e31-8ed8-75b8-b2e5-e1e71eb3c5a8` | created 2026-10-30 |
| Coworker "Pat - Structured data QA" (slug `pat-structured-data-qa`) | `01a18e40-3f26-743b-b191-e710204e055f` | capability `tasks`, personal access |
| Coworker: QA · Images | | Part 4 |
| TUM organization ID / slug | | Step 3.9 |
| Customer user (Klemen) | `01a18e1e-c415-7388-b980-7ceb710c98c4` | Task `userId` = owner |
| Baseline Task (Gate 1.3) | `01a18e55-4cae-749e-af90-258b0aaed74f` | COMPLETED 2026-10-30 19:42:04Z, ~7 s after creation; evidence in docs/evidence/baseline-task.json |

## Gate log
| Gate | Result | Date | Evidence |
|---|---|---|---|
| 1.1 template baseline tests | pass (29/29) | 2026-10-30 | container run |
| 1.2 account, vendor, coworker, key import | pass | 2026-10-30 | IDs above; CLI 1.1.0 required (1.0.4 personal routes return 404) |
| 1.3 template end-to-end | pass | 2026-10-30 | baseline Task COMPLETED |
