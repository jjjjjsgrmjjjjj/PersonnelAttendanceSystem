#!/usr/bin/env bash
# 示例考勤 Android App 构建脚本（不使用 Gradle，直接用 SDK 的 aapt2 / d8 / apksigner）
# 用法：./deploy/android/build.sh [服务器地址]
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$APP_DIR/../.." && pwd)"
BUILD_ROOT="$ROOT/.build"
JDK="$BUILD_ROOT/jdk-21.0.12.1+1"
SDK="$BUILD_ROOT/android-sdk"
BT="$SDK/build-tools/34.0.0"
BT35="$SDK/build-tools/35.0.0"
AJAR="$SDK/platforms/android-35/android.jar"
OUT="$APP_DIR/build"
DIST="$ROOT/dist"
KS="$APP_DIR/keystore/activity-kaoqin.jks"   # 固定签名，重打包也能覆盖安装
SERVER_URL="${1:-https://example.com}"

export JAVA_HOME="$JDK"
export PATH="$JDK/bin:$PATH"

# 版本号统一从 src/version.js 同步（versionName 与 versionCode 一次算好）
node "$APP_DIR/sync-version.js"

for f in "$BT/aapt2" "$BT35/d8" "$BT/zipalign" "$BT/apksigner" "$AJAR"; do
  [ -e "$f" ] || { echo "缺少构建工具：$f（先跑 .build/setup-sdk.sh）"; exit 1; }
done

echo "== 目标地址：$SERVER_URL"
rm -rf "$OUT" && mkdir -p "$OUT/compiled" "$OUT/gen" "$OUT/classes" "$OUT/dex" "$DIST"

echo "== 1/7 编译资源"
"$BT/aapt2" compile --dir "$APP_DIR/res" -o "$OUT/compiled/res.zip"

echo "== 2/7 生成 R.java 并预链接资源"
"$BT/aapt2" link \
  -o "$OUT/base.apk" \
  -I "$AJAR" \
  --manifest "$APP_DIR/AndroidManifest.xml" \
  --java "$OUT/gen" \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  --version-code 10409 --version-name 1.4.9 \
  "$OUT/compiled/res.zip"

echo "== 3/7 编译 Java"
find "$APP_DIR/src" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
javac -nowarn -encoding UTF-8 -g:none --release 8 \
  -classpath "$AJAR" \
  -d "$OUT/classes" \
  @"$OUT/sources.txt"

echo "== 4/7 转成 dex"
"$BT35/d8" --release --min-api 24 --lib "$AJAR" \
  --output "$OUT/dex" \
  $(find "$OUT/classes" -name '*.class')

echo "== 5/7 打包 APK"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT/dex" && jar uf "$OUT/unsigned.apk" classes.dex)

echo "== 6/7 对齐"
"$BT/zipalign" -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

echo "== 7/7 签名"
if [ ! -f "$KS" ]; then
  keytool -genkeypair -keystore "$KS" -storepass android -keypass android \
    -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=activity Kaoqin, OU=Dev, O=activity, L=Lanzhou, C=CN" >/dev/null 2>&1
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android \
  --ks-key-alias androiddebugkey --v1-signing-enabled true --v2-signing-enabled true \
  --out "$DIST/activity-kaoqin.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify --print-certs "$DIST/activity-kaoqin.apk" | head -3

cp "$DIST/activity-kaoqin.apk" "$DIST/示例考勤.apk" 2>/dev/null || true
rm -f "$DIST/activity-kaoqin.apk.idsig" "$DIST/示例考勤.apk.idsig"
mkdir -p "$ROOT/public/download"
VER="$(grep -oE 'android:versionName="[^"]+"' "$APP_DIR/AndroidManifest.xml" | head -1 | sed 's/.*="\(.*\)"/\1/')"
mkdir -p "$ROOT/public/download"
cp -f "$DIST/activity-kaoqin.apk" "$ROOT/public/download/activity-kaoqin.apk"
cp -f "$DIST/activity-kaoqin.apk" "$ROOT/public/download/activity-kaoqin-$VER.apk"
echo "下载地址：/download/activity-kaoqin.apk"
ls -la "$DIST/"
echo "APK_READY $DIST/示例考勤.apk"
