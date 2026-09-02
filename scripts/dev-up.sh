#!/usr/bin/env bash
# Bring up the whole Stride stack for phone testing, in one command.
#
#   ./scripts/dev-up.sh
#
# No Docker. The API runs with STORAGE_DRIVER=local, so uploads go to a shared
# directory on disk and the ML worker polls Postgres directly — the only
# external service needed is Postgres itself.
#
# The one thing that reliably breaks phone testing is the Mac's LAN IP changing
# (DHCP hands out a new one, and the address baked into the app at bundle time
# is suddenly unreachable). This detects the current IP every run and rewrites
# apps/mobile/.env, so that failure mode is designed out rather than debugged
# again.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_PORT="${API_PORT:-3001}"
LOG_DIR="${TMPDIR:-/tmp}/stride-dev"
mkdir -p "$LOG_DIR"

say() { printf '  %-22s %s\n' "$1" "$2"; }
die() { printf '\n  ERROR: %s\n\n' "$1" >&2; exit 1; }

echo
echo "Stride dev stack"
echo "────────────────────────────────────────────────────────────"

# ── 1. Network ───────────────────────────────────────────────────────────────
# Take the IP off whichever interface actually carries the default route; en0 is
# not always it (Ethernet adapters, tethering).
IFACE="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
LAN_IP="${LAN_IP:-$(ipconfig getifaddr "${IFACE:-en0}" 2>/dev/null || true)}"
if [ -z "$LAN_IP" ]; then
  die "No network. The phone reaches this Mac over the LAN, so connect to Wi-Fi first."
fi
# A 192.0.0.x address is iPhone USB/hotspot tethering, not a shared LAN. The
# stack will run, but a second device generally cannot route to the Mac there.
case "$LAN_IP" in
  192.0.0.*) say "network" "$IFACE @ $LAN_IP  (tethered — phone may not reach this)" ;;
  *)         say "network" "$IFACE @ $LAN_IP" ;;
esac

# ── 2. Postgres ──────────────────────────────────────────────────────────────
DB_URL="$(grep -m1 '^DATABASE_URL=' "$ROOT/apps/api/.env" | cut -d= -f2- || true)"
[ -n "$DB_URL" ] || die "DATABASE_URL missing from apps/api/.env"
psql "$DB_URL" -q -c 'select 1' >/dev/null 2>&1 \
  || die "Postgres unreachable. Start it (brew services start postgresql@16) and retry."
say "postgres" "ok"

# ── 3. Coach provider ────────────────────────────────────────────────────────
# Reported, not enforced: the app runs fine without a coach, it just cannot
# answer questions or build a plan.
if grep -qE '^GOOGLE_API_KEY=.+' "$ROOT/apps/api/.env"; then
  say "coach" "Google AI Studio"
elif grep -qE '^GROQ_API_KEY=.+' "$ROOT/apps/api/.env"; then
  say "coach" "Groq (no Google key set)"
else
  say "coach" "NOT CONFIGURED — analysis works, coach will not"
fi

# ── 4. Point the app at this Mac ─────────────────────────────────────────────
MOBILE_ENV="$ROOT/apps/mobile/.env"
CURRENT="$(grep -m1 '^EXPO_PUBLIC_API_BASE_URL=' "$MOBILE_ENV" | cut -d= -f2- || true)"
WANT="http://$LAN_IP:$API_PORT"
if [ "$CURRENT" != "$WANT" ]; then
  # macOS sed needs the empty -i argument.
  sed -i '' "s|^EXPO_PUBLIC_API_BASE_URL=.*|EXPO_PUBLIC_API_BASE_URL=$WANT|" "$MOBILE_ENV"
  say "app -> api" "$WANT  (updated, was ${CURRENT:-unset})"
else
  say "app -> api" "$WANT"
fi

# ── 5. Services ──────────────────────────────────────────────────────────────
pkill -f "tsx watch src/index.ts" 2>/dev/null || true
pkill -f "src.worker" 2>/dev/null || true
sleep 2

# </dev/null and the closed fds matter: without them the background
# children keep this script's stdout pipe open, so `dev-up.sh | tee log`
# never returns even though the stack is up.
( cd "$ROOT/apps/api" && nohup npm run dev >"$LOG_DIR/api.log" 2>&1 </dev/null & ) >/dev/null 2>&1
for _ in $(seq 1 30); do
  curl -sf --max-time 2 "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf --max-time 3 "http://127.0.0.1:$API_PORT/health" >/dev/null \
  || die "API did not come up. See $LOG_DIR/api.log"
say "api" "http://$LAN_IP:$API_PORT  (log: $LOG_DIR/api.log)"

# The worker needs the API's own env (DB, storage dir) PLUS the pipeline choice
# and a callback URL. API_SERVER_URL defaulting to :3000 has bitten before —
# another service answered there and a finished analysis was silently dropped.
( cd "$ROOT/apps/ml-worker" \
  && set -a && . "$ROOT/apps/api/.env" && set +a \
  && STRIDE_PIPELINE=3d-geo POSE2D_BACKEND=rtmpose RTMPOSE_MODE=lightweight \
     POSE_FPS=15 API_SERVER_URL="http://127.0.0.1:$API_PORT" \
     nohup .venv312/bin/python -m src.worker >"$LOG_DIR/worker.log" 2>&1 </dev/null & ) >/dev/null 2>&1
sleep 6
pgrep -f "src.worker" >/dev/null \
  || die "ML worker did not start. See $LOG_DIR/worker.log"
say "ml worker" "3d-geo  (log: $LOG_DIR/worker.log)"

echo "────────────────────────────────────────────────────────────"
echo
echo "  Now start Expo in your own terminal so you get the QR code:"
echo
echo "      cd apps/mobile && npx expo start --clear"
echo
echo "  --clear matters: EXPO_PUBLIC_* is baked in at bundle time, so the API"
echo "  address above only reaches the phone after a fresh bundle."
echo
echo "  Phone and Mac must be on the SAME Wi-Fi network."
echo
