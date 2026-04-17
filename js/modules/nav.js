// ============================================================
// Navigation helpers
// ============================================================
import { RC, isAdmin, isLeaderOrAbove } from '../state.js';

export function adjustMobileNavPadding() {
  const nav = document.querySelector('.mobile-nav');
  const content = document.querySelector('.mobile-content');
  if (!nav || !content) return;
  const navH = nav.offsetHeight;
  content.style.paddingBottom = navH + 'px';
  // mobile-view.active のスクロール領域にも同じ padding を適用
  document.querySelectorAll('.mobile-view').forEach(v => {
    v.style.paddingBottom = (navH + 16) + 'px';
  });
}

export function switchMobile(name, el) {
  document.querySelectorAll('.mobile-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.mnav-item').forEach(i => i.classList.remove('active'));
  const view = document.getElementById('m-view-' + name);
  if (view) view.classList.add('active');
  if (el)  el.classList.add('active');

  // Update page title
  const titleEl = document.getElementById('m-page-title');
  if (titleEl && el) {
    const label = el.querySelector('.mnav-label');
    if (label) titleEl.textContent = label.textContent.replace(/\s+/g,' ').trim();
  }

  // FAB: show only on tasks / projects views
  const fab = document.getElementById('fab-btn');
  if (fab) fab.style.display = (name === 'tasks' || name === 'projects') ? 'flex' : 'none';

  // Lazy-load
  if (name === 'tasks')       window.loadTasks?.();
  if (name === 'projects')    window.loadProjects?.();
  if (name === 'attendance')  window.loadAttendanceToday?.();
  if (name === 'shifts')      window.loadShifts?.();
  if (name === 'monthly')     window.loadMonthlyAttendance?.(true);
  if (name === 'daily')       window.loadDailyCheckM?.(true);
  if (name === 'reports')     window.loadReportsM?.();
  if (name === 'alert')       window.loadAlertReports?.();
  if (name === 'salary')      window.loadSalary?.();
  if (name === 'users')       window.loadUsers?.();
  if (name === 'onboarding')  window.loadOnboarding?.();
  if (name === 'offboarding') window.loadOffboarding?.();
  if (name === 'formsubmissions') window.loadFormSubmissions?.();
  if (name === 'mental')      window.loadMentalData?.();
  if (name === 'myshift')     window.loadMyShiftReport?.();
  if (name === 'mysalary')    window.loadMySalaryPage?.();
  if (name === 'mypage')      window.loadMyPage?.();
  if (name === 'adminshifts') window.loadAdminShiftsM?.();
  if (name === 'dashboard')    window.loadDashboard?.();
  if (name === 'membertasks')  window.loadAdminMemberTasks?.();
}

window.switchMobile            = switchMobile;
window.adjustMobileNavPadding  = adjustMobileNavPadding;
