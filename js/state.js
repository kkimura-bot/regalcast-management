// ============================================================
// Shared application state (RC object)
// All modules import { RC } and mutate RC.xxx directly.
// Using an object avoids primitive-binding issues with ES modules.
// ============================================================

export const RC = {
  // Auth
  currentUser:     null,
  currentRole:     null,
  currentUserData: null,

  // Alliance mode
  _isAllianceMode: false,

  // Caches
  _cachedMembers:    [],
  _cachedTasks:      [],
  _cachedAttendance: [],
  _cachedProjects:   [],
  _cachedSalary:     [],

  // Filters
  _taskFilter: { status: 'all', member: 'all', dept: 'all' },
  _pjFilter:   { status: 'all', member: 'all', dept: 'all' },

  // Shift week navigation
  _shiftWeekOffset: 0,
};

// ── Helpers (role checks) ──────────────────────────────────

export function isAdmin() {
  return RC.currentRole === 'admin';
}

export function isLeaderOrAbove() {
  return RC.currentRole === 'admin' || RC.currentRole === 'leader';
}

export function roleLabel(role) {
  if (role === 'admin')  return '管理者';
  if (role === 'leader') return 'リーダー';
  return 'メンバー';
}

// グローバル公開（HTMLのinline scriptからアクセス可能にする）
window.RC = RC;
