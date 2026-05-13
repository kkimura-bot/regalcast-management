// ============================================================
// Paid Leave (有給申請) module
// Collection: paid_leave_requests
// Doc shape:
//   { uid, name, dept, createdAt (ISO),
//     dates: [YYYY-MM-DD, ...],
//     type: 'full' | 'am' | 'pm',
//     reason, note,
//     status: 'pending' | 'approved' | 'rejected' | 'cancelled',
//     reviewedBy, reviewedByName, reviewedAt (ISO), rejectionReason }
// ============================================================
import { RC, isAdmin } from '../state.js';
import {
  db, collection, doc, addDoc, getDocs, updateDoc,
  query, where, orderBy
} from '../firebase.js';
import { openModal, closeModal } from '../utils/modal.js';
import { escHtml, fmtDate, todayJST } from '../utils/helpers.js';

// ---- State ------------------------------------------------
let _cachedRequests  = [];
let _adminTab        = 'pending';   // 管理者ビューのタブ

const TYPE_LABEL = { full: '全休', am: '午前半休', pm: '午後半休' };
const TYPE_ICON  = { full: '🌴', am: '🌤', pm: '🌆' };
const STATUS_META = {
  pending:   { label: '申請中',   icon: '⏳', bg: 'rgba(217,119,6,.10)',   color: '#D97706' },
  approved:  { label: '承認済み', icon: '✅', bg: 'rgba(5,150,105,.10)',   color: '#059669' },
  rejected:  { label: '否認',     icon: '❌', bg: 'rgba(239,68,68,.10)',   color: '#EF4444' },
  cancelled: { label: '取下げ',   icon: '↩',  bg: 'rgba(148,163,184,.15)', color: '#64748B' },
};

// ---- CSS (injected once) ----------------------------------
function injectCSS() {
  if (document.getElementById('paid-leave-css')) return;
  const s = document.createElement('style');
  s.id = 'paid-leave-css';
  s.textContent = `
    /* ── 有給申請 ベース ───────────────────────── */
    .pl-header {
      display:flex; justify-content:space-between; align-items:center;
      margin-bottom:20px; flex-wrap:wrap; gap:12px;
    }
    .pl-title {
      font-size:20px; font-weight:800; color:var(--ink);
      display:flex; align-items:center; gap:8px; letter-spacing:-0.3px;
    }
    .pl-title .pl-icon {
      font-size:22px;
      display:inline-block;
      animation: plWave 2.6s ease-in-out infinite;
      transform-origin: 70% 90%;
    }
    @keyframes plWave {
      0%,100% { transform: rotate(-8deg); }
      50%     { transform: rotate(8deg); }
    }
    .pl-sub { font-size:12px; color:var(--ink3); margin-top:2px; }

    /* 新規申請ボタン */
    .pl-new-btn {
      display:inline-flex; align-items:center; gap:6px;
      padding:10px 18px; border:none; border-radius:999px;
      background:linear-gradient(135deg,#52b788,#3a7d5a);
      color:#fff; font-size:13px; font-weight:700; cursor:pointer;
      box-shadow: 0 6px 18px -6px rgba(58,125,90,.55);
      transition: transform .15s ease, box-shadow .15s ease;
      font-family:inherit;
    }
    .pl-new-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 10px 22px -6px rgba(58,125,90,.65);
    }
    .pl-new-btn:active { transform: translateY(0); }

    /* タブ */
    .pl-tabs {
      display:flex; gap:4px; border-bottom:1.5px solid var(--border);
      margin-bottom:16px; overflow-x:auto; -webkit-overflow-scrolling:touch;
    }
    .pl-tab {
      padding:9px 14px; background:none; border:none;
      border-bottom:2px solid transparent;
      font-size:12px; font-weight:600; color:var(--ink3);
      cursor:pointer; white-space:nowrap; font-family:inherit;
      transition: color .15s, border-color .15s;
    }
    .pl-tab:hover { color:var(--ink2); }
    .pl-tab.active { color:var(--ink); border-bottom-color:#3a7d5a; font-weight:700; }
    .pl-tab .pl-count {
      display:inline-block; margin-left:4px; padding:1px 7px; border-radius:99px;
      background:rgba(5,150,105,.12); color:#059669; font-size:10px; font-weight:700;
    }
    .pl-tab.active .pl-count { background:#3a7d5a; color:#fff; }

    /* カード */
    .pl-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 18px;
      margin-bottom: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,.04);
      transition: box-shadow .2s ease, transform .2s ease;
      animation: plFadeIn .3s ease;
    }
    .pl-card:hover {
      box-shadow: 0 6px 18px -6px rgba(0,0,0,.08);
    }
    @keyframes plFadeIn {
      from { opacity:0; transform: translateY(4px); }
      to   { opacity:1; transform: translateY(0); }
    }

    .pl-card-head {
      display:flex; justify-content:space-between; align-items:flex-start;
      gap:10px; margin-bottom:10px;
    }
    .pl-card-who {
      display:flex; align-items:center; gap:8px; flex-wrap:wrap;
    }
    .pl-badge {
      display:inline-flex; align-items:center; gap:4px;
      padding:3px 10px; border-radius:99px;
      font-size:11px; font-weight:700;
    }
    .pl-type-badge {
      display:inline-flex; align-items:center; gap:4px;
      padding:3px 10px; border-radius:99px;
      background:rgba(82,183,136,.12); color:#3a7d5a;
      font-size:11px; font-weight:700;
    }

    .pl-dates {
      display:flex; flex-wrap:wrap; gap:6px;
      padding:10px 12px; background:var(--surface2);
      border-radius:8px; margin-bottom:10px;
    }
    .pl-date-chip {
      display:inline-flex; align-items:center; gap:4px;
      padding:4px 10px; border-radius:6px;
      background: #fff; border:1px solid rgba(58,125,90,.25);
      font-size:12px; font-weight:600; color:var(--ink2);
      font-family:'DM Mono', monospace;
    }
    .pl-date-chip .pl-weekday {
      font-size:10px; color:var(--ink3); font-weight:500;
    }

    .pl-meta {
      font-size:12px; color:var(--ink2);
      line-height:1.7;
      padding:8px 0;
      border-top:1px dashed var(--border);
      margin-top:6px;
    }
    .pl-meta-label {
      font-size:10px; font-weight:700; color:var(--ink3);
      text-transform:uppercase; letter-spacing:1px;
      margin-right:6px;
    }

    .pl-actions {
      display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;
    }
    .pl-btn {
      padding:8px 16px; border-radius:8px;
      font-size:12px; font-weight:700; cursor:pointer;
      border:1.5px solid var(--border); background:#fff;
      color:var(--ink2); font-family:inherit;
      transition: all .15s;
    }
    .pl-btn:hover { border-color:var(--ink3); color:var(--ink); }
    .pl-btn-approve {
      border-color:#3a7d5a; background:#3a7d5a; color:#fff;
    }
    .pl-btn-approve:hover { background:#2d6b4a; border-color:#2d6b4a; color:#fff; }
    .pl-btn-reject {
      border-color:#EF4444; background:#fff; color:#EF4444;
    }
    .pl-btn-reject:hover { background:#EF4444; color:#fff; }
    .pl-btn-cancel {
      border-color:var(--border); color:var(--ink3);
    }

    .pl-empty {
      text-align:center; padding:60px 20px;
      color:var(--ink3); font-size:13px;
      background: var(--surface);
      border: 1px dashed var(--border);
      border-radius: 12px;
    }
    .pl-empty-icon { font-size:44px; margin-bottom:10px; opacity:.5; }

    /* ── 申請フォーム モーダル ── */
    .pl-form-section { margin-bottom:16px; }
    .pl-form-label {
      display:block; font-size:11px; font-weight:700; color:var(--ink2);
      margin-bottom:6px;
      text-transform:uppercase; letter-spacing:.5px;
    }
    .pl-form-hint {
      font-size:11px; color:var(--ink3); margin-top:4px;
    }
    .pl-date-grid {
      display:flex; flex-wrap:wrap; gap:6px;
      padding:10px; background:var(--surface2);
      border-radius:8px; min-height:48px;
      align-items:center;
    }
    .pl-date-grid-empty {
      color:var(--ink3); font-size:12px;
      width:100%; text-align:center;
    }
    .pl-selected-chip {
      display:inline-flex; align-items:center; gap:4px;
      padding:5px 10px; border-radius:6px;
      background:#fff; border:1.5px solid #3a7d5a;
      font-size:12px; font-weight:600; color:#3a7d5a;
      font-family:'DM Mono', monospace;
      animation: plChipIn .18s ease;
    }
    @keyframes plChipIn {
      from { opacity:0; transform: scale(.85); }
      to   { opacity:1; transform: scale(1); }
    }
    .pl-selected-chip .pl-chip-x {
      margin-left:2px; cursor:pointer; color:#3a7d5a; opacity:.6;
      font-weight:700;
    }
    .pl-selected-chip .pl-chip-x:hover { opacity:1; }

    .pl-type-grid {
      display:grid; grid-template-columns: 1fr 1fr 1fr; gap:8px;
    }
    .pl-type-btn {
      padding:12px 8px; border-radius:10px;
      border:1.5px solid var(--border); background:#fff;
      cursor:pointer; text-align:center;
      font-family:inherit; transition:all .15s;
    }
    .pl-type-btn:hover { border-color:#3a7d5a; background:rgba(82,183,136,.04); }
    .pl-type-btn.active {
      border-color:#3a7d5a; background:rgba(82,183,136,.10);
      box-shadow: 0 0 0 3px rgba(82,183,136,.15);
    }
    .pl-type-btn-icon { font-size:20px; display:block; margin-bottom:4px; }
    .pl-type-btn-label { font-size:12px; font-weight:700; color:var(--ink); }

    /* toast */
    .pl-toast {
      position:fixed; left:50%; bottom:28px;
      transform: translateX(-50%) translateY(20px);
      background:var(--ink); color:#fff;
      padding:12px 22px; border-radius:999px;
      font-size:13px; font-weight:600;
      box-shadow: 0 8px 24px rgba(0,0,0,.2);
      z-index:5000; opacity:0;
      transition: opacity .25s ease, transform .25s ease;
      pointer-events:none;
    }
    .pl-toast.show {
      opacity:1; transform: translateX(-50%) translateY(0);
    }
    .pl-toast.ok    { background:#3a7d5a; }
    .pl-toast.error { background:#EF4444; }

    /* モバイル微調整 */
    @media (max-width:600px) {
      .pl-title { font-size:17px; }
      .pl-card { padding:14px 14px; }
      .pl-type-grid { grid-template-columns: 1fr 1fr 1fr; }
    }
  `;
  document.head.appendChild(s);
}

// ---- Utils -----------------------------------------------
function toast(msg, kind='ok') {
  let el = document.getElementById('pl-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pl-toast';
    el.className = 'pl-toast';
    document.body.appendChild(el);
  }
  el.className = 'pl-toast ' + kind + ' show';
  el.textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'pl-toast ' + kind; }, 2400);
}

function weekdayLabel(ymd) {
  try {
    const [y,m,d] = ymd.split('-').map(Number);
    const w = new Date(y, m-1, d).getDay();
    return ['日','月','火','水','木','金','土'][w];
  } catch { return ''; }
}

function sortByDateAsc(arr){ return [...arr].sort(); }

function formatDateChip(ymd) {
  if (!ymd) return '';
  const [y,m,d] = ymd.split('-');
  return `${m}/${d}<span class="pl-weekday">(${weekdayLabel(ymd)})</span>`;
}

// ---- Fetch -----------------------------------------------
async function fetchRequests() {
  try {
    let q;
    if (isAdmin()) {
      // 管理者は全件取得
      q = query(collection(db, 'paid_leave_requests'), orderBy('createdAt', 'desc'));
    } else {
      // 本人のみ
      q = query(collection(db, 'paid_leave_requests'),
        where('uid', '==', RC.currentUser.uid));
    }
    const snap = await getDocs(q);
    _cachedRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // memberの場合はクライアントソート（createdAt desc）
    if (!isAdmin()) {
      _cachedRequests.sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
    }
  } catch (e) {
    console.error('有給申請取得エラー:', e);
    _cachedRequests = [];
    toast('データ取得に失敗しました', 'error');
  }
}

// ---- Root loader -----------------------------------------
export async function loadPaidLeave() {
  injectCSS();
  const pcEl = document.getElementById('paid-leave-content');
  const mEl  = document.getElementById('m-paid-leave-content');
  if (pcEl) pcEl.innerHTML = '<div style="padding:30px;text-align:center;color:var(--ink3);font-size:12px">読み込み中…</div>';
  if (mEl)  mEl.innerHTML  = '<div style="padding:30px;text-align:center;color:var(--ink3);font-size:12px">読み込み中…</div>';

  await fetchRequests();

  if (isAdmin()) {
    renderAdmin();
  } else {
    renderApplicant();
  }

  // バッジ更新
  updatePaidLeaveBadges();
}

// ---- Applicant (member / leader) view --------------------
function renderApplicant() {
  const mine = _cachedRequests.filter(r => r.uid === RC.currentUser?.uid);
  const html = buildApplicantHtml(mine);
  const pcEl = document.getElementById('paid-leave-content');
  if (pcEl) pcEl.innerHTML = html;
  const mEl = document.getElementById('m-paid-leave-content');
  if (mEl) mEl.innerHTML = html;
}

function buildApplicantHtml(records) {
  const cards = records.length
    ? records.map(renderApplicantCard).join('')
    : `<div class="pl-empty">
         <div class="pl-empty-icon">🌴</div>
         まだ申請はありません。<br>
         「新規申請」ボタンから有給を申請できます。
       </div>`;

  return `
    <div class="pl-header">
      <div>
        <div class="pl-title"><span class="pl-icon">🌴</span> 有給申請</div>
        <div class="pl-sub">自分の申請履歴を確認できます</div>
      </div>
      <button class="pl-new-btn" onclick="openPaidLeaveModal()">
        <span style="font-size:15px">＋</span> 新規申請
      </button>
    </div>
    <div id="pl-list">${cards}</div>
  `;
}

function renderApplicantCard(r) {
  const s = STATUS_META[r.status] || STATUS_META.pending;
  const dates = sortByDateAsc(r.dates || []);
  const datesHtml = dates.length
    ? dates.map(d => `<span class="pl-date-chip">${formatDateChip(d)}</span>`).join('')
    : '<span style="font-size:12px;color:var(--ink3)">日付未設定</span>';

  const canCancel = r.status === 'pending' && r.uid === RC.currentUser?.uid;
  const createdLabel = r.createdAt
    ? new Date(r.createdAt).toLocaleDateString('ja-JP', { month:'short', day:'numeric', timeZone:'Asia/Tokyo' })
    : '—';

  return `
    <div class="pl-card">
      <div class="pl-card-head">
        <div class="pl-card-who">
          <span class="pl-type-badge">${TYPE_ICON[r.type]||'🌴'} ${TYPE_LABEL[r.type]||'—'}</span>
          <span style="font-size:11px;color:var(--ink3)">申請日 ${createdLabel}</span>
        </div>
        <span class="pl-badge" style="background:${s.bg};color:${s.color}">${s.icon} ${s.label}</span>
      </div>
      <div class="pl-dates">${datesHtml}</div>
      ${r.reason ? `<div class="pl-meta"><span class="pl-meta-label">理由</span>${escHtml(r.reason)}</div>` : ''}
      ${r.note ? `<div class="pl-meta"><span class="pl-meta-label">備考</span>${escHtml(r.note)}</div>` : ''}
      ${r.status === 'approved' && r.reviewedByName ? `
        <div class="pl-meta"><span class="pl-meta-label">承認者</span>${escHtml(r.reviewedByName)}${r.reviewedAt ? ` · ${new Date(r.reviewedAt).toLocaleDateString('ja-JP',{month:'short',day:'numeric',timeZone:'Asia/Tokyo'})}` : ''}</div>
      ` : ''}
      ${r.status === 'rejected' && r.rejectionReason ? `
        <div class="pl-meta" style="color:#EF4444"><span class="pl-meta-label" style="color:#EF4444">否認理由</span>${escHtml(r.rejectionReason)}</div>
      ` : ''}
      ${canCancel ? `
        <div class="pl-actions">
          <button class="pl-btn pl-btn-cancel" onclick="cancelPaidLeave('${r.id}')">↩ 申請を取下げる</button>
        </div>
      ` : ''}
    </div>
  `;
}

// ---- Admin view ------------------------------------------
function renderAdmin() {
  const pending   = _cachedRequests.filter(r => r.status === 'pending');
  const approved  = _cachedRequests.filter(r => r.status === 'approved');
  const rejected  = _cachedRequests.filter(r => r.status === 'rejected');

  const TABS = [
    { key: 'pending',  label: '未処理',   items: pending  },
    { key: 'approved', label: '承認済み', items: approved },
    { key: 'rejected', label: '否認',     items: rejected },
    { key: 'all',      label: '全件',     items: _cachedRequests },
  ];

  const activeItems = (TABS.find(t => t.key === _adminTab) || TABS[0]).items;

  const tabsHtml = TABS.map(t => `
    <button class="pl-tab ${t.key === _adminTab ? 'active' : ''}"
      onclick="setPaidLeaveAdminTab('${t.key}')">
      ${t.label}${t.key === 'pending' && t.items.length > 0 ? `<span class="pl-count">${t.items.length}</span>` : ''}
    </button>
  `).join('');

  const cardsHtml = activeItems.length
    ? activeItems.map(renderAdminCard).join('')
    : `<div class="pl-empty">
         <div class="pl-empty-icon">🌴</div>
         ${_adminTab === 'pending' ? '未処理の申請はありません。' : '該当する申請はありません。'}
       </div>`;

  const html = `
    <div class="pl-header">
      <div>
        <div class="pl-title"><span class="pl-icon">🌴</span> 有給申請（管理）</div>
        <div class="pl-sub">メンバーからの申請を承認・否認できます</div>
      </div>
      <button class="pl-new-btn" onclick="openPaidLeaveModal()">
        <span style="font-size:15px">＋</span> 新規申請
      </button>
    </div>
    <div class="pl-tabs">${tabsHtml}</div>
    <div id="pl-list">${cardsHtml}</div>
  `;

  const pcEl = document.getElementById('paid-leave-content');
  if (pcEl) pcEl.innerHTML = html;
  const mEl = document.getElementById('m-paid-leave-content');
  if (mEl) mEl.innerHTML = html;
}

function renderAdminCard(r) {
  const s = STATUS_META[r.status] || STATUS_META.pending;
  const dates = sortByDateAsc(r.dates || []);
  const datesHtml = dates.length
    ? dates.map(d => `<span class="pl-date-chip">${formatDateChip(d)}</span>`).join('')
    : '<span style="font-size:12px;color:var(--ink3)">日付未設定</span>';
  const createdLabel = r.createdAt
    ? new Date(r.createdAt).toLocaleDateString('ja-JP', { month:'short', day:'numeric', timeZone:'Asia/Tokyo' })
    : '—';
  const isPending = r.status === 'pending';

  return `
    <div class="pl-card">
      <div class="pl-card-head">
        <div class="pl-card-who">
          <span class="member-chip">${escHtml(r.name||'—')}</span>
          ${r.dept ? `<span style="font-size:11px;color:var(--ink3)">${escHtml(r.dept)}</span>` : ''}
          <span class="pl-type-badge">${TYPE_ICON[r.type]||'🌴'} ${TYPE_LABEL[r.type]||'—'}</span>
          <span style="font-size:11px;color:var(--ink3)">申請日 ${createdLabel}</span>
        </div>
        <span class="pl-badge" style="background:${s.bg};color:${s.color}">${s.icon} ${s.label}</span>
      </div>
      <div class="pl-dates">${datesHtml}</div>
      ${r.reason ? `<div class="pl-meta"><span class="pl-meta-label">理由</span>${escHtml(r.reason)}</div>` : ''}
      ${r.note   ? `<div class="pl-meta"><span class="pl-meta-label">備考</span>${escHtml(r.note)}</div>` : ''}
      ${r.status === 'approved' && r.reviewedByName ? `
        <div class="pl-meta" style="color:#3a7d5a"><span class="pl-meta-label" style="color:#3a7d5a">承認者</span>${escHtml(r.reviewedByName)}${r.reviewedAt ? ` · ${new Date(r.reviewedAt).toLocaleDateString('ja-JP',{month:'short',day:'numeric',timeZone:'Asia/Tokyo'})}` : ''}</div>
      ` : ''}
      ${r.status === 'rejected' && r.rejectionReason ? `
        <div class="pl-meta" style="color:#EF4444"><span class="pl-meta-label" style="color:#EF4444">否認理由</span>${escHtml(r.rejectionReason)}</div>
      ` : ''}
      ${isPending ? `
        <div class="pl-actions">
          <button class="pl-btn pl-btn-approve" onclick="approvePaidLeave('${r.id}')">✓ 承認する</button>
          <button class="pl-btn pl-btn-reject"  onclick="openRejectPaidLeaveModal('${r.id}')">✕ 否認する</button>
        </div>
      ` : ''}
    </div>
  `;
}

// ---- Admin tab switch ------------------------------------
function setPaidLeaveAdminTab(key) {
  _adminTab = key;
  renderAdmin();
}

// ---- Modal: apply form -----------------------------------
const _modalState = { selectedDates: [], type: 'full' };

function openPaidLeaveModal() {
  _modalState.selectedDates = [];
  _modalState.type = 'full';

  const todayStr = todayJST();
  document.getElementById('modal-title-text').textContent = '🌴 新規 有給申請';
  document.getElementById('modal-body').innerHTML = `
    <div style="padding:4px 4px 14px">
      <div class="pl-form-section">
        <label class="pl-form-label">📅 取得日（複数選択可）</label>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
          <input type="date" id="pl-date-input" class="form-input" style="flex:1;min-width:140px" min="${todayStr}">
          <button type="button" class="btn" onclick="addPaidLeaveDate()"
            style="background:#3a7d5a;color:#fff;border:none;padding:9px 16px;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap;font-family:inherit">
            ＋ 追加
          </button>
        </div>
        <div id="pl-date-grid" class="pl-date-grid">
          <span class="pl-date-grid-empty">日付を選択してください</span>
        </div>
        <div class="pl-form-hint">連続しない日付も複数選べます（例: 4/22, 4/25, 5/1）</div>
      </div>

      <div class="pl-form-section">
        <label class="pl-form-label">🕰 取得種別</label>
        <div class="pl-type-grid" id="pl-type-grid">
          ${['full','am','pm'].map(t => `
            <button type="button" class="pl-type-btn ${t==='full'?'active':''}" data-type="${t}" onclick="setPaidLeaveType('${t}')">
              <span class="pl-type-btn-icon">${TYPE_ICON[t]}</span>
              <span class="pl-type-btn-label">${TYPE_LABEL[t]}</span>
            </button>
          `).join('')}
        </div>
      </div>

      <div class="pl-form-section">
        <label class="pl-form-label">📝 理由（任意）</label>
        <input type="text" id="pl-reason" class="form-input" placeholder="例：私用のため、通院">
      </div>

      <div class="pl-form-section">
        <label class="pl-form-label">💬 備考（任意）</label>
        <textarea id="pl-note" class="form-input" rows="2" placeholder="引継ぎ事項や補足があれば"></textarea>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;padding-top:14px;border-top:1px solid var(--border)">
        <button class="btn" onclick="closeModal()"
          style="background:#fff;color:var(--ink3);border:1.5px solid var(--border);padding:10px 18px;border-radius:8px;font-weight:600;font-size:12px;cursor:pointer;font-family:inherit">
          キャンセル
        </button>
        <button class="btn" onclick="submitPaidLeave()"
          style="background:linear-gradient(135deg,#52b788,#3a7d5a);color:#fff;border:none;padding:10px 22px;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit;box-shadow:0 4px 12px -4px rgba(58,125,90,.6)">
          🌴 申請する
        </button>
      </div>
    </div>
  `;
  openModal();
}

function renderSelectedDates() {
  const grid = document.getElementById('pl-date-grid');
  if (!grid) return;
  const dates = sortByDateAsc(_modalState.selectedDates);
  if (!dates.length) {
    grid.innerHTML = '<span class="pl-date-grid-empty">日付を選択してください</span>';
    return;
  }
  grid.innerHTML = dates.map(d => `
    <span class="pl-selected-chip">
      ${formatDateChip(d)}
      <span class="pl-chip-x" onclick="removePaidLeaveDate('${d}')">×</span>
    </span>
  `).join('');
}

function addPaidLeaveDate() {
  const input = document.getElementById('pl-date-input');
  if (!input) return;
  const v = input.value;
  if (!v) {
    toast('日付を選んでください', 'error');
    return;
  }
  if (_modalState.selectedDates.includes(v)) {
    toast('既に追加済みです', 'error');
    return;
  }
  _modalState.selectedDates.push(v);
  input.value = '';
  renderSelectedDates();
}

function removePaidLeaveDate(d) {
  _modalState.selectedDates = _modalState.selectedDates.filter(x => x !== d);
  renderSelectedDates();
}

function setPaidLeaveType(t) {
  _modalState.type = t;
  document.querySelectorAll('#pl-type-grid .pl-type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === t);
  });
}

async function submitPaidLeave() {
  const dates = sortByDateAsc(_modalState.selectedDates);
  if (!dates.length) {
    toast('取得日を1つ以上選んでください', 'error');
    return;
  }
  const type = _modalState.type || 'full';
  const reason = (document.getElementById('pl-reason')?.value || '').trim();
  const note   = (document.getElementById('pl-note')?.value   || '').trim();

  try {
    const payload = {
      uid:  RC.currentUser.uid,
      name: RC.currentUserData?.name || '',
      dept: RC.currentUserData?.dept || '',
      createdAt: new Date().toISOString(),
      dates,
      type,
      reason,
      note,
      status: 'pending',
      reviewedBy: null,
      reviewedByName: null,
      reviewedAt: null,
      rejectionReason: null,
    };
    await addDoc(collection(db, 'paid_leave_requests'), payload);
    toast('🌴 有給申請を送信しました');
    closeModal();
    // 再読み込み
    await loadPaidLeave();
  } catch (e) {
    console.error('有給申請の送信に失敗:', e);
    toast('送信に失敗しました', 'error');
  }
}

// ---- Cancel (applicant) ----------------------------------
async function cancelPaidLeave(id) {
  if (!confirm('この申請を取下げますか？')) return;
  try {
    await updateDoc(doc(db, 'paid_leave_requests', id), {
      status: 'cancelled',
    });
    toast('申請を取下げました');
    await loadPaidLeave();
  } catch (e) {
    console.error('取下げ失敗:', e);
    toast('取下げに失敗しました', 'error');
  }
}

// ---- Approve / Reject (admin) ----------------------------
async function approvePaidLeave(id) {
  if (!isAdmin()) return;
  try {
    await updateDoc(doc(db, 'paid_leave_requests', id), {
      status: 'approved',
      reviewedBy: RC.currentUser.uid,
      reviewedByName: RC.currentUserData?.name || '',
      reviewedAt: new Date().toISOString(),
      rejectionReason: null,
    });
    toast('✅ 承認しました');
    await loadPaidLeave();
    // 勤怠表にも反映されるよう再読込（モバイル / PC 両対応）
    window.loadMonthlyAttendance?.(true);
  } catch (e) {
    console.error('承認失敗:', e);
    toast('承認に失敗しました', 'error');
  }
}

function openRejectPaidLeaveModal(id) {
  if (!isAdmin()) return;
  document.getElementById('modal-title-text').textContent = '❌ 有給申請 否認';
  document.getElementById('modal-body').innerHTML = `
    <div style="padding:4px 4px 14px">
      <div class="pl-form-section">
        <label class="pl-form-label">否認理由（必須）</label>
        <textarea id="pl-rej-reason" class="form-input" rows="3" placeholder="例：繁忙期のため別日を検討してください"></textarea>
        <div class="pl-form-hint">申請者に理由が通知されます。丁寧な言葉を心がけてください。</div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;padding-top:14px;border-top:1px solid var(--border)">
        <button class="btn" onclick="closeModal()"
          style="background:#fff;color:var(--ink3);border:1.5px solid var(--border);padding:10px 18px;border-radius:8px;font-weight:600;font-size:12px;cursor:pointer;font-family:inherit">
          キャンセル
        </button>
        <button class="btn" onclick="confirmRejectPaidLeave('${id}')"
          style="background:#EF4444;color:#fff;border:none;padding:10px 22px;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit">
          否認を確定
        </button>
      </div>
    </div>
  `;
  openModal();
}

async function confirmRejectPaidLeave(id) {
  const reason = (document.getElementById('pl-rej-reason')?.value || '').trim();
  if (!reason) {
    toast('否認理由を入力してください', 'error');
    return;
  }
  try {
    await updateDoc(doc(db, 'paid_leave_requests', id), {
      status: 'rejected',
      reviewedBy: RC.currentUser.uid,
      reviewedByName: RC.currentUserData?.name || '',
      reviewedAt: new Date().toISOString(),
      rejectionReason: reason,
    });
    toast('否認しました');
    closeModal();
    await loadPaidLeave();
  } catch (e) {
    console.error('否認失敗:', e);
    toast('否認に失敗しました', 'error');
  }
}

// ---- Badge (pending count) 他モジュールからも呼ばれる ----
export async function updatePaidLeaveBadges() {
  try {
    let count = 0;
    if (isAdmin()) {
      // 管理者は全pendingを取得
      const snap = await getDocs(query(collection(db, 'paid_leave_requests'),
        where('status','==','pending')));
      count = snap.docs.length;
    }
    // PCサイドナビ内のバッジ
    const pcBadge = document.getElementById('paid-leave-nav-badge');
    if (pcBadge) {
      pcBadge.textContent = count > 0 ? String(count) : '';
      pcBadge.style.display = (isAdmin() && count > 0) ? 'flex' : 'none';
    }
    // モバイルナビ
    const mBadge = document.getElementById('m-paid-leave-nav-badge');
    if (mBadge) {
      mBadge.textContent = count > 0 ? String(count) : '';
      mBadge.style.display = (isAdmin() && count > 0) ? 'flex' : 'none';
    }
    // Dashboard count用に RC に保存
    window.RC._paidLeavePendingCount = count;
    return count;
  } catch (e) {
    console.warn('有給バッジ更新失敗:', e);
    return 0;
  }
}

// ---- Public API for other modules: approved map ----------
// 承認済み申請をYYYY-MM-DD -> type map として uid 別に返す
// attendance.js などが呼び出す用
export async function fetchApprovedPaidLeaveForMonth(month /* YYYY-MM */) {
  try {
    const snap = await getDocs(query(collection(db, 'paid_leave_requests'),
      where('status','==','approved')));
    const map = {}; // { uid: { 'YYYY-MM-DD': 'full'|'am'|'pm' } }
    snap.docs.forEach(d => {
      const r = d.data();
      if (!Array.isArray(r.dates)) return;
      r.dates.forEach(dt => {
        if (month && !dt.startsWith(month)) return;
        if (!map[r.uid]) map[r.uid] = {};
        map[r.uid][dt] = r.type || 'full';
      });
    });
    return map;
  } catch (e) {
    console.warn('承認済み有給取得失敗:', e);
    return {};
  }
}

// ---- Exports to window -----------------------------------
window.loadPaidLeave              = loadPaidLeave;
window.openPaidLeaveModal         = openPaidLeaveModal;
window.addPaidLeaveDate           = addPaidLeaveDate;
window.removePaidLeaveDate        = removePaidLeaveDate;
window.setPaidLeaveType           = setPaidLeaveType;
window.submitPaidLeave            = submitPaidLeave;
window.cancelPaidLeave            = cancelPaidLeave;
window.approvePaidLeave           = approvePaidLeave;
window.openRejectPaidLeaveModal   = openRejectPaidLeaveModal;
window.confirmRejectPaidLeave     = confirmRejectPaidLeave;
window.setPaidLeaveAdminTab       = setPaidLeaveAdminTab;
window.updatePaidLeaveBadges      = updatePaidLeaveBadges;
window.fetchApprovedPaidLeaveForMonth = fetchApprovedPaidLeaveForMonth;
