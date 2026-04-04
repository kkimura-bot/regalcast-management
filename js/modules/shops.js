// ============================================================
// Shops module
// ============================================================
import { RC, isAdmin } from '../state.js';
import {
  db, collection, doc, setDoc, addDoc, getDoc, getDocs,
  updateDoc, deleteDoc, query, orderBy, serverTimestamp, writeBatch
} from '../firebase.js';
import { openModal, closeModal } from '../utils/modal.js';
import { escHtml } from '../utils/helpers.js';

let _cachedShops = [];

export async function loadShops() {
  const snap = await getDocs(query(collection(db,'shops'), orderBy('name')));
  _cachedShops = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderShopsTable();
}

function renderShopsTable() {
  const tbody = document.getElementById('shops-table-body');
  if (!tbody) return;
  if (!_cachedShops.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">店舗が登録されていません</td></tr>'; return;
  }
  tbody.innerHTML = _cachedShops.map(s => `<tr>
    <td style="text-align:center">
      <input type="checkbox" class="shop-check" value="${s.id}" style="width:15px;height:15px;cursor:pointer;accent-color:var(--accent)"
        onchange="updateShopsDeleteBtn()">
    </td>
    <td style="font-weight:600">${escHtml(s.name||'—')}</td>
    <td style="font-size:12px;font-family:'DM Mono',monospace">${s.defaultStart||'—'}</td>
    <td style="font-size:12px;font-family:'DM Mono',monospace">${s.defaultEnd||'—'}</td>
    <td>
      <button class="mini-btn" onclick="openEditShopModal('${s.id}')">編集</button>
      <button class="mini-btn" style="color:var(--accent)" onclick="confirmDeleteShop('${s.id}')">削除</button>
    </td>
  </tr>`).join('');
}

export function toggleAllShopChecks(checked) {
  document.querySelectorAll('.shop-check').forEach(c => c.checked = checked);
  updateShopsDeleteBtn();
}

export function updateShopsDeleteBtn() {
  const checked = document.querySelectorAll('.shop-check:checked');
  const btn = document.getElementById('shops-delete-btn');
  if (btn) btn.style.display = checked.length ? '' : 'none';
}

export async function deleteCheckedShops() {
  const ids = [...document.querySelectorAll('.shop-check:checked')].map(c => c.value);
  if (!ids.length) return;
  if (!confirm(`${ids.length}件の店舗を削除しますか？`)) return;
  const batch = writeBatch(db);
  ids.forEach(id => batch.delete(doc(db,'shops',id)));
  await batch.commit();
  loadShops();
}

export function openAddShopModal() {
  document.getElementById('modal-title-text').textContent = '＋ 店舗を追加';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row"><label class="form-label">店舗名 <span style="color:var(--accent)">*</span></label>
      <input class="form-input" id="shop-name" placeholder="例：渋谷店"></div>
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">デフォルト出勤</label>
        <input type="time" class="form-input" id="shop-start" value="09:00"></div>
      <div class="form-row"><label class="form-label">デフォルト退勤</label>
        <input type="time" class="form-input" id="shop-end" value="18:00"></div>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="saveShop(null)">追加する</button>
    </div>`;
  openModal();
}

export function openEditShopModal(id) {
  const s = _cachedShops.find(x => x.id === id);
  if (!s) return;
  document.getElementById('modal-title-text').textContent = '店舗を編集';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row"><label class="form-label">店舗名</label>
      <input class="form-input" id="shop-name" value="${escHtml(s.name||'')}"></div>
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">デフォルト出勤</label>
        <input type="time" class="form-input" id="shop-start" value="${s.defaultStart||'09:00'}"></div>
      <div class="form-row"><label class="form-label">デフォルト退勤</label>
        <input type="time" class="form-input" id="shop-end" value="${s.defaultEnd||'18:00'}"></div>
    </div>
    <div class="btn-row">
      <button class="btn" style="background:#fee2e2;color:var(--accent);border:none" onclick="confirmDeleteShop('${id}')">削除</button>
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="saveShop('${id}')">保存</button>
    </div>`;
  openModal();
}

export async function saveShop(id) {
  const name  = document.getElementById('shop-name').value.trim();
  const start = document.getElementById('shop-start').value;
  const end   = document.getElementById('shop-end').value;
  if (!name) { alert('店舗名を入力してください'); return; }
  const data = { name, defaultStart: start, defaultEnd: end };
  if (id) {
    await updateDoc(doc(db,'shops',id), data);
  } else {
    await addDoc(collection(db,'shops'), { ...data, createdAt: serverTimestamp() });
  }
  closeModal();
  loadShops();
}

export function confirmDeleteShop(id) {
  const s = _cachedShops.find(x => x.id === id);
  if (!confirm(`「${s?.name||id}」を削除しますか？`)) return;
  deleteDoc(doc(db,'shops',id)).then(() => loadShops());
}

window.loadShops            = loadShops;
window.toggleAllShopChecks  = toggleAllShopChecks;
window.updateShopsDeleteBtn = updateShopsDeleteBtn;
window.deleteCheckedShops   = deleteCheckedShops;
window.openAddShopModal     = openAddShopModal;
window.openEditShopModal    = openEditShopModal;
window.saveShop             = saveShop;
window.confirmDeleteShop    = confirmDeleteShop;
