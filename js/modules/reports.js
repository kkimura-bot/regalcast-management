// ============================================================
// Reports / Alert reports module
// ============================================================
import { RC, isAdmin, isLeaderOrAbove } from '../state.js';
import {
  db, collection, doc, addDoc, getDocs, updateDoc,
  query, where, orderBy, serverTimestamp
} from '../firebase.js';
import { openModal, closeModal } from '../utils/modal.js';

const ALERT_CATEGORIES = {
  motivation: { label:'モチベーション低下', icon:'😞', color:'var(--blue)' },
  irregular:  { label:'イレギュラー',       icon:'⚡', color:'var(--warn)' },
  bug:        { label:'不具合',             icon:'🐛', color:'var(--accent)' },
  other:      { label:'その他',             icon:'📝', color:'var(--accent2)' },
};

const ALERT_URGENCY = {
  high:   { label:'🔴 緊急',   color:'var(--accent)' },
  medium: { label:'🟡 通常',   color:'var(--warn)' },
  low:    { label:'🟢 軽微',   color:'var(--accent2)' },
};

let _cachedAlerts        = [];
let _alertCurrentCat     = 'all';
let _cachedMeetingRequests = [];

// ── Alert reports ─────────────────────────────────────────

export function openAlertReportModal() {
  const myDept     = RC.currentUserData?.dept || '';
  const deptMembers = RC._cachedMembers.filter(m => m.dept === myDept && m.id !== RC.currentUser.uid);
  const memberOpts  = deptMembers.map(m => `<option value="${m.name}">${m.name}</option>`).join('');

  document.getElementById('modal-title-text').textContent = '📣 アラート・報告を提出';
  document.getElementById('modal-body').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div class="form-row" style="margin:0">
        <label class="form-label">カテゴリ <span style="color:var(--accent)">*</span></label>
        <select class="form-input" id="ar-category" onchange="updateAlertForm()">
          <option value="">選択してください</option>
          <option value="motivation">😞 モチベーション低下</option>
          <option value="irregular">⚡ イレギュラー</option>
          <option value="bug">🐛 不具合</option>
          <option value="other">📝 その他</option>
        </select>
      </div>
      <div class="form-row" style="margin:0">
        <label class="form-label">緊急度</label>
        <select class="form-input" id="ar-urgency">
          <option value="medium">🟡 通常</option>
          <option value="high">🔴 緊急</option>
          <option value="low">🟢 軽微</option>
        </select>
      </div>
    </div>
    <div class="form-row" id="ar-member-row">
      <label class="form-label">対象メンバー（任意）</label>
      <select class="form-input" id="ar-member">
        <option value="">個人ではない / 不明</option>${memberOpts}
      </select>
    </div>
    <div class="form-row">
      <label class="form-label">件名 <span style="color:var(--accent)">*</span></label>
      <input class="form-input" id="ar-title" placeholder="例：〇〇さんが連続して低いメンタルを記録しています">
    </div>
    <div class="form-row">
      <label class="form-label">詳細・状況説明</label>
      <textarea class="form-input" id="ar-detail" rows="4" placeholder="具体的な状況、背景、いつから等を記載してください" style="resize:vertical"></textarea>
    </div>
    <div class="form-row">
      <label class="form-label">対応希望・提案（任意）</label>
      <input class="form-input" id="ar-action" placeholder="例：面談を希望、改善策が必要">
    </div>
    <div id="ar-error" style="font-size:12px;color:var(--accent);min-height:16px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="submitAlertReport()">📣 報告を提出</button>
    </div>`;
  openModal();
}

export function updateAlertForm() {
  const cat = document.getElementById('ar-category')?.value;
  const memberRow = document.getElementById('ar-member-row');
  if (memberRow) memberRow.style.display = (cat === 'bug') ? 'none' : '';
}

export async function submitAlertReport() {
  const category = document.getElementById('ar-category').value;
  const urgency  = document.getElementById('ar-urgency').value;
  const member   = document.getElementById('ar-member')?.value || '';
  const title    = document.getElementById('ar-title').value.trim();
  const detail   = document.getElementById('ar-detail').value.trim();
  const action   = document.getElementById('ar-action')?.value.trim() || '';
  const errEl    = document.getElementById('ar-error');

  if (!category) { errEl.textContent = 'カテゴリを選択してください'; return; }
  if (!title)    { errEl.textContent = '件名を入力してください'; return; }

  await addDoc(collection(db,'error_reports'), {
    category, urgency,
    targetMember: member,
    title, detail,
    actionRequest: action,
    reporter: RC.currentUserData.name,
    reporterDept: RC.currentUserData?.dept || '',
    reporterUid: RC.currentUser.uid,
    status: '未対応',
    type: ALERT_CATEGORIES[category]?.label || category,
    screen: member || '部署全体',
    createdAt: serverTimestamp()
  });
  closeModal();
  updateAlertBadge();
  loadAlertReports();
  alert('✅ 報告を提出しました。管理者に通知されます。');
}

export async function loadAlertReports() {
  let q;
  if (isAdmin()) {
    q = query(collection(db,'error_reports'), orderBy('createdAt','desc'));
  } else {
    q = query(collection(db,'error_reports'), where('reporterUid','==',RC.currentUser.uid), orderBy('createdAt','desc'));
  }
  const snap = await getDocs(q);
  _cachedAlerts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderAlertList(_alertCurrentCat);
}

export function filterAlertList(cat) {
  _alertCurrentCat = cat;
  document.querySelectorAll('.alert-cat-tab').forEach(b => {
    const isMobile = b.closest('#m-view-alert') !== null;
    b.classList.toggle('active', b.dataset.cat === cat);
    if (isMobile) {
      b.style.background = b.dataset.cat === cat ? 'var(--ink)' : 'var(--surface)';
      b.style.color      = b.dataset.cat === cat ? '#f5f3ef' : 'var(--ink3)';
    }
  });
  renderAlertList(cat);
}

export function filterAdminReports(cat) {
  document.querySelectorAll('.report-admin-tab').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
  renderAlertList(cat, true);
}

function renderAlertList(cat, adminMode = false) {
  let list = _cachedAlerts;
  if (cat !== 'all' && cat !== 'meeting') list = list.filter(r => (r.category||'bug') === cat);

  const urgencyInfo = u => ALERT_URGENCY[u] || { label:u||'—', color:'var(--ink3)' };
  const catInfo     = c => ALERT_CATEGORIES[c] || { label:c||'不明', icon:'📋', color:'var(--ink3)' };

  const renderCard = (r) => {
    const dt = r.createdAt?.toDate ? r.createdAt.toDate().toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
    const ci = catInfo(r.category);
    const ui = urgencyInfo(r.urgency);
    const statusColor  = r.status==='未対応'?'var(--accent)':r.status==='対応中'?'var(--warn)':'var(--accent2)';
    const borderColor  = r.status==='対応済'?'var(--accent2)':r.status==='対応中'?'var(--warn)':'var(--accent)';
    const adminNoteSection = isAdmin() ? `
      <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">
        <div style="font-size:10px;font-weight:700;color:var(--ink3);margin-bottom:4px;text-transform:uppercase;letter-spacing:1px">管理者メモ</div>
        <div style="display:flex;gap:6px;align-items:flex-start">
          <textarea class="form-input" id="admin-note-${r.id}" rows="2"
            style="flex:1;font-size:11px;padding:6px 8px;resize:none"
            placeholder="対応状況・コメントなど">${r.adminNote||''}</textarea>
          <button class="mini-btn" style="white-space:nowrap;margin-top:1px" onclick="saveAdminNote('${r.id}')">保存</button>
        </div>
      </div>` : (r.adminNote ? `
      <div style="margin-top:8px;padding:8px 10px;background:rgba(42,82,152,.07);border-left:3px solid var(--blue);border-radius:0 6px 6px 0">
        <div style="font-size:10px;font-weight:700;color:var(--blue);margin-bottom:3px">💬 管理者からの返答</div>
        <div style="font-size:12px;color:var(--ink2);line-height:1.6">${r.adminNote}</div>
      </div>` : '');

    return `<div class="alert-card" data-cat="${r.category||'bug'}" data-status="${r.status||'未対応'}" style="border-left:3px solid ${borderColor}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;gap:8px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:16px">${ci.icon}</span>
          <span style="font-size:12px;font-weight:700">${r.title||r.detail||'—'}</span>
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;align-items:center">
          <span style="font-size:10px;font-weight:700;color:${ui.color};background:${ui.color}18;padding:2px 7px;border-radius:4px;white-space:nowrap">${ui.label}</span>
          <span style="font-size:10px;font-weight:700;color:${statusColor};background:${statusColor}18;padding:2px 7px;border-radius:4px;white-space:nowrap">${r.status||'未対応'}</span>
        </div>
      </div>
      <div style="font-size:11px;color:var(--ink3);margin-bottom:6px;display:flex;gap:10px;flex-wrap:wrap">
        <span>📅 ${dt}</span>
        <span>👤 報告者: ${r.reporter||'—'}</span>
        ${r.targetMember ? `<span>🎯 対象: ${r.targetMember}</span>` : ''}
      </div>
      ${r.detail ? `<div style="font-size:12px;color:var(--ink2);margin-bottom:6px;line-height:1.6;background:var(--surface2);padding:8px 10px;border-radius:6px">${r.detail}</div>` : ''}
      ${r.actionRequest ? `<div style="font-size:11px;color:var(--blue);margin-bottom:6px">💬 対応希望: ${r.actionRequest}</div>` : ''}
      ${isAdmin() ? `
      <div style="display:flex;gap:6px;align-items:center;margin-top:8px;flex-wrap:wrap">
        <span style="font-size:10px;color:var(--ink3)">ステータス:</span>
        <select class="form-input" style="width:auto;font-size:11px;padding:2px 8px" onchange="updateAlertStatus('${r.id}',this.value)">
          <option ${(r.status||'未対応')==='未対応'?'selected':''}>未対応</option>
          <option ${r.status==='対応中'?'selected':''}>対応中</option>
          <option ${r.status==='対応済'?'selected':''}>対応済</option>
        </select>
      </div>` : ''}
      ${adminNoteSection}
    </div>`;
  };

  // Meeting cards
  const meetings   = _cachedMeetingRequests || [];
  const showMeetings = (cat === 'all' || cat === 'meeting');
  const meetList   = showMeetings ? meetings : [];

  const renderMeetCard = (m) => {
    const dt = m.requestedAt ? new Date(m.requestedAt).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
    const sc = m.status==='confirmed'?'var(--accent2)':'var(--accent)';
    const sl = m.status==='confirmed'?'✅ 確認済':'⏳ 未確認';
    return `<div class="alert-card" style="border-left:3px solid ${sc}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:4px">
        <div style="display:flex;align-items:center;gap:6px"><span style="font-size:16px">🤝</span>
          <span style="font-size:12px;font-weight:700">面談リクエスト — ${m.name||'—'}</span></div>
        <span style="font-size:10px;font-weight:700;color:${sc};background:${sc}18;padding:2px 8px;border-radius:4px">${sl}</span>
      </div>
      <div style="font-size:11px;color:var(--ink3);margin-bottom:5px;display:flex;gap:12px;flex-wrap:wrap">
        <span>📅 ${dt}</span>${m.dept?`<span>🏢 ${m.dept}</span>`:''}
      </div>
      ${m.message?`<div style="font-size:12px;background:var(--surface2);padding:8px 10px;border-radius:6px;margin-bottom:8px;line-height:1.6">${m.message}</div>`:''}
      ${isAdmin()?`<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
        ${m.status==='pending'?`<button class="mini-btn" style="color:var(--accent2);border-color:var(--accent2)" onclick="confirmMeetingRequest('${m.id}','${m.name||''}')">✅ 確認済みにする</button>`:''}
      </div>
      <div style="padding-top:8px;border-top:1px solid var(--border)">
        <div style="font-size:10px;color:var(--ink3);margin-bottom:4px;font-weight:700">📝 管理者メモ</div>
        <div style="display:flex;gap:6px;align-items:flex-start">
          <textarea class="form-input" id="meet-note-${m.id}" rows="2"
            style="flex:1;font-size:11px;padding:6px 8px;resize:none"
            placeholder="面談日時・対応メモ">${m.adminNote||''}</textarea>
          <button class="mini-btn" style="white-space:nowrap" onclick="saveMeetingNote('${m.id}')">保存</button>
        </div>
      </div>` : (m.adminNote?`<div style="padding:8px 10px;background:rgba(42,82,152,.07);border-left:3px solid var(--blue);border-radius:0 6px 6px 0">
        <div style="font-size:10px;font-weight:700;color:var(--blue);margin-bottom:3px">💬 管理者メモ</div>
        <div style="font-size:12px;line-height:1.6">${m.adminNote}</div></div>`:'')}
    </div>`;
  };

  const meetHtml   = meetList.map(renderMeetCard).join('');
  const alertHtml  = list.length ? list.map(renderCard).join('') : '';
  const countTxt   = `<div style="font-size:11px;color:var(--ink3);margin-bottom:8px">${meetList.length+list.length}件</div>`;
  const html_content = (meetList.length || list.length)
    ? countTxt + meetHtml + alertHtml
    : '<div class="empty">報告はありません</div>';

  ['alert-list-body','reports-body'].forEach(id => {
    const el = document.getElementById(id); if(el) el.innerHTML = html_content;
  });
  const mbody = document.getElementById('alert-list-body-m');
  if (mbody) mbody.innerHTML = html_content;
}

export async function saveMeetingNote(id) {
  const el = document.getElementById('meet-note-'+id);
  if (!el) return;
  await updateDoc(doc(db,'meetingRequests',id), { adminNote: el.value.trim() });
  const m = _cachedMeetingRequests.find(x => x.id === id);
  if (m) m.adminNote = el.value.trim();
  const btn = el.nextElementSibling;
  if (btn) { const o=btn.textContent; btn.textContent='✅ 保存済'; setTimeout(()=>btn.textContent=o,1500); }
}

export async function saveAdminNote(id) {
  const el = document.getElementById('admin-note-'+id);
  if (!el) return;
  await updateDoc(doc(db,'error_reports',id), { adminNote: el.value.trim() });
  const r = _cachedAlerts.find(a => a.id === id);
  if (r) r.adminNote = el.value.trim();
  const btn = el.nextElementSibling;
  if (btn) { const orig=btn.textContent; btn.textContent='✅ 保存済'; setTimeout(()=>btn.textContent=orig,1500); }
}

export async function updateAlertStatus(id, status) {
  await updateDoc(doc(db,'error_reports',id), { status });
  const r = _cachedAlerts.find(a => a.id === id);
  if (r) r.status = status;
  updateAlertBadge();
  window.updateReportBadge?.();
}

export async function updateAlertBadge() {
  const snap  = await getDocs(query(collection(db,'error_reports'), where('status','==','未対応')));
  const count = snap.size;
  ['report-badge','m-report-badge'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = count||''; el.style.display = count ? 'inline-flex' : 'none'; }
  });
  const alertBadge = document.getElementById('alert-badge');
  if (alertBadge) { alertBadge.textContent = count||''; alertBadge.style.display = count ? 'inline-flex' : 'none'; }
  if (isAdmin()) renderAdminAlertPanel(snap.docs.map(d=>({id:d.id,...d.data()})));
}

function renderAdminAlertPanel(alerts) {
  ['admin-alert-panel','m-admin-alert-panel'].forEach(panelId => {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    if (!alerts.length) { panel.innerHTML = ''; return; }
    panel.innerHTML = `
      <div style="background:rgba(200,71,42,.06);border:1px solid rgba(200,71,42,.25);border-radius:8px;padding:12px 14px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-size:12px;font-weight:700;color:var(--accent)">⚠ 未対応の報告 ${alerts.length}件</div>
          <button class="mini-btn" style="font-size:10px" onclick="switchTab('reports')">すべて確認 →</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px">
          ${alerts.slice(0,3).map(r=>{
            const ci = ALERT_CATEGORIES[r.category]||{icon:'📋'};
            return `<div style="display:flex;align-items:center;gap:8px;font-size:11px">
              <span>${ci.icon}</span>
              <span style="font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.title||r.detail||'—'}</span>
              <span style="color:var(--ink3);white-space:nowrap">${r.reporter||'—'}</span>
            </div>`;
          }).join('')}
          ${alerts.length > 3 ? `<div style="font-size:10px;color:var(--ink3);text-align:right">他 ${alerts.length-3}件</div>` : ''}
        </div>
      </div>`;
  });
}

export async function loadReports() {
  if (isAdmin()) {
    // Load both meeting requests and error reports
    const meetSnap = await getDocs(query(collection(db,'meetingRequests'), orderBy('requestedAt','desc')));
    _cachedMeetingRequests = meetSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  await loadAlertReports();
  window.updateReportBadge?.();
}

export async function updateReportBadge() {
  const snap  = await getDocs(query(collection(db,'error_reports'), where('status','==','未対応')));
  const count = snap.size;
  ['report-badge','m-report-badge'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = count||''; el.style.display = count ? 'inline-flex' : 'none'; }
  });
}

export async function confirmMeetingRequest(id, name) {
  await updateDoc(doc(db,'meetingRequests',id), { status: 'confirmed', confirmedAt: new Date().toISOString() });
  const m = _cachedMeetingRequests.find(x => x.id === id);
  if (m) m.status = 'confirmed';
  renderAlertList(_alertCurrentCat);
  alert(`✅ ${name} の面談リクエストを確認済みにしました`);
}

export async function openErrorReport() {
  document.getElementById('modal-title-text').textContent = '🐛 不具合・エラーを報告';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row"><label class="form-label">件名 <span style="color:var(--accent)">*</span></label>
      <input class="form-input" id="er-title" placeholder="例：出退勤ボタンが押せない"></div>
    <div class="form-row"><label class="form-label">発生画面・操作</label>
      <input class="form-input" id="er-screen" placeholder="例：出退勤タブ → 出勤ボタンを押したとき"></div>
    <div class="form-row"><label class="form-label">詳細</label>
      <textarea class="form-input" id="er-detail" rows="3" placeholder="エラーメッセージ、再現手順など" style="resize:vertical"></textarea></div>
    <div id="er-error" style="font-size:12px;color:var(--accent);min-height:16px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="submitErrorReport()">📨 報告する</button>
    </div>`;
  openModal();
}

export async function submitErrorReport() {
  const title  = document.getElementById('er-title').value.trim();
  const screen = document.getElementById('er-screen').value.trim();
  const detail = document.getElementById('er-detail').value.trim();
  const errEl  = document.getElementById('er-error');
  if (!title) { errEl.textContent = '件名を入力してください'; return; }
  await addDoc(collection(db,'error_reports'), {
    category: 'bug', urgency: 'medium',
    title, screen, detail,
    reporter: RC.currentUserData?.name || '不明',
    reporterUid: RC.currentUser?.uid || '',
    reporterDept: RC.currentUserData?.dept || '',
    status: '未対応',
    type: '不具合',
    createdAt: serverTimestamp()
  });
  closeModal();
  updateAlertBadge();
  alert('✅ 報告を送信しました。対応まで少々お待ちください。');
}

// ── Mobile reports ─────────────────────────────────────────

let _mReportCurrentCat = 'all';

export async function loadReportsM() {
  await loadReports();
  filterReportsMobile(_mReportCurrentCat);
}

export function filterReportsMobile(cat, btn) {
  _mReportCurrentCat = cat;
  document.querySelectorAll('.m-report-tab').forEach(b => {
    const isActive = b.dataset.cat === cat;
    b.style.borderBottomColor = isActive ? 'var(--ink)' : 'transparent';
    b.style.fontWeight = isActive ? '700' : '600';
    b.style.color = isActive ? 'var(--ink)' : 'var(--ink3)';
  });
  renderAlertList(cat);
}

export async function loadAdminAlerts() {
  const snap = await getDocs(query(collection(db,'meetingRequests'), orderBy('requestedAt','desc')));
  _cachedMeetingRequests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  await loadAlertReports();
}

// ── Window exports ────────────────────────────────────────
window.openAlertReportModal  = openAlertReportModal;
window.updateAlertForm       = updateAlertForm;
window.submitAlertReport     = submitAlertReport;
window.loadAlertReports      = loadAlertReports;
window.filterAlertList       = filterAlertList;
window.filterAdminReports    = filterAdminReports;
window.saveMeetingNote       = saveMeetingNote;
window.saveAdminNote         = saveAdminNote;
window.updateAlertStatus     = updateAlertStatus;
window.updateAlertBadge      = updateAlertBadge;
window.loadReports           = loadReports;
window.updateReportBadge     = updateReportBadge;
window.confirmMeetingRequest = confirmMeetingRequest;
window.openErrorReport       = openErrorReport;
window.submitErrorReport     = submitErrorReport;
window.loadReportsM          = loadReportsM;
window.filterReportsMobile   = filterReportsMobile;
window.loadAdminAlerts       = loadAdminAlerts;
window._cachedMeetingRequests = _cachedMeetingRequests;
