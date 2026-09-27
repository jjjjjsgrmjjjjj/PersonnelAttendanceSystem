#!/usr/bin/env node
/**
 * 版本号单一来源：src/version.js 的 APP_VERSION（形如 1.3.7）
 * 自动同步到：
 *   - deploy/android/AndroidManifest.xml 的 versionName / versionCode
 *   - deploy/android/build.sh 的 --version-code / --version-name
 *   - package.json 的 version / appVersionCode
 * 说明：Android 要求 versionCode 为整数，这里按 主*10000+次*100+修订 计算（1.3.7 → 10307）。
 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');

let { APP_VERSION } = require(path.join(root, 'src', 'version.js'));

// 可选：命令行传入新版本号，先写回 src/version.js（版本号唯一来源）
const cliVer = process.argv[2];
if (cliVer) {
  if (!/^\d+\.\d+\.\d+$/.test(cliVer)) {
    console.error('版本号格式应为 1.x.x，例如 1.4.2');
    process.exit(1);
  }
  const vf = path.join(root, 'src', 'version.js');
  const src = fs.readFileSync(vf, 'utf8').replace(/APP_VERSION = '[^']*'/, `APP_VERSION = '${cliVer}'`);
  fs.writeFileSync(vf, src);
  APP_VERSION = cliVer;
  console.log('src/version.js 已更新为 ' + cliVer);
}
const m = APP_VERSION.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!m) throw new Error('版本号格式必须是 1.x.x 形式：' + APP_VERSION);
const [, major, minor, patch] = m;
const code = Number(major) * 10000 + Number(minor) * 100 + Number(patch);

// 1) AndroidManifest.xml
const mf = path.join(__dirname, 'AndroidManifest.xml');
let x = fs.readFileSync(mf, 'utf8');
x = x.replace(/android:versionCode="[^"]*"/, `android:versionCode="${code}"`);
x = x.replace(/android:versionName="[^"]*"/, `android:versionName="${APP_VERSION}"`);
fs.writeFileSync(mf, x);

// 2) build.sh
const bs = path.join(__dirname, 'build.sh');
let b = fs.readFileSync(bs, 'utf8');
b = b.replace(/--version-code \d+ --version-name [0-9.]+/, `--version-code ${code} --version-name ${APP_VERSION}`);
fs.writeFileSync(bs, b);

// 3) package.json（App 更新检查用）
const pf = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pf, 'utf8'));
pkg.version = APP_VERSION;
pkg.appVersionCode = code;
fs.writeFileSync(pf, JSON.stringify(pkg, null, 2) + '\n');

console.log(`版本同步：versionName=${APP_VERSION}  versionCode=${code}`);
