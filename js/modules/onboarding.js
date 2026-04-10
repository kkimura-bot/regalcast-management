// ============================================================
// Onboarding / 入社手続き管理 module
// ============================================================
import { RC, isAdmin } from '../state.js';
import {
  auth, db, firebaseConfig, collection, doc, getDoc, getDocs, setDoc, updateDoc,
  query, where, orderBy, serverTimestamp, sendPasswordResetEmail, writeBatch
} from '../firebase.js';
import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';
import { openModal, closeModal } from '../utils/modal.js';
import { escHtml } from '../utils/helpers.js';

const DOC_ITEMS = [
  '雇用契約書',
  'マイナンバー提出',
  '銀行口座届出',
  '住民票コピー',
  '源泉徴収票（前職）',
  '誓約書',
];

const INSURANCE_ITEMS = [
  '雇用保険',
  '社会保険',
  '健康保険証発行',
];

let _cachedOnboarding = {}; // uid → onboarding data

// ── Helpers ───────────────────────────────────────────────

function generateToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function getFormBaseUrl() {
  const { protocol, host } = location;
  return `${protocol}//${host}/form.html`;
}

// ── Load ──────────────────────────────────────────────────

export async function loadOnboarding() {
  const [obSnap, subSnap] = await Promise.all([
    getDocs(collection(db, 'onboarding')),
    getDocs(collection(db, 'form_submissions')),
  ]);
  _cachedOnboarding = {};
  obSnap.docs.forEach(d => { _cachedOnboarding[d.id] = d.data(); });
  // 提出データをマージ
  subSnap.docs.forEach(d => {
    const s = d.data();
    if (s.uid && _cachedOnboarding[s.uid]) {
      _cachedOnboarding[s.uid] = {
        ..._cachedOnboarding[s.uid],
        formData: s.formData,
        formSubmittedAt: s.submittedAt,
      };
    }
  });
  renderOnboardingList();
}

// ── Render list ───────────────────────────────────────────

function renderOnboardingList(keyword = '') {
  const tbody = document.getElementById('onboarding-tbody');
  const mList = document.getElementById('m-onboarding-list');
  if (!tbody && !mList) return;

  const employees = RC._cachedMembers.filter(m => {
    const isContractor = m.isAlliance || m.noAuth || m.role === '委託' || m.role === 'alliance' || m.id.startsWith('alliance_');
    if (isContractor) return false;
    if (keyword) return (m.name||'').includes(keyword);
    return true;
  });

  const getStatus = (uid) => {
    const ob = _cachedOnboarding[uid];
    if (!ob) return { label: '未開始', color: 'var(--ink3)', bg: 'var(--surface2)', done: 0, total: DOC_ITEMS.length + INSURANCE_ITEMS.length };
    const docs = DOC_ITEMS.filter(k => ob.documents?.[k]).length;
    const ins  = INSURANCE_ITEMS.filter(k => ob.insurance?.[k]).length;
    const done = docs + ins;
    const total = DOC_ITEMS.length + INSURANCE_ITEMS.length;
    if (ob.completed) return { label: '完了', color: 'var(--accent2)', bg: 'rgba(58,125,90,.1)', done, total };
    if (ob.formSubmittedAt && done < total) return { label: 'フォーム提出済', color: '#7c3aed', bg: 'rgba(124,58,237,.1)', done, total };
    if (done === 0)   return { label: '未開始', color: 'var(--ink3)', bg: 'var(--surface2)', done, total };
    return { label: `${done}/${total} 完了`, color: 'var(--warn)', bg: 'rgba(243,156,18,.1)', done, total };
  };

  if (tbody) {
    tbody.innerHTML = employees.length
      ? employees.map(m => {
          const ob = _cachedOnboarding[m.id] || {};
          const st = getStatus(m.id);
          return `<tr style="cursor:pointer" onclick="openOnboardingModal('${m.id}')">
            <td style="font-weight:600">${escHtml(m.name||'—')}</td>
            <td style="font-size:11px;color:var(--ink3)">${escHtml(m.dept||'—')}</td>
            <td style="font-size:11px;color:var(--ink3)">${ob.joinDate||'—'}</td>
            <td style="font-size:11px;color:var(--ink3)">${escHtml(ob.employmentType||'—')}</td>
            <td><span style="font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px;background:${st.bg};color:${st.color}">${st.label}</span></td>
            <td><button class="mini-btn" onclick="event.stopPropagation();openOnboardingModal('${m.id}')">管理</button></td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="6" class="empty">対象メンバーがいません</td></tr>';
  }

  if (mList) {
    mList.innerHTML = employees.length
      ? employees.map(m => {
          const ob = _cachedOnboarding[m.id] || {};
          const st = getStatus(m.id);
          return `<div class="m-card" onclick="openOnboardingModal('${m.id}')">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div style="font-weight:700">${escHtml(m.name||'—')}</div>
              <span style="font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px;background:${st.bg};color:${st.color}">${st.label}</span>
            </div>
            <div style="font-size:11px;color:var(--ink3);margin-top:4px">${escHtml(m.dept||'—')} ${ob.joinDate?'｜ 入社: '+ob.joinDate:''}</div>
          </div>`;
        }).join('')
      : '<div class="empty">対象メンバーがいません</div>';
  }
}

// ── Modal ──────────────────────────────────────────────────

export function openOnboardingModal(uid) {
  const m  = RC._cachedMembers.find(x => x.id === uid);
  if (!m) return;
  const ob = _cachedOnboarding[uid] || {};

  const employmentTypes = ['正社員', '契約社員', 'パートタイム', '業務委託'];
  const etOpts = ['', ...employmentTypes].map(t =>
    `<option value="${t}" ${ob.employmentType===t?'selected':''}>${t||'選択してください'}</option>`).join('');

  const docChecks = DOC_ITEMS.map(k => `
    <label style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer">
      <input type="checkbox" class="ob-doc-check" data-key="${escHtml(k)}"
        ${ob.documents?.[k]?'checked':''}
        style="width:16px;height:16px;accent-color:var(--accent2);cursor:pointer">
      <span style="font-size:13px">${escHtml(k)}</span>
    </label>`).join('');

  const insChecks = INSURANCE_ITEMS.map(k => `
    <label style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer">
      <input type="checkbox" class="ob-ins-check" data-key="${escHtml(k)}"
        ${ob.insurance?.[k]?'checked':''}
        style="width:16px;height:16px;accent-color:var(--accent2);cursor:pointer">
      <span style="font-size:13px">${escHtml(k)}</span>
    </label>`).join('');

  // フォーム提出データ表示
  const fd = ob.formData;
  const formDataSection = fd ? `
    <div style="margin-bottom:18px">
      <div style="font-size:11px;font-weight:700;color:var(--accent2);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">✅ フォーム提出済み（${ob.formSubmittedAt ? ob.formSubmittedAt.slice(0,10) : ''}）</div>
      <div style="background:var(--surface2);border-radius:8px;padding:12px;font-size:12px;line-height:1.9">
        <div><strong>氏名：</strong>${escHtml(fd.fullName||'—')} （${escHtml(fd.fullNameKana||'—')}）</div>
        <div><strong>生年月日：</strong>${escHtml(fd.birthDate||'—')}</div>
        <div><strong>住所：</strong>${escHtml(fd.address||'—')}</div>
        <div><strong>電話：</strong>${escHtml(fd.phone||'—')}</div>
        <div><strong>メール：</strong>${escHtml(fd.email||'—')}</div>
        <div><strong>マイナンバー：</strong>${fd.myNumber ? '****' + fd.myNumber.slice(-4) : '—'}</div>
        <hr style="margin:8px 0;border:none;border-top:1px solid var(--border)">
        <div><strong>緊急連絡先：</strong>${escHtml(fd.emergencyName||'—')}（${escHtml(fd.emergencyRelation||'—')}） ${escHtml(fd.emergencyPhone||'')}</div>
        <div><strong>身元保証人：</strong>${escHtml(fd.guarantorName||'—')}（${escHtml(fd.guarantorRelation||'—')}） ${escHtml(fd.guarantorPhone||'')} ${escHtml(fd.guarantorAddress||'')}</div>
        <hr style="margin:8px 0;border:none;border-top:1px solid var(--border)">
        <div><strong>銀行：</strong>${escHtml(fd.bankName||'—')} ${escHtml(fd.bankBranch||'')} ${escHtml(fd.bankType||'')} ${escHtml(fd.bankNumber||'')} ${escHtml(fd.bankHolder||'')}</div>
        <hr style="margin:8px 0;border:none;border-top:1px solid var(--border)">
        <div><strong>前職：</strong>${escHtml(fd.prevCompany||'なし')}</div>
        <div><strong>誓約書署名：</strong>${escHtml(fd.pledgeSignature||'—')}（${escHtml(fd.pledgeDate||'—')}）</div>
      </div>
    </div>` : '';

  // URL発行エリア
  const formUrl = ob.formToken ? `${getFormBaseUrl()}?token=${ob.formToken}` : '';
  const urlSection = `
    <div style="margin-bottom:18px;background:${ob.formSubmittedAt?'rgba(58,125,90,.06)':ob.formToken?'rgba(124,58,237,.06)':'var(--surface2)'};border-radius:10px;padding:14px">
      <div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">🔗 入社手続きフォームURL</div>
      ${ob.formSubmittedAt
        ? `<div style="font-size:12px;color:var(--accent2);font-weight:700">✅ 提出済み</div>`
        : ob.formToken
          ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <input type="text" value="${escHtml(formUrl)}" readonly class="form-input" style="flex:1;font-size:11px;background:#fff" id="ob-form-url">
              <button class="mini-btn" onclick="copyFormUrl('${uid}')">コピー</button>
              <button class="mini-btn" style="color:var(--accent);border-color:var(--accent)" onclick="revokeFormUrl('${uid}')">無効化</button>
            </div>
            <div style="font-size:11px;color:var(--ink3);margin-top:6px">📋 このURLを採用予定者にLINE・メールで送ってください</div>`
          : `<button class="btn btn-primary" style="font-size:12px;padding:8px 18px" onclick="issueFormUrl('${uid}')">🔗 フォームURLを発行する</button>
             <div style="font-size:11px;color:var(--ink3);margin-top:6px">発行したURLを採用予定者に送ることで、本人が入力できます</div>`
      }
    </div>`;

  document.getElementById('modal-title-text').textContent = `📋 入社手続き — ${m.name}`;
  document.getElementById('modal-body').innerHTML = `
    ${urlSection}
    ${formDataSection}

    <!-- 入社情報 -->
    <div style="margin-bottom:18px">
      <div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">入社情報</div>
      <div class="form-row-2">
        <div class="form-row">
          <label class="form-label">入社日</label>
          <input type="date" class="form-input" id="ob-join-date" value="${ob.joinDate||''}">
        </div>
        <div class="form-row">
          <label class="form-label">雇用形態</label>
          <select class="form-input" id="ob-employment-type">${etOpts}</select>
        </div>
      </div>
      <div class="form-row-2">
        <div class="form-row">
          <label class="form-label">試用期間終了日</label>
          <input type="date" class="form-input" id="ob-probation-end" value="${ob.probationEnd||''}">
        </div>
        <div class="form-row">
          <label class="form-label">給与開始日</label>
          <input type="date" class="form-input" id="ob-salary-start" value="${ob.salaryStartDate||''}">
        </div>
      </div>
      <div class="form-row">
        <label class="form-label">備考</label>
        <textarea class="form-input" id="ob-note" rows="2" style="resize:vertical">${escHtml(ob.note||'')}</textarea>
      </div>
    </div>

    <!-- 書類チェックリスト -->
    <div style="margin-bottom:18px">
      <div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">📁 書類回収チェックリスト</div>
      ${docChecks}
    </div>

    <!-- 保険・社会保障 -->
    <div style="margin-bottom:18px">
      <div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">🏥 保険・社会保障</div>
      ${insChecks}
    </div>

    <!-- 完了フラグ -->
    <label style="display:flex;align-items:center;gap:10px;padding:12px;background:${ob.completed?'rgba(58,125,90,.08)':'var(--surface2)'};border-radius:8px;cursor:pointer;margin-bottom:16px">
      <input type="checkbox" id="ob-completed" ${ob.completed?'checked':''}
        style="width:18px;height:18px;accent-color:var(--accent2);cursor:pointer">
      <span style="font-size:13px;font-weight:700;color:${ob.completed?'var(--accent2)':'var(--ink3)'}">✅ 入社手続きをすべて完了としてマークする</span>
    </label>

    <div id="ob-error" style="font-size:12px;color:var(--accent);min-height:14px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">閉じる</button>
      <button class="btn btn-primary" id="ob-save-btn" onclick="saveOnboarding('${uid}')">💾 保存</button>
    </div>`;
  openModal();
}

// ── Issue / Revoke URL ─────────────────────────────────────

export async function issueFormUrl(uid) {
  const token = generateToken();
  const m = RC._cachedMembers.find(x => x.id === uid);
  const name = m?.name || '';
  const existing = _cachedOnboarding[uid] || {};
  const issuedAt = new Date().toISOString();

  const data = {
    uid, name,
    formToken: token,
    formIssuedAt: issuedAt,
    updatedAt: serverTimestamp()
  };
  if (!existing.createdAt) data.createdAt = serverTimestamp();

  // onboarding ドキュメントとform_submissionsの発行レコード両方に書く
  await Promise.all([
    setDoc(doc(db, 'onboarding', uid), data, { merge: true }),
    setDoc(doc(db, 'form_submissions', token), { token, uid, name, issuedAt }),
  ]);
  _cachedOnboarding[uid] = { ..._cachedOnboarding[uid], ...data };
  openOnboardingModal(uid);
}

// アカウントなしで新規入社フォームURLを発行
export function openPendingFormModal() {
  document.getElementById('modal-title-text').textContent = '🔗 新規入社フォームを発行';
  document.getElementById('modal-body').innerHTML = `
    <div style="font-size:13px;color:var(--ink3);margin-bottom:16px;line-height:1.7">
      アカウント作成前の採用予定者にフォームURLを発行します。<br>
      提出後、報告確認タブからアカウント作成できます。
    </div>
    <div class="form-row">
      <label class="form-label">採用予定者の名前<span style="color:var(--accent);margin-left:4px">必須</span></label>
      <input type="text" class="form-input" id="pending-name" placeholder="例：山田 太郎" autofocus>
    </div>
    <div id="pending-url-area" style="display:none;margin-top:16px">
      <div style="font-size:11px;font-weight:700;color:var(--accent2);margin-bottom:8px">✅ URLを発行しました</div>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="text" id="pending-url-input" class="form-input" readonly style="font-size:11px;background:var(--surface2)">
        <button class="mini-btn" onclick="copyPendingUrl()">コピー</button>
      </div>
      <div style="font-size:11px;color:var(--ink3);margin-top:6px">📋 このURLを採用予定者にLINE・メールで送ってください</div>
    </div>
    <div id="pending-error" style="font-size:12px;color:var(--accent);min-height:14px;margin-top:8px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">閉じる</button>
      <button class="btn btn-primary" id="pending-issue-btn" onclick="issuePendingFormUrl()">🔗 URLを発行する</button>
    </div>`;
  openModal();
}

export async function issuePendingFormUrl() {
  const name = document.getElementById('pending-name')?.value.trim();
  const errEl = document.getElementById('pending-error');
  if (!name) { errEl.textContent = '名前を入力してください'; return; }

  const btn = document.getElementById('pending-issue-btn');
  btn.disabled = true;

  const token = generateToken();
  const issuedAt = new Date().toISOString();

  await setDoc(doc(db, 'form_submissions', token), {
    token, name, issuedAt, pending: true
  });

  const url = `${getFormBaseUrl()}?token=${token}`;
  document.getElementById('pending-url-area').style.display = '';
  document.getElementById('pending-url-input').value = url;
  document.getElementById('pending-name').disabled = true;
  btn.style.display = 'none';
}

export function copyPendingUrl() {
  const url = document.getElementById('pending-url-input')?.value;
  if (!url) return;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.querySelector('[onclick="copyPendingUrl()"]');
    if (btn) { btn.textContent = '✓ コピー済み'; setTimeout(() => { btn.textContent = 'コピー'; }, 2000); }
  });
}

export async function revokeFormUrl(uid) {
  if (!confirm('このURLを無効にしますか？新しいURLを発行するまで入力できなくなります。')) return;
  await updateDoc(doc(db, 'onboarding', uid), { formToken: null });
  _cachedOnboarding[uid] = { ..._cachedOnboarding[uid], formToken: null };
  openOnboardingModal(uid);
}

export function copyFormUrl(uid) {
  const ob = _cachedOnboarding[uid];
  if (!ob?.formToken) return;
  const url = `${getFormBaseUrl()}?token=${ob.formToken}`;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.querySelector('[onclick="copyFormUrl(\'' + uid + '\')"]');
    if (btn) { btn.textContent = '✓ コピー済み'; setTimeout(() => { btn.textContent = 'コピー'; }, 2000); }
  });
}

// ── Save ──────────────────────────────────────────────────

export async function saveOnboarding(uid) {
  const saveBtn = document.getElementById('ob-save-btn');
  const errEl   = document.getElementById('ob-error');
  if (saveBtn) saveBtn.disabled = true;

  const joinDate        = document.getElementById('ob-join-date')?.value || '';
  const employmentType  = document.getElementById('ob-employment-type')?.value || '';
  const probationEnd    = document.getElementById('ob-probation-end')?.value || '';
  const salaryStartDate = document.getElementById('ob-salary-start')?.value || '';
  const note            = document.getElementById('ob-note')?.value.trim() || '';
  const completed       = document.getElementById('ob-completed')?.checked || false;

  const documents = {};
  document.querySelectorAll('.ob-doc-check').forEach(el => {
    documents[el.dataset.key] = el.checked;
  });

  const insurance = {};
  document.querySelectorAll('.ob-ins-check').forEach(el => {
    insurance[el.dataset.key] = el.checked;
  });

  try {
    const m = RC._cachedMembers.find(x => x.id === uid);
    const data = {
      uid, name: m?.name || '',
      joinDate, employmentType, probationEnd, salaryStartDate, note,
      documents, insurance, completed,
      updatedAt: serverTimestamp()
    };
    if (!_cachedOnboarding[uid]) data.createdAt = serverTimestamp();

    await setDoc(doc(db, 'onboarding', uid), data, { merge: true });
    _cachedOnboarding[uid] = { ..._cachedOnboarding[uid], ...data };

    renderOnboardingList(document.getElementById('onboarding-search')?.value || '');
    closeModal();
  } catch(e) {
    if (errEl) errEl.textContent = e.message;
    if (saveBtn) saveBtn.disabled = false;
  }
}

export function filterOnboarding(keyword) {
  renderOnboardingList(keyword);
}

// ── アカウント作成（ペンディングフォーム承認） ─────────────

export async function approveAndCreateAccount(submissionId) {
  const subSnap = await getDoc(doc(db, 'form_submissions', submissionId));
  if (!subSnap.exists()) { alert('提出データが見つかりません'); return; }
  const sub = subSnap.data();
  const email = sub.formData?.email;
  const name  = sub.formData?.fullName || sub.name || '';

  if (!email) {
    alert('フォームにメールアドレスが入力されていません。\nメールが必須のフォームで再提出してもらってください。');
    return;
  }

  if (!confirm(`${name} さんのアカウントを作成します。\n\nメール: ${email}\n\nパスワード設定メールが本人に送られます。続けますか？`)) return;

  const btn = document.querySelector(`[onclick="approveAndCreateAccount('${submissionId}')"]`);
  if (btn) { btn.disabled = true; btn.textContent = '作成中...'; }

  try {
    // 第2 Firebase Appインスタンスで管理者をログアウトさせずにアカウント作成
    const secondaryApp = getApps().find(a => a.name === 'rc-secondary')
      || initializeApp(firebaseConfig, 'rc-secondary');
    const secondaryAuth = getAuth(secondaryApp);

    const tempPass = generateToken().slice(0, 16);
    const userCred = await createUserWithEmailAndPassword(secondaryAuth, email, tempPass);
    const newUid = userCred.user.uid;
    await secondaryAuth.signOut();

    // Firestoreにメンバードキュメント作成
    await setDoc(doc(db, 'users', newUid), {
      name, email, role: 'member', uid: newUid, createdAt: serverTimestamp(),
    });

    // form_submissions を更新
    await updateDoc(doc(db, 'form_submissions', submissionId), {
      uid: newUid, pending: false, approvedAt: new Date().toISOString(),
    });

    // パスワードリセットメール送信
    await sendPasswordResetEmail(auth, email);

    alert(`✅ アカウントを作成しました！\n${email} にパスワード設定メールを送りました。\n\n本人がメールを確認してパスワードを設定後、ログインできます。`);

    window.loadReports?.();
    window.loadOnboarding?.();
  } catch(e) {
    alert('❌ アカウント作成に失敗しました:\n' + e.message);
    if (btn) { btn.disabled = false; btn.textContent = '✅ 承認 & アカウント作成'; }
  }
}

// ── Bulk issue form URLs ───────────────────────────────────

export async function bulkIssueFormUrls() {
  // 対象：社員かつ フォーム未提出 かつ URL未発行
  const targets = RC._cachedMembers.filter(m => {
    const isContractor = m.isAlliance || m.noAuth || m.role === '委託' || m.role === 'alliance' || m.id.startsWith('alliance_');
    if (isContractor) return false;
    const ob = _cachedOnboarding[m.id];
    return !ob?.formSubmittedAt && !ob?.formToken;
  });

  if (!targets.length) {
    alert('対象メンバーがいません（全員フォーム発行済み or 提出済みです）');
    return;
  }

  if (!confirm(`${targets.length}名にフォームURLを一括発行します。\n\n対象メンバー：\n${targets.map(m => '・' + m.name).join('\n')}\n\n続けますか？`)) return;

  const issuedAt = new Date().toISOString();
  const batch = writeBatch(db);

  const issued = [];
  for (const m of targets) {
    const token = generateToken();
    const existing = _cachedOnboarding[m.id] || {};
    const data = {
      uid: m.id, name: m.name,
      formToken: token,
      formIssuedAt: issuedAt,
      updatedAt: serverTimestamp()
    };
    if (!existing.createdAt) data.createdAt = serverTimestamp();
    batch.set(doc(db, 'onboarding', m.id), data, { merge: true });
    batch.set(doc(db, 'form_submissions', token), { token, uid: m.id, name: m.name, issuedAt });
    _cachedOnboarding[m.id] = { ..._cachedOnboarding[m.id], ...data };
    issued.push({ name: m.name, url: `${getFormBaseUrl()}?token=${token}` });
  }

  await batch.commit();
  renderOnboardingList();

  // URL一覧をコピーできるモーダル表示
  const urlList = issued.map(x => `${x.name}：${x.url}`).join('\n');
  document.getElementById('modal-title-text').textContent = `✅ ${issued.length}名のURLを発行しました`;
  document.getElementById('modal-body').innerHTML = `
    <div style="font-size:12px;color:var(--ink3);margin-bottom:10px">各メンバーにURLを送ってください。</div>
    <textarea class="form-input" id="bulk-url-list" rows="10" readonly style="font-size:11px;line-height:1.8;background:var(--surface2)">${urlList}</textarea>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">閉じる</button>
      <button class="btn btn-primary" onclick="copyBulkUrls()">📋 全URLをコピー</button>
    </div>`;
  openModal();
}

export function copyBulkUrls() {
  const text = document.getElementById('bulk-url-list')?.value;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('[onclick="copyBulkUrls()"]');
    if (btn) { btn.textContent = '✓ コピー済み'; setTimeout(() => { btn.textContent = '📋 全URLをコピー'; }, 2000); }
  });
}

// ── 既存アカウントに紐づける ────────────────────────────────

export async function linkSubmissionToExistingUser(submissionId) {
  const subSnap = await getDoc(doc(db, 'form_submissions', submissionId));
  if (!subSnap.exists()) { alert('提出データが見つかりません'); return; }
  const sub = subSnap.data();
  const fd = sub.formData || {};

  // 既存メンバー一覧（委託除く）
  const members = (RC._cachedMembers || []).filter(m => {
    return !m.isAlliance && !m.noAuth && m.role !== '委託' && m.role !== 'alliance' && !m.id.startsWith('alliance_');
  });

  const opts = members.map(m =>
    `<option value="${m.id}">${escHtml(m.name)}（${escHtml(m.dept||'—')}）</option>`
  ).join('');

  document.getElementById('modal-title-text').textContent = '🔗 既存アカウントに紐づける';
  document.getElementById('modal-body').innerHTML = `
    <div style="font-size:13px;color:var(--ink3);margin-bottom:16px;line-height:1.7">
      提出済みフォームを既存のアカウントに紐づけます。<br>
      入社手続きタブに自動で反映されます。
    </div>
    ${fd.fullName ? `
    <div style="background:var(--surface2);border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.9;margin-bottom:16px">
      <div><strong>フォーム氏名：</strong>${escHtml(fd.fullName)}（${escHtml(fd.fullNameKana||'—')}）</div>
      <div><strong>メール：</strong>${escHtml(fd.email||'—')}</div>
      <div><strong>提出日：</strong>${sub.submittedAt ? sub.submittedAt.slice(0,10) : '—'}</div>
    </div>` : ''}
    <div class="form-row">
      <label class="form-label">紐づけるアカウント<span style="color:var(--accent);margin-left:4px">必須</span></label>
      <select class="form-input" id="link-member-select">
        <option value="">選択してください</option>
        ${opts}
      </select>
    </div>
    <div id="link-error" style="font-size:12px;color:var(--accent);min-height:14px;margin-top:8px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" id="link-confirm-btn" onclick="confirmLinkSubmission('${submissionId}')">🔗 紐づける</button>
    </div>`;
  openModal();
}

export async function confirmLinkSubmission(submissionId) {
  const uid = document.getElementById('link-member-select')?.value;
  const errEl = document.getElementById('link-error');
  if (!uid) { errEl.textContent = 'アカウントを選択してください'; return; }

  const btn = document.getElementById('link-confirm-btn');
  btn.disabled = true; btn.textContent = '処理中...';

  try {
    const subSnap = await getDoc(doc(db, 'form_submissions', submissionId));
    const sub = subSnap.data();
    const m = RC._cachedMembers.find(x => x.id === uid);

    // form_submissions の uid を更新・pending 解除
    await updateDoc(doc(db, 'form_submissions', submissionId), {
      uid,
      name: m?.name || sub.name || '',
      pending: false,
      linkedAt: new Date().toISOString(),
    });

    // onboarding ドキュメントを作成 or 更新（formData をマージ）
    const existing = _cachedOnboarding[uid] || {};
    const obData = {
      uid,
      name: m?.name || '',
      formToken: sub.token || submissionId,
      formIssuedAt: sub.issuedAt || null,
      updatedAt: serverTimestamp(),
    };
    if (!existing.createdAt) obData.createdAt = serverTimestamp();

    await setDoc(doc(db, 'onboarding', uid), obData, { merge: true });

    closeModal();
    alert(`✅ ${m?.name || ''} さんのアカウントに紐づけました。\n入社手続きタブで内容を確認できます。`);

    // 両方リロード
    await Promise.all([
      loadOnboarding(),
      window.loadReports?.(),
    ]);
  } catch(e) {
    errEl.textContent = 'エラー: ' + e.message;
    btn.disabled = false; btn.textContent = '🔗 紐づける';
  }
}

window.loadOnboarding       = loadOnboarding;
window.openOnboardingModal  = openOnboardingModal;
window.saveOnboarding       = saveOnboarding;
window.filterOnboarding     = filterOnboarding;
window.issueFormUrl         = issueFormUrl;
window.revokeFormUrl        = revokeFormUrl;
window.copyFormUrl          = copyFormUrl;
window.openPendingFormModal = openPendingFormModal;
window.issuePendingFormUrl  = issuePendingFormUrl;
window.copyPendingUrl       = copyPendingUrl;
window.approveAndCreateAccount   = approveAndCreateAccount;
window.bulkIssueFormUrls         = bulkIssueFormUrls;
window.copyBulkUrls              = copyBulkUrls;
window.linkSubmissionToExistingUser = linkSubmissionToExistingUser;
window.confirmLinkSubmission     = confirmLinkSubmission;
