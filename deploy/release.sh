#!/usr/bin/env bash
# 一键发布：同步 App 版本号 → 文档 → 打包 APK → 测试 → 重启服务
#
# 用法：
#   1) 先改版本号（只改这一处）+ 在 package.json 的 changelog 顶部加一条说明
#        node deploy/android/sync-version.js 1.4.2       # 直接指定新版本号
#        或手动编辑 src/version.js
#   2) 然后执行： ./deploy/release.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VER="$(node -e "console.log(require('./src/version.js').APP_VERSION)")"
echo "════════ 发布 $VER ════════"

echo "== 1/5 同步 App 版本号（AndroidManifest / build.sh / package.json）"
node deploy/android/sync-version.js

echo "== 2/5 生成使用手册（md / docx / pdf）"
if [ -f deploy/docs/build-docs.js ]; then
  node deploy/docs/build-docs.js >/dev/null
  cp -f "docs/示例考勤系统使用手册.md" "docs/示例考勤系统使用手册.docx" . 2>/dev/null || true
  if [ -f deploy/docs/build-pdf.sh ]; then bash deploy/docs/build-pdf.sh || echo "（PDF 生成跳过）"; fi
fi

echo "== 3/5 打包 APK（含下载目录发布）"
./deploy/android/build.sh | grep -E "版本同步|APK_READY" || true

echo "== 4/5 运行测试"
node test/run-all.js | tail -3

echo "== 5/5 重启服务"
./deploy/start.sh stop >/dev/null 2>&1 || true
sleep 1
./deploy/start.sh

echo
echo "✅ 发布完成：网页 $VER，App versionName=$VER"
echo "   下载地址：/download/activity-kaoqin.apk"
