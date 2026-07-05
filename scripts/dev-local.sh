#!/usr/bin/env bash
# Start Stride locally with NO Docker (native API + worker, Postgres, local storage).
# Usage:  ./scripts/dev-local.sh          # start everything
#         ./scripts/dev-local.sh status   # check what's running
#         ./scripts/dev-local.sh stop      # stop API + worker
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="/tmp/stride-logs"; mkdir -p "$LOG_DIR" /tmp/stride-local-storage

api_pid()    { pgrep -f "tsx src/index.ts" || true; }
worker_pid() { pgrep -f "src/worker.py" || true; }

status() {
  echo "Postgres :5432 : $(nc -z -w2 localhost 5432 >/dev/null 2>&1 && echo UP || echo DOWN)"
  echo "API          : $([ -n "$(api_pid)" ] && echo "UP (pid $(api_pid))" || echo DOWN)"
  echo "Worker       : $([ -n "$(worker_pid)" ] && echo "UP (pid $(worker_pid))" || echo DOWN)"
  echo "API health   : $(curl -s --max-time 5 http://localhost:3000/health 2>/dev/null || echo 'no response')"
}

stop() {
  [ -n "$(api_pid)" ] && kill $(api_pid) && echo "stopped API" || echo "API not running"
  [ -n "$(worker_pid)" ] && kill $(worker_pid) && echo "stopped worker" || echo "worker not running"
}

start() {
  if ! nc -z -w2 localhost 5432 >/dev/null 2>&1; then
    echo "❌ Postgres is not running on :5432 — start it first (Postgres.app / brew services start postgresql)"; exit 1
  fi
  # API
  if [ -z "$(api_pid)" ]; then
    ( cd "$ROOT/apps/api" && nohup npx tsx src/index.ts > "$LOG_DIR/api.log" 2>&1 & )
    echo "started API   -> $LOG_DIR/api.log"
  else echo "API already running (pid $(api_pid))"; fi
  # Worker (native venv, local DB-poll mode)
  if [ -z "$(worker_pid)" ]; then
    ( cd "$ROOT/apps/ml-worker" && source .venv312/bin/activate && \
      nohup env PYTHONPATH=. STORAGE_DRIVER=local LOCAL_STORAGE_DIR=/tmp/stride-local-storage \
        DATABASE_URL="postgres://stride:stride_dev@localhost:5432/stride_test" \
        API_SERVER_URL=http://localhost:3000 INTERNAL_API_SECRET=dev-internal-secret-change-in-prod \
        STRIDE_PIPELINE=2d POSE2D_BACKEND=rtmpose RTMPOSE_MODE=lightweight POSE_FPS=15 \
        python -u src/worker.py > "$LOG_DIR/worker.log" 2>&1 & )
    echo "started worker-> $LOG_DIR/worker.log"
  else echo "worker already running (pid $(worker_pid))"; fi
  sleep 6; echo "---"; status
}

logs() {
  echo "tailing $LOG_DIR/{api,worker}.log — Ctrl-C to stop"
  tail -n 20 -f "$LOG_DIR/api.log" "$LOG_DIR/worker.log" 2>/dev/null \
    | grep --line-buffered -viE "W0000|I0000|oneDNN|cpu_feature|absl|pkg_resources|from pkg"
}

case "${1:-start}" in
  status) status ;;
  stop)   stop ;;
  logs)   logs ;;
  *)      start ;;
esac
