'use strict';
/**
 * 考勤系统 HTTP 服务
 * 运行：node src/server.js   （环境变量 PORT / HOST / KAOQIN_DEFAULT_PASSWORD）
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const { APP_VERSION } = require('./version');
const db = require('./db');
const permissions = require('./permissions');
const { canEditMember, canViewMember, isAdmin } = permissions;
const attendance = require('./attendance');
const xlsx = require('./xlsx');
const { MIME, sendJson, sendText, sendBuffer, readJson, parseCookies, setCookie, parseUrl } = require('./http-util');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
/* ---------------- 导出文件：先存盘再下载，10 分钟后自动清理 ---------------- */
const EXPORT_DIR = path.join(os.tmpdir(), 'kaoqin-exports');
const EXPORT_TTL_MS = 10 * 60 * 1000;
const exportTokens = new Map();   // 一次性下载令牌（App 跳浏览器下载用）

function pruneExports() {
  try {
    for (const f of fs.readdirSync(EXPORT_DIR)) {
      const p = path.join(EXPORT_DIR, f);
      try {
        if (Date.now() - fs.statSync(p).mtimeMs > EXPORT_TTL_MS) fs.unlinkSync(p);
      } catch {}
    }
  } catch {}
}

/** 文件名时间：年月日-时分秒 */
function exportStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

/** 压缩版本号列表：3,4,5 变 3-5；1,3 变 1+3 */
function compressRange(list) {
  const nums = list.map((v) => String(v)).sort();
  const isNum = nums.length > 1 && nums.every((v) => /^[0-9]+$/.test(v));
  if (!isNum) return nums.join('+');
  const seq = nums.map(Number);
  let ok = true;
  for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1] + 1) ok = false;
  return ok ? seq[0] + '-' + seq[seq.length - 1] : nums.join('+');
}

/** 范围短写：全选就是"全部"，否则列出范围 */
function scopeLabel(list, all, fmt) {
  if (!list.length || list.length === all.length) return '全部';
  const vals = fmt ? list.map(fmt) : list.slice();
  return compressRange(vals);
}

/** 文件名安全化：去掉文件系统不接受的字符并限长 */
function safeFileName(text, max) {
  const cleaned = String(text).replace(/[\\\/:*?"<>|\r\n\t]/g, '').trim();
  const limit = max || 120;
  return cleaned.length > limit ? cleaned.slice(0, limit) + '等' : cleaned;
}

const COOKIE = 'kaoqin_session';
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const STATUS_LABELS = {
  present: '出勤',
  late: '迟到',
  absent: '缺勤',
  leave: '请假',
  unmarked: '未记录',
};

/* ---------------- 启动 ---------------- */
db.open();
const seeded = db.seed();
if (seeded) {
  console.log('✔ 首次启动：已写入名单、分组与账号');
  console.log(`  默认密码：${db.DEFAULT_PASSWORD}（首次登录后必须修改）`);
} else {
  // 数据库已存在：提醒名单是否与代码里的 roster.js 一致
  const roster = require('./data/roster');
  const memberCount = db.getMembers().length;
  const groupCount = db.getGroups().length;
  if (memberCount !== roster.MEMBERS.length || groupCount !== roster.GROUPS.length) {
    console.warn(
      `⚠ 数据库中的名单（${memberCount} 人 / ${groupCount} 组）与源代码里的名单` +
        `（${roster.MEMBERS.length} 人 / ${roster.GROUPS.length} 组）不一致。`
    );
    console.warn('  如需按最新名单重建（不影响已填考勤）：先停止服务，再执行 node src/db.js --force');
  }
}
db.purgeSessions();

try {
  fs.rmSync(EXPORT_DIR, { recursive: true, force: true });   // 重启即清理上次遗留的导出文件
} catch {}

let indexTemplate = null;

/** 静态资源版本号：网页与安卓 App 共用同一套 1.x 版本号（见 src/version.js） */
function assetsVersion() {
  return APP_VERSION;
}

function getIndexHtml(user, req) {
  if (indexTemplate == null) {
    indexTemplate = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  }
  const cfg = db.getConfig();
  return indexTemplate
    .replace(/__TITLE__/g, escapeHtml(cfg.title))
    .replace(/__ORG__/g, escapeHtml(cfg.org))
    .replace(/__V__/g, APP_VERSION)
    .replace(/__SUBTITLE__/g, escapeHtml(cfg.subtitle))
    .replace(/__ADMIN_HIDDEN__/g, isAdmin(user) ? '' : ' hidden')
    .replace('</head>', (() => {
      const themeJs = "(function(){try{"
        + "var K='kaoqin.theme';"
        + "function sd(){return !!(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);}"
        + "function ap(m){var d=m==='dark'||(m==='auto'&&sd());"
        + "document.documentElement.dataset.theme=d?'dark':'light';"
        + "document.documentElement.dataset.themeMode=m;"
        + "var ic=m==='auto'?'\\u25d0':(m==='dark'?'\\u263e':'\\u2600');"
        + "var tx=m==='auto'?'\\u8ddf\\u968f\\u7cfb\\u7edf':(m==='dark'?'\\u6df1\\u8272':'\\u6d45\\u8272');"
        + "try{var t=document.getElementById('theme-btn');if(t)t.textContent=ic;}catch(e){}}"
        + "window.__applyTheme=ap;"
        + "window.__cycleTheme=function(){var cur=localStorage.getItem(K)||'auto';"
        + "var nxt=cur==='auto'?'dark':(cur==='dark'?'light':'auto');"
        + "try{localStorage.setItem(K,nxt);}catch(e){}ap(nxt);};"
        + "ap(localStorage.getItem(K)||'auto');"
        + "document.addEventListener('click',function(ev){"
        + "var t=ev.target;if(!t||!t.closest)return;"
        + "if(t.closest('#theme-btn')){ev.preventDefault();window.__cycleTheme();}"
        + "});}catch(e){}})();";
      const appJs = 'window.__APP_VERSION__="' + APP_VERSION + '";' + (isAppReq(req) ? 'window.__APP__=1;' : '');
      return '<script>' + appJs + themeJs + '</script></head>';
    })());
}
/** 请求是否来自安卓 App（App 的 WebView UA 带 KaoqinApp） */
function isAppReq(req) {
  return /KaoqinApp/i.test((req && req.headers && req.headers['user-agent']) || '');
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------------- 认证 ---------------- */
function currentUser(req) {
  const cookies = parseCookies(req);
  const sess = db.getSession(cookies[COOKIE]);
  if (!sess) return null;
  return { ...sess.user, groups: db.getUserGroups(sess.user.id) };
}

function userPublic(user) {
  return {
    id: user.id,
    username: user.username,
    display: user.display,
    isAdmin: !!user.is_admin,
    canViewAll: !!user.can_view_all,
    canExport: permissions.canExport(user),
    canEdit: !!user.is_admin || (user.groups || []).length > 0,
    mustChange: !!user.must_change,
    groups: (user.groups || []).map((g) => ({ id: g.id, name: g.name })),
  };
}

/* ---------------- 业务数据 ---------------- */
function contextPayload(user) {
  const cfg = db.getConfig();
  const groups = db.getGroups();
  const members = db.getMembers();
  const owned = new Set(user.groups.map((g) => g.id));
  return {
    title: cfg.title,
    org: cfg.org,
    subtitle: cfg.subtitle,
    configNote: cfg.note,
    dates: cfg.dates,
    slots: cfg.slots,
    groups,
    members,
    editableGroupIds: user.is_admin ? groups.map((g) => g.id) : [...owned],
    editableMemberIds: members.filter((m) => canEditMember(user, m)).map((m) => m.id),
    canViewAll: permissions.canViewAll(user),
    canExport: permissions.canExport(user),
    canEdit: !!user.is_admin || owned.size > 0,
    statusLabels: STATUS_LABELS,
    defaultPasswordUsed: false,
  };
}

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const url = parseUrl(req);
  const p = url.pathname;

  try {
    // 供监控/负载均衡使用的健康检查（无需鉴权）
    if (p === '/healthz') {
      return sendText(res, 200, 'ok');
    }
    if (p.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, p, currentUser(req));
  } catch (e) {
    const status = e.statusCode || 500;
    if (status >= 500) console.error('[error]', req.method, p, e);
    if (!res.headersSent) sendJson(res, status, { error: e.message || '服务器内部错误' });
    else res.end();
  }
});

async function handleApi(req, res, url) {
  const p = url.pathname.replace(/\/+$/, '') || '/api';
  const method = req.method.toUpperCase();
  const route = `${method} ${p}`;

  /* --- 登录相关（无需鉴权） --- */
  if (route === 'POST /api/login') {
    const body = await readJson(req);
    const user = db.findUserByUsername(body.username);
    if (!user || !user.active || !db.verifyPassword(body.password, user.password_hash)) {
      db.audit(null, 'login_fail', `username=${String(body.username || '').slice(0, 40)}`);
      return sendJson(res, 401, { error: '账号或密码不正确' });
    }
    const token = db.createSession(user.id);
    setCookie(res, COOKIE, token, { maxAge: 60 * 60 * 24 * 180 });
    db.audit(user, 'login', '');
    const full = { ...user, groups: db.getUserGroups(user.id) };
    return sendJson(res, 200, { ok: true, user: userPublic(full) });
  }

  if (route === 'GET /api/ping') {
    return sendJson(res, 200, { ok: true, time: new Date().toISOString() });
  }

  if (route === 'GET /api/version') {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return sendJson(res, 200, {
      version: APP_VERSION,
      changelog: Array.isArray(pkg.changelog) ? pkg.changelog.join('\n') : '',
      apk: '/download/activity-kaoqin.apk',
      guide: { pdf: '/download/activity-kaoqin-manual.pdf', docx: '/download/activity-kaoqin-manual.docx' },
    });
  }

  // 一次性链接取文件（无需登录，5~10 分钟内有效，取到即失效）
  if (route.startsWith('GET /api/export/dl/')) {
    const token = route.slice('GET /api/export/dl/'.length);
    const item = exportTokens.get(token);
    if (!item || item.exp < Date.now()) return sendText(res, 404, '链接已过期，请重新导出');
    // 不再用一次即失效：同一链接在有效期内可重复下载（下载器/浏览器常会请求多次）
    return sendBuffer(res, 200, item.buf, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="kaoqin.xlsx"; filename*=UTF-8%27%27' + encodeURIComponent(item.name),
    });
  }

  /* --- 以下均需登录 --- */
  const user = currentUser(req);
  if (!user) return sendJson(res, 401, { error: '未登录或登录已过期' });

  const requireAdmin = () => {
    if (!isAdmin(user)) throw Object.assign(new Error('仅管理员可执行此操作'), { statusCode: 403 });
  };
  // 成员11账号（成员22会）也能导出，所以导出的门槛与"管理"分开
  const requireExport = () => {
    if (!permissions.canExport(user)) throw Object.assign(new Error('没有导出权限'), { statusCode: 403 });
  };
  const requireFresh = () => {
    if (user.must_change) throw Object.assign(new Error('请先修改初始密码后再操作'), { statusCode: 403 });
  };

  if (route === 'POST /api/logout') {
    db.destroySession(parseCookies(req)[COOKIE]);
    setCookie(res, COOKIE, '', { maxAge: 0 });
    return sendJson(res, 200, { ok: true });
  }

  if (route === 'GET /api/me') {
    return sendJson(res, 200, { user: userPublic(user), context: contextPayload(user) });
  }

  if (route === 'POST /api/password') {
    const body = await readJson(req);
    const pwd = String(body.password || '');
    if (pwd.length < 6) return sendJson(res, 400, { error: '新密码至少 6 位' });
    if (!db.verifyPassword(body.oldPassword, db.getUserById(user.id).password_hash)) {
      return sendJson(res, 400, { error: '原密码不正确' });
    }
    db.setPassword(user.id, pwd);
    db.audit(user, 'change_password', '');
    return sendJson(res, 200, { ok: true });
  }

  if (route === 'GET /api/roster') {
    return sendJson(res, 200, contextPayload(user));
  }

  if (route === 'GET /api/attendance') {
    const date = url.searchParams.get('date') || '';
    const cfg = db.getConfig();
    const dateList = /^\d{4}-\d{2}-\d{2}$/.test(date) ? [date] : cfg.dates;
    const map = attendance.loadRange(dateList[0], dateList[dateList.length - 1]);
    const records = [];
    const members = db.getMembers();
    const byId = new Map(members.map((m) => [m.id, m]));
    for (const rec of map.values()) {
      const m = byId.get(rec.memberId);
      if (!m) continue;
      if (!canViewMember(user, m)) continue;   // 成员11账号可查看全部
      records.push({
        memberId: rec.memberId,
        date: rec.date,
        slot: rec.slot,
        status: rec.status,
        note: rec.note,
        substitute: rec.substitute,
        updatedAt: rec.updatedAt,
      });
    }
    return sendJson(res, 200, { dates: dateList, records });
  }

  if (route === 'POST /api/attendance') {
    requireFresh();
    const body = await readJson(req);
    const changes = Array.isArray(body.changes) ? body.changes : [];
    if (changes.length > 2000) return sendJson(res, 400, { error: '单次提交的记录过多，请分批保存' });
    const members = db.getMembers();
    const byId = new Map(members.map((m) => [m.id, m]));
    const result = attendance.applyChanges(user, changes, byId);
    if (result.saved) {
      db.audit(user, 'save_attendance', `${result.saved} 条`);
    }
    return sendJson(res, 200, { ok: true, ...result });
  }

  if (route === 'GET /api/stats') {
    const cfg = db.getConfig();
    const members = db.getMembers().filter((m) => canViewMember(user, m));
    const map = attendance.loadRange(cfg.dates[0] || '0000-01-01', cfg.dates[cfg.dates.length - 1] || '9999-12-31');
    const summary = attendance.summarize(members, map, cfg.dates, cfg.slots, STATUS_LABELS);
    return sendJson(res, 200, { dates: cfg.dates, slots: cfg.slots, summary });
  }

  if (route === 'GET /api/reminders') {
    const date = url.searchParams.get('date') || (db.getConfig().dates[0] || '');
    const rows = db.open().prepare('SELECT * FROM reminders WHERE date=? ORDER BY id').all(date);
    return sendJson(res, 200, { date, reminders: rows });
  }

  if (route === 'POST /api/reminders') {
    requireFresh();
    const body = await readJson(req);
    const date = String(body.date || '');
    const text = String(body.text || '').trim().slice(0, 300);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !text) return sendJson(res, 400, { error: '参数不完整' });
    const info = db
      .open()
      .prepare('INSERT INTO reminders(date,text,updated_by) VALUES(?,?,?)')
      .run(date, text, user.id);
    return sendJson(res, 200, { ok: true, id: Number(info.lastInsertRowid) });
  }

  if (route === 'DELETE /api/reminders') {
    requireFresh();
    const id = Number(url.searchParams.get('id') || 0);
    db.open().prepare('DELETE FROM reminders WHERE id=?').run(id);
    return sendJson(res, 200, { ok: true });
  }

  if (route === 'GET /api/export') {
    requireExport();  // 管理员与成员11账号（成员22会）均可导出
    const cfg = db.getConfig();
    const groups = db.getGroups();
    const allMembers = db.getMembers();
    const format = (url.searchParams.get('format') || 'xlsx').toLowerCase();

    // 导出范围：日期 / 时段 / 组别，缺省为全部
    const listParam = (key) => (url.searchParams.get(key) || '')
      .split(',').map((v) => v.trim()).filter(Boolean);
    const pick = (values, all) => {
      const set = new Set(values);
      const list = all.filter((v) => set.has(v));
      return list.length ? list : all.slice();
    };
    const dates = pick(listParam('dates'), cfg.dates);
    const slots = pick(listParam('slots'), cfg.slots);
    const wanted = new Set(listParam('groups').map((n) => Number(n)).filter((n) => n > 0));
    const chosenGroups = wanted.size ? groups.filter((g) => wanted.has(g.id)) : groups.slice();
    const chosenIds = new Set(chosenGroups.map((g) => g.id));
    // 组别筛选时只保留这些组的人（一人兼多组也不会重复）
    const members = chosenGroups.length === groups.length
      ? allMembers
      : allMembers.filter((m) => (m.groupIds || []).some((g) => chosenIds.has(g)));

    const attMap = attendance.loadRange(dates[0], dates[dates.length - 1]);
    const ctx = {
      config: { ...cfg, dates }, groups: chosenGroups, allGroups: groups, members,
      dates, slots, attMap,
    };
    const buf = format === 'xls' ? xlsx.exportXmlXls(ctx) : xlsx.exportXlsx(ctx);
    const ext = format === 'xls' ? 'xls' : 'xlsx';
    const mime = format === 'xls'
      ? 'application/vnd.ms-excel'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    // 文件名：示例考勤表-导出时间年月日-时分秒-账号
    // 文件名：选中日期-选中时段-组别-导出日期时间-导出用户名
    const datePart = scopeLabel(dates, cfg.dates, (d) => d.slice(5).replace('-', ''));
    const slotPart = scopeLabel(slots, cfg.slots, (v) => v.split('-')[0].replace(':', ''));
    const groupPart = scopeLabel(chosenGroups, groups, (g) => g.name);
    const base = safeFileName('示例考勤表-' + datePart + '-' + slotPart + '-' + groupPart + '-' + exportStamp() + '-' + user.username);
    pruneExports();
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    const file = path.join(EXPORT_DIR, Date.now() + '-' + ext + '-' + user.id + '-' + base + '.' + ext);
    fs.writeFileSync(file, buf);
    // 下载完成后 10 分钟自动删除（进程重启由启动时清理兜底）
    const timer = setTimeout(() => {
      try { fs.unlinkSync(file); } catch {}
    }, EXPORT_TTL_MS);
    if (timer.unref) timer.unref();
    db.audit(user, 'export', ext + ' ' + base + ' 范围:' + dates.length + '天/' + slots.length + '段/' + chosenGroups.length + '组');
    return sendBuffer(res, 200, buf, {
      'Content-Type': mime,
      'Content-Disposition': 'attachment; filename="kaoqin.' + ext + '"; filename*=UTF-8%27%27' + encodeURIComponent(base) + '.' + ext,
      'X-Export-Name-B64': Buffer.from(base + '.' + ext, 'utf8').toString('base64'),
    });
  }

  // App 用：给它一个一次性的浏览器下载链接（浏览器没有登录 Cookie）
  if (route === 'GET /api/export/link') {
    requireExport();
    // 参数既可以直传，也可以放在 u= 里（App 传的就是它也使用的导出地址）
    const keys = ['format', 'dates', 'slots', 'groups'];
    let qs = '';
    const rawU = url.searchParams.get('u') || '';
    if (rawU) {
      const qIdx = rawU.indexOf('?');
      if (qIdx >= 0) qs = rawU.slice(qIdx + 1);
    } else {
      const parts = [];
      for (const k of keys) {
        const v = url.searchParams.get(k);
        if (v != null && v !== '') parts.push(k + '=' + encodeURIComponent(v));
      }
      qs = parts.join('&');
    }
    if (!qs) qs = 'format=xlsx';
    const raw = await new Promise((resolve) => {
      const rq = http.request(
        { host: '127.0.0.1', port: PORT, path: '/api/export?' + qs, method: 'GET',
          headers: { Cookie: req.headers.cookie || '' } },
        (rs) => {
          const chunks = [];
          rs.on('data', (c) => chunks.push(c));
          rs.on('end', () => resolve({ status: rs.statusCode, headers: rs.headers, buf: Buffer.concat(chunks) }));
        }
      );
      rq.on('error', () => resolve(null));
      rq.end();
    });
    if (!raw || raw.status !== 200) return sendJson(res, (raw && raw.status) || 500, { error: '生成导出文件失败' });
    const cd = raw.headers['content-disposition'] || '';
    let name = '';
    const b64 = raw.headers['x-export-name-b64'] || '';
    if (b64) { try { name = Buffer.from(b64, 'base64').toString('utf8'); } catch (e) { name = ''; } }
    if (!name) {
      const star = cd.match(/filename\*=UTF-8''([^;]+)/);
      if (star && star[1]) { try { name = decodeURIComponent(star[1]); } catch (e) { name = star[1]; } }
      else { const plain = cd.match(/filename="([^"]+)"/); if (plain) name = plain[1]; }
    }
    if (!name) name = 'kaoqin.xlsx';
    const buf = raw.buf;
    const token = crypto.randomBytes(16).toString('hex');
    exportTokens.set(token, { name, buf, exp: Date.now() + EXPORT_TTL_MS });
    for (const [t, v] of exportTokens) if (v.exp < Date.now()) exportTokens.delete(t);
    return sendJson(res, 200, { url: '/api/export/dl/' + token, name });
  }

  /* --- 管理员 --- */
  if (route === 'POST /api/config') {
    requireAdmin();
    const body = await readJson(req);
    const next = db.saveConfig(body);
    db.audit(user, 'save_config', '');
    return sendJson(res, 200, { ok: true, config: next });
  }

  if (route === 'GET /api/admin/users') {
    requireAdmin();
    return sendJson(res, 200, { users: db.listUsers() });
  }

  if (route === 'POST /api/admin/users/reset') {
    requireAdmin();
    const body = await readJson(req);
    const target = db.getUserById(Number(body.id));
    if (!target) return sendJson(res, 404, { error: '账号不存在' });
    db.setPassword(target.id, db.DEFAULT_PASSWORD);
    db.open().prepare('UPDATE users SET must_change=1 WHERE id=?').run(target.id);
    db.audit(user, 'reset_password', target.username);
    return sendJson(res, 200, { ok: true, password: db.DEFAULT_PASSWORD });
  }

  if (route === 'GET /api/admin/audit') {
    requireAdmin();
    return sendJson(res, 200, { log: db.recentAudit(300) });
  }

  if (route === 'GET /api/health') {
    requireAdmin();
    const d = db.open();
    return sendJson(res, 200, {
      ok: true,
      db: db.DB_FILE,
      members: d.prepare('SELECT COUNT(*) c FROM members').get().c,
      records: d.prepare('SELECT COUNT(*) c FROM attendance').get().c,
      uptime: Math.round(process.uptime()),
    });
  }

  return sendJson(res, 404, { error: `接口不存在：${route}` });
}

/* ---------------- 静态文件 ---------------- */
function serveStatic(req, res, p, user) {
  // 支持 /app.1.2.0.js、/app.js?v=1.2.0、/app.js 三种写法
  let rel = decodeURIComponent(p).replace(/[?&]v=[^&]*/g, '');
  rel = rel.replace(/\.([0-9]+\.[0-9]+\.[0-9]+)(\.(?:js|css))$/, '$2');
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 403, '禁止访问');

  if (rel === '/index.html') {
    return sendBuffer(res, 200, Buffer.from(getIndexHtml(user, req), 'utf8'), {
      'Content-Type': MIME['.html'],
      'Cache-Control': 'no-store, must-revalidate',
    });
  }
  fs.readFile(filePath, (err, data) => {
    if (err) return sendText(res, 404, '页面不存在');
    const ext = path.extname(filePath).toLowerCase();
    // 静态资源带 ?v= 查询串，可长期缓存
    // 协商缓存：文件没变走 304，文件一变（含版本号变化）立刻刷新，不用用户强刷
    const etag = '"' + crypto.createHash('sha1').update(data).digest('hex').slice(0, 16) + '"';
    if (req.headers['if-none-match'] === etag) {
      return sendText(res, 304, '');
    }
    sendBuffer(res, 200, data, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache, must-revalidate',
      ETag: etag,
    });
  });
}

/* ---------------- 启动 ---------------- */
function start() {
  server.listen(PORT, HOST, () => {
    const cfg = db.getConfig();
    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('  示例影像部 · 运动会考勤系统');
    console.log('════════════════════════════════════════════════');
    console.log(`  标题     ：${cfg.title}`);
    console.log(`  活动日期 ：${cfg.dates.join('、')}`);
    console.log(`  时段数   ：${cfg.slots.length} 个/天（每半小时一格）`);
    console.log(`  名单     ：${db.getMembers().length} 人 / ${db.getGroups().length} 个组`);
    console.log(`  数据库   ：${db.DB_FILE}`);
    console.log(`  监听地址 ：http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log('  默认密码 ：' + db.DEFAULT_PASSWORD + '（首次登录后必须修改）');
    console.log('════════════════════════════════════════════════');
    console.log('');
  });
}

if (require.main === module) start();

module.exports = { server, start, contextPayload };
