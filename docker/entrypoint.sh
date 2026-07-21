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

API_PID=""
WEB_PID=""

start_api() {
  gosu metamagic sh -c 'cd /app/api && exec node_modules/.bin/tsx src/index.ts' &
  API_PID=$!
}
start_web() {
  gosu metamagic node /app/web/apps/web/server.js &
  WEB_PID=$!
}

term() {
  kill "$API_PID" "$WEB_PID" 2>/dev/null || true
  exit 0
}
trap term TERM INT

start_api
start_web

# Supervisor loop: if a process dies, restart just that one instead of taking
# the whole container down. A crash no longer means the app is unreachable
# until someone restarts the container by hand.
while true; do
  sleep 5
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "API process exited — restarting it"
    start_api
  fi
  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    echo "Web process exited — restarting it"
    start_web
  fi
done
