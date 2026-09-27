/**
 * 应用版本号（网页与安卓 App 共用同一套 1.x 版本号）
 *
 * 版本规则：
 *   - 小改动 / 修复 / 细节调整 —— 递增最后一位：1.3.10 → 1.3.11 → 1.3.12 ...
 *   - 重大功能更新 —— 递增中间一位：1.3.x → 1.4.0
 *   - 架构级 / 不兼容的大改版才动第一位：1.x.x → 2.0.0
 *
 * 只改这里一行即可，构建脚本会自动同步：
 *   - deploy/android/AndroidManifest.xml 的 versionName / versionCode
 *   - deploy/android/build.sh 的构建参数
 *   - package.json 的 version / appVersionCode
 * 记得同时在 package.json 的 changelog 最前面加一条本次更新说明。
 */
const APP_VERSION = '1.4.9';

module.exports = { APP_VERSION };
