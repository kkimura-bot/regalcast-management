// ============================================================
// Offboarding / 退職手続き管理 module
// ============================================================
import { RC, isAdmin } from '../state.js';
import {
  db, collection, doc, getDoc, getDocs, setDoc, updateDoc, serverTimestamp, writeBatch
} from '../firebase.js';
import { openModal, closeModal } from '../utils/modal.js';
import { escHtml } from '../utils/helpers.js';

const PROCEDURES = [
  { key: 'socialInsurance',    label: '社会保険の手続き' },
  { key: 'employmentInsurance', label: '雇用保険の手続き' },
  { key: 'residenceTax',       label: '住民税の手続き' },
];

let _cachedOffboarding = {}; // uid → offboarding data

// ── Helpers ───────────────────────────────────────────────

function generateToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function getResignBaseUrl() {
  const { protocol, host } = location;
  return `${protocol}//${host}/resign.html`;
}

// ── Load ──────────────────────────────────────────────────

export async function loadOffboarding() {
  const [obSnap, subSnap] = await Promise.all([
    getDocs(collection(db, 'offboarding')),
    getDocs(collection(db, 'resignation_submissions')),
  ]);
  _cachedOffboarding = {};
  obSnap.docs.forEach(d => { _cachedOffboarding[d.id] = d.data(); });
  // 提出データをマージ
  subSnap.docs.forEach(d => {
    const s = d.data();
    if (s.uid && _cachedOffboarding[s.uid]) {
      _cachedOffboarding[s.uid] = {
        ..._cachedOffboarding[s.uid],
        resignDate:     s.resignDate,
        resignReason:   s.reason,
        formSubmittedAt: s.submittedAt,
      };
    }
  });

  // 既存の completed=true ユーザーの isRetired を自動同期（既存データのマイグレーション）
  const batch = writeBatch(db);
  let needsCommit = false;
  obSnap.docs.forEach(d => {
    const ob = d.data();
    if (!ob.completed) return;
    const member = RC._cachedMembers.find(m => m.id === d.id);
    if (member && !member.isRetired) {
      batch.update(doc(db, 'users', d.id), { isRetired: true });
      member.isRetired = true;
      needsCommit = true;
    }
  });
  if (needsCommit) {
    await batch.commit();
    window.loadUsers?.(); // isRetired 反映のためメンバー一覧を再取得
  }

  renderOffboardingList();
}

// ── Render list ───────────────────────────────────────────

function renderOffboardingList(keyword = '') {
  const tbody = document.getElementById('offboarding-tbody');
  const mList = document.getElementById('m-offboarding-list');
  if (!tbody && !mList) return;

  const employees = RC._cachedMembers.filter(m => {
    const isContractor = m.isAlliance || m.noAuth || m.role === '委託' || m.role === 'alliance' || m.id.startsWith('alliance_');
    if (isContractor) return false;
    if (keyword) return (m.name || '').includes(keyword);
    return true;
  });

  const getStatus = (uid) => {
    const ob = _cachedOffboarding[uid];
    if (!ob) return { label: '未開始', color: 'var(--ink3)', bg: 'var(--surface2)' };
    const done = PROCEDURES.filter(p => ob.procedures?.[p.key]).length;
    const total = PROCEDURES.length;
    if (ob.completed) return { label: '退職完了', color: 'var(--accent2)', bg: 'rgba(58,125,90,.1)' };
    if (ob.formSubmittedAt && done < total) return { label: `手続き ${done}/${total}`, color: 'var(--warn)', bg: 'rgba(243,156,18,.1)' };
    if (ob.formSubmittedAt) return { label: '退職届提出済', color: '#7c3aed', bg: 'rgba(124,58,237,.1)' };
    if (ob.formToken) return { label: 'URL発行済', color: '#0ea5e9', bg: 'rgba(14,165,233,.1)' };
    return { label: '未開始', color: 'var(--ink3)', bg: 'var(--surface2)' };
  };

  if (tbody) {
    tbody.innerHTML = employees.length
      ? employees.map(m => {
          const ob = _cachedOffboarding[m.id] || {};
          const st = getStatus(m.id);
          return `<tr style="cursor:pointer" onclick="openOffboardingModal('${m.id}')">
            <td style="font-weight:600">${escHtml(m.name || '—')}</td>
            <td style="font-size:11px;color:var(--ink3)">${escHtml(m.dept || '—')}</td>
            <td style="font-size:11px;color:var(--ink3)">${ob.resignDate || '—'}</td>
            <td><span style="font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px;background:${st.bg};color:${st.color}">${st.label}</span></td>
            <td><button class="mini-btn" onclick="event.stopPropagation();openOffboardingModal('${m.id}')">管理</button></td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="5" class="empty">対象メンバーがいません</td></tr>';
  }

  if (mList) {
    mList.innerHTML = employees.length
      ? employees.map(m => {
          const ob = _cachedOffboarding[m.id] || {};
          const st = getStatus(m.id);
          return `<div class="m-card" onclick="openOffboardingModal('${m.id}')">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div style="font-weight:700">${escHtml(m.name || '—')}</div>
              <span style="font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px;background:${st.bg};color:${st.color}">${st.label}</span>
            </div>
            <div style="font-size:11px;color:var(--ink3);margin-top:4px">${escHtml(m.dept || '—')}${ob.resignDate ? '　退職希望: ' + ob.resignDate : ''}</div>
          </div>`;
        }).join('')
      : '<div class="empty">対象メンバーがいません</div>';
  }
}

// ── Modal ──────────────────────────────────────────────────

export function openOffboardingModal(uid) {
  const m  = RC._cachedMembers.find(x => x.id === uid);
  if (!m) return;
  const ob = _cachedOffboarding[uid] || {};

  // 手続きチェックリスト
  const procChecks = PROCEDURES.map(p => `
    <label style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer">
      <input type="checkbox" class="ob-proc-check" data-key="${p.key}"
        ${ob.procedures?.[p.key] ? 'checked' : ''}
        style="width:16px;height:16px;accent-color:var(--accent2);cursor:pointer">
      <span style="font-size:13px">${p.label}</span>
    </label>`).join('');

  // 退職届提出データ
  const formDataSection = ob.formSubmittedAt ? `
    <div style="margin-bottom:18px">
      <div style="font-size:11px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">📄 退職届（提出済み：${ob.formSubmittedAt.slice(0, 10)}）</div>
      <div style="background:var(--surface2);border-radius:8px;padding:12px;font-size:12px;line-height:1.9">
        <div><strong>退職希望日：</strong>${escHtml(ob.resignDate || '—')}</div>
        <div><strong>退職理由：</strong>${escHtml(ob.resignReason || '（記入なし）')}</div>
      </div>
    </div>` : '';

  // URL発行エリア
  const resignUrl = ob.formToken ? `${getResignBaseUrl()}?token=${ob.formToken}` : '';
  const urlSection = `
    <div style="margin-bottom:18px;background:${ob.formSubmittedAt ? 'rgba(58,125,90,.06)' : ob.formToken ? 'rgba(124,58,237,.06)' : 'var(--surface2)'};border-radius:10px;padding:14px">
      <div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">🔗 退職届フォームURL</div>
      ${ob.formSubmittedAt
        ? `<div style="font-size:12px;color:var(--accent2);font-weight:700">✅ 提出済み</div>`
        : ob.formToken
          ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <input type="text" value="${escHtml(resignUrl)}" readonly class="form-input" style="flex:1;font-size:11px;background:#fff" id="of-resign-url">
              <button class="mini-btn" onclick="copyResignUrl('${uid}')">コピー</button>
              <button class="mini-btn" style="color:var(--accent);border-color:var(--accent)" onclick="revokeResignUrl('${uid}')">無効化</button>
            </div>
            <div style="font-size:11px;color:var(--ink3);margin-top:6px">📋 このURLを退職希望者にLINE・メールで送ってください</div>`
          : `<button class="btn btn-primary" style="font-size:12px;padding:8px 18px;background:linear-gradient(135deg,#dc2626,#991b1b);border-color:#dc2626" onclick="issueResignUrl('${uid}')">🔗 退職届URLを発行する</button>
             <div style="font-size:11px;color:var(--ink3);margin-top:6px">発行したURLを退職希望者に送ることで、本人が入力できます</div>`
      }
    </div>`;

  document.getElementById('modal-title-text').textContent = `🚪 退職手続き — ${m.name}`;
  document.getElementById('modal-body').innerHTML = `
    ${urlSection}
    ${formDataSection}

    <!-- 退職情報 -->
    <div style="margin-bottom:18px">
      <div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">退職情報</div>
      <div class="form-row-2">
        <div class="form-row">
          <label class="form-label">退職希望日</label>
          <input type="date" class="form-input" id="of-resign-date" value="${ob.resignDate || ''}">
        </div>
        <div class="form-row">
          <label class="form-label">最終出勤日</label>
          <input type="date" class="form-input" id="of-last-workday" value="${ob.lastWorkday || ''}">
        </div>
      </div>
      <div class="form-row">
        <label class="form-label">備考</label>
        <textarea class="form-input" id="of-note" rows="2" style="resize:vertical">${escHtml(ob.note || '')}</textarea>
      </div>
    </div>

    <!-- 手続きチェックリスト -->
    <div style="margin-bottom:18px">
      <div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">📋 手続きチェックリスト</div>
      ${procChecks}
    </div>

    <!-- 完了フラグ -->
    <label style="display:flex;align-items:center;gap:10px;padding:12px;background:${ob.completed ? 'rgba(58,125,90,.08)' : 'var(--surface2)'};border-radius:8px;cursor:pointer;margin-bottom:16px">
      <input type="checkbox" id="of-completed" ${ob.completed ? 'checked' : ''}
        style="width:18px;height:18px;accent-color:var(--accent2);cursor:pointer">
      <span style="font-size:13px;font-weight:700;color:${ob.completed ? 'var(--accent2)' : 'var(--ink3)'}">✅ 退職手続きをすべて完了としてマークする</span>
    </label>

    <div id="of-error" style="font-size:12px;color:var(--accent);min-height:14px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">閉じる</button>
      <button class="btn btn-primary" id="of-save-btn" onclick="saveOffboarding('${uid}')">💾 保存</button>
    </div>`;
  openModal();
}

// ── Issue / Revoke URL ─────────────────────────────────────

export async function issueResignUrl(uid) {
  const token = generateToken();
  const m = RC._cachedMembers.find(x => x.id === uid);
  const name = m?.name || '';
  const existing = _cachedOffboarding[uid] || {};
  const issuedAt = new Date().toISOString();

  const data = {
    uid, name,
    formToken: token,
    formIssuedAt: issuedAt,
    updatedAt: serverTimestamp()
  };
  if (!existing.createdAt) data.createdAt = serverTimestamp();

  await Promise.all([
    setDoc(doc(db, 'offboarding', uid), data, { merge: true }),
    setDoc(doc(db, 'resignation_submissions', token), { token, uid, name, issuedAt }),
  ]);
  _cachedOffboarding[uid] = { ..._cachedOffboarding[uid], ...data };
  openOffboardingModal(uid);
}

export async function revokeResignUrl(uid) {
  if (!confirm('このURLを無効にしますか？新しいURLを発行するまで入力できなくなります。')) return;
  await updateDoc(doc(db, 'offboarding', uid), { formToken: null });
  _cachedOffboarding[uid] = { ..._cachedOffboarding[uid], formToken: null };
  openOffboardingModal(uid);
}

export function copyResignUrl(uid) {
  const ob = _cachedOffboarding[uid];
  if (!ob?.formToken) return;
  const url = `${getResignBaseUrl()}?token=${ob.formToken}`;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.querySelector(`[onclick="copyResignUrl('${uid}')"]`);
    if (btn) { btn.textContent = '✓ コピー済み'; setTimeout(() => { btn.textContent = 'コピー'; }, 2000); }
  });
}

// ── Save ──────────────────────────────────────────────────

export async function saveOffboarding(uid) {
  const saveBtn = document.getElementById('of-save-btn');
  const errEl   = document.getElementById('of-error');
  if (saveBtn) saveBtn.disabled = true;

  const resignDate  = document.getElementById('of-resign-date')?.value || '';
  const lastWorkday = document.getElementById('of-last-workday')?.value || '';
  const note        = document.getElementById('of-note')?.value.trim() || '';
  const completed   = document.getElementById('of-completed')?.checked || false;

  const procedures = {};
  document.querySelectorAll('.ob-proc-check').forEach(el => {
    procedures[el.dataset.key] = el.checked;
  });

  try {
    const m = RC._cachedMembers.find(x => x.id === uid);
    const data = {
      uid, name: m?.name || '',
      resignDate, lastWorkday, note,
      procedures, completed,
      updatedAt: serverTimestamp()
    };
    if (!_cachedOffboarding[uid]) data.createdAt = serverTimestamp();

    const batch = writeBatch(db);
    batch.set(doc(db, 'offboarding', uid), data, { merge: true });
    // 退職完了フラグをusersコレクションにも同期
    const prevCompleted = _cachedOffboarding[uid]?.completed || false;
    if (completed !== prevCompleted) {
      batch.update(doc(db, 'users', uid), {
        isRetired: completed,
        retiredAt: completed ? serverTimestamp() : null,
      });
      const idx = RC._cachedMembers.findIndex(x => x.id === uid);
      if (idx >= 0) RC._cachedMembers[idx].isRetired = completed;
    }
    await batch.commit();
    _cachedOffboarding[uid] = { ..._cachedOffboarding[uid], ...data };

    renderOffboardingList(document.getElementById('offboarding-search')?.value || '');
    closeModal();
  } catch(e) {
    if (errEl) errEl.textContent = e.message;
    if (saveBtn) saveBtn.disabled = false;
  }
}

export function filterOffboarding(keyword) {
  renderOffboardingList(keyword);
}

// ── Expose to window ───────────────────────────────────────
window.loadOffboarding       = loadOffboarding;
window.openOffboardingModal  = openOffboardingModal;
window.saveOffboarding       = saveOffboarding;
window.filterOffboarding     = filterOffboarding;
window.issueResignUrl        = issueResignUrl;
window.revokeResignUrl       = revokeResignUrl;
window.copyResignUrl         = copyResignUrl;
