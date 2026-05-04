// ============================================================
// Shifts module
// ============================================================
import { RC, isAdmin, isLeaderOrAbove } from '../state.js';
import {
  db, collection, doc, setDoc, getDoc, getDocs, addDoc, deleteDoc, updateDoc,
  query, where, orderBy, serverTimestamp, writeBatch
} from '../firebase.js';
import { SHIFT_OFF_WORDS } from '../data/constants.js';
import { todayJST, getMonthEnd } from '../utils/helpers.js';

// ── Week navigation ───────────────────────────────────────

function getWeekRange(offset) {
  const nowJST = new Date(new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }));
  const today = new Date(nowJST.getFullYear(), nowJST.getMonth(), nowJST.getDate());
  const dow = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return { start: fmt(monday), end: fmt(sunday), monday, sunday };
}

function getWeekLabel(offset) {
  const { monday, sunday } = getWeekRange(offset);
  const fmt = d => `${d.getMonth()+1}/${d.getDate()}`;
  const tag = offset === 0 ? '今週' : offset === -1 ? '先週' : offset === 1 ? '来週' : '';
  return `${fmt(monday)}（月）〜${fmt(sunday)}（日）${tag ? `　[${tag}]` : ''}`;
}

export function shiftWeekNav(delta) {
  RC._shiftWeekOffset = (RC._shiftWeekOffset || 0) + delta;
  loadShifts();
}

// ── Load shifts ───────────────────────────────────────────

export async function loadShifts() {
  const offset = RC._shiftWeekOffset || 0;
  const { start: weekStart, end: weekEnd, monday } = getWeekRange(offset);
  const month = `${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}`;

  ['shift-week-label','shift-week-label-m'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = getWeekLabel(offset);
  });

  const shiftFilter = document.getElementById('shift-member-filter');
  if (isAdmin() && shiftFilter) {
    shiftFilter.style.display = 'inline-block';
    // 当該月の勤怠入力ありメンバーに絞る
    window.populateMonthMemberFilters?.(month, ['shift-member-filter']);
  }

  const leaderFilterVal = document.getElementById('shift-leader-filter')?.value
    || document.getElementById('shift-leader-filter-m')?.value
    || 'self';

  let q;
  if (isAdmin()) {
    q = query(collection(db,'shifts'), where('date','>=',weekStart), where('date','<=',weekEnd));
  } else if (isLeaderOrAbove()) {
    if (leaderFilterVal === 'self') {
      q = query(collection(db,'shifts'), where('uid','==',RC.currentUser.uid));
    } else {
      q = query(collection(db,'shifts'), where('date','>=',weekStart), where('date','<=',weekEnd));
    }
  } else {
    q = query(collection(db,'shifts'), where('uid','==',RC.currentUser.uid));
  }
  const snap = await getDocs(q);
  let shifts = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(s => !['self',''].includes(isLeaderOrAbove() ? leaderFilterVal || '' : 'self') || (s.date >= weekStart && s.date <= weekEnd));
  if (!isAdmin()) {
    shifts = shifts.filter(s => s.date >= weekStart && s.date <= weekEnd);
  }

  if (isAdmin() && shiftFilter && shiftFilter.value) {
    shifts = shifts.filter(s => s.uid === shiftFilter.value);
  }

  if (isLeaderOrAbove() && !isAdmin()) {
    if (leaderFilterVal === 'dept') {
      const myDept = RC.currentUserData?.dept || '';
      const deptMemberIds = RC._cachedMembers.filter(m => m.dept === myDept).map(m => m.id);
      shifts = shifts.filter(s => deptMemberIds.includes(s.uid) || s.uid === RC.currentUser.uid);
    }
  }

  const absentSnap = await getDocs(query(
    collection(db, 'attendance'),
    where('date','>=',weekStart),
    where('date','<=',weekEnd),
    where('absent', '==', true)
  )).catch(() => ({ docs: [] }));
  const absentMap = {};
  absentSnap.docs.forEach(d => {
    const data = d.data();
    if (!absentMap[data.date]) absentMap[data.date] = [];
    absentMap[data.date].push(data.name);
  });

  renderShiftsUI(shifts, weekStart, weekEnd, leaderFilterVal, absentMap);
  if (isAdmin()) window.updateOffRequestBadge?.();
}

// ── Add shift ─────────────────────────────────────────────

export async function addShift() {
  const uid = document.getElementById('s-member-uid')?.value;
  const name = document.getElementById('s-member-name')?.value;
  const date = document.getElementById('s-date')?.value;
  const start = document.getElementById('s-start-time')?.value;
  const end = document.getElementById('s-end-time')?.value;
  const location = document.getElementById('s-location')?.value.trim() || '';
  if (!date || !start || !end) { alert('日付と時間を入力してください'); return; }
  const month = date.slice(0,7);
  const shiftData = {
    uid: uid || '', name: name || '未設定',
    date, startTime: start, endTime: end,
    location,
    month, note: document.getElementById('s-note')?.value || '',
    createdAt: serverTimestamp()
  };
  await addDoc(collection(db, 'shifts'), shiftData);
  if (isAdmin() && shiftData.name !== '未設定') writeShiftNotification(shiftData).catch(()=>{});
  window.closeModal();
  loadShifts();
}

// ── Open add shift modal ──────────────────────────────────

export async function openAddShiftModal() {
  const snap = await getDocs(collection(db, 'users'));
  const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const userOpts = users.map(u => `<option value="${u.id}" data-name="${u.name}">${u.name}</option>`).join('');
  document.getElementById('modal-title-text').textContent = 'シフト登録';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row"><label class="form-label">担当者</label>
      <select class="form-input" id="s-member-select" onchange="onShiftMemberChange(this)">${userOpts}</select>
      <input type="hidden" id="s-member-uid">
      <input type="hidden" id="s-member-name">
    </div>
    <div class="form-row"><label class="form-label">日付</label>
      <input type="date" class="form-input" id="s-date"></div>
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">開始時間</label>
        <input type="time" class="form-input" id="s-start-time" value="09:00"></div>
      <div class="form-row"><label class="form-label">終了時間</label>
        <input type="time" class="form-input" id="s-end-time" value="18:00"></div>
    </div>
    <div class="form-row"><label class="form-label">📍 出勤場所</label>
      <input class="form-input" id="s-location" placeholder="例：渋谷オフィス、〇〇クライアント先"></div>
    <div class="form-row"><label class="form-label">メモ</label>
      <input class="form-input" id="s-note" placeholder="任意"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="addShift()">登録する</button>
    </div>`;
  if (users.length > 0) {
    document.getElementById('s-member-uid').value = users[0].id;
    document.getElementById('s-member-name').value = users[0].name;
  }
  window.openModal();
}

export function onShiftMemberChange(sel) {
  const opt = sel.options[sel.selectedIndex];
  document.getElementById('s-member-uid').value = sel.value;
  document.getElementById('s-member-name').value = opt.dataset.name;
}

// ── Render shifts ─────────────────────────────────────────

function renderShiftsUI(shifts, weekStart, weekEnd, leaderMode, absentMap) {
  absentMap = absentMap || {};
  const container = document.getElementById('shift-calendar');
  const containerM = document.getElementById('shift-calendar-m');
  const dayNames = ['日','月','火','水','木','金','土'];

  const dates = [];
  const cur = new Date(weekStart);
  while (cur <= new Date(weekEnd)) {
    dates.push(cur.toLocaleDateString('sv-SE'));
    cur.setDate(cur.getDate() + 1);
  }

  const buildCal = (adminMode) => {
    let calHtml = `<div style="overflow-x:auto;-webkit-overflow-scrolling:touch"><div class="shift-cal-wrap" style="min-width:560px"><div class="shift-cal-grid">`;
    dates.forEach(dateStr => {
      const dow = new Date(dateStr).getDay();
      const d = parseInt(dateStr.split('-')[2]);
      const m = parseInt(dateStr.split('-')[1]);
      calHtml += `<div style="padding:8px 4px;text-align:center;font-size:11px;font-weight:700;background:var(--surface2);border-bottom:1px solid var(--border);color:${dow===0?'var(--accent)':dow===6?'var(--blue)':'var(--ink3)'}">${m}/${d}（${dayNames[dow]}）</div>`;
    });

    dates.forEach(dateStr => {
      const dayShifts = shifts.filter(s => s.date === dateStr);
      const dow = new Date(dateStr).getDay();
      const d = parseInt(dateStr.split('-')[2]);
      const isToday = dateStr === todayJST();
      calHtml += `<div class="shift-cal-cell ${isToday?'today':''}">
        <div class="shift-cal-num" style="${dow===0?'color:var(--accent)':dow===6?'color:var(--blue)':''}">${d}</div>
        ${(absentMap[dateStr]||[]).map(a=>`<div class="shift-chip" style="background:rgba(200,71,42,.12);color:var(--accent)">😔 ${a} 欠勤</div>`).join('')}
        ${dayShifts.map(s => {
          if (s.type === 'off') {
            const approved = s.approved === true;
            const pending = !approved;
            if (adminMode) {
              if (pending) {
                return `<div class="shift-chip shift-chip-off" style="border:1.5px dashed var(--accent)">
                  <div style="font-size:10px;font-weight:700">🙏 ${s.name} 希望休申請</div>
                  <div style="font-size:9px;color:var(--ink3);margin:2px 0">${s.note||''}</div>
                  <div style="display:flex;gap:4px;margin-top:4px">
                    <button onclick="approveOffRequest('${s.id}')" style="flex:1;padding:2px 4px;font-size:9px;font-weight:700;background:var(--accent2);color:#fff;border:none;border-radius:3px;cursor:pointer">✅ 承認</button>
                    <button onclick="rejectOffRequest('${s.id}')" style="flex:1;padding:2px 4px;font-size:9px;font-weight:700;background:var(--accent);color:#fff;border:none;border-radius:3px;cursor:pointer">✕ 却下</button>
                    <button onclick="openEditShiftModal('${s.id}')" style="padding:2px 4px;font-size:9px;background:var(--surface2);border:1px solid var(--border);border-radius:3px;cursor:pointer">✎</button>
                  </div>
                </div>`;
              } else {
                const offLabel = s.selfReport ? '公休' : '希望休（承認済）';
                return `<div class="shift-chip shift-chip-off shift-chip-edit" data-name="${s.name}" onclick="openEditShiftModal('${s.id}')" title="クリックで編集">✅ ${s.name} ${offLabel} ✎</div>`;
              }
            }
            if (s.uid === RC.currentUser.uid) {
              const statusLabel = approved ? '✅ 承認済' : '⏳ 申請中';
              const chipStyle = approved ? 'shift-chip-off' : 'shift-chip-off" style="border:1.5px dashed var(--accent)';
              const labelText = s.selfReport ? '公休' : `希望休 ${statusLabel}`;
              return `<div class="shift-chip ${chipStyle}">🙏 ${labelText}${!approved ? `<button onclick="confirmDeleteOwnOff('${s.id}','${dateStr}')" style="margin-left:4px;background:none;border:none;cursor:pointer;font-size:9px;color:var(--accent)">取消</button>` : ''}</div>`;
            }
            const offLabel2 = s.selfReport ? '公休' : '希望休';
            return approved
              ? `<div class="shift-chip shift-chip-off" data-name="${s.name}">✅ ${s.name} ${offLabel2}（承認済）</div>`
              : `<div class="shift-chip shift-chip-off" data-name="${s.name}" style="border:1.5px dashed var(--accent)">🙏 ${s.name} 希望休（申請中）</div>`;
          }
          const loc = s.location ? `📍${s.location} ` : '';
          const label = `${s.name} ${loc}${s.startTime}〜${s.endTime}`;
          return adminMode
            ? `<div class="shift-chip shift-chip-edit" data-name="${s.name}" onclick="openEditShiftModal('${s.id}')" title="クリックで編集">${label} ✎</div>`
            : `<div class="shift-chip" data-name="${s.name}">${label}</div>`;
        }).join('')}
      </div>`;
    });
    calHtml += '</div></div></div>';
    return calHtml;
  };

  const showGrouped = isLeaderOrAbove() && !isAdmin() && (leaderMode === 'dept' || leaderMode === 'all');
  if (container) container.innerHTML = showGrouped ? buildCalGrouped(shifts, weekStart, weekEnd) : buildCal(isAdmin());
  if (containerM) containerM.innerHTML = showGrouped ? buildCalGrouped(shifts, weekStart, weekEnd) : buildCalMobile(shifts, weekStart, weekEnd);
  const containerAdminM = document.getElementById('shift-calendar-admin-m');
  if (containerAdminM && isAdmin()) containerAdminM.innerHTML = showGrouped ? buildCalGrouped(shifts, weekStart, weekEnd) : buildCal(true);
}

function buildCalMobile(shifts, weekStart, weekEnd) {
  if (!shifts || !shifts.length) {
    return '<div style="padding:32px 0;text-align:center;color:var(--ink3);font-size:13px">📅 シフトがありません</div>';
  }
  const dayNames = ['日','月','火','水','木','金','土'];
  const todayStr = todayJST();
  const byDate = {};
  shifts.forEach(s => {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s);
  });
  const dates = [];
  const cur = new Date(weekStart);
  while (cur.toLocaleDateString('sv-SE') <= weekEnd) {
    dates.push(cur.toLocaleDateString('sv-SE'));
    cur.setDate(cur.getDate() + 1);
  }
  let h = '<div style="display:flex;flex-direction:column;gap:6px;padding:4px 0">';
  dates.forEach(dateStr => {
    const dow = new Date(dateStr).getDay();
    const d = parseInt(dateStr.split('-')[2]);
    const m = parseInt(dateStr.split('-')[1]);
    const dayShifts = byDate[dateStr] || [];
    if (!dayShifts.length) return;
    const isToday = dateStr === todayStr;
    const dayColor = dow===0?'var(--accent)':dow===6?'var(--blue)':'var(--ink1)';
    const cardBg = isToday?'rgba(200,71,42,.06)':'var(--surface)';
    const cardBorder = isToday?'1.5px solid var(--accent)':'1px solid var(--border)';
    h += `<div style="background:${cardBg};border:${cardBorder};border-radius:8px;padding:10px 12px;display:flex;align-items:flex-start;gap:10px">`;
    h += `<div style="min-width:44px;text-align:center;flex-shrink:0">`;
    h += `<div style="font-size:20px;font-weight:800;color:${dayColor};font-family:monospace;line-height:1">${m}/${d}</div>`;
    h += `<div style="font-size:10px;color:${dayColor};opacity:.8;font-weight:700">${dayNames[dow]}</div>`;
    if (isToday) h += `<div style="font-size:9px;background:var(--accent);color:#fff;border-radius:3px;padding:1px 4px;margin-top:2px;font-weight:700">TODAY</div>`;
    h += '</div>';
    h += '<div style="flex:1;min-width:0">';
    dayShifts.forEach(s => {
      if (s.type === 'off') {
        const approved = s.approved === true;
        const label = s.selfReport ? '公休' : (approved ? '希望休（承認済）' : '希望休（申請中）');
        const icon = approved ? '✅' : '⏳';
        h += `<div style="background:rgba(200,71,42,.08);border:${approved?'none':'1px dashed var(--accent)'};border-radius:6px;padding:6px 8px;margin-bottom:4px">`;
        h += `<span style="font-size:12px;font-weight:700;color:var(--accent)">${icon} ${label}</span>`;
        if (s.note) h += `<div style="font-size:10px;color:var(--ink3);margin-top:2px">${s.note}</div>`;
        h += '</div>';
      } else {
        const loc = s.location || '';
        const time = (s.startTime && s.endTime) ? s.startTime + ' 〜 ' + s.endTime : '';
        h += '<div style="background:rgba(42,82,152,.07);border-radius:6px;padding:6px 8px;margin-bottom:4px">';
        if (time) h += `<div style="font-size:13px;font-weight:700;color:var(--blue)">${time}</div>`;
        if (loc) h += `<div style="font-size:11px;color:var(--ink2);margin-top:2px">📍 ${loc}</div>`;
        h += '</div>';
      }
    });
    h += '</div></div>';
  });
  h += '</div>';
  return h;
}

function buildCalGrouped(shifts, weekStart, weekEnd) {
  const myName = RC.currentUserData?.name || '';
  const names = [...new Set(shifts.map(s => s.name))].sort((a, b) => {
    if (a === myName) return -1;
    if (b === myName) return 1;
    return a.localeCompare(b, 'ja');
  });

  if (!names.length) return '<div class="empty">シフトがありません</div>';

  const dayNames = ['日','月','火','水','木','金','土'];
  const dates = [];
  const cur = new Date(weekStart);
  while (cur.toLocaleDateString('sv-SE') <= weekEnd) {
    dates.push(cur.toLocaleDateString('sv-SE'));
    cur.setDate(cur.getDate() + 1);
  }
  const todayStr = todayJST();

  let html = '<div style="overflow-x:auto"><table style="border-collapse:collapse;min-width:700px;width:100%">';
  html += '<thead><tr>';
  html += '<th style="min-width:90px;padding:6px 10px;background:var(--surface2);font-size:11px;font-weight:700;text-align:left;border-bottom:2px solid var(--border);white-space:nowrap;position:sticky;left:0;z-index:1">メンバー</th>';
  for (const dateStr of dates) {
    const dow = new Date(dateStr).getDay();
    const d = parseInt(dateStr.split('-')[2]);
    const m = parseInt(dateStr.split('-')[1]);
    const isToday = dateStr === todayStr;
    const color = dow===0?'color:var(--accent)':dow===6?'color:var(--blue)':'';
    html += `<th style="min-width:60px;width:60px;padding:4px 2px;text-align:center;font-size:11px;${isToday?'background:rgba(200,71,42,.08)':''}${color};border-bottom:2px solid var(--border)">
      <div style="font-family:'DM Mono',monospace">${m}/${d}</div>
      <div style="font-size:9px;opacity:.6">${dayNames[dow]}</div>
    </th>`;
  }
  html += '</tr></thead><tbody>';

  for (const name of names) {
    const isMe = name === myName;
    const rowStyle = isMe ? 'background:rgba(42,82,152,.04);' : '';
    html += `<tr style="${rowStyle}">`;
    html += `<td style="padding:6px 10px;font-size:12px;font-weight:${isMe?'700':'500'};white-space:nowrap;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;left:0;z-index:1">
      ${isMe ? '👤 ' : ''}${name}
    </td>`;

    for (const dateStr of dates) {
      const dow = new Date(dateStr).getDay();
      const isToday = dateStr === todayStr;
      const dayShifts = shifts.filter(s => s.date === dateStr && s.name === name);
      const isWe = dow===0||dow===6;
      const cellBg = isToday ? 'background:rgba(200,71,42,.06)' : isWe ? 'background:rgba(0,0,0,.02)' : '';

      let cellContent = '';
      for (const s of dayShifts) {
        if (s.type === 'off') {
          const approved = s.approved === true;
          const label = approved ? '✅休' : '🙏休';
          const color = approved ? 'var(--accent2)' : 'var(--warn)';
          cellContent += `<div style="font-size:9px;font-weight:700;color:${color};text-align:center;line-height:1.3" title="${s.note||''}">${label}</div>`;
        } else {
          cellContent += `<div style="font-size:9px;text-align:center;line-height:1.4;color:var(--blue)">
            <div style="font-weight:700">${s.startTime}</div>
            <div style="opacity:.7">〜${s.endTime}</div>
            ${s.location ? `<div style="font-size:8px;color:var(--ink3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:34px">${s.location}</div>` : ''}
          </div>`;
        }
      }

      html += `<td style="padding:2px 1px;border-bottom:1px solid var(--border);border-right:1px solid var(--surface2);${cellBg};vertical-align:middle;min-height:40px">
        ${cellContent || '<div style="height:36px"></div>'}
      </td>`;
    }
    html += '</tr>';
  }

  html += '</tbody></table></div>';
  return html;
}

// ── Edit / delete shifts ──────────────────────────────────

export async function openEditShiftModal(shiftId) {
  if (!isAdmin()) return;
  const snap = await getDoc(doc(db, 'shifts', shiftId));
  if (!snap.exists()) return;
  const s = snap.data();
  const isOff = s.type === 'off';

  document.getElementById('modal-title-text').textContent = isOff
    ? `希望休編集 — ${s.date} ${s.name}`
    : `シフト編集 — ${s.date} ${s.name}`;

  document.getElementById('modal-body').innerHTML = isOff ? `
    <div class="form-row"><label class="form-label">担当者</label>
      <input class="form-input" value="${s.name}" disabled style="opacity:.6"></div>
    <div class="form-row"><label class="form-label">日付</label>
      <input type="date" class="form-input" id="es-date" value="${s.date}"></div>
    <div class="form-row"><label class="form-label">理由・メモ</label>
      <input class="form-input" id="es-note" value="${s.note||''}" placeholder="任意"></div>
    <div class="btn-row">
      <button class="btn" style="background:#fee2e2;color:var(--accent);border:none" onclick="deleteShift('${shiftId}')">削除</button>
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="saveOffEdit('${shiftId}')">保存</button>
    </div>` : `
    <div class="form-row"><label class="form-label">担当者</label>
      <input class="form-input" value="${s.name}" disabled style="opacity:.6"></div>
    <div class="form-row"><label class="form-label">日付</label>
      <input type="date" class="form-input" id="es-date" value="${s.date}"></div>
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">開始時間</label>
        <input type="time" class="form-input" id="es-start" value="${s.startTime}"></div>
      <div class="form-row"><label class="form-label">終了時間</label>
        <input type="time" class="form-input" id="es-end" value="${s.endTime}"></div>
    </div>
    <div class="form-row"><label class="form-label">📍 出勤場所</label>
      <input class="form-input" id="es-location" value="${s.location||''}" placeholder="例：渋谷オフィス、〇〇クライアント先"></div>
    <div class="form-row"><label class="form-label">メモ <span style="font-size:10px;color:var(--ink3)">（勤怠表と連動）</span></label>
      <input class="form-input" id="es-note" value="${s.note||''}" placeholder="任意"></div>
    <div class="btn-row">
      <button class="btn" style="background:#fee2e2;color:var(--accent);border:none" onclick="deleteShift('${shiftId}')">削除</button>
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="saveShiftEdit('${shiftId}','${s.month}')">保存</button>
    </div>`;
  window.openModal();
}

export async function saveOffEdit(shiftId) {
  const date = document.getElementById('es-date').value;
  if (!date) { alert('日付を入力してください'); return; }
  await updateDoc(doc(db, 'shifts', shiftId), {
    date,
    month: date.slice(0,7),
    note: document.getElementById('es-note').value.trim()
  });
  window.closeModal();
  loadShifts();
}

export async function saveShiftEdit(shiftId, month) {
  const date  = document.getElementById('es-date').value;
  const start = document.getElementById('es-start').value;
  const end   = document.getElementById('es-end').value;
  if (!date || !start || !end) { alert('日付と時間を入力してください'); return; }
  const note = document.getElementById('es-note').value.trim();
  const snap = await getDoc(doc(db, 'shifts', shiftId));
  const s = snap.exists() ? snap.data() : {};
  const newMonth = date.slice(0,7);
  await updateDoc(doc(db, 'shifts', shiftId), {
    date, startTime: start, endTime: end,
    month: newMonth,
    location: document.getElementById('es-location').value.trim(),
    note
  });
  if (s.uid && note !== undefined) {
    const attDocId = s.uid + '_' + date;
    const attSnap = await getDoc(doc(db, 'attendance', attDocId));
    if (attSnap.exists()) {
      await updateDoc(doc(db, 'attendance', attDocId), { note }).catch(()=>{});
    }
  }
  if (isAdmin() && s.name) {
    writeShiftNotification({ uid: s.uid, name: s.name, month: newMonth, type: 'update' }).catch(()=>{});
  }
  window.closeModal();
  loadShifts();
}

export async function deleteShift(shiftId) {
  if (!confirm('このシフトを削除しますか？')) return;
  await deleteDoc(doc(db, 'shifts', shiftId));
  window.closeModal();
  loadShifts();
}

// ── Absent ────────────────────────────────────────────────

export async function markAbsentFromTable(uid, encodedName, date) {
  const name = decodeURIComponent(encodedName);
  if (!confirm(`${name} さんを ${date} の欠勤として記録しますか？\n\n※ 入店報告漏れから欠勤に変更します`)) return;
  const docId = uid + '_' + date;
  await setDoc(doc(db, 'attendance', docId), {
    uid, name, date,
    clockIn: null, clockOut: null,
    absent: true,
    missedClockIn: false,
    absentRecordedAt: new Date().toISOString(),
    absentRecordedBy: RC.currentUserData?.name || 'admin',
    autoRecorded: false
  }, { merge: true });
  await window.loadMonthlyAttendance?.(true);
}

export async function markAbsent(uid, encodedName, date) {
  const name = decodeURIComponent(encodedName);
  if (!confirm(`${name} さんを ${date} の欠勤として記録しますか？`)) return;
  const docId = uid + '_' + date;
  await setDoc(doc(db, 'attendance', docId), {
    uid, name, date,
    clockIn: null, clockOut: null,
    absent: true,
    absentRecordedAt: new Date().toISOString(),
    absentRecordedBy: RC.currentUserData?.name || 'admin',
    autoRecorded: false
  }, { merge: true });
  window.loadDailyCheck?.();
  window.loadDailyCheckM?.();
  window.loadMonthlyAttendance?.(true);
}

export async function cancelAbsent(uid, date) {
  if (!confirm('欠勤を取消しますか？')) return;
  const docId = uid + '_' + date;
  await updateDoc(doc(db, 'attendance', docId), {
    absent: false,
    absentRecordedAt: null,
    absentRecordedBy: null
  });
  window.loadDailyCheck?.();
  window.loadDailyCheckM?.();
  window.loadMonthlyAttendance?.(true);
}

// ── Delete member shifts modal ────────────────────────────

export async function openDeleteMemberShiftModal() {
  if (!isAdmin()) return;
  const currentMonth = document.getElementById('shift-month')?.value || new Date().toISOString().slice(0,7);

  document.getElementById('modal-title-text').textContent = '🗑 メンバー別シフト一括削除';
  document.getElementById('modal-body').innerHTML = `
    <div style="display:flex;gap:10px;align-items:flex-end;margin-bottom:16px;flex-wrap:wrap">
      <div style="flex:1;min-width:160px">
        <label class="form-label">対象月</label>
        <input type="month" class="form-input" id="del-shift-month" value="${currentMonth}" onchange="loadDeleteShiftPreview()">
      </div>
      <div style="flex:2;min-width:160px">
        <label class="form-label">メンバー</label>
        <select class="form-input" id="del-shift-member" onchange="loadDeleteShiftPreview()">
          <option value="">選択してください</option>
          ${RC._cachedMembers.map(m => `<option value="${m.id}" data-name="${m.name}">${m.name}</option>`).join('')}
        </select>
      </div>
    </div>
    <div id="del-shift-preview" style="margin-bottom:16px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-danger" id="del-shift-exec-btn" onclick="execDeleteMemberShifts()" disabled
        style="background:var(--accent);color:#fff;border:none">🗑 選択した月のシフトを全削除</button>
    </div>`;
  window.openModal();
}

export async function loadDeleteShiftPreview() {
  const month = document.getElementById('del-shift-month')?.value;
  const memberEl = document.getElementById('del-shift-member');
  const uid = memberEl?.value;
  const name = memberEl?.options[memberEl.selectedIndex]?.dataset.name || '';
  const prevEl = document.getElementById('del-shift-preview');
  const execBtn = document.getElementById('del-shift-exec-btn');

  if (!month || !uid) {
    prevEl.innerHTML = '';
    execBtn.disabled = true;
    return;
  }

  prevEl.innerHTML = `<div style="color:var(--ink3);font-size:12px">読み込み中...</div>`;

  const snap = await getDocs(query(
    collection(db, 'shifts'),
    where('uid', '==', uid),
    where('month', '==', month)
  ));
  let docs = snap.docs;
  if (docs.length === 0 && name) {
    const snap2 = await getDocs(query(
      collection(db, 'shifts'),
      where('name', '==', name),
      where('month', '==', month)
    ));
    docs = snap2.docs;
  }

  const workShifts = docs.filter(d => d.data().type !== 'off');
  const offShifts  = docs.filter(d => d.data().type === 'off');

  window._delShiftDocs = workShifts;

  if (workShifts.length === 0) {
    prevEl.innerHTML = `<div style="background:var(--surface2);border-radius:8px;padding:14px;text-align:center;color:var(--ink3);font-size:12px">
      ${month} の ${name} のシフトは登録されていません
    </div>`;
    execBtn.disabled = true;
    return;
  }

  const sorted = workShifts.map(d => d.data()).sort((a,b) => a.date.localeCompare(b.date));
  prevEl.innerHTML = `
    <div style="background:#fff5f5;border:1px solid #fca5a5;border-radius:8px;padding:14px;margin-bottom:8px">
      <div style="font-size:12px;font-weight:700;color:var(--accent);margin-bottom:10px">
        ⚠ 以下 ${workShifts.length}件のシフトが削除されます
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;max-height:160px;overflow-y:auto">
        ${sorted.map(s => `
          <span style="font-size:11px;background:#fee2e2;border-radius:4px;padding:2px 7px;font-family:'DM Mono',monospace">
            ${s.date.slice(5)}　${s.startTime}〜${s.endTime}${s.location ? '　'+s.location : ''}
          </span>`).join('')}
      </div>
      ${offShifts.length ? `<div style="margin-top:10px;font-size:11px;color:var(--ink3)">
        ※ 希望休 ${offShifts.length}件は削除されません
      </div>` : ''}
    </div>`;
  execBtn.disabled = false;
  execBtn.textContent = `🗑 ${name} の ${month} シフトを全削除（${workShifts.length}件）`;
}

export async function execDeleteMemberShifts() {
  const docs = window._delShiftDocs || [];
  if (!docs.length) return;

  const memberEl = document.getElementById('del-shift-member');
  const name = memberEl?.options[memberEl.selectedIndex]?.dataset.name || '';
  const month = document.getElementById('del-shift-month')?.value;

  if (!confirm(`${name} の ${month} シフト ${docs.length}件を削除します。\nこの操作は元に戻せません。よろしいですか？`)) return;

  const btn = document.getElementById('del-shift-exec-btn');
  btn.disabled = true;
  btn.textContent = '削除中...';

  try {
    const BATCH = 20;
    for (let i = 0; i < docs.length; i += BATCH) {
      await Promise.all(docs.slice(i, i + BATCH).map(d => deleteDoc(doc(db, 'shifts', d.id))));
      btn.textContent = `削除中... ${Math.min(i+BATCH, docs.length)}/${docs.length}件`;
    }
    window._delShiftDocs = [];
    window.closeModal();
    loadShifts();
    alert(`✅ ${name} の ${month} シフト ${docs.length}件を削除しました`);
  } catch(e) {
    btn.disabled = false;
    btn.textContent = `🗑 全削除`;
    alert('削除中にエラーが発生しました: ' + e.message);
  }
}

// ── Bulk shift import (CSV upload) ────────────────────────

let _bulkImportRows = [];
let _importRows = [];
let _bulkPreviewTimer = null;

function parseShiftTableCSV(text, year, monthNum) {
  const lines = text.split(/\r?\n/);
  const results = [];
  const unknownNames = new Set();

  const normalizeName = (s) => s
    .replace(/[　 \t]/g, '')
    .replace(/\s+/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .trim();

  const nameMap = {};
  const nameMapOrig = {};
  RC._cachedMembers.forEach(m => {
    if (!m.name) return;
    const norm = normalizeName(m.name);
    nameMap[norm] = { uid: m.id, name: m.name };
    nameMapOrig[m.name] = { uid: m.id, name: m.name };
  });

  const resolveNameFn = (raw) => {
    if (!raw) return null;
    const norm = normalizeName(raw);
    if (nameMap[norm]) return nameMap[norm];
    if (nameMapOrig[raw]) return nameMapOrig[raw];
    for (const [key, val] of Object.entries(nameMap)) {
      if (norm.length >= 2 && (key.startsWith(norm) || norm.startsWith(key))) return val;
    }
    const matches3 = Object.entries(nameMap).filter(([k]) => k.startsWith(norm.slice(0,3)) && norm.length >= 3);
    if (matches3.length === 1) return matches3[0][1];
    const matches2 = Object.entries(nameMap).filter(([k]) => k.startsWith(norm.slice(0,2)) && norm.length >= 2);
    if (matches2.length === 1) return matches2[0][1];
    return null;
  };

  let nameColIdx = -1;
  let dayStartIdx = -1;
  const daysInMonth = new Date(year, monthNum, 0).getDate();

  const detectSep = (line) => line.includes('\t') ? '\t' : ',';
  const firstNonEmpty = lines.find(l => l.trim());
  const sep = firstNonEmpty ? detectSep(firstNonEmpty) : ',';
  const splitLine = (l) => l.split(sep).map(c => c.replace(/^"|"$/g, '').trim());

  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const cols = splitLine(lines[i]);
    const ni = cols.findIndex(c => ['氏名','名前','メンバー','name','Name'].includes(c.replace(/\s/g,'')));
    if (ni !== -1) {
      nameColIdx = ni;
      dayStartIdx = ni + 1;
      break;
    }
  }
  if (nameColIdx === -1) return { results: [], unknownNames: new Set(), error: '「氏名」列が見つかりませんでした（ヘッダー行に「氏名」が必要です）' };

  const cachedShops = window._cachedShops || [];

  for (const line of lines) {
    const cols = splitLine(line);
    if (cols.length <= nameColIdx) continue;
    const rawName = cols[nameColIdx];
    if (!rawName || ['氏名','名前','メンバー'].includes(rawName) || /^\d+$/.test(rawName)) continue;

    const member = resolveNameFn(rawName);
    if (!member) { unknownNames.add(rawName); continue; }

    for (let d = 0; d < daysInMonth; d++) {
      const colIdx = dayStartIdx + d;
      if (colIdx >= cols.length) break;
      const cell = cols[colIdx].trim();
      if (!cell || SHIFT_OFF_WORDS.has(cell)) continue;

      const day = d + 1;
      const date = `${year}-${String(monthNum).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const shopSetting = cachedShops.find(s => s.name === cell);
      const defaultStart = shopSetting?.defaultStart || '10:00';
      const defaultEnd   = shopSetting?.defaultEnd   || '19:00';
      results.push({
        name: member.name, uid: member.uid,
        date, startTime: defaultStart, endTime: defaultEnd,
        location: cell,
        month: `${year}-${String(monthNum).padStart(2,'0')}`,
        hasConflict: false, unknownName: false
      });
    }
  }

  return { results, unknownNames, csvAllNames: new Set([...results.map(r=>r.name), ...[...unknownNames]]) };
}

export function handleShiftCSVFile(input) {
  const file = input.files[0];
  if (!file) return;
  readAndParseShiftCSV(file);
}

export function handleShiftCSVDrop(event) {
  const file = event.dataTransfer.files[0];
  if (!file || !file.name.endsWith('.csv')) {
    alert('CSVファイルをドロップしてください');
    return;
  }
  readAndParseShiftCSV(file);
}

async function readAndParseShiftCSV(file) {
  const dropzone = document.getElementById('csv-dropzone');
  const prevEl   = document.getElementById('csv-upload-preview');
  const execBtn  = document.getElementById('bulk-import-exec-btn');

  if (dropzone) {
    dropzone.innerHTML = `<div style="font-size:22px;margin-bottom:6px">⏳</div><div style="font-size:12px;color:var(--ink3)">解析中... ${file.name}</div>`;
  }

  const year     = parseInt(document.getElementById('csv-upload-year')?.value || new Date().getFullYear());
  const monthNum = parseInt(document.getElementById('csv-upload-month-num')?.value || new Date().getMonth()+1);

  const buffer = await file.arrayBuffer();
  let text = '';
  try {
    text = new TextDecoder('utf-8').decode(buffer);
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    if ((text.match(/\uFFFD/g)||[]).length > 10) {
      text = new TextDecoder('shift-jis').decode(buffer);
    }
  } catch(e) {
    try { text = new TextDecoder('shift-jis').decode(buffer); } catch(e2) {}
  }

  const { results, unknownNames, csvAllNames, error } = parseShiftTableCSV(text, year, monthNum);

  if (dropzone) {
    dropzone.innerHTML = `
      <div style="font-size:20px;margin-bottom:6px">✅</div>
      <div style="font-weight:700;font-size:13px">${file.name}</div>
      <div style="font-size:11px;color:var(--ink3);margin-top:4px">${year}年${monthNum}月 / ${results.length}件 解析完了</div>
      <div style="font-size:10px;color:var(--accent2);margin-top:4px;cursor:pointer" onclick="document.getElementById('csv-file-input').click()">別のファイルを選択</div>
      <input type="file" id="csv-file-input" accept=".csv" style="display:none" onchange="handleShiftCSVFile(this)">`;
  }

  if (error) {
    prevEl.innerHTML = `<div style="background:#fee2e2;padding:10px;border-radius:6px;font-size:12px;color:var(--accent)">❌ ${error}</div>`;
    execBtn.disabled = true;
    return;
  }

  const monthStr = `${year}-${String(monthNum).padStart(2,'0')}`;
  try {
    const offSnap = await getDocs(query(collection(db,'shifts'), where('type','==','off'), where('approved','==',true), where('month','==',monthStr)));
    const approvedOff = new Set(offSnap.docs.map(d => `${d.data().name}_${d.data().date}`));
    results.forEach(r => { r.hasConflict = approvedOff.has(`${r.name}_${r.date}`); });
  } catch(e) {}

  const notInCSV = RC._cachedMembers.filter(m => m.name && !csvAllNames.has(m.name));
  _bulkImportRows = results;
  renderBulkPreviewHTML(results, unknownNames, notInCSV, 'csv-upload-preview');
}

function renderBulkPreviewHTML(rows, unknownNames, notInCSV, previewElId) {
  const prevEl  = document.getElementById(previewElId);
  const execBtn = document.getElementById('bulk-import-exec-btn');
  if (!prevEl) return;

  const memberCount = new Set(rows.map(r => r.name)).size;
  const byMember = {};
  rows.forEach(r => { if (!byMember[r.name]) byMember[r.name]=[]; byMember[r.name].push(r); });

  let html = '';

  if (unknownNames && unknownNames.size) {
    const chips = [...unknownNames].map(n => `
      <div style="display:flex;align-items:center;gap:6px;background:var(--surface);border-radius:6px;padding:5px 8px;margin:3px 0">
        <span style="font-weight:600;font-size:12px;flex:1">${n}</span>
        <select id="new-member-attr-${encodeURIComponent(n)}" style="font-size:10px;border:1px solid var(--border);border-radius:4px;padding:2px 4px;background:var(--bg)">
          <option value="社員">社員</option>
          <option value="委託">委託（アライアンス）</option>
        </select>
        <button onclick="addMemberFromCSV('${encodeURIComponent(n)}')" style="font-size:10px;padding:3px 8px;background:var(--accent2);color:#fff;border:none;border-radius:4px;cursor:pointer;white-space:nowrap">＋ 追加</button>
      </div>`).join('');
    html += `
      <div style="background:#fff8e1;border:1px solid #f9a825;border-radius:6px;padding:10px 12px;margin-bottom:10px">
        <div style="font-weight:700;font-size:11px;color:#7b5800;margin-bottom:6px">⚠ シフト表にあるが未登録のメンバー（${unknownNames.size}名）</div>
        <div style="font-size:10px;color:#7b5800;margin-bottom:6px">追加するとアプリに登録され、シフトもインポートされます</div>
        ${chips}
      </div>`;
  }

  if (notInCSV && notInCSV.length) {
    const chips = notInCSV.map(m => `
      <div style="display:flex;align-items:center;gap:6px;background:var(--surface);border-radius:6px;padding:5px 8px;margin:3px 0">
        <span style="font-weight:600;font-size:12px;flex:1">${m.name}</span>
        <span style="font-size:10px;color:var(--ink3)">${m.attr==='委託'?'委託':'社員'} / ${m.dept||'—'}</span>
        <button onclick="deleteMemberFromCSVCheck('${m.id}','${encodeURIComponent(m.name)}')" style="font-size:10px;padding:3px 8px;background:var(--accent);color:#fff;border:none;border-radius:4px;cursor:pointer;white-space:nowrap">削除</button>
      </div>`).join('');
    html += `
      <div style="background:#fff0f0;border:1px solid #ffcdd2;border-radius:6px;padding:10px 12px;margin-bottom:10px">
        <div style="font-weight:700;font-size:11px;color:#c62828;margin-bottom:6px">🗑 シフト表にないが登録済みのメンバー（${notInCSV.length}名）</div>
        <div style="font-size:10px;color:#c62828;margin-bottom:6px">不要なメンバーを削除できます（勤怠データは残ります）</div>
        ${chips}
      </div>`;
  }

  const offConflictRows = rows.filter(r => r.hasConflict);
  if (offConflictRows.length) {
    html += `<div style="background:#fff0f6;padding:10px 12px;border-radius:6px;font-size:11px;margin-bottom:8px;border-left:3px solid #e91e8c">
      ⚠ 承認済み希望休 ${offConflictRows.length}件も上書きされます（インポートシフトが最優先）
    </div>`;
  }

  const todayStr = todayJST();
  const futureValidRows = rows.filter(r => r.date >= todayStr);
  const pastValidRows   = rows.filter(r => r.date <  todayStr);

  if (pastValidRows.length) {
    html += `<div style="background:#f3f4f6;border-radius:6px;padding:8px 12px;font-size:11px;margin-bottom:8px;color:var(--ink3);border-left:3px solid var(--ink3)">
      🔒 過去のシフト ${pastValidRows.length}件 — 変更なし（保護されます）
    </div>`;
  }

  if (futureValidRows.length > 0) {
    html += `<div style="background:var(--surface2);border-radius:8px;padding:12px;margin-bottom:8px">
      <div style="font-weight:700;font-size:12px;margin-bottom:6px">
        🔄 上書き登録：<span style="color:var(--accent2)">${futureValidRows.length}件</span>
        <span style="font-weight:400;color:var(--ink3);margin-left:8px">（${new Set(futureValidRows.map(r=>r.name)).size}名分 / 本日以降）</span>
      </div>
      <div style="font-size:11px;color:var(--ink3);margin-bottom:8px">⚠ 本日以降の既存シフトは削除され、このデータで置き換えられます（希望休は保護）</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px">
        ${Object.entries(byMember).map(([name, mrows]) => {
          const v = mrows.filter(r => !r.hasConflict && r.date >= todayStr);
          if (!v.length) return '';
          const c = mrows.filter(r => r.hasConflict).length;
          const noUid = mrows[0] && !mrows[0].uid;
          const borderColor = noUid ? 'var(--accent)' : c ? '#e91e8c' : 'var(--accent2)';
          return `<div style="background:var(--surface);border-radius:6px;padding:8px 10px;border-left:3px solid ${borderColor}">
            <div style="font-weight:700;font-size:12px;margin-bottom:3px;color:${noUid?'var(--accent)':'inherit'}">${name}${noUid?' ⚠ UID未解決':''}</div>
            <div style="font-size:10px;color:${noUid?'var(--accent)':'var(--ink3)'}">
              ${noUid?'👁 管理者のみ表示':''}
              ${!noUid?v.length+'件'+(c?` / 希望休スキップ${c}件`:''):''}
            </div>
            <div style="font-size:10px;color:var(--ink3);font-family:'DM Mono',monospace;margin-top:2px">
              ${v.slice(0,3).map(r=>r.date.slice(5)).join('　')}${v.length>3?` 他${v.length-3}件`:''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
    execBtn.disabled = false;
    execBtn.textContent = `🔄 ${futureValidRows.length}件を上書き登録する`;
  } else {
    html += `<div style="text-align:center;padding:16px;color:var(--ink3);font-size:12px">本日以降の登録できるシフトデータがありませんでした</div>`;
    execBtn.disabled = true;
  }
  prevEl.innerHTML = html;
}

export async function addMemberFromCSV(encodedName) {
  const name = decodeURIComponent(encodedName);
  const attrEl = document.getElementById(`new-member-attr-${encodedName}`);
  const attr = attrEl ? attrEl.value : '社員';
  const btn = attrEl?.parentElement?.querySelector('button');
  if (btn) { btn.disabled = true; btn.textContent = '登録中...'; }

  try {
    const uid = (attr === '委託' ? 'alliance_' : 'member_') + Date.now() + '_' + Math.random().toString(36).slice(2,5);
    await setDoc(doc(db, 'users', uid), {
      uid, name, dept: '', role: 'member',
      attr: attr === '委託' ? '委託' : '',
      noAuth: attr === '委託',
      createdAt: new Date().toISOString()
    });
    await window.loadUsers?.();
    if (btn) {
      btn.parentElement.innerHTML = `<span style="font-weight:600;font-size:12px;flex:1">${name}</span><span style="font-size:10px;color:var(--accent2);font-weight:700">✅ 登録しました</span>`;
    }
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = '＋ 追加'; }
    alert('登録エラー: ' + e.message);
  }
}

export async function deleteMemberFromCSVCheck(uid, encodedName) {
  const name = decodeURIComponent(encodedName);
  if (!confirm(`「${name}」をメンバーから削除しますか？\n※勤怠・シフトデータは残ります`)) return;
  const rowEl = document.querySelector(`button[onclick="deleteMemberFromCSVCheck('${uid}','${encodedName}')"]`)?.parentElement;
  try {
    await deleteDoc(doc(db, 'users', uid));
    await window.loadUsers?.();
    if (rowEl) rowEl.innerHTML = `<span style="font-weight:600;font-size:12px;flex:1;text-decoration:line-through;color:var(--ink3)">${name}</span><span style="font-size:10px;color:var(--accent);font-weight:700">🗑 削除しました</span>`;
  } catch(e) {
    alert('削除エラー: ' + e.message);
  }
}

export function autoBulkPreview() {
  clearTimeout(_bulkPreviewTimer);
  _bulkPreviewTimer = setTimeout(() => previewBulkShiftImport(), 600);
}

export async function openBulkShiftImportModal() {
  if (!window._cachedShops?.length) {
    try { await window.loadShops?.(); } catch(e) {}
  }
  if (!isAdmin()) return;
  _bulkImportRows = [];
  document.getElementById('modal-title-text').textContent = '👥 全員一括シフトインポート';
  document.getElementById('modal-body').innerHTML = `
    <div style="display:flex;border-bottom:2px solid var(--border);margin-bottom:16px;gap:0">
      <button id="bulk-tab-csv" onclick="switchBulkTab('csv')"
        style="padding:8px 18px;font-size:12px;font-weight:700;border:none;border-bottom:2px solid var(--accent2);margin-bottom:-2px;background:transparent;color:var(--accent2);cursor:pointer">
        📁 シフト表CSVをアップロード
      </button>
      <button id="bulk-tab-paste" onclick="switchBulkTab('paste')"
        style="padding:8px 18px;font-size:12px;font-weight:700;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;background:transparent;color:var(--ink3);cursor:pointer">
        📋 コピペで入力
      </button>
    </div>
    <div id="bulk-panel-csv">
      <div style="background:var(--surface2);padding:12px 14px;border-radius:6px;margin-bottom:14px;font-size:12px;line-height:1.7">
        <div style="font-weight:700;margin-bottom:4px">📌 RegalCastシフト表CSVをそのままアップロードできます</div>
        <div style="color:var(--ink3)">
          ✅ 「氏名」列と日別シフト列を自動で読み取ります<br>
          ✅ 公休・希望休・有給・調整中などは自動除外<br>
          ✅ 開始10:00 / 終了19:00 で登録（後から編集可）<br>
          ✅ アプリ未登録メンバーは警告を表示
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:14px;align-items:flex-end;flex-wrap:wrap">
        <div style="flex:1;min-width:160px">
          <label class="form-label">対象年</label>
          <select class="form-input" id="csv-upload-year" style="width:auto">
            ${[2025,2026,2027].map(y=>`<option value="${y}" ${y===new Date().getFullYear()?'selected':''}>${y}年</option>`).join('')}
          </select>
        </div>
        <div style="flex:1;min-width:160px">
          <label class="form-label">対象月</label>
          <select class="form-input" id="csv-upload-month-num" style="width:auto">
            ${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${i+1===new Date().getMonth()+1?'selected':''}>${i+1}月</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:6px;padding-bottom:2px">
          <input type="checkbox" id="csv-skip-existing" checked>
          <label for="csv-skip-existing" style="font-size:12px">同日の既存シフトをスキップ</label>
        </div>
      </div>
      <div id="csv-dropzone"
        onclick="document.getElementById('csv-file-input').click()"
        ondragover="event.preventDefault();this.style.borderColor='var(--accent2)';this.style.background='#f0fdf4'"
        ondragleave="this.style.borderColor='var(--border)';this.style.background=''"
        ondrop="event.preventDefault();this.style.borderColor='var(--border)';this.style.background='';handleShiftCSVDrop(event)"
        style="border:2px dashed var(--border);border-radius:10px;padding:32px;text-align:center;cursor:pointer;transition:all .2s;margin-bottom:12px">
        <div style="font-size:28px;margin-bottom:8px">📁</div>
        <div style="font-weight:700;font-size:13px;margin-bottom:4px">CSVファイルをここにドロップ</div>
        <div style="font-size:11px;color:var(--ink3)">または クリックしてファイルを選択</div>
        <input type="file" id="csv-file-input" accept=".csv" style="display:none" onchange="handleShiftCSVFile(this)">
      </div>
      <div id="csv-upload-preview" style="margin-bottom:12px"></div>
    </div>
    <div id="bulk-panel-paste" style="display:none">
      <div style="background:var(--surface2);padding:12px 14px;border-radius:6px;margin-bottom:14px;font-size:12px;line-height:1.9">
        <div style="font-weight:700;margin-bottom:6px">📌 貼り付け形式（名前列を追加）</div>
        <div style="font-family:'DM Mono',monospace;background:var(--bg);padding:8px;border-radius:4px;font-size:11px;white-space:nowrap;overflow-x:auto">
          名前　　　　日付　　　　開始　　終了　　　場所（省略可）<br>
          中田勝馬　　2026-04-01　10:00　19:00　　渋谷店<br>
          岩崎七海　　2026-04-01　11:00　20:00　　新宿店
        </div>
        <div style="margin-top:8px;color:var(--ink3)">
          ✅ タブ区切り・カンマ区切り対応 &nbsp;✅ 日付：2026-04-01 / 4/1 等
        </div>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:12px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <label class="form-label">対象月（重複チェック用）</label>
          <input type="month" class="form-input" id="bulk-import-month" value="${new Date().toISOString().slice(0,7)}">
        </div>
        <div style="display:flex;align-items:center;gap:6px;padding-top:18px">
          <input type="checkbox" id="bulk-skip-existing" checked>
          <label for="bulk-skip-existing" style="font-size:12px">同日の既存シフトをスキップ</label>
        </div>
      </div>
      <div class="form-row">
        <label class="form-label">データを貼り付け <span style="color:var(--accent)">*</span></label>
        <textarea class="form-input" id="bulk-import-csv" rows="10"
          placeholder="スプレッドシートからコピーしたデータをここに貼り付けてください&#10;例：&#10;中田勝馬	2026-04-01	10:00	19:00	渋谷店"
          style="font-family:'DM Mono',monospace;font-size:12px;resize:vertical"
          oninput="autoBulkPreview()"></textarea>
      </div>
      <div id="bulk-import-preview" style="margin-bottom:12px"></div>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary" id="bulk-preview-btn" onclick="previewBulkShiftImport()" style="display:none">👁 プレビュー確認</button>
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" id="bulk-import-exec-btn" onclick="execBulkShiftImport()" disabled>✅ 一括登録する</button>
    </div>`;
  window.openModal();
}

export function switchBulkTab(tab) {
  const isCSV = tab === 'csv';
  document.getElementById('bulk-panel-csv').style.display   = isCSV ? '' : 'none';
  document.getElementById('bulk-panel-paste').style.display = isCSV ? 'none' : '';
  document.getElementById('bulk-tab-csv').style.borderBottomColor   = isCSV ? 'var(--accent2)' : 'transparent';
  document.getElementById('bulk-tab-csv').style.color               = isCSV ? 'var(--accent2)' : 'var(--ink3)';
  document.getElementById('bulk-tab-paste').style.borderBottomColor = isCSV ? 'transparent' : 'var(--accent2)';
  document.getElementById('bulk-tab-paste').style.color             = isCSV ? 'var(--ink3)' : 'var(--accent2)';
  const previewBtn = document.getElementById('bulk-preview-btn');
  if (previewBtn) previewBtn.style.display = isCSV ? 'none' : '';
  _bulkImportRows = [];
  document.getElementById('bulk-import-exec-btn').disabled = true;
}

export async function previewBulkShiftImport() {
  const raw = document.getElementById('bulk-import-csv')?.value.trim();
  const prevEl = document.getElementById('bulk-import-preview');
  if (!raw) { if(prevEl) prevEl.innerHTML = ''; return; }

  _bulkImportRows = [];
  const errors = [];
  const unknownNames = new Set();
  const nameMap = {};
  RC._cachedMembers.forEach(m => { if (m.name) nameMap[m.name] = m.id; });

  const month = document.getElementById('bulk-import-month')?.value;
  let approvedOffDates = new Set();
  try {
    const offSnap = await getDocs(query(collection(db,'shifts'), where('type','==','off'), where('approved','==',true), where('month','==',month)));
    offSnap.docs.forEach(d => { const data=d.data(); approvedOffDates.add(`${data.name}_${data.date}`); });
  } catch(e) {}

  const parseTime = t => {
    if (!t) return null;
    const s = t.replace(':','');
    if (/^\d{3,4}$/.test(s)) { const h=s.length===3?s[0]:s.slice(0,2); return `${h.padStart(2,'0')}:${s.slice(-2)}`; }
    return t.includes(':') ? t : null;
  };

  raw.split('\n').map(l=>l.trim()).filter(Boolean).forEach((line, i) => {
    const cols = line.split(/\t|,|　/).map(c=>c.trim()).filter(c=>c!=='');
    if (cols.length < 4) { errors.push(`行${i+1}: 列が足りません → "${line}"`); return; }
    const name = cols[0];
    const dc = cols[1].replace(/\//g,'-');
    let dateStr = '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(dc)) { dateStr = dc; }
    else if (/^\d{1,2}-\d{1,2}$/.test(dc)) { const y=month?month.slice(0,4):new Date().getFullYear(); const [m2,d2]=dc.split('-'); dateStr=`${y}-${m2.padStart(2,'0')}-${d2.padStart(2,'0')}`; }
    else { errors.push(`行${i+1}: 日付不正 → "${cols[1]}"`); return; }
    const st=parseTime(cols[2]), et=parseTime(cols[3]);
    if (!st||!et) { errors.push(`行${i+1}: 時刻不正 → "${cols[2]}"/"${cols[3]}"`); return; }
    const uid = nameMap[name];
    if (!uid) unknownNames.add(name);
    _bulkImportRows.push({ name, uid:uid||'', date:dateStr, startTime:st, endTime:et, location:cols[4]||'', month:dateStr.slice(0,7), hasConflict:approvedOffDates.has(`${name}_${dateStr}`), unknownName:!uid });
  });

  let html = '';
  if (errors.length) html += `<div style="background:#fee2e2;padding:10px 12px;border-radius:6px;font-size:11px;color:var(--accent);margin-bottom:8px">⚠ エラー ${errors.length}件：<br>${errors.map(e=>`• ${e}`).join('<br>')}</div>`;

  renderBulkPreviewHTML(_bulkImportRows, unknownNames, [], 'bulk-import-preview');
  if (html && prevEl) prevEl.innerHTML = html + (prevEl.innerHTML||'');
}

export async function execBulkShiftImport() {
  const validRows = _bulkImportRows;
  if (!validRows.length) return;

  const btn = document.getElementById('bulk-import-exec-btn');
  btn.disabled = true;
  btn.textContent = '登録中...';

  const todayStr = todayJST();
  const futureRows = validRows.filter(r => r.date >= todayStr);
  const pastCount  = validRows.length - futureRows.length;

  let overwritten = 0, added = 0;

  try {
    const noUidRows = futureRows.filter(r => !r.uid);
    if (noUidRows.length > 0) {
      const names = [...new Set(noUidRows.map(r => r.name))].join('、');
      if (!confirm(`⚠ 以下のメンバーはアプリ未登録のためUID紐付けができません。\nこのまま登録すると管理者には見えますがメンバー本人には表示されません。\n\n対象：${names}\n\n続けますか？`)) {
        btn.disabled = false; btn.textContent = '✅ 一括登録する'; return;
      }
    }

    const months = [...new Set(futureRows.map(r => r.month))];
    const existingDocsToDelete = [];

    btn.textContent = '既存シフト確認中...';
    for (const m of months) {
      const snap = await getDocs(query(collection(db,'shifts'), where('month','==',m)));
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.date < todayStr) return;
        existingDocsToDelete.push(d.ref);
      });
    }

    const BATCH_SIZE = 20;
    for (let i = 0; i < existingDocsToDelete.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      existingDocsToDelete.slice(i, i + BATCH_SIZE).forEach(ref => batch.delete(ref));
      await batch.commit();
      btn.textContent = `旧シフト削除中... ${Math.min(i+BATCH_SIZE, existingDocsToDelete.length)}/${existingDocsToDelete.length}件`;
    }
    overwritten = existingDocsToDelete.length;

    for (let i = 0; i < futureRows.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      futureRows.slice(i, i + BATCH_SIZE).forEach(row => {
        const ref = doc(collection(db, 'shifts'));
        batch.set(ref, {
          uid: row.uid, name: row.name,
          date: row.date, startTime: row.startTime, endTime: row.endTime,
          location: row.location, month: row.month, note: '',
          createdAt: serverTimestamp()
        });
        added++;
      });
      await batch.commit();
      btn.textContent = `登録中... ${Math.min(i+BATCH_SIZE, futureRows.length)}/${futureRows.length}件`;
    }

    const notifTargets = new Set(futureRows.map(r => `${r.uid||r.name}_${r.month}`));
    for (const key of notifTargets) {
      const [nameOrUid, month] = key.split('_');
      const member = RC._cachedMembers.find(m => m.id === nameOrUid || m.name === nameOrUid);
      if (member) writeShiftNotification({ uid: member.id, name: member.name, month }).catch(()=>{});
    }

    window.closeModal();
    loadShifts();
    alert(`✅ シフトを更新しました\n` +
      `新規登録：${added}件\n` +
      `削除した旧シフト：${overwritten}件\n` +
      `対象：${new Set(futureRows.map(r=>r.name)).size}名\n` +
      (pastCount ? `過去シフト（保護・変更なし）：${pastCount}件` : ''));

  } catch(e) {
    btn.disabled = false;
    btn.textContent = '✅ 一括登録する';
    alert('登録中にエラーが発生しました: ' + e.message);
  }
}

// ── Single member shift import ────────────────────────────

export function openShiftImportModal() {
  document.getElementById('modal-title-text').textContent = '📋 スプレッドシートからシフト一括登録';
  const memberOpts = RC._cachedMembers.map(u => `<option value="${u.id}" data-name="${u.name}">${u.name}</option>`).join('');
  document.getElementById('modal-body').innerHTML = `
    <div style="background:var(--surface2);padding:12px 14px;border-radius:6px;margin-bottom:14px;font-size:12px;line-height:1.8">
      <div style="font-weight:700;margin-bottom:6px">📌 貼り付け形式（スプレッドシートからコピー）</div>
      <div style="font-family:'DM Mono',monospace;background:var(--bg);padding:8px;border-radius:4px;font-size:11px">
        日付　　　　開始　　終了　　　出勤場所（省略可）<br>
        2026-03-10　09:00　18:00　　渋谷オフィス<br>
        2026-03-11　10:00　19:00　　〇〇クライアント先<br>
        2026-03-12　09:00　18:00<br>
        <span style="color:var(--ink3)">（タブ区切り・カンマ区切り対応）</span>
      </div>
      <div style="margin-top:8px;color:var(--ink3)">
        ✅ 日付：2026-03-10 / 2026/03/10 / 03/10 のどれでも可<br>
        ✅ 時刻：9:00 / 09:00 のどれでも可<br>
        ✅ 出勤場所は4列目に入力（空欄でもOK）
      </div>
    </div>
    <div class="form-row"><label class="form-label">対象メンバー</label>
      <select class="form-input" id="import-member">${memberOpts}</select></div>
    <div class="form-row"><label class="form-label">データを貼り付け <span style="color:var(--accent)">*</span></label>
      <textarea class="form-input" id="import-csv" rows="8"
        placeholder="スプレッドシートからコピーしたデータをここに貼り付けてください&#10;例：&#10;2026-03-10	09:00	18:00	渋谷オフィス&#10;2026-03-11	10:00	19:00	〇〇クライアント先"
        style="font-family:'DM Mono',monospace;font-size:12px;resize:vertical"></textarea></div>
    <div id="import-preview" style="margin-bottom:12px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="previewShiftImport()">👁 プレビュー確認</button>
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" id="import-exec-btn" onclick="execShiftImport()" disabled>✅ 一括登録する</button>
    </div>`;
  window.openModal();
}

export async function previewShiftImport() {
  const raw = document.getElementById('import-csv').value.trim();
  const memberEl = document.getElementById('import-member');
  const uid = memberEl.value;
  const memberName = memberEl.options[memberEl.selectedIndex].dataset.name || memberEl.options[memberEl.selectedIndex].text;
  const prevEl = document.getElementById('import-preview');
  if (!raw) { prevEl.innerHTML = '<div style="color:var(--accent);font-size:12px">データを貼り付けてください</div>'; return; }

  _importRows = [];
  const errors = [];
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

  lines.forEach((line, i) => {
    const cols = line.split(/\t|,|　| {2,}/).map(c => c.trim()).filter(Boolean);
    if (cols.length < 3) { errors.push(`行${i+1}: 列が足りません → "${line}"`); return; }

    let dateStr = '';
    const dc = cols[0].replace(/\//g,'-');
    if (/^\d{4}-\d{2}-\d{2}$/.test(dc)) {
      dateStr = dc;
    } else if (/^\d{1,2}-\d{1,2}$/.test(dc)) {
      const year = new Date().getFullYear();
      const [m2,d2] = dc.split('-');
      dateStr = `${year}-${m2.padStart(2,'0')}-${d2.padStart(2,'0')}`;
    } else { errors.push(`行${i+1}: 日付形式が不正 → "${cols[0]}"`); return; }

    const parseTime = t => {
      const s = t.replace(':','');
      if (/^\d{3,4}$/.test(s)) {
        const h = s.length===3 ? s[0] : s.slice(0,2);
        const m = s.slice(-2);
        return `${h.padStart(2,'0')}:${m}`;
      }
      return t.includes(':') ? t : null;
    };
    const st = parseTime(cols[1]), et = parseTime(cols[2]);
    if (!st || !et) { errors.push(`行${i+1}: 時刻形式が不正 → "${cols[1]}" / "${cols[2]}"`); return; }

    _importRows.push({ date: dateStr, startTime: st, endTime: et, month: dateStr.slice(0,7), location: cols[3]||'' });
  });

  const existingDates = new Set();
  if (uid && _importRows.length) {
    try {
      const months = [...new Set(_importRows.map(r => r.month))];
      for (const m of months) {
        const snap = await getDocs(query(collection(db,'shifts'), where('uid','==',uid), where('month','==',m)));
        snap.docs.forEach(d => { const data = d.data(); if (data.type !== 'off') existingDates.add(data.date); });
      }
    } catch(e) {}
  }
  const dupRows = _importRows.filter(r => existingDates.has(r.date));
  const newRows = _importRows.filter(r => !existingDates.has(r.date));

  let html = '';
  if (errors.length) {
    html += `<div style="background:#fee2e2;padding:10px;border-radius:6px;font-size:11px;font-family:'DM Mono',monospace;color:var(--accent)">
      ⚠ エラーがあります：<br>${errors.map(e=>'• '+e).join('<br>')}</div>`;
  }
  if (dupRows.length) {
    html += `<div style="background:#fff0f6;padding:10px;border-radius:6px;font-size:11px;margin-top:8px;color:#9c27b0;border-left:3px solid #e91e8c">
      🔄 以下は既存シフトを上書きします（${dupRows.length}件）：<br>
      ${dupRows.map(r=>`• ${r.date}　${r.startTime}〜${r.endTime}`).join('<br>')}</div>`;
  }
  if (newRows.length > 0 || dupRows.length > 0) {
    html += `
      <div style="margin-top:10px;font-size:12px;font-weight:700;margin-bottom:6px">🔄 登録予定（新規：${newRows.length}件${dupRows.length?` 上書：${dupRows.length}件`:''}）— ${memberName}</div>
      <div style="max-height:180px;overflow-y:auto;background:var(--surface2);border-radius:6px;padding:8px">
        ${_importRows.filter(r => r.date >= todayJST()).map(r=>`<div style="font-family:'DM Mono',monospace;font-size:11px;padding:3px 0;border-bottom:1px solid var(--border)">${r.date}　${existingDates.has(r.date)?'🔄':'✅'}　${r.startTime} 〜 ${r.endTime}${r.location ? '　📍'+r.location : ''}</div>`).join('')}
      </div>`;
    document.getElementById('import-exec-btn').disabled = false;
  } else {
    html += '<div style="font-size:12px;color:var(--ink3);margin-top:8px">登録予定のシフトがありません</div>';
    document.getElementById('import-exec-btn').disabled = true;
  }
  prevEl.innerHTML = html;
}

export async function execShiftImport() {
  if (!_importRows.length) return;
  const memberEl = document.getElementById('import-member');
  const uid  = memberEl.value;
  const name = memberEl.options[memberEl.selectedIndex].dataset.name || memberEl.options[memberEl.selectedIndex].text;
  const btn  = document.getElementById('import-exec-btn');
  btn.disabled = true; btn.textContent = '登録中...';

  const todayStr = todayJST();

  try {
    const futureRows = _importRows.filter(r => r.date >= todayStr);
    const pastCount  = _importRows.length - futureRows.length;

    if (!futureRows.length) {
      btn.disabled = false; btn.textContent = '✅ 一括登録する';
      alert(`⚠ 本日以降のシフトがありません。\n過去のシフト ${pastCount}件は変更対象外のためスキップしました。`);
      return;
    }

    const months = [...new Set(futureRows.map(r => r.month))];
    const existingFutureDocs = [];
    for (const m of months) {
      const snap = await getDocs(query(collection(db,'shifts'), where('uid','==',uid), where('month','==',m)));
      snap.docs.forEach(d => {
        const data = d.data();
        if (data.date >= todayStr) {
          existingFutureDocs.push(d.ref);
        }
      });
    }

    const BATCH_SIZE = 20;
    for (let i = 0; i < existingFutureDocs.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      existingFutureDocs.slice(i, i + BATCH_SIZE).forEach(ref => batch.delete(ref));
      await batch.commit();
    }

    let added = 0;
    for (let i = 0; i < futureRows.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      futureRows.slice(i, i + BATCH_SIZE).forEach(row => {
        const ref = doc(collection(db, 'shifts'));
        batch.set(ref, {
          uid, name, date: row.date,
          startTime: row.startTime, endTime: row.endTime,
          location: row.location || '',
          month: row.month, note: '',
          createdAt: serverTimestamp()
        });
        added++;
      });
      await batch.commit();
    }

    window.closeModal();
    loadShifts();
    const months2 = [...new Set(futureRows.map(r=>r.month))];
    months2.forEach(m => writeShiftNotification({ uid, name, month: m }).catch(()=>{}));
    alert(`✅ ${name} さんのシフトを更新しました\n` +
      `上書き登録：${added}件\n` +
      `削除した旧シフト：${existingFutureDocs.length}件\n` +
      (pastCount ? `過去シフト（保護・変更なし）：${pastCount}件` : ''));
  } catch(e) {
    btn.disabled = false; btn.textContent = '✅ 一括登録する';
    alert('登録中にエラーが発生しました: ' + e.message);
  }
}

// ── Notifications ─────────────────────────────────────────

export async function writeShiftNotification(shiftData) {
  if (!isAdmin()) return;
  const member = RC._cachedMembers.find(m => m.name === shiftData.name || m.id === shiftData.uid);
  if (!member) return;
  await addDoc(collection(db, 'shiftNotifications'), {
    uid: member.id,
    name: member.name,
    month: shiftData.month,
    type: shiftData.type || 'new',
    read: false,
    createdAt: new Date().toISOString(),
    createdBy: RC.currentUserData?.name || ''
  });
}

export async function markShiftNotifRead() {
  const ids = window._pendingShiftNotifIds || [];
  await Promise.all(ids.map(id => updateDoc(doc(db,'shiftNotifications',id), { read: true })));
  window._pendingShiftNotifIds = [];
  const taskSnap = await getDocs(collection(db,'tasks'));
  let tasks = taskSnap.docs.map(d => d.data());
  window.checkNotifications?.(tasks);
}

export async function checkNotifications() {
  const banner  = document.getElementById('notif-banner');
  const bannerM = document.getElementById('notif-banner-m');

  let html = '';

  if (!isAdmin()) {
    const myUid = RC.currentUser?.uid;
    if (myUid) {
      try {
        const shiftNotifSnap = await getDocs(query(
          collection(db, 'shiftNotifications'),
          where('uid', '==', myUid),
          where('read', '==', false)
        ));
        if (!shiftNotifSnap.empty) {
          const notifs = shiftNotifSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          const sorted = notifs.sort((a,b) => b.createdAt?.localeCompare(a.createdAt||'')||0);
          const latest = sorted[0];
          const hasUpdate = notifs.some(n => n.type === 'update');
          const hasNew    = notifs.some(n => n.type !== 'update');
          const typeLabel = hasUpdate && hasNew ? '登録・更新' : hasUpdate ? '更新' : '登録';
          html += `<div class="notif-item" style="background:#e8f5e9;border-left:3px solid var(--accent2)">
            <div class="notif-icon">📋</div>
            <div style="flex:1">
              <div class="notif-title" style="color:var(--accent2)">シフトが${typeLabel}されました ${notifs.length > 1 ? notifs.length+'件' : ''}</div>
              <div class="notif-list">${sorted.slice(0,3).map(n=>`<span class="notif-chip" style="border-color:var(--accent2)">${n.month||''} ${n.type==='update'?'🔄 更新':'✅ 新規'}</span>`).join('')}${notifs.length>3?`<span class="notif-chip">他${notifs.length-3}件</span>`:''}</div>
              <button class="mini-btn" style="margin-top:6px;color:var(--accent2);border-color:var(--accent2)" onclick="markShiftNotifRead()">確認済みにする</button>
            </div>
          </div>`;
          window._pendingShiftNotifIds = notifs.map(n => n.id);
        }
      } catch(e) {}
    }
  }


  if (banner) { banner.style.display = html ? '' : 'none'; banner.innerHTML = html; }
  if (bannerM) { bannerM.style.display = html ? '' : 'none'; bannerM.innerHTML = html; }

  const badge  = document.getElementById('notif-badge');
  const badgeM = document.getElementById('m-shift-notif-badge');
  const shiftNotifCount = window._pendingShiftNotifIds?.length || 0;
  if (shiftNotifCount > 0) {
    if (badge)  { badge.textContent  = shiftNotifCount; badge.style.display  = ''; }
    if (badgeM) { badgeM.textContent = shiftNotifCount; badgeM.style.display = ''; }
  } else {
    if (badge)  badge.style.display  = 'none';
    if (badgeM) badgeM.style.display = 'none';
  }
}

// ── Filter helper ─────────────────────────────────────────

export function filterShiftBySearch() {
  const kw = (document.getElementById('shift-search')?.value || '').toLowerCase();
  document.querySelectorAll('.shift-chip[data-name]').forEach(el => {
    const name = (el.dataset.name || '').toLowerCase();
    el.style.display = (!kw || name.includes(kw)) ? '' : 'none';
  });
}

// ── Window exports ────────────────────────────────────────
window.shiftWeekNav          = shiftWeekNav;
window.loadShifts            = loadShifts;
window.addShift              = addShift;
// ── Sync shifts from 受注管理 assignments ──────────────────

export function openSyncShiftFromOrdersModal() {
  const month = todayJST().slice(0, 7);
  const memberOpts = RC._cachedMembers.map(u => `<option value="${u.id}">${escHtml(u.name)}</option>`).join('');
  document.getElementById('modal-title-text').textContent = '🔄 受注管理からシフト同期';
  document.getElementById('modal-body').innerHTML = `
    <div style="font-size:12px;color:var(--ink3);margin-bottom:12px;line-height:1.7">
      受注管理アプリのシフト配置を勤怠アプリのシフトに同期します。<br>
      対象スタッフの既存シフト（work）を削除して受注管理の内容で上書きします。
    </div>
    <div class="form-row"><label class="form-label">対象月</label>
      <input type="month" class="form-input" id="sync-month" value="${month}"></div>
    <div class="form-row"><label class="form-label">対象スタッフ</label>
      <select class="form-input" id="sync-staff">
        <option value="all">全員</option>
        ${memberOpts}
      </select></div>
    <div style="font-size:11px;color:var(--accent);padding:8px 10px;background:rgba(200,71,42,.06);border-radius:6px;margin-bottom:12px">
      ⚠ 対象の既存シフト（work）は削除されます。有給・休暇申請はそのまま残ります。
    </div>
    <div id="sync-error" style="font-size:12px;color:var(--accent);min-height:16px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="execSyncShiftFromOrders()">同期実行</button>
    </div>`;
  openModal();
}

export async function execSyncShiftFromOrders() {
  const month   = document.getElementById('sync-month').value;
  const staffId = document.getElementById('sync-staff').value;
  if (!month) { document.getElementById('sync-error').textContent = '月を選択してください'; return; }

  const [year, mon] = month.split('-');
  const monthStart = `${month}-01`;
  const lastDay    = new Date(parseInt(year), parseInt(mon), 0).getDate();
  const monthEnd   = `${month}-${String(lastDay).padStart(2, '0')}`;

  // assignments を取得（月全体を取得してクライアント側でフィルタ → インデックス不要）
  const assignSnap = await getDocs(query(
    collection(db, 'assignments'),
    where('date', '>=', monthStart),
    where('date', '<=', monthEnd)
  ));
  const assignments = assignSnap.docs.map(d => d.data())
    .filter(a => staffId === 'all' || a.staffId === staffId);

  // internalSchedules を取得（同様）
  const internalSnap = await getDocs(query(
    collection(db, 'internalSchedules'),
    where('date', '>=', monthStart),
    where('date', '<=', monthEnd)
  ));
  const internalSchedules = internalSnap.docs.map(d => d.data())
    .filter(s => staffId === 'all' || s.staffId === staffId);

  if (!assignments.length && !internalSchedules.length) {
    document.getElementById('sync-error').textContent = 'この月のシフト配置がありません';
    return;
  }

  // orders を重複排除して取得
  const orderIds = [...new Set(assignments.map(a => a.orderId))];
  const orderMap = {};
  for (const oid of orderIds) {
    const snap = await getDoc(doc(db, 'orders', oid));
    if (snap.exists()) orderMap[oid] = snap.data();
  }

  // 既存 shifts（work）を削除（month で取得してクライアント側でフィルタ）
  const existSnap = await getDocs(query(collection(db, 'shifts'), where('month', '==', month)));
  const toDelete  = existSnap.docs.filter(d => {
    const data = d.data();
    return data.type !== 'off' && (staffId === 'all' || data.uid === staffId);
  });

  const BATCH_SIZE = 400;
  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    toDelete.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  // assignments からシフトを生成
  const newShifts = [];
  for (const a of assignments) {
    const order = orderMap[a.orderId];
    const member = RC._cachedMembers.find(m => m.id === a.staffId);
    newShifts.push({
      uid:       a.staffId,
      name:      member?.name || '',
      date:      a.date,
      month:     a.date.slice(0, 7),
      startTime: order?.startTime || '10:00',
      endTime:   order?.endTime   || '19:00',
      location:  a.location || order?.title || '',
      note:      '',
      createdAt: serverTimestamp()
    });
  }

  // internalSchedules からシフトを生成
  for (const s of internalSchedules) {
    const member   = RC._cachedMembers.find(m => m.id === s.staffId);
    const location = s.type === 'ojt'      ? (s.targetStore   || '社内（OJT）')
                   : s.type === 'training' ? (s.location      || s.trainingName || '社内研修')
                   : s.type === 'office'   ? (s.officeWork?.category || '社内業務')
                   :                         (s.content        || '社内');
    newShifts.push({
      uid:       s.staffId,
      name:      member?.name || '',
      date:      s.date,
      month:     s.date.slice(0, 7),
      startTime: '10:00',
      endTime:   '19:00',
      location,
      note:      s.note || '',
      createdAt: serverTimestamp()
    });
  }

  for (let i = 0; i < newShifts.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    newShifts.slice(i, i + BATCH_SIZE).forEach(s => batch.set(doc(collection(db, 'shifts')), s));
    await batch.commit();
  }

  closeModal();
  loadShifts();
  alert(`✅ ${newShifts.length}件のシフトを同期しました`);
}

window.openAddShiftModal     = openAddShiftModal;
window.onShiftMemberChange   = onShiftMemberChange;
window.openEditShiftModal    = openEditShiftModal;
window.saveOffEdit           = saveOffEdit;
window.saveShiftEdit         = saveShiftEdit;
window.deleteShift           = deleteShift;
window.markAbsentFromTable   = markAbsentFromTable;
window.markAbsent            = markAbsent;
window.cancelAbsent          = cancelAbsent;
window.openDeleteMemberShiftModal = openDeleteMemberShiftModal;
window.loadDeleteShiftPreview     = loadDeleteShiftPreview;
window.execDeleteMemberShifts     = execDeleteMemberShifts;
window.openBulkShiftImportModal   = openBulkShiftImportModal;
window.switchBulkTab         = switchBulkTab;
window.handleShiftCSVFile    = handleShiftCSVFile;
window.handleShiftCSVDrop    = handleShiftCSVDrop;
window.addMemberFromCSV      = addMemberFromCSV;
window.deleteMemberFromCSVCheck = deleteMemberFromCSVCheck;
window.autoBulkPreview       = autoBulkPreview;
window.previewBulkShiftImport = previewBulkShiftImport;
window.execBulkShiftImport   = execBulkShiftImport;
window.openShiftImportModal  = openShiftImportModal;
window.previewShiftImport    = previewShiftImport;
window.execShiftImport       = execShiftImport;
window.writeShiftNotification = writeShiftNotification;
window.markShiftNotifRead    = markShiftNotifRead;
window.checkNotifications    = checkNotifications;
window.filterShiftBySearch         = filterShiftBySearch;
window.openSyncShiftFromOrdersModal = openSyncShiftFromOrdersModal;
window.execSyncShiftFromOrders      = execSyncShiftFromOrders;

// Compatibility shim: inline onclick handlers use `_shiftWeekOffset=0`
// which sets window._shiftWeekOffset; proxy this to RC._shiftWeekOffset
Object.defineProperty(window, '_shiftWeekOffset', {
  get() { return RC._shiftWeekOffset || 0; },
  set(v) { RC._shiftWeekOffset = v; },
  configurable: true
});
