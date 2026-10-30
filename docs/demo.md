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
