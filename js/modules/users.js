// ============================================================
// Users / Members management module
// ============================================================
import { RC, isAdmin, isLeaderOrAbove, roleLabel } from '../state.js';
import {
  auth, db, storage, firebaseConfig,
  collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, serverTimestamp, writeBatch,
  ref, uploadBytes, getDownloadURL,
  createUserWithEmailAndPassword, sendPasswordResetEmail
} from '../firebase.js';
import { depts_options, SALARY_TABLE, RANK_ORDER, RANK_COLORS, sortMembersByOrder } from '../data/constants.js';
import { openModal, closeModal } from '../utils/modal.js';
import { escHtml } from '../utils/helpers.js';

let _bulkDeleteSelected = new Set();
let _cachedSalNames = new Set();
let _cachedRoadmapNames = new Set();

// ── Load ──────────────────────────────────────────────────

export async function loadUsers() {
  const [usersSnap, salarySnap, roadmapSnap] = await Promise.all([
    getDocs(query(collection(db,'users'), orderBy('name'))),
    getDocs(collection(db,'salary')),
    getDocs(collection(db,'academy_roadmap'))
  ]);
  RC._cachedMembers = sortMembersByOrder(usersSnap.docs.map(d => ({ id: d.id, ...d.data() })));

  // salaryコレクションに存在するメンバー名のセット
  _cachedSalNames = new Set(salarySnap.docs.map(d => d.data().name).filter(Boolean));

  // ロードマップが設定済みのメンバー名のセット（{name}_custom_plan 形式のドキュメントのみ）
  _cachedRoadmapNames = new Set(
    roadmapSnap.docs
      .filter(d => d.id.endsWith('_custom_plan'))
      .map(d => d.id.replace('_custom_plan', ''))
  );

  renderUsersTable(_getSortedFilteredMembers(), _cachedSalNames);
}

export async function getMemberNames() {
  if (RC._cachedMembers.length) return RC._cachedMembers.map(m => m.name);
  const snap = await getDocs(query(collection(db,'users'), orderBy('name')));
  RC._cachedMembers = sortMembersByOrder(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  return RC._cachedMembers.map(m => m.name);
}

function _userRow(u, salNames) {
  const isContractor = u.isAlliance || u.noAuth || u.id.startsWith('alliance_') || u.role === '委託' || u.role === 'alliance';
  const noSalary = !isContractor && !salNames?.has(u.name) && !u.hasSalaryInfo;
  const rowStyle = u.isRetired ? 'opacity:0.5;background:var(--surface2)' : '';
  const retiredBadge = u.isRetired ? `<span class="badge" style="background:rgba(100,100,100,.12);color:var(--ink3);margin-left:4px">退職</span>` : '';
  return `<tr style="${rowStyle}">
    <td style="text-align:center">
      <input type="checkbox" class="user-check" value="${u.id}" style="width:15px;height:15px;cursor:pointer;accent-color:var(--accent)"
        onchange="updateBulkDeleteBar()">
    </td>
    <td style="font-weight:600;cursor:pointer;color:var(--blue)" onclick="openRoadmapPreviewModal('${u.id}','${escHtml(u.name||'')}')">${escHtml(u.name||'—')}${retiredBadge}</td>
    <td style="font-size:11px;color:var(--ink3)">${escHtml(u.email||'—')}</td>
    <td>
      <span class="badge ${u.role==='admin'?'badge-doing':u.role==='leader'?'badge-leader':'badge-todo'}">${roleLabel(u.role)}</span>
      ${noSalary?`<span class="badge" style="background:rgba(200,71,42,.1);color:var(--accent);margin-left:4px;cursor:pointer" onclick="openAddSalaryModal('${u.id}','${escHtml(u.name||'')}')">給与未設定</span>`:''}
    </td>
    <td style="font-size:11px;color:var(--ink3)">${escHtml(u.dept||'—')}</td>
    <td style="font-size:11px;color:var(--ink3)">${escHtml(u.company||'—')}</td>
    <td style="display:flex;gap:6px;align-items:center">
      ${!isContractor && !u.isRetired ? `<button class="mini-btn" style="background:rgba(37,99,235,.08);color:var(--blue);border-color:rgba(37,99,235,.2);position:relative" onclick="window.open('roadmap.html?uid=${u.id}','_blank')">📋 ロードマップ${!_cachedRoadmapNames.has(u.name) ? `<span style="position:absolute;top:-5px;right:-5px;background:var(--accent);color:#fff;font-size:9px;font-weight:700;padding:1px 4px;border-radius:6px;line-height:1.4">未設定</span>` : ''}</button>` : ''}
      <button class="mini-btn" onclick="openEditUserModal('${u.id}')">編集</button>
    </td>
  </tr>`;
}

function _userCard(u, salNames) {
  const isContractor = u.isAlliance || u.noAuth || u.id.startsWith('alliance_') || u.role === '委託' || u.role === 'alliance';
  const noSalary = !isContractor && !salNames?.has(u.name) && !u.hasSalaryInfo;
  const cardStyle = u.isRetired ? 'opacity:0.5;background:var(--surface2)' : '';
  const retiredBadge = u.isRetired ? `<span class="badge" style="background:rgba(100,100,100,.12);color:var(--ink3)">退職</span>` : '';
  return `<div class="m-card" style="${cardStyle}" onclick="openEditUserModal('${u.id}')">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div style="font-weight:700;color:var(--blue);cursor:pointer" onclick="event.stopPropagation();openRoadmapPreviewModal('${u.id}','${escHtml(u.name||'')}')">${escHtml(u.name||'—')}</div>
      <div style="display:flex;gap:4px;align-items:center">
        <span class="badge ${u.role==='admin'?'badge-doing':u.role==='leader'?'badge-leader':'badge-todo'}">${roleLabel(u.role)}</span>
        ${retiredBadge}
        ${noSalary?`<span class="badge" style="background:rgba(200,71,42,.1);color:var(--accent);cursor:pointer" onclick="event.stopPropagation();openAddSalaryModal('${u.id}','${escHtml(u.name||'')}')">給与未設定</span>`:''}
      </div>
    </div>
    <div style="font-size:11px;color:var(--ink3);margin-top:4px">${escHtml(u.email||'—')}</div>
    <div style="font-size:11px;color:var(--ink3)">${escHtml(u.dept||'—')}</div>
    ${u.company ? `<div style="font-size:11px;color:var(--ink3)">${escHtml(u.company)}</div>` : ''}
    ${!isContractor && !u.isRetired ? `<div style="margin-top:8px"><button class="mini-btn" style="background:rgba(37,99,235,.08);color:var(--blue);border-color:rgba(37,99,235,.2);position:relative" onclick="event.stopPropagation();window.open('roadmap.html?uid=${u.id}','_blank')">📋 ロードマップ${!_cachedRoadmapNames.has(u.name) ? `<span style="position:absolute;top:-5px;right:-5px;background:var(--accent);color:#fff;font-size:9px;font-weight:700;padding:1px 4px;border-radius:6px;line-height:1.4">未設定</span>` : ''}</button></div>` : ''}
  </div>`;
}

export function renderUsersTable(members, salNames) {
  const tbody = document.getElementById('users-table-body');
  const mList = document.getElementById('m-users-list');

  const isContractor = m => m.isAlliance || m.noAuth || m.role === '委託' || m.role === 'alliance' || m.id.startsWith('alliance_');
  const employees   = members.filter(m => !isContractor(m));
  const contractors = members.filter(m =>  isContractor(m));

  // 会社フィルターを更新（業務委託はdeptに会社名が入っている）
  const companyFilter = document.getElementById('contractor-company-filter');
  const _contractorCompany = m => m.dept || m.company || '';
  if (companyFilter) {
    const current = companyFilter.value;
    const companies = [...new Set(contractors.map(_contractorCompany).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'ja'));
    companyFilter.innerHTML = `<option value="">絞り込みなし（${contractors.length}名）</option>`
      + companies.map(c => `<option value="${escHtml(c)}" ${current===c?'selected':''}>${escHtml(c)}</option>`).join('');
  }

  const filterVal = document.getElementById('contractor-company-filter')?.value || '';
  const filteredContractors = filterVal
    ? contractors.filter(m => _contractorCompany(m) === filterVal)
    : contractors;

  const sectionHeader = (label, count) =>
    `<tr><td colspan="6" style="background:var(--surface2);font-size:11px;font-weight:700;color:var(--ink3);padding:6px 12px;letter-spacing:.5px">${label}（${count}名）</td></tr>`;

  if (tbody) {
    if (!members.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">メンバーが登録されていません</td></tr>'; return;
    }
    let html = '';
    if (employees.length) {
      html += sectionHeader('社員', employees.length);
      html += employees.map(u => _userRow(u, salNames)).join('');
    }
    if (contractors.length) {
      html += sectionHeader('業務委託', filteredContractors.length);
      html += filteredContractors.map(u => _userRow(u, salNames)).join('');
    }
    tbody.innerHTML = html;
  }

  if (mList) {
    let html = '';
    if (employees.length) {
      html += `<div style="font-size:11px;font-weight:700;color:var(--ink3);padding:4px 2px 6px;letter-spacing:.5px">社員（${employees.length}名）</div>`;
      html += employees.map(u => _userCard(u, salNames)).join('');
    }
    if (contractors.length) {
      html += `<div style="font-size:11px;font-weight:700;color:var(--ink3);padding:12px 2px 6px;letter-spacing:.5px">業務委託（${filteredContractors.length}名）</div>`;
      html += filteredContractors.map(u => _userCard(u, salNames)).join('');
    }
    mList.innerHTML = html || '<div class="empty">メンバーなし</div>';
  }
}

function _getSortedFilteredMembers(keyword = '') {
  const showRetired = document.getElementById('show-retired-check')?.checked || document.getElementById('show-retired-check-m')?.checked || false;
  let members = RC._cachedMembers.filter(u => showRetired || !u.isRetired);
  if (keyword) members = members.filter(u => (u.name||'').includes(keyword) || (u.email||'').includes(keyword));
  const sort = document.getElementById('users-sort')?.value || '';
  if (sort === 'dept') {
    members.sort((a, b) => (a.dept||'').localeCompare(b.dept||'', 'ja') || (a.name||'').localeCompare(b.name||'', 'ja'));
  } else if (sort === 'company') {
    members.sort((a, b) => (a.company||'').localeCompare(b.company||'', 'ja') || (a.name||'').localeCompare(b.name||'', 'ja'));
  }
  return members;
}

export function toggleShowRetired() {
  const keyword = document.getElementById('users-search')?.value || '';
  renderUsersTable(_getSortedFilteredMembers(keyword), _cachedSalNames);
}

export function filterContractorsByCompany() {
  renderUsersTable(_getSortedFilteredMembers(), _cachedSalNames);
}

export function sortUsers() {
  const keyword = document.getElementById('users-search')?.value || '';
  renderUsersTable(_getSortedFilteredMembers(keyword), _cachedSalNames);
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

// ── Add user (3-step wizard) ──────────────────────────────

let _newUserData = {}; // 各ステップのデータを一時保持

function stepProgress(current) {
  const steps = [
    { n:1, label:'基本情報' },
    { n:2, label:'給与設定' },
    { n:3, label:'プロフィール' }
  ];
  return `<div style="display:flex;align-items:center;justify-content:center;gap:0;margin-bottom:20px">
    ${steps.map((s,i) => `
      <div style="display:flex;align-items:center">
        <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
          <div style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;
            background:${s.n < current ? 'var(--accent2)' : s.n === current ? 'var(--ink)' : 'var(--surface2)'};
            color:${s.n <= current ? '#fff' : 'var(--ink3)'}">
            ${s.n < current ? '✓' : s.n}
          </div>
          <div style="font-size:9px;font-weight:${s.n===current?'700':'400'};color:${s.n===current?'var(--ink)':'var(--ink3)'};white-space:nowrap">${s.label}</div>
        </div>
        ${i < steps.length-1 ? `<div style="width:40px;height:2px;background:${s.n < current ? 'var(--accent2)' : 'var(--border)'};margin:0 4px;margin-bottom:16px"></div>` : ''}
      </div>`).join('')}
  </div>`;
}

export function openAddUserModal() {
  _newUserData = {};
  document.getElementById('modal-title-text').textContent = '＋ メンバーを追加';
  renderAddUserStep(1);
  openModal();
}

export function openAddUserModalPrefilled(name) {
  _newUserData = { name };
  document.getElementById('modal-title-text').textContent = '＋ メンバーを追加';
  renderAddUserStep(1);
  openModal();
}

function renderAddUserStep(step) {
  const deptOpts = ['', ...depts_options].map(d => `<option ${_newUserData.dept===d?'selected':''}>${d}</option>`).join('');
  const rankOpts = RANK_ORDER.map(r => `<option value="${r}" ${_newUserData.rank===r?'selected':''}>${r}（¥${(SALARY_TABLE[r]?.total||0).toLocaleString()}）</option>`).join('');

  let body = stepProgress(step);

  if (step === 1) {
    const formUrl = `${location.protocol}//${location.host}/form.html`;
    body += `
      <!-- 注意文：新入社員はフォーム経由で登録すべき -->
      <div style="background:rgba(243,156,18,.08);border:1px solid rgba(243,156,18,.3);border-left:4px solid var(--warn);border-radius:8px;padding:12px 14px;margin-bottom:16px;font-size:12px;line-height:1.7">
        <div style="display:flex;align-items:center;gap:6px;font-weight:700;color:var(--warn);margin-bottom:6px">
          <span style="font-size:14px">⚠️</span>
          <span>新入社員はフォーム経由で登録してください</span>
        </div>
        <div style="color:var(--ink2)">
          新入社員の場合は、<a href="${formUrl}" target="_blank" style="color:var(--blue);font-weight:600;text-decoration:underline">入社フォーム</a>から本人に入力してもらってください。<br>
          直接追加は<strong>既存メンバーの情報修正や特殊ケース</strong>のみで使用します。
        </div>
        <div style="display:flex;gap:6px;align-items:center;margin-top:8px;flex-wrap:wrap">
          <input type="text" value="${formUrl}" readonly class="form-input" style="flex:1;font-size:11px;background:var(--surface2);min-width:200px" id="nu-form-url">
          <button class="mini-btn" type="button" onclick="nuCopyFormUrl()" style="white-space:nowrap">📋 コピー</button>
          <button class="mini-btn" type="button" onclick="closeModal();openPendingFormModal()" style="white-space:nowrap;color:var(--blue);border-color:var(--blue)">🔗 新規フォームを発行</button>
        </div>
      </div>
      <div class="form-row"><label class="form-label">名前 <span style="color:var(--accent)">*</span></label>
        <input class="form-input" id="nu-name" value="${escHtml(_newUserData.name||'')}" placeholder="例：田中 太郎"></div>
      <div class="form-row"><label class="form-label">メールアドレス</label>
        <input class="form-input" id="nu-email" type="email" value="${escHtml(_newUserData.email||'')}" placeholder="example@email.com"></div>
      <div class="form-row"><label class="form-label">パスワード</label>
        <input class="form-input" id="nu-pass" type="password" value="${_newUserData.pass||''}" placeholder="6文字以上（後から設定も可）"></div>
      <div class="form-row"><label class="form-label">所属会社名</label>
        <input class="form-input" id="nu-company" value="${escHtml(_newUserData.company||'')}" placeholder="例：株式会社リーガルキャスト"></div>
      <div class="form-row"><label class="form-label">LINE ユーザーID <span style="font-size:10px;color:var(--ink3)">（個人LINE利用許可に必要）</span></label>
        <input class="form-input" id="nu-line-id" value="${escHtml(_newUserData.lineUserId||'')}" placeholder="Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"></div>
      <div class="form-row-2">
        <div class="form-row"><label class="form-label">権限</label>
          <select class="form-input" id="nu-role">
            <option value="member" ${(_newUserData.role||'member')==='member'?'selected':''}>メンバー</option>
            <option value="leader" ${_newUserData.role==='leader'?'selected':''}>リーダー</option>
            <option value="admin"  ${_newUserData.role==='admin'?'selected':''}>管理者</option>
          </select></div>
        <div class="form-row"><label class="form-label">部署</label>
          <select class="form-input" id="nu-dept">${deptOpts}</select></div>
      </div>
      <div id="nu-error" style="font-size:12px;color:var(--accent);min-height:16px"></div>
      <div class="btn-row">
        <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
        <button class="btn btn-primary" onclick="addUserNextStep(1)">次へ →</button>
      </div>`;
  } else if (step === 2) {
    body += `
      <div class="form-row"><label class="form-label">グレード <span style="color:var(--accent)">*</span></label>
        <select class="form-input" id="nu-rank" onchange="nuUpdateSalaryPreview()">${rankOpts}</select></div>
      <div id="nu-salary-preview" style="margin:8px 0;padding:10px;background:var(--surface2);border-radius:6px;font-size:12px"></div>
      <div class="form-row"><label class="form-label">備考</label>
        <input class="form-input" id="nu-sal-note" value="${escHtml(_newUserData.salNote||'')}"></div>
      <div id="nu-error" style="font-size:12px;color:var(--accent);min-height:16px"></div>
      <div class="btn-row">
        <button class="btn btn-secondary" onclick="renderAddUserStep(1)">← 戻る</button>
        <button class="btn btn-primary" onclick="addUserNextStep(2)">次へ →</button>
      </div>`;
  } else if (step === 3) {
    const photo = _newUserData.photoPreview
      ? `<img src="${_newUserData.photoPreview}" style="width:100%;height:100%;object-fit:cover">`
      : '<span style="font-size:32px">👤</span>';
    body += `
      <div style="font-size:11px;color:var(--ink3);margin-bottom:12px;padding:8px 12px;background:var(--surface2);border-radius:6px">
        💡 プロフィール情報は任意です。後から社員紹介ページで編集することもできます。
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;margin-bottom:14px">
        <div id="nu-photo-preview" style="width:72px;height:72px;border-radius:50%;overflow:hidden;background:var(--surface2);display:flex;align-items:center;justify-content:center;margin-bottom:8px;border:2px solid var(--border)">${photo}</div>
        <label style="cursor:pointer"><span class="mini-btn">📷 写真を選択</span>
          <input type="file" id="nu-photo-input" accept="image/*" style="display:none" onchange="nuPreviewPhoto(this)"></label>
      </div>
      <div class="form-row"><label class="form-label">自己紹介</label>
        <textarea class="form-input" id="nu-bio" rows="2" placeholder="自己紹介を入力" style="resize:vertical">${escHtml(_newUserData.bio||'')}</textarea></div>
      <div class="form-row"><label class="form-label">スキル・得意なこと（カンマ区切り）</label>
        <input class="form-input" id="nu-skills" value="${escHtml(_newUserData.skills||'')}" placeholder="例：営業, 企画, Excel"></div>
      <div class="form-row"><label class="form-label">担当業務</label>
        <textarea class="form-input" id="nu-work" rows="2" placeholder="担当している仕事" style="resize:vertical">${escHtml(_newUserData.work||'')}</textarea></div>
      <div class="form-row"><label class="form-label">趣味・一言</label>
        <input class="form-input" id="nu-hobbies" value="${escHtml(_newUserData.hobbies||'')}" placeholder="例：映画鑑賞、料理"></div>
      <div id="nu-error" style="font-size:12px;color:var(--accent);min-height:16px"></div>
      <div class="btn-row">
        <button class="btn btn-secondary" onclick="renderAddUserStep(2)">← 戻る</button>
        <button class="btn btn-secondary" onclick="addUserSubmit(true)">スキップして登録</button>
        <button class="btn btn-primary" id="nu-submit-btn" onclick="addUserSubmit(false)">✅ 登録する</button>
      </div>`;
  }

  document.getElementById('modal-body').innerHTML = body;
  if (step === 2) nuUpdateSalaryPreview();
}

export function nuUpdateSalaryPreview() {
  const rank    = document.getElementById('nu-rank')?.value;
  const preview = document.getElementById('nu-salary-preview');
  if (!preview || !rank) return;
  const td = SALARY_TABLE[rank];
  if (!td) { preview.innerHTML = ''; return; }
  const color = RANK_COLORS[rank] || 'var(--ink)';
  const parts = [`基本給 ¥${td.base.toLocaleString()}`];
  if (td.duty)   parts.push(`業務手当 ¥${td.duty.toLocaleString()}`);
  if (td.sales)  parts.push(`営業手当 ¥${td.sales.toLocaleString()}`);
  if (td.role)   parts.push(`役職手当 ¥${td.role.toLocaleString()}`);
  if (td.orgInc) parts.push(`組織手当 ¥${td.orgInc.toLocaleString()}`);
  if (td.fixedOT) parts.push(`固定残業 ${td.fixedOT}h`);
  preview.innerHTML = `
    <div style="font-weight:700;color:${color};margin-bottom:4px">${td.rank} / ${rank}</div>
    <div style="font-size:11px;color:var(--ink3)">${parts.join(' ／ ')}</div>
    <div style="margin-top:6px;font-size:15px;font-weight:900;font-family:'DM Mono',monospace">月収合計 ¥${td.total.toLocaleString()}</div>`;
}

export function nuPreviewPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  _newUserData.photoFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    _newUserData.photoPreview = e.target.result;
    const preview = document.getElementById('nu-photo-preview');
    if (preview) preview.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover">`;
  };
  reader.readAsDataURL(file);
}

export function addUserNextStep(from) {
  const errEl = document.getElementById('nu-error');
  if (from === 1) {
    const name = document.getElementById('nu-name').value.trim();
    const pass = document.getElementById('nu-pass').value;
    if (!name) { errEl.textContent = '名前は必須です'; return; }
    if (pass && pass.length < 6) { errEl.textContent = 'パスワードは6文字以上'; return; }
    _newUserData.name       = name;
    _newUserData.email      = document.getElementById('nu-email').value.trim();
    _newUserData.pass       = pass;
    _newUserData.company    = document.getElementById('nu-company').value.trim();
    _newUserData.role       = document.getElementById('nu-role').value;
    _newUserData.dept       = document.getElementById('nu-dept').value;
    _newUserData.lineUserId = document.getElementById('nu-line-id').value.trim();
    renderAddUserStep(2);
  } else if (from === 2) {
    const rank = document.getElementById('nu-rank').value;
    if (!rank) { errEl.textContent = 'グレードを選択してください'; return; }
    _newUserData.rank    = rank;
    _newUserData.salNote = document.getElementById('nu-sal-note').value.trim();
    renderAddUserStep(3);
  }
}

export async function addUserSubmit(skipProfile) {
  const errEl   = document.getElementById('nu-error');
  const submitBtn = document.getElementById('nu-submit-btn');
  if (submitBtn) submitBtn.disabled = true;

  if (!skipProfile) {
    _newUserData.bio    = document.getElementById('nu-bio')?.value.trim() || '';
    _newUserData.skills = document.getElementById('nu-skills')?.value || '';
    _newUserData.work   = document.getElementById('nu-work')?.value.trim() || '';
    _newUserData.hobbies= document.getElementById('nu-hobbies')?.value.trim() || '';
  }

  try {
    let uid;

    // メールとパスワードが両方ある場合はFirebase Authでアカウント作成
    if (_newUserData.email && _newUserData.pass) {
      const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js');
      const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js');
      const secondaryApp = getApps().find(a => a.name === 'rc-secondary')
        || initializeApp(firebaseConfig, 'rc-secondary');
      const secondaryAuth = getAuth(secondaryApp);
      const userCred = await createUserWithEmailAndPassword(secondaryAuth, _newUserData.email, _newUserData.pass);
      uid = userCred.user.uid;
      await secondaryAuth.signOut();
    }

    const docRef = uid ? doc(db, 'users', uid) : doc(collection(db,'users'));
    if (!uid) uid = docRef.id;

    // users保存
    await setDoc(docRef, {
      name: _newUserData.name,
      email: _newUserData.email || '',
      company: _newUserData.company || '',
      role: _newUserData.role || 'member',
      dept: _newUserData.dept || '',
      hasSalaryInfo: true,
      createdAt: serverTimestamp()
    });

    // salary保存
    const td = SALARY_TABLE[_newUserData.rank] || {};
    await addDoc(collection(db,'salary'), {
      uid, name: _newUserData.name, dept: _newUserData.dept || '',
      salaryTable: _newUserData.rank,
      totalSalary: td.total || 0,
      note: _newUserData.salNote || '',
      createdAt: serverTimestamp()
    });

    // profile保存（スキップでなく、何か入力があれば）
    if (!skipProfile && (_newUserData.bio || _newUserData.skills || _newUserData.work || _newUserData.hobbies || _newUserData.photoFile)) {
      let photoURL = '';
      if (_newUserData.photoFile) {
        const storageRef = ref(storage, `users/${uid}/profile_pictures/profile_image.jpg`);
        await uploadBytes(storageRef, _newUserData.photoFile);
        photoURL = await getDownloadURL(storageRef);
      }
      const skills = (_newUserData.skills||'').split(',').map(s=>s.trim()).filter(Boolean);
      await setDoc(doc(db,'profiles',uid), {
        uid, photoURL,
        selfIntroduction: _newUserData.bio || '',
        skills,
        currentWork: _newUserData.work || '',
        hobbies: _newUserData.hobbies || '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }

    // LINE個人チャット許可（LINE ユーザーIDが入力されていれば allowed_dm_users に登録）
    if (_newUserData.lineUserId) {
      await setDoc(doc(db, 'allowed_dm_users', _newUserData.lineUserId), {
        name: _newUserData.name,
        role: _newUserData.role || 'member',
        uid,
        createdAt: serverTimestamp()
      });
    }

    closeModal();
    loadUsers();
    alert(`✅ ${_newUserData.name} を追加しました`);
  } catch(e) {
    if (errEl) errEl.textContent = e.message;
    if (submitBtn) submitBtn.disabled = false;
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
    batch.set(ref, { name, dept, role, email: '', hasSalaryInfo: false, createdAt: serverTimestamp() });
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
    <div class="form-row"><label class="form-label">所属会社名</label>
      <input class="form-input" id="eu-company" value="${escHtml(u.company||'')}" placeholder="例：株式会社リーガルキャスト"></div>
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
    <div class="form-row"><label class="form-label">💬 LINE ユーザーID <span style="font-size:10px;color:var(--ink3);font-weight:400">（任意）</span></label>
      <input class="form-input" id="eu-line-user-id" value="${escHtml(u.lineUserId||'')}" placeholder="Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx">
      <div style="font-size:10px;color:var(--ink3);margin-top:3px">U から始まる33文字のID。LINEアプリで Bot にメッセージを送ると取得できます。</div></div>
    <details style="margin-bottom:12px">
      <summary style="font-size:11px;color:var(--ink3);cursor:pointer;margin-bottom:8px">🚃 通勤テンプレ編集</summary>
      <div id="eu-fare-templates"></div>
      <button class="mini-btn" onclick="euAddFareTemplate()" style="margin-top:6px;font-size:11px">＋ 店舗を追加</button>
    </details>
    <div id="eu-error" style="font-size:12px;color:var(--accent);min-height:16px"></div>
    <div class="btn-row" style="flex-wrap:nowrap;gap:6px">
      ${!(u.isAlliance || u.noAuth) ? `<button class="btn" style="background:#fee2e2;color:var(--accent);border:none;font-size:12px;padding:8px 10px" onclick="confirmDeleteUser('${uid}')">削除</button>` : ''}
      <button class="btn" style="background:var(--blue);color:#fff;border:none;font-size:12px;padding:8px 10px" onclick="closeModal();openSendMeetingRequestModal('${uid}','${escHtml(u.name||'')}','${escHtml(u.dept||'')}')">🤝 面談依頼</button>
      <button class="btn" style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;font-size:12px;padding:8px 10px" onclick="closeModal();openOffboardingModal('${uid}')">🚪 退職処理</button>
      <button class="btn" style="background:#fef9c3;color:#92400e;border:1px solid #fde68a;font-size:12px;padding:8px 10px" onclick="sendPasswordReset('${uid}')">🔑 PW再設定</button>
      <button class="btn btn-secondary" style="font-size:12px;padding:8px 10px" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" style="font-size:12px;padding:8px 12px" onclick="saveUser('${uid}')">保存</button>
    </div>`;

  // Initialize eu fare templates (use setter to keep fare.js module state in sync)
  window.setEuFareTemplates?.(u.fareTemplates ? JSON.parse(JSON.stringify(u.fareTemplates)) : []);
  window.euRenderFareTemplates?.();
  openModal();
}

export async function saveUser(uid) {
  const name            = document.getElementById('eu-name').value.trim();
  const email           = document.getElementById('eu-email').value.trim();
  const company         = document.getElementById('eu-company').value.trim();
  const role            = document.getElementById('eu-role').value;
  const dept            = document.getElementById('eu-dept').value;
  const fareTemplates   = window._euFareTemplates || [];
  const lineUserIdRaw   = document.getElementById('eu-line-user-id').value.trim();
  const errEl           = document.getElementById('eu-error');

  if (!name) { errEl.textContent = '名前を入力してください'; return; }
  if (lineUserIdRaw && !/^U[0-9a-f]{32}$/.test(lineUserIdRaw)) {
    errEl.textContent = 'LINE ユーザーIDの形式が正しくありません（U + 32文字の英数字）';
    return;
  }
  const lineUserId = lineUserIdRaw || null;
  const prevMember = RC._cachedMembers.find(m => m.id === uid);
  const prevLineUserId = prevMember?.lineUserId || null;

  await updateDoc(doc(db,'users',uid), { name, email, company, role, dept, fareTemplates, lineUserId });

  // allowed_dm_users の同期
  if (lineUserId) {
    // LINE IDが設定された（または変更された）→ 新IDで登録
    await setDoc(doc(db, 'allowed_dm_users', lineUserId), {
      name, role: role || 'member', uid, createdAt: serverTimestamp()
    });
  }
  if (prevLineUserId && prevLineUserId !== lineUserId) {
    // 以前のLINE IDが削除または変更された → 古いドキュメントを削除
    await deleteDoc(doc(db, 'allowed_dm_users', prevLineUserId));
  }

  // Update cached member
  const idx = RC._cachedMembers.findIndex(m => m.id === uid);
  if (idx >= 0) Object.assign(RC._cachedMembers[idx], { name, email, company, role, dept, fareTemplates, lineUserId });

  closeModal();
  renderUsersTable(_getSortedFilteredMembers(), _cachedSalNames);
  alert(`✅ ${name} の情報を更新しました`);
}

export async function sendPasswordReset(uid) {
  const u = RC._cachedMembers.find(m => m.id === uid);
  if (!u?.email) {
    alert('メールアドレスが登録されていないためパスワード再設定メールを送れません。');
    return;
  }
  if (!confirm(`${u.name}（${u.email}）にパスワード再設定メールを送信しますか？`)) return;
  try {
    await sendPasswordResetEmail(auth, u.email);
    alert(`✅ ${u.email} にパスワード再設定メールを送信しました。`);
  } catch (e) {
    alert(`送信に失敗しました：${e.message}`);
  }
}

export function confirmDeleteUser(uid) {
  const u = RC._cachedMembers.find(m => m.id === uid);
  const msg = `⚠️ 削除は「誤って登録した場合」や「入社前に辞退になった場合」のみ行ってください。\n\n退職の場合は「退職処理」ボタンから手続きしてください。\n\n──────────────\n本当に ${u?.name||uid} を削除しますか？`;
  if (!confirm(msg)) return;
  deleteUser(uid);
}

export async function deleteUser(uid) {
  // ユーザー削除と同時に関連する給与データも削除
  const salSnap = await getDocs(query(collection(db,'salary'), where('uid','==',uid)));
  const batch = writeBatch(db);
  salSnap.docs.forEach(d => batch.delete(d.ref));
  batch.delete(doc(db,'users',uid));
  await batch.commit();
  closeModal();
  loadUsers();
}

// ── Alliance add (single / bulk) ──────────────────────────

export function openAddAllianceModal() {
  document.getElementById('modal-title-text').textContent = '🤝 業務委託メンバーを追加';
  document.getElementById('modal-body').innerHTML = `
    <div style="background:rgba(58,125,90,.08);border:1px solid rgba(58,125,90,.25);border-radius:6px;padding:10px 12px;font-size:11px;color:var(--accent2);margin-bottom:14px;line-height:1.7">
      <strong>メール未入力</strong>：従来通り（業務委託として登録のみ・本人ログインなし）<br>
      <strong>メール入力あり</strong>：Firebase Auth アカウント発行（研修管理アプリ等で本人ログイン可）
    </div>
    <div class="form-row"><label class="form-label">名前 <span style="color:var(--accent)">*</span></label>
      <input class="form-input" id="al-name" placeholder="例：山田 花子"></div>
    <div class="form-row"><label class="form-label">所属会社名 <span style="color:var(--accent)">*</span></label>
      <input class="form-input" id="al-company" placeholder="例：株式会社〇〇"></div>
    <div class="form-row"><label class="form-label">部門（任意）</label>
      <select class="form-input" id="al-dept"><option value="">── 未設定 ──</option>${depts_options.map(d=>`<option>${d}</option>`).join('')}</select></div>
    <div class="form-row">
      <label class="form-label">メールアドレス（任意）</label>
      <input type="email" class="form-input" id="al-email" placeholder="例：tanaka@example.com" oninput="document.getElementById('al-pass-row').style.display = this.value.trim() ? '' : 'none'">
      <div style="font-size:10px;color:var(--ink3);margin-top:4px">入力すると Firebase Auth アカウントが発行され、本人ログインが可能になります</div>
    </div>
    <div class="form-row" id="al-pass-row" style="display:none">
      <label class="form-label">初期パスワード <span style="color:var(--accent)">*</span></label>
      <input type="text" class="form-input" id="al-pass" placeholder="8文字以上（メール入力時のみ必須）" style="font-family:'DM Mono',monospace">
    </div>
    <div id="al-error" style="font-size:12px;color:var(--accent);min-height:16px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" id="al-save-btn" style="background:var(--accent2)" onclick="saveAllianceMember()">追加</button>
    </div>`;
  openModal();
}

export async function saveAllianceMember() {
  const name    = document.getElementById('al-name').value.trim();
  const company = document.getElementById('al-company').value.trim();
  const dept    = document.getElementById('al-dept').value;
  const email   = document.getElementById('al-email')?.value.trim() || '';
  const pass    = document.getElementById('al-pass')?.value || '';
  const errEl   = document.getElementById('al-error');
  const btn     = document.getElementById('al-save-btn');
  if (!name)    { errEl.textContent = '名前を入力してください'; return; }
  if (!company) { errEl.textContent = '所属会社名を入力してください'; return; }
  if (email && pass.length < 8) {
    errEl.textContent = 'メール入力時はパスワード（8文字以上）が必須です';
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '追加中...'; }
  try {
    if (email) {
      // ── メール入力あり: Firebase Auth アカウント発行（セカンダリインスタンス経由・admin維持） ──
      const { initializeApp: initApp2, deleteApp: deleteApp2 } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js');
      const { getAuth: getAuth2, createUserWithEmailAndPassword: createUser2, signOut: signOut2 } = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js');
      const secondaryName = 'alliance-auth-' + Date.now();
      const app2 = initApp2(firebaseConfig, secondaryName);
      const auth2 = getAuth2(app2);
      try {
        const cred = await createUser2(auth2, email, pass);
        const newUid = cred.user.uid;
        await signOut2(auth2);
        // Firebase Auth UID で users に登録（isAlliance: true は維持・email セット）
        await setDoc(doc(db, 'users', newUid), {
          name, company, dept, email,
          role: 'member',
          isAlliance: true,
          hasSalaryInfo: true,
          createdAt: serverTimestamp()
        });
      } finally {
        await deleteApp2(app2);
      }
    } else {
      // ── メール未入力: 従来通り（自動ID・email空文字） ──
      const ref = doc(collection(db,'users'));
      await setDoc(ref, { name, company, dept, role: 'member', isAlliance: true, hasSalaryInfo: true, email: '', createdAt: serverTimestamp() });
    }
    closeModal();
    loadUsers();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '追加'; }
    if (e.code === 'auth/email-already-in-use') {
      errEl.textContent = 'このメールアドレスは既に使用されています';
    } else if (e.code === 'auth/invalid-email') {
      errEl.textContent = 'メールアドレスの形式が正しくありません';
    } else if (e.code === 'auth/weak-password') {
      errEl.textContent = 'パスワードが弱すぎます（8文字以上の英数字混合を推奨）';
    } else {
      errEl.textContent = 'エラー：' + (e?.message || e);
    }
  }
}

export function openAddAllianceBulkModal() {
  document.getElementById('modal-title-text').textContent = '🤝 業務委託メンバー一括追加';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row"><label class="form-label">所属会社名 <span style="color:var(--accent)">*</span></label>
      <input class="form-input" id="al-bulk-company" placeholder="例：株式会社〇〇"></div>
    <div class="form-row"><label class="form-label">名前（1行1人）</label>
      <textarea class="form-input" id="al-bulk-names" rows="8" placeholder="山田 花子&#10;佐藤 太郎" style="resize:vertical"></textarea></div>
    <div class="form-row"><label class="form-label">部門（任意）</label>
      <select class="form-input" id="al-bulk-dept"><option value="">── 未設定 ──</option>${depts_options.map(d=>`<option>${d}</option>`).join('')}</select></div>
    <div id="al-bulk-error" style="font-size:12px;color:var(--accent);min-height:16px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" style="background:var(--accent2)" onclick="execAllianceBulkAdd()">一括追加</button>
    </div>`;
  openModal();
}

export async function execAllianceBulkAdd() {
  const company = document.getElementById('al-bulk-company').value.trim();
  const names   = document.getElementById('al-bulk-names').value.split('\n').map(n=>n.trim()).filter(Boolean);
  const dept    = document.getElementById('al-bulk-dept').value;
  const errEl   = document.getElementById('al-bulk-error');
  if (!company) { errEl.textContent = '所属会社名を入力してください'; return; }
  if (!names.length) { errEl.textContent = '名前を入力してください'; return; }
  const batch = writeBatch(db);
  names.forEach(name => {
    const ref = doc(collection(db,'users'));
    batch.set(ref, { name, company, dept, role: 'member', isAlliance: true, hasSalaryInfo: true, email: '', createdAt: serverTimestamp() });
  });
  await batch.commit();
  closeModal();
  loadUsers();
}

// ── Filter by search ──────────────────────────────────────

export function filterUsersBySearch(q) {
  renderUsersTable(_getSortedFilteredMembers(q.trim()), _cachedSalNames);
}

// ── UID付け替え機能 ───────────────────────────────────────
export function openUidSwapModal() {
  document.getElementById('uid-swap-old').value = '';
  document.getElementById('uid-swap-new').value = '';
  document.getElementById('uid-swap-step1').style.display = '';
  document.getElementById('uid-swap-step2').style.display = 'none';
  document.getElementById('uid-swap-step3').style.display = 'none';
  document.getElementById('modal-uid-swap').style.display = 'flex';
}

export async function previewUidSwap() {
  const oldUid = document.getElementById('uid-swap-old').value.trim();
  const newUid = document.getElementById('uid-swap-new').value.trim();
  if (!oldUid || !newUid) { alert('旧UID・新UIDを両方入力してください'); return; }
  if (oldUid === newUid) { alert('旧UIDと新UIDが同じです'); return; }

  const btn = document.querySelector('#uid-swap-step1 .btn-primary');
  if (btn) btn.textContent = '確認中…';

  try {
    const [attSnap, shiftSnap, salSnap, overSnap, meetSnap, errSnap] = await Promise.all([
      getDocs(query(collection(db, 'attendance'),       where('uid', '==', oldUid))),
      getDocs(query(collection(db, 'shifts'),           where('uid', '==', oldUid))),
      getDocs(query(collection(db, 'salary'),           where('uid', '==', oldUid))),
      getDocs(query(collection(db, 'overtimeRequests'), where('uid', '==', oldUid))),
      getDocs(query(collection(db, 'meetingRequests'),  where('uid', '==', oldUid))),
      getDocs(query(collection(db, 'error_reports'),    where('uid', '==', oldUid))),
    ]);
    const userDoc  = await getDoc(doc(db, 'users',    oldUid));
    const profDoc  = await getDoc(doc(db, 'profiles', oldUid));

    const rows = [
      { label: 'users（メンバー情報）',  count: userDoc.exists()  ? 1 : 0, note: 'doc IDを付け替え' },
      { label: 'profiles（プロフィール）',count: profDoc.exists()  ? 1 : 0, note: 'doc IDを付け替え' },
      { label: 'attendance（勤怠）',     count: attSnap.size,               note: 'doc IDを付け替え' },
      { label: 'shifts（シフト）',       count: shiftSnap.size,             note: 'uidフィールドを更新' },
      { label: 'salary（給与）',         count: salSnap.size,               note: 'uidフィールドを更新' },
      { label: 'overtimeRequests（残業申請）', count: overSnap.size,        note: 'uidフィールドを更新' },
      { label: 'meetingRequests（面談）', count: meetSnap.size,             note: 'uidフィールドを更新' },
      { label: 'error_reports（アラート）', count: errSnap.size,            note: 'uidフィールドを更新' },
    ];
    const total = rows.reduce((s, r) => s + r.count, 0);

    document.getElementById('uid-swap-preview').innerHTML = `
      <p style="font-size:13px;margin-bottom:10px">以下のデータを <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px">${oldUid.slice(0,8)}…</code> → <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px">${newUid.slice(0,8)}…</code> に移行します。</p>
      <table style="width:100%;font-size:12px;border-collapse:collapse">
        <thead><tr style="background:var(--surface2)"><th style="padding:6px 8px;text-align:left">コレクション</th><th style="text-align:right;padding:6px 8px">件数</th><th style="padding:6px 8px">処理</th></tr></thead>
        <tbody>${rows.map(r => `<tr style="border-bottom:1px solid var(--border)"><td style="padding:6px 8px">${r.label}</td><td style="text-align:right;padding:6px 8px;font-weight:700;color:${r.count > 0 ? 'var(--blue)' : 'var(--ink3)'}">${r.count}</td><td style="padding:6px 8px;color:var(--ink3);font-size:11px">${r.note}</td></tr>`).join('')}</tbody>
        <tfoot><tr style="background:var(--surface2)"><td style="padding:6px 8px;font-weight:700">合計</td><td style="text-align:right;padding:6px 8px;font-weight:700">${total}</td><td></td></tr></tfoot>
      </table>
      ${total === 0 ? '<p style="color:var(--accent);margin-top:8px;font-size:12px">⚠️ 旧UIDのデータが見つかりませんでした。UIDを確認してください。</p>' : ''}
    `;
    document.getElementById('uid-swap-step1').style.display = 'none';
    document.getElementById('uid-swap-step2').style.display = '';
  } catch(e) {
    alert('プレビュー取得エラー: ' + e.message);
  } finally {
    if (btn) btn.textContent = 'プレビュー確認';
  }
}

export async function execUidSwap() {
  const oldUid = document.getElementById('uid-swap-old').value.trim();
  const newUid = document.getElementById('uid-swap-new').value.trim();
  if (!confirm(`本当に実行しますか？\n旧UID: ${oldUid}\n新UID: ${newUid}\n\nこの操作は元に戻せません。`)) return;

  document.getElementById('uid-swap-step2').style.display = 'none';
  document.getElementById('uid-swap-step3').style.display = '';
  const log = document.getElementById('uid-swap-log');

  const addLog = (msg, color = '') => {
    const p = document.createElement('p');
    p.style.cssText = `margin:4px 0;font-size:12px;${color ? 'color:' + color : ''}`;
    p.textContent = msg;
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
  };

  // バッチをチャンクに分割して実行
  const flushBatch = async (ops) => {
    const chunks = [];
    for (let i = 0; i < ops.length; i += 490) chunks.push(ops.slice(i, i + 490));
    for (const chunk of chunks) {
      const batch = writeBatch(db);
      chunk.forEach(op => op(batch));
      await batch.commit();
    }
  };

  try {
    // 1. users (doc ID = UID)
    addLog('📋 users を処理中…');
    const userDoc = await getDoc(doc(db, 'users', oldUid));
    if (userDoc.exists()) {
      const ops = [
        b => b.set(doc(db, 'users', newUid), { ...userDoc.data() }),
        b => b.delete(doc(db, 'users', oldUid)),
      ];
      await flushBatch(ops);
      addLog('  ✅ users: 1件移行完了');
    } else {
      addLog('  ⏭ users: データなし（スキップ）', 'var(--ink3)');
    }

    // 2. profiles (doc ID = UID)
    addLog('👤 profiles を処理中…');
    const profDoc = await getDoc(doc(db, 'profiles', oldUid));
    if (profDoc.exists()) {
      const ops = [
        b => b.set(doc(db, 'profiles', newUid), { ...profDoc.data(), uid: newUid }),
        b => b.delete(doc(db, 'profiles', oldUid)),
      ];
      await flushBatch(ops);
      addLog('  ✅ profiles: 1件移行完了');
    } else {
      addLog('  ⏭ profiles: データなし（スキップ）', 'var(--ink3)');
    }

    // 3. attendance (doc ID = {uid}_{date})
    addLog('🕐 attendance を処理中…');
    const attSnap = await getDocs(query(collection(db, 'attendance'), where('uid', '==', oldUid)));
    if (!attSnap.empty) {
      const copyOps = attSnap.docs.map(d => {
        const newId = d.id.replace(oldUid, newUid);
        return b => b.set(doc(db, 'attendance', newId), { ...d.data(), uid: newUid });
      });
      await flushBatch(copyOps);
      const delOps = attSnap.docs.map(d => b => b.delete(doc(db, 'attendance', d.id)));
      await flushBatch(delOps);
      addLog(`  ✅ attendance: ${attSnap.size}件移行完了`);
    } else {
      addLog('  ⏭ attendance: データなし（スキップ）', 'var(--ink3)');
    }

    // 4. uidフィールドのみ更新するコレクション群
    const fieldOnlyCols = [
      { col: 'shifts',           label: 'シフト' },
      { col: 'salary',           label: '給与' },
      { col: 'overtimeRequests', label: '残業申請' },
      { col: 'meetingRequests',  label: '面談リクエスト' },
      { col: 'error_reports',    label: 'アラート報告' },
    ];
    for (const { col, label } of fieldOnlyCols) {
      addLog(`📁 ${label}(${col}) を処理中…`);
      const snap = await getDocs(query(collection(db, col), where('uid', '==', oldUid)));
      if (!snap.empty) {
        const ops = snap.docs.map(d => b => b.update(doc(db, col, d.id), { uid: newUid }));
        await flushBatch(ops);
        addLog(`  ✅ ${label}: ${snap.size}件更新完了`);
      } else {
        addLog(`  ⏭ ${label}: データなし（スキップ）`, 'var(--ink3)');
      }
    }

    addLog('🎉 全コレクションの移行が完了しました！', 'var(--blue)');
    document.getElementById('uid-swap-done-btn').style.display = '';
    await loadUsers();
  } catch(e) {
    addLog('❌ エラーが発生しました: ' + e.message, 'var(--accent)');
    addLog('途中で停止しました。旧UIDと新UIDの両方にデータが残っている可能性があります。', 'var(--accent)');
  }
}

// ── Window exports ────────────────────────────────────────
window.loadUsers                = loadUsers;
window.getMemberNames           = getMemberNames;
window.renderUsersTable         = renderUsersTable;
window.updateBulkDeleteBar      = updateBulkDeleteBar;
// ── Roadmap Preview Modal ──────────────────────────────────
async function openRoadmapPreviewModal(uid, name) {
  const periods = [
    { key: '1month',  label: '1ヶ月後', icon: '🌱', color: '#059669' },
    { key: '3months', label: '3ヶ月後', icon: '🌿', color: '#2563EB' },
    { key: '6months', label: '6ヶ月後', icon: '🌳', color: '#D97706' },
  ];

  // まずローディング状態で開く
  document.getElementById('modal-title-text').textContent = `📋 ${name} さんのロードマップ`;
  document.getElementById('modal-body').innerHTML = `
    <div id="rdm-preview-body" style="color:var(--ink3);font-size:13px;text-align:center;padding:20px 0;max-height:55vh;overflow-y:auto;overflow-x:hidden">読み込み中...</div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="add-btn" style="flex:1;background:rgba(37,99,235,.08);color:var(--blue);border:1px solid rgba(37,99,235,.2)"
        onclick="window.open('roadmap.html?uid=${uid}','_blank')">📋 ロードマップページを開く</button>
      <button class="add-btn" style="background:var(--surface2);color:var(--ink2);border:1px solid var(--border)" onclick="closeModal()">閉じる</button>
    </div>
  `;
  openModal();

  // Firestore読み込み
  try {
    const snap = await getDoc(doc(db, 'academy_roadmap', `${name}_custom_plan`));
    const body = document.getElementById('rdm-preview-body');
    if (!body) return;

    if (!snap.exists() || !snap.data().periods) {
      body.innerHTML = '<div style="text-align:center;padding:20px 0;color:var(--ink3)">📭 まだロードマップが作成されていません</div>';
      return;
    }

    const data = snap.data().periods;
    body.innerHTML = periods.map(p => {
      const d = data[p.key] || {};
      const goal = d.goal || '—';
      const actions = Array.isArray(d.actions) ? d.actions : [];
      const kpi = d.kpi || '';
      return `
        <div style="border:1px solid var(--border);border-left:3px solid ${p.color};border-radius:8px;padding:12px;margin-bottom:10px;text-align:left">
          <div style="font-weight:700;font-size:12px;color:${p.color};margin-bottom:6px">${p.icon} ${p.label}の目標</div>
          <div style="font-size:13px;font-weight:600;color:var(--ink);margin-bottom:6px;background:var(--surface2);padding:8px;border-radius:6px">${escHtml(goal)}</div>
          ${actions.length ? `<div style="font-size:11px;color:var(--ink2)">${actions.map(a => `<div style="margin-bottom:3px">▶ ${escHtml(a)}</div>`).join('')}</div>` : ''}
          ${kpi ? `<div style="font-size:11px;color:var(--blue);margin-top:6px;background:rgba(37,99,235,.06);padding:6px 8px;border-radius:4px">🎯 ${escHtml(kpi)}</div>` : ''}
        </div>`;
    }).join('');
  } catch (e) {
    const body = document.getElementById('rdm-preview-body');
    if (body) body.innerHTML = '<div style="color:var(--accent)">読み込みに失敗しました</div>';
  }
}

// 入社フォームURLコピー用（メンバー追加モーダル内）
window.nuCopyFormUrl = function() {
  const input = document.getElementById('nu-form-url');
  if (!input) return;
  navigator.clipboard.writeText(input.value).then(() => {
    const btn = document.querySelector('[onclick="nuCopyFormUrl()"]');
    if (btn) { const o = btn.textContent; btn.textContent = '✓ コピー済み'; setTimeout(() => btn.textContent = o, 1800); }
  });
};

window.selectAllUsers           = selectAllUsers;
window.bulkDeleteUsers          = bulkDeleteUsers;
window.openAddUserModal         = openAddUserModal;
window.openAddUserModalPrefilled = openAddUserModalPrefilled;
window.openBulkAddMembersModal  = openBulkAddMembersModal;
window.execBulkAddMembers       = execBulkAddMembers;
window.openEditUserModal        = openEditUserModal;
window.saveUser                 = saveUser;
window.confirmDeleteUser        = confirmDeleteUser;
window.sendPasswordReset        = sendPasswordReset;
window.deleteUser               = deleteUser;
window.openAddAllianceModal     = openAddAllianceModal;
window.saveAllianceMember       = saveAllianceMember;
window.openAddAllianceBulkModal = openAddAllianceBulkModal;
window.execAllianceBulkAdd      = execAllianceBulkAdd;
window.filterUsersBySearch        = filterUsersBySearch;
window.filterContractorsByCompany = filterContractorsByCompany;
window.sortUsers                  = sortUsers;
window.toggleShowRetired          = toggleShowRetired;
window.renderAddUserStep        = renderAddUserStep;
window.openRoadmapPreviewModal  = openRoadmapPreviewModal;
window.nuUpdateSalaryPreview    = nuUpdateSalaryPreview;
window.nuPreviewPhoto           = nuPreviewPhoto;
window.addUserNextStep          = addUserNextStep;
window.addUserSubmit            = addUserSubmit;
window.openUidSwapModal         = openUidSwapModal;
window.previewUidSwap           = previewUidSwap;
window.execUidSwap              = execUidSwap;
