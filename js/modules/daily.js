// ============================================================
// Daily check (当日出退勤確認) module
// ============================================================
import { RC, isAdmin, isLeaderOrAbove } from '../state.js';
import {
  db, collection, getDocs, query, where, orderBy
} from '../firebase.js';
import { todayJST, escHtml } from '../utils/helpers.js';
import { MENTAL_WEATHER } from '../data/constants.js';

// 表示順の優先度（小さいほど上）
// 0: 打刻漏れ（シフトあり・出勤なし・欠勤でない）
// 1: 出勤中（出勤あり・退勤なし）
// 2: 退勤済み
// 3: 欠勤
// 4: シフトのみ（それ以外）
// 5: その他
function dailyPriority(r) {
  const a = r.att;
  const s = r.shift;
  if (s && !a?.clockIn && !a?.absent) return 0;
  if (a?.clockIn && !a?.clockOut)     return 1;
  if (a?.clockIn && a?.clockOut)      return 2;
  if (a?.absent)                       return 3;
  if (s)                               return 4;
  return 5;
}

const toHHMM = iso => {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
};

// ── PC daily check ────────────────────────────────────────

export async function loadDailyCheck() {
  const today = todayJST();
  const showAll = document.getElementById('daily-show-all')?.checked || false;

  // Attendance for today
  const attSnap = await getDocs(query(collection(db,'attendance'), where('date','==',today)));
  const attMap  = {};
  attSnap.docs.forEach(d => { const r=d.data(); attMap[r.uid] = r; });

  // Shifts for today
  const shiftSnap = await getDocs(query(collection(db,'shifts'), where('date','==',today)));
  const shiftMap  = {};
  shiftSnap.docs.forEach(d => { const s=d.data(); shiftMap[s.uid] = { ...s, _id: d.id }; });

  const members = RC._cachedMembers.filter(m => !m.isAlliance);

  let rows = members.map(m => ({
    member: m,
    att:    attMap[m.id]   || null,
    shift:  shiftMap[m.id] || null
  }));

  if (!showAll) {
    rows = rows.filter(r => r.att || r.shift);
  }

  // シフト開始時間順（時間が来ていない人は下部）
  const _nowMinPC = (() => { const d = new Date(new Date().toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})); return d.getHours()*60+d.getMinutes(); })();
  const _sMin = r => { const t=r.shift?.startTime; if(!t) return 9999; const [h,m]=t.split(':').map(Number); return h*60+(m||0); };
  rows.sort((a,b) => { const aM=_sMin(a),bM=_sMin(b),aD=aM<=_nowMinPC,bD=bM<=_nowMinPC; if(aD!==bD) return aD?-1:1; return aM-bM; });

  const tbody = document.getElementById('daily-check-body');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = '<div class="empty">本日の出退勤記録なし</div>'; return;
  }

  tbody.innerHTML = `<div class="tbl-wrap"><table style="min-width:780px">
    <thead><tr>
      <th>メンバー</th><th>部門</th><th>シフト</th>
      <th>出勤</th><th>退勤</th><th>🌤 メンタル</th><th>メモ</th><th>操作</th>
    </tr></thead>
    <tbody>
      ${rows.map(({member:m, att, shift}) => {
        const shiftLabel = shift ? `${shift.startTime||'—'}〜${shift.endTime||'—'}` : '—';
        const shiftCell  = (shift?._id && isAdmin() && shift.startTime)
          ? `<span onclick="openShiftTimeEdit('${shift._id}','${shift.startTime||''}','${shift.endTime||''}')"
               title="クリックでシフト時間を変更"
               style="border-bottom:1px dashed var(--ink3);cursor:pointer">${shiftLabel}</span>`
          : shiftLabel;
        const mental = att?.mentalWeather;
        const mw = MENTAL_WEATHER[mental];
        const isMissed = shift && !att?.clockIn && !att?.absent;
        const rowStyle = isMissed ? 'background:rgba(200,71,42,.04)' : '';
        const encName = encodeURIComponent(m.name||'');
        const inCell = isMissed
          ? `<span style="color:var(--accent);font-weight:700">⚠ 漏れ</span>`
          : toHHMM(att?.clockIn);
        let absentBtn = '';
        if (att?.absent) {
          absentBtn = `<button class="mini-btn" style="background:rgba(127,140,141,.1);color:var(--ink3);border-color:rgba(127,140,141,.3)" onclick="cancelAbsent('${m.id}','${today}')">🚫 欠勤中（取消）</button>`;
        } else if (!att?.clockIn) {
          absentBtn = `<button class="mini-btn" style="background:rgba(200,71,42,.08);color:var(--accent);border-color:rgba(200,71,42,.25)" onclick="markAbsent('${m.id}','${encName}','${today}')">欠勤</button>`;
        }
        return `<tr style="${rowStyle}">
          <td style="font-weight:600">${escHtml(m.name||'')}</td>
          <td style="font-size:11px;color:var(--ink3)">${escHtml(m.dept||'—')}</td>
          <td style="font-size:11px;color:var(--ink3)">${shiftCell}</td>
          <td style="font-family:'DM Mono',monospace;color:var(--accent2)">${inCell}</td>
          <td style="font-family:'DM Mono',monospace;color:var(--blue)">${toHHMM(att?.clockOut)}</td>
          <td>${mental ? `<span title="${mental}">${mw?.icon||''} ${mental}</span>` : '—'}</td>
          <td style="font-size:11px;color:var(--ink3);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(att?.note||'')}</td>
          <td>${absentBtn}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table></div>`;
}

// ── Mobile daily check ────────────────────────────────────

export async function loadDailyCheckM(force = false) {
  const today   = todayJST();
  const showAll = document.getElementById('m-daily-show-all')?.checked || false;
  const reloadBtn = document.getElementById('daily-reload-btn-m');
  if (reloadBtn) { reloadBtn.disabled = true; reloadBtn.textContent = '...'; }

  const attSnap   = await getDocs(query(collection(db,'attendance'), where('date','==',today)));
  const attMap    = {};
  attSnap.docs.forEach(d => { const r=d.data(); attMap[r.uid] = r; });

  const shiftSnap = await getDocs(query(collection(db,'shifts'), where('date','==',today)));
  const shiftMap  = {};
  shiftSnap.docs.forEach(d => { const s=d.data(); shiftMap[s.uid] = s; });

  const members = RC._cachedMembers.filter(m => !m.isAlliance);
  let rows = members.map(m => ({ member:m, att:attMap[m.id]||null, shift:shiftMap[m.id]||null }));
  if (!showAll) rows = rows.filter(r => r.att || r.shift);

  // シフト開始時間順（時間が来ていない人は下部）
  const _nowMinM = (() => { const d = new Date(new Date().toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})); return d.getHours()*60+d.getMinutes(); })();
  const _sMn = r => { const t=r.shift?.startTime; if(!t) return 9999; const [h,m]=t.split(':').map(Number); return h*60+(m||0); };
  rows.sort((a,b) => { const aM=_sMn(a),bM=_sMn(b),aD=aM<=_nowMinM,bD=bM<=_nowMinM; if(aD!==bD) return aD?-1:1; return aM-bM; });

  const body = document.getElementById('m-daily-check-body');
  if (!body) return;

  if (!rows.length) {
    body.innerHTML = '<div class="empty">本日の記録なし</div>';
  } else {
    body.innerHTML = rows.map(({member:m, att, shift}) => {
      const mw = MENTAL_WEATHER[att?.mentalWeather];
      const isMissed = shift && !att?.clockIn && !att?.absent;
      const cardStyle = isMissed ? 'border-left:3px solid var(--accent);' : '';
      const encName = encodeURIComponent(m.name||'');
      let absentBtn = '';
      if (att?.absent) {
        absentBtn = `<button class="mini-btn" style="background:rgba(127,140,141,.1);color:var(--ink3);border-color:rgba(127,140,141,.3);font-size:10px;margin-top:6px" onclick="cancelAbsent('${m.id}','${today}')">🚫 欠勤中（取消）</button>`;
      } else if (!att?.clockIn) {
        absentBtn = `<button class="mini-btn" style="background:rgba(200,71,42,.08);color:var(--accent);border-color:rgba(200,71,42,.25);font-size:10px;margin-top:6px" onclick="markAbsent('${m.id}','${encName}','${today}')">欠勤</button>`;
      }
      return `<div class="m-card" style="margin-bottom:8px;${cardStyle}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
          <div style="font-weight:700">${escHtml(m.name||'')}</div>
          <div style="font-size:10px;color:var(--ink3)">${escHtml(m.dept||'')}</div>
        </div>
        <div style="display:flex;gap:10px;font-size:12px;font-family:'DM Mono',monospace;flex-wrap:wrap">
          <span style="color:${isMissed?'var(--accent)':'var(--accent2)'};font-weight:${isMissed?'700':'normal'}">IN ${isMissed?'⚠漏れ':toHHMM(att?.clockIn)}</span>
          <span style="color:var(--blue)">OUT ${toHHMM(att?.clockOut)}</span>
          ${att?.mentalWeather ? `<span>${mw?.icon||''} ${att.mentalWeather}</span>` : ''}
        </div>
        ${shift ? `<div style="font-size:11px;color:var(--ink3);margin-top:3px">📅 シフト ${shift.startTime||''}〜${shift.endTime||''}</div>` : ''}
        ${absentBtn}
      </div>`;
    }).join('');
  }

  if (reloadBtn) { reloadBtn.disabled = false; reloadBtn.textContent = '🔄 更新'; }
}

// ── Admin shifts mobile ───────────────────────────────────

export async function loadAdminShiftsM() {
  const month  = document.getElementById('shift-month-admin-m')?.value || new Date().toISOString().slice(0,7);
  const uid    = document.getElementById('shift-member-filter-m')?.value || '';

  let q = query(collection(db,'shifts'), where('month','==',month), orderBy('date'));
  const snap = await getDocs(q);
  let shifts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (uid) shifts = shifts.filter(s => s.uid === uid);

  // Populate member filter（当該月の勤怠入力ありメンバーに絞る）
  window.populateMonthMemberFilters?.(month, ['shift-member-filter-m']);

  const container = document.getElementById('shift-calendar-admin-m');
  if (!container) return;

  // Group by date
  const byDate = {};
  shifts.forEach(s => {
    if (!byDate[s.date]) byDate[s.date] = [];
    byDate[s.date].push(s);
  });

  const [y, mon] = month.split('-').map(Number);
  const daysInMonth = new Date(y, mon, 0).getDate();

  let html = '';
  for (let d=1; d<=daysInMonth; d++) {
    const dateStr = `${month}-${String(d).padStart(2,'0')}`;
    const dayShifts = byDate[dateStr] || [];
    const dow = new Date(y,mon-1,d).getDay();
    const dayLabel = ['日','月','火','水','木','金','土'][dow];
    const dayColor = dow===0?'var(--accent)':dow===6?'var(--blue)':'var(--ink)';
    if (!dayShifts.length) continue;
    html += `<div style="margin-bottom:8px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px">
      <div style="font-size:12px;font-weight:700;color:${dayColor};margin-bottom:6px">${d}日（${dayLabel}）</div>
      ${dayShifts.map(s => {
        const isOff = s.type === 'off';
        return `<div style="font-size:12px;padding:5px 8px;margin-bottom:4px;background:${isOff?'rgba(200,71,42,.08)':'rgba(42,82,152,.07)'};border-radius:4px;display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600">${s.name||'—'}</span>
          <span style="font-size:11px;color:${isOff?'var(--accent)':'var(--blue)'}">
            ${isOff ? '🙏 希望休' + (s.approved?'（承認済）':'（申請中）') : `${s.startTime||''}〜${s.endTime||''}`}
          </span>
        </div>`;
      }).join('')}
    </div>`;
  }

  container.innerHTML = html || '<div class="empty">シフトなし</div>';

  // Off pending banner
  const pending = shifts.filter(s => s.type==='off' && !s.approved);
  const banner  = document.getElementById('m-off-pending-banner');
  if (banner) {
    if (pending.length) {
      banner.style.display = '';
      banner.innerHTML = `🙏 希望休の承認待ち <strong>${pending.length}件</strong>あります。<br>
        ${pending.map(s=>`<div style="margin-top:4px">${s.name} ${s.date}
          <button class="mini-btn" style="color:var(--accent2);border-color:var(--accent2);margin-left:6px" onclick="approveOffRequest('${s.id}')">承認</button>
          <button class="mini-btn" style="color:var(--accent);border-color:var(--accent);margin-left:4px" onclick="rejectOffRequest('${s.id}')">却下</button>
        </div>`).join('')}`;
    } else {
      banner.style.display = 'none';
    }
  }
}

window.loadDailyCheck   = loadDailyCheck;
window.loadDailyCheckM  = loadDailyCheckM;
window.loadAdminShiftsM = loadAdminShiftsM;
