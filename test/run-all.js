'use strict';
/**
 * 统一测试入口：npm test   （等价于 node test/run-all.js）
 *
 * 1. 前端静态自检（test/frontend.js，无需浏览器与服务）
 * 2. 端到端测试（test/smoke.js，覆盖登录、权限、填报、统计、导出、页面）
 *
 * 全部在同一进程内完成，不派生任何子进程，也不遗留打开的文件句柄，
 * 因此在禁止管道 spawn 的沙箱里同样可以运行。
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kaoqin-run-'));
const DB = path.join(TMP, 'test.db');
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'testpass0001';

process.env.KAOQIN_DB = DB;
process.env.PORT = String(PORT);
process.env.HOST = '127.0.0.1';
process.env.KAOQIN_DEFAULT_PASSWORD = PASSWORD;
process.env.KAOQIN_TEST_BASE = BASE;

let exitCode = 0;

async function main() {
  console.log('════════ 1/2 前端静态自检 ════════');
  try {
    const fe = require('./frontend.js');
    fe.run();
    if (fe.failures) exitCode |= 1;
  } catch (e) {
    console.error('前端自检异常：', e.message);
    exitCode |= 1;
  }
  console.log('');

  console.log('════════ 2/2 端到端测试 ════════');
  const server = require(path.join(ROOT, 'src', 'server.js')).server;
  await new Promise((resolve) => {
    if (server.listening) return resolve();
    server.listen(Number(process.env.PORT), process.env.HOST, resolve);
  });
  try {
    const smoke = require('./smoke.js');
    const failed = await smoke.run();
    if (failed) exitCode |= 1;
  } catch (e) {
    console.error('端到端测试异常：', e.message);
    exitCode |= 1;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('');
  console.log('════════ 汇总 ════════');
  console.log(exitCode === 0 ? '✅ 全部测试通过' : '❌ 存在未通过的测试');
}

main()
  .catch((e) => {
    console.error(e);
    exitCode = 1;
  })
  .finally(() => {
    try {
      fs.rmSync(TMP, { recursive: true, force: true });
    } catch {}
    process.exit(exitCode);
  });
