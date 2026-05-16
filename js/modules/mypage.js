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

function _isRequestLocked() {
  return new Date().getDate() > 20;
}

export function openRequestOffModal() {
  const locked = _isRequestLocked();
  const { yearMonth, min, max } = _getNextMonthRange();
  const [y, m] = yearMonth.split('-');
  const nextMonthLabel = `${y}年${Number(m)}月`;

  if (locked) {
    document.getElementById('modal-title-text').textContent = '🙏 希望休を申請する';
    document.getElementById('modal-body').innerHTML = `
      <div style="background:rgba(200,71,42,.08);border:1px solid rgba(200,71,42,.2);border-radius:8px;padding:14px 16px;font-size:13px;color:var(--accent);line-height:1.7">
        🔒 毎月20日以降は希望休の申請・変更ができません。<br>
        <span style="font-size:11px;color:var(--ink3)">翌月分（${nextMonthLabel}）の申請は翌月1日〜20日の間にお願いします。</span>
      </div>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn btn-secondary" onclick="closeModal()">閉じる</button>
      </div>`;
    window.openModal();
    return;
  }

  document.getElementById('modal-title-text').textContent = '🙏 希望休を申請する';
  document.getElementById('modal-body').innerHTML = `
    <div style="background:var(--surface2);padding:10px 14px;border-radius:6px;font-size:12px;color:var(--ink3);margin-bottom:14px;line-height:1.7">
      <strong>${nextMonthLabel}分</strong>の希望休を申請します。承認・却下は管理者が行います。<br>
      <span style="color:var(--accent)">⚠ 毎月20日以降は申請できません。</span>
    </div>
    <div class="form-row"><label class="form-label">希望日 <span style="color:var(--accent)">*</span></label>
      <input type="date" class="form-input" id="off-date" min="${min}" max="${max}"></div>
    <div class="form-row"><label class="form-label">理由・メモ（任意）</label>
      <input class="form-input" id="off-note" placeholder="例：私用のため"></div>
    <div id="off-error" style="font-size:12px;color:var(--accent);min-height:16px"></div>
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

export async function submitRequestOff() {
  const date  = document.getElementById('off-date').value;
  const errEl = document.getElementById('off-error');
  if (!date) { errEl.textContent = '希望日を選択してください'; return; }

  // 20日以降はロック
  if (_isRequestLocked()) { errEl.textContent = '毎月20日以降は申請できません'; return; }

  // 翌月の日付かチェック
  const { yearMonth } = _getNextMonthRange();
  if (!date.startsWith(yearMonth)) { errEl.textContent = `翌月（${yearMonth}）の日付を選択してください`; return; }

  const uid  = RC.currentUser.uid;
  const name = RC.currentUserData.name;

  const existing = await getDocs(query(
    collection(db,'shifts'), where('uid','==',uid), where('date','==',date), where('type','==','off')
  ));
  if (!existing.empty) { errEl.textContent = 'この日はすでに希望休が登録済みです'; return; }

  await addDoc(collection(db,'shifts'), {
    uid, name, date, month: date.slice(0,7),
    type: 'off', approved: false,
    note: document.getElementById('off-note').value.trim(),
    createdAt: serverTimestamp()
  });
  window.closeModal();
  window.loadShifts?.();
  alert('✅ ' + date + ' の希望休を申請しました');
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
window.submitRequestOff     = submitRequestOff;
window.confirmDeleteOwnOff  = confirmDeleteOwnOff;
window.updateOffRequestBadge = updateOffRequestBadge;
window.approveOffRequest    = approveOffRequest;
window.rejectOffRequest     = rejectOffRequest;
window.onAttLeaderFilterChange = onAttLeaderFilterChange;
