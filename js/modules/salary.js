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
  if (!isAdmin()) {
    // 非管理者は自分の給与情報のみ表示（管理者用ボタンを非表示）
    ['salary-add-btn','salary-table-btn','salary-bulk-btn'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    await loadMySalaryPage();
    return;
  }
  // admin mobile buttons
  const mAdminBtns = document.getElementById('salary-admin-btns-m');
  if (mAdminBtns) mAdminBtns.style.display = 'flex';

  const snap = await getDocs(query(collection(db,'salary'), orderBy('name')));
  _cachedSalary = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // totalSalary が未設定のレコードを自動補完
  const needsUpdate = _cachedSalary.filter(s => {
    const grade = s.salaryTable || s.rank;
    return SALARY_TABLE[grade] && !s.totalSalary;
  });
  if (needsUpdate.length) {
    const batch = writeBatch(db);
    needsUpdate.forEach(s => {
      const grade = s.salaryTable || s.rank;
      batch.update(doc(db,'salary',s.id), { totalSalary: SALARY_TABLE[grade].total });
      s.totalSalary = SALARY_TABLE[grade].total;
    });
    await batch.commit();
  }
  renderSalaryList();
}

// ── salary テーブルの内訳ラベル生成 ──────────────────────
function salaryBreakdown(td) {
  if (!td || !td.base) return '';
  const parts = [`基本給 ¥${td.base.toLocaleString()}`];
  if (td.duty)   parts.push(`業務手当 ¥${td.duty.toLocaleString()}`);
  if (td.sales)  parts.push(`営業手当 ¥${td.sales.toLocaleString()}`);
  if (td.role)   parts.push(`役職手当 ¥${td.role.toLocaleString()}`);
  if (td.orgInc) parts.push(`組織手当 ¥${td.orgInc.toLocaleString()}`);
  if (td.fixedOT) parts.push(`固定残業 ${td.fixedOT}h`);
  return parts.join(' ／ ');
}

export function renderSalaryList() {
  if (!isAdmin()) return;
  const container = document.getElementById('salary-list');
  if (!container) return;
  if (!_cachedSalary.length) {
    container.innerHTML = '<div class="empty">給与情報が登録されていません</div>'; return;
  }
  // 退職者を除外
  const retiredNames = new Set(RC._cachedMembers.filter(m => m.isRetired).map(m => m.name).filter(Boolean));
  const activeSalary = _cachedSalary.filter(s => {
    if (s.uid) return !RC._cachedMembers.find(m => m.id === s.uid)?.isRetired;
    return !retiredNames.has(s.name);
  });
  container.innerHTML = `<div class="tbl-wrap"><table>
    <thead><tr><th>名前</th><th>部門</th><th>グレード</th><th>月収合計</th><th>内訳</th><th>備考</th><th></th></tr></thead>
    <tbody>${activeSalary.map(s => {
      const grade = s.salaryTable || s.rank || '';
      const rankColor = RANK_COLORS[grade] || 'var(--ink3)';
      const td = SALARY_TABLE[grade] || {};
      const total = s.totalSalary || s.totalAmount || td.total || 0;
      return `<tr>
        <td style="font-weight:600">${escHtml(s.name||'—')}</td>
        <td style="font-size:11px;color:var(--ink3)">${escHtml(s.dept||'—')}</td>
        <td><span style="font-weight:700;color:${rankColor};font-size:12px">${escHtml(grade||'—')}</span>
            <div style="font-size:10px;color:var(--ink3)">${escHtml(td.rank||'')}</div></td>
        <td style="font-family:'DM Mono',monospace;font-weight:700">¥${total.toLocaleString()}</td>
        <td style="font-size:11px;color:var(--ink3)">${salaryBreakdown(td)}</td>
        <td style="font-size:11px;color:var(--ink3)">${escHtml(s.note||'')}</td>
        <td><button class="mini-btn" onclick="openEditSalaryModal('${s.id}')">編集</button></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;

  // Mobile list
  const mList = document.getElementById('salary-list-m');
  if (mList) {
    mList.innerHTML = activeSalary.map(s => {
      const grade = s.salaryTable || s.rank || '';
      const rankColor = RANK_COLORS[grade] || 'var(--ink3)';
      const td = SALARY_TABLE[grade] || {};
      const total = s.totalSalary || s.totalAmount || td.total || 0;
      return `<div class="m-card" onclick="openEditSalaryModal('${s.id}')">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="font-weight:700">${escHtml(s.name||'—')}</span>
          <span style="font-weight:700;color:${rankColor};font-size:13px">${escHtml(grade||'—')}</span>
        </div>
        <div style="font-size:11px;color:var(--ink3);margin-bottom:4px">${escHtml(td.rank||s.dept||'—')}</div>
        <div style="font-size:15px;font-weight:700;font-family:'DM Mono',monospace">¥${total.toLocaleString()}</div>
        <div style="font-size:10px;color:var(--ink3);margin-top:4px">${salaryBreakdown(td)}</div>
      </div>`;
    }).join('') || '<div class="empty">給与情報なし</div>';
  }
}

// ── Add / Edit salary modal ────────────────────────────────

function salaryForm(s, presetUid) {
  const isEdit = !!s;
  const currentGrade = s?.salaryTable || s?.rank || '';
  const rankOpts = RANK_ORDER.map(r => `<option value="${r}" ${currentGrade===r?'selected':''}>${r}（¥${(SALARY_TABLE[r]?.total||0).toLocaleString()}）</option>`).join('');
  const selectedUid = s?.uid || presetUid;
  const memberOpts = RC._cachedMembers.filter(m => !m.isRetired && !m.isAlliance && !m.noAuth && !m.id.startsWith('alliance_'))
    .map(m => `<option value="${m.id}" data-name="${m.name}" ${selectedUid===m.id?'selected':''}>${m.name}</option>`).join('');
  return `
    ${!isEdit ? `<div class="form-row"><label class="form-label">メンバー</label>
      <select class="form-input" id="sal-member">${memberOpts}</select></div>` : `
    <div class="form-row"><label class="form-label">名前</label>
      <input class="form-input" id="sal-name-display" value="${escHtml(s?.name||'')}" readonly style="background:var(--surface2)"></div>`}
    <div class="form-row"><label class="form-label">グレード</label>
      <select class="form-input" id="sal-rank" onchange="onSalaryTableChange()">${rankOpts}</select></div>
    <div id="sal-table-preview" style="margin:8px 0;padding:10px;background:var(--surface2);border-radius:6px;font-size:12px"></div>
    <div class="form-row"><label class="form-label">備考</label>
      <input class="form-input" id="sal-note" value="${escHtml(s?.note||'')}"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="${isEdit?`saveSalary('${s.id}')`:'saveSalary(null)'}">
        ${isEdit?'更新':'追加する'}
      </button>
    </div>`;
}

export function onSalaryTableChange() {
  const rank    = document.getElementById('sal-rank')?.value;
  const preview = document.getElementById('sal-table-preview');
  if (!preview || !rank) return;
  const td = SALARY_TABLE[rank];
  if (!td) { preview.innerHTML = ''; return; }
  const color = RANK_COLORS[rank] || 'var(--ink)';
  preview.innerHTML = `
    <div style="font-weight:700;color:${color};margin-bottom:6px">${td.rank} ／ ${rank}</div>
    <div style="font-size:12px;color:var(--ink3)">${salaryBreakdown(td)}</div>
    <div style="margin-top:6px;font-size:15px;font-weight:900;font-family:'DM Mono',monospace">月収合計 ¥${td.total.toLocaleString()}</div>`;
}

export function openAddSalaryModal(presetUid, presetName) {
  document.getElementById('modal-title-text').textContent = presetName ? `＋ ${presetName} の給与情報を設定` : '＋ 給与情報を追加';
  document.getElementById('modal-body').innerHTML = salaryForm(null, presetUid);
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
  const rank      = document.getElementById('sal-rank').value;
  const note      = document.getElementById('sal-note').value.trim();
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
    name, dept,
    salaryTable: rank,
    totalSalary: tableData.total || 0,
    note
  };
  if (uid) data.uid = uid;

  if (id) {
    await updateDoc(doc(db,'salary',id), data);
  } else {
    const batch = writeBatch(db);
    const salRef = doc(collection(db,'salary'));
    batch.set(salRef, { ...data, createdAt: serverTimestamp() });
    if (uid) batch.update(doc(db,'users',uid), { hasSalaryInfo: true });
    await batch.commit();
    // キャッシュ更新
    const m = RC._cachedMembers.find(m => m.id === uid);
    if (m) m.hasSalaryInfo = true;
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
    const color = RANK_COLORS[r] || 'var(--ink3)';
    return `<tr>
      <td style="font-weight:700;color:${color}">${r}</td>
      <td style="font-size:11px;color:var(--ink3)">${escHtml(td.rank)}</td>
      <td style="font-family:'DM Mono',monospace">¥${td.base.toLocaleString()}</td>
      ${td.duty   ? `<td style="font-family:'DM Mono',monospace;color:var(--ink3)">¥${td.duty.toLocaleString()}</td>` : '<td>—</td>'}
      ${td.sales  ? `<td style="font-family:'DM Mono',monospace;color:var(--ink3)">¥${td.sales.toLocaleString()}</td>` :
        td.role   ? `<td style="font-family:'DM Mono',monospace;color:var(--ink3)">¥${td.role.toLocaleString()}</td>` :
        td.orgInc ? `<td style="font-family:'DM Mono',monospace;color:var(--ink3)">¥${td.orgInc.toLocaleString()}</td>` : '<td>—</td>'}
      ${td.fixedOT ? `<td style="color:var(--ink3)">${td.fixedOT}h</td>` : '<td>—</td>'}
      <td style="font-family:'DM Mono',monospace;font-weight:700;color:${color}">¥${td.total.toLocaleString()}</td>
    </tr>`;
  }).join('');
  document.getElementById('modal-title-text').textContent = '📋 給与テーブル';
  document.getElementById('modal-body').innerHTML = `
    <div class="tbl-wrap"><table>
      <thead><tr><th>グレード</th><th>区分</th><th>基本給</th><th>業務/役職手当</th><th>営業/組織手当</th><th>固定残業</th><th>月収合計</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="btn-row"><button class="btn btn-secondary" onclick="closeModal()">閉じる</button></div>`;
  openModal();
}

export async function bulkImportSalaryData() {
  if (!confirm('給与未設定のメンバーにデフォルトランク(スターター1)の給与情報を一括作成しますか？\n既存データは上書きされません。')) return;
  const existNames = new Set(_cachedSalary.map(s => s.name).filter(Boolean));
  const DEFAULT_GRADE = 'スターター1';
  const td = SALARY_TABLE[DEFAULT_GRADE];
  const batch = writeBatch(db);
  RC._cachedMembers
    .filter(m => !m.isRetired && !existNames.has(m.name))
    .forEach(m => {
      const ref = doc(collection(db,'salary'));
      batch.set(ref, {
        name: m.name, dept: m.dept||'',
        salaryTable: DEFAULT_GRADE,
        totalSalary: td.total,
        note: '',
        createdAt: serverTimestamp()
      });
    });
  await batch.commit();
  loadSalary();
  alert('✅ 一括投入が完了しました');
}

// ── Migrate existing records to new salary table ──────────

export async function migrateSalaryToNewTable() {
  const snap = await getDocs(collection(db,'salary'));
  const batch = writeBatch(db);
  let count = 0;
  snap.docs.forEach(d => {
    const s = d.data();
    const grade = s.salaryTable || s.rank;
    const td = SALARY_TABLE[grade];
    if (td && !s.totalSalary) {
      batch.update(doc(db,'salary',d.id), { totalSalary: td.total });
      count++;
    }
  });
  if (count > 0) {
    await batch.commit();
    console.log(`✅ ${count}件のsalaryレコードにtotalSalaryを設定しました`);
  }
  loadSalary();
}

// ── Member: my salary view ─────────────────────────────────

export async function loadMySalaryInfo() {
  const uid = RC.currentUser?.uid;
  if (!uid) return;
  // uidで検索し、なければ名前フォールバック（移行期の古いデータ対応）
  let snap = await getDocs(query(collection(db,'salary'), where('uid','==',uid)));
  if (snap.empty) {
    const name = RC.currentUserData?.name;
    if (!name) return;
    snap = await getDocs(query(collection(db,'salary'), where('name','==',name)));
  }
  const data = snap.empty ? null : snap.docs[0].data();
  renderMySalaryContent(data, document.getElementById('mysalary-content'));
  renderMySalaryContent(data, document.getElementById('mysalary-content-m'));
}

function renderMySalaryContent(data, el) {
  if (!el) return;
  if (!data) {
    el.innerHTML = '<div class="empty">給与情報が登録されていません</div>'; return;
  }
  const grade = data.salaryTable || data.rank || '';
  const rankColor = RANK_COLORS[grade] || 'var(--ink3)';
  const td = SALARY_TABLE[grade] || {};
  const total = data.totalSalary || data.totalAmount || td.total || 0;

  // 全グレード一覧テーブル（自分の行をハイライト）
  const tableRows = RANK_ORDER.map(r => {
    const t = SALARY_TABLE[r] || {};
    const color = RANK_COLORS[r] || 'var(--ink3)';
    const isCurrent = r === grade;
    const rowStyle = isCurrent
      ? `background:${color}18;border-left:3px solid ${color};font-weight:700;`
      : 'border-left:3px solid transparent;';
    const parts = [];
    if (t.base)    parts.push(`基本 ¥${t.base.toLocaleString()}`);
    if (t.duty)    parts.push(`業務 ¥${t.duty.toLocaleString()}`);
    if (t.sales)   parts.push(`営業 ¥${t.sales.toLocaleString()}`);
    if (t.role)    parts.push(`役職 ¥${t.role.toLocaleString()}`);
    if (t.orgInc)  parts.push(`組織 ¥${t.orgInc.toLocaleString()}`);
    return `<tr style="${rowStyle}">
      <td style="padding:6px 10px;white-space:nowrap">
        <span style="font-weight:700;color:${color};font-size:12px">${r}</span>
        ${isCurrent ? `<span style="font-size:9px;background:${color};color:#fff;padding:1px 5px;border-radius:99px;margin-left:4px;vertical-align:middle">現在</span>` : ''}
      </td>
      <td style="padding:6px 10px;font-size:10px;color:var(--ink3);line-height:1.6">${parts.join(' / ')}</td>
      <td style="padding:6px 10px;font-family:'DM Mono',monospace;font-weight:${isCurrent?'900':'600'};color:${isCurrent?color:'var(--ink)'};white-space:nowrap;text-align:right">¥${(t.total||0).toLocaleString()}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="font-size:36px;font-weight:900;color:${rankColor};font-family:'DM Mono',monospace;line-height:1">${escHtml(grade||'—')}</div>
        <div>
          <div style="font-size:18px;font-weight:700">${data.name||'—'}</div>
          <div style="font-size:12px;color:var(--ink3)">${escHtml(td.rank||data.dept||'—')}</div>
        </div>
      </div>
      <div style="background:var(--surface2);border-radius:6px;padding:12px;margin-bottom:10px">
        <div style="font-size:10px;color:var(--ink3);margin-bottom:4px;text-transform:uppercase;letter-spacing:1px">月収合計</div>
        <div style="font-size:26px;font-weight:900;font-family:'DM Mono',monospace">¥${total.toLocaleString()}</div>
      </div>
      <div style="font-size:11px;color:var(--ink3);line-height:1.8">${salaryBreakdown(td)}</div>
      ${data.note ? `<div style="margin-top:10px;font-size:11px;color:var(--ink3)">備考: ${data.note}</div>` : ''}
    </div>
    <div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">📋 全グレード一覧</div>
    <div class="tbl-wrap" style="margin-bottom:0">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr style="background:var(--surface2)">
          <th style="padding:7px 10px;font-size:11px;text-align:left;font-weight:700">グレード</th>
          <th style="padding:7px 10px;font-size:11px;text-align:left;font-weight:700">内訳</th>
          <th style="padding:7px 10px;font-size:11px;text-align:right;font-weight:700">月収合計</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>`;
}

export async function loadMySalaryPage() {
  await loadMySalaryInfo();
  // Load meeting requests
  const meetSnap = await getDocs(query(
    collection(db,'meetingRequests'),
    where('uid','==',RC.currentUser?.uid)
  ));
  _cachedMeetingRequests = meetSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.requestedAt || '').localeCompare(a.requestedAt || ''));
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
