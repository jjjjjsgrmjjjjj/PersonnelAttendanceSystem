'use strict';
/* 示例影像部 · 运动会考勤系统 前端 */

const STATUS_CYCLE = ['unmarked', 'present', 'late', 'absent', 'leave'];
const STATUS_LABEL = { present: '出勤', late: '迟到', absent: '缺勤', leave: '请假', unmarked: '未记录' };
const STATUS_SHORT = { present: '出', late: '迟', absent: '缺', leave: '假', unmarked: '' };
const WRITE_LOCKED = (ctx) => !ctx || !ctx.user || !!ctx.user.mustChange;
/** "记住账号和密码"存本地（仅个人设备用，勿在公用电脑勾选） */
const REMEMBER_KEY = 'kaoqin.rememberUser';
const REMEMBER_PWD_KEY = 'kaoqin.rememberPwd';
const keep = (v) => btoa(unescape(encodeURIComponent(v)));
const unkeep = (v) => {
  try {
    return decodeURIComponent(escape(atob(v)));
  } catch {
    return '';
  }
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  user: null,
  ctx: null,
  date: null,
  att: new Map(), // key -> {status,note,substitute,updatedAt}
  dirty: new Map(), // key -> change
  saveTimer: null,
  saving: false,
  selected: null, // {memberId,date,slot}
  groupFilter: '',
  onlyMine: false,
  statsView: 'member',
  stats: null,
};

/* ---------------- 工具 ---------------- */
function keyOf(memberId, date, slot) {
  return `${memberId}|${date}|${slot}`;
}
function getAtt(memberId, date, slot) {
  return state.att.get(keyOf(memberId, date, slot));
}
function toast(msg, isError) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.hidden = true), isError ? 4200 : 2200);
}
function weekdayCN(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()] || '';
}
function setSaveState(cls, text) {
  const el = $('#save-state');
  el.className = 'save-state' + (cls ? ' ' + cls : '');
  el.textContent = text;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 200) };
    }
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `请求失败（${res.status}）`);
    err.status = res.status;
    throw err;
  }
  return data || {};
}

/* ---------------- 主题（默认跟随系统） ---------------- */
const THEME_KEY = 'kaoqin.theme';

function systemDark() {
  // 1) App 原生桥最准（WebView 的 prefers-color-scheme 在部分机型不生效）
  try {
    if (window.kaoqinNative && typeof window.kaoqinNative.isSystemDark === 'function') {
      return !!window.kaoqinNative.isSystemDark();
    }
  } catch (e) {}
  // 2) App 通过注入同步过来的标志
  if (typeof window.__SYSTEM_DARK__ === 'boolean') return window.__SYSTEM_DARK__;
  // 浏览器：用系统媒体查询
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

function applyTheme(mode) {
  const m = mode || localStorage.getItem(THEME_KEY) || 'auto';
  const dark = m === 'dark' || (m === 'auto' && systemDark());   // auto 时跟随系统
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { if (state.ctx && state.ctx.members && renderGrid) renderGrid(); } catch (e) {}
  document.documentElement.dataset.themeMode = m;
  const icon = m === 'auto' ? '◐' : (m === 'dark' ? '☾' : '☀');
  const label = m === 'auto' ? '跟随系统' : (m === 'dark' ? '深色' : '浅色');
  $$('#theme-btn').forEach((el) => {
    el.textContent = icon;
    el.title = '当前：' + label + '（点击切换 跟随系统 / 深色 / 浅色）';
    el.setAttribute('aria-label', '主题：' + label);
  });
}

function cycleTheme() {
  if (typeof window.__cycleTheme === 'function' && window.__cycleTheme !== cycleTheme) return window.__cycleTheme();
  const cur = localStorage.getItem(THEME_KEY) || 'auto';
  const next = cur === 'auto' ? 'dark' : (cur === 'dark' ? 'light' : 'auto');
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
  toast('主题：' + (next === 'auto' ? '跟随系统' : (next === 'dark' ? '深色模式' : '浅色模式')));
}

window.__cycleTheme = cycleTheme;

window.__applyTheme = applyTheme;

function initTheme() {
  applyTheme();
  $$('#theme-btn').forEach((el) => { el.onclick = () => cycleTheme(); });
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((localStorage.getItem(THEME_KEY) || 'auto') === 'auto') applyTheme('auto');
    });
  }
}
/* ---------------- 登录 ---------------- */
async function boot() {
  bindGlobalEvents();
  initTheme();
  restoreRememberedUser();
  try {
    const data = await api('/api/me');
    onLoggedIn(data.user, data.context);
  } catch (e) {
    if (e.status === 401) showLogin();
    else {
      showLogin();
      toast(e.message, true);
    }
  }
}

/** 打开页面时回填上次记住的账号和密码 */
function restoreRememberedUser() {
  try {
    const savedUser = localStorage.getItem(REMEMBER_KEY);
    const savedPwd = localStorage.getItem(REMEMBER_PWD_KEY);
    if (!savedUser) return;
    const box = $('#login-remember');
    if (box) box.checked = true;
    const user = $('#login-username');
    if (user && !user.value) user.value = savedUser;
    const pwd = $('#login-password');
    if (pwd && savedPwd) pwd.value = unkeep(savedPwd);
  } catch {}
}

function showLogin() {
  const dlBtn = $('#btn-download-center');
  if (dlBtn) dlBtn.hidden = true;
  $('#view-login').hidden = false;
  $('#view-app').hidden = true;
}

function onLoggedIn(user, ctx) {
  state.user = user;
  state.ctx = ctx;
  if (ctx && !ctx.user) ctx.user = user;   // 兜底：保证 ctx.user 一定存在
  state.date = ctx.dates[0] || null;
  state.att.clear();
  state.dirty.clear();
  state.stats = null;
  $('#view-login').hidden = true;
  $('#view-app').hidden = false;
  $('#app-title').textContent = ctx.title || '考勤系统';
  $('#app-sub').textContent = `${ctx.org || ''}　${ctx.dates.join('、')}`;
  $('#whoami').textContent = `${user.display}${user.isAdmin ? '（管理员）' : ''}`;
  $('#tab-admin').hidden = !user.isAdmin;
  renderMarkButtons();
  const dlBtn = $('#btn-download-center');
  if (dlBtn) dlBtn.hidden = false;
  applyTheme();
  adminExportVisible(!!user.isAdmin);
  renderDateSwitch();
  renderGroupFilter();
  renderHint();
  renderReminders();
  showTab('fill');
  loadAttendance().then(() => {
    renderGrid();
    renderDayStats();
  });
  if (user.mustChange) {
    setTimeout(() => openPasswordDialog(true), 300);
  }
}

/* ---------------- 顶栏 / 标签 ---------------- */
function showTab(name) {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $('#tab-fill').hidden = name !== 'fill';
  $('#tab-stats').hidden = name !== 'stats';
  $('#tab-admin').hidden = name !== 'admin' || !state.user.isAdmin;
  if (name === 'stats') loadStats();
  if (name === 'admin') loadAdmin();
}

function renderHint() {
  const locked = WRITE_LOCKED(state.ctx);
  $('#fill-hint').innerHTML = locked
    ? '请先修改初始密码，修改后才能填报考勤。'
    : '先在上方「标记」里选状态（默认出勤），再点格子即标记；电脑数字键 <span class="k">1</span><span class="k">2</span><span class="k">3</span><span class="k">4</span><span class="k">0</span>，<span class="k">右键</span>或长按格子填备注；改动自动保存。';
}

/* ---------------- 日期 ---------------- */
function renderDateSwitch() {
  const box = $('#date-switch');
  box.innerHTML = '';
  for (const d of state.ctx.dates) {
    const b = document.createElement('button');
    b.className = 'seg' + (d === state.date ? ' active' : '');
    b.dataset.date = d;
    b.textContent = `${d} ${weekdayCN(d)}`;
    b.onclick = async () => {
      await flushSave();
      state.date = d;
      renderDateSwitch();
      await loadAttendance();
      renderGrid();
      renderDayStats();
      renderReminders();
    };
    box.appendChild(b);
  }
}

/* ---------------- 分组筛选 ---------------- */
function renderGroupFilter() {
  const sel = $('#group-filter');
  sel.innerHTML = '<option value="">全部分组</option>';
  for (const g of visibleGroups()) {
    const o = document.createElement('option');
    o.value = String(g.id);
    o.textContent = g.name;
    sel.appendChild(o);
  }
  sel.value = state.groupFilter;
}

function visibleGroups() {
  const owned = new Set(state.ctx.editableGroupIds);
  return state.ctx.groups.filter((g) => (state.user.isAdmin || state.onlyMine ? owned.has(g.id) : true));
}

/* ---------------- 数据加载 ---------------- */
async function loadAttendance() {
  const data = await api('/api/attendance' + (state.date ? `?date=${encodeURIComponent(state.date)}` : ''));
  state.att.clear();
  for (const r of data.records) {
    state.att.set(keyOf(r.memberId, r.date, r.slot), {
      status: r.status,
      note: r.note || '',
      substitute: r.substitute || '',
    });
  }
  state.dirty.clear();
  setSaveState('', '已同步');
}

/* ---------------- 保存 ---------------- */
function patch(member, date, slot, fields) {
  const key = keyOf(member.id, date, slot);
  const cur = state.att.get(key) || { status: 'unmarked', note: '', substitute: '' };
  const next = { ...cur, ...fields };
  // 清空状态时一并清掉备注与替岗（避免残留备注挂在空白格子上）
  if (next.status === 'unmarked' && fields && 'status' in fields) {
    next.note = '';
    next.substitute = '';
  }
  if (next.status === 'unmarked' && !next.note && !next.substitute) state.att.delete(key);
  else state.att.set(key, next);
  state.dirty.set(key, {
    memberId: member.id,
    date,
    slot,
    status: next.status || 'unmarked',
    note: next.note || '',
    substitute: next.substitute || '',
  });
  scheduleSave();
  updateCellElement(member.id, date, slot);
}

function scheduleSave() {
  setSaveState('saving', '保存中…');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => flushSave(), 700);
}

async function flushSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  if (state.saving || state.dirty.size === 0) return;
  const changes = [...state.dirty.values()];
  state.dirty.clear();
  state.saving = true;
  setSaveState('saving', '保存中…');
  try {
    const res = await api('/api/attendance', { method: 'POST', body: JSON.stringify({ changes }) });
    if (res.errors && res.errors.length) toast(res.errors[0], true);
    setSaveState('saved', '已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }));
    renderDayStats();
  } catch (e) {
    setSaveState('error', '保存失败');
    toast('保存失败：' + e.message, true);
    // 失败回滚到服务器状态
    await loadAttendance();
  } finally {
    state.saving = false;
    if (state.dirty.size) scheduleSave();
  }
}

/* ---------------- 网格渲染 ---------------- */
/** 分组行的组名：横向滚动时钉在最左（绕过 colspan 的 sticky 失效） */
let grpCells = [];
function collectGrpCells() {
  grpCells = [...document.querySelectorAll('#grid-body td[data-grp-name]')];
}
function pinGroupNames() {
  if (!grpCells.length) return;
  const wrap = document.querySelector('.grid-wrap');
  if (!wrap) return;
  const x = wrap.scrollLeft;
  for (const td of grpCells) {
    const left = td.getBoundingClientRect().left;
    const dx = Math.max(0, left - 0);
    td.style.setProperty('--grp-shift', dx + 'px');
  }
}

function renderGrid() {
  const ctx = state.ctx;
  const dates = state.date ? [state.date] : ctx.dates;
  const slots = ctx.slots;
  const head = $('#grid-head');
  const body = $('#grid-body');
  head.innerHTML = '';
  body.innerHTML = '';

  const colCount = 2 + dates.length * slots.length + 2;

  // 表头第一行
  const tr1 = document.createElement('tr');
  tr1.className = 'row-dates';
  const th1 = document.createElement('th');
  th1.className = 'col-name';
  th1.rowSpan = 2;
  th1.textContent = '姓名';
  const th2 = document.createElement('th');
  th2.className = 'col-class';
  th2.rowSpan = 2;
  th2.textContent = '班级';
  tr1.append(th1, th2);
  for (const d of dates) {
    const th = document.createElement('th');
    th.className = 'date-head';
    th.colSpan = slots.length;
    th.textContent = `${d} ${weekdayCN(d)}`;
    tr1.appendChild(th);
  }
  const thNote = document.createElement('th');
  thNote.rowSpan = 2;
  thNote.className = 'col-note';
  thNote.textContent = '备注（迟到时间 / 离岗原因 / 请假事由）';
  const thSub = document.createElement('th');
  thSub.rowSpan = 2;
  thSub.className = 'col-sub';
  thSub.textContent = '替岗人员';
  tr1.append(thNote, thSub);
  head.appendChild(tr1);

  // 表头第二行：时段
  const tr2 = document.createElement('tr');
  tr2.className = 'row-slots';
  for (const d of dates) {
    for (const s of slots) {
      const th = document.createElement('th');
      th.className = 'slot-head';
      th.textContent = s;
      tr2.appendChild(th);
    }
  }
  head.appendChild(tr2);

  // 表体
  const members = visibleMembers();
  const groups = visibleGroupsInUse(members);
  if (!members.length) {
    $('#grid-empty').hidden = false;
    renderDayStats();
    return;
  }
  $('#grid-empty').hidden = true;

  const editable = new Set(ctx.editableMemberIds);
  const grandTotal = { marked: 0, present: 0, late: 0, absent: 0, leave: 0 };

  for (const g of groups) {
    // 一人可能兼多个组：在每个归属组里都出现在自己那一行（考勤数据是同一份）
    const gm = members.filter((m) => (m.groupIds || []).includes(g.id));
    if (!gm.length) continue;
    const gr = document.createElement('tr');
    gr.className = 'grp-row';
    const td = document.createElement('td');
    td.colSpan = colCount;
    const responsible = ctx.editableGroupIds.includes(g.id);
    td.dataset.grpName = '1';
    td.innerHTML = `<span class="grp-fix">${escapeHtml(g.name)}<span class="grp-meta">${gm.length} 人${responsible ? '（您负责）' : ''}</span></span>`;
    gr.appendChild(td);
    body.appendChild(gr);

    const sorted = gm.slice().sort((x, y) => groupSortOf(x, g.id) - groupSortOf(y, g.id));
    for (const one of sorted) {
      body.appendChild(renderRow(one, dates, slots, editable.has(one.id), grandTotal, g));
    }
  }
  const ungrouped = members.filter(
    (m) => !groups.some((g) => g.id === m.primaryGroupId || (m.groupIds || []).includes(g.id))
  );
  if (ungrouped.length) {
    const gr = document.createElement('tr');
    gr.className = 'grp-row';
    const td = document.createElement('td');
    td.colSpan = colCount;
    td.innerHTML = `<span class="grp-fix">未分组 ${ungrouped.length} 人</span>`;
    gr.appendChild(td);
    body.appendChild(gr);
    for (const m of ungrouped) body.appendChild(renderRow(m, dates, slots, editable.has(m.id), grandTotal, null));
  }

  // 底部合计行
  const totalRow = document.createElement('tr');
  totalRow.className = 'stat-row';
  const label = document.createElement('td');
  label.colSpan = 2;
  label.textContent = '本日合计';
  totalRow.appendChild(label);
  for (const d of dates) {
    for (const s of slots) {
      const counts = countSlot(members, d, s);
      const tdCell = document.createElement('td');
      tdCell.className = 'sum-cell' + (counts.absent > 0 ? ' warn' : '');
      tdCell.textContent = counts.marked ? String(counts.marked) : '';
      tdCell.title = `${d} ${s}：已记录 ${counts.marked} 人，出勤 ${counts.present}，迟到 ${counts.late}，缺勤 ${counts.absent}，请假 ${counts.leave}`;
      totalRow.appendChild(tdCell);
    }
  }
  const tail = document.createElement('td');
  tail.colSpan = 2;
  tail.className = 'sum-cell';
  totalRow.appendChild(tail);
  body.appendChild(totalRow);
  collectGrpCells();
  pinGroupNames();
}

function visibleMembers() {
  const filter = state.groupFilter ? Number(state.groupFilter) : null;
  return state.ctx.members.filter((m) => {
    if (filter != null && !(m.groupIds || []).includes(filter)) return false;
    if (state.onlyMine) {
      const owned = new Set(state.ctx.editableGroupIds);
      return m.groupIds.some((g) => owned.has(g));
    }
    return true;
  });
}

function visibleGroupsInUse(members) {
  const ids = new Set(members.map((m) => m.primaryGroupId));
  const list = state.ctx.groups.filter((g) => ids.has(g.id));
  return list;
}

/** 组内排序：该组组长永远排第一，其余按组内原顺序（groupSort，缺省用主组 sort） */
function groupSortOf(m, gid) {
  const role = (m.groupRoles || {})[gid] || (m.groupRoles || {})[String(gid)] || '';
  if (role === '组长') return -100000;   // 组长置顶
  const gs = (m.groupSort || {})[gid] != null ? m.groupSort[gid] : (m.groupSort || {})[String(gid)];
  if (gs != null) return gs;
  return m.primaryGroupId === gid ? 0 : 10000;
}
function renderRow(m, dates, slots, canEdit, totals, currentGroup) {
  const tr = document.createElement('tr');
  tr.dataset.memberId = m.id;

  const nameTd = document.createElement('td');
  nameTd.className = 'col-name';
  const chips = [];
  // 当前所在组里的角色是组长就标[组长]（组级角色来自各组组长账号）
  const curGid = currentGroup ? currentGroup.id : m.primaryGroupId;
  const curRole = (m.groupRoles || {})[curGid] || (m.groupRoles || {})[String(curGid)] || '';
  if (m.role === '组长' || curRole === '组长') chips.push('<span class="tag leader">组长</span>');
  // 兼组标签：跳过当前所在组（避免"兼本组"），并按该组组长姓名判断是否标（组长）
  const curName = currentGroup ? currentGroup.name : "";
  const extraIds = m.extraGroupIds || [];
  m.extraGroupNames.forEach((g, i) => {
    if (g === curName) return;
    const gid = extraIds[i];
    const grp = state.ctx.groups.find((x) => x.id === gid);
    const gidKey = String(gid);
    const roleHere = (m.groupRoles || {})[gid] || (m.groupRoles || {})[gidKey];
    const leaderHere = roleHere === "组长";
    chips.push(`<span class="tag">兼${escapeHtml(g)}${leaderHere ? "（组长）" : ""}</span>`);
  });
  nameTd.innerHTML = `<div class="name-cell"><b>${escapeHtml(m.name)}</b>${chips.join('')}</div>`;
  tr.appendChild(nameTd);

  const classTd = document.createElement('td');
  classTd.className = 'col-class';
  classTd.textContent = m.cls;
  tr.appendChild(classTd);

  for (const d of dates) {
    for (const s of slots) {
      const td = document.createElement('td');
      td.className = 'cell';
      td.dataset.memberId = m.id;
      td.dataset.date = d;
      td.dataset.slot = s;
      if (!canEdit) {
        td.classList.add('readonly');
        td.title = '无权修改该组考勤';
      }
      applyCellVisual(td, m, d, s, totals);
      tr.appendChild(td);
    }
  }

  const noteTd = document.createElement('td');
  noteTd.className = 'col-note';
  const noteInput = document.createElement('input');
  noteInput.type = 'text';
  noteInput.maxLength = 500;
  noteInput.placeholder = canEdit ? '点这里填写备注…' : '（只读）';
  noteInput.disabled = !canEdit;
  noteInput.dataset.role = 'note';
  noteInput.value = rowNote(m, dates, slots);
  noteInput.addEventListener('input', () => {
    const a = latestAtt(m.id);
    const slot = a ? a.slot : slots[0];
    patch(m, a ? a.date : dates[0], slot, { note: noteInput.value });
    refreshCellVisualsFor(m.id);
  });
  noteTd.appendChild(noteInput);
  tr.appendChild(noteTd);

  const subTd = document.createElement('td');
  subTd.className = 'col-sub';
  const subInput = document.createElement('input');
  subInput.type = 'text';
  subInput.maxLength = 100;
  subInput.placeholder = canEdit ? '替岗同学姓名…' : '（只读）';
  subInput.disabled = !canEdit;
  subInput.dataset.role = 'sub';
  subInput.value = rowSub(m, dates, slots);
  subInput.addEventListener('input', () => {
    const a = latestAtt(m.id);
    const slot = a ? a.slot : slots[0];
    patch(m, a ? a.date : dates[0], slot, { substitute: subInput.value });
  });
  subTd.appendChild(subInput);
  tr.appendChild(subTd);

  return tr;
}

/** 备注列显示：优先显示当天第一条有备注的记录 */
function rowNote(m, dates, slots) {
  const a = latestAtt(m.id);
  return a ? a.note || '' : '';
}
function rowSub(m, dates, slots) {
  const a = latestAtt(m.id);
  return a ? a.substitute || '' : '';
}
function latestAtt(memberId) {
  // 只从当前选中日期里找第一条带备注或替岗的记录，避免串到其它日期
  const dates = state.date ? [state.date] : state.ctx.dates;
  for (const d of dates) {
    for (const s of state.ctx.slots) {
      const a = state.att.get(keyOf(memberId, d, s));
      if (a && (a.note || a.substitute)) return { ...a, date: d, slot: s };
    }
  }
  return null;
}

function applyCellVisual(td, m, d, s, totals) {
  const a = getAtt(m.id, d, s);
  const status = a ? a.status : 'unmarked';
  td.classList.remove('s-present', 's-late', 's-absent', 's-leave');
  if (status !== 'unmarked') td.classList.add('s-' + status);
  // 与上方"标记"按钮同一套配色（CSS 变量），浅色/深色自动切换
  td.style.background = '';
  td.style.backgroundImage = 'none';
  td.style.color = '';
  td.textContent = STATUS_SHORT[status] || '';
  td.classList.toggle('has-note', !!(a && (a.note || a.substitute)));
  if (a && (a.note || a.substitute)) {
    td.title = [STATUS_LABEL[status], a.note, a.substitute ? '替岗：' + a.substitute : ''].filter(Boolean).join('｜');
  } else if (!td.title) {
    td.title = '';
  }
}

function refreshCellVisualsFor(memberId) {
  const m = state.ctx.members.find((x) => x.id === memberId);
  if (!m) return;
  $$(`td.cell[data-member-id="${memberId}"]`).forEach((td) => applyCellVisual(td, m, td.dataset.date, td.dataset.slot));
}

function updateCellElement(memberId, date, slot) {
  const td = document.querySelector(`td.cell[data-member-id="${memberId}"][data-date="${date}"][data-slot="${slot}"]`);
  if (!td) return;
  const m = state.ctx.members.find((x) => x.id === memberId);
  if (m) applyCellVisual(td, m, date, slot);
}

function countSlot(members, date, slot) {
  const out = { marked: 0, present: 0, late: 0, absent: 0, leave: 0 };
  for (const m of members) {
    const a = getAtt(m.id, date, slot);
    if (!a || a.status === 'unmarked') continue;
    out.marked++;
    if (out[a.status] != null) out[a.status]++;
  }
  return out;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/* ---------------- 单元格交互 ---------------- */
function selectCell(td) {
  $$('.cell.selected').forEach((c) => c.classList.remove('selected'));
  td.classList.add('selected');
  state.selected = { memberId: Number(td.dataset.memberId), date: td.dataset.date, slot: td.dataset.slot };
}

/** 工具栏「标记」画笔：选中哪个，点格子就标成哪个 */
function setMarkStatus(status) {
  state.markStatus = status;
  $$('#mark-buttons .seg').forEach((b) => b.classList.toggle('active', b.dataset.status === status));
}

/** 页面进入时确保画笔有默认高亮 */
function renderMarkButtons() {
  setMarkStatus(state.markStatus || 'present');
}

/** 根据 state.selected 找到当前表格里对应的那个格子 */
function findSelectedCell() {
  let td = document.querySelector('td.cell.selected');
  if (td) return td;
  if (!state.selected) return null;
  const { memberId, date, slot } = state.selected;
  return document.querySelector(
    `td.cell[data-member-id="${memberId}"][data-date="${date}"][data-slot="${slot}"]`
  );
}

/* ---------------- 导出范围 ---------------- */
function adminExportVisible(isAdmin) {
  const btn = $('#btn-export-xlsx');
  if (btn) btn.hidden = !isAdmin;
  const ver = $('#app-ver');
  if (ver) ver.textContent = 'v' + (window.__APP_VERSION__ || '');
}

function expListHtml(list, name) {
  return list.map((v) =>
    '<label><input type="checkbox" name="' + name + '" value="' + escapeHtml(String(v.value)) + '" checked> '
    + escapeHtml(String(v.label)) + '</label>'
  ).join('');
}

function openExportDialog() {
  const ctx = state.ctx;
  if (!ctx) return;
  $('#exp-dates').innerHTML = expListHtml(ctx.dates.map((d) => ({ value: d, label: d })), 'edate');
  $('#exp-slots').innerHTML = expListHtml(ctx.slots.map((s) => ({ value: s, label: s })), 'eslot');
  $('#exp-groups').innerHTML = expListHtml(ctx.groups.map((g) => ({ value: g.id, label: g.name })), 'egroup');
  const xlsBox = $('#exp-xls');
  if (xlsBox) xlsBox.checked = false;
  $('#export-error').hidden = true;
  syncAllExpBoxes();
  const dlg = $('#dlg-export');
  if (dlg.showModal) dlg.showModal();
}

function expSelected(listSel) {
  return $$(listSel + ' input[type="checkbox"]:checked').map((i) => i.value);
}

function syncAllExpBoxes() {
  $$('#dlg-export .exp-col').forEach((col) => {
    const list = col.querySelector('.exp-list');
    const box = col.querySelector('input[data-all]');
    if (!list || !box) return;
    const items = list.querySelectorAll('input[type="checkbox"]').length;
    const on = list.querySelectorAll('input[type="checkbox"]:checked').length;
    box.checked = items > 0 && on === items;
    box.indeterminate = on > 0 && on < items;
  });
  const sum = $('#exp-sum');
  if (sum) {
    sum.textContent = '已选 ' + expSelected('#exp-dates').length + ' 天 / '
      + expSelected('#exp-slots').length + ' 个时段 / '
      + (expSelected('#exp-groups').length === state.ctx.groups.length ? '全部' : expSelected('#exp-groups').length + ' 个') + ' 组';
  }
}

async function runExport() {
  const dates = expSelected('#exp-dates');
  const slots = expSelected('#exp-slots');
  const groups = expSelected('#exp-groups');
  const err = $('#export-error');
  if (!dates.length || !slots.length || !groups.length) {
    err.textContent = '请至少选择一天、一个时段和一个组别';
    err.hidden = false;
    return;
  }
  err.hidden = true;
  const fmt = $('#exp-xls').checked ? 'xls' : 'xlsx';
  const qs = 'format=' + fmt
    + '&dates=' + encodeURIComponent(dates.join(','))
    + '&slots=' + encodeURIComponent(slots.join(','))
    + '&groups=' + encodeURIComponent(groups.join(','));
  await flushSave();
  $('#dlg-export').close();
  location.href = '/api/export?' + qs;
  toast('正在按所选范围生成 Excel，稍后自动下载；文件 10 分钟后从服务器清理');
}

function applyStatusToCell(td, status) {
  if (!state.ctx || !state.ctx.user) {
    toast('登录状态已失效，请重新登录', true);
    return false;
  }
  if (td.classList.contains('readonly')) {
    toast('该组不在您的负责范围内，无法修改', true);
    return false;
  }
  if (WRITE_LOCKED(state.ctx)) {
    toast('请先修改初始密码', true);
    return false;
  }
  const m = state.ctx.members.find((x) => x.id === Number(td.dataset.memberId));
  if (!m) return false;
  patch(m, td.dataset.date, td.dataset.slot, { status });
  const row = td.closest('tr');
  if (row) {
    const noteEl = row.querySelector('input[data-role="note"]');
    const subEl = row.querySelector('input[data-role="sub"]');
    const a = getAtt(m.id, td.dataset.date, td.dataset.slot);
    if (noteEl) noteEl.value = (a && a.note) || '';
    if (subEl) subEl.value = (a && a.substitute) || '';
  }
  return true;
}

function bindGridEvents() {
  const body = $('#grid-body');
  let suppressClick = false;
  let longPressTimer = null;

  body.addEventListener('click', (e) => {
    const td = e.target.closest('td.cell');
    if (!td) return;
    if (suppressClick) { suppressClick = false; return; }
    if (!state.ctx || !state.ctx.user) { toast("登录状态已失效，请重新登录", true); showLogin(); return; }
    selectCell(td);
    applyStatusToCell(td, state.markStatus || 'present');
  });
  body.addEventListener('contextmenu', (e) => {
    const td = e.target.closest('td.cell');
    if (!td) return;
    e.preventDefault();
    selectCell(td);
    openCellDialog(td);
  });

  // 手机端：长按格子打开备注/替岗对话框（右键在触屏上不可用）
  body.addEventListener('touchstart', (e) => {
    const td = e.target.closest('td.cell');
    if (!td || e.touches.length !== 1) return;
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      suppressClick = true;
      if (navigator.vibrate) navigator.vibrate(15);
      selectCell(td);
      openCellDialog(td);
    }, 550);
  }, { passive: true });
  body.addEventListener('touchmove', () => {
    clearTimeout(longPressTimer);   // 滑动表格时取消长按
    longPressTimer = null;
  }, { passive: true });
  body.addEventListener('touchend', (e) => {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; return; }
    if (suppressClick) e.preventDefault();   // 刚长按打开过对话框，避免再切换状态
  });
  body.addEventListener('touchcancel', () => {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }, { passive: true });
}

/* ---------------- 单元格备注对话框 ---------------- */
let cellDialogTarget = null;
let cellDialogStatus = 'unmarked';

function openCellDialog(td) {
  if (td.classList.contains('readonly')) {
    toast('该组不在您的负责范围内，无法修改', true);
    return;
  }
  if (WRITE_LOCKED(state.ctx)) {
    toast('请先修改初始密码', true);
    return;
  }
  const m = state.ctx.members.find((x) => x.id === Number(td.dataset.memberId));
  const a = getAtt(m.id, td.dataset.date, td.dataset.slot) || { status: 'unmarked', note: '', substitute: '' };
  cellDialogTarget = { member: m, date: td.dataset.date, slot: td.dataset.slot };
  cellDialogStatus = a.status || 'unmarked';
  $('#cell-title').textContent = `${m.name}（${m.cls}）　${td.dataset.date} ${td.dataset.slot}`;
  const form = $('#cell-form');
  form.note.value = a.note || '';
  form.substitute.value = a.substitute || '';
  $('#cell-error').hidden = true;
  renderCellDialogStatus();
  $('#dlg-cell').showModal();
}

function renderCellDialogStatus() {
  $$('#cell-status .seg').forEach((b) => b.classList.toggle('active', b.dataset.status === cellDialogStatus));
}

/* ---------------- 备注 / 待办 ---------------- */
async function renderReminders() {
  const date = state.date;
  $('#reminder-date').textContent = date ? `${date} ${weekdayCN(date)}` : '';
  try {
    const data = await api('/api/reminders?date=' + encodeURIComponent(date || ''));
    const ul = $('#reminder-list');
    ul.innerHTML = '';
    if (!data.reminders.length) {
      const li = document.createElement('li');
      li.className = 'muted small';
      li.textContent = '暂无备注';
      ul.appendChild(li);
      return;
    }
    for (const r of data.reminders) {
      const li = document.createElement('li');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      const span = document.createElement('span');
      span.textContent = r.text;
      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '×';
      del.title = '删除';
      del.onclick = async () => {
        await api('/api/reminders?id=' + r.id, { method: 'DELETE' });
        renderReminders();
      };
      cb.onchange = () => {
        li.classList.toggle('done', cb.checked);
        const done = JSON.parse(localStorage.getItem('kaoqin_reminder_done') || '{}');
        done[r.id] = cb.checked;
        localStorage.setItem('kaoqin_reminder_done', JSON.stringify(done));
      };
      const done = JSON.parse(localStorage.getItem('kaoqin_reminder_done') || '{}');
      cb.checked = !!done[r.id];
      li.classList.toggle('done', cb.checked);
      li.append(cb, span, del);
      ul.appendChild(li);
    }
  } catch (e) {
    /* 忽略 */
  }
}

/* ---------------- 当日统计 ---------------- */
function renderDayStats() {
  const members = visibleMembers();
  const dates = state.date ? [state.date] : state.ctx.dates;
  const slots = state.ctx.slots;
  let present = 0,
    late = 0,
    absent = 0,
    leave = 0,
    marked = 0;
  for (const m of members) {
    for (const d of dates) {
      for (const s of slots) {
        const a = getAtt(m.id, d, s);
        if (!a || a.status === 'unmarked') continue;
        marked++;
        if (a.status === 'present') present++;
        else if (a.status === 'late') late++;
        else if (a.status === 'absent') absent++;
        else if (a.status === 'leave') leave++;
      }
    }
  }
  const totalCells = members.length * dates.length * slots.length;
  const box = $('#day-stats');
  box.innerHTML = `
    <div class="stat-box"><div class="k">应记录格子</div><div class="v">${totalCells}</div></div>
    <div class="stat-box"><div class="k">已记录</div><div class="v">${marked}</div></div>
    <div class="stat-box present"><div class="k">出勤</div><div class="v">${present}</div></div>
    <div class="stat-box late"><div class="k">迟到</div><div class="v">${late}</div></div>
    <div class="stat-box absent"><div class="k">缺勤</div><div class="v">${absent}</div></div>
    <div class="stat-box leave"><div class="k">请假</div><div class="v">${leave}</div></div>`;
}

/* ---------------- 统计页 ---------------- */
async function loadStats() {
  try {
    const data = await api('/api/stats');
    state.stats = data;
    renderStats();
  } catch (e) {
    toast(e.message, true);
  }
}

function renderStats() {
  const table = $('#stats-table');
  const data = state.stats;
  table.innerHTML = '';
  if (!data) return;
  const view = state.statsView;
  const groupName = (id) => state.ctx.groups.find((g) => g.id === id)?.name || '未分组';

  if (view === 'member') {
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    for (const h of ['姓名', '班级', '所属组', '已记录', '出勤', '迟到', '缺勤', '请假', '出勤率', '状态']) {
      const th = document.createElement('th');
      th.textContent = h;
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const m of state.ctx.members) {
      const s = data.summary.byMember[m.id];
      if (!s) continue;
      const rate = s.marked ? Math.round(((s.present + s.late) / s.marked) * 1000) / 10 : 0;
      const tr2 = document.createElement('tr');
      const cells = [
        m.name,
        m.cls,
        (m.groupIds || [m.primaryGroupId]).map(groupName).join("、"),
        s.marked,
        s.present,
        s.late,
        s.absent,
        s.leave,
        s.marked ? rate + '%' : '—',
      ];
      cells.forEach((v, i) => {
        const td = document.createElement('td');
        td.textContent = v;
        if (i === 0 || i === 1 || i === 2) td.className = 'left';
        tr2.appendChild(td);
      });
      const barTd = document.createElement('td');
      barTd.innerHTML = `<div class="bar"><i style="width:${s.marked ? rate : 0}%"></i></div>`;
      tr2.appendChild(barTd);
      tbody.appendChild(tr2);
    }
    table.appendChild(tbody);
    return;
  }

  // 按时段
  const thead = document.createElement('thead');
  const tr1 = document.createElement('tr');
  const th0 = document.createElement('th');
  th0.rowSpan = 2;
  th0.textContent = '时段';
  tr1.appendChild(th0);
  for (const d of data.dates) {
    const th = document.createElement('th');
    th.colSpan = 5;
    th.textContent = d;
    tr1.appendChild(th);
  }
  thead.appendChild(tr1);
  const tr2 = document.createElement('tr');
  for (const d of data.dates) {
    for (const h of ['已记录', '出勤', '迟到', '缺勤', '请假']) {
      const th = document.createElement('th');
      th.textContent = h;
      tr2.appendChild(th);
    }
  }
  thead.appendChild(tr2);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  for (const slot of data.slots) {
    const tr = document.createElement('tr');
    const td0 = document.createElement('td');
    td0.textContent = slot;
    td0.className = 'left';
    tr.appendChild(td0);
    for (const d of data.dates) {
      const s = data.summary.byDateSlot[`${d}|${slot}`] || { marked: 0, present: 0, late: 0, absent: 0, leave: 0 };
      for (const v of [s.marked, s.present, s.late, s.absent, s.leave]) {
        const td = document.createElement('td');
        td.textContent = v;
        tr.appendChild(td);
      }
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
}

/* ---------------- 管理页 ---------------- */
async function loadAdmin() {
  try {
    const ctx = state.ctx;
    const form = $('#config-form');
    form.title.value = ctx.title || '';
    form.org.value = ctx.org || '';
    form.subtitle.value = ctx.subtitle || '';
    form.dates.value = ctx.dates.join('\n');
    form.slots.value = ctx.slots.join('\n');
    form.note.value = ctx.configNote || '';
    await Promise.all([loadUsers(), loadAudit()]);
  } catch (e) {
    toast(e.message, true);
  }
}

async function loadUsers() {
  const data = await api('/api/admin/users');
  const t = $('#users-table');
  t.innerHTML = '<thead><tr><th>账号</th><th>名称</th><th>权限</th><th>操作</th></tr></thead>';
  const tb = document.createElement('tbody');
  for (const u of data.users) {
    const tr = document.createElement('tr');
    const perms = u.is_admin ? '管理员（全部）' : u.groups.join('、') || '（未分配）';
    tr.innerHTML = `<td>${escapeHtml(u.username)}</td><td>${escapeHtml(u.display)}</td><td>${escapeHtml(perms)}</td>`;
    const td = document.createElement('td');
    td.className = 'actions';
    const btn = document.createElement('button');
    btn.className = 'btn small ghost';
    btn.textContent = '重置密码';
    btn.onclick = async () => {
      if (!confirm(`确定把 ${u.username} 的密码重置为初始密码吗？`)) return;
      const res = await api('/api/admin/users/reset', { method: 'POST', body: JSON.stringify({ id: u.id }) });
      toast(`已重置为：${res.password}`);
    };
    td.appendChild(btn);
    tr.appendChild(td);
    tb.appendChild(tr);
  }
  t.appendChild(tb);
}

async function loadAudit() {
  const data = await api('/api/admin/audit');
  const t = $('#audit-table');
  t.innerHTML = '<thead><tr><th>时间</th><th>账号</th><th>操作</th><th>详情</th></tr></thead>';
  const tb = document.createElement('tbody');
  for (const row of data.log) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(row.at)}</td><td>${escapeHtml(row.username)}</td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.detail)}</td>`;
    tb.appendChild(tr);
  }
  t.appendChild(tb);
}

function openPasswordDialog(forced) {
  const dlg = $('#dlg-password');
  $('#pwd-hint').textContent = forced
    ? '首次登录必须修改初始密码后才能填报考勤。'
    : '修改后请牢记新密码。';
  $('#password-form').reset();
  $('#pwd-error').hidden = true;
  dlg.showModal();
}

/* ---------------- 事件绑定 ---------------- */
function bindGlobalEvents() {
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error');
    err.hidden = true;
    try {
      const username = $('#login-username').value.trim();
      const password = $('#login-password').value;
      const remember = $('#login-remember').checked;
      const data = await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      // 记住账号和密码（仅存在本机浏览器）
      try {
        if (remember) {
          localStorage.setItem(REMEMBER_KEY, username);
          localStorage.setItem(REMEMBER_PWD_KEY, keep(password));
        } else {
          localStorage.removeItem(REMEMBER_KEY);
          localStorage.removeItem(REMEMBER_PWD_KEY);
        }
      } catch {}
      const me = await api('/api/me');
      onLoggedIn(data.user && data.user.groups ? data.user : me.user, me.context);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });

  $('#btn-logout').onclick = async () => {
    if (state.dirty.size) await flushSave();
    try {
      await api('/api/logout', { method: 'POST' });
    } catch {}
    location.reload();
  };

  // App 内不显示安装包条目（已经在用 App 了），网页端保留
  const inApp = !!window.__APP__ || /KaoqinApp/i.test(navigator.userAgent || "");
  const dlApp = $("#dl-app");
  if (inApp && dlApp) dlApp.hidden = true;
  $('#btn-download-center').onclick = () => {
    const dlg = $('#dlg-download');
    if (dlg.showModal) dlg.showModal();
  };
  $('#dl-close').onclick = () => $('#dlg-download').close();

  $('#btn-password').onclick = () => openPasswordDialog(false);

  $$('.tab').forEach((t) => {
    t.onclick = () => showTab(t.dataset.tab);
  });

  // 导出（仅管理员可见）：先选范围，再导出
  // 用事件委托绑定导出按钮，页面结构变化或缓存影响下也不容易失效
  document.addEventListener('click', (e) => {
    if (e.target.closest('#btn-export-xlsx')) {
      e.preventDefault();
      openExportDialog();
    }
  });
  $('#export-cancel').onclick = () => $('#dlg-export').close();
  $('#export-run').onclick = () => runExport();
  $('#dlg-export').addEventListener('change', (e) => {
    const all = e.target.closest('input[data-all]');
    if (all) {
      const col = all.closest('.exp-col');
      const list = col ? col.querySelector('.exp-list') : null;
      if (list) {
        list.querySelectorAll('input[type="checkbox"]').forEach((i) => { i.checked = all.checked; });
      }
    }
    syncAllExpBoxes();
  });

  // 顶部「标记」按钮：只选择状态（画笔），之后点格子才写入
  $('#mark-buttons').addEventListener('click', (e) => {
    const b = e.target.closest('.seg');
    if (!b) return;
    setMarkStatus(b.dataset.status);
    toast(`已选择「${b.textContent.trim()}」，点格子即标记`);
  });
  renderMarkButtons();

  // 表格横向滚动时，把分组行组名钉在左侧
  const gridWrap = document.querySelector('.grid-wrap');
  if (gridWrap) gridWrap.addEventListener('scroll', pinGroupNames, { passive: true });
  window.addEventListener('resize', pinGroupNames);

  $('#group-filter').addEventListener('change', (e) => {
    state.groupFilter = e.target.value;
    renderGrid();
    renderDayStats();
  });
  $('#only-mine').addEventListener('change', (e) => {
    state.onlyMine = e.target.checked;
    renderGroupFilter();
    renderGrid();
    renderDayStats();
  });

  $('#btn-row-present').onclick = () => {
    if (!state.selected) return toast('请先点选任意一个格子，以确定要操作的行', true);
    const m = state.ctx.members.find((x) => x.id === state.selected.memberId);
    for (const d of state.date ? [state.date] : state.ctx.dates) {
      for (const s of state.ctx.slots) {
        const td = document.querySelector(`td.cell[data-member-id="${m.id}"][data-date="${d}"][data-slot="${s}"]`);
        if (td && !td.classList.contains('readonly')) patch(m, d, s, { status: 'present' });
      }
    }
    refreshCellVisualsFor(m.id);
    toast(`已把 ${m.name} 全部时段标记为出勤`);
  };

  $('#btn-col-present').onclick = () => {
    if (!state.selected) return toast('请先点选任意一个格子，以确定要操作的时段', true);
    const { date, slot } = state.selected;
    for (const m of visibleMembers()) {
      const td = document.querySelector(`td.cell[data-member-id="${m.id}"][data-date="${date}"][data-slot="${slot}"]`);
      if (td && !td.classList.contains('readonly')) patch(m, date, slot, { status: 'present' });
    }
    toast(`已把 ${date} ${slot} 全部标记为出勤`);
  };

  // 整行清空（先点一个格子确定是谁，再点这里）
  $('#btn-row-clear').onclick = () => {
    if (!state.selected) return toast('请先点选任意一个格子，以确定要清空的行', true);
    const m = state.ctx.members.find((x) => x.id === state.selected.memberId);
    if (!m) return;
    const dates = state.date ? [state.date] : state.ctx.dates;
    if (!confirm(`确定清空 ${m.name} 在 ${dates.join('、')} 全部时段的记录吗？`)) return;
    let n = 0;
    for (const d of dates) {
      for (const s of state.ctx.slots) {
        const td = document.querySelector(`td.cell[data-member-id="${m.id}"][data-date="${d}"][data-slot="${s}"]`);
        if (td && !td.classList.contains('readonly')) {
          patch(m, d, s, { status: 'unmarked' });
          n++;
        }
      }
    }
    refreshCellVisualsFor(m.id);
    toast(`已清空 ${m.name} 的 ${n} 个时段`);
  };

  // 整个时段清空（先点一个格子确定是哪天哪个时段）
  $('#btn-col-clear').onclick = () => {
    if (!state.selected) return toast('请先点选任意一个格子，以确定要清空的时段', true);
    const { date, slot } = state.selected;
    const list = visibleMembers();
    if (!confirm(`确定清空 ${date} ${slot} 全部人员的记录吗？`)) return;
    let n = 0;
    for (const m of list) {
      const td = document.querySelector(`td.cell[data-member-id="${m.id}"][data-date="${date}"][data-slot="${slot}"]`);
      if (td && !td.classList.contains('readonly')) {
        patch(m, date, slot, { status: 'unmarked' });
        n++;
      }
    }
    list.forEach((m) => refreshCellVisualsFor(m.id));
    toast(`已清空 ${date} ${slot} 的 ${n} 条记录`);
  };

  $('#btn-reload').onclick = async () => {
    await loadAttendance();
    renderGrid();
    renderDayStats();
    toast('已重新载入');
  };

  $('#reminder-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#reminder-input');
    const text = input.value.trim();
    if (!text) return;
    try {
      await api('/api/reminders', { method: 'POST', body: JSON.stringify({ date: state.date, text }) });
      input.value = '';
      renderReminders();
    } catch (ex) {
      toast(ex.message, true);
    }
  });

  $('#stats-switch').addEventListener('click', (e) => {
    const b = e.target.closest('.seg');
    if (!b) return;
    state.statsView = b.dataset.view;
    $$('#stats-switch .seg').forEach((x) => x.classList.toggle('active', x === b));
    renderStats();
  });

  // 修改密码
  $('#pwd-cancel').onclick = () => $('#dlg-password').close();
  $('#cell-cancel').onclick = () => $('#dlg-cell').close();
  $('#password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const err = $('#pwd-error');
    err.hidden = true;
    if (form.password.value !== form.password2.value) {
      err.textContent = '两次输入的新密码不一致';
      err.hidden = false;
      return;
    }
    try {
      await api('/api/password', {
        method: 'POST',
        body: JSON.stringify({ oldPassword: form.oldPassword.value, password: form.password.value }),
      });
      $('#dlg-password').close();
      state.user.mustChange = false;
      const me = await api('/api/me');
      state.ctx = me.context;
      state.user = me.user;
      renderHint();
      renderGrid();
      renderDayStats();
      toast('密码已修改，可以开始填报');
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });

  // 单元格备注
  $('#cell-status').addEventListener('click', (e) => {
    const b = e.target.closest('.seg');
    if (!b) return;
    cellDialogStatus = b.dataset.status;
    renderCellDialogStatus();
  });
  $('#cell-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!cellDialogTarget) return;
    const form = e.target;
    const { member, date, slot } = cellDialogTarget;
    patch(member, date, slot, {
      status: cellDialogStatus,
      note: form.note.value,
      substitute: form.substitute.value,
    });
    const row = document.querySelector(`tr[data-member-id="${member.id}"]`);
    if (row) {
      const noteEl = row.querySelector('input[data-role="note"]');
      const subEl = row.querySelector('input[data-role="sub"]');
      const a = getAtt(member.id, date, slot);
      if (noteEl) noteEl.value = a ? a.note || '' : '';
      if (subEl) subEl.value = a ? a.substitute || '' : '';
    }
    $('#dlg-cell').close();
    toast('已保存该时段记录');
  });

  // 管理页
  $('#config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      await api('/api/config', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title.value,
          org: form.org.value,
          subtitle: form.subtitle.value,
          note: form.note.value,
          dates: form.dates.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
          slots: form.slots.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
        }),
      });
      const me = await api('/api/me');
      state.ctx = me.context;
      state.date = state.ctx.dates.includes(state.date) ? state.date : state.ctx.dates[0];
      $('#app-title').textContent = state.ctx.title;
      $('#app-sub').textContent = `${state.ctx.org}　${state.ctx.dates.join('、')}`;
      renderDateSwitch();
      await loadAttendance();
      renderGrid();
      renderDayStats();
      toast('设置已保存');
    } catch (ex) {
      toast(ex.message, true);
    }
  });

  $('#btn-regen-slots').onclick = () => {
    const slots = [];
    for (let m = 7 * 60; m + 30 <= 18 * 60; m += 30) {
      const p = (n) => String(n).padStart(2, '0');
      slots.push(`${p(Math.floor(m / 60))}:${p(m % 60)}-${p(Math.floor((m + 30) / 60))}:${p((m + 30) % 60)}`);
    }
    $('#config-form').slots.value = slots.join('\n');
    toast('已生成 7:00–18:00 的 22 个半小时时段');
  };

  $('#btn-load-audit').onclick = () => loadAudit().catch((e) => toast(e.message, true));

  // 键盘
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!state.selected) return;
      e.preventDefault();
      moveSelection(e.key);
      return;
    }
    if (['1', '2', '3', '4', '0', 'Delete', 'Backspace'].includes(e.key)) {
      if (!state.selected) return;
      const td = document.querySelector(
        `td.cell[data-member-id="${state.selected.memberId}"][data-date="${state.selected.date}"][data-slot="${state.selected.slot}"]`
      );
      if (!td) return;
      e.preventDefault();
      const map = { 1: 'present', 2: 'late', 3: 'absent', 4: 'leave', 0: 'unmarked', Delete: 'unmarked', Backspace: 'unmarked' };
      applyStatusToCell(td, map[e.key]);
    }
  });

  // 离开前保存
  window.addEventListener('beforeunload', () => {
    if (state.dirty.size) {
      const data = JSON.stringify({ changes: [...state.dirty.values()] });
      try {
        navigator.sendBeacon('/api/attendance', new Blob([data], { type: 'application/json' }));
      } catch {}
    }
  });
}

function moveSelection(key) {
  const { memberId, date, slot } = state.selected;
  const slots = state.ctx.slots;
  const rows = [...document.querySelectorAll('#grid-body tr[data-member-id]')];
  const rowIdx = rows.findIndex((r) => Number(r.dataset.memberId) === memberId);
  let slotIdx = slots.indexOf(slot);
  let nextMember = memberId;
  if (key === 'ArrowLeft') slotIdx--;
  if (key === 'ArrowRight') slotIdx++;
  if (key === 'ArrowUp') {
    const r = rows[rowIdx - 1];
    if (r) nextMember = Number(r.dataset.memberId);
  }
  if (key === 'ArrowDown') {
    const r = rows[rowIdx + 1];
    if (r) nextMember = Number(r.dataset.memberId);
  }
  slotIdx = Math.max(0, Math.min(slots.length - 1, slotIdx));
  const td = document.querySelector(`td.cell[data-member-id="${nextMember}"][data-date="${date}"][data-slot="${slots[slotIdx]}"]`);
  if (td) {
    selectCell(td);
    td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

/* ---------------- 启动 ---------------- */
bindGridEvents();
boot();
