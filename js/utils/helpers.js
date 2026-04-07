// ============================================================
// General utility helpers
// ============================================================

// HTML escape
export function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Format a YYYY-MM-DD string to locale display
export function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${y}/${m}/${d}`;
}

// Get current date in JST as YYYY-MM-DD
export function todayJST() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
}

// Get end-of-month date string (YYYY-MM-DD)
export function getMonthEnd(ym) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m, 0).getDate();
  return `${ym}-${String(d).padStart(2,'0')}`;
}

// Check if a date string is overdue relative to today
export function isOverdue(dateStr) {
  if (!dateStr) return false;
  return dateStr < todayJST();
}

// Progress bar color based on value (0-1)
export function progColor(v) {
  if (v >= 1)   return '#3a7d5a';
  if (v >= 0.6) return '#2a5298';
  if (v >= 0.2) return '#d4720a';
  return '#c8472a';
}

// Progress bar HTML
export function progBar(progress, overdue) {
  const pct = Math.round((progress || 0) * 100);
  const color = overdue && pct < 100 ? '#c8472a' : progColor(progress || 0);
  return `<div class="prog-wrap">
    <div class="prog-bar"><div class="prog-fill" style="width:${pct}%;background:${color}"></div></div>
    <div class="prog-label">${pct}%</div>
  </div>`;
}

// Switch PC tab
export function switchTab(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-group').forEach(g => g.classList.remove('active'));
  const view = document.getElementById('view-' + name);
  if (view) view.classList.add('active');
  document.querySelectorAll('.tab[data-tab]').forEach(t => {
    if (t.dataset.tab === name) {
      t.classList.add('active');
      const group = t.closest('.tab-group');
      if (group) group.classList.add('active');
    }
  });

  // Lazy-load on tab switch
  if (name === 'tasks')      window.loadTasks?.();
  if (name === 'projects')   window.loadProjects?.();
  if (name === 'attendance') window.loadAttendanceToday?.();
  if (name === 'shifts')     window.loadShifts?.();
  if (name === 'monthly')    window.loadMonthlyAttendance?.(true);
  if (name === 'daily')      window.loadDailyCheck?.();
  if (name === 'reports')    window.loadReports?.();
  if (name === 'alert')      window.loadAlertReports?.();
  if (name === 'salary')     window.loadSalary?.();
  if (name === 'users')      window.loadUsers?.();
  if (name === 'onboarding')  window.loadOnboarding?.();
  if (name === 'offboarding') window.loadOffboarding?.();
  if (name === 'shops')       window.loadShops?.();
  if (name === 'mental')     window.loadMentalData?.();
  if (name === 'myshift')    window.loadMyShiftReport?.();
  if (name === 'mysalary')   window.loadMySalaryPage?.();
  if (name === 'mypage')     window.loadMyPage?.();
  if (name === 'dashboard')  window.loadDashboard?.();
}

// Event delegation: nav-tab clicks (pointer-event-safe, no onclick dependency)
// module scripts run after DOM is parsed, so direct setup is safe
(function initNavTabListeners() {
  const navTabs = document.querySelector('.nav-tabs');
  if (navTabs) {
    navTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) switchTab(tab.dataset.tab);
    });
  }
})();

window.switchTab = switchTab;

// HTML escape exported for window too
window.escHtml = escHtml;
window.fmtDate  = fmtDate;
window.todayJST = todayJST;
window.getMonthEnd = getMonthEnd;
window.isOverdue   = isOverdue;
window.progColor   = progColor;
window.progBar     = progBar;
