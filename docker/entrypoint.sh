#!/bin/sh
set -e

# Unraid-style privilege dropping: PUID/PGID default to nobody/users
PUID="${PUID:-99}"
PGID="${PGID:-100}"

if ! getent group metamagic >/dev/null 2>&1; then
  groupadd -o -g "$PGID" metamagic
fi
if ! id metamagic >/dev/null 2>&1; then
  useradd -o -u "$PUID" -g "$PGID" -M -d /config -s /usr/sbin/nologin metamagic
fi

mkdir -p /config
chown -R "$PUID:$PGID" /config

echo "Starting MetaMagic (uid=$PUID gid=$PGID)"

# API on 127.0.0.1:3801 (internal), web UI on :3800 (published)
gosu metamagic sh -c 'cd /app/api && exec node_modules/.bin/tsx src/index.ts' &
API_PID=$!

term() {
  kill "$API_PID" 2>/dev/null || true
  exit 0
}
trap term TERM INT

gosu metamagic node /app/web/apps/web/server.js &
WEB_PID=$!

# If either process dies, stop the container so the orchestrator restarts it
wait -n "$API_PID" "$WEB_PID" 2>/dev/null || wait "$API_PID"
exit 1
