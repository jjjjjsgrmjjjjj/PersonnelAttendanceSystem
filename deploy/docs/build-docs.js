/**
 * 生成《示例影像部 · 运动会考勤系统 使用手册》的 Markdown 与 Word(.docx) 两份文件。
 * 内容只有一个数据源（BLOCKS），保证两种格式完全一致。
 *
 *   node deploy/docs/build-docs.js
 */
const fs = require('fs');
const path = require('path');
const { zipSync } = require(path.join(__dirname, '..', '..', 'src', 'zip.js'));
const { APP_VERSION } = require(path.join(__dirname, '..', '..', 'src', 'version.js'));

const ROOT = path.join(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'docs');
const BASENAME = '示例考勤系统使用手册';

/* ---------------- 文档内容（唯一数据源） ---------------- */
const H = (level, text) => ({ t: 'h', level, text });
const P = (text) => ({ t: 'p', text });
const UL = (items) => ({ t: 'ul', items });
const OL = (items) => ({ t: 'ol', items });
const TABLE = (head, rows) => ({ t: 'table', head, rows });

const BLOCKS = [
  H(1, '示例影像部 · 运动会考勤系统 使用手册'),
  P('示例中学新媒体中心示例影像部 2026 年秋季第 40 届田径运动会人员分工与考勤记录。'),
  P('系统分网页端（浏览器）和手机 App（安卓）两种用法，数据完全相通：用哪个填、用哪个看都可以，改动会自动保存并由服务器统一保存。'),
  P(`当前版本：${APP_VERSION}`),

  H(2, '一、访问方式'),
  H(3, '1. 网页端'),
  UL([
    '在电脑或手机浏览器打开：https://example.com',
    '推荐浏览器：电脑用 Chrome / Edge；手机用系统自带浏览器或 Chrome。',
    '首次打开需要输入账号密码；勾选"记住账号和密码"后，这台设备下次打开会自动填好。',
  ]),
  H(3, '2. 手机 App（安卓）'),
  UL([
    '安装包下载：https://example.com/download/activity-kaoqin.apk（手机浏览器打开即下载）。',
    '也可以直接扫管理员发的二维码/安装包，版本号见文件名旁显示。',
    '支持安卓 7.0 及以上；安装时如提示"未知来源"，选择"允许安装"即可。',
    'App 打开后直接进入登录页，服务器地址已内置，无需填写。',
  ]),

  H(2, '二、账号与权限'),
  P('账号和密码由管理员分配，一人一个账号，不要互相借用。'),
  TABLE(['账号类型', '能填写', '能查看', '能设置'], [
    ['管理员', '全部 9 个组', '全部统计', '活动日期、时段、标题，导出，重置密码，操作日志'],
    ['各组组长', '只限本人负责的组', '全部组的统计', '不能'],
  ]),
  P('注意：'),
  UL([
    '初次登录必须修改密码（至少 6 位），改完才能填报考勤。',
    '组长只能修改自己负责的组，越权修改会被服务器拒绝。',
    '忘记密码请联系管理员重置，或由管理员在服务器执行：node tools/reset-password.js 账号名',
  ]),

  H(2, '三、考勤填报（最常用）'),
  H(3, '1. 界面说明'),
  UL([
    '顶部左侧是系统名称，右侧显示"已同步"状态、当前账号、"修改密码""退出"。',
    '标签页：考勤填报 / 统计分析 / 系统设置（仅管理员可见）。',
    '日期：默认 2026-09-28、2026-09-29、2026-09-30 三天，点顶部"日期"里的按钮切换。',
    '表格：每人一行，每个半小时一列（07:00–18:00，每天 22 格）。',
  ]),
  H(3, '2. 标记出勤状态'),
  P('先在页面上方「标记」里点选要用的状态（出勤/迟到/缺勤/请假/清除，被选中的会高亮，默认出勤）。'),
  P('再点要记录的那个格子，就标成刚才选的状态；可以连续点多个格子。电脑上也可以用数字键 1/2/3/4/0 直接标选中的格子。'),
  P('五种状态的含义：'),
  TABLE(['符号', '含义', '颜色'], [
    ['出', '出勤', '绿'],
    ['迟', '迟到', '黄'],
    ['缺', '缺勤', '红'],
    ['假', '请假（已批准）', '蓝'],
    ['空', '未记录', '白'],
  ]),
  P('电脑快捷键（先用鼠标点一个格子选中）：'),
  UL([
    '1 = 出勤，2 = 迟到，3 = 缺勤，4 = 请假，0 或 Delete = 清除',
    '方向键：上下左右移动选中的格子',
    'Shift + 点击：直接标成"标记"栏里当前选中的状态',
  ]),
  H(3, '3. 写备注与替岗人员'),
  P('电脑上：在格子上点右键；手机上：长按格子约半秒，会弹出对话框。'),
  UL([
    '在对话框里填写备注（迟到时间、离岗原因、请假事由）和替岗人员，点保存。',
    '有备注的格子右上角会出现红点，一眼就能看到。',
    '表格最右侧两列"备注""替岗人员"也可以直接输入，效果一样。',
  ]),
  H(3, '4. 整行 / 整列快速标记'),
  UL([
    '先点一个格子（确定是哪一行或哪一时段），再点"本行全部出勤"或"本时段全部出勤"。',
    '适合整组人全天出勤的情况，比一格一格点快很多。',
  ]),
  H(3, '5. 只看某个组'),
  P('用"只看"下拉框选分组，或勾选"只显示我负责的组"，表格只显示相关人员，避免看错行。'),
  H(3, '6. 现场备注 / 待办'),
  P('填报页下方可以按日期添加临时事项，例如"15:30 无人机换电池"。添加后会保存在服务器，所有人可见，处理完可勾选划掉或删除。'),
  H(3, '7. 自动保存'),
  P('所有改动都会自动保存，右下角显示"已保存 时间"。不需要点保存按钮。如果显示保存失败，请检查网络后重试这一次修改。'),

  H(2, '四、导出 Excel（仅管理员）'),
  P('在页面顶部右侧点"导出 Excel（.xlsx）"，会弹出"导出范围"窗口；选好范围后点"开始导出"，文件立即开始下载。'),
  P('导出范围可以分别选择，每一项都有"全部"选项：'),
  UL([
    '日期：全部（默认）或某一天，如 2026-09-28。',
    '时段：全部（默认）或某几个半小时时段，如只导出 15:00-15:30。',
    '组别：全部（默认）或其中一个组，如只导出径赛组。',
    '勾选"用 .xls 格式"：导出给老版本 Excel / WPS 用的格式。',
  ]),
  UL([
    '导出的是最新数据（会先把未保存的改动提交），且只包含所选范围内的日期、时段和组别。',
    '文件名格式：示例考勤表-选中日期-选中时段-组别-导出日期时间-导出用户名，例如 示例考勤表-0928-0930-全部-全部-20260928-153012-admin.xlsx。',
    '文件在服务器上保留 10 分钟，之后自动删除；下载到自己电脑/手机的那份不受影响。',
  ]),
  P('导出的表格共 12 张工作表：'),
  TABLE(['工作表', '内容'], [
    ['考勤总览', '一人一行，出勤/迟到/缺勤/请假人次、出勤率、工作小时（出勤+迟到，半小时计 0.5 小时）、备注'],
    ['各时段统计', '每个半小时的已记录人数、缺勤人数、各组在场人数'],
    ['各组明细（9 张）', '每组一张，表头是日期与时段，右侧是备注和替岗记录，底部有本组统计（含工作小时合计）和签字行'],
    ['说明', '符号含义与各组人数'],
  ]),
  P('手机 App 里点导出后，文件会保存到手机的"下载"文件夹，可在通知栏查看进度；下载完成后 App 会自动跳到该文件。'),
  P('电脑浏览器如果没自动下载，请检查是否被浏览器拦下了下载请求，允许后重试。'),

  H(2, '五、查看统计分析'),
  P('切到"统计分析"标签页，可以看全部组的汇总（每位登录用户都能看）：'),
  UL([
    '按人员：每人出勤/迟到/缺勤/请假次数与出勤率。',
    '按时段：每个半小时有多少人记录、多少人缺勤。',
  ]),
  P('总负责人和组长都可以用这个页面对照检查，发现漏填及时补。'),

  H(2, '六、系统设置（仅管理员）'),
  UL([
    '修改表格标题、单位名称、副标题。',
    '修改活动日期（每行一个，格式 2026-09-28）。',
    '修改半小时时段（每行一个，格式 07:00-07:30），也可点"按 7:00–18:00 重新生成时段"。',
    '账号与权限：查看账号列表、重置某人的密码（重置后对方首次登录必须改密码）。',
    '操作日志：查看谁在什么时候改了什么。',
  ]),
  P('保存设置后所有人刷新页面即可看到新设置。'),

  H(2, '七、手机 App 使用说明'),
  H(3, '1. 安装'),
  UL([
    '把示例考勤.apk 传到手机上（微信、QQ、网盘、数据线均可），点开安装。',
    '首次安装需在系统设置里允许"安装未知应用"；装完可以关掉这个开关。',
  ]),
  H(3, '2. 使用'),
  UL([
    '打开 App 就是登录页，账号密码与网页端一致。',
    '填表方式与网页端完全相同：先选上方状态、再点格子标记；长按格子填备注和替岗人员。',
    '按手机返回键会先返回网页上一页，在系统首页再按一次才退出。',
    '导出：点"导出 Excel（.xlsx）"后自动下载，完成后在"下载"文件夹或通知栏里打开。',
  ]),
  H(3, '3. 换服务器地址（进阶）'),
  P('如遇服务器地址变更：在 App 里双击顶部标题栏（连点两下最上面那行标题），会弹出"服务器地址"对话框，填入新地址后点"保存并重开"即可；误改了可以点"恢复默认"，不需要重新安装。'),
  P('长按格子仍是填写备注与替岗；这两个手势不冲突：长按格子填备注，双击标题栏改地址。'),

  H(2, '八、常见问题'),
  TABLE(['现象', '处理办法'], [
    ['打开提示打不开考勤系统', '检查手机是否联网；下拉重试；确认网址或 App 无误'],
    ['登录提示账号或密码不正确', '确认账号是姓名全拼小写（如 leader8）；忘记密码找管理员重置'],
    ['提示"请先修改初始密码"', '点右上角"修改密码"，改完即可填报'],
    ['点了格子没反应/改了没保存', '检查网络；右下角显示保存失败时，重新点一次格子'],
    ['某组格子是灰的、点不动', '该组不归你负责，需要管理员或对应组长填'],
    ['导出的文件打不开', '换"导出 .xls"再试；或换一台电脑下载'],
    ['手机上表格很小', '表格可以左右滑动；把手机横过来看效果更好'],
    ['App 里长按格子没反应', '请更新到最新版 App（长按格子=备注，双击标题栏=改地址）'],
    ['想看 App 版本', '安装包文件名或导出按钮右侧显示的 v1.3.2 即为版本号'],
  ]),

  H(2, '九、注意事项'),
  UL([
    '请假、缺勤务必在备注里写清原因，导出的正式表格会带上，方便事后核对。',
    '建议运动会期间每天结束后导出一次留存，导出文件即可存档、可打印。',
    '所有人填的是同一份数据，改动实时共享，请勿随意清空他人记录。',
    '数据由服务器统一保存，日常备份由管理员负责（每天备份数据库文件）。',
  ]),
  P('—— 手册结束 ——'),
];

/* ---------------- Markdown ---------------- */
function toMarkdown(blocks) {
  const out = [];
  for (const b of blocks) {
    if (b.t === 'h') {
      out.push(`${'#'.repeat(b.level)} ${b.text}`, '');
    } else if (b.t === 'p') {
      out.push(b.text, '');
    } else if (b.t === 'ul') {
      b.items.forEach((i) => out.push(`- ${i}`));
      out.push('');
    } else if (b.t === 'ol') {
      b.items.forEach((i, n) => out.push(`${n + 1}. ${i}`));
      out.push('');
    } else if (b.t === 'table') {
      out.push(`| ${b.head.join(' | ')} |`);
      out.push(`| ${b.head.map(() => '---').join(' | ')} |`);
      b.rows.forEach((r) => out.push(`| ${r.join(' | ')} |`));
      out.push('');
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

/* ---------------- Word (.docx) ---------------- */
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function run(text) {
  return `<w:r><w:rPr><w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/><w:sz w:val="21"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function para(text, style) {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${pPr}${run(text)}</w:p>`;
}

function heading(text, level) {
  return `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr>${run(text)}</w:p>`;
}

function listItem(text, num) {
  // 用项目符号字符模拟列表，避免依赖 numbering.xml
  const bullet = num ? `${num}. ` : '• ';
  return `<w:p><w:pPr><w:ind w:left="420" w:hanging="240"/></w:pPr>${run(bullet + text)}</w:p>`;
}

function table(head, rows) {
  const borders =
    '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="CCD6E0"/>`)
      .join('') +
    '</w:tblBorders>';
  const cell = (text, bold) =>
    `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p><w:pPr>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}</w:pPr>${run(text)}</w:p></w:tc>`;
  const headRow = `<w:tr>${head.map((h) => cell(h, true)).join('')}</w:tr>`;
  const bodyRows = rows.map((r) => `<w:tr>${r.map((c) => cell(c, false)).join('')}</w:tr>`).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${borders}</w:tblPr>${headRow}${bodyRows}</w:tbl><w:p/>`;
}

function toDocumentXml(blocks) {
  const body = blocks
    .map((b) => {
      if (b.t === 'h') return heading(b.text, Math.min(b.level, 3));
      if (b.t === 'p') return para(b.text);
      if (b.t === 'ul') return b.items.map((i) => listItem(i, 0)).join('');
      if (b.t === 'ol') return b.items.map((i, n) => listItem(i, n + 1)).join('');
      if (b.t === 'table') return table(b.head, b.rows);
      return '';
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;
}

function stylesXml() {
  const font = '<w:rFonts w:ascii="Microsoft YaHei" w:eastAsia="Microsoft YaHei" w:hAnsi="Microsoft YaHei"/>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>${font}<w:sz w:val="21"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:spacing w:before="240" w:after="180"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr>${font}<w:b/><w:sz w:val="36"/><w:color w:val="0F2B46"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:spacing w:before="240" w:after="140"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr>${font}<w:b/><w:sz w:val="28"/><w:color w:val="0F2B46"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:spacing w:before="180" w:after="120"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr>${font}<w:b/><w:sz w:val="24"/><w:color w:val="1B4570"/></w:rPr></w:style>
</w:styles>`;
}

function toDocx(blocks) {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  return zipSync([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'word/document.xml', data: toDocumentXml(blocks) },
    { name: 'word/_rels/document.xml.rels', data: docRels },
    { name: 'word/styles.xml', data: stylesXml() },
  ]);
}

/* ---------------- 输出 ---------------- */
fs.mkdirSync(OUT_DIR, { recursive: true });
const mdPath = path.join(OUT_DIR, `${BASENAME}.md`);
const docxPath = path.join(OUT_DIR, `${BASENAME}.docx`);
fs.writeFileSync(mdPath, toMarkdown(BLOCKS), 'utf8');
fs.writeFileSync(docxPath, toDocx(BLOCKS));
console.log(`已生成：\n  ${mdPath}\n  ${docxPath}`);
console.log(`  Markdown ${fs.statSync(mdPath).size} 字节 / Word ${fs.statSync(docxPath).size} 字节`);
