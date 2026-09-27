#!/usr/bin/env bash
# 考勤系统守护：每 30 秒检查一次，服务掉了才重新拉起（不会重复启动）
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/data/watchdog.log"
PIDFILE="$ROOT/data/watchdog.pid"
n=0
lastBackup=0

if [ -f "$PIDFILE" ]; then
  old=$(cat "$PIDFILE" 2>/dev/null)
  if [ -n "$old" ] && [ -d "/proc/$old" ]; then
    echo "守护已在运行（PID $old），本次退出"
    exit 0
  fi
fi
echo $$ >"$PIDFILE"
echo "$(date '+%F %T') 守护启动（PID $$）" >>"$LOG"

http_code() {
  curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:3000/healthz 2>/dev/null || echo 000
}

while true; do
  code=$(http_code)
  case "$code" in
    *200*) code=200 ;;
  esac
  if [ "$code" != "200" ]; then
    echo "$(date '+%F %T') 健康检查异常（$code），尝试恢复" >>"$LOG"
    (cd "$ROOT" && bash deploy/start.sh) >>"$LOG" 2>&1
    sleep 5
    code2=$(http_code)
    case "$code2" in
      *200*) code2=200 ;;
    esac
    echo "$(date '+%F %T') 恢复后状态：$code2" >>"$LOG"
    n=0
  else
    n=$((n + 1))
    if [ "$n" -ge 60 ]; then
      echo "$(date '+%F %T') 心跳正常（healthz=200）" >>"$LOG"
      n=0
    fi
  fi
  # 每天自动备份一次（数据库+版本+手册，保留最近 30 份）
  if [ $(( $(date +%s) - lastBackup )) -ge 86400 ]; then
    bash "$ROOT/deploy/backup.sh" >>"$LOG" 2>&1
    lastBackup=$(date +%s)
  fi
  sleep 30
done
