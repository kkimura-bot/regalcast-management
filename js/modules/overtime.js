// ============================================================
// Overtime requests (残業申請) module
// Collection: overtimeRequests
// Doc shape:
//   { uid, name, dept, date, minutes, reason, hasShift,
//     status: 'pending' | 'approved' | 'rejected',
//     createdAt (ISO),
//     approvedBy, approvedAt, rejectedBy, rejectedAt }
// ============================================================
import { RC, isAdmin } from '../state.js';
import {
  db, collection, doc, setDoc, addDoc, getDocs, updateDoc,
  query, where, orderBy
} from '../firebase.js';
import { openModal, closeModal } from '../utils/modal.js';
import { escHtml, todayJST } from '../utils/helpers.js';

// ---- State ------------------------------------------------
let _cachedRequests = [];
let _adminTab = 'pending';

const STATUS_META = {
  pending:  { label: '承認待ち', icon: '⏳', bg: 'rgba(217,119,6,.10)',  color: '#D97706' },
  '未承認': { label: '承認待ち', icon: '⏳', bg: 'rgba(217,119,6,.10)',  color: '#D97706' },
  approved: { label: '承認済み', icon: '✅', bg: 'rgba(5,150,105,.10)',  color: '#059669' },
  rejected: { label: '却下',     icon: '❌', bg: 'rgba(239,68,68,.10)',  color: '#EF4444' },
};

const isPending = r => r.status === 'pending' || r.status === '未承認';

function fmtMinutes(m) {
  const h = Math.floor(m / 60), min = m % 60;
  return (h > 0 ? h + '時間' : '') + (min > 0 ? min + '分' : '');
}

// ---- CSS --------------------------------------------------
function injectCSS() {
  if (document.getElementById('overtime-css')) return;
  const s = document.createElement('style');
  s.id = 'overtime-css';
  s.textContent = `
    .ot-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px; }
    .ot-title  { font-size:20px; font-weight:800; color:var(--ink); display:flex; align-items:center; gap:8px; letter-spacing:-0.3px; }
    .ot-sub    { font-size:12px; color:var(--ink3); margin-top:2px; }
    .ot-tabs   { display:flex; gap:4px; border-bottom:1.5px solid var(--border); margin-bottom:16px; overflow-x:auto; -webkit-overflow-scrolling:touch; }
    .ot-tab    { padding:9px 14px; background:none; border:none; border-bottom:2px solid transparent; font-size:12px; font-weight:600; color:var(--ink3); cursor:pointer; white-space:nowrap; font-family:inherit; transition:color .15s,border-color .15s; }
    .ot-tab:hover { color:var(--ink2); }
    .ot-tab.active { color:var(--ink); border-bottom-color:var(--warn); font-weight:700; }
    .ot-tab .ot-count { display:inline-block; margin-left:4px; padding:1px 7px; border-radius:99px; background:rgba(217,119,6,.12); color:#D97706; font-size:10px; font-weight:700; }
    .ot-tab.active .ot-count { background:#D97706; color:#fff; }
    .ot-card  { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:14px 16px; margin-bottom:10px; }
    .ot-card-head { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px; gap:8px; }
    .ot-badge { display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:99px; font-size:11px; font-weight:700; white-space:nowrap; }
    .ot-meta  { font-size:12px; color:var(--ink3); margin-top:4px; }
    .ot-actions { display:flex; gap:6px; margin-top:10px; flex-wrap:wrap; }
    .ot-btn-approve { padding:7px 14px; border:none; border-radius:8px; background:rgba(5,150,105,.12); color:#059669; font-size:12px; font-weight:700; cursor:pointer; font-family:inherit; }
    .ot-btn-approve:hover { background:rgba(5,150,105,.22); }
    .ot-btn-reject  { padding:7px 14px; border:none; border-radius:8px; background:rgba(239,68,68,.10); color:#EF4444; font-size:12px; font-weight:700; cursor:pointer; font-family:inherit; }
    .ot-btn-reject:hover  { background:rgba(239,68,68,.20); }
    .ot-empty { text-align:center; padding:40px 20px; color:var(--ink3); font-size:13px; }
  `;
  document.head.appendChild(s);
}

// ---- Fetch ------------------------------------------------
async function fetchRequests() {
  try {
    let q;
    if (isAdmin()) {
      q = query(collection(db, 'overtimeRequests'), orderBy('createdAt', 'desc'));
    } else {
      q = query(collection(db, 'overtimeRequests'),
        where('uid', '==', RC.currentUser.uid));
    }
    const snap = await getDocs(q);
    _cachedRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!isAdmin()) {
      _cachedRequests.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    }
  } catch (e) {
    console.error('残業申請取得エラー:', e);
    _cachedRequests = [];
  }
}

// ---- Root loader ------------------------------------------
export async function loadOvertimeRequests() {
  injectCSS();
  ['overtime-content', 'm-overtime-content'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<div style="padding:30px;text-align:center;color:var(--ink3);font-size:12px">読み込み中…</div>';
  });
  await fetchRequests();
  if (isAdmin()) renderAdmin(); else renderMember();
  updateOvertimeBadge();
}

// ---- Admin view -------------------------------------------
function renderAdmin() {
  const TABS = [
    { key: 'pending',  label: '承認待ち', items: _cachedRequests.filter(isPending)                     },
    { key: 'approved', label: '承認済み', items: _cachedRequests.filter(r => r.status === 'approved')  },
    { key: 'rejected', label: '却下',     items: _cachedRequests.filter(r => r.status === 'rejected')  },
    { key: 'all',      label: '全件',     items: _cachedRequests },
  ];
  const activeItems = (TABS.find(t => t.key === _adminTab) || TABS[0]).items;

  const tabsHtml = TABS.map(t => `
    <button class="ot-tab ${t.key === _adminTab ? 'active' : ''}" onclick="setOvertimeAdminTab('${t.key}')">
      ${t.label}${t.key === 'pending' && t.items.length > 0 ? `<span class="ot-count">${t.items.length}</span>` : ''}
    </button>`).join('');

  const cardsHtml = activeItems.length
    ? activeItems.map(renderAdminCard).join('')
    : `<div class="ot-empty">⏰<br>${_adminTab === 'pending' ? '承認待ちの申請はありません' : '該当する申請はありません'}</div>`;

  const html = `
    <div class="ot-header">
      <div>
        <div class="ot-title">⏰ 残業申請（管理）</div>
        <div class="ot-sub">メンバーからの残業申請を承認・却下できます</div>
      </div>
    </div>
    <div class="ot-tabs">${tabsHtml}</div>
    <div id="ot-list">${cardsHtml}</div>`;

  ['overtime-content', 'm-overtime-content'].forEach(id => {
    const el = document.getElementById(id); if (el) el.innerHTML = html;
  });
}

function renderAdminCard(r) {
  const s = STATUS_META[r.status] || STATUS_META.pending;
  const needsAction = isPending(r);
  const dateStr = r.date || '—';
  const encodedName = encodeURIComponent(r.name || '');
  return `
    <div class="ot-card">
      <div class="ot-card-head">
        <div>
          <div style="font-size:13px;font-weight:700">${escHtml(r.name || '—')}</div>
          <div style="font-size:12px;color:var(--ink3);margin-top:2px">${dateStr}　⏱ ${fmtMinutes(r.minutes || 0)}</div>
        </div>
        <span class="ot-badge" style="background:${s.bg};color:${s.color}">${s.icon} ${s.label}</span>
      </div>
      ${r.reason ? `<div class="ot-meta">📝 ${escHtml(r.reason)}</div>` : ''}
      ${r.approvedBy ? `<div class="ot-meta">承認者：${escHtml(r.approvedBy)}</div>` : ''}
      ${r.rejectedBy ? `<div class="ot-meta">却下者：${escHtml(r.rejectedBy)}</div>` : ''}
      ${needsAction ? `
        <div class="ot-actions">
          <button class="ot-btn-approve" onclick="approveOvertime('${r.id}','${r.uid}','${dateStr}',${r.minutes || 0})">✅ 承認</button>
          <button class="ot-btn-reject"  onclick="rejectOvertime('${r.id}','${r.uid}','${dateStr}')">✕ 却下</button>
        </div>` : ''}
    </div>`;
}

// ---- Member view ------------------------------------------
function renderMember() {
  const mine = _cachedRequests.filter(r => r.uid === RC.currentUser?.uid);
  const cardsHtml = mine.length
    ? mine.map(renderMemberCard).join('')
    : `<div class="ot-empty">⏰<br>残業申請はまだありません</div>`;

  const html = `
    <div class="ot-header">
      <div>
        <div class="ot-title">⏰ 残業申請</div>
        <div class="ot-sub">自分の申請履歴を確認できます</div>
      </div>
    </div>
    <div>${cardsHtml}</div>`;

  ['overtime-content', 'm-overtime-content'].forEach(id => {
    const el = document.getElementById(id); if (el) el.innerHTML = html;
  });
}

function renderMemberCard(r) {
  const s = STATUS_META[r.status] || STATUS_META.pending;
  return `
    <div class="ot-card">
      <div class="ot-card-head">
        <div>
          <div style="font-size:13px;font-weight:700">${r.date || '—'}　⏱ ${fmtMinutes(r.minutes || 0)}</div>
          ${r.reason ? `<div style="font-size:12px;color:var(--ink3);margin-top:2px">📝 ${escHtml(r.reason)}</div>` : ''}
        </div>
        <span class="ot-badge" style="background:${s.bg};color:${s.color}">${s.icon} ${s.label}</span>
      </div>
      ${r.approvedBy ? `<div class="ot-meta">承認者：${escHtml(r.approvedBy)}</div>` : ''}
    </div>`;
}

// ---- Tab switch -------------------------------------------
export function setOvertimeAdminTab(tab) {
  _adminTab = tab;
  renderAdmin();
}

// ---- Approve / Reject -------------------------------------
export async function approveOvertime(reqId, uid, date, minutes) {
  if (!confirm(`残業申請を承認しますか？\n${fmtMinutes(minutes)}`)) return;
  try {
    await updateDoc(doc(db, 'overtimeRequests', reqId), {
      status: 'approved',
      approvedBy: RC.currentUserData?.name || RC.currentUser.email,
      approvedAt: new Date().toISOString(),
    });
    const attRef = doc(db, 'attendance', `${uid}_${date}`);
    await setDoc(attRef, {
      approvedOvertimeMinutes: minutes,
      overtimePendingMinutes: 0,
    }, { merge: true });
    await loadOvertimeRequests();
    // 勤怠表が開いていれば再読み込み
    if (typeof window.loadMonthlyAttendance === 'function') window.loadMonthlyAttendance(true);
  } catch (e) {
    alert('承認に失敗しました: ' + e.message);
  }
}

export async function rejectOvertime(reqId, uid, date) {
  if (!confirm('残業申請を却下しますか？')) return;
  try {
    await updateDoc(doc(db, 'overtimeRequests', reqId), {
      status: 'rejected',
      rejectedBy: RC.currentUserData?.name || RC.currentUser.email,
      rejectedAt: new Date().toISOString(),
    });
    const attRef = doc(db, 'attendance', `${uid}_${date}`);
    await setDoc(attRef, { overtimePendingMinutes: 0 }, { merge: true });
    await loadOvertimeRequests();
  } catch (e) {
    alert('却下に失敗しました: ' + e.message);
  }
}

// ---- Badge ------------------------------------------------
export async function updateOvertimeBadge() {
  if (!isAdmin()) return;
  try {
    const snap = await getDocs(query(collection(db, 'overtimeRequests'), where('status', 'in', ['pending', '未承認'])));
    const count = snap.size;
    ['ot-nav-badge', 'm-ot-nav-badge'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = count;
      el.style.display = count > 0 ? '' : 'none';
    });
  } catch (e) { /* silent */ }
}

// ---- Window exports ---------------------------------------
window.loadOvertimeRequests  = loadOvertimeRequests;
window.setOvertimeAdminTab   = setOvertimeAdminTab;
window.approveOvertime       = approveOvertime;
window.rejectOvertime        = rejectOvertime;
window.updateOvertimeBadge   = updateOvertimeBadge;
