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
    note,
    manualEdited: true,
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

async function createAbsentIrregular(uid, name, date) {
  const irregularId = `irr-absent-${uid}-${date}`;
  try {
    await setDoc(doc(db, 'irregulars', irregularId), {
      staffId: uid,
      date,
      type: '欠勤',
      deductionMinutes: 480,
      reason: '欠勤（勤怠管理より自動登録）',
      isPaid: false,
      isDeductible: true,
      status: '申請中',
      autoCreated: true,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('irregulars書き込みエラー:', e);
    alert(`イレギュラー自動登録に失敗しました\n${e.message}`);
  }
}

async function deleteAbsentIrregular(uid, date) {
  const irregularId = `irr-absent-${uid}-${date}`;
  await deleteDoc(doc(db, 'irregulars', irregularId)).catch(() => {});
}

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
  await createAbsentIrregular(uid, name, date);
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
  await createAbsentIrregular(uid, name, date);
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
  await deleteAbsentIrregular(uid, date);
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

  // 既存 shifts（work）を取得し、手動修正済みの uid+date を把握
  const existSnap = await getDocs(query(collection(db, 'shifts'), where('month', '==', month)));

  // 手動修正済みの uid_date セット（新規作成もスキップするため）
  const manualEditedKeys = new Set(
    existSnap.docs
      .filter(d => d.data().manualEdited)
      .map(d => `${d.data().uid}_${d.data().date}`)
  );

  const toDelete = existSnap.docs.filter(d => {
    const data = d.data();
    if (data.type === 'off') return false;
    if (data.manualEdited) return false;  // 手動修正済みは削除しない
    return staffId === 'all' || data.uid === staffId;
  });

  const BATCH_SIZE = 400;
  for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    toDelete.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  // assignments からシフトを生成（手動修正済みの uid+date はスキップ）
  const newShifts = [];
  for (const a of assignments) {
    const key = `${a.staffId}_${a.date}`;
    if (manualEditedKeys.has(key)) continue;  // 手動修正済みはスキップ
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

  // internalSchedules からシフトを生成（手動修正済みの uid+date はスキップ）
  for (const s of internalSchedules) {
    const key = `${s.staffId}_${s.date}`;
    if (manualEditedKeys.has(key)) continue;  // 手動修正済みはスキップ
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

window.openEditShiftModal    = openEditShiftModal;
window.saveOffEdit           = saveOffEdit;
window.saveShiftEdit         = saveShiftEdit;
window.deleteShift           = deleteShift;
window.markAbsentFromTable   = markAbsentFromTable;
window.markAbsent            = markAbsent;
window.cancelAbsent          = cancelAbsent;
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
