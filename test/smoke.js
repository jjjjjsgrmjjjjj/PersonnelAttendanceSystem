'use strict';
/**
 * 端到端自测：node test/smoke.js
 * 使用独立的临时数据库与端口，不影响正式数据。
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
// 注意：部分沙箱环境禁止以管道方式 spawn 子进程，因此这里先加载所有被测模块，
// 再尝试启动服务；若 KAOQIN_TEST_BASE 已提供，则直接对接该地址。
const EXTERNAL_BASE = process.env.KAOQIN_TEST_BASE || '';
require(path.join(ROOT, 'src', 'xlsx.js'));
require(path.join(ROOT, 'src', 'attendance.js'));
require(path.join(ROOT, 'src', 'db.js'));
const TMP = EXTERNAL_BASE ? '' : fs.mkdtempSync(path.join(os.tmpdir(), 'kaoqin-test-'));
const DB = process.env.KAOQIN_DB || (TMP ? path.join(TMP, 'test.db') : '');
const PORT = 3400 + Math.floor(Math.random() * 200);
const BASE = EXTERNAL_BASE || `http://127.0.0.1:${PORT}`;
const PASSWORD = 'testpass0001';
const NEW_PASSWORD = 'activity2026';

let child = null;
const results = [];
function step(name, ok, extra = '') {
  results.push({ name, ok, extra });
  console.log(`${ok ? '✔' : '✘'} ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) process.exitCode = 1;
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function colToIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

async function waitForServer(timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(BASE + '/api/ping');
      if (res.ok) return true;
    } catch {}
    await wait(200);
  }
  return false;
}

/** 带 cookie 的请求助手 */
function makeClient() {
  let cookie = '';
  return {
    get cookie() {
      return cookie;
    },
    async req(method, url, body) {
      const headers = {};
      if (cookie) headers.Cookie = cookie;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await fetch(BASE + url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
      });
      const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      for (const c of setCookie) {
        const pair = c.split(';')[0];
        if (pair.startsWith('kaoqin_session=')) cookie = pair;
      }
      const type = res.headers.get('content-type') || '';
      const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
      return { status: res.status, data, headers: res.headers };
    },
    get(url) {
      return this.req('GET', url);
    },
    post(url, body) {
      return this.req('POST', url, body);
    },
    del(url) {
      return this.req('DELETE', url);
    },
  };
}

/** 解析 zip 的中央目录，返回文件名列表与解压后的内容读取器 */
function readZip(buf) {
  const names = [];
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf.readUInt32LE(i) === 0x02014b50) {
      const method = buf.readUInt16LE(i + 10);
      const csize = buf.readUInt32LE(i + 20);
      const nameLen = buf.readUInt16LE(i + 28);
      const extraLen = buf.readUInt16LE(i + 30);
      const commentLen = buf.readUInt16LE(i + 32);
      const lho = buf.readUInt32LE(i + 42);
      const name = buf.slice(i + 46, i + 46 + nameLen).toString('utf8');
      names.push({ name, method, csize, lho });
      i += 45 + nameLen + extraLen + commentLen;
    }
  }
  return {
    names: names.map((n) => n.name),
    read(name) {
      const e = names.find((n) => n.name === name);
      if (!e) return null;
      const lnameLen = buf.readUInt16LE(e.lho + 26);
      const lextraLen = buf.readUInt16LE(e.lho + 28);
      const start = e.lho + 30 + lnameLen + lextraLen;
      const data = buf.slice(start, start + e.csize);
      return e.method === 8 ? zlib.inflateRawSync(data) : data;
    },
  };
}

async function run() {
  if (!EXTERNAL_BASE) {
    child = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
      env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', KAOQIN_DB: DB, KAOQIN_DEFAULT_PASSWORD: PASSWORD },
      stdio: 'inherit',
    });
  }
  let serverLog = '';
  if (child) {
    child.stdout && child.stdout.on('data', (d) => (serverLog += d.toString()));
    child.stderr && child.stderr.on('data', (d) => (serverLog += d.toString()));
  }

  const up = await waitForServer();
  step('服务启动', up, up ? BASE : serverLog.slice(-500) || '（外部服务未响应）');
  if (!up) return;

  const admin = makeClient();
  const leader = makeClient();
  const outsider = makeClient();

  /* 1. 未登录应被拒绝 */
  const anon = await outsider.get('/api/me');
  step('未登录访问被拒绝(401)', anon.status === 401, `status=${anon.status}`);

  /* 2. 错误密码 */
  const bad = await outsider.post('/api/login', { username: 'admin', password: 'wrong-password' });
  step('错误密码被拒绝(401)', bad.status === 401);

  /* 3. 管理员登录 */
  const adminLogin = await admin.post('/api/login', { username: 'admin', password: PASSWORD });
  step('管理员登录成功', adminLogin.status === 200 && adminLogin.data.user.isAdmin === true);

  const me = await admin.get('/api/me');
  const ctx = me.data.context;
  step('名单已载入', ctx.members.length === 45, `members=${ctx.members.length}`);
  step('分组已载入', ctx.groups.length === 9, `groups=${ctx.groups.length}`);
  step('半小时时段数=22', ctx.slots.length === 22, `slots=${ctx.slots.length}`);
  step('时段首尾正确', ctx.slots[0] === '07:00-07:30' && ctx.slots[21] === '17:30-18:00', `${ctx.slots[0]} … ${ctx.slots[21]}`);

  const niu = ctx.members.find((m) => m.name === '成员33');
  step('航拍组新增 成员33（高二九班）', !!niu && niu.cls === '高二九班' && niu.primaryGroupName === '航拍组');
  const hangpai = ctx.groups.find((g) => g.name === '航拍组');
  const hangpaiNames = ctx.members.filter((m) => m.primaryGroupId === hangpai.id).map((m) => m.name);
  step(
    '航拍组共 7 人（原 6 人 + 新增成员33）',
    hangpaiNames.length === 7 && hangpaiNames.includes('成员33') && hangpaiNames.includes('成员23'),
    hangpaiNames.join('、')
  );
  const leader5 = ctx.members.find((m) => m.name === '成员44');
  step('成员44兼任自由组+摄影组', leader5.groupIds.length === 2, leader5.extraGroupNames.join('、'));

  /* 4. 未改密码前不能填报 */
  const blocked = await admin.post('/api/attendance', {
    changes: [{ memberId: ctx.members[0].id, date: ctx.dates[0], slot: ctx.slots[0], status: 'present' }],
  });
  step('初始密码未改前禁止填报(403)', blocked.status === 403, `status=${blocked.status}`);

  /* 5. 修改密码 */
  const pwd = await admin.post('/api/password', { oldPassword: PASSWORD, password: NEW_PASSWORD });
  step('管理员修改密码成功', pwd.status === 200);

  /* 6. 普通组长登录并修改密码 */
  const leaderLogin = await leader.post('/api/login', { username: 'leader7', password: PASSWORD });
  step('径赛组组长登录成功', leaderLogin.status === 200 && !leaderLogin.data.user.isAdmin);
  await leader.post('/api/password', { oldPassword: PASSWORD, password: NEW_PASSWORD });
  const leaderMe = await leader.get('/api/me');
  const lctx = leaderMe.data.context;
  const jingsai = ctx.groups.find((g) => g.name === '径赛组');
  const zhou = ctx.members.find((m) => m.name === '成员13');
  const wu = ctx.members.find((m) => m.name === '成员32'); // 田赛组，不应可编辑
  step('组长仅能编辑本组', lctx.editableMemberIds.includes(zhou.id) && !lctx.editableMemberIds.includes(wu.id));

  /* 7. 组长越权写入应被拒绝 */
  const cross = await leader.post('/api/attendance', {
    changes: [{ memberId: wu.id, date: ctx.dates[0], slot: ctx.slots[0], status: 'absent' }],
  });
  step('组长越权写入被拒绝', cross.data.skipped === 1 && cross.data.errors.length === 1, cross.data.errors.join(';'));

  /* 8. 组长正常填报 */
  const okWrite = await leader.post('/api/attendance', {
    changes: [
      { memberId: zhou.id, date: ctx.dates[0], slot: '07:00-07:30', status: 'present' },
      { memberId: zhou.id, date: ctx.dates[0], slot: '07:30-08:00', status: 'late', note: '迟到 8 分钟' },
    ],
  });
  step('组长填报成功', okWrite.status === 200 && okWrite.data.saved === 2, JSON.stringify(okWrite.data));

  /* 9. 管理员看到组长填报的数据 */
  const adminAtt = await admin.get(`/api/attendance?date=${ctx.dates[0]}`);
  const recs = adminAtt.data.records.filter((r) => r.memberId === zhou.id);
  step('管理员可查看组长填报的数据', recs.length === 2 && recs.some((r) => r.note === '迟到 8 分钟'));

  /* 10. 清除一个格子 */
  await admin.post('/api/attendance', {
    changes: [{ memberId: zhou.id, date: ctx.dates[0], slot: '07:30-08:00', status: 'unmarked', note: '', substitute: '' }],
  });
  const afterClear = await admin.get(`/api/attendance?date=${ctx.dates[0]}`);
  step(
    '清除格子后记录被删除',
    afterClear.data.records.filter((r) => r.memberId === zhou.id).length === 1
  );

  /* 11. 替岗与备注 */
  await admin.post('/api/attendance', {
    changes: [
      { memberId: wu.id, date: ctx.dates[0], slot: '09:00-09:30', status: 'leave', note: '请假半天', substitute: '李四' },
    ],
  });
  const withSub = await admin.get(`/api/attendance?date=${ctx.dates[0]}`);
  const subRec = withSub.data.records.find((r) => r.memberId === wu.id && r.slot === '09:00-09:30');
  step('请假 + 替岗记录正确', !!subRec && subRec.substitute === '李四' && subRec.note === '请假半天');

  /* 12. 统计接口 */
  const stats = await admin.get('/api/stats');
  step('统计接口可用', stats.status === 200 && !!stats.data.summary.byMember[zhou.id]);

  /* 13. 导出 xlsx */
  const xlsxRes = await admin.get('/api/export?format=xlsx');
  const xlsxBuf = Buffer.isBuffer(xlsxRes.data) ? xlsxRes.data : Buffer.alloc(0);
  step('导出 .xlsx 返回二进制', xlsxRes.status === 200 && xlsxBuf.length > 3000, `${xlsxBuf.length} 字节`);
  const zip = readZip(xlsxBuf);
  step(
    'xlsx 中央目录完整',
    zip.names.includes('[Content_Types].xml') &&
      zip.names.includes('xl/workbook.xml') &&
      zip.names.includes('xl/styles.xml') &&
      zip.names.filter((n) => n.startsWith('xl/worksheets/')).length >= 10,
    `${zip.names.length} 个部件`
  );
  const workbook = zip.read('xl/workbook.xml').toString('utf8');
  for (const sheetName of ['考勤总览', '各时段统计', '航拍组', '径赛组', '说明']) {
    assert(workbook.includes(sheetName), `缺少工作表 ${sheetName}`);
  }
  step('工作簿包含总览/统计/各组/说明工作表', true, workbook.match(/name="([^"]+)"/g).join(' '));
  const hangpaiSheetIdx = [...workbook.matchAll(/<sheet name="([^"]+)"[^>]*r:id="rId(\d+)"/g)].find((m) => m[1] === '航拍组');
  step('航拍组工作表存在', !!hangpaiSheetIdx);
  // 校验每个 worksheet xml 是良构的
  let xmlOk = true;
  let cellCount = 0;
  for (const n of zip.names.filter((x) => x.startsWith('xl/worksheets/'))) {
    const xml = zip.read(n).toString('utf8');
    const open = (xml.match(/<c[ >]/g) || []).length;
    const close = (xml.match(/<\/c>|<c [^>]*\/>/g) || []).length;
    cellCount += open;
    if (!xml.startsWith('<?xml') || !xml.includes('</worksheet>')) xmlOk = false;
  }
  step('所有工作表 XML 结构正常', xmlOk, `共 ${cellCount} 个单元格`);
  // 抽查一个数据单元格（出勤标记应写入）
  const jingsaiIdx = [...workbook.matchAll(/<sheet name="([^"]+)"[^>]*r:id="rId(\d+)"/g)].find((m) => m[1] === '径赛组');
  const jingsaiXml = zip.read(`xl/worksheets/sheet${jingsaiIdx[2]}.xml`).toString('utf8');
  step('径赛组工作表含考勤标记「出」', jingsaiXml.includes('>出<'));
  step('径赛组工作表含姓名「成员13」', jingsaiXml.includes('成员13'));
  // 列对齐自检：同一工作表内，每行的「占位宽度」= 单元格数 + 横向合并补足列数，必须一致，
  // 只有整行留空的间隔行可以例外。这是防止列错位这类静默错误的关键检查。
  const widthProblems = [];
  for (const n of zip.names.filter((x) => x.startsWith('xl/worksheets/'))) {
    const xml = zip.read(n).toString('utf8');
    const extraByRow = new Map();
    for (const m of xml.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g)) {
      const w = colToIndex(m[3]) - colToIndex(m[1]);
      if (w > 0) extraByRow.set(m[2], (extraByRow.get(m[2]) || 0) + w);
    }
    const widths = [];
    let thinRows = 0;
    for (const r of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = (r[2].match(/<c r="[A-Z]+\d+"/g) || []).length;
      if (cells <= 1) {
        thinRows++;
        continue;
      }
      widths.push(cells + (extraByRow.get(r[1]) || 0));
    }
    const set = new Set(widths);
    if (set.size > 1) widthProblems.push(`${n}: 宽度不一致 ${[...set].join('/')}`);
  }
  step('各工作表行宽一致（无列错位）', widthProblems.length === 0, widthProblems.join(' | '));
  // 备注与替岗必须写进导出
  const hangpaiXml = zip.read(`xl/worksheets/sheet${hangpaiSheetIdx[2]}.xml`).toString('utf8');
  step('航拍组工作表写出班级与姓名', hangpaiXml.includes('高二九班') && hangpaiXml.includes('成员33'));

  /* 14. 导出 xls（Excel 2003 XML） */
  const xlsRes = await admin.get('/api/export?format=xls');
  const xlsText = Buffer.isBuffer(xlsRes.data)
    ? xlsRes.data.toString('utf8')
    : JSON.stringify(xlsRes.data);
  step(
    '导出 .xls 为 Excel 2003 XML',
    xlsRes.status === 200 && xlsText.startsWith('<?xml') && xlsText.includes('urn:schemas-microsoft-com:office:spreadsheet') && xlsText.includes('</Workbook>'),
    `${xlsText.length} 字节`
  );
  step('xls 含航拍组与成员33', xlsText.includes('ss:Name="航拍组"') && xlsText.includes('成员33'));
  // 导出必须包含表格名称、分组、每人时段格与备注列
  step(
    'xls 表头含姓名/班级/时段/备注列',
    xlsText.includes('>姓名<') && xlsText.includes('>班级<') && xlsText.includes('>备注<') && xlsText.includes('>替岗记录<') && xlsText.includes('07:00-07:30')
  );
  step('xls 含逐时段备注与替岗', xlsText.includes('请假半天') && xlsText.includes('由李四替岗'));

  /* 15. 备注/待办 */
  await admin.post('/api/reminders', { date: ctx.dates[0], text: '15:30 无人机换电池' });
  const rem = await admin.get(`/api/reminders?date=${ctx.dates[0]}`);
  step('现场备注可新增', rem.data.reminders.length === 1 && rem.data.reminders[0].text === '15:30 无人机换电池');

  /* 16. 管理员设置 */
  const cfg = await admin.post('/api/config', {
    dates: [ctx.dates[0]],
    slots: ctx.slots,
    title: ctx.title,
  });
  step('管理员可修改活动日期', cfg.status === 200 && cfg.data.config.dates.length === 1);
  const leaderCfg = await leader.post('/api/config', { dates: ['2026-10-01'] });
  step('组长无权修改设置(403)', leaderCfg.status === 403, `status=${leaderCfg.status}`);

  /* 17. 组长登录后不应看到其它组可编辑 */
  const users = await admin.get('/api/admin/users');
  step('账号列表可读', users.status === 200 && users.data.users.length === 9, `${users.data.users.length} 个账号`);
  const reset = await admin.post('/api/admin/users/reset', { id: users.data.users.find((u) => u.username === 'leader7').id });
  step('重置密码可用', reset.status === 200 && reset.data.password === PASSWORD);
  const relogin = await leader.post('/api/login', { username: 'leader7', password: PASSWORD });
  step('重置后可用初始密码登录', relogin.status === 200 && relogin.data.user.mustChange === true);

  /* 18. 会话失效 */
  await admin.post('/api/logout');
  const afterLogout = await admin.get('/api/me');
  step('退出后会话失效(401)', afterLogout.status === 401);

  /* 19. 页面可访问 */
  const page = await fetch(BASE + '/');
  const html = await page.text();
  step('首页可访问且标题已注入', page.status === 200 && html.includes('第01届田径运动会人员考勤表') && /app.[0-9.]+\.js/.test(html) || html.includes('/app.js'));
  const js = await fetch(BASE + '/app.js?v=1');
  step('前端脚本可访问', js.status === 200 && (js.headers.get('content-type') || '').includes('javascript'));
  const css = await fetch(BASE + '/styles.css?v=1');
  step('样式表可访问', css.status === 200 && (css.headers.get('content-type') || '').includes('text/css'));
  const hz = await fetch(BASE + '/healthz');
  step('健康检查可用', hz.status === 200 && (await hz.text()) === 'ok');
  const traversal = await fetch(BASE + '/../src/db.js');
  step('目录穿越被阻止', traversal.status === 404 || traversal.status === 403, `status=${traversal.status}`);
}

/** 返回失败项数量；不在此处结束进程，便于被 run-all.js 复用 */
async function smokeMain() {
  try {
    await run();
  } catch (e) {
    console.error('测试异常：', e);
    process.exitCode = 1;
  } finally {
    if (child) child.kill();
    await wait(300);
    if (TMP) {
      try {
        fs.rmSync(TMP, { recursive: true, force: true });
      } catch {}
    }
    const failed = results.filter((r) => !r.ok);
    console.log('');
    console.log(`共 ${results.length} 项检查，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`);
    if (failed.length) {
      console.log('失败项：');
      failed.forEach((f) => console.log('  - ' + f.name + (f.extra ? ' :: ' + f.extra : '')));
    }
  }
  return results.filter((r) => !r.ok).length;
}

module.exports = {
  run: smokeMain,
  get failures() {
    return results.filter((r) => !r.ok).length;
  },
};

if (require.main === module) {
  smokeMain().then((failed) => {
    process.exit(failed ? 1 : 0);
  });
}
