// ============================================================
// Tasks module
// ============================================================
import { RC, isAdmin, isLeaderOrAbove } from '../state.js';
import {
  db, collection, doc, addDoc, updateDoc, deleteDoc,
  getDocs, query, where, orderBy, serverTimestamp
} from '../firebase.js';
import { GOALS_TREE } from '../data/constants.js';
import { openModal, closeModal } from '../utils/modal.js';
import { fmtDate, todayJST, isOverdue, progBar, progColor } from '../utils/helpers.js';

// ── Filter state (local, not in RC to keep RC clean) ──────
// NOTE: RC._taskFilter is the shared filter state used by other modules too.

let _taskGanttOffset = 0;

// ── Load ──────────────────────────────────────────────────

export async function loadTasks() {
  let q;
  if (isAdmin() || isLeaderOrAbove()) {
    q = query(collection(db, 'tasks'), orderBy('createdAt', 'desc'));
  } else {
    q = query(collection(db, 'tasks'), where('member', '==', RC.currentUserData?.name || ''), orderBy('createdAt', 'desc'));
  }
  const snap = await getDocs(q);
  RC._cachedTasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Populate member filter buttons
  const memberNames = [...new Set(RC._cachedTasks.map(t => t.member).filter(Boolean))].sort();
  const mFilters = document.getElementById('task-member-filters');
  if (mFilters) {
    mFilters.innerHTML = `<button class="pj-filter-btn task-member-btn ${RC._taskFilter.member==='all'?'active':''}" data-member="all" onclick="filterTaskMember('all')">全員</button>`
      + memberNames.map(n => `<button class="pj-filter-btn task-member-btn ${RC._taskFilter.member===n?'active':''}" data-member="${n}" onclick="filterTaskMember('${n}')">${n}</button>`).join('');
  }

  renderTasksFiltered();
  renderMobileTasks(getFilteredTasks());
}

export function getFilteredTasks() {
  let tasks = RC._cachedTasks;
  const today = todayJST();
  if (RC._taskFilter.status === '期限超過') {
    tasks = tasks.filter(t => t.end && t.end < today && (t.progress||0) < 1);
  } else if (RC._taskFilter.status !== 'all') {
    const statusMap = { '進行中': t => (t.progress||0)>0 && (t.progress||0)<1, '完了': t => (t.progress||0)>=1, '未着手': t => !(t.progress||0) };
    const fn = statusMap[RC._taskFilter.status];
    if (fn) tasks = tasks.filter(fn);
  }
  if (RC._taskFilter.member !== 'all') tasks = tasks.filter(t => t.member === RC._taskFilter.member);
  if (RC._taskFilter.dept   !== 'all') {
    const names = RC._cachedMembers.filter(m => m.dept === RC._taskFilter.dept).map(m => m.name);
    tasks = tasks.filter(t => names.includes(t.member));
  }
  return tasks;
}

export function renderTasksFiltered() {
  const tasks = getFilteredTasks();
  const tbody = document.getElementById('task-table-body');
  if (!tbody) return;
  const today = todayJST();
  if (!tasks.length) { tbody.innerHTML = '<tr><td colspan="8" class="empty">タスクがありません</td></tr>'; return; }
  tbody.innerHTML = tasks.map(t => {
    const over = t.end && t.end < today && (t.progress||0) < 1;
    const pct  = Math.round((t.progress||0)*100);
    const statusLabel = (t.progress||0) >= 1 ? '完了' : pct > 0 ? '進行中' : '未着手';
    const statusClass = (t.progress||0) >= 1 ? 'badge-done' : pct > 0 ? 'badge-doing' : 'badge-todo';
    return `<tr>
      <td><span style="font-weight:600">${t.name||'—'}</span></td>
      <td><span class="member-chip">${t.member||'—'}</span></td>
      <td style="font-size:11px;color:var(--ink3)">${t.start?fmtDate(t.start):'—'}</td>
      <td style="font-size:11px;color:${over?'var(--accent)':'var(--ink3)'}${over?';font-weight:700':''}" class="${over?'deadline-warn':''}">${t.end?fmtDate(t.end):'—'}</td>
      <td>${progBar(t.progress, over)}</td>
      <td style="font-size:11px;color:var(--ink3)">${t.goal||'—'}</td>
      <td style="font-size:11px;color:var(--ink2);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${t.next||''}">${t.next||'—'}</td>
      <td>${canEdit(t) ? `<button class="mini-btn" onclick="openEditTaskModal('${t.id}')">編集</button>` : ''}</td>
    </tr>`;
  }).join('');
}

function renderMobileTasks(tasks) {
  const cont = document.getElementById('m-task-list');
  if (!cont) return;
  const today = todayJST();
  if (!tasks.length) { cont.innerHTML = '<div class="empty">タスクがありません</div>'; return; }
  cont.innerHTML = tasks.map(t => {
    const over = t.end && t.end < today && (t.progress||0) < 1;
    const pct  = Math.round((t.progress||0)*100);
    const barColor = over ? '#c8472a' : (t.progress||0)>=1 ? '#3a7d5a' : '#2a5298';
    return `<div class="m-card" ${canEdit(t)?`onclick="openEditTaskModal('${t.id}')"`:''}style="cursor:${canEdit(t)?'pointer':'default'}">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px">
        <span style="font-weight:700;font-size:13px">${t.name||'—'}</span>
        <span class="badge ${pct>=100?'badge-done':pct>0?'badge-doing':'badge-todo'}">${pct>=100?'完了':pct>0?'進行中':'未着手'}</span>
      </div>
      <div style="font-size:11px;color:var(--ink3);margin-bottom:6px">
        👤 ${t.member||'—'} ｜ 📅 <span style="color:${over?'var(--accent)':'var(--ink3)'}">${t.end?fmtDate(t.end):'期限未設定'}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="flex:1;height:4px;background:var(--surface2);border-radius:2px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${barColor};border-radius:2px"></div>
        </div>
        <span style="font-size:11px;color:var(--ink3);font-family:'DM Mono',monospace">${pct}%</span>
      </div>
    </div>`;
  }).join('');
}

export function canEdit(task) {
  if (isLeaderOrAbove()) return true;
  return task.member === RC.currentUserData?.name;
}

// ── Filter handlers ───────────────────────────────────────

export function filterTaskStatus(status) {
  RC._taskFilter.status = status;
  document.querySelectorAll('.task-status-btn').forEach(b => b.classList.toggle('active', b.dataset.status === status));
  renderTasksFiltered();
  renderTaskGantt();
}

export function filterTaskMember(member) {
  RC._taskFilter.member = member;
  document.querySelectorAll('.task-member-btn').forEach(b => b.classList.toggle('active', b.dataset.member === member));
  renderTasksFiltered();
}

export function filterTaskDept(dept) {
  RC._taskFilter.dept = dept;
  document.querySelectorAll('.task-dept-btn').forEach(b => b.classList.toggle('active', b.dataset.dept === dept));
  renderTasksFiltered();
}

// ── View toggle ───────────────────────────────────────────

export function setTaskView(view) {
  const listView  = document.getElementById('task-list-view');
  const ganttView = document.getElementById('task-gantt-view');
  const listBtn   = document.getElementById('task-view-list-btn');
  const ganttBtn  = document.getElementById('task-view-gantt-btn');
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
    renderTaskGantt();
  }
}

// ── Gantt ─────────────────────────────────────────────────

const CELL_W = 26;

export function taskGanttShift(dir) {
  if (dir === 0) _taskGanttOffset = 0;
  else           _taskGanttOffset += dir;
  renderTaskGantt();
}

function renderTaskGantt() {
  const container = document.getElementById('task-gantt-container');
  if (!container) return;
  const tasks  = getFilteredTasks();
  const today  = todayJST();
  const base   = new Date(today.slice(0,7) + '-01');
  base.setMonth(base.getMonth() + _taskGanttOffset);
  const year   = base.getFullYear();
  const month  = base.getMonth();
  const days   = new Date(year, month+1, 0).getDate();

  // Build header
  let html = `<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:11px">`;
  html += `<thead><tr>
    <th class="g-label-th">タスク名</th>
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

  tasks.forEach(t => {
    const over = t.end && t.end < today && (t.progress||0) < 1;
    const done = (t.progress||0) >= 1;
    const barColor = done ? '#3a7d5a' : over ? '#c8472a' : '#2a5298';
    html += `<tr class="g-row">
      <td class="g-label-td"><div style="font-size:11px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:180px">${t.name||'—'}</div></td>
      <td class="g-label-td"><span class="member-chip" style="font-size:10px">${t.member||'—'}</span></td>
      ${Array.from({length:days},(_,i)=>{
        const d = String(i+1).padStart(2,'0');
        const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${d}`;
        const isToday = dateStr === today;
        const inRange = t.start && t.end && dateStr >= t.start && dateStr <= t.end;
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

export async function addTask() {
  const name   = document.getElementById('t-name').value.trim();
  const member = document.getElementById('t-member').value.trim();
  const progress = parseFloat(document.getElementById('t-progress').value) || 0;
  const start  = document.getElementById('t-start').value;
  const end    = document.getElementById('t-end').value;
  const goal   = document.getElementById('t-goal')?.value || '';
  const next   = document.getElementById('t-next').value.trim();

  if (!name) { alert('タスク名を入力してください'); return; }

  const dept = RC._cachedMembers.find(m => m.name === member)?.dept || RC.currentUserData?.dept || '';
  await addDoc(collection(db,'tasks'), {
    name, member, progress, start, end, goal, next, dept,
    createdAt: serverTimestamp(),
    createdBy: RC.currentUser.uid
  });
  closeModal();
  loadTasks();
}

export async function editTask(id) {
  openEditTaskModal(id);
}

export async function updateTask(id) {
  const name     = document.getElementById('t-name').value.trim();
  const member   = document.getElementById('t-member').value.trim();
  const progress = parseFloat(document.getElementById('t-progress').value) || 0;
  const start    = document.getElementById('t-start').value;
  const end      = document.getElementById('t-end').value;
  const goal     = document.getElementById('t-goal')?.value || '';
  const next     = document.getElementById('t-next').value.trim();

  if (!name) { alert('タスク名を入力してください'); return; }

  const dept = RC._cachedMembers.find(m => m.name === member)?.dept || '';
  await updateDoc(doc(db,'tasks',id), { name, member, progress, start, end, goal, next, dept });
  closeModal();
  loadTasks();
}

export async function deleteTask(id) {
  if (!confirm('このタスクを削除しますか？')) return;
  await deleteDoc(doc(db,'tasks',id));
  closeModal();
  loadTasks();
}

// ── Modal openers ─────────────────────────────────────────

export function openAddTaskModal() {
  document.getElementById('modal-title-text').textContent = '＋ タスクを追加';
  document.getElementById('modal-body').innerHTML = taskForm(null, false);
  openModal();
}

export function openEditTaskModal(id) {
  const t = RC._cachedTasks.find(x => x.id === id);
  if (!t) return;
  document.getElementById('modal-title-text').textContent = 'タスクを編集';
  document.getElementById('modal-body').innerHTML = taskForm(t, true);
  openModal();
}

function buildGoalSelect(id, selected) {
  let opts = `<option value="">（なし）</option>`;
  Object.entries(GOALS_TREE).forEach(([group, subs]) => {
    opts += `<optgroup label="${group}">`;
    subs.forEach(s => {
      opts += `<option value="${s}" ${selected===s?'selected':''}>${s}</option>`;
    });
    opts += `</optgroup>`;
  });
  return `<select class="form-input" id="${id}">${opts}</select>`;
}

function taskForm(t, isEdit) {
  const mList = RC._cachedMembers.map(m => m.name);
  let memberField;
  if (isLeaderOrAbove()) {
    const memberOpts = ['', ...mList, '未担当'].map(m => `<option ${t?.member===m?'selected':''}>${m}</option>`).join('');
    memberField = `<select class="form-input" id="t-member">${memberOpts}</select>`;
  } else {
    const myName = RC.currentUserData?.name || '';
    memberField = `<input class="form-input" id="t-member" value="${t?.member||myName}" readonly style="background:var(--surface2);color:var(--ink3);cursor:not-allowed">`;
  }
  const progOpts = [0,0.2,0.4,0.6,0.8,1].map(v=>`<option value="${v}" ${t?.progress===v?'selected':''}>${Math.round(v*100)}%</option>`).join('');
  const goalSelect = buildGoalSelect('t-goal', t?.goal||'');
  return `
    <div class="form-row"><label class="form-label">タスク名</label>
      <input class="form-input" id="t-name" value="${t?.name||''}" placeholder="タスク名を入力"></div>
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">担当者</label>${memberField}</div>
      <div class="form-row"><label class="form-label">進捗</label>
        <select class="form-input" id="t-progress">${progOpts}</select></div>
    </div>
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">開始日</label>
        <input type="date" class="form-input" id="t-start" value="${t?.start||''}"></div>
      <div class="form-row"><label class="form-label">期限</label>
        <input type="date" class="form-input" id="t-end" value="${t?.end||''}"></div>
    </div>
    <div class="form-row"><label class="form-label">紐づく目標</label>${goalSelect}</div>
    <div class="form-row"><label class="form-label">ネクストアクション</label>
      <input class="form-input" id="t-next" value="${t?.next||''}" placeholder="次にやること"></div>
    <div class="btn-row">
      ${isEdit ? `<button class="btn" style="background:#fee2e2;color:var(--accent);border:none" onclick="deleteTask('${t.id}')">削除</button>` : ''}
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="${isEdit?`updateTask('${t.id}')`:'addTask()'}">
        ${isEdit?'更新':'追加する'}
      </button>
    </div>`;
}

// ── Window exports ────────────────────────────────────────
window.loadTasks          = loadTasks;
window.getFilteredTasks   = getFilteredTasks;
window.renderTasksFiltered = renderTasksFiltered;
window.filterTaskStatus   = filterTaskStatus;
window.filterTaskMember   = filterTaskMember;
window.filterTaskDept     = filterTaskDept;
window.setTaskView        = setTaskView;
window.taskGanttShift     = taskGanttShift;
window.addTask            = addTask;
window.editTask           = editTask;
window.updateTask         = updateTask;
window.deleteTask         = deleteTask;
window.openAddTaskModal   = openAddTaskModal;
window.openEditTaskModal  = openEditTaskModal;
window.canEdit            = canEdit;
