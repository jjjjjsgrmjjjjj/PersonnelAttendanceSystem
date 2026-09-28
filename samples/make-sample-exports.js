'use strict';
/**
 * 生成样例导出文件，用于在没有真实考勤数据时预览 / 核对 Excel 导出效果。
 *
 *   node samples/make-sample-exports.js
 *
 * 会在本文件所在目录生成 kaoqin-sample.xlsx / .xls 与一个临时样例数据库，
 * 不影响正式数据（data/kaoqin.db）。
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIR = __dirname;
const SAMPLE_DB = path.join(DIR, 'sample.db');
process.env.KAOQIN_DB = SAMPLE_DB;

// 每次重新生成，保证样例可复现
for (const suffix of ['', '-wal', '-shm']) {
  const f = SAMPLE_DB + suffix;
  if (fs.existsSync(f)) fs.rmSync(f);
}

const db = require(path.join(ROOT, 'src', 'db.js'));
const attendance = require(path.join(ROOT, 'src', 'attendance.js'));
const xlsx = require(path.join(ROOT, 'src', 'xlsx.js'));

db.open();
db.seed();

const cfg = db.getConfig();
const groups = db.getGroups();
const members = db.getMembers();

// 造一些贴近现场的样例记录
const sample = [
  ['成员14', 'present', ''],
  ['成员44', 'late', '迟到 10 分钟，已提醒'],
  ['成员16', 'leave', '请假半天，家属接走'],
  ['成员41', 'absent', '未到岗'],
  ['成员18', 'present', ''],
  ['成员35', 'present', ''],
  ['成员35', 'late', '无人机调参延迟 5 分钟'],
  ['成员25', 'present', ''],
  ['成员46', 'present', '兼任摄影组，两个组都已确认'],
  ['成员34', 'present', ''],
  ['成员15', 'leave', '请假一天'],
  ['成员09', 'present', ''],
];

const changes = [];
sample.forEach(([name, status, note], idx) => {
  const m = members.find((x) => x.name === name);
  if (!m) return;
  changes.push({
    memberId: m.id,
    date: cfg.dates[idx % cfg.dates.length],
    slot: cfg.slots[2 + (idx % 6)],
    status,
    note,
    substitute: status === 'leave' ? '成员43' : '',
  });
});

const admin = { id: 1, is_admin: 1, username: 'admin' };
const res = attendance.applyChanges(admin, changes, new Map(members.map((m) => [m.id, m])));
console.log('写入样例记录：', res.saved, '条');

const ctx = {
  config: cfg,
  groups,
  members,
  dates: cfg.dates,
  slots: cfg.slots,
  attMap: attendance.loadAll(),
};

const outXlsx = path.join(DIR, 'kaoqin-sample.xlsx');
const outXls = path.join(DIR, 'kaoqin-sample.xls');
fs.writeFileSync(outXlsx, xlsx.exportXlsx(ctx));
fs.writeFileSync(outXls, xlsx.exportXmlXls(ctx));

console.log('已生成：');
for (const f of [outXlsx, outXls]) console.log('  ' + f + '  ' + fs.statSync(f).size + ' 字节');
console.log('');
console.log('用 Excel / WPS 直接打开即可查看导出效果；核对脚本：node samples/validate-exports.js');
