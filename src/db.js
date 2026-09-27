'use strict';
/**
 * 数据层：SQLite（Node 内置 node:sqlite，无需 npm 安装任何依赖）
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const roster = require('./data/roster.example');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.KAOQIN_DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = process.env.KAOQIN_DB || path.join(DATA_DIR, 'kaoqin.db');

const DEFAULT_PASSWORD = process.env.KAOQIN_DEFAULT_PASSWORD || 'testpass0001';

let db = null;

/* ---------------- 密码 ---------------- */
function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), s, 32).toString('hex');
  return `scrypt$${s}$${hash}`;
}
function verifyPassword(password, stored) {
  try {
    const [algo, salt, hash] = String(stored).split('$');
    if (algo !== 'scrypt' || !salt || !hash) return false;
    const calc = crypto.scryptSync(String(password), salt, 32).toString('hex');
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(calc, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/* ---------------- 时段 ---------------- */
function buildSlots(startHour = 7, endHour = 18, stepMinutes = 30) {
  const slots = [];
  const pad = (n) => String(n).padStart(2, '0');
  for (let minutes = startHour * 60; minutes + stepMinutes <= endHour * 60; minutes += stepMinutes) {
    const h1 = Math.floor(minutes / 60);
    const m1 = minutes % 60;
    const end = minutes + stepMinutes;
    const h2 = Math.floor(end / 60);
    const m2 = end % 60;
    slots.push(`${pad(h1)}:${pad(m1)}-${pad(h2)}:${pad(m2)}`);
  }
  return slots;
}

const DEFAULT_SETTINGS = {
  title: roster.TITLE,
  org: '示例中学新媒体中心示例影像部',
  subtitle: '示例季第01届田径运动会 · 考勤记录',
  dates: JSON.stringify(roster.DEFAULT_DATES),
  slots: JSON.stringify(buildSlots(7, 18, 30)),
  note: '',
};

/* ---------------- 初始化 ---------------- */
function open() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  db = new DatabaseSync(DB_FILE);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS groups (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      key  TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS members (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      name    TEXT NOT NULL,
      cls     TEXT NOT NULL DEFAULT '',
      role    TEXT NOT NULL DEFAULT '组员',
      note    TEXT NOT NULL DEFAULT '',
      active  INTEGER NOT NULL DEFAULT 1,
      sort    INTEGER NOT NULL DEFAULT 0,
      UNIQUE (name, cls)
    );
    CREATE TABLE IF NOT EXISTS memberships (
      group_sort    INTEGER,   -- 组内显示顺序（null 时按 members.sort）
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      is_primary INTEGER NOT NULL DEFAULT 0,
      UNIQUE (member_id, group_id)
    );
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      display       TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin      INTEGER NOT NULL DEFAULT 0,
      must_change   INTEGER NOT NULL DEFAULT 1,
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS user_groups (
      user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, group_id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attendance (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      date       TEXT NOT NULL,
      slot       TEXT NOT NULL,
      status     TEXT NOT NULL,
      note       TEXT NOT NULL DEFAULT '',
      substitute TEXT NOT NULL DEFAULT '',
      updated_by INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE (member_id, date, slot)
    );
    CREATE INDEX IF NOT EXISTS idx_attendance_lookup ON attendance (date, slot);
    CREATE TABLE IF NOT EXISTS reminders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      date       TEXT NOT NULL,
      text       TEXT NOT NULL,
      done       INTEGER NOT NULL DEFAULT 0,
      updated_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      at         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      user_id    INTEGER,
      username   TEXT NOT NULL DEFAULT '',
      action     TEXT NOT NULL,
      detail     TEXT NOT NULL DEFAULT ''
    );
  `);
  return db;
}

function isSeeded() {
  const d = open();
  const row = d.prepare('SELECT COUNT(*) AS c FROM groups').get();
  return row.c > 0;
}

function seed({ force = false } = {}) {
  const d = open();
  if (isSeeded() && !force) return false;
  if (force) {
    d.exec('DELETE FROM user_groups; DELETE FROM users; DELETE FROM memberships; DELETE FROM members; DELETE FROM groups;');
  }

  const insSetting = d.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

  const insGroup = d.prepare('INSERT INTO groups(key,name,sort) VALUES(?,?,?)');
  const groupIdByKey = new Map();
  for (const g of roster.GROUPS) {
    insGroup.run(g.key, g.name, g.sort);
    groupIdByKey.set(g.key, d.prepare('SELECT id FROM groups WHERE key=?').get(g.key).id);
  }

  const insMember = d.prepare('INSERT INTO members(name,cls,role,note,sort) VALUES(?,?,?,?,?)');
  const insMembership = d.prepare('INSERT INTO memberships(member_id,group_id,is_primary) VALUES(?,?,?)');
  roster.MEMBERS.forEach((m, i) => {
    if (!groupIdByKey.has(m.primary)) throw new Error(`未知分组 key: ${m.primary} (${m.name})`);
    insMember.run(m.name, m.cls, m.role, m.note || '', i + 1);
    const mid = d.prepare('SELECT id FROM members WHERE name=? AND cls=?').get(m.name, m.cls).id;
    insMembership.run(mid, groupIdByKey.get(m.primary), 1);
    for (const extra of m.extra || []) {
      if (!groupIdByKey.has(extra)) throw new Error(`未知分组 key: ${extra} (${m.name})`);
      insMembership.run(mid, groupIdByKey.get(extra), 0);
    }
  });

  const insUser = d.prepare('INSERT INTO users(username,display,password_hash,is_admin,must_change) VALUES(?,?,?,?,1)');
  const insUserGroup = d.prepare('INSERT OR IGNORE INTO user_groups(user_id,group_id) VALUES(?,?)');
  for (const a of roster.ACCOUNTS) {
    insUser.run(a.username, a.display, hashPassword(DEFAULT_PASSWORD), a.admin ? 1 : 0);
    const uid = d.prepare('SELECT id FROM users WHERE username=?').get(a.username).id;
    for (const gk of a.groups) {
      if (!groupIdByKey.has(gk)) throw new Error(`未知分组 key: ${gk} (${a.username})`);
      insUserGroup.run(uid, groupIdByKey.get(gk));
    }
  }
  return true;
}

/* ---------------- 设置读写 ---------------- */
function getSetting(key, fallback = null) {
  const row = open().prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : fallback;
}
function getSettingJSON(key, fallback) {
  const raw = getSetting(key, null);
  if (raw == null || raw === '') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function setSetting(key, value) {
  open()
    .prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, String(value));
}
function setSettingJSON(key, value) {
  setSetting(key, JSON.stringify(value));
}

function getConfig() {
  return {
    title: getSetting('title', roster.TITLE),
    org: getSetting('org', ''),
    subtitle: getSetting('subtitle', ''),
    dates: getSettingJSON('dates', roster.DEFAULT_DATES),
    slots: getSettingJSON('slots', buildSlots(7, 18, 30)),
    note: getSetting('note', ''),
  };
}

function saveConfig({ title, org, subtitle, dates, slots, note }) {
  if (typeof title === 'string' && title.trim()) setSetting('title', title.trim());
  if (typeof org === 'string') setSetting('org', org.trim());
  if (typeof subtitle === 'string') setSetting('subtitle', subtitle.trim());
  if (Array.isArray(dates)) {
    const clean = dates.map((s) => String(s).trim()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
    if (clean.length) setSettingJSON('dates', [...new Set(clean)].sort());
  }
  if (Array.isArray(slots)) {
    const clean = slots.map((s) => String(s).trim()).filter(Boolean);
    if (clean.length) setSettingJSON('slots', clean);
  }
  if (typeof note === 'string') setSetting('note', note);
  return getConfig();
}

/* ---------------- 分组与人员 ---------------- */
function getGroups() {
  return open().prepare('SELECT id,key,name,sort FROM groups ORDER BY sort,id').all();
}

/** 全部人员，含其所属分组（primary + extras），按主组排序 */
function getMembers() {
  const d = open();
  const members = d
    .prepare(
      `SELECT m.id, m.name, m.cls, m.role, m.note, m.active, m.sort,
              (SELECT mg.group_id FROM memberships mg WHERE mg.member_id=m.id AND mg.is_primary=1) AS primary_group_id
         FROM members m
        WHERE m.active=1
        ORDER BY m.sort, m.id`
    )
    .all();
  const links = d.prepare('SELECT member_id, group_id, is_primary, group_sort FROM memberships').all();
  const byMember = new Map();
  for (const l of links) {
    if (!byMember.has(l.member_id)) byMember.set(l.member_id, { primary: null, extras: [], sort: {} });
    const rec = byMember.get(l.member_id);
    if (l.group_sort != null) rec.sort[l.group_id] = l.group_sort;
    if (l.is_primary) rec.primary = l.group_id;
    else rec.extras.push(l.group_id);
  }
  const groups = getGroups();
  const gById = new Map(groups.map((g) => [g.id, g]));
  // 组 -> 组长成员姓名（组长账号所属组的成员）
  const leadersByGroup = {};
  try {
    const leaderRows = open()
      .prepare(
        `SELECT ug.group_id AS group_id, u.username AS username
           FROM user_groups ug JOIN users u ON u.id = ug.user_id
          WHERE u.active = 1`
      )
      .all();
    const membersAll = d.prepare('SELECT id, name FROM members').all();
    const idByName = {};
    for (const mm of membersAll) idByName[mm.name] = mm.id;
    for (const r of leaderRows) {
      const nm = pinyin[r.username];
      if (nm) leadersByGroup[r.group_id] = nm;
    }
  } catch (e) {}
  return members.map((m) => {
    const rec = byMember.get(m.id) || { primary: m.primary_group_id, extras: [] };
    return {
      id: m.id,
      name: m.name,
      cls: m.cls,
      role: m.role,
      note: m.note,
      primaryGroupId: rec.primary,
      groupSort: rec.sort || {},
      groupRoles: (() => {
        const all = (rec.primary ? [rec.primary] : []).concat(rec.extras);
        const roles = {};
        for (const gid of all) {
          const leader = leadersByGroup[gid];
          roles[gid] = leader === m.name ? '组长' : (gid === rec.primary && m.role === '组长' ? '组长' : '组员');
        }
        return roles;
      })(),
      primaryGroupName: gById.get(rec.primary)?.name || '',
      extraGroupIds: rec.extras.slice().sort((a, b) => (gById.get(a)?.sort ?? 0) - (gById.get(b)?.sort ?? 0)),
      extraGroupNames: rec.extras
        .slice()
        .sort((a, b) => (gById.get(a)?.sort ?? 0) - (gById.get(b)?.sort ?? 0))
        .map((id) => gById.get(id)?.name || ''),
      groupIds: [rec.primary, ...rec.extras].filter(Boolean),
    };
  });
}

function getUserGroups(userId) {
  return open()
    .prepare(
      `SELECT g.id,g.key,g.name,g.sort FROM user_groups ug JOIN groups g ON g.id=ug.group_id
        WHERE ug.user_id=? ORDER BY g.sort`
    )
    .all(userId);
}

/** 各组组长：返回 { 组id: 该组组长账号 }，用于页面标注"兼X组（组长）" */
function getGroupLeaders() {
  const rows = open()
    .prepare(
      `SELECT g.id AS group_id, u.username AS username
         FROM user_groups ug
         JOIN users u ON u.id = ug.user_id
         JOIN groups g ON g.id = ug.group_id
        WHERE u.active = 1
        ORDER BY g.sort, u.id`
    )
    .all();
  const map = {};
  for (const r of rows) {
    if (!map[r.group_id]) map[r.group_id] = r.username;
  }
  return map;
}

/* ---------------- 会话 ---------------- */
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 180;   // 登录状态保留 180 天

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  open()
    .prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)')
    .run(token, userId, Date.now() + SESSION_TTL_MS);
  return token;
}
function getSession(token) {
  if (!token) return null;
  const d = open();
  const row = d.prepare('SELECT * FROM sessions WHERE token=?').get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    d.prepare('DELETE FROM sessions WHERE token=?').run(token);
    return null;
  }
  const user = d
    .prepare('SELECT id,username,display,is_admin,must_change,active FROM users WHERE id=?')
    .get(row.user_id);
  if (!user || !user.active) return null;
  return { token, user };
}
function destroySession(token) {
  if (token) open().prepare('DELETE FROM sessions WHERE token=?').run(token);
}
function purgeSessions() {
  open().prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

function findUserByUsername(username) {
  return open().prepare('SELECT * FROM users WHERE username=?').get(String(username || '').trim());
}
function getUserById(id) {
  return open().prepare('SELECT * FROM users WHERE id=?').get(id);
}
function setPassword(userId, password) {
  open()
    .prepare('UPDATE users SET password_hash=?, must_change=0 WHERE id=?')
    .run(hashPassword(password), userId);
}
function listUsers() {
  const d = open();
  return d
    .prepare('SELECT id,username,display,is_admin,must_change,active,created_at FROM users ORDER BY is_admin DESC, id')
    .all()
    .map((u) => ({ ...u, groups: getUserGroups(u.id).map((g) => g.name) }));
}
function audit(user, action, detail) {
  open()
    .prepare('INSERT INTO audit_log(user_id,username,action,detail) VALUES(?,?,?,?)')
    .run(user ? user.id : null, user ? user.username : '', action, detail || '');
}
function recentAudit(limit = 200) {
  return open().prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
}

module.exports = {
  ROOT,
  DATA_DIR,
  DB_FILE,
  DEFAULT_PASSWORD,
  DEFAULT_SETTINGS,
  buildSlots,
  open,
  seed,
  isSeeded,
  getSetting,
  getSettingJSON,
  setSetting,
  setSettingJSON,
  getConfig,
  saveConfig,
  getGroups,
  getGroupLeaders,
  getMembers,
  getUserGroups,
  hashPassword,
  verifyPassword,
  createSession,
  getSession,
  destroySession,
  purgeSessions,
  findUserByUsername,
  getUserById,
  setPassword,
  listUsers,
  audit,
  recentAudit,
};

/* ---------------- CLI: node src/db.js --init ---------------- */
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--reset') && fs.existsSync(DB_FILE)) {
    for (const suffix of ['', '-wal', '-shm']) {
      const f = DB_FILE + suffix;
      if (fs.existsSync(f)) fs.rmSync(f);
    }
    db = null;
    console.log('已删除旧数据库：' + DB_FILE);
  }
  open();
  const created = seed({ force: args.includes('--force') });
  console.log(created ? '数据库已初始化：' : '数据库已存在，跳过初始化：', DB_FILE);
  console.log('人员数：', open().prepare('SELECT COUNT(*) c FROM members').get().c);
  console.log('分组数：', open().prepare('SELECT COUNT(*) c FROM groups').get().c);
  console.log('账号数：', open().prepare('SELECT COUNT(*) c FROM users').get().c);
  console.log('初始密码：', DEFAULT_PASSWORD, '（首次登录后必须修改）');
}
