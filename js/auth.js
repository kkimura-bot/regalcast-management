// ============================================================
// Authentication (Firebase Auth + Alliance mode)
// ============================================================
import { RC, isAdmin, isLeaderOrAbove } from './state.js';
import {
  auth, db,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  collection, doc, getDoc, getDocs,
  query, where, orderBy, serverTimestamp, addDoc, updateDoc
} from './firebase.js';
import { depts_options, sortMembersByOrder } from './data/constants.js';

// ── Standard Firebase Auth login ──────────────────────────

export async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  const btn   = document.getElementById('login-btn');

  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'ログイン中...';

  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch(e) {
    errEl.textContent = 'メールアドレスまたはパスワードが正しくありません';
    btn.disabled = false;
    btn.textContent = 'ログイン';
  }
}

export async function doLogout() {
  await signOut(auth);
  RC.currentUser     = null;
  RC.currentRole     = null;
  RC.currentUserData = null;
  showLogin();
}

export async function doResetPassword() {
  const email = document.getElementById('login-email').value.trim();
  if (!email) { alert('メールアドレスを入力してください'); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    alert('パスワードリセットメールを送信しました');
  } catch(e) {
    alert('送信に失敗しました: ' + e.message);
  }
}

// ── onAuthStateChanged listener ───────────────────────────

export function initAuthListener() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      showLogin();
      return;
    }
    RC.currentUser = user;
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    if (!userSnap.exists()) {
      alert('ユーザー情報が見つかりません');
      await signOut(auth);
      return;
    }
    RC.currentUserData = { id: user.uid, ...userSnap.data() };
    RC.currentRole     = RC.currentUserData.role || 'member';

    // Load member cache
    const membersSnap = await getDocs(query(collection(db,'users'), orderBy('name')));
    RC._cachedMembers  = sortMembersByOrder(membersSnap.docs.map(d => ({ id: d.id, ...d.data() })));

    showApp();
    window.postLoginSetup?.();

    // Initial data loads
    window.loadDashboard?.();
    window.loadAttendanceToday?.();
    window.checkNotifications?.();
    window.autoRecordMissedClockIns?.();
  });
}

// ── Show / hide screens ───────────────────────────────────

export function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display   = 'none';
  if (document.getElementById('alliance-screen'))
    document.getElementById('alliance-screen').style.display = 'none';
  showNormalLogin();
}

export function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display   = 'flex';
  if (document.getElementById('alliance-screen'))
    document.getElementById('alliance-screen').style.display = 'none';

  // Display user info in nav
  const nameEl = document.getElementById('user-name-display');
  const roleEl = document.getElementById('user-role-display');
  if (nameEl) nameEl.textContent = RC.currentUserData?.name || '—';
  if (roleEl) roleEl.textContent = RC.currentRole || '—';

  // Setup tab visibility based on role
  setupNav();

  // 全社ガントボタン：リーダー以上のみ表示
  const ganttBtn = document.getElementById('gantt-nav-btn');
  if (ganttBtn && isLeaderOrAbove()) ganttBtn.style.display = '';
  const ganttMypage = document.getElementById('gantt-mypage-btn');
  if (ganttMypage) ganttMypage.style.display = isLeaderOrAbove() ? 'flex' : 'none';
}

export function showNormalLogin() {
  const mainBox     = document.getElementById('login-box-main');
  const allianceBox = document.getElementById('login-box-alliance');
  if (mainBox)     mainBox.style.display     = '';
  if (allianceBox) allianceBox.style.display = 'none';
}

export function setupNav() {
  const role = RC.currentRole;
  // PC tabs
  document.querySelectorAll('.tab[data-roles]').forEach(tab => {
    const roles = tab.dataset.roles ? tab.dataset.roles.split(',') : [];
    if (!roles.length || roles.includes('')) {
      tab.style.display = 'none'; return;
    }
    tab.style.display = roles.includes(role) ? '' : 'none';
  });
  // Hide tab-group if all dropdown items inside are hidden
  document.querySelectorAll('.tab-group').forEach(group => {
    const items = group.querySelectorAll('.tab[data-roles]');
    const anyVisible = Array.from(items).some(t => t.style.display !== 'none');
    group.style.display = anyVisible ? '' : 'none';
  });
  // Mobile nav items
  document.querySelectorAll('.mnav-item[data-roles]').forEach(item => {
    const roles = item.dataset.roles ? item.dataset.roles.split(',') : [];
    if (!roles.length) { item.style.display = 'none'; return; }
    item.style.display = roles.includes(role) ? '' : 'none';
  });

  // PJ管理・タスク管理タブは現在非表示（data-roles=""で制御）

  window.adjustMobileNavPadding?.();
}

// ── Alliance mode ─────────────────────────────────────────

export async function showAllianceLogin() {
  const mainBox     = document.getElementById('login-box-main');
  const allianceBox = document.getElementById('login-box-alliance');
  if (mainBox)     mainBox.style.display     = 'none';
  if (allianceBox) allianceBox.style.display = '';

  const sel = document.getElementById('alliance-name-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">読み込み中...</option>';

  try {
    // 今週の月〜日（JST）を計算
    const nowJST = new Date(new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }));
    const dow = nowJST.getDay(); // 0=日
    const monday = new Date(nowJST);
    monday.setDate(nowJST.getDate() - (dow === 0 ? 6 : dow - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const weekStart = fmt(monday);
    const weekEnd   = fmt(sunday);

    let allianceUsers = [];

    // 今週シフトがあるUIDのみ表示（フォールバックなし）
    const shiftSnap = await getDocs(query(
      collection(db, 'shifts'),
      where('date', '>=', weekStart),
      where('date', '<=', weekEnd)
    ));
    const activeUids = [...new Set(shiftSnap.docs.map(d => d.data().uid).filter(Boolean))];

    if (activeUids.length) {
      const userDocs = await Promise.all(activeUids.map(uid => getDoc(doc(db, 'users', uid))));
      allianceUsers = userDocs
        .filter(d => {
          if (!d.exists()) return false;
          const u = d.data();
          return u.isAlliance || u.noAuth || d.id.startsWith('alliance_');
        })
        .map(d => ({ id: d.id, ...d.data() }));
    }

    // 名前順でソート
    allianceUsers.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));

    if (!allianceUsers.length) {
      sel.innerHTML = '<option value="">アライアンスメンバーが登録されていません</option>';
      return;
    }

    sel.innerHTML = '<option value="">── 選択してください ──</option>';
    allianceUsers.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.name;
      opt.dataset.name = u.name;
      opt.dataset.dept = u.dept || '';
      sel.appendChild(opt);
    });
  } catch(e) {
    console.error('Alliance login error:', e);
    sel.innerHTML = '<option value="">読み込みに失敗しました</option>';
  }
}

export async function doAllianceLogin() {
  const sel  = document.getElementById('alliance-name-select');
  const errEl = document.getElementById('alliance-error');
  if (!sel || !sel.value) {
    if (errEl) errEl.textContent = 'お名前を選択してください';
    return;
  }
  const opt = sel.options[sel.selectedIndex];
  RC._isAllianceMode = true;
  RC.currentUser     = { uid: sel.value, isAlliance: true };
  RC.currentUserData = { id: sel.value, name: opt.dataset.name, dept: opt.dataset.dept, isAlliance: true };
  RC.currentRole     = 'alliance';

  showAllianceApp();
}

export function doAllianceLogout() {
  RC._isAllianceMode = false;
  RC.currentUser     = null;
  RC.currentUserData = null;
  RC.currentRole     = null;
  showLogin();
}

export function showAllianceApp() {
  document.getElementById('login-screen').style.display   = 'none';
  document.getElementById('app-screen').style.display     = 'none';
  document.getElementById('alliance-screen').style.display = 'flex';

  const nameEl = document.getElementById('alliance-user-name');
  const deptEl = document.getElementById('alliance-user-dept');
  if (nameEl) nameEl.textContent = RC.currentUserData?.name || '';
  if (deptEl) {
    deptEl.textContent = RC.currentUserData?.dept || '';
    deptEl.style.display = RC.currentUserData?.dept ? '' : 'none';
  }

  window.renderAllianceAttendance?.();
}

// ── Expose to window ──────────────────────────────────────
window.doLogin          = doLogin;
window.doLogout         = doLogout;
window.doResetPassword  = doResetPassword;
window.showLogin        = showLogin;
window.showApp          = showApp;
window.showNormalLogin  = showNormalLogin;
window.showAllianceLogin = showAllianceLogin;
window.doAllianceLogin  = doAllianceLogin;
window.doAllianceLogout = doAllianceLogout;
window.showAllianceApp  = showAllianceApp;
window.setupNav         = setupNav;
window.initAuthListener = initAuthListener;
