// ============================================================
// Member Tasks module — 秘書タスク管理
// member_tasks コレクションのCRUD + メンバーウィジェット + 管理者セクション
// ============================================================
import { RC, isAdmin, isLeaderOrAbove } from '../state.js';
import {
  db, collection, doc, addDoc, updateDoc, deleteDoc,
  getDocs, query, where, orderBy, serverTimestamp, getDoc
} from '../firebase.js';
import { openModal, closeModal } from '../utils/modal.js';
import { todayJST } from '../utils/helpers.js';

const COL = 'member_tasks';

// ── Priority config ──────────────────────────────────────
const PRIORITY_MAP = {
  high:   { label: '高', color: '#c8472a', bg: '#fee2e2' },
  medium: { label: '中', color: '#d97706', bg: '#fef3c7' },
  low:    { label: '低', color: '#2563eb', bg: '#dbeafe' },
};

const STATUS_MAP = {
  pending:     { label: '未着手', icon: '⬜', color: 'var(--ink3)' },
  in_progress: { label: '進行中', icon: '🔵', color: 'var(--blue)' },
  completed:   { label: '完了',   icon: '✅', color: 'var(--accent2)' },
};

// ══════════════════════════════════════════════════════════
// 1. メンバーダッシュボード用ウィジェット
// ══════════════════════════════════════════════════════════

export async function loadMemberTaskWidget() {
  const widget = document.getElementById('m-member-task-widget');
  if (!widget) return;
  if (!RC.currentUser) return;

  try {
    const q = query(
      collection(db, COL),
      where('memberId', '==', RC.currentUser.uid),
      where('status', 'in', ['pending', 'in_progress']),
      orderBy('dueDate', 'asc')
    );
    const snap = await getDocs(q);
    const tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (!tasks.length) {
      widget.style.display = 'none';
      return;
    }

    const today = todayJST();
    const html = tasks.map(t => {
      const st = STATUS_MAP[t.status] || STATUS_MAP.pending;
      const pr = PRIORITY_MAP[t.priority] || PRIORITY_MAP.medium;
      const dueStr = t.dueDate ? formatDueDate(t.dueDate, today) : '';
      const isOverdue = t.dueDate && t.dueDate < today && t.status !== 'completed';
      return `
        <div class="mt-widget-item" data-id="${t.id}" style="cursor:default">
          <div style="display:flex;align-items:flex-start;gap:10px">
            <span style="font-size:16px;margin-top:1px;flex-shrink:0;transition:transform .2s">${st.icon}</span>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600;color:var(--ink);line-height:1.4">${esc(t.title)}</div>
              ${t.description ? `<div style="font-size:11px;color:var(--ink3);margin-top:2px;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.description)}</div>` : ''}
              <div style="display:flex;align-items:center;gap:8px;margin-top:4px;flex-wrap:wrap">
                ${dueStr ? `<span style="font-size:10px;color:${isOverdue ? 'var(--accent)' : 'var(--ink3)'};font-weight:${isOverdue ? '700' : '400'};font-family:'DM Mono',monospace">${isOverdue ? '⚠️ ' : '📅 '}${dueStr}</span>` : ''}
                <span style="font-size:9px;padding:2px 6px;border-radius:10px;background:${pr.bg};color:${pr.color};font-weight:600">${pr.label}</span>
                ${t.category ? `<span style="font-size:9px;padding:2px 6px;border-radius:10px;background:var(--surface2);color:var(--ink3)">${esc(t.category)}</span>` : ''}
              </div>
            </div>
          </div>
        </div>`;
    }).join('');

    widget.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-size:16px">📋</span>
        <span style="font-size:12px;font-weight:700;color:var(--ink)">あなたのタスク</span>
        <span style="font-size:10px;color:var(--ink3);font-family:'DM Mono',monospace;margin-left:auto">${tasks.length}件</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">${html}</div>
    `;
    widget.style.display = 'block';
  } catch (e) {
    console.log('Member task widget load failed:', e);
    widget.style.display = 'none';
  }
}

// メンバーがタスクの完了をトグル
async function toggleMemberTask(taskId, currentStatus) {
  const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
  if (newStatus === 'completed') {
    if (!confirm('本当に完了しましたか？\n\nこちらで完了にするとLINE秘書からのリマインド通知も来なくなります。')) return;
  }
  try {
    const updateData = {
      status: newStatus,
      updatedAt: serverTimestamp(),
    };
    // 完了にしたときはsyncPendingフラグを立てる（LINE秘書Botがスプレッドシートに同期する）
    // 未完了に戻したときもフラグを立てて同期対象にする
    if (newStatus === 'completed' || currentStatus === 'completed') {
      updateData.syncPending = true;
    }
    await updateDoc(doc(db, COL, taskId), updateData);
    loadMemberTaskWidget();
  } catch (e) {
    console.error('Task status update failed:', e);
    alert('タスクの更新に失敗しました');
  }
}

// ══════════════════════════════════════════════════════════
// 1b. 管理者・リーダー用 — メンバータスク状況一覧ウィジェット
// ══════════════════════════════════════════════════════════

export async function loadTaskSummaryWidget() {
  const widget = document.getElementById('task-summary-widget');
  if (!widget) return;
  if (!isLeaderOrAbove()) { widget.style.display = 'none'; return; }

  try {
    // pending / in_progress のタスクを全件取得
    const q = query(
      collection(db, COL),
      where('status', 'in', ['pending', 'in_progress'])
    );
    const snap = await getDocs(q);
    const tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // memberId でグルーピング
    const countMap = {};  // memberId -> count
    tasks.forEach(t => {
      const mid = t.memberId || '_unlinked';
      countMap[mid] = (countMap[mid] || 0) + 1;
    });

    // 社員メンバーのみ（委託メンバーは除外）
    const members = (RC._cachedMembers || [])
      .filter(m => !m.isAlliance && !m.noAuth && m.role !== '委託' && m.role !== 'alliance' && !m.id?.startsWith('alliance_'))
      .map(m => ({
        id: m.id,
        name: m.name || '不明',
        count: countMap[m.id] || 0,
      }));

    // 件数が多い順にソート
    members.sort((a, b) => b.count - a.count);

    // 折りたたみ対応のHTML構築
    const rows = members.map(m => {
      const warn = m.count >= 5;
      const zero = m.count === 0;
      const badge = warn ? ' <span style="font-size:12px">⚠️</span>'
                   : zero ? ' <span style="font-size:12px">✅</span>' : '';
      const countColor = warn ? 'var(--accent)' : zero ? 'var(--accent2)' : 'var(--ink)';
      const countWeight = warn ? '700' : '500';
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:13px;color:var(--ink);font-weight:500">${esc(m.name)}</span>
          <span style="font-size:12px;color:${countColor};font-weight:${countWeight};font-family:'DM Mono',monospace;white-space:nowrap">
            ${zero ? '0件' : `残り ${m.count}件`}${badge}
          </span>
        </div>`;
    }).join('');

    // 未紐づけタスクがあれば注記
    const unlinkCount = countMap['_unlinked'] || 0;
    const unlinkNote = unlinkCount > 0
      ? `<div style="font-size:10px;color:var(--warn);margin-top:8px;font-weight:600">⚠ 未紐づけタスク: ${unlinkCount}件</div>`
      : '';

    const totalPending = tasks.length;

    widget.innerHTML = `
      <details open>
        <summary style="display:flex;align-items:center;gap:8px;cursor:pointer;list-style:none;user-select:none">
          <span style="font-size:16px">📋</span>
          <span style="font-size:12px;font-weight:700;color:var(--ink)">メンバータスク状況</span>
          <span style="font-size:10px;color:var(--ink3);font-family:'DM Mono',monospace;margin-left:auto">全${totalPending}件</span>
          <span style="font-size:10px;color:var(--ink3);transition:transform .2s;margin-left:4px">▼</span>
        </summary>
        <div style="margin-top:8px">
          ${members.length ? rows : '<div style="font-size:12px;color:var(--ink3);padding:8px 0">メンバーがいません</div>'}
          ${unlinkNote}
        </div>
      </details>
    `;
    // details の開閉でアイコン回転
    const det = widget.querySelector('details');
    if (det) {
      det.addEventListener('toggle', () => {
        const arrow = det.querySelector('summary span:last-child');
        if (arrow) arrow.style.transform = det.open ? '' : 'rotate(-90deg)';
      });
    }
    widget.style.display = 'block';
  } catch (e) {
    console.log('Task summary widget load failed:', e);
    widget.style.display = 'none';
  }
}

// ══════════════════════════════════════════════════════════
// 1c. 管理者ダッシュボード用 — 未紐づけタスク紐づけウィジェット
// ══════════════════════════════════════════════════════════

export async function loadUnlinkedTasksWidget() {
  const widget = document.getElementById('unlinked-tasks-widget');
  if (!widget) return;
  if (!isAdmin()) { widget.style.display = 'none'; return; }

  try {
    const q = query(
      collection(db, COL),
      where('isLinked', '==', false)
    );
    const snap = await getDocs(q);
    const tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (!tasks.length) {
      widget.style.display = 'none';
      return;
    }

    // メンバー選択肢
    const memberOpts = (RC._cachedMembers || []).map(m =>
      `<option value="${m.id}">${esc(m.name)}</option>`
    ).join('');

    const rows = tasks.map(t => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface);border:1px solid rgba(217,119,6,.2);border-radius:8px">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">「${esc(t.title)}」</div>
          <div style="font-size:11px;color:var(--ink3);margin-top:2px">担当: ${esc(t.memberName || '不明')}</div>
        </div>
        <select id="link-sel-${t.id}" style="font-size:12px;padding:5px 8px;border:1.5px solid var(--border);border-radius:6px;background:var(--surface);color:var(--ink);min-width:100px;max-width:140px">
          <option value="">メンバー選択</option>
          ${memberOpts}
        </select>
        <button onclick="linkTaskFromWidget('${t.id}')"
          style="font-size:11px;font-weight:600;padding:6px 14px;border:none;border-radius:6px;background:var(--blue);color:#fff;cursor:pointer;white-space:nowrap;transition:opacity .15s"
          onmouseenter="this.style.opacity='0.85'" onmouseleave="this.style.opacity='1'">紐づける</button>
      </div>
    `).join('');

    widget.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-size:16px">⚠️</span>
        <span style="font-size:12px;font-weight:700;color:#d97706">未紐づけタスク（${tasks.length}件）</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">${rows}</div>
    `;
    widget.style.display = 'block';
  } catch (e) {
    console.log('Unlinked tasks widget load failed:', e);
    widget.style.display = 'none';
  }
}

async function linkTaskFromWidget(taskId) {
  const sel = document.getElementById(`link-sel-${taskId}`);
  if (!sel || !sel.value) { alert('メンバーを選択してください'); return; }
  const memberId = sel.value;
  const user = (RC._cachedMembers || []).find(m => m.id === memberId);
  if (!user) { alert('メンバーが見つかりません'); return; }

  try {
    await updateDoc(doc(db, COL, taskId), {
      memberId: memberId,
      memberName: (user.name || '').split(/\s+/)[0] || user.name,
      isLinked: true,
      updatedAt: serverTimestamp(),
    });
    // ウィジェットをリロード
    loadUnlinkedTasksWidget();
    // タスクサマリーも更新
    if (window.loadTaskSummaryWidget) window.loadTaskSummaryWidget();
  } catch (e) {
    console.error('Task link failed:', e);
    alert('紐づけに失敗しました');
  }
}

// ══════════════════════════════════════════════════════════
// 2. 管理者画面用 — タスク一覧・追加・編集・削除・紐づけ
// ══════════════════════════════════════════════════════════

let _adminMemberTasks = [];
let _adminMTFilter = { member: 'all', status: 'all' };

export async function loadAdminMemberTasks() {
  const q = query(collection(db, COL), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  _adminMemberTasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  RC._cachedMemberTasks = _adminMemberTasks;
  renderAdminMemberTasks();
}

function getFilteredAdminMT() {
  let tasks = _adminMemberTasks;
  if (_adminMTFilter.member !== 'all') {
    tasks = tasks.filter(t => t.memberName === _adminMTFilter.member);
  }
  if (_adminMTFilter.status !== 'all') {
    if (_adminMTFilter.status === 'unlinked') {
      tasks = tasks.filter(t => !t.isLinked);
    } else {
      tasks = tasks.filter(t => t.status === _adminMTFilter.status);
    }
  }
  return tasks;
}

function renderAdminMemberTasks() {
  const container = document.getElementById('admin-mt-list');
  const mContainer = document.getElementById('m-admin-mt-list');

  const tasks = getFilteredAdminMT();
  const today = todayJST();

  // メンバーフィルターボタン
  const members = [...new Set(_adminMemberTasks.map(t => t.memberName).filter(Boolean))].sort();
  const mFilterEl = document.getElementById('admin-mt-member-filters');
  if (mFilterEl) {
    mFilterEl.innerHTML = `<button class="pj-filter-btn admin-mt-member-btn ${_adminMTFilter.member==='all'?'active':''}" onclick="filterAdminMTMember('all')">全員</button>`
      + members.map(n => `<button class="pj-filter-btn admin-mt-member-btn ${_adminMTFilter.member===n?'active':''}" onclick="filterAdminMTMember('${esc(n)}')">${esc(n)}</button>`).join('');
  }

  // 未紐づけ件数バッジ
  const unlinkCount = _adminMemberTasks.filter(t => !t.isLinked).length;
  const unlinkBadge = document.getElementById('admin-mt-unlink-badge');
  if (unlinkBadge) {
    unlinkBadge.textContent = unlinkCount;
    unlinkBadge.style.display = unlinkCount > 0 ? 'inline-flex' : 'none';
  }
  const pcUnlinkBadge = document.getElementById('mt-unlink-badge-pc');
  if (pcUnlinkBadge) {
    pcUnlinkBadge.textContent = unlinkCount;
    pcUnlinkBadge.style.display = unlinkCount > 0 ? 'inline-flex' : 'none';
  }

  // KPI (PC)
  const kpiTotal = document.getElementById('mt-kpi-total');
  const kpiPending = document.getElementById('mt-kpi-pending');
  const kpiDone = document.getElementById('mt-kpi-done');
  const kpiUnlinked = document.getElementById('mt-kpi-unlinked');
  if (kpiTotal) kpiTotal.textContent = _adminMemberTasks.length;
  if (kpiPending) kpiPending.textContent = _adminMemberTasks.filter(t => t.status === 'pending' || t.status === 'in_progress').length;
  if (kpiDone) kpiDone.textContent = _adminMemberTasks.filter(t => t.status === 'completed').length;
  if (kpiUnlinked) kpiUnlinked.textContent = unlinkCount;

  // KPI (Mobile)
  const mKpiTotal = document.getElementById('m-mt-kpi-total');
  const mKpiUnlinked = document.getElementById('m-mt-kpi-unlinked');
  if (mKpiTotal) mKpiTotal.textContent = _adminMemberTasks.length;
  if (mKpiUnlinked) mKpiUnlinked.textContent = unlinkCount;

  const emptyHtml = '<div class="empty" style="padding:24px;text-align:center;color:var(--ink3)">タスクがありません</div>';
  if (!tasks.length) {
    if (container) container.innerHTML = emptyHtml;
    if (mContainer) mContainer.innerHTML = emptyHtml;
    return;
  }

  const listHtml = tasks.map(t => {
    const st = STATUS_MAP[t.status] || STATUS_MAP.pending;
    const pr = PRIORITY_MAP[t.priority] || PRIORITY_MAP.medium;
    const isOverdue = t.dueDate && t.dueDate < today && t.status !== 'completed';
    const dueStr = t.dueDate ? formatDueDate(t.dueDate, today) : '期限未設定';
    return `
      <div class="m-card" style="cursor:pointer;border-left:3px solid ${pr.color};${!t.isLinked ? 'background:rgba(217,119,6,.04);' : ''}" onclick="openEditMemberTaskModal('${t.id}')">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
          <div style="font-size:13px;font-weight:700;flex:1;padding-right:8px">${st.icon} ${esc(t.title)}</div>
          <div style="display:flex;gap:4px;flex-shrink:0">
            ${!t.isLinked ? '<span style="font-size:9px;padding:2px 6px;border-radius:10px;background:#fef3c7;color:#d97706;font-weight:600">未紐づけ</span>' : ''}
            <span style="font-size:9px;padding:2px 6px;border-radius:10px;background:${pr.bg};color:${pr.color};font-weight:600">${pr.label}</span>
          </div>
        </div>
        ${t.description ? `<div style="font-size:11px;color:var(--ink3);margin-bottom:6px;line-height:1.4">${esc(t.description)}</div>` : ''}
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span class="member-chip">${esc(t.memberName || '未割当')}</span>
          <span style="font-size:10px;color:${isOverdue ? 'var(--accent)' : 'var(--ink3)'};font-weight:${isOverdue ? '700' : '400'};font-family:'DM Mono',monospace">${isOverdue ? '⚠️ ' : '📅 '}${dueStr}</span>
          <span style="font-size:10px;color:${st.color};font-weight:600">${st.label}</span>
          ${t.category ? `<span style="font-size:9px;padding:2px 6px;border-radius:10px;background:var(--surface2);color:var(--ink3)">${esc(t.category)}</span>` : ''}
        </div>
      </div>`;
  }).join('');

  if (container) container.innerHTML = listHtml;
  if (mContainer) mContainer.innerHTML = listHtml;
}

// ── フィルター ────────────────────────────────────────────

function filterAdminMTMember(member) {
  _adminMTFilter.member = member;
  document.querySelectorAll('.admin-mt-member-btn').forEach(b => b.classList.toggle('active', b.textContent.trim() === (member === 'all' ? '全員' : member)));
  renderAdminMemberTasks();
}

function filterAdminMTStatus(status) {
  _adminMTFilter.status = status;
  document.querySelectorAll('.admin-mt-status-btn').forEach(b => b.classList.toggle('active', b.dataset.status === status));
  renderAdminMemberTasks();
}

// ── CRUD ──────────────────────────────────────────────────

async function addMemberTask() {
  const memberName = document.getElementById('mt-member-name').value.trim();
  const title = document.getElementById('mt-title').value.trim();
  const description = document.getElementById('mt-description').value.trim();
  const dueDate = document.getElementById('mt-due-date').value;
  const priority = document.getElementById('mt-priority').value;
  const category = document.getElementById('mt-category').value.trim();

  if (!title) { alert('タスク名を入力してください'); return; }
  if (!memberName) { alert('メンバー名を入力してください'); return; }

  // 自動紐づけ
  const linkResult = autoLinkMember(memberName);

  const taskData = {
    memberId: linkResult.memberId || '',
    memberName: memberName,
    title,
    description,
    dueDate: dueDate || '',
    priority: priority || 'medium',
    status: 'pending',
    category,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: RC.currentUser?.uid || '',
    isLinked: linkResult.isLinked,
  };

  await addDoc(collection(db, COL), taskData);
  closeModal();

  if (linkResult.multiple) {
    alert(`「${memberName}」に該当するメンバーが複数います。管理者画面で正しいメンバーを選択してください。`);
  }

  loadAdminMemberTasks();
}

async function updateMemberTask(id) {
  const memberName = document.getElementById('mt-member-name').value.trim();
  const title = document.getElementById('mt-title').value.trim();
  const description = document.getElementById('mt-description').value.trim();
  const dueDate = document.getElementById('mt-due-date').value;
  const priority = document.getElementById('mt-priority').value;
  const status = document.getElementById('mt-status').value;
  const category = document.getElementById('mt-category').value.trim();

  if (!title) { alert('タスク名を入力してください'); return; }

  const existing = _adminMemberTasks.find(t => t.id === id);
  const nameChanged = existing && existing.memberName !== memberName;

  let updateData = {
    title, description, dueDate: dueDate || '', priority, status, category,
    updatedAt: serverTimestamp(),
  };

  // メンバー名が変わった場合は再紐づけ
  if (nameChanged && memberName) {
    const linkResult = autoLinkMember(memberName);
    updateData.memberName = memberName;
    updateData.memberId = linkResult.memberId || '';
    updateData.isLinked = linkResult.isLinked;
    if (linkResult.multiple) {
      alert(`「${memberName}」に該当するメンバーが複数います。管理者画面で正しいメンバーを選択してください。`);
    }
  }

  await updateDoc(doc(db, COL, id), updateData);
  closeModal();
  loadAdminMemberTasks();
}

async function deleteMemberTask(id) {
  if (!confirm('このタスクを削除しますか？')) return;
  await deleteDoc(doc(db, COL, id));
  closeModal();
  loadAdminMemberTasks();
}

// ── 紐づけ ────────────────────────────────────────────────

function autoLinkMember(name) {
  const matches = RC._cachedMembers.filter(m => {
    // 苗字で部分一致
    const lastName = (m.name || '').split(/\s+/)[0];
    return lastName === name || m.name === name;
  });

  if (matches.length === 1) {
    return { memberId: matches[0].id, isLinked: true, multiple: false };
  } else if (matches.length > 1) {
    return { memberId: '', isLinked: false, multiple: true };
  }
  return { memberId: '', isLinked: false, multiple: false };
}

async function linkMemberTaskToUser(taskId, userId) {
  const user = RC._cachedMembers.find(m => m.id === userId);
  if (!user) return;
  await updateDoc(doc(db, COL, taskId), {
    memberId: userId,
    memberName: (user.name || '').split(/\s+/)[0] || user.name,
    isLinked: true,
    updatedAt: serverTimestamp(),
  });
  loadAdminMemberTasks();
}

// ── モーダル ──────────────────────────────────────────────

function openAddMemberTaskModal() {
  document.getElementById('modal-title-text').textContent = '＋ 秘書タスクを追加';
  document.getElementById('modal-body').innerHTML = memberTaskForm(null, false);
  openModal();
}

function openEditMemberTaskModal(id) {
  const t = _adminMemberTasks.find(x => x.id === id);
  if (!t) return;
  document.getElementById('modal-title-text').textContent = '秘書タスクを編集';
  document.getElementById('modal-body').innerHTML = memberTaskForm(t, true);
  openModal();
}

function memberTaskForm(t, isEdit) {
  const memberOpts = RC._cachedMembers.map(m => {
    const lastName = (m.name || '').split(/\s+/)[0] || m.name;
    return `<option value="${esc(lastName)}" ${t?.memberName === lastName ? 'selected' : ''}>${esc(m.name)}</option>`;
  }).join('');

  const priorityOpts = ['high', 'medium', 'low'].map(p => {
    const pr = PRIORITY_MAP[p];
    return `<option value="${p}" ${(t?.priority || 'medium') === p ? 'selected' : ''}>${pr.label}</option>`;
  }).join('');

  const statusOpts = isEdit ? ['pending', 'in_progress', 'completed'].map(s => {
    const st = STATUS_MAP[s];
    return `<option value="${s}" ${t?.status === s ? 'selected' : ''}>${st.label}</option>`;
  }).join('') : '';

  // 紐づけUI
  let linkHtml = '';
  if (isEdit && !t.isLinked) {
    const linkOpts = RC._cachedMembers.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    linkHtml = `
      <div style="background:rgba(217,119,6,.08);border:1px solid rgba(217,119,6,.25);border-radius:8px;padding:10px 12px;margin-bottom:12px">
        <div style="font-size:11px;font-weight:700;color:#d97706;margin-bottom:6px">⚠️ メンバー未紐づけ</div>
        <div style="display:flex;gap:8px;align-items:center">
          <select class="form-input" id="mt-link-user" style="flex:1;font-size:12px">
            <option value="">-- メンバーを選択 --</option>
            ${linkOpts}
          </select>
          <button class="btn btn-primary" style="font-size:11px;padding:6px 12px;white-space:nowrap" onclick="doLinkMemberTask('${t.id}')">紐づける</button>
        </div>
      </div>`;
  }

  return `
    ${linkHtml}
    <div class="form-row"><label class="form-label">タスク名</label>
      <input class="form-input" id="mt-title" value="${esc(t?.title || '')}" placeholder="例: 健康診断の書類提出"></div>
    <div class="form-row"><label class="form-label">詳細</label>
      <textarea class="form-input" id="mt-description" rows="2" placeholder="タスクの詳細（任意）">${esc(t?.description || '')}</textarea></div>
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">メンバー（苗字）</label>
        <select class="form-input" id="mt-member-name">
          <option value="">-- 選択 --</option>
          ${memberOpts}
        </select>
      </div>
      <div class="form-row"><label class="form-label">優先度</label>
        <select class="form-input" id="mt-priority">${priorityOpts}</select></div>
    </div>
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">期限</label>
        <input type="date" class="form-input" id="mt-due-date" value="${t?.dueDate || ''}"></div>
      ${isEdit ? `<div class="form-row"><label class="form-label">ステータス</label>
        <select class="form-input" id="mt-status">${statusOpts}</select></div>` : '<div class="form-row"></div>'}
    </div>
    <div class="form-row"><label class="form-label">カテゴリ</label>
      <input class="form-input" id="mt-category" value="${esc(t?.category || '')}" placeholder="例: 事務手続き, 研修"></div>
    <div class="btn-row">
      ${isEdit ? `<button class="btn" style="background:#fee2e2;color:var(--accent);border:none" onclick="deleteMemberTask('${t.id}')">削除</button>` : ''}
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="${isEdit ? `updateMemberTask('${t.id}')` : 'addMemberTask()'}">
        ${isEdit ? '更新' : '追加する'}
      </button>
    </div>`;
}

function doLinkMemberTask(taskId) {
  const sel = document.getElementById('mt-link-user');
  if (!sel || !sel.value) { alert('メンバーを選択してください'); return; }
  linkMemberTaskToUser(taskId, sel.value);
  closeModal();
}

// ── Util ──────────────────────────────────────────────────

function esc(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDueDate(dueDate, today) {
  if (!dueDate) return '';
  const [y, m, d] = dueDate.split('-');
  const mo = parseInt(m, 10);
  const da = parseInt(d, 10);
  return `${mo}/${da}`;
}

// ── Window exports ────────────────────────────────────────
window.loadMemberTaskWidget      = loadMemberTaskWidget;
window.loadTaskSummaryWidget     = loadTaskSummaryWidget;
window.toggleMemberTask          = toggleMemberTask;
window.loadAdminMemberTasks      = loadAdminMemberTasks;
window.filterAdminMTMember       = filterAdminMTMember;
window.filterAdminMTStatus       = filterAdminMTStatus;
window.addMemberTask             = addMemberTask;
window.updateMemberTask          = updateMemberTask;
window.deleteMemberTask          = deleteMemberTask;
window.openAddMemberTaskModal    = openAddMemberTaskModal;
window.openEditMemberTaskModal   = openEditMemberTaskModal;
window.doLinkMemberTask          = doLinkMemberTask;
window.linkMemberTaskToUser      = linkMemberTaskToUser;
window.loadUnlinkedTasksWidget   = loadUnlinkedTasksWidget;
window.linkTaskFromWidget        = linkTaskFromWidget;
