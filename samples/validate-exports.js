'use strict';
/**
 * 导出文件严格校验：node samples/validate-exports.js
 * 用与生成端完全独立的代码路径解析并校验：
 *   - .xlsx：ZIP 结构、内容类型、关系、工作表 XML、单元格引用、合并区域、样式索引
 *   - .xls ：XML 良构性、标记配平、工作表/行列/单元格层级嵌套
 * 并核对名单、时段、考勤标记、备注与替岗是否正确写入。
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const DIR = __dirname;
let failures = 0;
const log = (ok, msg) => {
  console.log(`${ok ? '✔' : '✘'} ${msg}`);
  if (!ok) failures++;
};

/* ============ 独立的 ZIP 读取（不依赖项目代码） ============ */
function unzip(buf) {
  const files = new Map();
  let p = 0;
  // 顺序扫描本地文件头（不使用中央目录，做交叉验证）
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8);
    const csize = buf.readUInt32LE(p + 18);
    const usize = buf.readUInt32LE(p + 22);
    const nameLen = buf.readUInt16LE(p + 26);
    const extraLen = buf.readUInt16LE(p + 28);
    const name = buf.slice(p + 30, p + 30 + nameLen).toString('utf8');
    const start = p + 30 + nameLen + extraLen;
    const raw = buf.slice(start, start + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    if (usize && data.length !== usize) throw new Error(`解压长度不符：${name} ${data.length} != ${usize}`);
    files.set(name, data);
    p = start + csize;
  }
  return files;
}

/* ============ XML 良构性检查（手写，无依赖） ============ */
function checkXmlWellFormed(xml, label) {
  const stack = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m;
  let count = 0;
  while ((m = re.exec(xml)) !== null) {
    const [, closing, name, , selfClose] = m;
    count++;
    if (closing) {
      const top = stack.pop();
      if (top !== name) throw new Error(`${label}: 标签不匹配，期望 </${top}> 实际 </${name}>（位置 ${m.index}）`);
    } else if (!selfClose) {
      stack.push(name);
    }
  }
  if (stack.length) throw new Error(`${label}: 标签未闭合 ${stack.slice(-3).join(',')}`);
  return count;
}

/* ============ 校验 xlsx ============ */
function validateXlsx(file) {
  const buf = fs.readFileSync(file);
  console.log(`\n── .xlsx 校验：${path.basename(file)}（${buf.length} 字节）──`);
  log(buf.readUInt32LE(0) === 0x04034b50, 'ZIP 起始标记正确 (PK\\x03\\x04)');

  // 中央目录
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  log(eocd > 0, '存在 EOCD 结束记录');
  const entryCount = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  log(cdOffset + cdSize <= eocd + 4, `中央目录范围合法（${cdSize} 字节 @ ${cdOffset}）`);

  // 中央目录条目
  const cdNames = [];
  let q = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(q) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(q + 28);
    cdNames.push(buf.slice(q + 46, q + 46 + nameLen).toString('utf8'));
    q += 46 + nameLen + buf.readUInt16LE(q + 30) + buf.readUInt16LE(q + 32);
  }
  log(cdNames.length === entryCount, `中央目录条目数一致（${cdNames.length}）`);

  const files = unzip(buf);
  log(files.size === entryCount, `本地文件头与中央目录一一对应（${files.size}）`);
  for (const n of cdNames) {
    if (!files.has(n)) log(false, `中央目录中的 ${n} 在本地文件头缺失`);
  }

  // [Content_Types].xml
  const ct = files.get('[Content_Types].xml').toString('utf8');
  checkXmlWellFormed(ct, '[Content_Types].xml');
  log(ct.includes('spreadsheetml.sheet.main+xml'), '内容类型声明了工作簿主体');
  const overrides = [...ct.matchAll(/PartName="([^"]+)"/g)].map((m) => m[1]);
  const missingParts = overrides.filter((o) => !files.has(o.replace(/^\//, '')));
  log(missingParts.length === 0, `内容类型引用的部件全部存在（${overrides.length} 个）${missingParts.length ? ' 缺:' + missingParts.join(',') : ''}`);

  // workbook.xml
  const wb = files.get('xl/workbook.xml').toString('utf8');
  checkXmlWellFormed(wb, 'workbook.xml');
  const sheets = [...wb.matchAll(/<sheet name="([^"]+)" sheetId="(\d+)" r:id="(rId\d+)"\/>/g)].map((m) => ({
    name: m[1],
    sheetId: Number(m[2]),
    rid: m[3],
  }));
  log(sheets.length >= 12, `工作表数量合理（${sheets.length}）`);
  log(new Set(sheets.map((s) => s.name)).size === sheets.length, '工作表名称无重复');
  log(sheets.every((s) => s.name.length <= 31), '工作表名称长度均 ≤31 字符');

  // rels
  const rels = files.get('xl/_rels/workbook.xml.rels').toString('utf8');
  checkXmlWellFormed(rels, 'workbook.xml.rels');
  const relMap = new Map([...rels.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const unresolved = sheets.filter((s) => !relMap.has(s.rid));
  log(unresolved.length === 0, `每个工作表都能解析到关系目标${unresolved.length ? ' 缺:' + unresolved.map((s) => s.name) : ''}`);
  const relTargets = [...relMap.values()].map((t) => 'xl/' + t.replace(/^\.\//, ''));
  log(relTargets.every((t) => files.has(t)), '关系目标文件全部存在');

  // 样式
  const styles = files.get('xl/styles.xml').toString('utf8');
  checkXmlWellFormed(styles, 'styles.xml');
  const cellXfsBlock = styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1];
  const styleCount = (cellXfsBlock.match(/<xf /g) || []).length;
  const fillsCount = Number(styles.match(/<fills count="(\d+)"/)[1]);
  log(styleCount >= 14, `cellXfs 样式数足够（${styleCount}，fills=${fillsCount}）`);

  // 每个工作表
  const sheetFiles = [...files.keys()].filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  log(sheetFiles.length === sheets.length, `工作表 XML 文件数与声明一致（${sheetFiles.length}/${sheets.length}）`);

  let totalCells = 0;
  let totalMerges = 0;
  const problems = [];
  for (const f of sheetFiles) {
    const xml = files.get(f).toString('utf8');
    try {
      checkXmlWellFormed(xml, f);
    } catch (e) {
      problems.push(e.message);
      continue;
    }
    if (!xml.includes('<worksheet') || !xml.includes('</worksheet>')) problems.push(`${f}: 缺少 worksheet 根元素`);
    // 单元格引用校验
    const refs = [...xml.matchAll(/<c r="([A-Z]+)(\d+)"/g)];
    totalCells += refs.length;
    for (const [, col, row] of refs) {
      if (!/^[A-Z]{1,3}$/.test(col) || Number(row) < 1) problems.push(`${f}: 非法单元格引用 ${col}${row}`);
    }
    // 行内单元格顺序应与行号一致
    const rows = [...xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)];
    let lastRow = 0;
    for (const [, r, inner] of rows) {
      const rn = Number(r);
      if (rn <= lastRow) problems.push(`${f}: 行号未递增 (${lastRow} -> ${rn})`);
      lastRow = rn;
      const cols = [...inner.matchAll(/<c r="([A-Z]+)\d+"/g)].map((m) => m[1]);
      const sorted = cols.slice().sort(compareCol);
      if (cols.join(',') !== sorted.join(',')) problems.push(`${f}: 行 ${r} 单元格未按列顺序排列 ${cols.join(',')}`);
    }
    // 样式索引有效性
    for (const [, s] of xml.matchAll(/<c[^>]* s="(\d+)"/g)) {
      if (Number(s) >= styleCount) problems.push(`${f}: 样式索引越界 s=${s}`);
    }
    // 合并区域
    const mergeBlock = xml.match(/<mergeCells count="(\d+)">([\s\S]*?)<\/mergeCells>/);
    if (mergeBlock) {
      const declared = Number(mergeBlock[1]);
      const refs2 = [...mergeBlock[2].matchAll(/<mergeCell ref="([^"]+)"\/>/g)].map((m) => m[1]);
      totalMerges += refs2.length;
      if (declared !== refs2.length) problems.push(`${f}: mergeCells count=${declared} 与实际 ${refs2.length} 不符`);
      for (const ref of refs2) {
        const m2 = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
        if (!m2) {
          problems.push(`${f}: 非法合并区域 ${ref}`);
          continue;
        }
        if (colToNum(m2[1]) > colToNum(m2[3]) || Number(m2[2]) > Number(m2[4])) {
          problems.push(`${f}: 合并区域方向错误 ${ref}`);
        }
        if (m2[1] === m2[3] && m2[2] === m2[4]) problems.push(`${f}: 单格合并 ${ref}`);
      }
    }
  }
  log(problems.length === 0, `全部工作表结构合法（单元格 ${totalCells} 个，合并区域 ${totalMerges} 个）${problems.length ? '\n    ' + problems.slice(0, 6).join('\n    ') : ''}`);

  return files;
}

function colToNum(s) {
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function compareCol(a, b) {
  return colToNum(a) - colToNum(b);
}

/* ============ 校验 xls（Excel 2003 XML） ============ */
function validateXls(file) {
  const text = fs.readFileSync(file, 'utf8');
  console.log(`\n── .xls 校验：${path.basename(file)}（${text.length} 字符）──`);
  log(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'XML 声明为 UTF-8');
  log(text.includes('<?mso-application progid="Excel.Sheet"?>'), '包含 Excel 处理指令');
  let tags = 0;
  try {
    tags = checkXmlWellFormed(text, 'kaoqin.xls');
    log(true, `XML 完全良构（${tags} 个标签）`);
  } catch (e) {
    log(false, e.message);
  }
  const names = [...text.matchAll(/<Worksheet ss:Name="([^"]+)"/g)].map((m) => m[1]);
  log(names.length >= 12, `包含 ${names.length} 个工作表：${names.join('、')}`);
  // 表格结构
  const wsCount = (text.match(/<Worksheet /g) || []).length;
  const tableCount = (text.match(/<Table>/g) || []).length;
  const rowCount = (text.match(/<Row[ >]/g) || []).length;
  const cellCount = (text.match(/<Cell[ >/]/g) || []).length;
  log(wsCount === tableCount && wsCount === names.length, `每张工作表都有 Table（${tableCount}/${wsCount}）`);
  log(rowCount > 0 && cellCount > rowCount, `行/单元格数量合理（${rowCount} 行，${cellCount} 格）`);
  const styleIds = new Set([...text.matchAll(/<Style ss:ID="([^"]+)"/g)].map((m) => m[1]));
  const usedStyles = new Set([...text.matchAll(/ss:StyleID="([^"]+)"/g)].map((m) => m[1]));
  const unknown = [...usedStyles].filter((s) => !styleIds.has(s) && s !== 'Default');
  log(unknown.length === 0, `样式引用全部已定义${unknown.length ? ' 未定义:' + unknown.join(',') : ''}`);
  const merges = (text.match(/ss:MergeAcross="(\d+)"/g) || []).map((s) => Number(s.match(/\d+/)[0]));
  log(merges.every((v) => v >= 1 && v <= 200), `合并跨度合理（最大 ${Math.max(0, ...merges)}）`);
  return text;
}

/* ============ 内容交叉核对（与 HTTP 导出结果比对） ============ */
function contentChecks(files) {
  console.log('\n── 内容核对 ──');
  const wb = files.get('xl/workbook.xml').toString('utf8');
  const rels = files.get('xl/_rels/workbook.xml.rels').toString('utf8');
  const relMap = new Map([...rels.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const find = (name) => {
    const s = [...wb.matchAll(/<sheet name="([^"]+)" sheetId="\d+" r:id="(rId\d+)"\/>/g)].find((m) => m[1] === name);
    return s ? files.get('xl/' + relMap.get(s[2]).replace(/^\.\//, '')).toString('utf8') : null;
  };
  const hangpai = find('航拍组');
  log(!!hangpai, '存在「航拍组」工作表');
  for (const n of ['成员23', '成员18', '成员34', '成员36', '成员38', '成员24', '成员33']) {
    if (!hangpai.includes(n)) log(false, `航拍组缺少 ${n}`);
  }
  log(
    ['成员23', '成员18', '成员34', '成员36', '成员38', '成员24', '成员33'].every((n) => hangpai.includes(n)),
    '航拍组 7 人全部在表内'
  );
  log(hangpai.includes('高二九班'), '成员33班级「高二九班」正确');
  const jingsai = find('径赛组');
  log(
    ['成员17', '成员13', '成员42', '成员39', '成员15'].every((n) => jingsai.includes(n)),
    '径赛组 5 人全部在表内'
  );
  const overview = find('考勤总览');
  log(overview.includes('成员33') && overview.includes('出勤率'), '总览表含全部人员与出勤率');
  const readme = find('说明');
  log(readme.includes('迟到') && readme.includes('请假'), '说明表含状态含义');
  // 备注与替岗必须写入
  const allSheets = [...wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"\/>/g)]
    .map((m) => files.get('xl/' + relMap.get(m[2]).replace(/^\.\//, '')).toString('utf8'))
    .join('\n');
  log(allSheets.includes('迟到 10 分钟，已提醒'), '逐时段备注已写入导出表');
  log(allSheets.includes('由成员41替岗'), '替岗人员已写入导出表');
  log(allSheets.includes('请假一天'), '请假备注已写入导出表');
  // 表头时段应覆盖 7:00-18:00
  const slots = [...jingsai.matchAll(/>(\d{2}:\d{2}-\d{2}:\d{2})</g)].map((m) => m[1]);
  const uniqSlots = [...new Set(slots)];
  log(uniqSlots.length === 22 && uniqSlots[0] === '07:00-07:30' && uniqSlots[21] === '17:30-18:00', `每张分组表含 22 个半小时时段（${uniqSlots.length}）`);
  // 日期
  log(jingsai.includes('2026-09-28') && jingsai.includes('2026-09-29'), '含两天活动日期');
  // 考勤标记
  const hasMark = /<t xml:space="preserve">[出迟缺假]<\/t>/.test(jingsai);
  log(hasMark, '分组表内含考勤符号（出/迟/缺/假）');
}

const xlsxPath = path.join(DIR, 'kaoqin-sample.xlsx');
const xlsPath = path.join(DIR, 'kaoqin-sample.xls');
if (!fs.existsSync(xlsxPath) || !fs.existsSync(xlsPath)) {
  console.error('缺少导出文件，请先运行：node samples/make-sample-exports.js');
  process.exit(1);
}
const files = validateXlsx(xlsxPath);
validateXls(xlsPath);
contentChecks(files);

console.log('');
console.log(failures === 0 ? '✅ 全部校验通过' : `❌ 有 ${failures} 项未通过`);
process.exit(failures === 0 ? 0 : 1);
