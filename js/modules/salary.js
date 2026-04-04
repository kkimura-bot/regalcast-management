// ============================================================
// Salary module
// ============================================================
import { RC, isAdmin, isLeaderOrAbove } from '../state.js';
import {
  db, collection, doc, setDoc, getDoc, getDocs, addDoc,
  updateDoc, deleteDoc, query, where, orderBy, serverTimestamp, writeBatch
} from '../firebase.js';
import { SALARY_TABLE, RANK_ORDER, RANK_COLORS, depts_options } from '../data/constants.js';
import { openModal, closeModal } from '../utils/modal.js';
import { escHtml } from '../utils/helpers.js';

let _cachedSalary = [];
let _cachedMeetingRequests = [];

// ── Admin: load all salary records ────────────────────────

export async function loadSalary() {
  const snap = await getDocs(query(collection(db,'salary'), orderBy('name')));
  _cachedSalary = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderSalaryList();
}

export function renderSalaryList() {
  const container = document.getElementById('salary-list');
  if (!container) return;
  if (!_cachedSalary.length) {
    container.innerHTML = '<div class="empty">給与情報が登録されていません</div>'; return;
  }
  container.innerHTML = `<div class="tbl-wrap"><table>
    <thead><tr><th>名前</th><th>部門</th><th>ランク</th><th>基本給</th><th>残業単価</th><th>備考</th><th></th></tr></thead>
    <tbody>${_cachedSalary.map(s => {
      const rankColor = RANK_COLORS[s.rank] || 'var(--ink3)';
      const tableData = SALARY_TABLE[s.rank] || {};
      return `<tr>
        <td style="font-weight:600">${escHtml(s.name||'—')}</td>
        <td style="font-size:11px;color:var(--ink3)">${escHtml(s.dept||'—')}</td>
        <td><span style="font-weight:900;color:${rankColor};font-size:16px;font-family:'DM Mono',monospace">${s.rank||'—'}</span></td>
        <td style="font-family:'DM Mono',monospace">¥${(s.baseAmount||tableData.base||0).toLocaleString()}</td>
        <td style="font-family:'DM Mono',monospace;color:var(--ink3)">¥${(s.overtimeRate||tableData.overtime||0).toLocaleString()}/h</td>
        <td style="font-size:11px;color:var(--ink3)">${escHtml(s.note||'')}</td>
        <td>
          <button class="mini-btn" onclick="openEditSalaryModal('${s.id}')">編集</button>
        </td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;

  // Mobile list
  const mList = document.getElementById('salary-list-m');
  if (mList) {
    mList.innerHTML = _cachedSalary.map(s => {
      const rankColor = RANK_COLORS[s.rank] || 'var(--ink3)';
      const tableData = SALARY_TABLE[s.rank] || {};
      return `<div class="m-card" onclick="openEditSalaryModal('${s.id}')">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px">
          <span style="font-weight:700">${escHtml(s.name||'—')}</span>
          <span style="font-weight:900;color:${rankColor};font-size:18px;font-family:'DM Mono',monospace">${s.rank||'—'}</span>
        </div>
        <div style="font-size:11px;color:var(--ink3);margin-bottom:4px">${escHtml(s.dept||'—')}</div>
        <div style="font-size:13px;font-family:'DM Mono',monospace">¥${(s.baseAmount||tableData.base||0).toLocaleString()}</div>
      </div>`;
    }).join('') || '<div class="empty">給与情報なし</div>';
  }
}

// ── Add / Edit salary modal ────────────────────────────────

function salaryForm(s) {
  const isEdit = !!s;
  const rankOpts = RANK_ORDER.map(r => `<option value="${r}" ${s?.rank===r?'selected':''}>${r} — ¥${(SALARY_TABLE[r]?.base||0).toLocaleString()}</option>`).join('');
  const memberOpts = RC._cachedMembers.map(m => `<option value="${m.id}" data-name="${m.name}" ${s?.uid===m.id?'selected':''}>${m.name}</option>`).join('');
  return `
    ${!isEdit ? `<div class="form-row"><label class="form-label">メンバー</label>
      <select class="form-input" id="sal-member">${memberOpts}</select></div>` : `
    <div class="form-row"><label class="form-label">名前</label>
      <input class="form-input" id="sal-name-display" value="${escHtml(s?.name||'')}" readonly style="background:var(--surface2)"></div>`}
    <div class="form-row"><label class="form-label">ランク</label>
      <select class="form-input" id="sal-rank" onchange="onSalaryTableChange()">${rankOpts}</select></div>
    <div id="sal-table-preview" style="margin:8px 0;padding:10px;background:var(--surface2);border-radius:6px;font-size:12px"></div>
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">基本給（個別設定）</label>
        <input type="number" class="form-input" id="sal-base" value="${s?.baseAmount||''}" placeholder="空欄でランク標準適用"></div>
      <div class="form-row"><label class="form-label">残業単価（個別設定）</label>
        <input type="number" class="form-input" id="sal-ot" value="${s?.overtimeRate||''}" placeholder="空欄でランク標準適用"></div>
    </div>
    <div class="form-row"><label class="form-label">備考</label>
      <input class="form-input" id="sal-note" value="${escHtml(s?.note||'')}"></div>
    <div class="btn-row">
      ${isEdit ? `<button class="btn" style="background:#fee2e2;color:var(--accent);border:none" onclick="deleteSalary('${s.id}')">削除</button>` : ''}
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="${isEdit?`saveSalary('${s.id}')`:'saveSalary(null)'}">
        ${isEdit?'更新':'追加する'}
      </button>
    </div>`;
}

export function onSalaryTableChange() {
  const rank  = document.getElementById('sal-rank')?.value;
  const preview = document.getElementById('sal-table-preview');
  if (!preview || !rank) return;
  const td = SALARY_TABLE[rank];
  if (!td) { preview.innerHTML = ''; return; }
  preview.innerHTML = `<span style="color:${RANK_COLORS[rank]||'var(--ink)'}">ランク ${rank}</span> — 基本給 ¥${td.base.toLocaleString()} ／ 残業単価 ¥${td.overtime.toLocaleString()}/h`;
}

export function openAddSalaryModal() {
  document.getElementById('modal-title-text').textContent = '＋ 給与情報を追加';
  document.getElementById('modal-body').innerHTML = salaryForm(null);
  onSalaryTableChange();
  openModal();
}

export function openEditSalaryModal(id) {
  const s = _cachedSalary.find(x => x.id === id);
  if (!s) return;
  document.getElementById('modal-title-text').textContent = '給与情報を編集';
  document.getElementById('modal-body').innerHTML = salaryForm(s);
  onSalaryTableChange();
  openModal();
}

export async function saveSalary(id) {
  const rank     = document.getElementById('sal-rank').value;
  const base     = parseInt(document.getElementById('sal-base').value) || null;
  const ot       = parseInt(document.getElementById('sal-ot').value)   || null;
  const note     = document.getElementById('sal-note').value.trim();
  const tableData = SALARY_TABLE[rank] || {};

  let uid, name, dept;
  if (!id) {
    const sel = document.getElementById('sal-member');
    uid  = sel?.value;
    const opt = sel?.options[sel.selectedIndex];
    name = opt?.dataset?.name || '';
    dept = RC._cachedMembers.find(m => m.id === uid)?.dept || '';
  } else {
    const s = _cachedSalary.find(x => x.id === id);
    uid  = s?.uid;
    name = s?.name;
    dept = s?.dept;
  }

  const data = {
    uid, name, dept, rank,
    baseAmount:   base  ?? tableData.base    ?? 0,
    overtimeRate: ot    ?? tableData.overtime ?? 0,
    note
  };

  if (id) {
    await updateDoc(doc(db,'salary',id), data);
  } else {
    await addDoc(collection(db,'salary'), { ...data, createdAt: serverTimestamp() });
  }
  closeModal();
  loadSalary();
}

export async function deleteSalary(id) {
  if (!confirm('この給与情報を削除しますか？')) return;
  await deleteDoc(doc(db,'salary',id));
  closeModal();
  loadSalary();
}

export function openSalaryTableModal() {
  const rows = RANK_ORDER.map(r => {
    const td = SALARY_TABLE[r];
    return `<tr>
      <td style="font-weight:900;color:${RANK_COLORS[r]};font-family:'DM Mono',monospace;font-size:18px">${r}</td>
      <td style="font-family:'DM Mono',monospace">¥${td.base.toLocaleString()}</td>
      <td style="font-family:'DM Mono',monospace;color:var(--ink3)">¥${td.overtime.toLocaleString()}/h</td>
    </tr>`;
  }).join('');
  document.getElementById('modal-title-text').textContent = '📋 基本給与テーブル';
  document.getElementById('modal-body').innerHTML = `
    <div class="tbl-wrap"><table>
      <thead><tr><th>ランク</th><th>基本給</th><th>残業単価</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="btn-row"><button class="btn btn-secondary" onclick="closeModal()">閉じる</button></div>`;
  openModal();
}

export async function bulkImportSalaryData() {
  if (!confirm('全メンバーにデフォルトランク(C)の給与情報を一括作成しますか？\n既存データは上書きされません。')) return;
  const existUids = new Set(_cachedSalary.map(s => s.uid));
  const batch = writeBatch(db);
  RC._cachedMembers
    .filter(m => !existUids.has(m.id))
    .forEach(m => {
      const ref = doc(collection(db,'salary'));
      const td  = SALARY_TABLE['C'];
      batch.set(ref, {
        uid: m.id, name: m.name, dept: m.dept||'', rank: 'C',
        baseAmount: td.base, overtimeRate: td.overtime, note: '',
        createdAt: serverTimestamp()
      });
    });
  await batch.commit();
  loadSalary();
  alert('✅ 一括投入が完了しました');
}

// ── Member: my salary view ─────────────────────────────────

export async function loadMySalaryInfo() {
  const uid = RC.currentUser?.uid;
  if (!uid) return;
  const snap = await getDocs(query(collection(db,'salary'), where('uid','==',uid)));
  const data = snap.empty ? null : snap.docs[0].data();
  renderMySalaryContent(data, document.getElementById('mysalary-content'));
  renderMySalaryContent(data, document.getElementById('mysalary-content-m'));
}

function renderMySalaryContent(data, el) {
  if (!el) return;
  if (!data) {
    el.innerHTML = '<div class="empty">給与情報が登録されていません</div>'; return;
  }
  const rankColor = RANK_COLORS[data.rank] || 'var(--ink3)';
  el.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:14px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="font-size:48px;font-weight:900;color:${rankColor};font-family:'DM Mono',monospace;line-height:1">${data.rank||'—'}</div>
        <div>
          <div style="font-size:18px;font-weight:700">${data.name||'—'}</div>
          <div style="font-size:12px;color:var(--ink3)">${data.dept||'—'}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="background:var(--surface2);border-radius:6px;padding:12px">
          <div style="font-size:10px;color:var(--ink3);margin-bottom:4px;text-transform:uppercase;letter-spacing:1px">基本給</div>
          <div style="font-size:20px;font-weight:900;font-family:'DM Mono',monospace">¥${(data.baseAmount||0).toLocaleString()}</div>
        </div>
        <div style="background:var(--surface2);border-radius:6px;padding:12px">
          <div style="font-size:10px;color:var(--ink3);margin-bottom:4px;text-transform:uppercase;letter-spacing:1px">残業単価</div>
          <div style="font-size:20px;font-weight:900;font-family:'DM Mono',monospace">¥${(data.overtimeRate||0).toLocaleString()}<span style="font-size:11px;font-weight:400">/h</span></div>
        </div>
      </div>
      ${data.note ? `<div style="margin-top:10px;font-size:11px;color:var(--ink3)">備考: ${data.note}</div>` : ''}
    </div>`;
}

export async function loadMySalaryPage() {
  await loadMySalaryInfo();
  // Load meeting requests
  const meetSnap = await getDocs(query(
    collection(db,'meetingRequests'),
    where('uid','==',RC.currentUser?.uid),
    orderBy('requestedAt','desc')
  ));
  _cachedMeetingRequests = meetSnap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function requestMeeting(source) {
  document.getElementById('modal-title-text').textContent = '🤝 面談をリクエスト';
  document.getElementById('modal-body').innerHTML = `
    <div style="font-size:12px;color:var(--ink3);margin-bottom:12px">管理者に面談のリクエストを送信します。</div>
    <div class="form-row"><label class="form-label">相談内容 <span style="color:var(--accent)">*</span></label>
      <select class="form-input" id="meet-cat">
        <option value="">選択してください</option>
        <option>給与・待遇について</option>
        <option>キャリアについて</option>
        <option>業務・環境について</option>
        <option>その他</option>
      </select></div>
    <div class="form-row"><label class="form-label">メッセージ（任意）</label>
      <textarea class="form-input" id="meet-msg" rows="3" placeholder="詳細・相談したいことを記入してください" style="resize:vertical"></textarea></div>
    <div id="meet-error" style="font-size:12px;color:var(--accent);min-height:16px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="submitMeetingRequest()">📨 送信する</button>
    </div>`;
  openModal();
}

export async function submitMeetingRequest() {
  const cat  = document.getElementById('meet-cat').value;
  const msg  = document.getElementById('meet-msg').value.trim();
  const errEl = document.getElementById('meet-error');
  if (!cat) { errEl.textContent = '相談内容を選択してください'; return; }

  await addDoc(collection(db,'meetingRequests'), {
    uid: RC.currentUser.uid,
    name: RC.currentUserData.name,
    dept: RC.currentUserData.dept || '',
    currentTable: `ランク${RC.currentUserData?.rank||'未設定'}`,
    category: cat,
    message: msg,
    status: 'pending',
    requestedAt: new Date().toISOString(),
    createdAt: serverTimestamp()
  });
  closeModal();
  alert('✅ 面談リクエストを送信しました！管理者から連絡があります。');
}

// ── Window exports ────────────────────────────────────────
window.loadSalary          = loadSalary;
window.renderSalaryList    = renderSalaryList;
window.onSalaryTableChange = onSalaryTableChange;
window.openAddSalaryModal  = openAddSalaryModal;
window.openEditSalaryModal = openEditSalaryModal;
window.saveSalary          = saveSalary;
window.deleteSalary        = deleteSalary;
window.openSalaryTableModal = openSalaryTableModal;
window.bulkImportSalaryData = bulkImportSalaryData;
window.loadMySalaryInfo    = loadMySalaryInfo;
window.loadMySalaryPage    = loadMySalaryPage;
window.requestMeeting      = requestMeeting;
window.submitMeetingRequest = submitMeetingRequest;
window._cachedSalary       = _cachedSalary;
window._cachedMeetingRequests = _cachedMeetingRequests;
