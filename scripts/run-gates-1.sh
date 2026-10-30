#!/usr/bin/env bash
# Runs Gates 2.3 (model), 2.2 (read-only Sokosumi) and 1.4 (per-Coworker worker) unattended.
# Usage (Mac terminal, repo root, Node 24):  bash scripts/run-gates-1.sh
# Writes .local/gate-logs/gates-1-<time>.log (no secrets: keys are never printed).
set -u
cd "$(dirname "$0")/.."
mkdir -p .local/gate-logs
STAMP=$(date +%Y%m%d-%H%M%S)
LOG=".local/gate-logs/gates-1-$STAMP.log"
EVELOG=".local/gate-logs/eve-$STAMP.log"; W1LOG=".local/gate-logs/worker1-$STAMP.log"; W2LOG=".local/gate-logs/worker2-$STAMP.log"
exec > >(tee "$LOG") 2>&1
PIDS=()
cleanup(){ for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done; sleep 1; for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill -9 "$p" 2>/dev/null; done; }
trap cleanup EXIT
result(){ echo "RESULT $1: $2"; }

echo "== environment"
node -v; command -v sokosumi || { echo "sokosumi not on PATH (run: nvm use 24)"; exit 1; }
sokosumi --version
[ -f .env.structured ] || { echo ".env.structured missing"; exit 1; }
COWORKER_ID=$(grep -E '^COWORKER_ID=' .env.structured | tail -1 | cut -d= -f2-)
echo "coworker: $COWORKER_ID   mode: $(grep -E '^QA_MODE=' .env.structured | cut -d= -f2-)"
BASELINE=01a18e55-4cae-749e-af90-258b0aaed74f

echo; echo "== Gate 2.3: model check"
if node --env-file=.env scripts/live-llm-check.mjs; then result 2.3 PASS; else result 2.3 FAIL; fi

echo; echo "== Gate 2.2: read-only Sokosumi check (baseline task)"
if node --env-file=.env --env-file=.env.structured scripts/live-sokosumi-check.mjs "$BASELINE"; then result 2.2 PASS; else result 2.2 FAIL; fi

echo; echo "== Gate 1.4: worker:structured with its own STATE_DIR"
node --env-file-if-exists=.env start.mjs >"$EVELOG" 2>&1 & PIDS+=($!)
for i in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:21949" && break; sleep 1; done
echo "eve up after ~${i}s"
node --env-file-if-exists=.env --env-file-if-exists=.env.structured worker.mjs >"$W1LOG" 2>&1 & PIDS+=($!)
for i in $(seq 1 60); do grep -q "Continuous worker running" "$W1LOG" && break; sleep 1; done
grep -q "Continuous worker running" "$W1LOG" && echo "worker 1 running" || { echo "worker 1 did not start:"; tail -20 "$W1LOG"; result 1.4 FAIL; exit 1; }
CREATED=$(sokosumi --preprod tasks create --personal --coworker-id "$COWORKER_ID" --name "gate 1.4 baseline" --description "Suggest five team names for a data quality project." --status READY --json)
TASK=$(node -e 'const r=JSON.parse(process.argv[1]);console.log((r.task??r.data??r).id)' "$CREATED")
echo "created task $TASK"
STATUS=
for i in $(seq 1 30); do
 STATUS=$(sokosumi --preprod tasks get "$TASK" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log((r.task??r).status)})')
 [ "$STATUS" = COMPLETED ] || [ "$STATUS" = FAILED ] && break; sleep 4
done
echo "task status: $STATUS"
echo "-- second worker (must refuse):"
node --env-file-if-exists=.env --env-file-if-exists=.env.structured worker.mjs >"$W2LOG" 2>&1 & W2=$!
sleep 10; kill "$W2" 2>/dev/null
grep -E "already running|Error" "$W2LOG" | head -3
echo "-- journal files:"; ls -la .local/structured/ | grep -v gate-logs
if [ "$STATUS" = COMPLETED ] && grep -q "already running" "$W2LOG" && [ -f ".local/structured/$TASK.json" ]; then result 1.4 PASS; else result 1.4 FAIL; fi
echo "task id: $TASK"
echo; echo "Log: $LOG"
