'use strict';
/**
 * 前端静态自检：node test/frontend.js
 * 不需要浏览器，用静态分析检查：
 *   1. app.js 里用到的所有选择器（id / class）在 index.html 与 styles.css 中都存在
 *   2. 关键函数与接口调用齐全
 *   3. 布局与可用性细节（跨行跨列、对话框按钮类型、移动端 viewport 等）
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public', 'styles.css'), 'utf8');

let failures = 0;
function check(ok, msg, extra = '') {
  console.log(`${ok ? '✔' : '✘'} ${msg}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
}

function run() {
  failures = 0;

  /* app.js 里 $('#xxx') 引用的元素 id 必须在 index.html 中存在 */
  const htmlIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const usedIds = [...new Set([...js.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]))];
  const missingIds = usedIds.filter((id) => !htmlIds.has(id));
  check(
    missingIds.length === 0,
    `JS 引用的 ${usedIds.length} 个元素 id 在 HTML 中都存在`,
    missingIds.length ? '缺失: ' + missingIds.join(', ') : ''
  );

  /* class 选择器必须有来源（HTML、JS 动态创建或 CSS 定义） */
  const usedClasses = [...new Set([...js.matchAll(/\$\$?\('\.([A-Za-z0-9_-]+)/g)].map((m) => m[1]))];
  const htmlClasses = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
  const jsCreatedClasses = new Set([...js.matchAll(/className\s*=\s*'([^']+)'/g)].flatMap((m) => m[1].split(/\s+/)));
  const cssClasses = new Set([...css.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)].map((m) => m[1]));
  const missingClasses = usedClasses.filter(
    (c) => !htmlClasses.has(c) && !jsCreatedClasses.has(c) && !cssClasses.has(c)
  );
  check(
    missingClasses.length === 0,
    `JS 引用的 ${usedClasses.length} 个 class 都有来源`,
    missingClasses.length ? '缺失: ' + missingClasses.join(', ') : ''
  );

  const unusedCss = [...cssClasses].filter((c) => !htmlClasses.has(c) && !js.includes(c));
  if (unusedCss.length) {
    console.log(`ℹ CSS 中未被引用的 class（${unusedCss.length}）：${unusedCss.slice(0, 12).join(', ')}`);
  }

  /* 关键函数齐全 */
  const requiredFns = [
    'boot',
    'onLoggedIn',
    'renderGrid',
    'renderDateSwitch',
    'renderDayStats',
    'renderStats',
    'loadAdmin',
    'applyStatusToCell',
    'patch',
    'flushSave',
    'openCellDialog',
    'renderReminders',
    'moveSelection',
    'bindGlobalEvents',
  ];
  const missingFns = requiredFns.filter((f) => !new RegExp(`function\\s+${f}\\s*\\(`).test(js));
  check(missingFns.length === 0, '前端关键函数齐全', missingFns.length ? '缺失: ' + missingFns.join(', ') : '');

  /* 关键接口齐全 */
  const requiredApis = ['/api/login', '/api/me', '/api/attendance', '/api/stats', '/api/password', '/api/reminders', '/api/export'];
  const missingApis = requiredApis.filter((a) => !js.includes(a));
  check(missingApis.length === 0, '前端调用的接口齐全', missingApis.length ? '缺失: ' + missingApis.join(', ') : '');

  /* 交互：数字键快捷标记与状态循环 */
  const shortcuts = ['1', '2', '3', '4', '0', 'Delete', 'Backspace'].every(
    (k) => js.includes(`'${k}'`) || js.includes(`"${k}"`)
  );
  check(shortcuts, '数字键快捷标记已绑定');
  check(js.includes("'unmarked', 'present'"), '状态循环包含全部五种状态');

  /* 布局：表头跨行跨列 */
  check(/rowSpan\s*=\s*2/.test(js) && /colSpan\s*=\s*slots\.length/.test(js), '表头使用正确的跨行/跨列');

  /* 对话框按钮类型明确，避免误触发表单提交 */
  check(/type="button"/.test(html) && html.includes('type="submit"'), '对话框按钮类型明确');

  /* 移动端与可用性 */
  check(/lang="zh-CN"/.test(html), '页面声明中文语言');
  check(/name="viewport"/.test(html), '声明移动端 viewport（现场用手机填）');
  check(
    /autocomplete="username"/.test(html) && /autocomplete="current-password"/.test(html),
    '登录表单支持密码管理器'
  );

  /* 表格吸顶表头依赖 sticky 定位 */
  check(/position:\s*sticky/.test(css), '样式表包含吸顶定位');

  /* ---------------- Safari / iOS 兼容 ---------------- */
  check(/viewport-fit=cover/.test(html), 'viewport 支持刘海屏安全区（viewport-fit=cover）');
  check(/height:\s*100svh/.test(css) || /height:\s*100dvh/.test(css), '用 svh/dvh 修正 iOS 的 100vh 高度');
  check(/env\(safe-area-inset-/.test(css), '使用安全区留白（env(safe-area-inset-*)）');
  check(/-webkit-appearance:\s*none/.test(css), 'iOS 表单控件有 -webkit-appearance 重置');
  check(/touch-action:\s*manipulation/.test(css), '消除 iOS 点按 300ms 延迟（touch-action）');
  check(/-webkit-tap-highlight-color/.test(css), '关闭 iOS 点按灰色高亮');
  check(/-webkit-user-select/.test(css), '选择行为带 -webkit- 前缀');
  // iOS Safari 上控件字号 <16px 会触发"聚焦自动放大页面"
  check(
    /@media \(hover: none\) and \(pointer: coarse\)/.test(css) && /font-size:\s*16px/.test(css),
    '触屏设备控件字号 ≥16px（避免 iOS 聚焦自动放大）'
  );
  check(
    /apple-mobile-web-app-capable/.test(html) && /black-translucent/.test(html),
    'iOS 添加到主屏后可全屏且状态栏透明'
  );
  check(/format-detection/.test(html), '禁止 iOS 把数字/日期渲染成可点链接');
  check(/syncThemeColor/.test(js), 'iOS 状态栏配色跟随主题（同步 theme-color）');
}

module.exports = { run, get failures() { return failures; } };

if (require.main === module) {
  run();
  console.log('');
  console.log(failures === 0 ? '✅ 前端自检通过' : `❌ 前端自检有 ${failures} 项未通过`);
  process.exit(failures === 0 ? 0 : 1);
}
