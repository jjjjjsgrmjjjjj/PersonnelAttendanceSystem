#!/usr/bin/env bash
# 用 PDFBox 把使用手册 Markdown 转成 PDF（含中文字体）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
JDK="$ROOT/.build/jdk-21.0.12.1+1"
LIB="$ROOT/.build/pdflib"
CP="$LIB/pdfbox-2.0.31.jar:$LIB/fontbox-2.0.31.jar:$LIB/commons-logging-1.2.jar:$ROOT/.build/pdfgen"
FONT="$ROOT/.build/font/NotoSansSC.ttf"
[ -x "$JDK/bin/java" ] || { echo "缺少 JDK，跳过 PDF"; exit 0; }
[ -f "$FONT" ] || { echo "缺少中文字体，跳过 PDF"; exit 0; }

# Java 对中文路径支持不好，用 /tmp 中转
cp -f "$ROOT/docs/示例考勤系统使用手册.md" /tmp/kaoqin-manual.md
( cd /tmp && LANG=C.UTF-8 JAVA_TOOL_OPTIONS="" "$JDK/bin/java" -Dfile.encoding=UTF-8 \
    -cp "$CP" PdfGen /tmp/kaoqin-manual.md /tmp/kaoqin-manual.pdf "$FONT" >/dev/null )
cp -f /tmp/kaoqin-manual.pdf "$ROOT/docs/示例考勤系统使用手册.pdf"
cp -f /tmp/kaoqin-manual.pdf "$ROOT/public/download/activity-kaoqin-manual.pdf"
cp -f "$ROOT/docs/示例考勤系统使用手册.docx" "$ROOT/public/download/activity-kaoqin-manual.docx"
echo "手册已更新（PDF + Word）"
