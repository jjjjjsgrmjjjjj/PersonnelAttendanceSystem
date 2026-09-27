'use strict';
/**
 * 导出模块：把考勤数据导出为 Excel。
 *  1) buildXlsx  -> 标准 .xlsx（推荐，列数无 256 限制）
 *  2) buildXmlXls -> Excel 2003 XML（.xls，兼容老版本 Office/WPS）
 * 两者都不依赖任何第三方库。
 */

const { zipSync } = require('./zip');

const STATUS = {
  present: { label: '出勤', short: '出', fill: 'FFD9F2D9' },
  late: { label: '迟到', short: '迟', fill: 'FFFFF2CC' },
  absent: { label: '缺勤', short: '缺', fill: 'FFFBD5D5' },
  leave: { label: '请假', short: '假', fill: 'FFDCE6F7' },
  unmarked: { label: '', short: '', fill: null },
};

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const colName = (n) => {
  let s = '';
  let v = n;
  while (v > 0) {
    const r = (v - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    v = Math.floor((v - 1) / 26);
  }
  return s;
};

const weekdayCN = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00');
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()] || '';
};

/* ------------------------------------------------------------------ */
/* 通用：构建各分组的数据工作表                                         */
/* ------------------------------------------------------------------ */

function weekLabel(dates) {
  const parts = String(dates[0]).split('-');
  const base = `${parts[0]}年${Number(parts[1])}月${Number(parts[2])}日`;
  if (dates.length <= 1) return base;
  const last = String(dates[dates.length - 1]).split('-');
  if (last[0] === parts[0] && last[1] === parts[1]) {
    return `${base}—${Number(last[2])}日`;
  }
  return `${base}—${last[0]}年${Number(last[1])}月${Number(last[2])}日`;
}

/**
 * 单个分组工作表的内容构建
 * 返回 { name, sheet }
 */
function buildGroupSheet({ group, members, dates, slots, attMap, config }) {
  const rows = [];
  const colCount = 2 + dates.length * slots.length + 2; // 姓名/班级 + 各时段 + 备注 + 替岗记录

  // 标题（整表跨列）
  rows.push({ cells: [{ v: config.title, style: 'title', span: colCount }] });
  rows.push({
    cells: [
      {
        v: `${config.org}　${group.name}考勤明细表　活动日期：${weekLabel(dates)}`,
        style: 'subtitle',
        span: colCount,
      },
    ],
  });
  rows.push({
    cells: [
      {
        v: '说明：“考勤情况”一栏按每半小时记录一次；出=出勤，迟=迟到，缺=缺勤，假=请假（已批准），空白=该时段未记录。',
        style: 'note',
        span: colCount,
      },
    ],
  });

  // 表头：第一行日期分组
  const head1 = [{ v: '姓名', style: 'head', rowSpan: 2 }, { v: '班级', style: 'head', rowSpan: 2 }];
  for (const d of dates) {
    head1.push({ v: `${d}（${weekdayCN(d)}）`, style: 'head', span: slots.length });
  }
  head1.push({ v: '备注', style: 'head', rowSpan: 2 });
  head1.push({ v: '替岗记录', style: 'head', rowSpan: 2 });
  rows.push({ cells: head1, height: 22 });

  // 表头第二行：时段。前两列被上一行的姓名/班级纵向合并占用，末尾两列同理，都需占位
  const head2 = [{ v: '', style: 'head2' }, { v: '', style: 'head2' }];
  for (let i = 0; i < dates.length; i++) {
    for (const s of slots) head2.push({ v: s, style: 'head2' });
  }
  head2.push({ v: '', style: 'head2' }, { v: '', style: 'head2' });
  rows.push({ cells: head2, height: 30 });

  // 数据行
  const perPerson = new Map();
  for (const m of members) {
    const cells = [{ v: m.name, style: 'name' }, { v: m.cls, style: 'text' }];
    for (const d of dates) {
      for (const s of slots) {
        const a = attMap.get(`${m.id}|${d}|${s}`);
        const st = a && STATUS[a.status] ? a.status : 'unmarked';
        const label = st === 'unmarked' ? '' : STATUS[st].short;
        cells.push({ v: label, style: st === 'unmarked' ? 'text' : `st_${st}` });
        if (st !== 'unmarked') {
          const p = perPerson.get(m.id) || { present: 0, late: 0, absent: 0, leave: 0 };
          if (p[st] != null) p[st]++;
          perPerson.set(m.id, p);
        }
      }
    }
    const noteBits = [];
    const subBits = [];
    for (const d of dates) {
      for (const s of slots) {
        const a = attMap.get(`${m.id}|${d}|${s}`);
        if (!a) continue;
        const tag = dates.length > 1 ? `${d.slice(5)} ${s}` : s;
        if (a.note) noteBits.push(`${tag} ${a.note}`);
        if (a.substitute) subBits.push(`${tag} 由${a.substitute}替岗`);
      }
    }
    if (m.role && m.role !== '组员') noteBits.push(`组内角色：${m.role}`);
    if (m.extraGroupNames && m.extraGroupNames.length) noteBits.push(`兼任：${m.extraGroupNames.join('、')}`);
    if (m.note) noteBits.push(m.note);
    cells.push({ v: noteBits.join('；'), style: 'textWrap' });
    cells.push({ v: subBits.join('；'), style: 'textWrap' });
    rows.push({ cells, height: 20 });
  }

  // 签名行
  rows.push({ cells: [{ v: '', style: 'text' }] });
  rows.push({
    cells: [
      {
        v: `组长签字：____________　　记录人：____________　　记录日期：______年____月____日　　审核：____________`,
        style: 'subtitle',
        span: colCount,
      },
    ],
    height: 26,
  });

  const widths = [{ w: 10 }, { w: 12 }];
  for (let i = 0; i < dates.length * slots.length; i++) widths.push({ w: 3.6 });
  widths.push({ w: 42 }, { w: 24 });

  const stats = members
    .map((m) => {
      const p = perPerson.get(m.id);
      if (!p) return null;
      return { m, p };
    })
    .filter(Boolean);
  if (stats.length) {
    rows.push({ cells: [{ v: '', style: 'text' }] });
    rows.push({
      cells: [
        {
          v: `本组统计：共 ${members.length} 人，有记录 ${stats.length} 人；出勤 ${stats.reduce((s, x) => s + x.p.present, 0)} 人次，迟到 ${stats.reduce((s, x) => s + x.p.late, 0)} 人次，缺勤 ${stats.reduce((s, x) => s + x.p.absent, 0)} 人次，请假 ${stats.reduce((s, x) => s + x.p.leave, 0)} 人次；工作小时合计 ${stats.reduce((s, x) => s + (x.p.present + x.p.late) * 0.5, 0)} 小时（半小时一格，出勤+迟到计）。`,
          style: 'subtitle',
          span: colCount,
        },
      ],
    });
  }

  return { name: group.name, rows, widths, freeze: { row: 5, col: 2 } };
}

/** 总览表：一人一行，汇总各时段 */
function buildOverviewSheet({ groups, members, dates, slots, attMap, config }) {
  const rows = [];
  const totalSlots = dates.length * slots.length;
  const head = [
    '序号',
    '姓名',
    '班级',
    '所属组',
    '组内角色',
    `应记录时段数`,
    '出勤',
    '迟到',
    '缺勤',
    '请假',
    '未记录',
    '出勤率',
    '工作小时',
    '备注',
  ];
  rows.push({ cells: [{ v: config.title + '　考勤总览', style: 'title', span: head.length }] });
  rows.push({
    cells: [
      {
        v: `${config.org}　活动日期：${weekLabel(dates)}　每天 ${slots.length} 个半小时时段，共 ${totalSlots} 个时段`,
        style: 'subtitle',
        span: head.length,
      },
    ],
  });
  rows.push({ cells: head.map((v) => ({ v, style: 'head' })), height: 24 });

  const groupName = (id) => groups.find((g) => g.id === id)?.name || '';
  members.forEach((m, i) => {
    let present = 0,
      late = 0,
      absent = 0,
      leave = 0,
      marked = 0;
    for (const d of dates) {
      for (const s of slots) {
        const a = attMap.get(`${m.id}|${d}|${s}`);
        if (!a || a.status === 'unmarked') continue;
        marked++;
        if (a.status === 'present') present++;
        else if (a.status === 'late') late++;
        else if (a.status === 'absent') absent++;
        else if (a.status === 'leave') leave++;
      }
    }
    const rate = marked ? Math.round(((present + late) / marked) * 1000) / 10 : '';
    const workHours = (present + late) * 0.5;   // 半小时一格：出勤+迟到计为工作
    rows.push({
      cells: [
        { v: i + 1, style: 'text' },
        { v: m.name, style: 'name' },
        { v: m.cls, style: 'text' },
        { v: groupName(m.primaryGroupId), style: 'text' },
        { v: m.role, style: 'text' },
        { v: totalSlots, style: 'text' },
        { v: present, style: 'num' },
        { v: late, style: 'num' },
        { v: absent, style: absent > 0 ? 'st_absent' : 'num' },
        { v: leave, style: 'num' },
        { v: totalSlots - marked, style: marked < totalSlots ? 'st_late' : 'num' },
        { v: rate === '' ? '' : `${rate}%`, style: 'text' },
        { v: workHours, style: 'num' },
        { v: m.note || '', style: 'textWrap' },
      ],
      height: 20,
    });
  });

  const widths = [
    { w: 6 },
    { w: 10 },
    { w: 12 },
    { w: 16 },
    { w: 8 },
    { w: 12 },
    { w: 8 },
    { w: 8 },
    { w: 8 },
    { w: 8 },
    { w: 9 },
    { w: 9 },
    { w: 10 },
    { w: 32 },
  ];
  return { name: '考勤总览', rows, widths, freeze: { row: 4, col: 3 } };
}

/** 按日期时段汇总各组在场/缺勤人数 */
function buildDailySheet({ groups, members, dates, slots, attMap, config }) {
  const rows = [];
  rows.push({ cells: [{ v: '各时段人数统计（按主组统计，每一时段有记录的人数）', style: 'title', span: 3 + groups.length }] });
  rows.push({
    cells: [
      {
        v: `${config.org}　活动日期：${weekLabel(dates)}`,
        style: 'subtitle',
        span: 3 + groups.length,
      },
    ],
  });

  for (const d of dates) {
    rows.push({ cells: [{ v: `${d}（${weekdayCN(d)}）`, style: 'head', span: 3 + groups.length }] });
    rows.push({
      cells: [
        { v: '时段', style: 'head' },
        { v: '应到（已记录）', style: 'head' },
        { v: '缺勤', style: 'head' },
        ...groups.map((g) => ({ v: g.name, style: 'head' })),
      ],
      height: 24,
    });
    for (const s of slots) {
      let marked = 0;
      let absent = 0;
      const perGroup = new Map(groups.map((g) => [g.id, 0]));
      for (const m of members) {
        const a = attMap.get(`${m.id}|${d}|${s}`);
        if (!a || a.status === 'unmarked') continue;
        marked++;
        if (a.status === 'absent') absent++;
        if (perGroup.has(m.primaryGroupId)) {
          if (a.status === 'present' || a.status === 'late') perGroup.set(m.primaryGroupId, perGroup.get(m.primaryGroupId) + 1);
        }
      }
      rows.push({
        cells: [
          { v: s, style: 'text' },
          { v: marked, style: 'num' },
          { v: absent, style: absent > 0 ? 'st_absent' : 'num' },
          ...groups.map((g) => ({ v: perGroup.get(g.id), style: 'num' })),
        ],
      });
    }
    rows.push({ cells: [{ v: '', style: 'text' }] });
  }

  const widths = [{ w: 14 }, { w: 14 }, { w: 8 }, ...groups.map(() => ({ w: 14 }))];
  return { name: '各时段统计', rows, widths, freeze: { row: 3, col: 1 } };
}

/** 说明表 */
function buildReadmeSheet({ config, groups, members }) {
  const rows = [];
  rows.push({ cells: [{ v: '考勤记录说明', style: 'title', span: 3 }] });
  const push = (a, b, c, sa, sb, sc) =>
    rows.push({ cells: [{ v: a, style: sa || 'text' }, { v: b, style: sb || 'text' }, { v: c, style: sc || 'text' }] });
  push('表格名称', config.title, '');
  push('填表单位', config.org, '');
  push('活动日期', config.dates.join('、'), '');
  push('记录方式', '按半小时一个时段逐格记录，每人每时段一格', '');
  push('', '', '');
  push('符号', '含义', '说明', 'head', 'head', 'head');
  push('出', '出勤', '按时到岗', 'st_present');
  push('迟', '迟到', '需在备注中写明迟到时间', 'st_late');
  push('缺', '缺勤', '未到岗', 'st_absent');
  push('假', '请假', '已批准，需写明事由', 'st_leave');
  push('（空白）', '未记录', '该时段尚未填写');
  push('', '', '');
  push('序号', '组别', '人数', 'head', 'head', 'head');
  groups.forEach((g, i) =>
    push(String(i + 1), g.name, String(members.filter((m) => (m.groupIds || [m.primaryGroupId]).includes(g.id)).length))
  );
  push('', '', '');
  push('合计', '', String((config && config.members ? config.members : members).length));
  return { name: '说明', rows, widths: [{ w: 22 }, { w: 46 }, { w: 34 }] };
}

/* ------------------------------------------------------------------ */
/* xlsx 写出                                                           */
/* ------------------------------------------------------------------ */

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="10"/><name val="宋体"/></font>
<font><b/><sz val="10"/><name val="宋体"/></font>
<font><b/><sz val="16"/><name val="宋体"/></font>
<font><sz val="9"/><name val="宋体"/><color rgb="FF666666"/></font>
<font><i/><sz val="9"/><name val="宋体"/><color rgb="FF7A5C00"/></font>
</fonts>
<fills count="9">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9F2D9"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFBD5D5"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F7"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF9E6"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FF999999"/></left><right style="thin"><color rgb="FF999999"/></right><top style="thin"><color rgb="FF999999"/></top><bottom style="thin"><color rgb="FF999999"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="15">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const STYLE_INDEX = {
  text: 5,
  title: 1,
  subtitle: 2,
  note: 14,
  head: 3,
  head2: 4,
  name: 6,
  textWrap: 7,
  num: 12,
  st_present: 8,
  st_late: 9,
  st_absent: 10,
  st_leave: 11,
  date: 13,
  raw: 0,
};

function sheetXml(sheet) {
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  parts.push(
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
  );
  // 已用区域 + 行宽一致性自检（防止列错位这类静默错误）
  const widths = sheet.rows.map((r) => r.cells.reduce((s, c) => s + (c.span || 1), 0));
  const maxCol = Math.max(1, ...widths);
  const expected = Math.max(...widths);
  const bad = widths.findIndex((w, i) => {
    if (w === expected) return false;
    // 允许整行留空或仅有单个空白单元格的间隔行
    const cells = sheet.rows[i].cells;
    return !(cells.length === 0 || (cells.length === 1 && (cells[0].v === '' || cells[0].v == null)));
  });
  if (bad >= 0) {
    throw new Error(`工作表「${sheet.name}」第 ${bad + 1} 行占位宽度为 ${widths[bad]}，与其余行的 ${expected} 不一致`);
  }
  parts.push(`<dimension ref="A1:${colName(maxCol)}${Math.max(1, sheet.rows.length)}"/>`);
  if (sheet.freeze) {
    const { row = 1, col = 0 } = sheet.freeze;
    parts.push('<sheetViews><sheetView workbookViewId="0">');
    parts.push(
      `<pane xSplit="${col}" ySplit="${row}" topLeftCell="${colName(col + 1)}${row + 1}" activePane="bottomRight" state="frozen"/>`
    );
    parts.push('</sheetView></sheetViews>');
  }
  if (sheet.widths && sheet.widths.length) {
    parts.push('<cols>');
    sheet.widths.forEach((w, i) => {
      parts.push(`<col min="${i + 1}" max="${i + 1}" width="${w.w || 10}" customWidth="1"/>`);
    });
    parts.push('</cols>');
  }
  parts.push('<sheetData>');
  sheet.rows.forEach((r, ri) => {
    const rowNum = ri + 1;
    parts.push(`<row r="${rowNum}"${r.height ? ` ht="${r.height}" customHeight="1"` : ''}>`);
    let ci = 0;
    for (const cell of r.cells) {
      ci++;
      const span = cell.span || 1;
      const ref = `${colName(ci)}${rowNum}`;
      const styleIdx = STYLE_INDEX[cell.style] ?? 5;
      if (cell.v === '' || cell.v == null) {
        parts.push(`<c r="${ref}" s="${styleIdx}"/>`);
      } else if (typeof cell.v === 'number') {
        parts.push(`<c r="${ref}" s="${styleIdx}"><v>${cell.v}</v></c>`);
      } else {
        parts.push(
          `<c r="${ref}" s="${styleIdx}" t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`
        );
      }
      ci += span - 1;
    }
    parts.push('</row>');
  });
  parts.push('</sheetData>');

  // 合并区域（纵向合并由对应的占位单元格 + rowSpan 描述）
  const merges = [];
  sheet.rows.forEach((r, ri) => {
    let ci = 0;
    for (const cell of r.cells) {
      ci++;
      const span = cell.span || 1;
      if (span > 1) {
        const c1 = colName(ci);
        const c2 = colName(ci + span - 1);
        const r1 = ri + 1;
        const r2 = ri + (cell.rowSpan || 1);
        if (`${c1}${r1}` !== `${c2}${r2}`) merges.push(`${c1}${r1}:${c2}${r2}`);
      }
      ci += span - 1;
    }
  });
  if (merges.length) {
    parts.push(`<mergeCells count="${merges.length}">`);
    for (const m of merges) parts.push(`<mergeCell ref="${m}"/>`);
    parts.push('</mergeCells>');
  }
  parts.push('</worksheet>');
  return parts.join('');
}

function buildXlsx(sheets) {
  const usedNames = new Set();
  const safe = sheets.map((s, i) => {
    let n = String(s.name || `Sheet${i + 1}`).replace(/[\\/?*\[\]:]/g, '_').slice(0, 28);
    while (usedNames.has(n)) n = n + '_';
    usedNames.add(n);
    return { ...s, name: n };
  });

  const files = [];
  files.push({
    name: '[Content_Types].xml',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${safe.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`,
  });
  files.push({
    name: '_rels/.rels',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  });
  files.push({
    name: 'xl/workbook.xml',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
${safe.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('\n')}
</sheets>
</workbook>`,
  });
  files.push({
    name: 'xl/_rels/workbook.xml.rels',
    data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${safe.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${safe.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  });
  files.push({ name: 'xl/styles.xml', data: STYLES_XML });
  safe.forEach((s, i) => {
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) });
  });

  return zipSync(files);
}

/* ------------------------------------------------------------------ */
/* Excel 2003 XML（.xls）                                              */
/* ------------------------------------------------------------------ */

const XML_HEAD = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
<DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
<Author>示例影像部</Author>
<Title>运动会考勤表</Title>
</DocumentProperties>
<Styles>
<Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="宋体" ss:Size="10"/></Style>
<Style ss:ID="title"><Font ss:FontName="宋体" ss:Size="16" ss:Bold="1"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
<Style ss:ID="subtitle"><Font ss:FontName="宋体" ss:Size="9" ss:Color="#666666"/><Alignment ss:Horizontal="Left" ss:Vertical="Center"/></Style>
<Style ss:ID="note"><Font ss:FontName="宋体" ss:Size="9" ss:Italic="1" ss:Color="#7A5C00"/><Alignment ss:Horizontal="Left" ss:Vertical="Center"/><Interior ss:Color="#FFF9E6" ss:Pattern="Solid"/></Style>
<Style ss:ID="head"><Font ss:FontName="宋体" ss:Size="10" ss:Bold="1"/><Interior ss:Color="#DDEBF7" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
<Style ss:ID="head2"><Font ss:FontName="宋体" ss:Size="9" ss:Bold="1"/><Interior ss:Color="#F2F2F2" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1" ss:Rotate="0"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
<Style ss:ID="name"><Font ss:FontName="宋体" ss:Size="10" ss:Bold="1"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
<Style ss:ID="text"><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
<Style ss:ID="textWrap"><Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
<Style ss:ID="num"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>
${['present', 'late', 'absent', 'leave']
  .map(
    (k) =>
      `<Style ss:ID="st_${k}"><Font ss:FontName="宋体" ss:Size="10" ss:Bold="1"${k === 'absent' ? ' ss:Color="#9C0006"' : ''}/><Interior ss:Color="#${STATUS[k].fill.slice(2)}" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>`
  )
  .join('\n')}
</Styles>
`;

function xmlSheet(sheet) {
  const cols = (sheet.widths || [])
    .map((w) => `<Column ss:AutoFitWidth="0" ss:Width="${Math.round((w.w || 10) * 6.4)}"/>`)
    .join('');
  const rows = sheet.rows
    .map((r) => {
      const height = r.height ? ` ss:Height="${r.height}"` : '';
      const cells = r.cells
        .map((c) => {
          const style = ` ss:StyleID="${c.style || 'text'}"`;
          const merge =
            (c.span && c.span > 1 ? ` ss:MergeAcross="${c.span - 1}"` : '') +
            (c.rowSpan && c.rowSpan > 1 ? ` ss:MergeDown="${c.rowSpan - 1}"` : '');
          if (c.v === '' || c.v == null) return `<Cell${style}${merge}/>`;
          const type = typeof c.v === 'number' ? 'Number' : 'String';
          return `<Cell${style}${merge}><Data ss:Type="${type}">${esc(c.v)}</Data></Cell>`;
        })
        .join('');
      return `<Row${height}>${cells}</Row>`;
    })
    .join('\n');
  return `<Worksheet ss:Name="${esc(sheet.name)}"><Table>${cols}${rows}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><PageSetup><Layout x:Orientation="Landscape"/></PageSetup><FitToPage/><Print><ValidPrinterInfo/><PaperSizeIndex>9</PaperSizeIndex><Scale>60</Scale></Print></WorksheetOptions></Worksheet>`;
}

function buildXmlXls(sheets) {
  const usedNames = new Set();
  const safe = sheets.map((s, i) => {
    let n = String(s.name || `Sheet${i + 1}`).replace(/[\\/?*\[\]:]/g, '_').slice(0, 28);
    while (usedNames.has(n)) n = n + '_';
    usedNames.add(n);
    return { ...s, name: n };
  });
  return Buffer.from(XML_HEAD + safe.map(xmlSheet).join('\n') + '</Workbook>', 'utf8');
}

/* ------------------------------------------------------------------ */
/* 组装导出包                                                          */
/* ------------------------------------------------------------------ */

/**
 * 生成导出所需的全部工作表定义
 * @param {object} ctx {config, groups, members, dates, slots, attMap}
 */
function buildSheets(ctx) {
  const { config, groups, members, dates, slots, attMap } = ctx;
  const sheets = [];
  sheets.push(buildOverviewSheet(ctx));
  sheets.push(buildDailySheet(ctx));
  for (const g of groups) {
    const gm = members.filter((m) => (m.groupIds || [m.primaryGroupId]).includes(g.id));
    if (!gm.length) continue;
    sheets.push(buildGroupSheet({ ...ctx, group: g, members: gm }));
  }
  sheets.push(buildReadmeSheet(ctx));
  return sheets;
}

function exportXlsx(ctx) {
  return buildXlsx(buildSheets(ctx));
}

function exportXmlXls(ctx) {
  return buildXmlXls(buildSheets(ctx));
}

module.exports = { STATUS, buildSheets, buildXlsx, buildXmlXls, exportXlsx, exportXmlXls, colName, weekdayCN };
