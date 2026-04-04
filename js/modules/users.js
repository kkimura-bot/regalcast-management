// ============================================================
// Users / Members management module
// ============================================================
import { RC, isAdmin, isLeaderOrAbove, roleLabel } from '../state.js';
import {
  auth, db,
  collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp, writeBatch
} from '../firebase.js';
import { depts_options } from '../data/constants.js';
import { openModal, closeModal } from '../utils/modal.js';
import { escHtml } from '../utils/helpers.js';

let _bulkDeleteSelected = new Set();

// ── Load ──────────────────────────────────────────────────

export async function loadUsers() {
  const snap = await getDocs(query(collection(db,'users'), orderBy('name')));
  RC._cachedMembers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderUsersTable(RC._cachedMembers);
}

export async function getMemberNames() {
  if (RC._cachedMembers.length) return RC._cachedMembers.map(m => m.name);
  const snap = await getDocs(query(collection(db,'users'), orderBy('name')));
  RC._cachedMembers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return RC._cachedMembers.map(m => m.name);
}

export function renderUsersTable(members) {
  const tbody = document.getElementById('users-table-body');
  const mList = document.getElementById('m-users-list');

  if (tbody) {
    if (!members.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">メンバーが登録されていません</td></tr>'; return;
    }
    tbody.innerHTML = members.map(u => `<tr>
      <td style="text-align:center">
        <input type="checkbox" class="user-check" value="${u.id}" style="width:15px;height:15px;cursor:pointer;accent-color:var(--accent)"
          onchange="updateBulkDeleteBar()">
      </td>
      <td style="font-weight:600">${escHtml(u.name||'—')}</td>
      <td style="font-size:11px;color:var(--ink3)">${escHtml(u.email||'—')}</td>
      <td><span class="badge ${u.role==='admin'?'badge-doing':u.role==='leader'?'badge-leader':'badge-todo'}">${roleLabel(u.role)}</span>${u.isAlliance?'<span class="badge" style="background:rgba(58,125,90,.12);color:var(--accent2);margin-left:4px">委託</span>':''}</td>
      <td style="font-size:11px;color:var(--ink3)">${escHtml(u.dept||'—')}</td>
      <td><button class="mini-btn" onclick="openEditUserModal('${u.id}')">編集</button></td>
    </tr>`).join('');
  }

  if (mList) {
    mList.innerHTML = members.map(u => `<div class="m-card" onclick="openEditUserModal('${u.id}')">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="font-weight:700">${escHtml(u.name||'—')}</div>
        <span class="badge ${u.role==='admin'?'badge-doing':u.role==='leader'?'badge-leader':'badge-todo'}">${roleLabel(u.role)}</span>
      </div>
      <div style="font-size:11px;color:var(--ink3);margin-top:4px">${escHtml(u.email||'—')}</div>
      <div style="font-size:11px;color:var(--ink3)">${escHtml(u.dept||'—')}</div>
    </div>`).join('') || '<div class="empty">メンバーなし</div>';
  }
}

// ── Bulk delete ───────────────────────────────────────────

export function updateBulkDeleteBar() {
  const checked = [...document.querySelectorAll('.user-check:checked')].map(c => c.value);
  _bulkDeleteSelected = new Set(checked);
  const bar   = document.getElementById('bulk-delete-bar');
  const count = document.getElementById('bulk-delete-count');
  if (bar)   bar.style.display   = checked.length ? 'flex' : 'none';
  if (count) count.textContent   = `${checked.length}名を選択中`;
}

export function selectAllUsers(checkbox) {
  document.querySelectorAll('.user-check').forEach(c => c.checked = checkbox.checked);
  updateBulkDeleteBar();
}

export async function bulkDeleteUsers() {
  if (!_bulkDeleteSelected.size) return;
  if (!confirm(`${_bulkDeleteSelected.size}名を削除しますか？\nこの操作は元に戻せません。`)) return;
  const batch = writeBatch(db);
  _bulkDeleteSelected.forEach(uid => batch.delete(doc(db,'users',uid)));
  await batch.commit();
  _bulkDeleteSelected.clear();
  loadUsers();
}

// ── Add user ──────────────────────────────────────────────

export function openAddUserModal() {
  const deptOpts = ['', ...depts_options].map(d => `<option>${d}</option>`).join('');
  document.getElementById('modal-title-text').textContent = '＋ メンバーを追加';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row"><label class="form-label">メールアドレス <span style="color:var(--accent)">*</span></label>
      <input class="form-input" id="new-email" type="email" placeholder="example@email.com"></div>
    <div class="form-row"><label class="form-label">パスワード <span style="color:var(--accent)">*</span></label>
      <input class="form-input" id="new-pass" type="password" placeholder="6文字以上"></div>
    <div class="form-row"><label class="form-label">名前 <span style="color:var(--accent)">*</span></label>
      <input class="form-input" id="new-name" placeholder="例：田中 太郎"></div>
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">権限</label>
        <select class="form-input" id="new-role">
          <option value="member">メンバー</option>
          <option value="leader">リーダー</option>
          <option value="admin">管理者</option>
        </select></div>
      <div class="form-row"><label class="form-label">部門</label>
        <select class="form-input" id="new-dept">${deptOpts}</select></div>
    </div>
    <div id="add-user-error" style="font-size:12px;color:var(--accent);min-height:16px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="addNewUser()">追加する</button>
    </div>`;
  openModal();
}

export async function addNewUser() {
  const email = document.getElementById('new-email').value.trim();
  const pass  = document.getElementById('new-pass').value;
  const name  = document.getElementById('new-name').value.trim();
  const role  = document.getElementById('new-role').value;
  const dept  = document.getElementById('new-dept').value;
  const errEl = document.getElementById('add-user-error');

  if (!email || !pass || !name) { errEl.textContent = '必須項目を入力してください'; return; }
  if (pass.length < 6) { errEl.textContent = 'パスワードは6文字以上'; return; }

  try {
    // Firebase Admin SDK not available client-side; use REST API workaround via secondary app
    // For now, create user doc only (requires admin SDK in Cloud Function for Auth)
    const docRef = doc(collection(db,'users'));
    await setDoc(docRef, { name, email, role, dept, createdAt: serverTimestamp() });
    closeModal();
    loadUsers();
    alert(`✅ ${name} を追加しました（Firebase Auth への登録はCloud Function経由で行ってください）`);
  } catch(e) {
    errEl.textContent = e.message;
  }
}

// ── Bulk add members (name only) ──────────────────────────

export function openBulkAddMembersModal() {
  const deptOpts = depts_options.map(d => `<option>${d}</option>`).join('');
  document.getElementById('modal-title-text').textContent = '👥 名前のみ一括登録';
  document.getElementById('modal-body').innerHTML = `
    <div style="font-size:11px;color:var(--ink3);margin-bottom:10px;line-height:1.7">
      名前と部門を指定して、メールアドレス・パスワードなしでメンバーを追加します。<br>
      後からメールアドレスを編集で追加できます。
    </div>
    <div class="form-row"><label class="form-label">名前（1行1人）<span style="color:var(--accent)">*</span></label>
      <textarea class="form-input" id="bulk-names" rows="6" placeholder="田中 太郎&#10;鈴木 花子&#10;佐藤 一郎" style="resize:vertical"></textarea></div>
    <div class="form-row"><label class="form-label">部門</label>
      <select class="form-input" id="bulk-dept">${deptOpts}</select></div>
    <div class="form-row"><label class="form-label">権限</label>
      <select class="form-input" id="bulk-role">
        <option value="member">メンバー</option>
        <option value="leader">リーダー</option>
      </select></div>
    <div id="bulk-add-error" style="font-size:12px;color:var(--accent);min-height:16px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="execBulkAddMembers()">一括登録</button>
    </div>`;
  openModal();
}

export async function execBulkAddMembers() {
  const names = document.getElementById('bulk-names').value.split('\n').map(n => n.trim()).filter(Boolean);
  const dept  = document.getElementById('bulk-dept').value;
  const role  = document.getElementById('bulk-role').value;
  const errEl = document.getElementById('bulk-add-error');

  if (!names.length) { errEl.textContent = '名前を入力してください'; return; }

  const batch = writeBatch(db);
  names.forEach(name => {
    const ref = doc(collection(db,'users'));
    batch.set(ref, { name, dept, role, email: '', createdAt: serverTimestamp() });
  });
  await batch.commit();
  closeModal();
  loadUsers();
  alert(`✅ ${names.length}名を登録しました`);
}

// ── Edit user ─────────────────────────────────────────────

export function openEditUserModal(uid) {
  const u = RC._cachedMembers.find(m => m.id === uid);
  if (!u) return;
  const deptOpts = ['', ...depts_options].map(d => `<option ${u.dept===d?'selected':''}>${d}</option>`).join('');

  document.getElementById('modal-title-text').textContent = 'メンバーを編集';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row"><label class="form-label">名前</label>
      <input class="form-input" id="eu-name" value="${escHtml(u.name||'')}"></div>
    <div class="form-row"><label class="form-label">メールアドレス</label>
      <input class="form-input" id="eu-email" type="email" value="${escHtml(u.email||'')}"></div>
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">権限</label>
        <select class="form-input" id="eu-role">
          <option value="member" ${u.role==='member'?'selected':''}>メンバー</option>
          <option value="leader" ${u.role==='leader'?'selected':''}>リーダー</option>
          <option value="admin"  ${u.role==='admin' ?'selected':''}>管理者</option>
        </select></div>
      <div class="form-row"><label class="form-label">部門</label>
        <select class="form-input" id="eu-dept">${deptOpts}</select></div>
    </div>
    <div class="form-row">
      <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="eu-self-report" ${u.selfReportEnabled?'checked':''} style="width:14px;height:14px;accent-color:var(--accent2)">
        📝 シフト自己報告を許可する
      </label>
    </div>
    <div class="form-row">
      <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="eu-is-alliance" ${u.isAlliance?'checked':''} style="width:14px;height:14px;accent-color:var(--accent2)">
        🤝 アライアンス（委託）メンバー
      </label>
    </div>
    <details style="margin-bottom:12px">
      <summary style="font-size:11px;color:var(--ink3);cursor:pointer;margin-bottom:8px">🚃 通勤テンプレ編集</summary>
      <div id="eu-fare-templates"></div>
      <button class="mini-btn" onclick="euAddFareTemplate()" style="margin-top:6px;font-size:11px">＋ 店舗を追加</button>
    </details>
    <div id="eu-error" style="font-size:12px;color:var(--accent);min-height:16px"></div>
    <div class="btn-row">
      <button class="btn" style="background:#fee2e2;color:var(--accent);border:none" onclick="confirmDeleteUser('${uid}')">削除</button>
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="saveUser('${uid}')">保存</button>
    </div>`;

  // Initialize eu fare templates (use setter to keep fare.js module state in sync)
  window.setEuFareTemplates?.(u.fareTemplates ? JSON.parse(JSON.stringify(u.fareTemplates)) : []);
  window.euRenderFareTemplates?.();
  openModal();
}

export async function saveUser(uid) {
  const name            = document.getElementById('eu-name').value.trim();
  const email           = document.getElementById('eu-email').value.trim();
  const role            = document.getElementById('eu-role').value;
  const dept            = document.getElementById('eu-dept').value;
  const selfReportEnabled = document.getElementById('eu-self-report').checked;
  const isAlliance      = document.getElementById('eu-is-alliance').checked;
  const fareTemplates   = window._euFareTemplates || [];
  const errEl           = document.getElementById('eu-error');

  if (!name) { errEl.textContent = '名前を入力してください'; return; }

  await updateDoc(doc(db,'users',uid), { name, email, role, dept, selfReportEnabled, isAlliance, fareTemplates });

  // Update cached member
  const idx = RC._cachedMembers.findIndex(m => m.id === uid);
  if (idx >= 0) Object.assign(RC._cachedMembers[idx], { name, email, role, dept, selfReportEnabled, isAlliance, fareTemplates });

  closeModal();
  renderUsersTable(RC._cachedMembers);
  alert(`✅ ${name} の情報を更新しました`);
}

export function confirmDeleteUser(uid) {
  const u = RC._cachedMembers.find(m => m.id === uid);
  if (!confirm(`${u?.name||uid} を削除しますか？`)) return;
  deleteUser(uid);
}

export async function deleteUser(uid) {
  await deleteDoc(doc(db,'users',uid));
  closeModal();
  loadUsers();
}

// ── Alliance add (single / bulk) ──────────────────────────

export function openAddAllianceModal() {
  document.getElementById('modal-title-text').textContent = '🤝 アライアンスメンバーを追加';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row"><label class="form-label">名前 <span style="color:var(--accent)">*</span></label>
      <input class="form-input" id="al-name" placeholder="例：山田 花子"></div>
    <div class="form-row"><label class="form-label">部門</label>
      <select class="form-input" id="al-dept">${depts_options.map(d=>`<option>${d}</option>`).join('')}</select></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="saveAllianceMember()">追加</button>
    </div>`;
  openModal();
}

export async function saveAllianceMember() {
  const name = document.getElementById('al-name').value.trim();
  const dept = document.getElementById('al-dept').value;
  if (!name) { alert('名前を入力してください'); return; }
  const ref = doc(collection(db,'users'));
  await setDoc(ref, { name, dept, role: 'member', isAlliance: true, email: '', createdAt: serverTimestamp() });
  closeModal();
  loadUsers();
  alert(`✅ アライアンスメンバー「${name}」を追加しました`);
}

export function openAddAllianceBulkModal() {
  document.getElementById('modal-title-text').textContent = '🤝 アライアンス一括追加';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row"><label class="form-label">名前（1行1人）</label>
      <textarea class="form-input" id="al-bulk-names" rows="8" placeholder="山田 花子&#10;佐藤 太郎" style="resize:vertical"></textarea></div>
    <div class="form-row"><label class="form-label">部門</label>
      <select class="form-input" id="al-bulk-dept">${depts_options.map(d=>`<option>${d}</option>`).join('')}</select></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="execAllianceBulkAdd()">一括追加</button>
    </div>`;
  openModal();
}

export async function execAllianceBulkAdd() {
  const names = document.getElementById('al-bulk-names').value.split('\n').map(n=>n.trim()).filter(Boolean);
  const dept  = document.getElementById('al-bulk-dept').value;
  if (!names.length) { alert('名前を入力してください'); return; }
  const batch = writeBatch(db);
  names.forEach(name => {
    const ref = doc(collection(db,'users'));
    batch.set(ref, { name, dept, role: 'member', isAlliance: true, email: '', createdAt: serverTimestamp() });
  });
  await batch.commit();
  closeModal();
  loadUsers();
  alert(`✅ ${names.length}名のアライアンスメンバーを追加しました`);
}

// ── Filter by search ──────────────────────────────────────

export function filterUsersBySearch(q) {
  const keyword = q.trim();
  if (!keyword) { renderUsersTable(RC._cachedMembers); return; }
  const filtered = RC._cachedMembers.filter(u =>
    (u.name||'').includes(keyword) || (u.email||'').includes(keyword)
  );
  renderUsersTable(filtered);
}

// ── Window exports ────────────────────────────────────────
window.loadUsers                = loadUsers;
window.getMemberNames           = getMemberNames;
window.renderUsersTable         = renderUsersTable;
window.updateBulkDeleteBar      = updateBulkDeleteBar;
window.selectAllUsers           = selectAllUsers;
window.bulkDeleteUsers          = bulkDeleteUsers;
window.openAddUserModal         = openAddUserModal;
window.addNewUser               = addNewUser;
window.openBulkAddMembersModal  = openBulkAddMembersModal;
window.execBulkAddMembers       = execBulkAddMembers;
window.openEditUserModal        = openEditUserModal;
window.saveUser                 = saveUser;
window.confirmDeleteUser        = confirmDeleteUser;
window.deleteUser               = deleteUser;
window.openAddAllianceModal     = openAddAllianceModal;
window.saveAllianceMember       = saveAllianceMember;
window.openAddAllianceBulkModal = openAddAllianceBulkModal;
window.execAllianceBulkAdd      = execAllianceBulkAdd;
window.filterUsersBySearch      = filterUsersBySearch;
