// ============================================================
// Main entry point
// ============================================================
import { RC, isAdmin, isLeaderOrAbove } from './state.js';
import { db, doc, getDoc, collection, getDocs, query, orderBy } from './firebase.js';
import { initAuthListener } from './auth.js';

// Utils (side-effect: assigns to window)
import './utils/modal.js';
import './utils/helpers.js';
import './utils/fare.js';

// Modules (side-effect: assigns to window)
import './modules/nav.js';
import './modules/attendance.js';
import './modules/shifts.js';
import './modules/dashboard.js';
import './modules/daily.js';
import './modules/reports.js';
import './modules/users.js';
import './modules/salary.js';
import './modules/mental.js';
import './modules/mypage.js';
import './modules/profiles.js';
import './modules/onboarding.js';
import './modules/offboarding.js';
import './modules/notifications.js';
// import './modules/member-tasks.js'; // タスク機能を一時非表示
import './modules/form-submissions.js';
import './modules/paid-leave.js';
import './modules/overtime.js';
import './modules/admin-manual.js';

// ── postLoginSetup ────────────────────────────────────────

export function postLoginSetup() {

  if (isLeaderOrAbove()) {
    const attTeamCard = document.getElementById('att-team-card');
    if (attTeamCard) attTeamCard.style.display = '';
    const attThMember = document.getElementById('att-th-member');
    if (attThMember) attThMember.style.display = '';
    const attColMember = document.getElementById('att-col-member');
    if (attColMember) attColMember.style.display = '';
    const filterWrap = document.getElementById('att-member-filter-wrap');
    if (filterWrap) filterWrap.style.display = 'flex';
    const filterLabel = document.getElementById('att-member-label');
    if (filterLabel) filterLabel.style.display = 'inline';
    const filterSel = document.getElementById('att-member-filter');
    if (filterSel) {
      filterSel.style.display = 'inline-block';
      if (RC._cachedMembers.length) {
        filterSel.innerHTML = '<option value="">全員</option>'
          + RC._cachedMembers.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
      }
    }
    const mAttMemberRow = document.getElementById('m-att-member-row');
    if (mAttMemberRow) mAttMemberRow.style.display = '';
    const mFilterSel = document.getElementById('att-member-filter-m');
    if (mFilterSel && RC._cachedMembers.length) {
      mFilterSel.innerHTML = '<option value="">全員</option>'
        + RC._cachedMembers.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
    }
    if (isAdmin()) {
      ['att-add-btn','m-att-add-btn'].forEach(id => { const el=document.getElementById(id); if(el) el.style.display=''; });
    }
  }

  const roleEl = document.getElementById('user-role-display');
  if (roleEl) roleEl.style.color = RC.currentRole==='leader' ? 'var(--warn)' : '';
  const mnDisplay = document.getElementById('user-name-display-m');
  if (mnDisplay && RC.currentUserData) mnDisplay.textContent = RC.currentUserData.name;

  // 有給申請バッジ（全ロール呼び出すが、管理者だけ件数表示される仕組み）
  window.updatePaidLeaveBadges?.();
  // 残業申請バッジ
  window.updateOvertimeBadge?.();

  // 希望休申請ボタン：メンバー・リーダー向けに表示（20日以降はボタン自体はあるがモーダル内でロック）
  const requestOffBtn = document.getElementById('request-off-btn');
  if (requestOffBtn && !isAdmin()) requestOffBtn.style.display = '';
  // 管理者は承認バッジを更新（ボタン表示は受注管理アプリ側に移譲）
  if (isAdmin()) window.updateOffRequestBadge?.();

  if (isAdmin()) {
    window.updateReportBadge?.();
    window.updateAlertBadge?.();
    window.updateOffRequestBadge?.();
    window.loadFormSubmissions?.();
    const shiftMemberFilter = document.getElementById('shift-member-filter');
    if (shiftMemberFilter) {
      shiftMemberFilter.style.display = 'inline-block';
      if (RC._cachedMembers.length) {
        shiftMemberFilter.innerHTML = '<option value="">全員</option>'
          + RC._cachedMembers.map(u=>`<option value="${u.id}">${u.name}</option>`).join('');
      }
    }
    const shiftSearchWrap = document.getElementById('shift-search-wrap');
    if (shiftSearchWrap) shiftSearchWrap.style.display = 'flex';
    ['delete-member-shift-btn','sync-orders-shift-btn'].forEach(id => { const el=document.getElementById(id); if(el) el.style.display=''; });
  }

  if (isLeaderOrAbove() && !isAdmin()) {
    const shiftLeaderFilter = document.getElementById('shift-leader-filter');
    if (shiftLeaderFilter) shiftLeaderFilter.style.display = 'inline-block';
    const mShiftLeaderRow = document.getElementById('m-shift-leader-filter-row');
    if (mShiftLeaderRow) mShiftLeaderRow.style.display = '';
    const attLeaderFilter = document.getElementById('att-leader-filter');
    if (attLeaderFilter) attLeaderFilter.style.display = 'inline-block';
  }

  if (isLeaderOrAbove()) {
    const attSearchWrap = document.getElementById('att-search-wrap');
    if (attSearchWrap) attSearchWrap.style.display = 'flex';
  }

  const myDeptForFilter = RC.currentUserData?.dept || '';
  ['task-dept-filter-row', 'pj-dept-filter-row'].forEach(rowId => {
    const row = document.getElementById(rowId);
    if (!row) return;
    if (isLeaderOrAbove()) {
      row.querySelectorAll('.pj-filter-btn').forEach(b => b.style.display = '');
    } else {
      row.querySelectorAll('.pj-filter-btn').forEach(b => {
        const dept = b.dataset.dept;
        if (!dept) { b.style.display = 'none'; return; }
        if (dept === 'all') { b.style.display = 'none'; return; }
        b.style.display = (dept === myDeptForFilter) ? '' : 'none';
      });
    }
  });
  if (!isAdmin()) {
    window.loadMySalaryInfo?.();
  }
  loadGoalWidget();
  // window.loadMemberTaskWidget?.(); // タスク機能を一時非表示
  // if (isLeaderOrAbove()) {
  //   window.loadTaskSummaryWidget?.();
  // }
  // if (isAdmin()) {
  //   window.loadUnlinkedTasksWidget?.();
  // }
}

window.postLoginSetup = postLoginSetup;

// ── 今月の目標ウィジェット ──────────────────────────────────

async function loadGoalWidget() {
  // 管理者でも自分の目標を表示する（member限定を解除）
  const name = RC.currentUserData?.name;
  if (!name) return;
  const card = document.getElementById('m-goal-widget');
  if (!card) return;

  try {
    const snap = await getDoc(doc(db, 'academy_roadmap', `${name}_custom_plan`));

    // 未設定メンバー
    if (!snap.exists() || !snap.data()?.periods) {
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:16px">🎯</span>
          <span style="font-size:12px;font-weight:700;color:var(--ink)">成長ロードマップ</span>
        </div>
        <div style="font-size:12px;color:var(--ink2);line-height:1.7;background:rgba(217,119,6,.06);border:1px solid rgba(217,119,6,.2);border-radius:8px;padding:10px 12px">
          📌 まだ目標が設定されていません。<br>
          <strong>上長と一緒に目標を決めましょう！</strong>
        </div>
      `;
      card.style.display = 'block';
      return;
    }

    const data = snap.data();
    const periods = data.periods;
    const createdAt = data.created_at?.toDate?.() || data.updated_at?.toDate?.() || new Date();

    // 経過月数を計算
    const now = new Date();
    const monthsElapsed = (now.getFullYear() - createdAt.getFullYear()) * 12
      + (now.getMonth() - createdAt.getMonth());

    // 期間を選択
    let periodKey, offsetMonths;
    if (monthsElapsed < 1)      { periodKey = '1month';  offsetMonths = 1; }
    else if (monthsElapsed < 3) { periodKey = '3months'; offsetMonths = 3; }
    else if (monthsElapsed < 6) { periodKey = '6months'; offsetMonths = 6; }
    else                        { periodKey = null; }

    // 6ヶ月超 → 更新促しメッセージ
    if (!periodKey || !periods[periodKey]) {
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:16px">🔄</span>
          <span style="font-size:12px;font-weight:700;color:var(--ink)">ロードマップ更新時期</span>
        </div>
        <div style="font-size:12px;color:var(--ink2);line-height:1.7;background:rgba(37,99,235,.05);border:1px solid rgba(37,99,235,.15);border-radius:8px;padding:10px 12px">
          目標設定から6ヶ月が経過しました。<br>
          <strong>上長と新しい目標を設定しましょう！</strong>
        </div>
        <a href="roadmap.html" style="display:inline-block;margin-top:10px;font-size:11px;font-weight:600;color:var(--blue);text-decoration:none;padding:4px 10px;border:1px solid rgba(37,99,235,.25);border-radius:20px;background:rgba(37,99,235,.05)">ロードマップを開く →</a>
      `;
      card.style.display = 'block';
      return;
    }

    // 達成目標月を計算
    const targetDate = new Date(createdAt);
    targetDate.setMonth(targetDate.getMonth() + offsetMonths);
    const targetMonth = `${targetDate.getMonth() + 1}月`;

    renderGoalWidget(periods[periodKey], targetMonth);
  } catch (e) {
    console.log('Goal widget load failed:', e);
  }
}

function renderGoalWidget(period, targetMonth) {
  const card = document.getElementById('m-goal-widget');
  if (!card) return;
  const esc = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const actionsHtml = (period.actions || []).map(a => `
    <div style="display:flex;align-items:flex-start;gap:6px;font-size:12px;color:var(--ink2);line-height:1.5">
      <span style="font-size:8px;color:var(--accent2);margin-top:4px;flex-shrink:0">▶</span>
      <span>${esc(a)}</span>
    </div>
  `).join('');
  card.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div style="font-size:12px;font-weight:700;color:var(--ink);display:flex;align-items:center;gap:6px">
        🎯 <span>${targetMonth}達成目標</span>
      </div>
      <a href="roadmap.html" style="font-size:11px;font-weight:600;color:var(--blue);text-decoration:none;padding:3px 8px;border:1px solid rgba(37,99,235,.25);border-radius:20px;background:rgba(37,99,235,.05)">詳細 →</a>
    </div>
    <div style="font-size:13px;font-weight:600;color:var(--ink);line-height:1.55;padding:10px 12px;background:rgba(5,150,105,.06);border-left:3px solid var(--accent2);border-radius:0 6px 6px 0;margin-bottom:10px">${esc(period.goal)}</div>
    ${actionsHtml ? `
      <div style="font-size:10px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">アクション</div>
      <div style="display:flex;flex-direction:column;gap:5px">${actionsHtml}</div>
    ` : ''}
  `;
  card.style.display = 'block';
}

// ── Mobile project cards helper ───────────────────────────

function renderMobileProjects(projects) {
  const cont = document.getElementById('m-pj-list');
  if (!cont) return;
  if (!projects || projects.length === 0) {
    cont.innerHTML = '<div class="empty">プロジェクトがありません</div>'; return;
  }
  cont.innerHTML = projects.map(p => {
    const over = window.isOverdue?.(p.end) && p.progress < 1;
    const done = p.progress >= 1;
    const pct = Math.round((p.progress||0)*100);
    const barColor = over ? '#c8472a' : done ? '#3a7d5a' : '#2a5298';
    return `<div class="m-card" onclick="editProject('${p.id}')">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div style="font-size:13px;font-weight:700;flex:1;padding-right:8px">${p.name}</div>
        <span class="badge ${over?'':'badge-'+( done?'done':pct>0?'doing':'todo')}" style="${over?'background:#fee2e2;color:var(--accent)':''}">${over?'超過':done?'完了':pct>0?'進行中':'未着手'}</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
        <span class="member-chip">${p.member||'—'}</span>
        <span style="font-size:11px;color:${over?'var(--accent)':'var(--ink3)'}">📅 ${p.end?window.fmtDate?.(p.end)||p.end:'期限未設定'}</span>
        <span style="font-size:11px;color:var(--ink3)">${p.goal||''}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="flex:1;height:5px;background:var(--surface2);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${barColor};border-radius:3px"></div>
        </div>
        <div style="font-size:11px;font-family:'DM Mono',monospace;color:var(--ink3);width:30px;text-align:right">${pct}%</div>
      </div>
    </div>`;
  }).join('');
}

window.renderMobileProjects = renderMobileProjects;

// ── Patch loadProjects to also render mobile ──────────────

function patchLoadProjects() {
  const origLoadProjects = window.loadProjects;
  if (!origLoadProjects) return;
  window.loadProjects = async () => {
    const snap = await getDocs(query(collection(db, 'projects'), orderBy('createdAt','desc')));
    RC._cachedProjects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    window.renderProjectsTable?.(window.getFilteredProjects?.());
    if (window.currentPJView === 'gantt') window.renderGantt?.(window.getFilteredProjects?.());
    renderMobileProjects(RC._cachedProjects);
  };
}

// ── Init month inputs ─────────────────────────────────────

function initMonthInputs() {
  const nowMonth = new Date(new Date().toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})).toLocaleDateString('sv-SE').slice(0,7);
  ['att-month','att-month-m','mental-month','mental-month-m'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = nowMonth;
  });
}

// ── Boot ──────────────────────────────────────────────────

initMonthInputs();
initAuthListener();

window.addEventListener('resize', () => window.adjustMobileNavPadding?.());

// Patch after modules load (small delay to ensure all modules registered)
setTimeout(patchLoadProjects, 0);
