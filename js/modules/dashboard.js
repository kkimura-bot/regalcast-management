// ============================================================
// Dashboard module
// ============================================================
import { RC, isAdmin, isLeaderOrAbove } from '../state.js';
import {
  db, collection, getDocs, query, where, orderBy, limit
} from '../firebase.js';
import { todayJST, fmtDate, isOverdue } from '../utils/helpers.js';

export async function loadDashboard() {
  const emptyHint = document.getElementById('dash-empty-hint');
  if (emptyHint) emptyHint.style.display = 'none';

  const today = todayJST();

  // ── Task KPIs ─────────────────────────────────────────
  let taskQuery;
  if (isLeaderOrAbove()) {
    taskQuery = query(collection(db,'tasks'));
  } else {
    taskQuery = query(collection(db,'tasks'), where('member','==', RC.currentUserData?.name || ''));
  }
  const taskSnap = await getDocs(taskQuery);
  const tasks = taskSnap.docs.map(d => d.data());

  const total   = tasks.length;
  const done    = tasks.filter(t => (t.progress||0) >= 1).length;
  const active  = tasks.filter(t => (t.progress||0) > 0 && (t.progress||0) < 1).length;
  const overdue = tasks.filter(t => t.end && t.end < today && (t.progress||0) < 1).length;

  ['kpi-total','m-kpi-total'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=total; });
  ['kpi-done','m-kpi-done'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=done; });
  ['kpi-active','m-kpi-active'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=active; });
  ['kpi-overdue','m-kpi-overdue'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=overdue; });

  // ── Recent tasks table ────────────────────────────────
  const recentTasks = tasks
    .filter(t => (t.progress||0) < 1)
    .sort((a,b) => (a.end||'9999') < (b.end||'9999') ? -1 : 1)
    .slice(0, 8);

  ['dash-tasks','m-dash-tasks'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!recentTasks.length) { el.innerHTML = '<div class="empty">進行中タスクなし</div>'; return; }
    if (id === 'dash-tasks') {
      el.innerHTML = recentTasks.map(t => {
        const over = t.end && t.end < today;
        return `<tr>
          <td style="font-weight:600">${t.name||'—'}</td>
          <td><span class="member-chip">${t.member||'—'}</span></td>
          <td style="font-size:11px;color:${over?'var(--accent)':'var(--ink3)'}${over?';font-weight:700':''}">${t.end?fmtDate(t.end):'—'}</td>
          <td><div style="display:flex;align-items:center;gap:6px">
            <div style="flex:1;height:4px;background:var(--surface2);border-radius:2px;overflow:hidden">
              <div style="height:100%;width:${Math.round((t.progress||0)*100)}%;background:${over?'#c8472a':'#2a5298'};border-radius:2px"></div>
            </div>
            <span style="font-size:10px;color:var(--ink3);font-family:'DM Mono',monospace">${Math.round((t.progress||0)*100)}%</span>
          </div></td>
        </tr>`;
      }).join('');
    } else {
      // Mobile
      el.innerHTML = recentTasks.map(t => {
        const over = t.end && t.end < today;
        const pct  = Math.round((t.progress||0)*100);
        return `<div class="m-card">
          <div style="display:flex;justify-content:space-between;margin-bottom:5px">
            <span style="font-weight:700;font-size:12px">${t.name||'—'}</span>
            <span style="font-size:11px;color:${over?'var(--accent)':'var(--ink3)'}">${t.end?fmtDate(t.end):'—'}</span>
          </div>
          <div style="font-size:11px;color:var(--ink3);margin-bottom:5px">${t.member||'—'}</div>
          <div style="display:flex;align-items:center;gap:6px">
            <div style="flex:1;height:3px;background:var(--surface2);border-radius:2px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:${over?'#c8472a':'#2a5298'};border-radius:2px"></div>
            </div>
            <span style="font-size:10px;color:var(--ink3)">${pct}%</span>
          </div>
        </div>`;
      }).join('');
    }
  });

  // ── Today attendance (leader/admin) ───────────────────
  if (isLeaderOrAbove()) {
    const attSnap = await getDocs(query(collection(db,'attendance'), where('date','==',today)));
    const attRecords = attSnap.docs.map(d => d.data());

    const toHHMM = iso => {
      if (!iso) return '—';
      const d = new Date(iso);
      return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
    };

    const buildAttRows = (records) => {
      if (!records.length) return '<tr><td colspan="3" class="empty">出勤記録なし</td></tr>';
      return records.map(r => `<tr>
        <td style="font-size:12px;font-weight:600">${r.name||'—'}</td>
        <td style="font-size:12px;font-family:'DM Mono',monospace;color:var(--accent2)">${toHHMM(r.clockIn)}</td>
        <td style="font-size:12px;font-family:'DM Mono',monospace;color:var(--blue)">${toHHMM(r.clockOut)}</td>
      </tr>`).join('');
    };

    const attTbody = document.getElementById('dash-attendance');
    if (attTbody) attTbody.innerHTML = buildAttRows(attRecords);

    const mAtt = document.getElementById('m-dash-attendance');
    if (mAtt) {
      mAtt.innerHTML = attRecords.map(r => `<div class="m-card" style="padding:9px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:12px;font-weight:600">${r.name||'—'}</span>
        <div style="display:flex;gap:10px;font-size:12px;font-family:'DM Mono',monospace">
          <span style="color:var(--accent2)">${toHHMM(r.clockIn)}</span>
          <span style="color:var(--blue)">${toHHMM(r.clockOut)}</span>
        </div>
      </div>`).join('') || '<div class="empty">出勤記録なし</div>';
    }
  }
}

// ── Show KPI task list ────────────────────────────────────

export function showKpiTasks(type) {
  const today = todayJST();
  let tasks = RC._cachedTasks || [];
  if      (type === 'done')    tasks = tasks.filter(t => (t.progress||0) >= 1);
  else if (type === 'active')  tasks = tasks.filter(t => (t.progress||0) > 0 && (t.progress||0) < 1);
  else if (type === 'overdue') tasks = tasks.filter(t => t.end && t.end < today && (t.progress||0) < 1);

  document.getElementById('modal-title-text').textContent = type === 'total' ? '全タスク' : type === 'done' ? '完了タスク' : type === 'active' ? '進行中タスク' : '期限超過タスク';
  document.getElementById('modal-body').innerHTML = tasks.length
    ? `<div style="max-height:400px;overflow-y:auto">${tasks.map(t => `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
        <div style="font-size:13px;font-weight:600">${t.name||'—'}</div>
        <div style="font-size:11px;color:var(--ink3)">${t.member||'—'} ｜ ${t.end?fmtDate(t.end):'期限未設定'}</div>
      </div>`).join('')}</div>`
    : '<div class="empty">該当するタスクがありません</div>';
  window.openModal();
}

window.loadDashboard = loadDashboard;
window.showKpiTasks  = showKpiTasks;
