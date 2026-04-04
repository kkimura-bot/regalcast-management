// ============================================================
// Projects module
// ============================================================
import { RC, isAdmin, isLeaderOrAbove } from '../state.js';
import {
  db, collection, doc, addDoc, updateDoc, deleteDoc,
  getDocs, query, orderBy, serverTimestamp
} from '../firebase.js';
import { GOALS_TREE } from '../data/constants.js';
import { openModal, closeModal } from '../utils/modal.js';
import { fmtDate, todayJST, isOverdue, progBar } from '../utils/helpers.js';

let _cachedProjects = [];
let _pjGanttOffset  = 0;
let currentPJView   = 'list';

const CELL_W = 26;

// ── Load ──────────────────────────────────────────────────

export async function loadProjects() {
  const snap = await getDocs(query(collection(db, 'projects'), orderBy('createdAt','desc')));
  _cachedProjects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  RC._cachedProjects = _cachedProjects;

  renderProjectsTable(getFilteredProjects());
  if (currentPJView === 'gantt') renderGantt(getFilteredProjects());
  renderMobileProjects(_cachedProjects);

  // Populate member filter buttons
  const memberNames = [...new Set(_cachedProjects.map(p => p.member).filter(Boolean))].sort();
  const mFilters = document.getElementById('pj-member-filters');
  if (mFilters) {
    mFilters.innerHTML = `<button class="pj-filter-btn pj-member-btn active" data-member="all" onclick="filterPJMember('all')">全員</button>`
      + memberNames.map(n => `<button class="pj-filter-btn pj-member-btn" data-member="${n}" onclick="filterPJMember('${n}')">${n}</button>`).join('');
  }
}

export function getFilteredProjects() {
  let pjs = _cachedProjects;
  const today = todayJST();
  const f = RC._pjFilter;
  if (f.status === '期限超過') {
    pjs = pjs.filter(p => p.end && p.end < today && (p.progress||0) < 1);
  } else if (f.status !== 'all') {
    const statusMap = {
      '進行中': p => (p.progress||0)>0 && (p.progress||0)<1,
      '完了':   p => (p.progress||0) >= 1,
      '未着手': p => !(p.progress||0)
    };
    const fn = statusMap[f.status];
    if (fn) pjs = pjs.filter(fn);
  }
  if (f.member !== 'all') pjs = pjs.filter(p => p.member === f.member);
  if (f.dept !== 'all') {
    const names = RC._cachedMembers.filter(m => m.dept === f.dept).map(m => m.name);
    pjs = pjs.filter(p => names.includes(p.member));
  }
  return pjs;
}

export function renderProjectsTable(projects) {
  const tbody = document.getElementById('pj-table-body');
  if (!tbody) return;
  const today = todayJST();
  if (!projects.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">プロジェクトがありません</td></tr>'; return;
  }
  tbody.innerHTML = projects.map(p => {
    const over = p.end && p.end < today && (p.progress||0) < 1;
    const done = (p.progress||0) >= 1;
    const pct  = Math.round((p.progress||0)*100);
    return `<tr>
      <td style="font-weight:600">${p.name||'—'}</td>
      <td><span class="member-chip">${p.member||'—'}</span></td>
      <td style="font-size:11px;color:var(--ink3)">${p.start?fmtDate(p.start):'—'}</td>
      <td style="font-size:11px;color:${over?'var(--accent)':'var(--ink3)'}${over?';font-weight:700':''}">${p.end?fmtDate(p.end):'—'}</td>
      <td>${progBar(p.progress, over)}</td>
      <td style="font-size:11px;color:var(--ink3)">${p.goal||'—'}</td>
      <td style="font-size:11px;color:var(--ink3)">${p.dept||'—'}</td>
      <td><span class="badge ${over?'':'badge-'+(done?'done':pct>0?'doing':'todo')}" style="${over?'background:#fee2e2;color:var(--accent)':''}">${over?'超過':done?'完了':pct>0?'進行中':'未着手'}</span></td>
      <td><button class="mini-btn" onclick="editProject('${p.id}')">編集</button></td>
    </tr>`;
  }).join('');
}

function renderMobileProjects(projects) {
  const cont = document.getElementById('m-pj-list');
  if (!cont) return;
  const today = todayJST();
  if (!projects.length) { cont.innerHTML = '<div class="empty">プロジェクトがありません</div>'; return; }
  cont.innerHTML = projects.map(p => {
    const over = isOverdue(p.end) && (p.progress||0) < 1;
    const done = (p.progress||0) >= 1;
    const pct  = Math.round((p.progress||0)*100);
    const barColor = over ? '#c8472a' : done ? '#3a7d5a' : '#2a5298';
    return `<div class="m-card" onclick="editProject('${p.id}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div style="font-size:13px;font-weight:700;flex:1;padding-right:8px">${p.name}</div>
        <span class="badge ${over?'':'badge-'+(done?'done':pct>0?'doing':'todo')}" style="${over?'background:#fee2e2;color:var(--accent)':''}">${over?'超過':done?'完了':pct>0?'進行中':'未着手'}</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
        <span class="member-chip">${p.member||'—'}</span>
        <span style="font-size:11px;color:${over?'var(--accent)':'var(--ink3)'}">📅 ${p.end?fmtDate(p.end):'期限未設定'}</span>
        <span style="font-size:11px;color:var(--ink3)">${p.goal||''}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="flex:1;height:5px;background:var(--surface2);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px"></div>
        </div>
        <div style="font-size:11px;font-family:'DM Mono',monospace;color:var(--ink3);width:30px;text-align:right">${pct}%</div>
      </div>
    </div>`;
  }).join('');
}

// ── Filters ───────────────────────────────────────────────

export function filterPJStatus(status) {
  RC._pjFilter.status = status;
  document.querySelectorAll('.pj-status-btn').forEach(b => b.classList.toggle('active', b.dataset.status === status));
  renderProjectsTable(getFilteredProjects());
  if (currentPJView === 'gantt') renderGantt(getFilteredProjects());
}

export function filterPJMember(member) {
  RC._pjFilter.member = member;
  document.querySelectorAll('.pj-member-btn').forEach(b => b.classList.toggle('active', b.dataset.member === member));
  renderProjectsTable(getFilteredProjects());
}

export function filterPJDept(dept) {
  RC._pjFilter.dept = dept;
  document.querySelectorAll('.pj-dept-btn').forEach(b => b.classList.toggle('active', b.dataset.dept === dept));
  renderProjectsTable(getFilteredProjects());
}

// ── View toggle ───────────────────────────────────────────

export function setPJView(view) {
  currentPJView = view;
  const listView  = document.getElementById('pj-list-view');
  const ganttView = document.getElementById('pj-gantt-view');
  const listBtn   = document.getElementById('pj-view-list-btn');
  const ganttBtn  = document.getElementById('pj-view-gantt-btn');
  if (view === 'list') {
    if (listView)  listView.style.display  = '';
    if (ganttView) ganttView.style.display = 'none';
    if (listBtn)   listBtn.classList.add('active');
    if (ganttBtn)  ganttBtn.classList.remove('active');
  } else {
    if (listView)  listView.style.display  = 'none';
    if (ganttView) ganttView.style.display = '';
    if (listBtn)   listBtn.classList.remove('active');
    if (ganttBtn)  ganttBtn.classList.add('active');
    renderGantt(getFilteredProjects());
  }
}

// ── Gantt ─────────────────────────────────────────────────

export function ganttShift(dir) {
  if (dir === 0) _pjGanttOffset = 0;
  else           _pjGanttOffset += dir;
  renderGantt(getFilteredProjects());
}

export function renderGantt(projects) {
  const container = document.getElementById('gantt-container');
  if (!container) return;
  const today = todayJST();
  const base  = new Date(today.slice(0,7) + '-01');
  base.setMonth(base.getMonth() + _pjGanttOffset);
  const year  = base.getFullYear();
  const month = base.getMonth();
  const days  = new Date(year, month+1, 0).getDate();

  let html = `<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:11px">`;
  html += `<thead><tr>
    <th class="g-label-th">プロジェクト名</th>
    <th class="g-label-th" style="min-width:80px">担当者</th>
    ${Array.from({length:days},(_,i)=>{
      const d = String(i+1).padStart(2,'0');
      const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${d}`;
      const isToday = dateStr === today;
      const dow = new Date(year,month,i+1).getDay();
      const color = dow===0?'var(--accent)':dow===6?'var(--blue)':'';
      return `<th class="g-day-th${isToday?' g-today-col':''}" style="${color?`color:${color}`:''}">${i+1}</th>`;
    }).join('')}
  </tr></thead><tbody>`;

  projects.forEach(p => {
    const over = p.end && p.end < today && (p.progress||0) < 1;
    const done = (p.progress||0) >= 1;
    const barColor = done ? '#3a7d5a' : over ? '#c8472a' : '#2a5298';
    html += `<tr class="g-row">
      <td class="g-label-td"><div style="font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px">${p.name||'—'}</div></td>
      <td class="g-label-td"><span class="member-chip" style="font-size:10px">${p.member||'—'}</span></td>
      ${Array.from({length:days},(_,i)=>{
        const d = String(i+1).padStart(2,'0');
        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${d}`;
        const isToday = dateStr === today;
        const inRange = p.start && p.end && dateStr >= p.start && dateStr <= p.end;
        let bg = '';
        if (inRange) bg = barColor;
        else if (isToday) bg = 'rgba(200,71,42,.07)';
        return `<td class="g-cell${isToday?' g-today-col':''}" style="${bg?`background:${bg};`:''}">&nbsp;</td>`;
      }).join('')}
    </tr>`;
  });

  html += `</tbody></table></div>`;
  container.innerHTML = html;
}

// ── CRUD ──────────────────────────────────────────────────

function buildGoalSelect(id, selected) {
  let opts = `<option value="">（なし）</option>`;
  Object.entries(GOALS_TREE).forEach(([group, subs]) => {
    opts += `<optgroup label="${group}">`;
    subs.forEach(s => {
      opts += `<option value="${s}" ${selected===s?'selected':''}>${s}</option>`;
    });
    opts += `</optgroup>`;
  });
  return `<select class="form-input" id="pj-goal">${opts}</select>`;
}

function projectForm(p, isEdit) {
  const mList = RC._cachedMembers.map(m => m.name);
  const memberOpts = ['', ...mList].map(m => `<option ${p?.member===m?'selected':''}>${m}</option>`).join('');
  const progOpts = [0,0.2,0.4,0.6,0.8,1].map(v=>`<option value="${v}" ${p?.progress===v?'selected':''}>${Math.round(v*100)}%</option>`).join('');
  const goalSelect = buildGoalSelect('pj-goal', p?.goal||'');
  const deptOpts = ['','モバイルセールス・ソリューション部','デジタルライフ・コンサルティング部','クリエイティブ・エンターテイメント部','経営戦略室']
    .map(d => `<option ${p?.dept===d?'selected':''}>${d}</option>`).join('');
  return `
    <div class="form-row"><label class="form-label">プロジェクト名</label>
      <input class="form-input" id="pj-name" value="${p?.name||''}" placeholder="プロジェクト名"></div>
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">担当者</label>
        <select class="form-input" id="pj-member">${memberOpts}</select></div>
      <div class="form-row"><label class="form-label">進捗</label>
        <select class="form-input" id="pj-progress">${progOpts}</select></div>
    </div>
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">開始日</label>
        <input type="date" class="form-input" id="pj-start" value="${p?.start||''}"></div>
      <div class="form-row"><label class="form-label">終了予定</label>
        <input type="date" class="form-input" id="pj-end" value="${p?.end||''}"></div>
    </div>
    <div class="form-row"><label class="form-label">紐づく目標</label>${goalSelect}</div>
    <div class="form-row"><label class="form-label">部門</label>
      <select class="form-input" id="pj-dept">${deptOpts}</select></div>
    <div class="btn-row">
      ${isEdit ? `<button class="btn" style="background:#fee2e2;color:var(--accent);border:none" onclick="deleteProject('${p.id}')">削除</button>` : ''}
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="${isEdit?`updateProject('${p.id}')`:'addProject()'}">
        ${isEdit?'更新':'追加する'}
      </button>
    </div>`;
}

export function openAddProjectModal() {
  document.getElementById('modal-title-text').textContent = '＋ プロジェクトを追加';
  document.getElementById('modal-body').innerHTML = projectForm(null, false);
  openModal();
}

export function editProject(id) {
  const p = _cachedProjects.find(x => x.id === id);
  if (!p) return;
  document.getElementById('modal-title-text').textContent = 'プロジェクトを編集';
  document.getElementById('modal-body').innerHTML = projectForm(p, true);
  openModal();
}

export async function addProject() {
  const name     = document.getElementById('pj-name').value.trim();
  const member   = document.getElementById('pj-member').value;
  const progress = parseFloat(document.getElementById('pj-progress').value) || 0;
  const start    = document.getElementById('pj-start').value;
  const end      = document.getElementById('pj-end').value;
  const goal     = document.getElementById('pj-goal')?.value || '';
  const dept     = document.getElementById('pj-dept')?.value || '';
  if (!name) { alert('プロジェクト名を入力してください'); return; }
  await addDoc(collection(db,'projects'), { name, member, progress, start, end, goal, dept, createdAt: serverTimestamp(), createdBy: RC.currentUser.uid });
  closeModal();
  loadProjects();
}

export async function updateProject(id) {
  const name     = document.getElementById('pj-name').value.trim();
  const member   = document.getElementById('pj-member').value;
  const progress = parseFloat(document.getElementById('pj-progress').value) || 0;
  const start    = document.getElementById('pj-start').value;
  const end      = document.getElementById('pj-end').value;
  const goal     = document.getElementById('pj-goal')?.value || '';
  const dept     = document.getElementById('pj-dept')?.value || '';
  if (!name) { alert('プロジェクト名を入力してください'); return; }
  await updateDoc(doc(db,'projects',id), { name, member, progress, start, end, goal, dept });
  closeModal();
  loadProjects();
}

export async function deleteProject(id) {
  if (!confirm('このプロジェクトを削除しますか？')) return;
  await deleteDoc(doc(db,'projects',id));
  closeModal();
  loadProjects();
}

// ── Window exports ────────────────────────────────────────
window.loadProjects        = loadProjects;
window.getFilteredProjects = getFilteredProjects;
window.renderProjectsTable = renderProjectsTable;
window.filterPJStatus      = filterPJStatus;
window.filterPJMember      = filterPJMember;
window.filterPJDept        = filterPJDept;
window.setPJView           = setPJView;
window.ganttShift          = ganttShift;
window.renderGantt         = renderGantt;
window.openAddProjectModal = openAddProjectModal;
window.editProject         = editProject;
window.addProject          = addProject;
window.updateProject       = updateProject;
window.deleteProject       = deleteProject;
// Expose for patching in inline script
window._cachedProjects     = _cachedProjects;
window.currentPJView       = currentPJView;
