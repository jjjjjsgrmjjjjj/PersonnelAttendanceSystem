#!/usr/bin/env bash
# 示例考勤系统 启动/停止脚本（无 pkill 环境也能用）
#   ./deploy/start.sh          启动（默认 0.0.0.0:3000）
#   PORT=8080 ./deploy/start.sh
#   ./deploy/start.sh stop     停止
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="$ROOT/data/kaoqin.pid"
LOGFILE="$ROOT/data/kaoqin.log"
export PORT="${PORT:-3000}"
export HOST="${HOST:-0.0.0.0}"

server_pids() {
  for p in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
    [ -r "/proc/$p/cmdline" ] || continue
    c=$(tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null) || continue
    case "$c" in
      "node src/server.js"*) echo "$p" ;;
    esac
  done
}

healthy() {
  [ "$(curl -s -o /dev/null -m 4 -w '%{http_code}' "http://127.0.0.1:$PORT/healthz" 2>/dev/null)" = "200" ]
}

case "${1:-start}" in
stop)
  for p in $(server_pids); do kill "$p" 2>/dev/null || true; done
  rm -f "$PIDFILE"
  echo "已停止"
  ;;
*)
  if healthy; then
    echo "服务已在运行 → http://$HOST:$PORT"
    exit 0
  fi
  for p in $(server_pids); do kill "$p" 2>/dev/null || true; done
  sleep 1
  cd "$ROOT"
  nohup node src/server.js >>"$LOGFILE" 2>&1 &
  echo $! >"$PIDFILE"
  sleep 1
  echo "已启动 PID $(cat "$PIDFILE") → http://$HOST:$PORT"
  ;;
esac
