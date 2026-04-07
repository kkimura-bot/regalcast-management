// ============================================================
// Fare template helpers (my page commute settings)
// ============================================================
import { RC } from '../state.js';
import { db, doc, getDoc, updateDoc, serverTimestamp } from '../firebase.js';
import { escHtml } from './helpers.js';

// In-memory state (module-level)
let _fareTemplates    = [];
let _euFareTemplates  = [];

// ── My-page fare templates ─────────────────────────────────

export function renderFareTemplates() {
  const container = document.getElementById('mypage-fare-templates');
  if (!container) return;

  container.innerHTML = _fareTemplates.map((tmpl, ti) => `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <input class="form-input" placeholder="店舗名（例：渋谷店）"
          value="${escHtml(tmpl.shopName)}"
          oninput="_fareTemplates[${ti}].shopName=this.value"
          style="flex:1;font-size:13px;padding:8px;font-weight:700">
        <button onclick="removeFareTemplate(${ti})" style="background:none;border:none;color:var(--accent);font-size:18px;cursor:pointer;padding:4px">🗑</button>
      </div>
      ${tmpl.items.map((item, ii) => `
        <div style="margin-bottom:8px;padding:9px 10px;background:${item.isCommuter?'rgba(58,125,90,.06)':'var(--surface2)'};border-radius:6px;border:1px solid ${item.isCommuter?'rgba(58,125,90,.25)':'transparent'}">
          <div style="display:grid;grid-template-columns:1fr auto 1fr auto;gap:5px;align-items:center;margin-bottom:6px">
            <input class="form-input" placeholder="乗車駅"
              value="${escHtml(item.from||'')}"
              oninput="_fareTemplates[${ti}].items[${ii}].from=this.value"
              style="font-size:12px;padding:7px">
            <span style="color:var(--ink3);font-size:13px;padding:0 2px">→</span>
            <input class="form-input" placeholder="降車駅"
              value="${escHtml(item.to||'')}"
              oninput="_fareTemplates[${ti}].items[${ii}].to=this.value"
              style="font-size:12px;padding:7px">
            <button onclick="removeFareItem(${ti},${ii})" style="background:none;border:none;color:var(--ink3);font-size:14px;cursor:pointer;padding:2px">✕</button>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:5px">
              <span style="font-size:11px;color:var(--ink3)">💴</span>
              <input type="number" class="form-input" placeholder="0" min="0"
                value="${item.amount||''}"
                oninput="_fareTemplates[${ti}].items[${ii}].amount=parseInt(this.value)||0"
                style="width:80px;font-size:12px;padding:7px;${item.isCommuter?'opacity:.45;':''}">
              <span style="font-size:11px;color:var(--ink3)">円</span>
            </div>
            <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px;color:${item.isCommuter?'var(--accent2)':'var(--ink3)'}">
              <input type="checkbox" ${item.isCommuter?'checked':''}
                onchange="_fareTemplates[${ti}].items[${ii}].isCommuter=this.checked;renderFareTemplates()"
                style="width:14px;height:14px;accent-color:var(--accent2)">
              🎫 定期区間
            </label>
          </div>
          ${item.isCommuter ? `<div style="font-size:10px;color:var(--accent2);margin-top:4px">✓ 出勤時に自動で¥0になります</div>` : ''}
        </div>
      `).join('')}
      <button class="mini-btn" onclick="addFareItem(${ti})" style="font-size:11px;padding:5px 10px;margin-top:4px">＋ 区間を追加</button>
    </div>
  `).join('');
}

export function addFareTemplate() {
  _fareTemplates.push({ shopName: '', items: [
    { from: '', to: '', amount: '', isCommuter: false },
    { from: '', to: '', amount: '', isCommuter: false }
  ]});
  renderFareTemplates();
}

export function removeFareTemplate(ti) {
  _fareTemplates.splice(ti, 1);
  renderFareTemplates();
}

export function addFareItem(ti) {
  _fareTemplates[ti].items.push({ from: '', to: '', amount: '', isCommuter: false });
  renderFareTemplates();
}

export function removeFareItem(ti, ii) {
  _fareTemplates[ti].items.splice(ii, 1);
  renderFareTemplates();
}

// ── Admin user-edit fare templates ────────────────────────

export function euRenderFareTemplates() {
  const container = document.getElementById('eu-fare-templates');
  if (!container) return;
  container.innerHTML = _euFareTemplates.map((tmpl, ti) => `
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
        <input class="form-input" placeholder="店舗名（例：渋谷店）"
          value="${escHtml(tmpl.shopName||'')}"
          oninput="_euFareTemplates[${ti}].shopName=this.value"
          style="flex:1;font-size:12px;padding:7px;font-weight:700">
        <button onclick="_euRemoveTemplate(${ti})" style="background:none;border:none;color:var(--accent);font-size:16px;cursor:pointer">🗑</button>
      </div>
      ${(tmpl.items||[]).map((item, ii) => `
        <div style="margin-bottom:6px;padding:7px 8px;background:${item.isCommuter?'rgba(58,125,90,.07)':'var(--surface)'};border-radius:6px;border:1px solid ${item.isCommuter?'rgba(58,125,90,.2)':'transparent'}">
          <div style="display:grid;grid-template-columns:1fr auto 1fr auto;gap:4px;align-items:center;margin-bottom:5px">
            <input class="form-input" placeholder="乗車駅"
              value="${escHtml(item.from||'')}"
              oninput="_euFareTemplates[${ti}].items[${ii}].from=this.value"
              style="font-size:11px;padding:6px">
            <span style="color:var(--ink3);font-size:12px;padding:0 2px">→</span>
            <input class="form-input" placeholder="降車駅"
              value="${escHtml(item.to||'')}"
              oninput="_euFareTemplates[${ti}].items[${ii}].to=this.value"
              style="font-size:11px;padding:6px">
            <button onclick="_euRemoveItem(${ti},${ii})" style="background:none;border:none;color:var(--ink3);font-size:13px;cursor:pointer">✕</button>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div style="display:flex;align-items:center;gap:4px">
              <span style="font-size:11px;color:var(--ink3)">💴</span>
              <input type="number" class="form-input" placeholder="0" min="0"
                value="${item.amount||''}"
                oninput="_euFareTemplates[${ti}].items[${ii}].amount=parseInt(this.value)||0"
                style="width:75px;font-size:11px;padding:6px;${item.isCommuter?'opacity:.45;':''}">
              <span style="font-size:11px;color:var(--ink3)">円</span>
            </div>
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;color:${item.isCommuter?'var(--accent2)':'var(--ink3)'}">
              <input type="checkbox" ${item.isCommuter?'checked':''}
                onchange="_euFareTemplates[${ti}].items[${ii}].isCommuter=this.checked;euRenderFareTemplates()"
                style="width:13px;height:13px;accent-color:var(--accent2)">
              🎫 定期区間
            </label>
          </div>
        </div>
      `).join('')}
      <button class="mini-btn" onclick="_euAddItem(${ti})" style="font-size:11px;padding:4px 8px;margin-top:2px">＋ 区間を追加</button>
    </div>
  `).join('') || '<div style="font-size:11px;color:var(--ink3);padding:6px 0">テンプレなし</div>';
}

export function euAddFareTemplate() {
  _euFareTemplates.push({ shopName: '', items: [
    { from: '', to: '', amount: '', isCommuter: false },
    { from: '', to: '', amount: '', isCommuter: false }
  ]});
  euRenderFareTemplates();
}

// ── Load / Save my-page ───────────────────────────────────

export async function loadMyPage() {
  const infoEl = document.getElementById('mypage-profile-info');
  if (infoEl && RC.currentUserData) {
    infoEl.innerHTML = `
      <div>👤 <strong>${RC.currentUserData.name || '—'}</strong></div>
      <div>🏢 ${RC.currentUserData.dept || '—'}</div>
      <div>🔑 ${RC.currentUserData.role || '—'}</div>
    `;
  }

  try {
    const userSnap = await getDoc(doc(db, 'users', RC.currentUser.uid));
    const data = userSnap.exists() ? userSnap.data() : {};

    const stEl = document.getElementById('mypage-nearest-station');
    if (stEl) stEl.value = data.nearestStation || '';

    _fareTemplates = data.fareTemplates ? JSON.parse(JSON.stringify(data.fareTemplates)) : [];
    if (_fareTemplates.length === 0) {
      _fareTemplates = [{ shopName: '', items: [
        { from: '', to: '', amount: '', isCommuter: false },
        { from: '', to: '', amount: '', isCommuter: false }
      ]}];
    }
  } catch(e) {
    _fareTemplates = [{ shopName: '', items: [
      { from: '', to: '', amount: '', isCommuter: false },
      { from: '', to: '', amount: '', isCommuter: false }
    ]}];
  }

  // Keep window reference in sync so oninput handlers can access the array
  window._fareTemplates = _fareTemplates;
  renderFareTemplates();

  // 管理者からの面談依頼を読み込む（メンバー・リーダー向け）
  window.loadMeetingRequestsForMember?.();
}

export async function saveMyPage() {
  const nearestStation = document.getElementById('mypage-nearest-station')?.value.trim() || '';

  const templatesClean = _fareTemplates
    .filter(t => t.shopName.trim())
    .map(t => ({
      shopName: t.shopName.trim(),
      items: t.items.filter(i => i.from || i.to || i.amount).map(i => ({
        from: (i.from || '').trim(),
        to:   (i.to   || '').trim(),
        amount: parseInt(i.amount) || 0,
        isCommuter: !!i.isCommuter
      }))
    }));

  try {
    await updateDoc(doc(db, 'users', RC.currentUser.uid), {
      nearestStation,
      fareTemplates: templatesClean
    });
    RC.currentUserData.nearestStation = nearestStation;
    RC.currentUserData.fareTemplates  = templatesClean;
    alert('✅ 通勤設定を保存しました！');
  } catch(e) {
    alert('保存に失敗しました: ' + e.message);
  }
}

// ── Expose to window (for inline onclick) ─────────────────
window.renderFareTemplates  = renderFareTemplates;
window.addFareTemplate      = addFareTemplate;
window.removeFareTemplate   = removeFareTemplate;
window.addFareItem          = addFareItem;
window.removeFareItem       = removeFareItem;
window.euRenderFareTemplates = euRenderFareTemplates;
window.euAddFareTemplate    = euAddFareTemplate;
window._euRemoveTemplate    = (ti) => { _euFareTemplates.splice(ti,1); euRenderFareTemplates(); };
window._euAddItem           = (ti) => { _euFareTemplates[ti].items.push({ from:'', to:'', amount:'', isCommuter:false }); euRenderFareTemplates(); };
window._euRemoveItem        = (ti, ii) => { _euFareTemplates[ti].items.splice(ii,1); euRenderFareTemplates(); };
window.loadMyPage           = loadMyPage;
window.saveMyPage           = saveMyPage;

// Also expose the mutable arrays so oninput handlers can reach them
window._fareTemplates   = _fareTemplates;
window._euFareTemplates = _euFareTemplates;

// Setter called from users.js to update the module-level _euFareTemplates
window.setEuFareTemplates = (arr) => {
  _euFareTemplates = arr;
  window._euFareTemplates = _euFareTemplates;
};
