// ============================================================
// My page / shift report / alert modules
// ============================================================
import { RC, isAdmin, isLeaderOrAbove } from '../state.js';
import {
  db, collection, doc, setDoc, getDoc, getDocs, addDoc, deleteDoc,
  query, where, orderBy, serverTimestamp, updateDoc
} from '../firebase.js';
import { todayJST } from '../utils/helpers.js';

// ── My Shift Report ───────────────────────────────────────

let _myShiftSelections = {};
let _myShiftMonth      = '';

export async function loadMyShiftReport() {
  const month = document.getElementById('myshift-month')?.value
             || document.getElementById('myshift-month-m')?.value
             || new Date().toISOString().slice(0,7);
  _myShiftMonth = month;
  ['myshift-month','myshift-month-m'].forEach(id => { const el=document.getElementById(id); if(el) el.value=month; });

  const snap = await getDocs(query(collection(db,'shifts'), where('uid','==',RC.currentUser.uid), where('month','==',month)));
  _myShiftSelections = {};
  snap.docs.forEach(d => {
    const s = d.data();
    if (s.type !== 'off' && s.date) _myShiftSelections[s.date] = 'work';
  });
  renderMyShiftCalendar();
}

export function toggleMyShiftDay(dateStr) {
  const current = _myShiftSelections[dateStr];
  if (!current) _myShiftSelections[dateStr] = 'work';
  else          _myShiftSelections[dateStr] = null;
  renderMyShiftCalendar();
}

export function setMyShiftPreset(start, end) {
  ['myshift-start','myshift-start-m'].forEach(id => { const el=document.getElementById(id); if(el) el.value=start; });
  ['myshift-end','myshift-end-m'].forEach(id =>   { const el=document.getElementById(id); if(el) el.value=end;   });
}

export function clearMyShiftSelection() {
  _myShiftSelections = {};
  renderMyShiftCalendar();
}

function renderMyShiftCalendar() {
  const month = _myShiftMonth;
  if (!month) return;
  const [year, mon] = month.split('-').map(Number);
  const daysInMonth = new Date(year, mon, 0).getDate();
  const firstDay    = new Date(year, mon-1, 1).getDay();
  const dayNames    = ['日','月','火','水','木','金','土'];
  const today       = todayJST();

  let workCount = 0;
  Object.values(_myShiftSelections).forEach(v => { if(v==='work') workCount++; });

  const buildCal = () => {
    let h = `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:12px">`;
    dayNames.forEach((d,i) => {
      h += `<div style="text-align:center;font-size:10px;font-weight:700;padding:5px 0;color:${i===0?'var(--accent)':i===6?'var(--blue)':'var(--ink3)'};">${d}</div>`;
    });
    for (let i=0; i<firstDay; i++) h += '<div></div>';
    for (let d=1; d<=daysInMonth; d++) {
      const dateStr = `${month}-${String(d).padStart(2,'0')}`;
      const dow     = new Date(year,mon-1,d).getDay();
      const sel     = _myShiftSelections[dateStr];
      const isToday = dateStr === today;
      const isPast  = dateStr < today;

      let bg = 'var(--surface2)', border = '1px dashed var(--border)', icon = '', textColor = 'var(--ink)';
      if (sel === 'work') { bg='rgba(42,82,152,.15)'; border='2px solid var(--blue)'; icon='🟢'; }
      else if (dow===0||dow===6) { bg='rgba(0,0,0,.02)'; textColor=dow===0?'var(--accent)':'var(--blue)'; }
      if (isToday) border = sel==='work' ? '2.5px solid var(--blue)' : '2.5px solid var(--ink)';

      h += `<div onclick="toggleMyShiftDay('${dateStr}')"
        style="aspect-ratio:1;border-radius:8px;background:${bg};border:${border};display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:all .15s;user-select:none;${isPast?'opacity:.6':''}"
        title="${dateStr}">
        <div style="font-size:13px;font-weight:${isToday?'900':'600'};color:${textColor};line-height:1">${d}</div>
        ${icon ? `<div style="font-size:10px;line-height:1;margin-top:2px">${icon}</div>` : `<div style="height:12px"></div>`}
      </div>`;
    }
    h += '</div>';
    h += `<div style="display:flex;gap:10px;flex-wrap:wrap;font-size:12px;padding:10px 12px;background:var(--surface2);border-radius:8px">
      <span>🟢 出勤日：<strong style="color:var(--blue)">${workCount}日</strong></span>
      <span style="color:var(--ink3)">未選択：${daysInMonth - workCount}日</span>
    </div>`;
    return h;
  };

  const calHtml = buildCal();
  ['myshift-calendar','myshift-calendar-m'].forEach(id => { const el=document.getElementById(id); if(el) el.innerHTML=calHtml; });
}

export async function submitMyShift() {
  const month = _myShiftMonth;
  if (!month) { alert('月を選択してください'); return; }

  const startTime = document.getElementById('myshift-start')?.value || document.getElementById('myshift-start-m')?.value || '10:00';
  const endTime   = document.getElementById('myshift-end')?.value   || document.getElementById('myshift-end-m')?.value   || '19:00';
  const location  = document.getElementById('myshift-location')?.value || document.getElementById('myshift-location-m')?.value || '';

  const workDays = Object.entries(_myShiftSelections).filter(([,v])=>v==='work').map(([d])=>d);
  if (!workDays.length) { alert('出勤日を1日以上選択してください'); return; }
  if (!confirm(`${month} のシフトを報告します。\n🟢 出勤日：${workDays.length}日\n既存の報告は上書きされます。よろしいですか？`)) return;

  const existSnap = await getDocs(query(collection(db,'shifts'), where('uid','==',RC.currentUser.uid), where('month','==',month)));
  const deletes = existSnap.docs.filter(d => d.data().type !== 'off').map(d => deleteDoc(d.ref));
  await Promise.all(deletes);

  const writes = workDays.map(date => {
    const docId = RC.currentUser.uid + '_' + date + '_self';
    return setDoc(doc(db, 'shifts', docId), {
      uid: RC.currentUser.uid,
      name: RC.currentUserData.name,
      date, month, startTime, endTime, location,
      type: 'work', selfReport: true,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    });
  });
  await Promise.all(writes);

  window.writeShiftNotification?.({
    name: RC.currentUserData.name,
    date: month,
    selfReport: true,
    workDays: workDays.length,
    offDays: 0
  }).catch(()=>{});

  alert(`✅ シフトを報告しました！\n🟢 出勤日：${workDays.length}日`);
  loadMyShiftReport();
}

// ── Off request ───────────────────────────────────────────

// ── 希望休の申請可否チェック ──────────────────────────────
function _getNextMonthRange() {
  const now  = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const last = new Date(next.getFullYear(), next.getMonth() + 1, 0);
  const pad  = n => String(n).padStart(2, '0');
  return {
    yearMonth: `${next.getFullYear()}-${pad(next.getMonth() + 1)}`,
    min: `${next.getFullYear()}-${pad(next.getMonth() + 1)}-01`,
    max: `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(last.getDate())}`,
  };
}

const MAX_HOLIDAY_DAYS = 3; // 1ヶ月の希望休上限

function _isRequestLocked() {
  return new Date().getDate() > 15; // 毎月15日が期日
}

export async function openRequestOffModal() {
  const locked = _isRequestLocked();
  const { yearMonth, min, max } = _getNextMonthRange();
  const [y, m] = yearMonth.split('-');
  const nextMonthLabel = `${y}年${Number(m)}月`;

  if (locked) {
    document.getElementById('modal-title-text').textContent = '🙏 希望休を申請する';
    document.getElementById('modal-body').innerHTML = `
      <div style="background:rgba(200,71,42,.08);border:1px solid rgba(200,71,42,.2);border-radius:8px;padding:14px 16px;font-size:13px;color:var(--accent);line-height:1.7">
        🔒 毎月15日以降は希望休の申請・変更ができません。<br>
        <span style="font-size:11px;color:var(--ink3)">翌月分（${nextMonthLabel}）の申請は毎月1日〜15日までにお願いします。</span>
      </div>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn btn-secondary" onclick="closeModal()">閉じる</button>
      </div>`;
    window.openModal();
    return;
  }

  // 翌月カレンダーのグリッドを生成（既申請日は除外）
  const existingSnap = await getDocs(query(
    collection(db,'shifts'),
    where('uid','==',RC.currentUser.uid),
    where('month','==',yearMonth),
    where('type','==','off'),
  ));
  const existingDates = new Set(existingSnap.docs.map(d => d.data().date));

  const [ny, nm] = yearMonth.split('-').map(Number);
  const daysInMonth = new Date(ny, nm, 0).getDate();
  const firstDow    = (new Date(ny, nm - 1, 1).getDay() + 6) % 7; // 月=0
  const DOW = ['月','火','水','木','金','土','日'];

  let calHTML = `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px;margin-bottom:4px">`;
  DOW.forEach(d => { calHTML += `<div style="text-align:center;font-size:10px;color:var(--ink3);font-weight:700;padding:2px 0">${d}</div>`; });
  calHTML += '</div><div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px">';
  for (let i = 0; i < firstDow; i++) calHTML += '<div></div>';
  for (let day = 1; day <= daysInMonth; day++) {
    const pad     = String(day).padStart(2,'0');
    const dateStr = `${yearMonth}-${pad}`;
    const dow     = (firstDow + day - 1) % 7;
    const isSat   = dow === 5, isSun = dow === 6;
    const isWeekend = isSat || isSun;
    const already = existingDates.has(dateStr);
    const noMore  = remaining <= 0 && !already; // 上限到達で新規不可
    const blocked = isWeekend || noMore;

    let color, bg, sublabel = '';
    if (already) {
      color = 'var(--accent2)'; bg = 'rgba(58,125,90,.12)';
      sublabel = '<div style="font-size:8px;color:var(--accent2)">申請済</div>';
    } else if (isWeekend) {
      color = isSun ? 'rgba(229,57,53,.3)' : 'rgba(26,115,232,.3)'; bg = 'rgba(0,0,0,.03)';
      sublabel = `<div style="font-size:7px;color:rgba(0,0,0,.25)">${isSun?'要相談':'要相談'}</div>`;
    } else if (noMore) {
      color = 'rgba(0,0,0,.2)'; bg = 'rgba(0,0,0,.03)';
    } else {
      color = 'var(--ink)'; bg = 'var(--surface)';
    }

    calHTML += `<div
      class="holiday-day${already ? ' already' : ''}"
      data-date="${dateStr}"
      onclick="${!blocked ? 'toggleHolidayDay(this)' : ''}"
      style="text-align:center;padding:6px 2px;border:1px solid ${blocked && !already ? 'rgba(0,0,0,.06)' : 'var(--border)'};border-radius:6px;font-size:12px;font-weight:600;color:${color};background:${bg};cursor:${blocked ? 'not-allowed' : 'pointer'};user-select:none">
      ${day}${sublabel}
    </div>`;
  }
  calHTML += '</div>';

  const usedDays = existingDates.size; // 既に申請済みの日数
  const remaining = MAX_HOLIDAY_DAYS - usedDays;

  document.getElementById('modal-title-text').textContent = '🙏 希望休を申請する';
  document.getElementById('modal-body').innerHTML = `
    <div style="background:#fff8e1;border:1px solid #ffe082;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:11px;line-height:1.9;color:var(--ink2)">
      <div style="font-weight:700;font-size:12px;margin-bottom:4px">📋 希望休 申請ルール</div>
      <div>📅 <strong>提出期日：</strong>毎月15日まで（翌月分）</div>
      <div>📆 <strong>上限日数：</strong>月 ${MAX_HOLIDAY_DAYS}日まで　→　残り <strong style="color:${remaining <= 0 ? 'var(--accent)' : 'var(--accent2)'}">${remaining}日</strong></div>
      <div>🚫 <strong>土日祝：</strong>直接選択不可。希望する場合は理由を添えて事前相談→承認後に登録</div>
    </div>
    <div style="margin-bottom:10px">${calHTML}</div>
    <div id="off-selected" style="font-size:11px;color:var(--ink3);margin-bottom:8px">選択中：なし</div>
    <div id="off-error" style="font-size:12px;color:var(--accent);min-height:14px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="submitRequestOff()">申請する</button>
    </div>`;
  window.openModal();
}

export function onOffMemberChange(sel) {
  const opt = sel.options[sel.selectedIndex];
  document.getElementById('off-uid').value  = sel.value;
  document.getElementById('off-name').value = opt.dataset.name;
}

export function toggleHolidayDay(el) {
  const selected = el.classList.toggle('holiday-selected');
  el.style.background = selected ? 'rgba(200,71,42,.15)' : 'var(--surface)';
  el.style.borderColor = selected ? 'var(--accent)' : 'var(--border)';
  el.style.fontWeight  = selected ? '800' : '600';
  // 選択中の日付一覧を更新
  const days = [...document.querySelectorAll('.holiday-day.holiday-selected')].map(d => d.dataset.date);
  const label = document.getElementById('off-selected');
  if (label) label.textContent = days.length ? `選択中：${days.join('、')}` : '選択中：なし';
}

export async function submitRequestOff() {
  const errEl = document.getElementById('off-error');
  if (_isRequestLocked()) { if (errEl) errEl.textContent = '毎月15日以降は申請できません'; return; }

  const selectedDays = [...document.querySelectorAll('.holiday-day.holiday-selected')].map(d => d.dataset.date);
  if (!selectedDays.length) { if (errEl) errEl.textContent = '希望日を選択してください'; return; }

  // 上限チェック（既存 + 今回の選択が3日を超えないか）
  const { yearMonth } = _getNextMonthRange();
  const existingSnap2 = await getDocs(query(
    collection(db,'shifts'), where('uid','==',RC.currentUser.uid), where('month','==',yearMonth), where('type','==','off')
  ));
  const existingCount = existingSnap2.size;
  if (existingCount + selectedDays.length > MAX_HOLIDAY_DAYS) {
    if (errEl) errEl.textContent = `希望休は月${MAX_HOLIDAY_DAYS}日まで（現在${existingCount}日申請済み、あと${MAX_HOLIDAY_DAYS - existingCount}日のみ追加可能）`;
    return;
  }

  const uid  = RC.currentUser.uid;
  const name = RC.currentUserData.name;

  try {
    await Promise.all(selectedDays.map(date =>
      addDoc(collection(db,'shifts'), {
        uid, name, date, month: date.slice(0,7),
        type: 'off', approved: false,
        note: '',
        createdAt: serverTimestamp(),
      })
    ));
    window.closeModal();
    window.loadShifts?.();
    alert(`✅ ${selectedDays.length}日分の希望休を申請しました`);
  } catch(e) {
    if (errEl) errEl.textContent = '申請に失敗しました: ' + e.message;
  }
}

export function confirmDeleteOwnOff(shiftId, dateStr) {
  if (_isRequestLocked()) { alert('毎月20日以降は申請の取り消しができません'); return; }
  if (!confirm(`${dateStr} の希望休申請を取り消しますか？`)) return;
  deleteDoc(doc(db,'shifts',shiftId)).then(() => window.loadShifts?.());
}

export async function updateOffRequestBadge() {
  if (!isAdmin()) return;
  const snapAll = await getDocs(query(collection(db,'shifts'), where('type','==','off')));
  const pending = snapAll.docs.filter(d => !d.data().approved).length;
  ['shift-off-badge','m-shift-off-badge'].forEach(id => {
    const badge = document.getElementById(id);
    if (badge) { badge.textContent = pending||''; badge.style.display = pending ? 'inline-flex' : 'none'; }
  });
}

export async function approveOffRequest(shiftId) {
  const shiftSnap = await getDoc(doc(db, 'shifts', shiftId));
  if (!shiftSnap.exists()) return;
  const { uid, date } = shiftSnap.data();
  const yearMonth = date.slice(0, 7);

  // shifts を承認済みに更新
  await updateDoc(doc(db,'shifts',shiftId), {
    approved: true,
    approvedBy: RC.currentUserData.name,
    approvedAt: new Date().toISOString()
  });

  // users.holidayRequests に同期（受注管理アプリが参照するフィールド）
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (userSnap.exists()) {
      const requests = (userSnap.data().holidayRequests || []).map(r => ({ ...r, dates: [...r.dates] }));
      const idx = requests.findIndex(r => r.yearMonth === yearMonth);
      if (idx >= 0) {
        if (!requests[idx].dates.includes(date)) requests[idx].dates.push(date);
      } else {
        requests.push({ yearMonth, dates: [date] });
      }
      await updateDoc(doc(db, 'users', uid), { holidayRequests: requests });
    }
  } catch(e) {
    console.warn('[approveOffRequest] holidayRequests同期エラー:', e);
  }

  window.loadShifts?.();
  updateOffRequestBadge();
}

export async function rejectOffRequest(shiftId) {
  if (!confirm('この希望休申請を却下しますか？')) return;

  // 却下前に uid/date を取得して holidayRequests から削除
  try {
    const shiftSnap = await getDoc(doc(db, 'shifts', shiftId));
    if (shiftSnap.exists()) {
      const { uid, date } = shiftSnap.data();
      const yearMonth = date.slice(0, 7);
      const userSnap = await getDoc(doc(db, 'users', uid));
      if (userSnap.exists()) {
        const requests = (userSnap.data().holidayRequests || []).map(r => ({
          ...r,
          dates: r.yearMonth === yearMonth ? r.dates.filter(d => d !== date) : [...r.dates]
        })).filter(r => r.dates.length > 0);
        await updateDoc(doc(db, 'users', uid), { holidayRequests: requests });
      }
    }
  } catch(e) {
    console.warn('[rejectOffRequest] holidayRequests同期エラー:', e);
  }

  await deleteDoc(doc(db,'shifts',shiftId));
  window.loadShifts?.();
  updateOffRequestBadge();
}

// ── Att leader filter ─────────────────────────────────────

export function onAttLeaderFilterChange() {
  window.loadMonthlyAttendance?.(true);
}

// ── Window exports ────────────────────────────────────────
window.loadMyShiftReport    = loadMyShiftReport;
window.toggleMyShiftDay     = toggleMyShiftDay;
window.setMyShiftPreset     = setMyShiftPreset;
window.clearMyShiftSelection = clearMyShiftSelection;
window.submitMyShift        = submitMyShift;
window.openRequestOffModal  = openRequestOffModal;
window.onOffMemberChange    = onOffMemberChange;
window.toggleHolidayDay     = toggleHolidayDay;
window.submitRequestOff     = submitRequestOff;
window.confirmDeleteOwnOff  = confirmDeleteOwnOff;
window.updateOffRequestBadge = updateOffRequestBadge;
window.approveOffRequest    = approveOffRequest;
window.rejectOffRequest     = rejectOffRequest;
window.onAttLeaderFilterChange = onAttLeaderFilterChange;
