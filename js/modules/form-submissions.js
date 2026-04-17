// ============================================================
// Form Submissions / 入社フォーム送信内容 確認ページ
// ============================================================
// form_submissions コレクションの送信済みデータを一覧・詳細・
// 処理済みマーク・削除（論理削除）できる専用ページ。
// 管理者のみアクセス可能。
// ============================================================
import { RC, isAdmin } from '../state.js';
import {
  db, auth, collection, doc, getDoc, getDocs, updateDoc,
  addDoc, serverTimestamp,
} from '../firebase.js';
import { openModal, closeModal } from '../utils/modal.js';
import { escHtml } from '../utils/helpers.js';

// マイナンバー表示状態管理（submissionId → { timeoutId, countdownIntervalId }）
const _myNumberTimers = new Map();

let _cachedSubmissions = []; // 全submissions (pending + 提出済 + 削除済)
let _currentFilter = 'unread'; // 'unread' | 'all' | 'processed' | 'deleted'

// ── Load ──────────────────────────────────────────────────

export async function loadFormSubmissions() {
  if (!isAdmin()) return;
  const snap = await getDocs(collection(db, 'form_submissions'));
  _cachedSubmissions = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(s => s.submittedAt) // 提出済みのみ
    .sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
  renderFormSubmissionsPage();
  updateFormSubmissionsBadge();
}

// ── Badge ─────────────────────────────────────────────────

export function updateFormSubmissionsBadge() {
  const unread = _cachedSubmissions.filter(s => !s.readAt && !s.deletedAt).length;
  ['form-sub-nav-badge', 'm-form-sub-nav-badge'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = unread || '';
      el.style.display = unread ? 'inline-flex' : 'none';
    }
  });
}

// ── Render list ───────────────────────────────────────────

function matchFilter(s) {
  if (s.deletedAt) return _currentFilter === 'deleted';
  if (_currentFilter === 'deleted') return false;
  if (_currentFilter === 'unread') return !s.readAt;
  if (_currentFilter === 'processed') return !!s.readAt;
  return true;
}

function renderFormSubmissionsPage() {
  const body  = document.getElementById('form-submissions-body');
  const mBody = document.getElementById('m-form-submissions-body');
  const list = _cachedSubmissions.filter(matchFilter);

  // カウンター更新
  ['form-sub-count', 'm-form-sub-count'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = `${list.length}件`;
  });

  if (!list.length) {
    const empty = '<div style="text-align:center;padding:48px 0;color:var(--ink3);font-size:13px">該当するフォーム送信はありません</div>';
    if (body)  body.innerHTML  = empty;
    if (mBody) mBody.innerHTML = empty;
    return;
  }

  const cards = list.map(renderSubmissionCard).join('');
  if (body)  body.innerHTML  = cards;
  if (mBody) mBody.innerHTML = cards;
}

function renderSubmissionCard(s) {
  const fd = s.formData || {};
  const memberName = RC._cachedMembers?.find(m => m.id === s.uid)?.name || fd.fullName || s.name || s.uid || '—';
  const submittedDate = s.submittedAt ? s.submittedAt.slice(0, 16).replace('T', ' ') : '—';
  const isRead = !!s.readAt;
  const isDeleted = !!s.deletedAt;
  const hasAccount = !!s.uid && !s.pending;

  // ステータスバッジ
  let statusBadge = '';
  if (isDeleted) {
    statusBadge = '<span style="font-size:10px;font-weight:700;color:var(--ink3);background:var(--surface2);padding:3px 9px;border-radius:4px;white-space:nowrap">🗑 削除済み</span>';
  } else if (isRead) {
    statusBadge = '<span style="font-size:10px;font-weight:700;color:var(--ink3);background:var(--surface2);padding:3px 9px;border-radius:4px;white-space:nowrap">✅ 処理済</span>';
  } else {
    statusBadge = '<span style="font-size:10px;font-weight:700;color:var(--accent2);background:rgba(58,125,90,.12);padding:3px 9px;border-radius:4px;white-space:nowrap">🆕 未処理</span>';
  }

  const accountBadge = hasAccount
    ? '<span style="font-size:10px;font-weight:700;color:var(--blue);background:rgba(37,99,235,.1);padding:3px 9px;border-radius:4px;white-space:nowrap">🔗 アカウント紐付済</span>'
    : '<span style="font-size:10px;font-weight:700;color:var(--warn);background:rgba(243,156,18,.12);padding:3px 9px;border-radius:4px;white-space:nowrap">⚠ 未紐付</span>';

  const borderColor = isDeleted ? 'var(--ink3)' : isRead ? 'var(--border)' : 'var(--accent2)';

  // アクションボタン
  let actions = '';
  if (isDeleted) {
    actions = `
      <button class="mini-btn" onclick="restoreFormSubmission('${escHtml(s.id)}')">↩ 復元</button>
    `;
  } else {
    actions = `
      <button class="mini-btn" onclick="openFormSubmissionDetail('${escHtml(s.id)}')">📄 詳細を見る</button>
      ${!hasAccount
        ? `<button class="mini-btn" style="color:var(--blue);border-color:var(--blue)" onclick="approveAndCreateAccount('${escHtml(s.id)}')">✅ アカウント作成</button>
           <button class="mini-btn" style="color:var(--accent2);border-color:var(--accent2)" onclick="linkSubmissionToExistingUser('${escHtml(s.id)}')">🔗 既存アカウントに紐づける</button>`
        : `<button class="mini-btn" onclick="openMemberFromSubmission('${escHtml(s.uid)}')">👤 メンバー管理へ</button>`
      }
      ${!isRead
        ? `<button class="mini-btn" style="color:var(--accent2);border-color:var(--accent2)" onclick="markFormSubmissionRead2('${escHtml(s.id)}')">✅ 処理済みにする</button>`
        : `<button class="mini-btn" onclick="markFormSubmissionUnread('${escHtml(s.id)}')">↺ 未処理に戻す</button>`
      }
      <button class="mini-btn" style="color:var(--accent);border-color:var(--accent)" onclick="softDeleteFormSubmission('${escHtml(s.id)}')">🗑 削除</button>
    `;
  }

  return `<div class="alert-card" style="border-left:3px solid ${borderColor};${isDeleted?'opacity:.6;':''}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;gap:8px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span style="font-size:20px">📋</span>
        <div>
          <div style="font-size:14px;font-weight:700">${escHtml(memberName)}</div>
          <div style="font-size:11px;color:var(--ink3);margin-top:3px">提出日時: ${escHtml(submittedDate)}</div>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        ${statusBadge}
        ${accountBadge}
      </div>
    </div>
    ${fd.fullName ? `
    <div style="font-size:12px;color:var(--ink2);background:var(--surface2);padding:10px 12px;border-radius:6px;line-height:1.9;margin-bottom:12px">
      <div><strong>氏名：</strong>${escHtml(fd.fullName)}（${escHtml(fd.fullNameKana||'—')}）</div>
      <div><strong>メール：</strong>${escHtml(fd.email||'—')}　<strong>電話：</strong>${escHtml(fd.phone||'—')}</div>
    </div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${actions}
    </div>
  </div>`;
}

// ── フィルタ切替 ───────────────────────────────────────────

export function filterFormSubmissions(filter, btn) {
  _currentFilter = filter;
  // タブアクティブ切替
  document.querySelectorAll('.form-sub-tab').forEach(b => {
    const active = b.dataset.filter === filter;
    b.classList.toggle('active', active);
    b.style.borderBottomColor = active ? 'var(--ink)' : 'transparent';
    b.style.fontWeight = active ? '700' : '600';
    b.style.color = active ? 'var(--ink)' : 'var(--ink3)';
  });
  renderFormSubmissionsPage();
}

// ── 詳細モーダル ───────────────────────────────────────────

export async function openFormSubmissionDetail(submissionId) {
  const s = _cachedSubmissions.find(x => x.id === submissionId);
  if (!s) { alert('データが見つかりません'); return; }
  const fd = s.formData || {};
  const memberName = RC._cachedMembers?.find(m => m.id === s.uid)?.name || fd.fullName || s.name || '—';

  // 詳細を開いたら既読扱いにする（処理済ではない）
  if (!s.readAt) {
    // 軽い既読マーク: lastViewedAt を入れておくが readAt は「処理済み」用にとっておく
    try {
      await updateDoc(doc(db, 'form_submissions', submissionId), { lastViewedAt: new Date().toISOString() });
      s.lastViewedAt = new Date().toISOString();
    } catch(e) { /* 黙殺 */ }
  }

  document.getElementById('modal-title-text').textContent = `📋 入社フォーム詳細 — ${memberName}`;
  document.getElementById('modal-body').innerHTML = `
    <div style="font-size:11px;color:var(--ink3);margin-bottom:14px">提出日時: ${escHtml(s.submittedAt ? s.submittedAt.slice(0,16).replace('T',' ') : '—')}</div>

    ${fd.fullName ? `
    <div style="background:var(--surface2);border-radius:10px;padding:14px 16px;font-size:12px;line-height:2;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">基本情報</div>
      <div><strong>氏名：</strong>${escHtml(fd.fullName)}（${escHtml(fd.fullNameKana||'—')}）</div>
      <div><strong>生年月日：</strong>${escHtml(fd.birthDate||'—')}</div>
      <div><strong>住所：</strong>${escHtml(fd.address||'—')}</div>
      <div><strong>電話：</strong>${escHtml(fd.phone||'—')}</div>
      <div><strong>メール：</strong>${escHtml(fd.email||'—')}</div>
      <div id="my-number-row" data-submission-id="${escHtml(submissionId)}" style="transition:background-color 0.3s ease;border-radius:6px;padding:2px 6px;margin:-2px -6px;">
        <strong>マイナンバー：</strong>
        <span id="my-number-display">${fd.myNumber ? '****' + escHtml(fd.myNumber.slice(-4)) : '—'}</span>
        ${fd.myNumber && isAdmin() ? `
          <button id="my-number-toggle-btn" type="button" onclick="toggleMyNumber('${escHtml(submissionId)}', this)" data-full="${escHtml(fd.myNumber)}" data-name="${escHtml(fd.fullName || memberName)}" style="margin-left:8px;padding:2px 10px;font-size:11px;border:1px solid var(--ink3);border-radius:4px;background:var(--surface);color:var(--ink);cursor:pointer;vertical-align:middle;transition:all 0.2s ease;">
            👁 表示
          </button>
          <button id="my-number-copy-btn" type="button" onclick="copyMyNumber('${escHtml(submissionId)}')" style="display:none;margin-left:4px;padding:2px 10px;font-size:11px;border:1px solid var(--ink3);border-radius:4px;background:var(--surface);color:var(--ink);cursor:pointer;vertical-align:middle;transition:all 0.2s ease;">
            📋 コピー
          </button>
          <span id="my-number-countdown" style="display:none;margin-left:6px;font-size:10px;color:#b45309;vertical-align:middle;"></span>
        ` : ''}
      </div>
    </div>

    <div style="background:var(--surface2);border-radius:10px;padding:14px 16px;font-size:12px;line-height:2;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">緊急連絡先・身元保証人</div>
      <div><strong>緊急連絡先：</strong>${escHtml(fd.emergencyName||'—')}（${escHtml(fd.emergencyRelation||'—')}） ${escHtml(fd.emergencyPhone||'')}</div>
      <div><strong>身元保証人：</strong>${escHtml(fd.guarantorName||'—')}（${escHtml(fd.guarantorRelation||'—')}）</div>
      <div><strong>保証人連絡先：</strong>${escHtml(fd.guarantorPhone||'—')}</div>
      <div><strong>保証人住所：</strong>${escHtml(fd.guarantorAddress||'—')}</div>
    </div>

    <div style="background:var(--surface2);border-radius:10px;padding:14px 16px;font-size:12px;line-height:2;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">銀行口座</div>
      <div><strong>銀行：</strong>${escHtml(fd.bankName||'—')} ${escHtml(fd.bankBranch||'')}</div>
      <div><strong>種別：</strong>${escHtml(fd.bankType||'—')}　<strong>口座番号：</strong>${escHtml(fd.bankNumber||'—')}</div>
      <div><strong>口座名義：</strong>${escHtml(fd.bankHolder||'—')}</div>
    </div>

    <div style="background:var(--surface2);border-radius:10px;padding:14px 16px;font-size:12px;line-height:2;margin-bottom:14px">
      <div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">その他</div>
      <div><strong>前職：</strong>${escHtml(fd.prevCompany||'なし')}</div>
      <div><strong>誓約書署名：</strong>${escHtml(fd.pledgeSignature||'—')}（${escHtml(fd.pledgeDate||'—')}）</div>
    </div>
    ` : '<div style="padding:20px;text-align:center;color:var(--ink3)">フォームデータがありません</div>'}

    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">閉じる</button>
      ${!s.uid || s.pending
        ? `<button class="btn btn-primary" onclick="closeModal();approveAndCreateAccount('${escHtml(submissionId)}')">✅ アカウント作成</button>`
        : `<button class="btn btn-primary" onclick="closeModal();openMemberFromSubmission('${escHtml(s.uid)}')">👤 メンバー管理へ</button>`
      }
    </div>`;
  openModal();
}

// ── メンバー管理ページへ遷移 ────────────────────────────────

export function openMemberFromSubmission(uid) {
  if (window.innerWidth <= 767) {
    const navItem = document.querySelector('.mnav-item[onclick*="onboarding"]');
    window.switchMobile?.('onboarding', navItem);
    setTimeout(() => window.openOnboardingModal?.(uid), 120);
  } else {
    window.switchTab?.('onboarding');
    setTimeout(() => window.openOnboardingModal?.(uid), 120);
  }
}

// ── 処理済みマーク / 未処理に戻す ────────────────────────────

export async function markFormSubmissionRead2(submissionId) {
  await updateDoc(doc(db, 'form_submissions', submissionId), {
    readAt: new Date().toISOString(),
    readBy: RC.currentUserData?.name || '',
  });
  const s = _cachedSubmissions.find(x => x.id === submissionId);
  if (s) { s.readAt = new Date().toISOString(); s.readBy = RC.currentUserData?.name || ''; }
  renderFormSubmissionsPage();
  updateFormSubmissionsBadge();
  window.updateReportBadge?.();
}

export async function markFormSubmissionUnread(submissionId) {
  if (!confirm('このフォーム提出を未処理に戻しますか？')) return;
  await updateDoc(doc(db, 'form_submissions', submissionId), { readAt: null });
  const s = _cachedSubmissions.find(x => x.id === submissionId);
  if (s) { s.readAt = null; }
  renderFormSubmissionsPage();
  updateFormSubmissionsBadge();
  window.updateReportBadge?.();
}

// ── 論理削除 / 復元 ───────────────────────────────────────

export async function softDeleteFormSubmission(submissionId) {
  if (!confirm('このフォーム提出を削除しますか？\n（論理削除なので「削除済み」フィルタから復元できます）')) return;
  await updateDoc(doc(db, 'form_submissions', submissionId), {
    deletedAt: new Date().toISOString(),
    deletedBy: RC.currentUserData?.name || '',
  });
  const s = _cachedSubmissions.find(x => x.id === submissionId);
  if (s) { s.deletedAt = new Date().toISOString(); s.deletedBy = RC.currentUserData?.name || ''; }
  renderFormSubmissionsPage();
  updateFormSubmissionsBadge();
}

export async function restoreFormSubmission(submissionId) {
  if (!confirm('このフォーム提出を復元しますか？')) return;
  await updateDoc(doc(db, 'form_submissions', submissionId), { deletedAt: null, deletedBy: null });
  const s = _cachedSubmissions.find(x => x.id === submissionId);
  if (s) { s.deletedAt = null; s.deletedBy = null; }
  renderFormSubmissionsPage();
  updateFormSubmissionsBadge();
}

// ── マイナンバー表示切替（管理者専用・アクセスログ記録） ─────

/**
 * マイナンバーの表示/非表示を切り替える
 * - 表示時にFirestoreにアクセスログを書き込む
 * - 30秒経過で自動的にマスクに戻る
 * - 管理者以外はそもそもボタンが表示されない前提だが念のためチェック
 */
export async function toggleMyNumber(submissionId, btnEl) {
  if (!isAdmin()) { alert('権限がありません'); return; }
  const row       = document.getElementById('my-number-row');
  const display   = document.getElementById('my-number-display');
  const copyBtn   = document.getElementById('my-number-copy-btn');
  const countdown = document.getElementById('my-number-countdown');
  if (!row || !display || !btnEl) return;

  const fullNumber = btnEl.dataset.full;
  const targetName = btnEl.dataset.name;
  if (!fullNumber) return;

  const isRevealed = btnEl.dataset.revealed === '1';

  if (isRevealed) {
    // 非表示に戻す
    maskMyNumber(submissionId);
    return;
  }

  // 表示する
  display.textContent = fullNumber;
  btnEl.textContent = '👁‍🗨 隠す';
  btnEl.dataset.revealed = '1';
  row.style.backgroundColor = '#fef9c3'; // 薄い黄色（警告）
  if (copyBtn) copyBtn.style.display = 'inline-block';
  if (countdown) countdown.style.display = 'inline';

  // アクセスログ記録（非同期・失敗しても止めない）
  logMyNumberAccess(submissionId, 'view', targetName).catch(e => {
    console.error('[myNumber] ログ記録失敗:', e);
  });

  // 30秒カウントダウン
  const start = Date.now();
  clearMyNumberTimers(submissionId);
  const countdownInterval = setInterval(() => {
    const remaining = Math.max(0, 30 - Math.floor((Date.now() - start) / 1000));
    if (countdown) countdown.textContent = `あと${remaining}秒で自動非表示`;
    if (remaining <= 0) clearInterval(countdownInterval);
  }, 500);
  const timeoutId = setTimeout(() => maskMyNumber(submissionId), 30_000);
  _myNumberTimers.set(submissionId, { timeoutId, countdownInterval });
}

/**
 * マイナンバーをマスク表示に戻す
 */
function maskMyNumber(submissionId) {
  const row       = document.getElementById('my-number-row');
  const display   = document.getElementById('my-number-display');
  const btnEl     = document.getElementById('my-number-toggle-btn');
  const copyBtn   = document.getElementById('my-number-copy-btn');
  const countdown = document.getElementById('my-number-countdown');

  if (btnEl && btnEl.dataset.full) {
    const full = btnEl.dataset.full;
    if (display) display.textContent = '****' + full.slice(-4);
    btnEl.textContent = '👁 表示';
    btnEl.dataset.revealed = '0';
  }
  if (row) row.style.backgroundColor = '';
  if (copyBtn) copyBtn.style.display = 'none';
  if (countdown) { countdown.style.display = 'none'; countdown.textContent = ''; }
  clearMyNumberTimers(submissionId);
}

function clearMyNumberTimers(submissionId) {
  const t = _myNumberTimers.get(submissionId);
  if (t) {
    if (t.timeoutId) clearTimeout(t.timeoutId);
    if (t.countdownInterval) clearInterval(t.countdownInterval);
    _myNumberTimers.delete(submissionId);
  }
}

/**
 * マイナンバーをクリップボードにコピー（コピー操作もログ記録）
 */
export async function copyMyNumber(submissionId) {
  if (!isAdmin()) { alert('権限がありません'); return; }
  const btnEl = document.getElementById('my-number-toggle-btn');
  if (!btnEl || btnEl.dataset.revealed !== '1') { alert('先に「表示」ボタンでマイナンバーを表示してください'); return; }
  const fullNumber = btnEl.dataset.full;
  const targetName = btnEl.dataset.name;
  if (!fullNumber) return;

  try {
    await navigator.clipboard.writeText(fullNumber);
    showMyNumberToast('マイナンバーをコピーしました');
    logMyNumberAccess(submissionId, 'copy', targetName).catch(e => {
      console.error('[myNumber] ログ記録失敗:', e);
    });
  } catch (e) {
    console.error('[myNumber] コピー失敗:', e);
    alert('コピーに失敗しました');
  }
}

function showMyNumberToast(msg) {
  const toast = document.createElement('div');
  toast.textContent = msg;
  toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(20px);background:#1f2937;color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.2);opacity:0;transition:all 0.3s ease;';
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

/**
 * マイナンバーのアクセスログをFirestoreに記録（監査用）
 * コレクション: myNumberAccessLogs
 */
async function logMyNumberAccess(submissionId, action, targetName) {
  const user = auth?.currentUser;
  if (!user) return;
  await addDoc(collection(db, 'myNumberAccessLogs'), {
    accessedBy: user.uid,
    accessedByEmail: user.email || '',
    accessedByName: RC.currentUserData?.name || '',
    targetSubmissionId: submissionId,
    targetName: targetName || '',
    action: action, // 'view' | 'copy'
    accessedAt: serverTimestamp(),
    userAgent: navigator.userAgent || '',
  });
}

// モーダルを閉じるタイミングでマイナンバーを必ずマスクに戻すため、
// 既存の closeModal をラップしておく
const _origCloseModal = window.closeModal;
window.closeModal = function(...args) {
  // 現在表示中のマイナンバーがあれば即マスク
  const row = document.getElementById('my-number-row');
  if (row) {
    const subId = row.dataset.submissionId;
    if (subId) maskMyNumber(subId);
  }
  if (typeof _origCloseModal === 'function') return _origCloseModal.apply(this, args);
};

// ── window exports ────────────────────────────────────────
window.loadFormSubmissions        = loadFormSubmissions;
window.filterFormSubmissions      = filterFormSubmissions;
window.openFormSubmissionDetail   = openFormSubmissionDetail;
window.openMemberFromSubmission   = openMemberFromSubmission;
window.markFormSubmissionRead2    = markFormSubmissionRead2;
window.markFormSubmissionUnread   = markFormSubmissionUnread;
window.softDeleteFormSubmission   = softDeleteFormSubmission;
window.restoreFormSubmission      = restoreFormSubmission;
window.updateFormSubmissionsBadge = updateFormSubmissionsBadge;
window.toggleMyNumber             = toggleMyNumber;
window.copyMyNumber               = copyMyNumber;
