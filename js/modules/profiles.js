// ============================================================
// Profiles / Staff Introduction module
// ============================================================
import { RC, isAdmin, isLeaderOrAbove } from '../state.js';
import {
  db, storage,
  collection, doc, getDoc, getDocs, setDoc, updateDoc,
  query, orderBy, serverTimestamp,
  ref, uploadBytes, getDownloadURL
} from '../firebase.js';

let _cachedProfileTokens = {}; // uid → token
import { openModal, closeModal } from '../utils/modal.js';
import { escHtml } from '../utils/helpers.js';

let _cachedProfiles = {}; // uid → profile data
let _editSkills = [];      // タグ入力中のスキル一時保持
let _skillFilter = '';     // スキルフィルター中のスキル名

// ── Load ──────────────────────────────────────────────────

export async function loadProfiles() {
  const [profSnap, tokenSnap] = await Promise.all([
    getDocs(collection(db, 'profiles')),
    isAdmin() ? getDocs(collection(db, 'profile_tokens')) : Promise.resolve({ docs: [] }),
  ]);
  _cachedProfiles = {};
  profSnap.docs.forEach(d => { _cachedProfiles[d.id] = d.data(); });
  _cachedProfileTokens = {};
  tokenSnap.docs.forEach(d => { _cachedProfileTokens[d.data().uid] = d.id; });

  renderProfileCards();
}

// ── Render card grid ──────────────────────────────────────

function renderProfileCards(keyword = '') {
  const containers = ['profile-card-grid','profile-card-grid-m'].map(id => document.getElementById(id)).filter(Boolean);
  if (!containers.length) return;
  const container = containers[0];

  const members = RC._cachedMembers.filter(m => {
    if (m.isRetired) return false;
    if (m.isAlliance || m.noAuth || m.role === '委託' || m.role === 'alliance') return false;
    if (keyword && !(m.name||'').includes(keyword) && !(m.dept||'').includes(keyword)) return false;
    if (_skillFilter) {
      const skills = _cachedProfiles[m.id]?.skills || [];
      if (!skills.includes(_skillFilter)) return false;
    }
    return true;
  });

  // スキルフィルターチップを更新
  _renderSkillFilterChips();

  if (!members.length) {
    containers.forEach(c => c.innerHTML = '<div class="empty">メンバーが見つかりません</div>');
    return;
  }

  const html = members.map(m => {
    const p = _cachedProfiles[m.id] || {};
    const photo = p.photoURL
      ? `<img src="${p.photoURL}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;margin-bottom:12px;border:2px solid var(--border)">`
      : `<div style="width:80px;height:80px;border-radius:50%;background:var(--surface2);display:flex;align-items:center;justify-content:center;margin-bottom:12px;font-size:28px;border:2px solid var(--border)">👤</div>`;
    return `
    <div class="profile-card" onclick="openProfileModal('${m.id}')" style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px 16px;display:flex;flex-direction:column;align-items:center;text-align:center;cursor:pointer;transition:all .2s;box-shadow:0 1px 4px rgba(0,0,0,.06)">
      ${photo}
      <div style="font-size:14px;font-weight:700;color:var(--ink);margin-bottom:4px">${escHtml(m.name||'—')}</div>
      <div style="font-size:11px;color:var(--ink3);margin-bottom:6px">${escHtml(m.dept||'—')}</div>
      <span style="font-size:10px;font-weight:600;padding:2px 10px;border-radius:20px;background:var(--surface2);color:var(--ink3)">${escHtml(m.role==='admin'?'管理者':m.role==='leader'?'リーダー':'メンバー')}</span>
      ${p.skills?.length ? `<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:4px;justify-content:center">${p.skills.slice(0,3).map(s=>`<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:rgba(42,82,152,.08);color:var(--blue)">${escHtml(s)}</span>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
  containers.forEach(c => c.innerHTML = html);
}

// ── Skill filter chips ────────────────────────────────────

function _renderSkillFilterChips() {
  const wraps = ['profile-skill-filter','profile-skill-filter-m']
    .map(id => document.getElementById(id)).filter(Boolean);
  if (!wraps.length) return;

  // 全スキルを収集（重複除去）
  const allSkills = [...new Set(
    Object.values(_cachedProfiles).flatMap(p => p.skills || []).filter(Boolean)
  )].sort();

  const html = !allSkills.length ? null : `
    <span style="font-size:11px;color:var(--ink3);white-space:nowrap;align-self:center">スキル:</span>
    <span onclick="filterProfilesBySkill('')" style="font-size:11px;padding:3px 12px;border-radius:20px;cursor:pointer;font-weight:600;transition:all .15s;
      background:${!_skillFilter?'var(--ink)':'var(--surface2)'};color:${!_skillFilter?'#fff':'var(--ink3)'}">すべて</span>
    ${allSkills.map(s => `
      <span onclick="filterProfilesBySkill('${escHtml(s)}')" style="font-size:11px;padding:3px 12px;border-radius:20px;cursor:pointer;font-weight:600;white-space:nowrap;transition:all .15s;
        background:${_skillFilter===s?'rgba(42,82,152,.15)':'var(--surface2)'};color:${_skillFilter===s?'var(--blue)':'var(--ink3)'};
        border:1.5px solid ${_skillFilter===s?'var(--blue)':'transparent'}">
        ${escHtml(s)}
      </span>`).join('')}`;

  wraps.forEach(wrap => {
    if (!html) { wrap.style.display = 'none'; return; }
    wrap.style.display = 'flex';
    wrap.innerHTML = html;
  });
}

export function filterProfilesBySkill(skill) {
  _skillFilter = skill;
  const keyword = (document.getElementById('profile-search') || document.getElementById('profile-search-m'))?.value || '';
  renderProfileCards(keyword);
}

// ── Profile detail modal ──────────────────────────────────

export function openProfileModal(uid) {
  const m = RC._cachedMembers.find(x => x.id === uid);
  if (!m) return;
  const p = _cachedProfiles[uid] || {};
  const isSelf = RC.currentUser?.uid === uid;
  const canEdit = isSelf || isAdmin();

  const photo = p.photoURL
    ? `<img src="${p.photoURL}" style="width:96px;height:96px;border-radius:50%;object-fit:cover;border:3px solid var(--border)">`
    : `<div style="width:96px;height:96px;border-radius:50%;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:40px;border:3px solid var(--border)">👤</div>`;

  document.getElementById('modal-title-text').textContent = '社員プロフィール';
  document.getElementById('modal-body').innerHTML = `
    <div id="profile-detail-content">
      <!-- ヘッダー -->
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border)">
        ${photo}
        <div>
          <div style="font-size:20px;font-weight:700;color:var(--ink);margin-bottom:4px">${escHtml(m.name||'—')}</div>
          <div style="font-size:13px;color:var(--ink3);margin-bottom:6px">${escHtml(m.dept||'—')}</div>
          <span style="font-size:11px;font-weight:600;padding:3px 12px;border-radius:20px;background:var(--surface2);color:var(--ink3)">${m.role==='admin'?'管理者':m.role==='leader'?'リーダー':'メンバー'}</span>
        </div>
      </div>

      <!-- 自己紹介 -->
      ${p.selfIntroduction ? `
      <div style="margin-bottom:16px">
        <div style="font-size:10px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">自己紹介</div>
        <div style="font-size:13px;color:var(--ink2);line-height:1.8;background:var(--surface2);padding:12px 14px;border-radius:8px">${escHtml(p.selfIntroduction)}</div>
      </div>` : ''}

      <!-- スキル -->
      ${p.skills?.length ? `
      <div style="margin-bottom:16px">
        <div style="font-size:10px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">スキル・得意なこと</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${p.skills.map(s=>`<span style="font-size:12px;padding:4px 12px;border-radius:20px;background:rgba(42,82,152,.08);color:var(--blue);font-weight:500">${escHtml(s)}</span>`).join('')}</div>
      </div>` : ''}

      <!-- 担当業務 -->
      ${p.currentWork ? `
      <div style="margin-bottom:16px">
        <div style="font-size:10px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">担当業務</div>
        <div style="font-size:13px;color:var(--ink2);line-height:1.8;background:var(--surface2);padding:12px 14px;border-radius:8px">${escHtml(p.currentWork)}</div>
      </div>` : ''}

      <!-- 趣味・一言 -->
      ${p.hobbies ? `
      <div style="margin-bottom:16px">
        <div style="font-size:10px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">趣味・一言</div>
        <div style="font-size:13px;color:var(--ink2);line-height:1.8">${escHtml(p.hobbies)}</div>
      </div>` : ''}

      ${!p.selfIntroduction && !p.currentWork && !p.hobbies && !p.skills?.length ? `
      <div style="text-align:center;padding:24px;color:var(--ink3);font-size:13px">プロフィールはまだ入力されていません</div>` : ''}
    </div>

    <!-- 管理者: プロフィールフォームURL発行 -->
    ${isAdmin() ? `
    <div style="margin-top:16px;padding:12px 14px;background:var(--surface2);border-radius:8px;border:1px solid var(--border)">
      <div style="font-size:10px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">🔗 プロフィール入力URL</div>
      ${_cachedProfileTokens[uid] ? `
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">
        <input type="text" id="profile-url-display-${uid}" class="form-input" readonly
          value="${location.protocol}//${location.host}/profile.html?token=${_cachedProfileTokens[uid]}"
          style="font-size:11px;background:#fff">
        <button class="mini-btn" onclick="copyProfileUrl('${uid}')">コピー</button>
      </div>
      <button class="mini-btn" style="color:var(--accent);border-color:var(--accent);font-size:10px" onclick="revokeProfileUrl('${uid}')">URLを無効化</button>
      ` : `
      <div style="font-size:12px;color:var(--ink3);margin-bottom:8px">本人がスマホから直接プロフィールを入力できるURLを発行します。</div>
      <button class="mini-btn" style="color:var(--blue);border-color:var(--blue)" onclick="issueProfileUrl('${uid}')">🔗 URLを発行する</button>
      `}
    </div>` : ''}

    <div class="btn-row" style="margin-top:16px">
      ${canEdit ? `<button class="btn btn-primary" onclick="openEditProfileModal('${uid}')">✏️ 編集</button>` : ''}
      <button class="btn btn-secondary" onclick="exportProfilePDF('${uid}','${escHtml(m.name||'')}')">📄 PDF出力</button>
      <button class="btn btn-secondary" onclick="closeModal()">閉じる</button>
    </div>`;
  openModal();
}

// ── Edit modal ────────────────────────────────────────────

export function openEditProfileModal(uid) {
  const m = RC._cachedMembers.find(x => x.id === uid);
  if (!m) return;
  const p = _cachedProfiles[uid] || {};

  _editSkills = [...(p.skills || [])];
  document.getElementById('modal-title-text').textContent = 'プロフィールを編集';
  document.getElementById('modal-body').innerHTML = `
    <!-- 写真 -->
    <div style="display:flex;flex-direction:column;align-items:center;margin-bottom:16px">
      <div id="ep-photo-preview" style="width:80px;height:80px;border-radius:50%;overflow:hidden;background:var(--surface2);display:flex;align-items:center;justify-content:center;margin-bottom:8px;border:2px solid var(--border)">
        ${p.photoURL ? `<img src="${p.photoURL}" style="width:100%;height:100%;object-fit:cover">` : '<span style="font-size:32px">👤</span>'}
      </div>
      <label style="cursor:pointer">
        <span class="mini-btn">📷 写真を変更</span>
        <input type="file" id="ep-photo-input" accept="image/*" style="display:none" onchange="previewProfilePhoto(this)">
      </label>
    </div>

    <div class="form-row">
      <label class="form-label">自己紹介</label>
      <textarea class="form-input" id="ep-bio" rows="3" placeholder="自己紹介を入力してください" style="resize:vertical">${escHtml(p.selfIntroduction||'')}</textarea>
    </div>
    <div class="form-row">
      <label class="form-label">スキル・得意なこと</label>
      <div id="ep-skill-tags" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;min-height:28px"></div>
      <div style="display:flex;gap:6px">
        <input class="form-input" id="ep-skill-input" placeholder="例：営業" style="flex:1"
          onkeydown="if(event.key==='Enter'){event.preventDefault();addProfileSkillTag()}">
        <button class="mini-btn" onclick="addProfileSkillTag()" style="white-space:nowrap">追加</button>
      </div>
    </div>
    <div class="form-row">
      <label class="form-label">担当業務</label>
      <textarea class="form-input" id="ep-work" rows="3" placeholder="現在担当している仕事の詳細" style="resize:vertical">${escHtml(p.currentWork||'')}</textarea>
    </div>
    <div class="form-row">
      <label class="form-label">趣味・一言</label>
      <input class="form-input" id="ep-hobbies" value="${escHtml(p.hobbies||'')}" placeholder="例：映画鑑賞、料理">
    </div>
    <div id="ep-error" style="font-size:12px;color:var(--accent);min-height:16px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="openProfileModal('${uid}')">← 戻る</button>
      <button class="btn btn-primary" id="ep-save-btn" onclick="saveProfile('${uid}')">💾 保存</button>
    </div>`;
  openModal();
  _renderEditSkillTags();
}

// ── Skill tag helpers ─────────────────────────────────────

function _renderEditSkillTags() {
  const wrap = document.getElementById('ep-skill-tags');
  if (!wrap) return;
  wrap.innerHTML = _editSkills.map((s, i) => `
    <span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;padding:3px 10px;border-radius:20px;background:rgba(42,82,152,.1);color:var(--blue);font-weight:500">
      ${escHtml(s)}
      <button onclick="removeProfileSkillTag(${i})" style="background:none;border:none;cursor:pointer;color:var(--blue);font-size:12px;padding:0;line-height:1">×</button>
    </span>`).join('');
}

export function addProfileSkillTag() {
  const input = document.getElementById('ep-skill-input');
  if (!input) return;
  const val = input.value.trim();
  if (!val || _editSkills.includes(val)) { input.value = ''; return; }
  _editSkills.push(val);
  input.value = '';
  _renderEditSkillTags();
}

export function removeProfileSkillTag(i) {
  _editSkills.splice(i, 1);
  _renderEditSkillTags();
}

// ── Photo preview ─────────────────────────────────────────

export function previewProfilePhoto(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const preview = document.getElementById('ep-photo-preview');
    if (preview) preview.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover">`;
  };
  reader.readAsDataURL(file);
}

// ── Save ──────────────────────────────────────────────────

export async function saveProfile(uid) {
  const bio     = document.getElementById('ep-bio')?.value.trim() || '';
  const work    = document.getElementById('ep-work')?.value.trim() || '';
  const hobbies = document.getElementById('ep-hobbies')?.value.trim() || '';
  const skills  = [..._editSkills];
  const errEl    = document.getElementById('ep-error');
  const saveBtn  = document.getElementById('ep-save-btn');

  if (saveBtn) saveBtn.disabled = true;

  try {
    let photoURL = _cachedProfiles[uid]?.photoURL || '';

    // 写真アップロード
    const photoInput = document.getElementById('ep-photo-input');
    if (photoInput?.files[0]) {
      const file = photoInput.files[0];
      const storageRef = ref(storage, `users/${uid}/profile_pictures/profile_image.jpg`);
      await uploadBytes(storageRef, file);
      photoURL = await getDownloadURL(storageRef);
    }

    const data = {
      uid, photoURL, selfIntroduction: bio, skills, currentWork: work,
      hobbies, updatedAt: serverTimestamp()
    };

    if (!_cachedProfiles[uid]) data.createdAt = serverTimestamp();

    await setDoc(doc(db, 'profiles', uid), data, { merge: true });
    _cachedProfiles[uid] = { ..._cachedProfiles[uid], ...data };

    renderProfileCards(document.getElementById('profile-search')?.value || '');
    openProfileModal(uid);
  } catch(e) {
    if (errEl) errEl.textContent = e.message;
    if (saveBtn) saveBtn.disabled = false;
  }
}

// ── PDF export ────────────────────────────────────────────

export async function exportProfilePDF(uid, name) {
  const m = RC._cachedMembers.find(x => x.id === uid);
  const p = _cachedProfiles[uid] || {};
  if (!m) return;

  const photo = p.photoURL
    ? `<img src="${p.photoURL}" style="width:100px;height:100px;border-radius:50%;object-fit:cover;border:3px solid #e5e5e5">`
    : `<div style="width:100px;height:100px;border-radius:50%;background:#f0f0f0;display:flex;align-items:center;justify-content:center;font-size:48px">👤</div>`;

  const printEl = document.createElement('div');
  printEl.style.cssText = 'font-family:sans-serif;padding:40px;max-width:700px;color:#111';
  printEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:24px;margin-bottom:28px;padding-bottom:20px;border-bottom:2px solid #f0f0f0">
      ${photo}
      <div>
        <div style="font-size:26px;font-weight:700;margin-bottom:4px">${escHtml(m.name||'')}</div>
        <div style="font-size:14px;color:#666;margin-bottom:6px">${escHtml(m.dept||'')} ／ ${m.role==='admin'?'管理者':m.role==='leader'?'リーダー':'メンバー'}</div>
      </div>
    </div>
    ${p.selfIntroduction?`<div style="margin-bottom:20px"><div style="font-size:11px;font-weight:700;color:#999;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">自己紹介</div><div style="font-size:13px;line-height:1.8;color:#333">${escHtml(p.selfIntroduction)}</div></div>`:''}
    ${p.skills?.length?`<div style="margin-bottom:20px"><div style="font-size:11px;font-weight:700;color:#999;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">スキル・得意なこと</div><div style="display:flex;flex-wrap:wrap;gap:6px">${p.skills.map(s=>`<span style="font-size:12px;padding:3px 12px;border-radius:20px;background:#eef2fb;color:#2a5298">${escHtml(s)}</span>`).join('')}</div></div>`:''}
    ${p.currentWork?`<div style="margin-bottom:20px"><div style="font-size:11px;font-weight:700;color:#999;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">担当業務</div><div style="font-size:13px;line-height:1.8;color:#333">${escHtml(p.currentWork)}</div></div>`:''}
    ${p.hobbies?`<div style="margin-bottom:20px"><div style="font-size:11px;font-weight:700;color:#999;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">趣味・一言</div><div style="font-size:13px;color:#333">${escHtml(p.hobbies)}</div></div>`:''}
  `;
  document.body.appendChild(printEl);

  const opt = {
    margin: 10,
    filename: `${name||'profile'}_プロフィール.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  await window.html2pdf().set(opt).from(printEl).save();
  document.body.removeChild(printEl);
}

// ── Search ────────────────────────────────────────────────

export function filterProfiles(keyword) {
  renderProfileCards(keyword);
}

// ── Profile URL issuance ──────────────────────────────────

function _generateToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

export async function issueProfileUrl(uid) {
  const m = RC._cachedMembers.find(x => x.id === uid);
  if (!m) return;
  const token = _generateToken();
  await setDoc(doc(db, 'profile_tokens', token), {
    token, uid, name: m.name || '', issuedAt: new Date().toISOString()
  });
  _cachedProfileTokens[uid] = token;
  openProfileModal(uid);
}

export function copyProfileUrl(uid) {
  const token = _cachedProfileTokens[uid];
  if (!token) return;
  const url = `${location.protocol}//${location.host}/profile.html?token=${token}`;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.querySelector(`[onclick="copyProfileUrl('${uid}')"]`);
    if (btn) { btn.textContent = '✓ コピー済み'; setTimeout(() => { btn.textContent = 'コピー'; }, 2000); }
  });
}

export async function revokeProfileUrl(uid) {
  const token = _cachedProfileTokens[uid];
  if (!token || !confirm('このURLを無効にしますか？')) return;
  await setDoc(doc(db, 'profile_tokens', token), { revoked: true }, { merge: true });
  delete _cachedProfileTokens[uid];
  openProfileModal(uid);
}

// ── Window exports ────────────────────────────────────────
window.loadProfiles          = loadProfiles;
window.openProfileModal      = openProfileModal;
window.openEditProfileModal  = openEditProfileModal;
window.previewProfilePhoto   = previewProfilePhoto;
window.saveProfile           = saveProfile;
window.exportProfilePDF      = exportProfilePDF;
window.filterProfiles        = filterProfiles;
window.filterProfilesBySkill = filterProfilesBySkill;
window.addProfileSkillTag    = addProfileSkillTag;
window.removeProfileSkillTag = removeProfileSkillTag;
window.issueProfileUrl       = issueProfileUrl;
window.copyProfileUrl        = copyProfileUrl;
window.revokeProfileUrl      = revokeProfileUrl;
