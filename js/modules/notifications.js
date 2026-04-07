// ============================================================
// Notifications (通知設定) module
// ============================================================
import { isAdmin } from '../state.js';
import { db, doc, getDoc, setDoc } from '../firebase.js';

const SETTINGS_DOC = 'settings/notifications';

export async function loadNotificationSettings() {
  if (!isAdmin()) return;
  const snap = await getDoc(doc(db, SETTINGS_DOC));
  const s = snap.data() || {};
  _fill(s);
}

function _fill(s) {
  const enabledEl = document.getElementById('notif-enabled');
  if (enabledEl) enabledEl.checked = s.enabled ?? false;
  _updateToggleLabel(s.enabled ?? false);

  const gmailUserEl = document.getElementById('notif-gmail-user');
  if (gmailUserEl) gmailUserEl.value = s.gmailUser ?? '';

  const gmailPassEl = document.getElementById('notif-gmail-pass');
  if (gmailPassEl) gmailPassEl.value = s.gmailPass ?? '';
}

function _updateToggleLabel(enabled) {
  const lbl = document.getElementById('notif-enabled-label');
  if (!lbl) return;
  lbl.textContent = enabled ? '有効' : '無効';
  lbl.style.color = enabled ? 'var(--accent2)' : 'var(--ink3)';
}

export async function saveNotificationSettings() {
  if (!isAdmin()) return;
  const enabled   = document.getElementById('notif-enabled')?.checked ?? false;
  const gmailUser = document.getElementById('notif-gmail-user')?.value?.trim() || '';
  const gmailPass = document.getElementById('notif-gmail-pass')?.value?.trim() || '';

  const btn = document.getElementById('notif-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = '保存中...'; }

  try {
    await setDoc(doc(db, SETTINGS_DOC), { enabled, gmailUser, gmailPass }, { merge: true });
    _updateToggleLabel(enabled);
    showNotifToast('設定を保存しました ✅');
  } catch (e) {
    console.error(e);
    showNotifToast('保存に失敗しました ❌', true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '💾 設定を保存'; }
  }
}

function showNotifToast(msg, isError = false) {
  const t = document.createElement('div');
  t.textContent = msg;
  Object.assign(t.style, {
    position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
    background: isError ? '#c8472a' : '#3a7d5a', color: '#fff',
    padding: '10px 20px', borderRadius: '8px', fontSize: '13px',
    fontWeight: '600', zIndex: '9999', pointerEvents: 'none',
    boxShadow: '0 4px 16px rgba(0,0,0,.18)', transition: 'opacity .3s'
  });
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2500);
}

window.loadNotificationSettings = loadNotificationSettings;
window.saveNotificationSettings = saveNotificationSettings;
