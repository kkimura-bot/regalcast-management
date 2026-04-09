// ============================================================
// Dashboard module — role-based redesign
// ============================================================
import { RC, isAdmin, isLeaderOrAbove } from '../state.js';
import {
  db, collection, getDocs, query, where, orderBy, limit
} from '../firebase.js';
import { todayJST } from '../utils/helpers.js';
import { MENTAL_WEATHER } from '../data/constants.js';

const MENTAL_ORDER = ['快晴','曇り','雨','豪雨','雷','嵐','天災'];
const RISK = { '快晴':0,'曇り':0.5,'雨':1,'豪雨':3,'雷':4,'嵐':5,'天災':6 };

// ── Helpers ───────────────────────────────────────────────

function toHHMM(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('ja-JP', { hour:'2-digit', minute:'2-digit', timeZone:'Asia/Tokyo' });
}

function mIcon(w) { return MENTAL_WEATHER[w]?.icon || '—'; }
function mColor(w) { return MENTAL_WEATHER[w]?.color || '#8a93a6'; }

// ── CSS (injected once) ───────────────────────────────────

function injectDashCSS() {
  if (document.getElementById('dash-css')) return;
  const s = document.createElement('style');
  s.id = 'dash-css';
  s.textContent = `
    .dash-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    @media(max-width:900px) { .dash-grid { grid-template-columns: 1fr; } }

    .dash-card {
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.06);
      padding: 22px 24px;
      transition: box-shadow 0.2s;
    }
    .dash-card:hover { box-shadow: 0 8px 28px rgba(0,0,0,0.1); }
    .dash-card.span-2 { grid-column: span 2; }
    @media(max-width:900px) { .dash-card.span-2 { grid-column: span 1; } }

    .dash-card-label {
      font-size: 10px;
      font-weight: 700;
      color: #8a93a6;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      margin-bottom: 14px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .dash-hero-num {
      font-size: 52px;
      font-weight: 800;
      line-height: 1;
      letter-spacing: -2px;
      color: #1a1a1a;
    }
    .dash-hero-sub {
      font-size: 13px;
      color: #8a93a6;
      margin-top: 4px;
    }
    .dash-prog-bar {
      height: 8px;
      background: #f0f2f5;
      border-radius: 99px;
      overflow: hidden;
      margin-top: 16px;
    }
    .dash-prog-fill {
      height: 100%;
      border-radius: 99px;
      transition: width 0.6s cubic-bezier(.4,0,.2,1);
    }
    .dash-stat-num {
      font-size: 34px;
      font-weight: 800;
      letter-spacing: -1px;
      color: #1a1a1a;
    }
    .dash-stat-label { font-size: 12px; color: #8a93a6; margin-top: 2px; }

    .dash-att-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 9px 0;
      border-bottom: 1px solid #f0f2f5;
    }
    .dash-att-row:last-child { border-bottom: none; }
    .dash-att-name { font-size: 13px; font-weight: 600; color: #1a1a1a; }
    .dash-att-time { font-size: 12px; font-family: 'DM Mono', monospace; color: #8a93a6; display:flex; gap:10px; }
    .dash-att-time .in  { color: #3a7d5a; }
    .dash-att-time .out { color: #2a5298; }

    .dash-shift-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 0;
      border-bottom: 1px solid #f0f2f5;
    }
    .dash-shift-row:last-child { border-bottom: none; }
    .dash-shift-time { font-size: 12px; font-family:'DM Mono',monospace; color:#2a5298; white-space:nowrap; }
    .dash-shift-loc  { font-size: 11px; color: #8a93a6; }

    .dash-mental-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 5px 10px;
      border-radius: 99px;
      font-size: 12px;
      font-weight: 600;
    }
    .dash-mental-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #f0f2f5;
    }
    .dash-mental-row:last-child { border-bottom: none; }
    .dash-alert-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: #e53e3e;
      margin-left: 6px;
      flex-shrink: 0;
    }

    .dash-my-clock {
      text-align: center;
      padding: 12px 0 8px;
    }
    .dash-my-clock-status {
      font-size: 14px;
      font-weight: 700;
      padding: 6px 16px;
      border-radius: 99px;
      display: inline-block;
      margin-bottom: 12px;
    }
    .dash-my-time-row {
      display: flex;
      justify-content: center;
      gap: 32px;
      margin-top: 8px;
    }
    .dash-my-time-item { text-align: center; }
    .dash-my-time-val {
      font-size: 28px;
      font-weight: 700;
      font-family: 'DM Mono', monospace;
      letter-spacing: -1px;
    }
    .dash-my-time-lbl { font-size: 10px; color: #8a93a6; margin-top: 2px; font-weight:600; text-transform:uppercase; letter-spacing:1px; }

    .dash-refresh-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      border-radius: 8px;
      border: 1.5px solid #e2e6ef;
      background: #fff;
      color: #8a93a6;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.15s;
    }
    .dash-refresh-btn:hover { border-color: #2a5298; color: #2a5298; }

    /* Mobile dash */
    .m-dash-card {
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.06);
      padding: 18px;
      margin-bottom: 14px;
    }
  `;
  document.head.appendChild(s);
}

// ── Main load ─────────────────────────────────────────────

export async function loadDashboard() {
  injectDashCSS();
  const today = todayJST();

  // fetch data in parallel
  const fetchAtt     = getDocs(query(collection(db,'attendance'), where('date','==',today)));
  const fetchShifts  = getDocs(query(collection(db,'shifts'), where('date','==',today)));
  const fetchMental  = isLeaderOrAbove()
    ? getDocs(query(collection(db,'mental'), where('date','==',today)))
    : Promise.resolve({ docs: [] });
  const fetchReports    = isAdmin()
    ? getDocs(query(collection(db,'error_reports'), where('status','==','未対応')))
    : Promise.resolve({ docs: [] });
  const fetchFormSubs   = isAdmin()
    ? getDocs(collection(db,'form_submissions'))
    : Promise.resolve({ docs: [] });
  const fetchMyMental = (!isLeaderOrAbove())
    ? getDocs(query(collection(db,'mental'), where('uid','==',RC.currentUser.uid)))
    : Promise.resolve({ docs: [] });

  const [attSnap, shiftSnap, mentalSnap, reportSnap, myMentalSnap, formSubsSnap] = await Promise.all([
    fetchAtt, fetchShifts, fetchMental, fetchReports, fetchMyMental, fetchFormSubs
  ]);

  const attRecords     = attSnap.docs.map(d => d.data());
  const todayShifts    = shiftSnap.docs.map(d => d.data());
  const mentalToday    = mentalSnap.docs.map(d => d.data());
  const unreadReports  = reportSnap.docs.length;
  const myMentalHist   = myMentalSnap.docs.map(d => d.data()).sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,7);
  const unreadFormSubs = formSubsSnap.docs.filter(d => d.data().submittedAt && !d.data().readAt).length;

  if (isAdmin()) {
    renderAdmin(today, attRecords, todayShifts, mentalToday, unreadReports, unreadFormSubs);
  } else if (isLeaderOrAbove()) {
    renderLeader(today, attRecords, todayShifts, mentalToday);
  } else {
    renderMember(today, attRecords, todayShifts, myMentalHist);
  }
}

// ── Admin dashboard ───────────────────────────────────────

function renderAdmin(today, att, shifts, mental, unread, unreadForms) {
  const totalMembers = RC._cachedMembers.filter(m =>
    !m.isAlliance && !m.noAuth && m.role !== '委託' && m.role !== 'alliance' && !m.id.startsWith('alliance_')
  ).length;
  const scheduledUids  = new Set(shifts.map(s => s.uid).filter(Boolean));
  const scheduledCount = scheduledUids.size;
  const attendedCount  = att.filter(r => r.uid && scheduledUids.has(r.uid)).length;
  const pct = scheduledCount > 0 ? Math.round(attendedCount / scheduledCount * 100) : 0;

  // mental summary
  const negMembers = mental
    .filter(r => RISK[r.mentalWeather] >= 3)
    .sort((a,b) => (RISK[b.mentalWeather]||0) - (RISK[a.mentalWeather]||0));
  const mentalDistHtml = MENTAL_ORDER.map(k => {
    const cnt = mental.filter(r => r.mentalWeather === k).length;
    if (!cnt) return '';
    const mw = MENTAL_WEATHER[k];
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:99px;background:${mw.bg};color:${mw.color};font-size:12px;font-weight:700;margin:2px">
      ${mw.icon} ${cnt}名
    </span>`;
  }).join('');

  const attHtml = att.length
    ? att.slice(0,8).map(r => `
        <div class="dash-att-row">
          <span class="dash-att-name">${r.name||'—'}</span>
          <span class="dash-att-time">
            <span class="in">▲ ${toHHMM(r.clockIn)||'—'}</span>
            <span class="out">▼ ${toHHMM(r.clockOut)||'—'}</span>
          </span>
        </div>`).join('')
    : '<div style="font-size:12px;color:#b0b8c8;padding:12px 0;text-align:center">出勤記録なし</div>';

  const negHtml = negMembers.length
    ? negMembers.map(r => {
        const mw = MENTAL_WEATHER[r.mentalWeather];
        return `<div class="dash-mental-row">
          <span style="font-size:13px;font-weight:600;color:#1a1a1a">${r.name||'—'}</span>
          <span style="font-size:13px;color:${mw?.color}">${mw?.icon} ${r.mentalWeather}</span>
        </div>`;
      }).join('')
    : '<div style="font-size:12px;color:#3a7d5a;padding:10px 0;text-align:center">⚠️ 要注意メンバーなし</div>';

  const dateLabel = new Date().toLocaleDateString('ja-JP', { month:'long', day:'numeric', weekday:'short', timeZone:'Asia/Tokyo' });

  const html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <div>
        <div style="font-size:20px;font-weight:800;color:#1a1a1a">ダッシュボード</div>
        <div style="font-size:12px;color:#8a93a6;margin-top:2px">${dateLabel}</div>
      </div>
      <button class="dash-refresh-btn" onclick="loadDashboard()">🔄 更新</button>
    </div>
    <div class="dash-grid">

      <!-- ヒーロー: 出勤状況 -->
      <div class="dash-card span-2">
        <div class="dash-card-label">👥 本日の出勤状況</div>
        <div style="display:flex;align-items:flex-end;gap:8px">
          <div class="dash-hero-num">${attendedCount}</div>
          <div style="font-size:22px;font-weight:800;color:#c0c8d8;margin-bottom:6px">/ ${scheduledCount}名</div>
        </div>
        <div class="dash-hero-sub">出勤済み — 本日シフト ${scheduledCount}名中</div>
        <div class="dash-prog-bar">
          <div class="dash-prog-fill" style="width:${Math.min(pct,100)}%;background:linear-gradient(90deg,#3a7d5a,#52b788)"></div>
        </div>
        <div style="font-size:11px;color:#8a93a6;margin-top:6px;text-align:right">${pct}%</div>
      </div>

      <!-- 未読日報 -->
      <div class="dash-card" style="cursor:pointer" onclick="switchTab('reports')">
        <div class="dash-card-label">📨 未読日報</div>
        <div class="dash-stat-num" style="color:${unread>0?'#e53e3e':'#3a7d5a'}">${unread}</div>
        <div class="dash-stat-label">${unread>0?'件の未対応レポート':'すべて確認済み'}</div>
        <div style="font-size:11px;color:#2a5298;margin-top:12px;font-weight:600">報告確認へ →</div>
      </div>

      <!-- 入社フォーム通知 -->
      <div class="dash-card" style="cursor:pointer" onclick="switchTab('reports');filterAdminReports('onboarding')">
        <div class="dash-card-label">📋 入社フォーム提出</div>
        <div class="dash-stat-num" style="color:${unreadForms>0?'#7c3aed':'#3a7d5a'}">${unreadForms}</div>
        <div class="dash-stat-label">${unreadForms>0?'件の未確認フォームあり':'すべて確認済み'}</div>
        <div style="font-size:11px;color:#2a5298;margin-top:12px;font-weight:600">入社フォームを確認 →</div>
      </div>

      <!-- 今日のシフト人数 -->
      <div class="dash-card" style="cursor:pointer" onclick="switchTab('daily')">
        <div class="dash-card-label">📅 今日のシフト</div>
        <div class="dash-stat-num">${scheduledCount}</div>
        <div class="dash-stat-label">名がシフト入り</div>
        <div style="font-size:11px;color:#2a5298;margin-top:12px;font-weight:600">当日確認へ →</div>
      </div>

      <!-- 出勤記録 -->
      <div class="dash-card">
        <div class="dash-card-label">🟢 打刻状況（最新8名）</div>
        ${attHtml}
      </div>

      <!-- メンタルサマリー -->
      <div class="dash-card">
        <div class="dash-card-label" style="justify-content:space-between">
          <span>🌤 メンタル天気（本日）</span>
          <span style="font-size:11px;color:#8a93a6">${mental.length}名回答</span>
        </div>
        <div style="margin-bottom:12px">${mentalDistHtml || '<span style="font-size:12px;color:#b0b8c8">本日の回答なし</span>'}</div>
        ${negMembers.length ? `<div style="font-size:10px;font-weight:700;color:#e53e3e;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">⚠️ 要注意</div>${negHtml}` : negHtml}
      </div>

    </div>`;

  document.getElementById('dash-content').innerHTML = html;
  renderMobileDashboard('admin', { today, att, shifts, mental, unread, unreadForms, totalMembers, attendedCount, scheduledCount, pct, negMembers, dateLabel });
}

// ── Leader dashboard ──────────────────────────────────────

function renderLeader(today, att, shifts, mental) {
  const myDept = RC.currentUserData?.dept || '';
  const deptMemberIds = RC._cachedMembers.filter(m => m.dept === myDept && !m.isAlliance && !m.noAuth).map(m => m.id);

  const deptAtt    = att.filter(r => deptMemberIds.includes(r.uid));
  const deptShifts = shifts.filter(s => deptMemberIds.includes(s.uid));
  const deptMental = mental.filter(r => deptMemberIds.includes(r.uid));
  const pct = deptMemberIds.length > 0 ? Math.round(deptAtt.length / deptMemberIds.length * 100) : 0;

  const dateLabel = new Date().toLocaleDateString('ja-JP', { month:'long', day:'numeric', weekday:'short', timeZone:'Asia/Tokyo' });

  const shiftHtml = deptShifts.length
    ? deptShifts.map(s => `
        <div class="dash-shift-row">
          <span class="member-chip" style="font-size:11px">${s.name||'—'}</span>
          <span class="dash-shift-time">${s.startTime||'—'}〜${s.endTime||'—'}</span>
          <span class="dash-shift-loc">📍${s.location||'—'}</span>
        </div>`).join('')
    : '<div style="font-size:12px;color:#b0b8c8;padding:12px 0;text-align:center">本日のシフトなし</div>';

  const mentalHtml = deptMental.length
    ? deptMental.map(r => {
        const mw = MENTAL_WEATHER[r.mentalWeather];
        const isAlert = RISK[r.mentalWeather] >= 3;
        return `<div class="dash-mental-row">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:13px;font-weight:600;color:#1a1a1a">${r.name||'—'}</span>
            ${isAlert ? '<span class="dash-alert-dot"></span>' : ''}
          </div>
          <span class="dash-mental-chip" style="background:${mw?.bg};color:${mw?.color}">${mw?.icon} ${r.mentalWeather}</span>
        </div>`;
      }).join('')
    : '<div style="font-size:12px;color:#b0b8c8;padding:12px 0;text-align:center">本日の回答なし</div>';

  const html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <div>
        <div style="font-size:20px;font-weight:800;color:#1a1a1a">ダッシュボード</div>
        <div style="font-size:12px;color:#8a93a6;margin-top:2px">${dateLabel} ／ ${myDept}</div>
      </div>
      <button class="dash-refresh-btn" onclick="loadDashboard()">🔄 更新</button>
    </div>
    <div class="dash-grid">

      <!-- ヒーロー: 部署出勤 -->
      <div class="dash-card span-2">
        <div class="dash-card-label">👥 ${myDept} — 本日の出勤状況</div>
        <div style="display:flex;align-items:flex-end;gap:8px">
          <div class="dash-hero-num">${deptAtt.length}</div>
          <div style="font-size:22px;font-weight:800;color:#c0c8d8;margin-bottom:6px">/ ${deptMemberIds.length}名</div>
        </div>
        <div class="dash-hero-sub">出勤済み</div>
        <div class="dash-prog-bar">
          <div class="dash-prog-fill" style="width:${Math.min(pct,100)}%;background:linear-gradient(90deg,#2a5298,#4a7bc8)"></div>
        </div>
        <div style="font-size:11px;color:#8a93a6;margin-top:6px;text-align:right">${pct}%</div>
      </div>

      <!-- 今日のシフト -->
      <div class="dash-card">
        <div class="dash-card-label">📅 本日のシフト</div>
        ${shiftHtml}
      </div>

      <!-- メンタル天気 -->
      <div class="dash-card">
        <div class="dash-card-label" style="justify-content:space-between">
          <span>🌤 メンタル天気</span>
          <span style="font-size:11px;color:#8a93a6">${deptMental.length}名回答</span>
        </div>
        ${mentalHtml}
      </div>

    </div>`;

  document.getElementById('dash-content').innerHTML = html;
  renderMobileDashboard('leader', { today, deptAtt, deptShifts, deptMental, deptMemberIds, pct, myDept, dateLabel });
}

// ── Member dashboard ──────────────────────────────────────

function renderMember(today, att, shifts, myMentalHist) {
  const myAtt   = att.find(r => r.uid === RC.currentUser?.uid);
  const myShift = shifts.find(s => s.uid === RC.currentUser?.uid);
  const isIn    = !!myAtt?.clockIn;
  const isOut   = !!myAtt?.clockOut;

  let statusLabel, statusColor, statusBg;
  if (isOut)      { statusLabel = '退勤済み'; statusColor = '#2a5298'; statusBg = 'rgba(42,82,152,.1)'; }
  else if (isIn)  { statusLabel = '出勤中'; statusColor = '#3a7d5a'; statusBg = 'rgba(58,125,90,.1)'; }
  else            { statusLabel = '未打刻'; statusColor = '#e53e3e'; statusBg = 'rgba(229,62,62,.08)'; }

  const dateLabel = new Date().toLocaleDateString('ja-JP', { month:'long', day:'numeric', weekday:'short', timeZone:'Asia/Tokyo' });

  const mentalHistHtml = myMentalHist.length
    ? myMentalHist.map(r => {
        const mw = MENTAL_WEATHER[r.mentalWeather];
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f0f2f5">
          <span style="font-size:11px;color:#8a93a6">${r.date}</span>
          <span class="dash-mental-chip" style="background:${mw?.bg};color:${mw?.color}">${mw?.icon} ${r.mentalWeather}</span>
        </div>`;
      }).join('')
    : '<div style="font-size:12px;color:#b0b8c8;padding:12px 0;text-align:center">履歴なし</div>';

  const html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
      <div>
        <div style="font-size:20px;font-weight:800;color:#1a1a1a">ダッシュボード</div>
        <div style="font-size:12px;color:#8a93a6;margin-top:2px">${dateLabel}</div>
      </div>
      <button class="dash-refresh-btn" onclick="loadDashboard()">🔄 更新</button>
    </div>
    <div class="dash-grid">

      <!-- ヒーロー: 打刻状況 -->
      <div class="dash-card span-2">
        <div class="dash-card-label">📍 本日の打刻状況</div>
        <div class="dash-my-clock">
          <div class="dash-my-clock-status" style="color:${statusColor};background:${statusBg}">${statusLabel}</div>
          ${(isIn || isOut) ? `
          <div class="dash-my-time-row">
            <div class="dash-my-time-item">
              <div class="dash-my-time-val" style="color:#3a7d5a">${toHHMM(myAtt.clockIn)||'—'}</div>
              <div class="dash-my-time-lbl">出勤</div>
            </div>
            ${isOut ? `
            <div class="dash-my-time-item">
              <div class="dash-my-time-val" style="color:#2a5298">${toHHMM(myAtt.clockOut)||'—'}</div>
              <div class="dash-my-time-lbl">退勤</div>
            </div>` : ''}
          </div>` : `<div style="font-size:12px;color:#b0b8c8;margin-top:8px">出退勤タブから打刻してください</div>`}
        </div>
        ${myShift ? `
        <div style="margin-top:16px;padding-top:14px;border-top:1px solid #f0f2f5;display:flex;align-items:center;gap:10px">
          <span style="font-size:11px;color:#8a93a6;font-weight:600">本日のシフト</span>
          <span style="font-size:13px;font-weight:700;font-family:'DM Mono',monospace;color:#2a5298">${myShift.startTime||'—'}〜${myShift.endTime||'—'}</span>
          ${myShift.location ? `<span style="font-size:11px;color:#8a93a6">📍 ${myShift.location}</span>` : ''}
        </div>` : ''}
      </div>

      <!-- メンタル天気履歴 -->
      <div class="dash-card span-2">
        <div class="dash-card-label">🌤 メンタル天気（直近7日）</div>
        ${mentalHistHtml}
      </div>

    </div>`;

  document.getElementById('dash-content').innerHTML = html;
  renderMobileDashboard('member', { today, myAtt, myShift, isIn, isOut, statusLabel, statusColor, statusBg, myMentalHist, dateLabel });
}

// ── Mobile render ─────────────────────────────────────────

function renderMobileDashboard(role, data) {
  const el = document.getElementById('m-dash-content');
  if (!el) return;
  const { dateLabel } = data;

  const refreshBtn = `<button onclick="loadDashboard()"
    style="width:100%;padding:11px;border-radius:10px;border:1.5px solid #e2e6ef;background:#fff;color:#8a93a6;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:14px;font-family:inherit">
    🔄 ダッシュボードを更新
  </button>`;

  let html = refreshBtn;

  if (role === 'admin') {
    const { att, totalMembers, attendedCount, scheduledCount, pct, mental, negMembers, unread, unreadForms } = data;
    const attHtml = att.slice(0,6).map(r => `
      <div class="dash-att-row">
        <span class="dash-att-name">${r.name||'—'}</span>
        <span class="dash-att-time">
          <span class="in">▲ ${toHHMM(r.clockIn)||'—'}</span>
          <span class="out">▼ ${toHHMM(r.clockOut)||'—'}</span>
        </span>
      </div>`).join('') || '<div style="font-size:12px;color:#b0b8c8;padding:8px 0;text-align:center">出勤記録なし</div>';

    html += `
      <div class="m-dash-card">
        <div class="dash-card-label">👥 本日の出勤状況</div>
        <div style="display:flex;align-items:flex-end;gap:6px;margin-bottom:4px">
          <span style="font-size:36px;font-weight:800;letter-spacing:-1px">${attendedCount}</span>
          <span style="font-size:16px;font-weight:700;color:#c0c8d8;margin-bottom:4px">/ ${scheduledCount}名</span>
        </div>
        <div class="dash-prog-bar"><div class="dash-prog-fill" style="width:${pct}%;background:linear-gradient(90deg,#3a7d5a,#52b788)"></div></div>
        <div style="font-size:10px;color:#8a93a6;text-align:right;margin-top:4px">${pct}%</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
        <div class="m-dash-card" style="cursor:pointer" onclick="switchMobile('reports',document.querySelector('[onclick*=reports]'))">
          <div class="dash-card-label" style="margin-bottom:8px">📨 未読日報</div>
          <div class="dash-stat-num" style="font-size:28px;color:${unread>0?'#e53e3e':'#3a7d5a'}">${unread}</div>
        </div>
        <div class="m-dash-card" style="cursor:pointer" onclick="switchMobile('daily',document.querySelector('[onclick*=daily]'))">
          <div class="dash-card-label" style="margin-bottom:8px">📅 シフト</div>
          <div class="dash-stat-num" style="font-size:28px">${scheduledCount}</div>
        </div>
      </div>
      ${unreadForms > 0 ? `
      <div class="m-dash-card" style="cursor:pointer;border:1.5px solid rgba(124,58,237,.3)" onclick="switchMobile('reports',document.querySelector('[onclick*=reports]'));filterReportsMobile('onboarding')">
        <div class="dash-card-label" style="margin-bottom:8px;color:#7c3aed">📋 入社フォーム</div>
        <div style="font-size:28px;font-weight:800;color:#7c3aed;letter-spacing:-1px">${unreadForms}</div>
        <div style="font-size:11px;color:#8a93a6;margin-top:2px">件の未確認フォーム</div>
      </div>` : ''}
      <div class="m-dash-card">
        <div class="dash-card-label">🟢 打刻状況</div>
        ${attHtml}
      </div>
      ${mental.length ? `
      <div class="m-dash-card">
        <div class="dash-card-label">🌤 メンタル（本日）</div>
        <div>${MENTAL_ORDER.map(k => {
          const cnt = mental.filter(r => r.mentalWeather === k).length;
          if (!cnt) return '';
          const mw = MENTAL_WEATHER[k];
          return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:99px;background:${mw.bg};color:${mw.color};font-size:12px;font-weight:700;margin:2px">${mw.icon} ${cnt}</span>`;
        }).join('')}</div>
        ${negMembers.length ? `<div style="margin-top:10px;font-size:11px;font-weight:700;color:#e53e3e;margin-bottom:4px">⚠️ 要注意</div>
        ${negMembers.slice(0,3).map(r => {
          const mw = MENTAL_WEATHER[r.mentalWeather];
          return `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f0f2f5;font-size:12px"><span>${r.name}</span><span style="color:${mw?.color}">${mw?.icon} ${r.mentalWeather}</span></div>`;
        }).join('')}` : ''}
      </div>` : ''}`;

  } else if (role === 'leader') {
    const { deptAtt, deptShifts, deptMental, deptMemberIds, pct, myDept } = data;
    html += `
      <div class="m-dash-card">
        <div class="dash-card-label">👥 ${myDept} 出勤状況</div>
        <div style="display:flex;align-items:flex-end;gap:6px;margin-bottom:4px">
          <span style="font-size:36px;font-weight:800;letter-spacing:-1px">${deptAtt.length}</span>
          <span style="font-size:16px;font-weight:700;color:#c0c8d8;margin-bottom:4px">/ ${deptMemberIds.length}名</span>
        </div>
        <div class="dash-prog-bar"><div class="dash-prog-fill" style="width:${pct}%;background:linear-gradient(90deg,#2a5298,#4a7bc8)"></div></div>
      </div>
      <div class="m-dash-card">
        <div class="dash-card-label">📅 本日のシフト</div>
        ${deptShifts.length ? deptShifts.map(s => `
          <div class="dash-shift-row">
            <span class="member-chip" style="font-size:11px">${s.name||'—'}</span>
            <span class="dash-shift-time">${s.startTime||'—'}〜${s.endTime||'—'}</span>
            <span class="dash-shift-loc">📍${s.location||'—'}</span>
          </div>`).join('') : '<div style="font-size:12px;color:#b0b8c8;text-align:center;padding:8px">本日のシフトなし</div>'}
      </div>
      ${deptMental.length ? `
      <div class="m-dash-card">
        <div class="dash-card-label">🌤 メンタル天気</div>
        ${deptMental.map(r => {
          const mw = MENTAL_WEATHER[r.mentalWeather];
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #f0f2f5">
            <span style="font-size:13px;font-weight:600">${r.name}</span>
            <span style="font-size:12px;padding:3px 10px;border-radius:99px;background:${mw?.bg};color:${mw?.color};font-weight:700">${mw?.icon} ${r.mentalWeather}</span>
          </div>`;
        }).join('')}
      </div>` : ''}`;

  } else {
    const { myAtt, myShift, isIn, isOut, statusLabel, statusColor, statusBg, myMentalHist } = data;
    html += `
      <div class="m-dash-card">
        <div class="dash-card-label">📍 本日の打刻状況</div>
        <div style="text-align:center;padding:12px 0">
          <div style="display:inline-block;padding:6px 18px;border-radius:99px;background:${statusBg};color:${statusColor};font-weight:700;font-size:14px;margin-bottom:10px">${statusLabel}</div>
          ${(isIn || isOut) ? `
          <div style="display:flex;justify-content:center;gap:28px;margin-top:4px">
            <div style="text-align:center">
              <div style="font-size:24px;font-weight:700;font-family:'DM Mono',monospace;color:#3a7d5a">${toHHMM(myAtt.clockIn)||'—'}</div>
              <div style="font-size:10px;color:#8a93a6;font-weight:600;text-transform:uppercase;letter-spacing:1px">出勤</div>
            </div>
            ${isOut ? `
            <div style="text-align:center">
              <div style="font-size:24px;font-weight:700;font-family:'DM Mono',monospace;color:#2a5298">${toHHMM(myAtt.clockOut)||'—'}</div>
              <div style="font-size:10px;color:#8a93a6;font-weight:600;text-transform:uppercase;letter-spacing:1px">退勤</div>
            </div>` : ''}
          </div>` : '<div style="font-size:12px;color:#b0b8c8">出退勤タブから打刻してください</div>'}
        </div>
        ${myShift ? `
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid #f0f2f5;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span style="font-size:11px;color:#8a93a6">本日のシフト</span>
          <span style="font-size:13px;font-weight:700;font-family:'DM Mono',monospace;color:#2a5298">${myShift.startTime||'—'}〜${myShift.endTime||'—'}</span>
          ${myShift.location ? `<span style="font-size:11px;color:#8a93a6">📍 ${myShift.location}</span>` : ''}
        </div>` : ''}
      </div>
      ${myMentalHist.length ? `
      <div class="m-dash-card">
        <div class="dash-card-label">🌤 メンタル天気（直近）</div>
        ${myMentalHist.map(r => {
          const mw = MENTAL_WEATHER[r.mentalWeather];
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f0f2f5">
            <span style="font-size:11px;color:#8a93a6">${r.date}</span>
            <span style="font-size:12px;padding:3px 10px;border-radius:99px;background:${mw?.bg};color:${mw?.color};font-weight:700">${mw?.icon} ${r.mentalWeather}</span>
          </div>`;
        }).join('')}
      </div>` : ''}`;
  }

  el.innerHTML = html;
}

window.loadDashboard = loadDashboard;
