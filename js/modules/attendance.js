// ============================================================
// Attendance module (出退勤)
// ============================================================
import { RC, isAdmin, isLeaderOrAbove } from '../state.js';
import {
  db, collection, doc, setDoc, getDoc, getDocs, addDoc,
  updateDoc, deleteDoc, query, where, orderBy, serverTimestamp, writeBatch
} from '../firebase.js';
import { MENTAL_WEATHER } from '../data/constants.js';
import { openModal, closeModal } from '../utils/modal.js';
import { todayJST, getMonthEnd, fmtDate, escHtml } from '../utils/helpers.js';

// ── State ─────────────────────────────────────────────────
let _cachedAttendance = [];
let _attDetailFilter  = 'all';
let _clockInCooldown  = false;
let _clockOutCooldown = false;
let _lastAttLoad      = 0;
const ATT_COOLDOWN_MS = 5 * 60 * 1000; // 5分

// 月ごとの「当該月に勤怠入力があるメンバーuid」キャッシュ
const _monthActiveUidsCache = new Map();

async function fetchMonthActiveUids(month) {
  if (_monthActiveUidsCache.has(month)) return _monthActiveUidsCache.get(month);
  const start = month + '-01';
  const end   = getMonthEnd(month);
  const snap = await getDocs(query(
    collection(db,'attendance'),
    where('date','>=',start), where('date','<=',end)
  ));
  const uids = new Set();
  snap.docs.forEach(d => { const r = d.data(); if (r.uid) uids.add(r.uid); });
  _monthActiveUidsCache.set(month, uids);
  return uids;
}

function invalidateMonthActiveUidsCache(month) {
  if (month) _monthActiveUidsCache.delete(month);
  else _monthActiveUidsCache.clear();
}

// 指定selectIdsのプルダウンを「当該月に勤怠入力ありメンバー」に絞り込む
export async function populateMonthMemberFilters(month, selectIds) {
  if (!month) return;
  let uids;
  try {
    uids = await fetchMonthActiveUids(month);
  } catch (e) {
    console.warn('当該月メンバー絞込の取得に失敗（全員表示にフォールバック）:', e);
    uids = null;
  }
  const source = RC._cachedMembers.filter(m => !m.isAlliance);
  const activeMembers = uids ? source.filter(m => uids.has(m.id)) : source;
  selectIds.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">全員</option>'
      + activeMembers.map(u => `<option value="${u.id}">${escHtml(u.name||'')}</option>`).join('');
    if (prev && activeMembers.find(m => m.id === prev)) sel.value = prev;
    else sel.value = '';
  });
}
window.populateMonthMemberFilters = populateMonthMemberFilters;

// ── GPS helper ────────────────────────────────────────────

function getCurrentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 60000 }
    );
  });
}

function getVal(...ids) {
  for (const id of ids) { const el = document.getElementById(id); if (el && el.value !== '') return el.value; }
  return '';
}
function getInt(...ids) { return parseInt(getVal(...ids)) || 0; }

// ── Clock in / out ────────────────────────────────────────

export async function clockIn() {
  if (_clockInCooldown) { alert('少し待ってから操作してください'); return; }
  const today = todayJST();
  const ref   = doc(db, 'attendance', `${RC.currentUser.uid}_${today}`);
  const snap  = await getDoc(ref);
  if (snap.exists() && snap.data().clockIn) { alert('本日はすでに出勤済みです'); return; }

  const fareIn      = getInt('att-fare-in','att-fare-in-pc');
  const fareOther   = getInt('att-fare-other','att-fare-other-pc');
  const stationFrom = getVal('att-station-from','att-station-from-pc');
  const stationTo   = getVal('att-station-to','att-station-to-pc');
  const isLate      = document.getElementById('att-late')?.checked || document.getElementById('att-late-pc')?.checked || false;
  const lateReason  = getVal('att-late-reason','att-late-reason-pc');
  const noteVal     = getVal('attendance-note','attendance-note-pc');
  const mentalVal   = document.querySelector('input[name="mental-m"]:checked')?.value
                   || document.querySelector('input[name="mental-pc"]:checked')?.value || '';

  if (!mentalVal) { alert('メンタル天気を選択してください（必須）'); return; }

  const gps = await getCurrentPosition();
  _clockInCooldown = true;
  setTimeout(() => _clockInCooldown = false, 5000);

  // 15-minute ceiling for clock-in
  const now = new Date();
  const roundedIn = new Date(Math.ceil(now.getTime() / (15*60*1000)) * (15*60*1000));
  const clockInISO = now.toISOString();

  await setDoc(ref, {
    uid: RC.currentUser.uid,
    name: RC.currentUserData.name,
    dept: RC.currentUserData.dept || '',
    date: today,
    clockIn: clockInISO,
    clockOut: null,
    note: noteVal,
    stationFrom, stationTo,
    fareIn, fareOther,
    fare: fareIn + fareOther,
    isLate, lateReason,
    mentalWeather: mentalVal,
    ...(gps ? { clockInLat: gps.lat, clockInLng: gps.lng, clockInGpsAccuracy: gps.accuracy } : {})
  }, { merge: true });

  navigator.vibrate?.([50, 30, 100]);
  alert('出勤を記録しました ✓' + (gps ? '\n📍 位置情報を取得しました' : '\n⚠ 位置情報は取得できませんでした'));
  loadAttendanceToday();
}

export async function clockOut() {
  if (_clockOutCooldown) { alert('少し待ってから操作してください'); return; }
  const today = todayJST();
  const ref   = doc(db, 'attendance', `${RC.currentUser.uid}_${today}`);
  const snap  = await getDoc(ref);
  if (!snap.exists() || !snap.data().clockIn) { alert('先に出勤を記録してください'); return; }
  if (snap.data().clockOut) { alert('本日はすでに退勤済みです'); return; }

  const d         = snap.data();
  const fareIn    = d.fareIn    || 0;
  const fareOut   = getInt('att-fare-out','att-fare-out-pc');
  const fareOther = (d.fareOther || 0) + getInt('att-fare-other-out','att-fare-other-out-pc');
  const breakMin  = getInt('att-break','att-break-pc');
  const isEarly   = document.getElementById('att-early')?.checked || document.getElementById('att-early-pc')?.checked || false;
  const earlyReason = getVal('att-early-reason','att-early-reason-pc');
  const noteVal   = getVal('attendance-note','attendance-note-pc') || d.note || '';
  const totalFare = fareIn + fareOut + fareOther;

  const gps = await getCurrentPosition();
  _clockOutCooldown = true;
  setTimeout(() => _clockOutCooldown = false, 5000);

  await updateDoc(ref, {
    clockOut: new Date().toISOString(),
    note: noteVal, fareOut, fareOther, fare: totalFare,
    breakMinutes: breakMin, isEarly, earlyReason,
    ...(gps ? { clockOutLat: gps.lat, clockOutLng: gps.lng, clockOutGpsAccuracy: gps.accuracy } : {})
  });

  navigator.vibrate?.([100, 30, 50]);
  alert('退勤を記録しました ✓' + (gps ? '\n📍 位置情報を取得しました' : '\n⚠ 位置情報は取得できませんでした'));
  loadAttendanceToday();
}

// ── Load today ────────────────────────────────────────────

export async function loadAttendanceToday() {
  const today = todayJST();
  const ref   = doc(db, 'attendance', `${RC.currentUser.uid}_${today}`);
  const snap  = await getDoc(ref);
  const data  = snap.exists() ? snap.data() : null;

  const formatTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Tokyo' });
  };

  const statusHtml = data ? `
    <div class="att-status-card">
      <div class="att-row"><span class="att-label">出勤</span><span class="att-time ${data.clockIn?'recorded':''}">${formatTime(data.clockIn)}</span></div>
      <div class="att-row"><span class="att-label">退勤</span><span class="att-time ${data.clockOut?'recorded':''}">${formatTime(data.clockOut)}</span></div>
      ${data.mentalWeather ? `<div class="att-row"><span class="att-label">🌤 天気</span><span style="font-size:13px">${MENTAL_WEATHER[data.mentalWeather]?.icon||''} ${data.mentalWeather}</span></div>` : ''}
      ${data.fare ? `<div class="att-row"><span class="att-label">💴 交通費</span><span style="font-size:13px">¥${data.fare.toLocaleString()}</span></div>` : ''}
    </div>` : '<div class="empty" style="padding:12px">本日の記録なし</div>';

  ['attendance-status','attendance-status-m'].forEach(id => {
    const el = document.getElementById(id); if(el) el.innerHTML = statusHtml;
  });

  // Show/hide clockin/clockout forms
  const showClockIn  = !data?.clockIn;
  const showClockOut = data?.clockIn && !data?.clockOut;

  // PC
  const pcClockIn  = document.querySelector('#view-attendance #m-clockin-form');
  const pcClockOut = document.querySelector('#view-attendance #m-clockout-form');
  // Mobile
  const mClockIn   = document.getElementById('m-clockin-form');
  const mClockOut  = document.getElementById('m-clockout-form');

  if (mClockIn)   mClockIn.style.display  = showClockIn  ? '' : 'none';
  if (mClockOut)  mClockOut.style.display = showClockOut ? '' : 'none';

  // Overtime area
  const moat = document.getElementById('m-ot-request-area');
  const poat = document.getElementById('pc-ot-request-area');
  if (moat) moat.style.display = (data?.clockOut && !data?.overtimeApproved) ? '' : 'none';
  if (poat) poat.style.display = (data?.clockOut && !data?.overtimeApproved) ? '' : 'none';

  // Meeting request button (member/leader only)
  if (!isAdmin()) {
    ['m-meeting-request-area','pc-meeting-request-area'].forEach(id => {
      const el = document.getElementById(id); if(el) el.style.display = '';
    });
  }

  // Pre-fill fare template from user data
  const fareTemplates = RC.currentUserData?.fareTemplates || [];
  if (fareTemplates.length && !data?.clockIn) {
    // Auto-fill commuter routes (isCommuter = true → ¥0)
    // Just pre-fill station names from first template
    const firstTemplate = fareTemplates[0];
    if (firstTemplate?.items?.length) {
      const commuterItem = firstTemplate.items.find(i => !i.isCommuter);
      if (commuterItem) {
        const stFrom = document.getElementById('att-station-from');
        const stFromPc = document.getElementById('att-station-from-pc');
        const stTo   = document.getElementById('att-station-to');
        const stToPc = document.getElementById('att-station-to-pc');
        if (stFrom && !stFrom.value) stFrom.value = commuterItem.from || '';
        if (stFromPc && !stFromPc.value) stFromPc.value = commuterItem.from || '';
        if (stTo && !stTo.value) stTo.value = commuterItem.to || '';
        if (stToPc && !stToPc.value) stToPc.value = commuterItem.to || '';
      }
    }
  }

  // Team status (leader/admin)
  if (isLeaderOrAbove()) {
    const attSnap = await getDocs(query(collection(db,'attendance'), where('date','==',today)));
    const records = attSnap.docs.map(d => d.data());
    const teamStatus = document.getElementById('att-team-status');
    if (teamStatus) {
      teamStatus.innerHTML = records.length
        ? records.map(r => `<div class="att-row">
            <span class="att-label">${r.name||'—'}</span>
            <div style="display:flex;gap:10px;font-size:12px;font-family:'DM Mono',monospace">
              <span style="color:var(--accent2)">${formatTime(r.clockIn)}</span>
              <span style="color:var(--blue)">${formatTime(r.clockOut)}</span>
            </div>
          </div>`).join('')
        : '<div class="empty" style="padding:12px">本日の出勤記録なし</div>';
    }
  }
}

// ── Missed banner ─────────────────────────────────────────

export async function checkMissedClockIn() {
  const today = todayJST();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate()-1);
  const yStr = yesterday.toISOString().slice(0,10);

  const yRef  = doc(db,'attendance',`${RC.currentUser.uid}_${yStr}`);
  const ySnap = await getDoc(yRef);
  if (ySnap.exists() && ySnap.data().clockIn && !ySnap.data().clockOut) {
    // Yesterday had clock-in but no clock-out
    const banners = ['att-missed-banner','att-missed-banner-m'];
    banners.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `
        <div class="notif-item notif-warn" style="margin-bottom:10px">
          <div class="notif-icon">⚠</div>
          <div>
            <div class="notif-title">昨日（${yStr}）の退勤漏れ</div>
            <div style="font-size:11px;color:var(--ink3)">昨日の退勤が記録されていません。</div>
            <button class="mini-btn" style="margin-top:6px" onclick="openMissedCorrectionForm('${ySnap.id}','${yStr}')">修正する</button>
          </div>
        </div>`;
    });
  }
}

// ── Monthly attendance ────────────────────────────────────

export async function loadMonthlyAttendance(force = false) {
  const now = Date.now();
  if (!force && now - _lastAttLoad < ATT_COOLDOWN_MS) {
    const remaining = Math.ceil((ATT_COOLDOWN_MS - (now - _lastAttLoad)) / 1000 / 60);
    alert(`更新は5分に1回です。あと約${remaining}分お待ちください。`);
    return;
  }

  const month = document.getElementById('att-month')?.value
             || document.getElementById('att-month-m')?.value
             || new Date().toISOString().slice(0,7);
  ['att-month','att-month-m'].forEach(id => { const el=document.getElementById(id); if(el) el.value=month; });

  // force 再読み込み時は当該月の絞込キャッシュも破棄（書き込み直後など）
  if (force) invalidateMonthActiveUidsCache(month);

  const start = month + '-01';
  const end   = getMonthEnd(month);

  let attQuery;
  if (isAdmin()) {
    const memberFilter = document.getElementById('att-member-filter')?.value;
    if (memberFilter) {
      attQuery = query(collection(db,'attendance'),
        where('uid','==',memberFilter),
        where('date','>=',start), where('date','<=',end), orderBy('date'));
    } else {
      attQuery = query(collection(db,'attendance'),
        where('date','>=',start), where('date','<=',end), orderBy('date'));
    }
  } else if (isLeaderOrAbove()) {
    const leaderFilter = document.getElementById('att-leader-filter')?.value || 'self';
    const mLeaderFilter = document.getElementById('att-leader-filter-m')?.value || 'self';
    const filter = leaderFilter !== 'self' ? leaderFilter : mLeaderFilter;
    if (filter === 'self') {
      attQuery = query(collection(db,'attendance'),
        where('uid','==',RC.currentUser.uid),
        where('date','>=',start), where('date','<=',end), orderBy('date'));
    } else if (filter === 'dept') {
      const myDept = RC.currentUserData?.dept || '';
      const deptIds = RC._cachedMembers.filter(m => m.dept === myDept).map(m => m.id);
      attQuery = query(collection(db,'attendance'),
        where('date','>=',start), where('date','<=',end), orderBy('date'));
    } else {
      attQuery = query(collection(db,'attendance'),
        where('date','>=',start), where('date','<=',end), orderBy('date'));
    }
  } else {
    attQuery = query(collection(db,'attendance'),
      where('uid','==',RC.currentUser.uid),
      where('date','>=',start), where('date','<=',end), orderBy('date'));
  }

  try {
    const snap = await getDocs(attQuery);
    _cachedAttendance = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) {
    console.error('勤怠データの取得に失敗しました:', e);
    const tbody = document.getElementById('attendance-table-body');
    if (tbody) tbody.innerHTML = `<tr><td colspan="13" class="empty">データ取得エラー: ${e.message}</td></tr>`;
    const mCards = document.getElementById('m-att-cards');
    if (mCards) mCards.innerHTML = `<div class="empty" style="color:var(--accent)">データ取得エラー: ${e.message}</div>`;
    return;
  }

  // シフト突合: shiftStart/End が未設定のレコードに補完（同日複数シフトは最長優先）
  try {
    const shiftSnap = await getDocs(query(
      collection(db, 'shifts'),
      where('month', '==', month)
    ));
    const shiftMap = {};
    const shiftDuration = s => {
      const [sh, sm] = (s.startTime || '00:00').split(':').map(Number);
      const [eh, em] = (s.endTime   || '00:00').split(':').map(Number);
      return (eh * 60 + em) - (sh * 60 + sm);
    };
    shiftSnap.docs.forEach(d => {
      const s = d.data();
      const key = `${s.uid}_${s.date}`;
      if (!shiftMap[key] || shiftDuration(s) > shiftDuration(shiftMap[key])) {
        shiftMap[key] = s;
      }
    });
    _cachedAttendance = _cachedAttendance.map(r => {
      if (!r.shiftStart || !r.shiftEnd) {
        const key = `${r.uid}_${r.date}`;
        const sh  = shiftMap[key];
        if (sh && sh.type !== 'off') {
          return { ...r, shiftStart: sh.startTime, shiftEnd: sh.endTime };
        }
      }
      return r;
    });
  } catch(e) {
    console.warn('シフトデータの突合に失敗しました（スキップ）:', e);
  }

  renderAttendanceTable(_cachedAttendance);
  renderAttendanceSummary(_cachedAttendance, month);
  renderAttMobileCards(_cachedAttendance);

  // 絞り込みプルダウンを当該月の勤怠入力ありメンバーに絞る（リーダー以上のみ）
  if (isLeaderOrAbove()) {
    populateMonthMemberFilters(month, ['att-member-filter', 'att-member-filter-m']);
  }

  _lastAttLoad = Date.now();
  const lastLabel = document.getElementById('att-last-loaded-label');
  if (lastLabel) lastLabel.textContent = `最終更新: ${new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Tokyo'})}`;
}

function calcHours(r) {
  const breakM = r.breakMinutes ?? 60;

  // 欠勤 → null
  if (r.absent) return null;

  // 早退 → 打刻ベース実働時間
  if ((r.isEarly || r.isEarlyLeave) && r.clockIn && r.clockOut) {
    const rawH  = (new Date(r.clockOut) - new Date(r.clockIn)) / 3600000;
    const shiftM = Math.max(0, rawH * 60 - breakM);
    return (shiftM + (r.approvedOvertimeMinutes || 0)) / 60 || null;
  }

  // 通常 → シフトベース（MF整合のため）
  if (r.shiftStart && r.shiftEnd) {
    const [sh, sm] = r.shiftStart.split(':').map(Number);
    const [eh, em] = r.shiftEnd.split(':').map(Number);
    const shiftM = Math.max(0, (eh * 60 + em) - (sh * 60 + sm) - breakM);
    return (shiftM + (r.approvedOvertimeMinutes || 0)) / 60 || null;
  }

  // シフト情報なし → 打刻ベースfallback
  if (r.clockIn && r.clockOut) {
    const rawH  = (new Date(r.clockOut) - new Date(r.clockIn)) / 3600000;
    const shiftM = Math.max(0, rawH * 60 - breakM);
    return (shiftM + (r.approvedOvertimeMinutes || 0)) / 60 || null;
  }

  return null;
}

function calcOvertime(rec) {
  const hours = calcHours(rec);
  if (hours === null) return 0;
  // シフトベースの場合は残業を approvedOvertimeMinutes で管理
  return (rec.approvedOvertimeMinutes || 0) / 60;
}

function formatTimeFromISO(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Tokyo' });
}

// 出勤：15分切り上げ表示
function formatClockIn(iso) {
  if (!iso) return '—';
  const ms = new Date(iso).getTime();
  const rounded = new Date(Math.ceil(ms / (15*60*1000)) * (15*60*1000));
  return rounded.toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Tokyo' });
}

// 退勤：15分切り捨て表示
function formatClockOut(iso) {
  if (!iso) return '—';
  const ms = new Date(iso).getTime();
  const rounded = new Date(Math.floor(ms / (15*60*1000)) * (15*60*1000));
  return rounded.toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Tokyo' });
}

export function renderAttendanceTable(records) {
  const tbody = document.getElementById('attendance-table-body');
  if (!tbody) return;
  if (!records.length) {
    tbody.innerHTML = '<tr><td colspan="13" class="empty">勤怠データなし</td></tr>'; return;
  }

  const showMemberCol = isLeaderOrAbove();
  tbody.innerHTML = records.map(r => {
    const hours    = calcHours(r);
    const overtime = calcOvertime(r);
    const mw       = MENTAL_WEATHER[r.mentalWeather];
    const isMissed = r.clockIn && !r.clockOut;
    const rowStyle = r.absent ? 'background:rgba(127,140,141,.06)' : (isMissed ? 'background:rgba(200,71,42,.04)' : '');
    const canEdit  = isAdmin() || r.uid===RC.currentUser.uid;
    const encName  = encodeURIComponent(r.name||'');
    const absentBtn = canEdit ? (
      r.absent
        ? `<button class="mini-btn" style="background:rgba(127,140,141,.1);color:var(--ink3);border-color:rgba(127,140,141,.3)" onclick="cancelAbsent('${r.uid}','${r.date}')">🚫取消</button>`
        : `<button class="mini-btn" style="background:rgba(200,71,42,.08);color:var(--accent);border-color:rgba(200,71,42,.25)" onclick="markAbsent('${r.uid}','${encName}','${r.date}')">欠勤</button>`
    ) : '';
    return `<tr style="${rowStyle}">
      <td style="font-size:11px;${isMissed?'color:var(--accent);font-weight:700':''}">${r.date||'—'}</td>
      <td style="display:${showMemberCol?'':'none'}"><span class="member-chip" style="font-size:10px">${r.name||'—'}</span></td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:var(--accent2)">${formatClockIn(r.clockIn)}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:${isMissed?'var(--accent)':'var(--blue)'}">${isMissed?'⚠ 漏れ':formatClockOut(r.clockOut)}</td>
      <td style="font-size:11px;color:var(--ink3)">${r.breakMinutes ?? 60}分</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px">${hours!==null&&hours>0?hours.toFixed(1)+'h':r.absent?'<span style="color:var(--ink3);font-weight:700">欠勤</span>':'—'}</td>
      <td style="font-family:'DM Mono',monospace;font-size:11px;color:${overtime>0?'var(--warn)':'var(--ink3)'}">${overtime>0?overtime.toFixed(1)+'h':'—'}</td>
      <td style="font-size:11px;color:var(--ink3)">${r.stationFrom&&r.stationTo?r.stationFrom+'→'+r.stationTo:r.stationFrom||r.stationTo||'—'}</td>
      <td style="font-size:11px;font-family:'DM Mono',monospace">${r.fare?'¥'+r.fare.toLocaleString():'—'}</td>
      <td style="font-size:12px">${mw?`<span title="${r.mentalWeather}">${mw.icon} ${r.mentalWeather}</span>`:'—'}</td>
      <td style="font-size:11px;color:var(--ink3);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(r.note||'')}">${r.note||''}</td>
      <td style="font-size:10px;color:var(--ink3)">${r.clockInLat?`<a href="https://www.google.com/maps?q=${r.clockInLat},${r.clockInLng}" target="_blank" style="color:var(--blue)">📍</a>`:'—'}</td>
      <td>${canEdit ? `<div style="display:flex;gap:4px;flex-wrap:wrap">${absentBtn}<button class="mini-btn" onclick="openEditAttendanceModal('${r.id}')">修正</button></div>` : ''}</td>
    </tr>`;
  }).join('');

  // Show/hide member column
  const thMember = document.getElementById('att-th-member');
  const colMember = document.getElementById('att-col-member');
  if (thMember) thMember.style.display = showMemberCol ? '' : 'none';
  if (colMember) colMember.style.width = showMemberCol ? '90px' : '0';
}

export function renderAttendanceSummary(records, month) {
  const totalDays  = records.length;
  const worked     = records.filter(r => r.clockIn && r.clockOut).length;
  const missing    = records.filter(r => r.clockIn && !r.clockOut).length;
  const totalHours = records.reduce((s,r) => s + (calcHours(r) || 0), 0);
  const totalOT    = records.reduce((s,r) => s + calcOvertime(r), 0);
  const totalFare  = records.reduce((s,r) => s + (r.fare||0), 0);

  const html = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:16px">
    <div class="kpi-card" style="border-left-color:var(--blue)"><div class="kpi-num" style="color:var(--blue);font-size:24px">${worked}</div><div class="kpi-label">出勤日数</div></div>
    ${missing?`<div class="kpi-card" style="border-left-color:var(--accent)"><div class="kpi-num" style="color:var(--accent);font-size:24px">${missing}</div><div class="kpi-label">退勤漏れ</div></div>`:''}
    <div class="kpi-card" style="border-left-color:var(--accent2)"><div class="kpi-num" style="color:var(--accent2);font-size:24px">${totalHours.toFixed(1)}</div><div class="kpi-label">総勤務時間(h)</div></div>
    <div class="kpi-card" style="border-left-color:var(--warn)"><div class="kpi-num" style="color:var(--warn);font-size:24px">${totalOT.toFixed(1)}</div><div class="kpi-label">残業時間(h)</div></div>
    <div class="kpi-card"><div class="kpi-num" style="font-size:22px">¥${totalFare.toLocaleString()}</div><div class="kpi-label">交通費合計</div></div>
  </div>`;

  ['att-summary','att-summary-m'].forEach(id => { const el=document.getElementById(id); if(el) el.innerHTML=html; });

  // Show/hide filter buttons (admin with missing records)
  if (isAdmin() && missing > 0) {
    ['att-detail-filter-btns','att-detail-filter-btns-m'].forEach(id => {
      const el = document.getElementById(id); if(el) el.style.display = 'flex';
    });
  }
}

function renderAttMobileCards(records) {
  const container = document.getElementById('m-att-cards');
  if (!container) return;
  if (!records.length) { container.innerHTML = '<div class="empty">データなし</div>'; return; }

  const showMember = isLeaderOrAbove();
  container.innerHTML = records.map(r => {
    const hours    = calcHours(r);
    const isMissed = r.clockIn && !r.clockOut;
    const mw       = MENTAL_WEATHER[r.mentalWeather];
    const canEdit  = isAdmin() || r.uid===RC.currentUser.uid;
    const encName  = encodeURIComponent(r.name||'');
    const absentBtn = canEdit ? (
      r.absent
        ? `<button class="mini-btn" style="font-size:10px;background:rgba(127,140,141,.1);color:var(--ink3);border-color:rgba(127,140,141,.3)" onclick="cancelAbsent('${r.uid}','${r.date}')">🚫取消</button>`
        : `<button class="mini-btn" style="font-size:10px;background:rgba(200,71,42,.08);color:var(--accent);border-color:rgba(200,71,42,.25)" onclick="markAbsent('${r.uid}','${encName}','${r.date}')">欠勤</button>`
    ) : '';
    const cardBorder = r.absent ? 'border-left:3px solid var(--ink3)' : (isMissed ? 'border-left:3px solid var(--accent)' : '');
    return `<div class="m-card" style="${cardBorder}">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <div style="font-weight:700;font-size:12px;${isMissed?'color:var(--accent)':''}">${r.date||'—'}</div>
        ${showMember ? `<span class="member-chip" style="font-size:10px">${r.name||'—'}</span>` : ''}
        ${mw ? `<span style="font-size:13px">${mw.icon}</span>` : ''}
      </div>
      <div style="display:flex;gap:10px;font-size:12px;font-family:'DM Mono',monospace;flex-wrap:wrap">
        <span style="color:var(--accent2)">${formatClockIn(r.clockIn)}</span>
        <span style="color:${isMissed?'var(--accent)':'var(--blue)'}">${isMissed?'⚠漏れ':formatClockOut(r.clockOut)}</span>
        ${hours!==null&&hours>0?`<span style="color:var(--ink3)">${hours.toFixed(1)}h</span>`:r.absent?`<span style="color:var(--ink3);font-weight:700">欠勤</span>`:''}
        ${r.fare?`<span style="color:var(--ink3)">¥${r.fare.toLocaleString()}</span>`:''}
      </div>
      ${canEdit?`<div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap">${absentBtn}<button class="mini-btn" style="font-size:10px" onclick="openEditAttendanceModal('${r.id}')">修正</button></div>`:''}
    </div>`;
  }).join('');
}

// ── Filter ────────────────────────────────────────────────

export function setAttDetailFilter(filter) {
  _attDetailFilter = filter;
  document.querySelectorAll('.att-detail-filter, .att-detail-filter-m').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === filter);
  });
  const filtered = filter === 'missed'
    ? _cachedAttendance.filter(r => r.clockIn && !r.clockOut)
    : _cachedAttendance;
  renderAttendanceTable(filtered);
  renderAttMobileCards(filtered);
}

export function filterAttByMember(val) {
  window.loadMonthlyAttendance?.(true);
}

export function resetAttFilter() {
  const sel = document.getElementById('att-member-filter');
  if (sel) sel.value = '';
  const btn = document.getElementById('att-reset-btn');
  if (btn) btn.style.display = 'none';
  loadMonthlyAttendance(true);
}

export function filterAttBySearch(q) {
  const keyword = q.trim();
  const month = document.getElementById('att-month')?.value || new Date().toISOString().slice(0,7);
  if (!keyword) {
    renderAttendanceTable(_cachedAttendance);
    renderAttendanceSummary(_cachedAttendance, month);
    return;
  }
  const filtered = _cachedAttendance.filter(r => (r.name||'').includes(keyword));
  renderAttendanceTable(filtered);
  renderAttendanceSummary(filtered, month);
}

// ── Excel export（メンバー別シート） ───────────────────────

export function exportExcel() {
  const records = _cachedAttendance;
  if (!records.length) { alert('出力するデータがありません'); return; }

  const XLSX = window.XLSX;
  if (!XLSX) { alert('Excelライブラリが読み込まれていません'); return; }

  const headers = ['日付', '名前', '出勤', '退勤', '休憩(分)', '勤務時間(h)', '残業(h)', '交通費(円)', 'メンタル', 'メモ'];

  const wb = XLSX.utils.book_new();

  // メンバーごとにグループ化
  const memberMap = {};
  records.forEach(r => {
    const name = r.name || '不明';
    if (!memberMap[name]) memberMap[name] = [];
    memberMap[name].push(r);
  });

  // メンバー名でソート
  const sortedNames = Object.keys(memberMap).sort((a, b) => a.localeCompare(b, 'ja'));

  sortedNames.forEach(name => {
    const rows = memberMap[name].map(r => {
      const hours = calcHours(r);
      const ot    = calcOvertime(r);
      return [
        r.date,
        r.name || '',
        formatClockIn(r.clockIn),
        formatClockOut(r.clockOut),
        r.breakMinutes ?? 60,
        hours != null ? parseFloat(hours.toFixed(2)) : '',
        ot != null ? parseFloat(ot.toFixed(2)) : '',
        r.fare || 0,
        r.mentalWeather || '',
        r.note || ''
      ];
    });

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

    // 列幅設定
    ws['!cols'] = [
      { wch: 12 }, { wch: 12 }, { wch: 8 }, { wch: 8 },
      { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 10 },
      { wch: 8 }, { wch: 20 }
    ];

    // シート名は31文字以内（Excelの制限）
    const sheetName = name.slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  const month = document.getElementById('att-month')?.value || new Date().toISOString().slice(0, 7);
  XLSX.writeFile(wb, `勤怠表_${month}.xlsx`);
}

// ── CSV export ────────────────────────────────────────────

export function exportCSV() {
  const records = _cachedAttendance;
  const showMember = isLeaderOrAbove();
  const headers = ['日付',...(showMember?['名前']:[]),'出勤','退勤','休憩(分)','勤務時間(h)','残業(h)','交通費(円)','メンタル','メモ'];
  const rows = records.map(r => {
    const hours = calcHours(r);
    const ot    = calcOvertime(r);
    return [
      r.date,
      ...(showMember ? [r.name||''] : []),
      formatClockIn(r.clockIn),
      formatClockOut(r.clockOut),
      r.breakMinutes ?? 60,
      hours != null ? hours.toFixed(2) : '',
      ot != null ? ot.toFixed(2) : '',
      r.fare||0,
      r.mentalWeather||'',
      r.note||''
    ];
  });

  const csv = [headers, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const bom  = '\uFEFF';
  const blob = new Blob([bom+csv], { type:'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `attendance_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Edit attendance modal ─────────────────────────────────

export function openEditAttendanceModal(id) {
  const r = _cachedAttendance.find(x => x.id === id);
  if (!r) return;

  const toDatetimeLocal = (iso, round) => {
    if (!iso) return '';
    const ms = new Date(iso).getTime();
    const rounded = round === 'ceil'
      ? new Date(Math.ceil(ms / (15*60*1000)) * (15*60*1000))
      : round === 'floor'
        ? new Date(Math.floor(ms / (15*60*1000)) * (15*60*1000))
        : new Date(ms);
    // sv-SE locale with JST timezone gives "YYYY-MM-DD HH:MM:SS" format
    return rounded.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 16).replace(' ', 'T');
  };

  document.getElementById('modal-title-text').textContent = '勤怠を修正';
  document.getElementById('modal-body').innerHTML = `
    <div style="font-size:11px;color:var(--ink3);margin-bottom:10px">📅 ${r.date} / ${r.name||'—'}</div>
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">出勤時刻（15分切り上げ）</label>
        <input type="datetime-local" class="form-input" id="ea-clockin" value="${toDatetimeLocal(r.clockIn, 'ceil')}"></div>
      <div class="form-row"><label class="form-label">退勤時刻（15分切り捨て）</label>
        <input type="datetime-local" class="form-input" id="ea-clockout" value="${toDatetimeLocal(r.clockOut, 'floor')}"></div>
    </div>
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">休憩時間（分）</label>
        <input type="number" class="form-input" id="ea-break" value="${r.breakMinutes ?? 60}" min="0"></div>
      <div class="form-row"><label class="form-label">交通費合計（円）</label>
        <input type="number" class="form-input" id="ea-fare" value="${r.fare||0}" min="0"></div>
    </div>
    <div class="form-row"><label class="form-label">メモ</label>
      <input class="form-input" id="ea-note" value="${escHtml(r.note||'')}"></div>
    <div class="btn-row">
      ${isAdmin() ? `<button class="btn" style="background:#fee2e2;color:var(--accent);border:none" onclick="confirmDeleteAttendance('${id}')">削除</button>` : ''}
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="saveAttendanceEdit('${id}')">保存</button>
    </div>`;
  openModal();
}

export async function saveAttendanceEdit(id) {
  const clockInVal  = document.getElementById('ea-clockin').value;
  const clockOutVal = document.getElementById('ea-clockout').value;
  const breakMin    = (() => { const v = parseInt(document.getElementById('ea-break').value); return isNaN(v) ? 60 : v; })();
  const fare        = parseInt(document.getElementById('ea-fare').value) || 0;
  const note        = document.getElementById('ea-note').value.trim();

  // datetime-local value is already local time (JST) — new Date() handles conversion to UTC
  const toISO = (val) => {
    if (!val) return null;
    return new Date(val).toISOString();
  };

  await updateDoc(doc(db,'attendance',id), {
    clockIn:      toISO(clockInVal),
    clockOut:     toISO(clockOutVal),
    breakMinutes: breakMin,
    fare, note
  });
  closeModal();
  loadMonthlyAttendance(true);
  alert('✅ 勤怠を修正しました');
}

export function confirmDeleteAttendance(id) {
  const r = _cachedAttendance.find(x => x.id === id);
  if (!confirm(`${r?.date||id} の勤怠記録を削除しますか？`)) return;
  deleteDoc(doc(db,'attendance',id)).then(() => {
    closeModal();
    loadMonthlyAttendance(true);
  });
}

// ── Add attendance modal ──────────────────────────────────

export function openAddAttendanceModal() {
  const today = todayJST();
  const memberOpts = RC._cachedMembers.map(m => `<option value="${m.id}" data-name="${m.name}">${m.name}</option>`).join('');

  document.getElementById('modal-title-text').textContent = '＋ 勤怠を追加';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row"><label class="form-label">メンバー</label>
      <select class="form-input" id="aa-member">${memberOpts}</select></div>
    <div class="form-row"><label class="form-label">日付</label>
      <input type="date" class="form-input" id="aa-date" value="${today}"></div>
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">出勤時刻</label>
        <input type="time" class="form-input" id="aa-clockin" value="09:00"></div>
      <div class="form-row"><label class="form-label">退勤時刻</label>
        <input type="time" class="form-input" id="aa-clockout" value="18:00"></div>
    </div>
    <div class="form-row-2">
      <div class="form-row"><label class="form-label">休憩(分)</label>
        <input type="number" class="form-input" id="aa-break" value="60" min="0"></div>
      <div class="form-row"><label class="form-label">交通費(円)</label>
        <input type="number" class="form-input" id="aa-fare" value="0" min="0"></div>
    </div>
    <div class="form-row"><label class="form-label">メモ</label>
      <input class="form-input" id="aa-note" placeholder="任意"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="saveAddAttendance()">追加する</button>
    </div>`;
  openModal();
}

export async function saveAddAttendance() {
  const sel       = document.getElementById('aa-member');
  const uid       = sel?.value;
  const name      = sel?.options[sel.selectedIndex]?.dataset?.name || '';
  const date      = document.getElementById('aa-date').value;
  const clockInT  = document.getElementById('aa-clockin').value;
  const clockOutT = document.getElementById('aa-clockout').value;
  const breakMin  = (() => { const v = parseInt(document.getElementById('aa-break').value); return isNaN(v) ? 60 : v; })();
  const fare      = parseInt(document.getElementById('aa-fare').value) || 0;
  const note      = document.getElementById('aa-note').value.trim();

  if (!uid || !date) { alert('メンバーと日付を選択してください'); return; }

  const makeISO = (dateStr, timeStr) => {
    if (!timeStr) return null;
    return new Date(`${dateStr}T${timeStr}:00+09:00`).toISOString();
  };

  const docId = `${uid}_${date}`;
  await setDoc(doc(db,'attendance',docId), {
    uid, name,
    dept: RC._cachedMembers.find(m=>m.id===uid)?.dept || '',
    date,
    clockIn:      makeISO(date, clockInT),
    clockOut:     makeISO(date, clockOutT),
    breakMinutes: breakMin,
    fare, note,
    addedBy: RC.currentUser.uid,
    addedAt: serverTimestamp()
  });
  closeModal();
  loadMonthlyAttendance(true);
  alert('✅ 勤怠を追加しました');
}

// ── Missed correction ─────────────────────────────────────

export function openMissedCorrectionForm(docId, dateStr) {
  document.getElementById('modal-title-text').textContent = '退勤漏れを修正';
  document.getElementById('modal-body').innerHTML = `
    <div style="font-size:12px;color:var(--ink3);margin-bottom:10px">📅 ${dateStr} の退勤時刻を入力してください</div>
    <div class="form-row"><label class="form-label">退勤時刻</label>
      <input type="time" class="form-input" id="mc-clockout" value="18:00"></div>
    <div class="form-row"><label class="form-label">休憩時間（分）</label>
      <input type="number" class="form-input" id="mc-break" value="60" min="0"></div>
    <div class="form-row"><label class="form-label">メモ</label>
      <input class="form-input" id="mc-note" placeholder="退勤漏れの理由など"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="submitMissedCorrection('${docId}','${dateStr}')">修正する</button>
    </div>`;
  openModal();
}

export async function submitMissedCorrection(docId, dateStr) {
  const clockOutT = document.getElementById('mc-clockout').value;
  const breakMin  = (() => { const v = parseInt(document.getElementById('mc-break').value); return isNaN(v) ? 60 : v; })();
  const note      = document.getElementById('mc-note').value.trim();

  const clockOutISO = new Date(`${dateStr}T${clockOutT}:00+09:00`).toISOString();
  await updateDoc(doc(db,'attendance',docId), {
    clockOut: clockOutISO, breakMinutes: breakMin, note, correctedAt: serverTimestamp()
  });
  closeModal();
  loadMonthlyAttendance(true);
  alert('✅ 退勤漏れを修正しました');
}

// ── Overtime ──────────────────────────────────────────────

export function openOvertimeModal() {
  document.getElementById('modal-title-text').textContent = '⏰ 残業申請';
  document.getElementById('modal-body').innerHTML = `
    <div class="form-row"><label class="form-label">残業時間（分）</label>
      <input type="number" class="form-input" id="ot-minutes" placeholder="例：30" min="0"></div>
    <div class="form-row"><label class="form-label">理由</label>
      <input class="form-input" id="ot-reason" placeholder="例：納期対応"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="submitOvertimeRequest()">申請する</button>
    </div>`;
  openModal();
}

export async function submitOvertimeRequest() {
  const minutes = parseInt(document.getElementById('ot-minutes').value) || 0;
  const reason  = document.getElementById('ot-reason').value.trim();
  if (!minutes) { alert('残業時間を入力してください'); return; }

  const today = todayJST();
  await addDoc(collection(db,'overtimeRequests'), {
    uid: RC.currentUser.uid,
    name: RC.currentUserData.name,
    dept: RC.currentUserData.dept || '',
    date: today,
    minutes, reason,
    status: '未承認',
    createdAt: serverTimestamp()
  });
  closeModal();
  alert('✅ 残業申請を提出しました');
}

// ── Bulk generate attendance from shifts ──────────────────

export function openBulkGenAttendanceModal() {
  const month = document.getElementById('att-month')?.value || new Date().toISOString().slice(0,7);
  document.getElementById('modal-title-text').textContent = '📋 シフトから勤怠一括生成';
  document.getElementById('modal-body').innerHTML = `
    <div style="font-size:12px;color:var(--ink3);margin-bottom:12px;line-height:1.7">
      対象月のシフト情報をもとに勤怠データを一括生成します。<br>
      既存のデータがある日付はスキップされます。
    </div>
    <div class="form-row"><label class="form-label">対象月</label>
      <input type="month" class="form-input" id="bg-month" value="${month}"></div>
    <div id="bg-error" style="font-size:12px;color:var(--accent);min-height:16px"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">キャンセル</button>
      <button class="btn btn-primary" onclick="execBulkGenAttendance()">一括生成</button>
    </div>`;
  openModal();
}

export async function execBulkGenAttendance() {
  const month = document.getElementById('bg-month').value;
  if (!month) { document.getElementById('bg-error').textContent = '月を選択してください'; return; }

  const shiftSnap = await getDocs(query(collection(db,'shifts'), where('month','==',month), where('type','==','work')));
  const shifts = shiftSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (!shifts.length) { document.getElementById('bg-error').textContent = 'シフトデータがありません'; return; }

  const batch = writeBatch(db);
  let count = 0;

  for (const s of shifts) {
    const docId = `${s.uid}_${s.date}`;
    const existing = await getDoc(doc(db,'attendance',docId));
    if (existing.exists()) continue;

    const makeISO = (timeStr) => timeStr ? new Date(`${s.date}T${timeStr}:00+09:00`).toISOString() : null;
    const memberData = RC._cachedMembers.find(m => m.id === s.uid);

    batch.set(doc(db,'attendance',docId), {
      uid: s.uid,
      name: s.name,
      dept: memberData?.dept || '',
      date: s.date,
      clockIn:  makeISO(s.startTime),
      clockOut: makeISO(s.endTime),
      breakMinutes: 60,
      fare: 0,
      note: '【シフトから自動生成】',
      generatedFrom: 'shift',
      generatedAt: serverTimestamp()
    });
    count++;
  }

  await batch.commit();
  closeModal();
  loadMonthlyAttendance(true);
  alert(`✅ ${count}件の勤怠データを生成しました`);
}

// ── Notifications ─────────────────────────────────────────

export async function checkNotifications() {
  // タスク管理機能削除済み - バッジを非表示にする
  const badge = document.getElementById('notif-badge');
  if (badge) badge.style.display = 'none';
}

export async function autoRecordMissedClockIns() {
  // Placeholder - complex logic for auto-recording missed clock-ins
  // Implemented as no-op here; original implementation was too complex
  // for safe migration without full testing
}

// ── Window exports ────────────────────────────────────────
window.clockIn                    = clockIn;
window.clockOut                   = clockOut;
window.loadAttendanceToday        = loadAttendanceToday;
window.loadMonthlyAttendance      = loadMonthlyAttendance;
window.renderAttendanceTable      = renderAttendanceTable;
window.renderAttendanceSummary    = renderAttendanceSummary;
window.setAttDetailFilter         = setAttDetailFilter;
window.filterAttByMember          = filterAttByMember;
window.resetAttFilter             = resetAttFilter;
window.filterAttBySearch          = filterAttBySearch;
window.exportCSV                  = exportCSV;
window.exportExcel                = exportExcel;
window.openEditAttendanceModal    = openEditAttendanceModal;
window.saveAttendanceEdit         = saveAttendanceEdit;
window.confirmDeleteAttendance    = confirmDeleteAttendance;
window.openAddAttendanceModal     = openAddAttendanceModal;
window.saveAddAttendance          = saveAddAttendance;
window.openMissedCorrectionForm   = openMissedCorrectionForm;
window.submitMissedCorrection     = submitMissedCorrection;
window.openOvertimeModal          = openOvertimeModal;
window.submitOvertimeRequest      = submitOvertimeRequest;
window.openBulkGenAttendanceModal = openBulkGenAttendanceModal;
window.execBulkGenAttendance      = execBulkGenAttendance;
window.checkNotifications         = checkNotifications;
window.autoRecordMissedClockIns   = autoRecordMissedClockIns;
window._cachedAttendance          = _cachedAttendance;

// ── Alliance attendance ───────────────────────────────────

export async function renderAllianceAttendance() {
  const container = document.getElementById('alliance-att-content');
  if (!container) return;
  const today = todayJST();
  const uid   = RC.currentUser?.uid;
  const name  = RC.currentUserData?.name;

  container.innerHTML = '<div style="color:var(--ink3);font-size:12px;text-align:center;padding:20px">読み込み中...</div>';

  // 本日の勤怠を取得
  let todayData = null;
  try {
    const snap = await getDoc(doc(db, 'attendance', `${uid}_${today}`));
    if (snap.exists()) {
      todayData = snap.data();
    } else {
      const qs = await getDocs(query(collection(db,'attendance'), where('name','==',name), where('date','==',today)));
      if (!qs.empty) todayData = qs.docs[0].data();
    }
  } catch(e) {}

  const ci = todayData?.clockIn  ? new Date(todayData.clockIn).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Tokyo'}) : null;
  const co = todayData?.clockOut ? new Date(todayData.clockOut).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Tokyo'}) : null;

  // 今日のシフトを取得
  const month = today.slice(0,7);
  let shiftInfo = '';
  try {
    const ss = await getDocs(query(collection(db,'shifts'), where('month','==',month), where('date','==',today)));
    const myShift = ss.docs.map(d=>d.data()).find(s => s.uid===uid || s.name===name);
    if (myShift && myShift.type !== 'off') {
      shiftInfo = `<div style="text-align:center;background:rgba(42,82,152,.08);border-radius:8px;padding:10px;margin-bottom:16px;font-size:12px">
        📋 本日のシフト：<strong>${myShift.startTime}〜${myShift.endTime}</strong>${myShift.location?`　${myShift.location}`:''}
      </div>`;
    }
  } catch(e) {}

  // 状態バナー
  let statusBanner = '';
  if (ci && co) {
    statusBanner = `<div style="background:rgba(58,125,90,.1);border:1px solid rgba(58,125,90,.3);border-radius:8px;padding:12px 14px;margin-bottom:16px;text-align:center">
      <div style="font-size:12px;color:var(--accent2);font-weight:700;margin-bottom:6px">✅ 本日の記録完了</div>
      <div style="display:flex;justify-content:center;gap:24px;font-size:12px">
        <div><span style="color:var(--ink3)">出勤</span> <strong style="font-family:'DM Mono',monospace">${ci}</strong></div>
        <div><span style="color:var(--ink3)">退勤</span> <strong style="font-family:'DM Mono',monospace">${co}</strong></div>
      </div>
    </div>`;
  } else if (ci) {
    statusBanner = `<div style="background:rgba(42,82,152,.08);border:1px solid rgba(42,82,152,.2);border-radius:8px;padding:12px 14px;margin-bottom:16px;text-align:center">
      <div style="font-size:12px;color:var(--blue);font-weight:700;margin-bottom:4px">🟢 勤務中</div>
      <div style="font-size:11px;color:var(--ink3)">出勤時刻：<strong style="font-family:'DM Mono',monospace;color:var(--ink)">${ci}</strong></div>
    </div>`;
  }

  const dateStr = new Date().toLocaleDateString('ja-JP',{month:'long',day:'numeric',weekday:'short',timeZone:'Asia/Tokyo'});

  container.innerHTML = `
    <div style="font-size:11px;color:var(--ink3);text-align:center;margin-bottom:16px;font-family:'DM Mono',monospace">${dateStr}</div>
    ${shiftInfo}
    ${statusBanner}
    ${!ci ? `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px">
      <div style="font-size:12px;font-weight:700;color:var(--accent2);margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)">🟢 出勤を記録する</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <div>
          <label style="font-size:10px;color:var(--ink3);display:block;margin-bottom:4px">🚃 乗車駅</label>
          <input class="form-input" id="al-station-from" placeholder="例：渋谷">
        </div>
        <div>
          <label style="font-size:10px;color:var(--ink3);display:block;margin-bottom:4px">🏢 降車駅</label>
          <input class="form-input" id="al-station-to" placeholder="例：新宿">
        </div>
      </div>
      <div style="margin-bottom:10px">
        <label style="font-size:10px;color:var(--ink3);display:block;margin-bottom:4px">💴 交通費（自宅→勤務先）</label>
        <input type="number" class="form-input" id="al-fare-in" placeholder="例：380" min="0">
      </div>
      <div style="margin-bottom:12px;padding:10px;background:var(--surface2);border-radius:6px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;font-weight:700">
          <input type="checkbox" id="al-late" onchange="document.getElementById('al-late-reason-wrap').style.display=this.checked?'block':'none'" style="width:15px;height:15px;accent-color:var(--warn)">
          ⏰ 遅刻あり
        </label>
        <div id="al-late-reason-wrap" style="display:none;margin-top:8px">
          <input class="form-input" id="al-late-reason" placeholder="理由（例：電車遅延）">
        </div>
      </div>
      <div style="margin-bottom:12px;padding:11px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:8px">
        <div style="font-size:11px;font-weight:700;color:var(--ink2);margin-bottom:8px">🌤 今日のメンタル天気 <span style="background:var(--accent);color:#fff;font-size:9px;padding:1px 5px;border-radius:3px">必須</span></div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px">
          ${['快晴☀️','曇り☁️','雨🌧','豪雨🌧🌧','雷🌩','嵐🌀','天災🔥'].map(w=>{
            const [val,...emoji]=w.split(/(?=[☀️☁️🌧🌩🌀🔥])/); const v=w.replace(/[☀️☁️🌧🌩🌀🔥]/g,'').trim();
            return `<label style="display:flex;flex-direction:column;align-items:center;padding:6px 4px;border:1px solid var(--border);border-radius:6px;cursor:pointer;font-size:11px;gap:2px;background:var(--surface)">
              <input type="radio" name="al-mental" value="${v||w}" style="display:none">${w.replace(/\S+/,'').trim()||w}<div>${v||''}</div></label>`;
          }).join('')}
        </div>
      </div>
      <button onclick="allianceClockIn()" style="width:100%;padding:14px;background:var(--accent2);color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer">
        🟢 出勤を記録する
      </button>
    </div>
    ` : ''}
    ${ci && !co ? `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px">
      <div style="font-size:12px;font-weight:700;color:var(--blue);margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border)">🔵 退勤を記録する</div>
      <div style="margin-bottom:10px">
        <label style="font-size:10px;color:var(--ink3);display:block;margin-bottom:4px">💴 交通費（勤務先→自宅）</label>
        <input type="number" class="form-input" id="al-fare-out" placeholder="例：380" min="0">
      </div>
      <div style="margin-bottom:10px">
        <label style="font-size:10px;color:var(--ink3);display:block;margin-bottom:4px">☕ 休憩時間（分）</label>
        <input type="number" class="form-input" id="al-break" placeholder="60" value="60" min="0">
      </div>
      <div style="margin-bottom:12px;padding:10px;background:var(--surface2);border-radius:6px">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;font-weight:700">
          <input type="checkbox" id="al-early" onchange="document.getElementById('al-early-reason-wrap').style.display=this.checked?'block':'none'" style="width:15px;height:15px;accent-color:var(--warn)">
          🏃 早退あり
        </label>
        <div id="al-early-reason-wrap" style="display:none;margin-top:8px">
          <input class="form-input" id="al-early-reason" placeholder="理由（例：体調不良）">
        </div>
      </div>
      <input class="form-input" id="al-note" placeholder="メモ（任意）" style="margin-bottom:12px">
      <button onclick="allianceClockOut()" style="width:100%;padding:14px;background:var(--blue);color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer">
        🔵 退勤を記録する
      </button>
    </div>
    ` : ''}
    <div id="alliance-att-msg" style="font-size:12px;text-align:center;min-height:18px;color:var(--accent)"></div>
  `;
}

export async function allianceClockIn() {
  const uid   = RC.currentUser?.uid;
  const name  = RC.currentUserData?.name;
  const today = todayJST();
  const fareIn     = parseInt(document.getElementById('al-fare-in')?.value)||0;
  const stFrom     = document.getElementById('al-station-from')?.value.trim()||'';
  const stTo       = document.getElementById('al-station-to')?.value.trim()||'';
  const isLate     = document.getElementById('al-late')?.checked||false;
  const lateReason = document.getElementById('al-late-reason')?.value.trim()||'';
  const mentalVal  = document.querySelector('input[name="al-mental"]:checked')?.value||'';
  const msgEl      = document.getElementById('alliance-att-msg');

  let gpsData = {};
  try {
    const pos = await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{timeout:5000}));
    gpsData = { clockInLat: pos.coords.latitude, clockInLng: pos.coords.longitude, clockInGpsAccuracy: pos.coords.accuracy };
  } catch(e) {}

  try {
    await setDoc(doc(db,'attendance',`${uid}_${today}`), {
      uid, name, date: today,
      clockIn: new Date().toISOString(), clockOut: null,
      fare: fareIn, fareIn, fareOut: 0, fareOther: 0,
      stationFrom: stFrom, stationTo: stTo,
      isLate, lateReason, isAlliance: true,
      ...(mentalVal ? { mentalWeather: mentalVal } : {}),
      ...gpsData
    }, { merge: true });
    if (msgEl) msgEl.textContent = '✅ 出勤を記録しました';
    setTimeout(() => renderAllianceAttendance(), 800);
  } catch(e) {
    if (msgEl) msgEl.textContent = '❌ エラー：' + e.message;
  }
}

export async function allianceClockOut() {
  const uid   = RC.currentUser?.uid;
  const today = todayJST();
  const fareOut    = parseInt(document.getElementById('al-fare-out')?.value)||0;
  const breakMin   = (() => { const v = parseInt(document.getElementById('al-break')?.value); return isNaN(v) ? 60 : v; })();
  const isEarly    = document.getElementById('al-early')?.checked||false;
  const earlyReason= document.getElementById('al-early-reason')?.value.trim()||'';
  const note       = document.getElementById('al-note')?.value.trim()||'';
  const msgEl      = document.getElementById('alliance-att-msg');

  let gpsData = {};
  try {
    const pos = await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{timeout:5000}));
    gpsData = { clockOutLat: pos.coords.latitude, clockOutLng: pos.coords.longitude, clockOutGpsAccuracy: pos.coords.accuracy };
  } catch(e) {}

  try {
    const existSnap = await getDoc(doc(db,'attendance',`${uid}_${today}`));
    const exist = existSnap.exists() ? existSnap.data() : {};
    const totalFare = (exist.fareIn||0) + fareOut + (exist.fareOther||0);
    await setDoc(doc(db,'attendance',`${uid}_${today}`), {
      clockOut: new Date().toISOString(),
      fareOut, fare: totalFare,
      breakMinutes: breakMin,
      isEarlyLeave: isEarly, earlyLeaveReason: earlyReason,
      note, ...gpsData
    }, { merge: true });
    if (msgEl) msgEl.textContent = '✅ 退勤を記録しました';
    setTimeout(() => renderAllianceAttendance(), 800);
  } catch(e) {
    if (msgEl) msgEl.textContent = '❌ エラー：' + e.message;
  }
}

window.renderAllianceAttendance = renderAllianceAttendance;
window.allianceClockIn          = allianceClockIn;
window.allianceClockOut         = allianceClockOut;
