#!/usr/bin/env bash
# 备份：数据库 + 版本文件 + 使用手册（保留最近 30 份）
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$ROOT/backups}"
STAMP="$(date '+%Y%m%d-%H%M%S')"
DIR="$DEST/$STAMP"
mkdir -p "$DIR"

# 1) 数据库（先让 SQLite 落盘，保证备份完整）
if command -v node >/dev/null 2>&1; then
  node -e "
    const { DatabaseSync } = require('node:sqlite');
    try { const d = new DatabaseSync(process.argv[1]); d.exec('PRAGMA wal_checkpoint(TRUNCATE)'); d.close(); } catch (e) {}
  " "$ROOT/data/kaoqin.db" 2>/dev/null || true
fi
for f in kaoqin.db kaoqin.db-wal kaoqin.db-shm; do
  [ -f "$ROOT/data/$f" ] && cp -f "$ROOT/data/$f" "$DIR/" 2>/dev/null || true
done

# 2) 版本与名单、手册
for f in package.json; do [ -f "$ROOT/$f" ] && cp -f "$ROOT/$f" "$DIR/"; done
[ -f "$ROOT/src/version.js" ] && cp -f "$ROOT/src/version.js" "$DIR/"
[ -f "$ROOT/src/data/roster.js" ] && cp -f "$ROOT/src/data/roster.js" "$DIR/"
[ -f "$ROOT/docs/示例考勤系统使用手册.docx" ] && cp -f "$ROOT/docs/示例考勤系统使用手册.docx" "$DIR/" 2>/dev/null || true

# 3) 清理旧备份，只留最近 30 份
ls -1dt "$DEST"/*/ 2>/dev/null | tail -n +31 | while read -r old; do rm -rf "$old"; done

echo "备份完成：$DIR"
ls -la "$DIR"
