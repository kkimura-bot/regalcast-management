// ============================================================
// Main entry point
// ============================================================
import { RC, isAdmin, isLeaderOrAbove } from './state.js';
import { db, collection, getDocs, query, orderBy } from './firebase.js';
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
import './modules/shops.js';
import './modules/salary.js';
import './modules/mental.js';
import './modules/mypage.js';
import './modules/tasks.js';
import './modules/projects.js';

// ── postLoginSetup ────────────────────────────────────────

export function postLoginSetup() {
  const addShiftBtn = document.getElementById('add-shift-btn');
  if (addShiftBtn) addShiftBtn.style.display = isAdmin() ? '' : 'none';
  const importShiftBtn = document.getElementById('import-shift-btn');
  if (importShiftBtn) importShiftBtn.style.display = isAdmin() ? '' : 'none';
  const bulkShiftBtn = document.getElementById('bulk-shift-btn');
  if (bulkShiftBtn) bulkShiftBtn.style.display = isAdmin() ? '' : 'none';
  const deleteMemberShiftBtn = document.getElementById('delete-member-shift-btn');
  if (deleteMemberShiftBtn) deleteMemberShiftBtn.style.display = isAdmin() ? '' : 'none';
  const requestOffBtn = document.getElementById('request-off-btn');
  if (requestOffBtn) requestOffBtn.style.display = !isAdmin() ? '' : 'none';
  const adminOffBtn = document.getElementById('admin-off-btn');
  if (adminOffBtn) adminOffBtn.style.display = isAdmin() ? '' : 'none';

  if (isLeaderOrAbove()) {
    const dashAttSection = document.getElementById('dash-att-section');
    if (dashAttSection) dashAttSection.style.display = '';
    const dashAttWrap = document.getElementById('dash-att-wrap');
    if (dashAttWrap) dashAttWrap.style.display = '';
    const mDashAttSection = document.getElementById('m-dash-att-section');
    if (mDashAttSection) mDashAttSection.style.display = '';
    const mDashAttDiv = document.getElementById('m-dash-attendance');
    if (mDashAttDiv) mDashAttDiv.style.display = '';
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
          + RC._cachedMembers.map(u=>`<option value="${u.name}">${u.name}</option>`).join('');
      }
    }
    const mAttMemberRow = document.getElementById('m-att-member-row');
    if (mAttMemberRow) mAttMemberRow.style.display = '';
    const mFilterSel = document.getElementById('att-member-filter-m');
    if (mFilterSel && RC._cachedMembers.length) {
      mFilterSel.innerHTML = '<option value="">全員</option>'
        + RC._cachedMembers.map(u=>`<option value="${u.name}">${u.name}</option>`).join('');
    }
    if (isAdmin()) {
      ['att-add-btn','m-att-add-btn','att-bulk-gen-btn'].forEach(id => { const el=document.getElementById(id); if(el) el.style.display=''; });
    }
  }

  const roleEl = document.getElementById('user-role-display');
  if (roleEl) roleEl.style.color = RC.currentRole==='leader' ? 'var(--warn)' : '';
  const mnDisplay = document.getElementById('user-name-display-m');
  if (mnDisplay && RC.currentUserData) mnDisplay.textContent = RC.currentUserData.name;

  if (isAdmin()) {
    window.updateReportBadge?.();
    window.updateAlertBadge?.();
    window.updateOffRequestBadge?.();
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
}

window.postLoginSetup = postLoginSetup;

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
  ['att-month','att-month-m','mental-month','mental-month-m','myshift-month','myshift-month-m'].forEach(id => {
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
