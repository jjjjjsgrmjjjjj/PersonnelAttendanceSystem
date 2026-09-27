'use strict';
/** 考勤读写与统计 */

const { open } = require('./db');
const { canEditMember } = require('./permissions');

const VALID_STATUS = new Set(['unmarked', 'present', 'late', 'absent', 'leave']);

/** 读取某个日期区间的考勤记录 -> Map(key -> record) */
function loadRange(dateFrom, dateTo) {
  const rows = open()
    .prepare(
      `SELECT member_id, date, slot, status, note, substitute, updated_at
         FROM attendance
        WHERE date >= ? AND date <= ?`
    )
    .all(dateFrom, dateTo);
  const map = new Map();
  for (const r of rows) {
    map.set(`${r.member_id}|${r.date}|${r.slot}`, {
      memberId: r.member_id,
      date: r.date,
      slot: r.slot,
      status: r.status,
      note: r.note,
      substitute: r.substitute,
      updatedAt: r.updated_at,
    });
  }
  return map;
}

/** 全体记录（用于总览/导出） */
function loadAll() {
  return loadRange('0000-01-01', '9999-12-31');
}

/**
 * 批量写入。changes: [{memberId,date,slot,status,note,substitute}]
 * memberById: Map(id -> member)
 * 返回 {saved, skipped, errors}
 */
function applyChanges(user, changes, memberById) {
  const d = open();
  const upsert = d.prepare(
    `INSERT INTO attendance(member_id,date,slot,status,note,substitute,updated_by,updated_at)
     VALUES(?,?,?,?,?,?,?,datetime('now','localtime'))
     ON CONFLICT(member_id,date,slot) DO UPDATE SET
       status=excluded.status, note=excluded.note, substitute=excluded.substitute,
       updated_by=excluded.updated_by, updated_at=excluded.updated_at`
  );
  const del = d.prepare('DELETE FROM attendance WHERE member_id=? AND date=? AND slot=?');
  const exists = d.prepare('SELECT id FROM attendance WHERE member_id=? AND date=? AND slot=?');

  let saved = 0;
  let skipped = 0;
  const errors = [];

  d.exec('BEGIN');
  try {
    for (const c of changes) {
      const member = memberById.get(Number(c.memberId));
      if (!member) {
        errors.push(`成员不存在: ${c.memberId}`);
        skipped++;
        continue;
      }
      if (!canEditMember(user, member)) {
        errors.push(`无权修改：${member.name}`);
        skipped++;
        continue;
      }
      const date = String(c.date || '');
      const slot = String(c.slot || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !slot) {
        errors.push(`日期或时段非法：${date} ${slot}`);
        skipped++;
        continue;
      }
      const status = VALID_STATUS.has(c.status) ? c.status : 'unmarked';
      const note = String(c.note ?? '').slice(0, 500);
      const substitute = String(c.substitute ?? '').slice(0, 100);

      const blank = status === 'unmarked' && !note && !substitute;
      if (blank) {
        if (exists.get(member.id, date, slot)) {
          del.run(member.id, date, slot);
          saved++;
        }
        continue;
      }
      upsert.run(member.id, date, slot, status, note, substitute, user.id);
      saved++;
    }
    d.exec('COMMIT');
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
  return { saved, skipped, errors };
}

/** 统计：按人 / 按组 / 按时段 */
function summarize(members, attMap, dates, slots, statusMeta) {
  const byMember = new Map();
  for (const m of members) byMember.set(m.id, { present: 0, late: 0, absent: 0, leave: 0, marked: 0 });

  const byDateSlot = new Map(); // `${date}|${slot}` -> {present,late,absent,leave,marked}
  const byGroup = new Map(); // groupId -> {present,late,absent,leave,marked}

  for (const m of members) {
    const rec = byMember.get(m.id);
    for (const date of dates) {
      for (const slot of slots) {
        const a = attMap.get(`${m.id}|${date}|${slot}`);
        if (!a || a.status === 'unmarked') continue;
        rec.marked++;
        if (rec[a.status] != null) rec[a.status]++;
        const key = `${date}|${slot}`;
        if (!byDateSlot.has(key)) byDateSlot.set(key, { present: 0, late: 0, absent: 0, leave: 0, marked: 0 });
        const ds = byDateSlot.get(key);
        ds.marked++;
        if (ds[a.status] != null) ds[a.status]++;
        const gid = m.primaryGroupId;
        if (!byGroup.has(gid)) byGroup.set(gid, { present: 0, late: 0, absent: 0, leave: 0, marked: 0 });
        const gs = byGroup.get(gid);
        gs.marked++;
        if (gs[a.status] != null) gs[a.status]++;
      }
    }
  }
  return {
    byMember: Object.fromEntries(byMember),
    byDateSlot: Object.fromEntries(byDateSlot),
    byGroup: Object.fromEntries(byGroup),
  };
}

module.exports = { VALID_STATUS, loadRange, loadAll, applyChanges, summarize };
