// ============================================================
// Mental Weather module
// ============================================================
import { RC, isAdmin, isLeaderOrAbove } from '../state.js';
import {
  db, collection, getDocs, query, where, orderBy
} from '../firebase.js';
import { MENTAL_WEATHER } from '../data/constants.js';
import { getMonthEnd } from '../utils/helpers.js';

const MENTAL_ORDER = ['快晴','曇り','雨','豪雨','雷','嵐','天災'];

let _cachedMentalMembers = [];

export function mentalBadge(weather) {
  const mw = MENTAL_WEATHER[weather];
  if (!mw) return '';
  return `<span style="font-size:14px" title="${weather}">${mw.icon}</span>`;
}

export async function loadMentalData() {
  const month = document.getElementById('mental-month')?.value
             || document.getElementById('mental-month-m')?.value
             || new Date().toISOString().slice(0,7);
  ['mental-month','mental-month-m'].forEach(id => { const el=document.getElementById(id); if(el) el.value=month; });

  const snap = await getDocs(query(
    collection(db,'attendance'),
    where('date','>=',month+'-01'),
    where('date','<=',getMonthEnd(month))
  ));
  const records = snap.docs.map(d=>d.data()).filter(r=>r.mentalWeather);

  let filtered = records;
  if (isLeaderOrAbove() && !isAdmin()) {
    const myDept = RC.currentUserData?.dept || '';
    const deptIds = RC._cachedMembers.filter(m=>m.dept===myDept).map(m=>m.id);
    filtered = records.filter(r=>deptIds.includes(r.uid) || r.uid===RC.currentUser.uid);
  }

  renderMentalPage(filtered, month);
}

function renderMentalPage(records, month) {
  const isMobile = window.innerWidth <= 640;

  const countMap = {};
  MENTAL_ORDER.forEach(k=>countMap[k]=0);
  records.forEach(r=>{ if(countMap[r.mentalWeather]!==undefined) countMap[r.mentalWeather]++; });
  const total = records.length;

  const summaryHtml = `
    <div style="display:grid;grid-template-columns:repeat(${isMobile?4:7},1fr);gap:8px;margin-bottom:8px">
      ${MENTAL_ORDER.map(k=>{
        const m=MENTAL_WEATHER[k]; const cnt=countMap[k]; const pct=total?Math.round(cnt/total*100):0;
        return `<div style="background:${m.bg};border:1px solid ${m.color}33;border-radius:8px;padding:8px 6px;text-align:center">
          <div style="font-size:20px">${m.icon}</div>
          <div style="font-size:10px;font-weight:700;color:${m.color};margin:2px 0">${k}</div>
          <div style="font-size:14px;font-weight:900;font-family:'DM Mono',monospace;color:${m.color}">${cnt}</div>
          <div style="font-size:9px;color:var(--ink3)">${pct}%</div>
        </div>`;
      }).join('')}
    </div>
    <div style="font-size:11px;color:var(--ink3);text-align:right">集計件数：${total}件</div>`;

  ['mental-summary','mental-summary-m'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=summaryHtml;});

  const byMember = {};
  const riskScore = { '快晴':0,'曇り':0.5,'雨':1,'豪雨':3,'雷':4,'嵐':5,'天災':6 };
  records.forEach(r=>{
    if(!byMember[r.name]) byMember[r.name]={ name:r.name, uid:r.uid, records:[] };
    byMember[r.name].records.push(r);
  });
  _cachedMentalMembers = Object.values(byMember);
  renderMentalFiltered();
}

export function renderMentalFiltered() {
  const keyword     = (document.getElementById('mental-search')?.value || document.getElementById('mental-search-m')?.value || '').trim();
  const sortKey     = document.getElementById('mental-sort')?.value || document.getElementById('mental-sort-m')?.value || 'risk';
  const alertFilter = document.getElementById('mental-alert-filter')?.value || document.getElementById('mental-alert-filter-m')?.value || 'all';
  const riskScore   = { '快晴':0,'曇り':0.5,'雨':1,'豪雨':3,'雷':4,'嵐':5,'天災':6 };

  const alertLevelOf = m => {
    const avg = m.records.reduce((s,r)=>s+(riskScore[r.mentalWeather]||0),0)/m.records.length;
    return avg>=4?'danger':avg>=2?'warn':avg>=1?'caution':'ok';
  };

  let members = [..._cachedMentalMembers];
  if (keyword) members = members.filter(m=>m.name.includes(keyword));

  const alertRank = { ok:0, caution:1, warn:2, danger:3 };
  if (alertFilter !== 'all') {
    if (alertFilter === 'ok') {
      members = members.filter(m=>alertLevelOf(m)==='ok');
    } else {
      const minRank = alertRank[alertFilter];
      members = members.filter(m=>alertRank[alertLevelOf(m)] >= minRank);
    }
  }

  members.sort((a,b)=>{
    if (sortKey==='name')  return a.name.localeCompare(b.name,'ja');
    if (sortKey==='count') return b.records.length - a.records.length;
    if (sortKey==='recent') {
      const ra = riskScore[a.records.at(-1)?.mentalWeather]||0;
      const rb = riskScore[b.records.at(-1)?.mentalWeather]||0;
      return rb-ra;
    }
    const sa=a.records.reduce((s,r)=>s+(riskScore[r.mentalWeather]||0),0)/a.records.length;
    const sb=b.records.reduce((s,r)=>s+(riskScore[r.mentalWeather]||0),0)/b.records.length;
    return sb-sa;
  });

  const countLabel = members.length + '名' + (keyword || alertFilter!=='all' ? `（全${_cachedMentalMembers.length}名中）` : '');
  ['mental-count-label','mental-count-label-m'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent=countLabel;});

  const memberHtml = members.map(m=>{
    const avgScore  = m.records.reduce((s,r)=>s+(riskScore[r.mentalWeather]||0),0)/m.records.length;
    const recentWeek = m.records.slice(-7);
    const alertLevel = avgScore>=4?'danger':avgScore>=2?'warn':avgScore>=1?'caution':'ok';
    const alertColors = { danger:'var(--accent)', warn:'var(--warn)', caution:'var(--blue)', ok:'var(--accent2)' };
    const alertLabels = { danger:'⚠ 要注意', warn:'△ 注視', caution:'○ 経過観察', ok:'✓ 良好' };
    const alertColor  = alertColors[alertLevel];
    const alertLabel  = alertLabels[alertLevel];

    const timeline = recentWeek.map(r=>{
      const mw=MENTAL_WEATHER[r.mentalWeather];
      return `<span title="${r.date} ${r.mentalWeather}" style="font-size:14px;cursor:default">${mw?mw.icon:'?'}</span>`;
    }).join('');

    const distBar = MENTAL_ORDER.map(k=>{
      const cnt = m.records.filter(r=>r.mentalWeather===k).length;
      const pct = Math.round(cnt/m.records.length*100);
      if(!pct) return '';
      const mw  = MENTAL_WEATHER[k];
      return `<div title="${k}: ${cnt}件(${pct}%)" style="width:${pct}%;background:${mw.color};height:100%;transition:width .3s"></div>`;
    }).join('');

    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:8px;border-left:4px solid ${alertColor}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px">
        <div style="font-size:13px;font-weight:700">${m.name}</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:11px;font-weight:700;color:${alertColor};background:${alertColor}18;padding:2px 8px;border-radius:4px">${alertLabel}</span>
          <span style="font-size:10px;color:var(--ink3)">${m.records.length}件記録</span>
        </div>
      </div>
      <div style="margin-bottom:6px">
        <div style="font-size:10px;color:var(--ink3);margin-bottom:3px">直近の記録</div>
        <div style="display:flex;gap:2px;flex-wrap:wrap">${timeline}</div>
      </div>
      <div>
        <div style="font-size:10px;color:var(--ink3);margin-bottom:4px">月間分布</div>
        <div style="height:8px;border-radius:4px;overflow:hidden;background:var(--surface2);display:flex">${distBar}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
          ${MENTAL_ORDER.filter(k=>m.records.some(r=>r.mentalWeather===k)).map(k=>{
            const mw=MENTAL_WEATHER[k];
            const cnt=m.records.filter(r=>r.mentalWeather===k).length;
            return `<span style="font-size:9px;color:${mw.color}">${mw.icon}${k} ${cnt}日</span>`;
          }).join('')}
        </div>
      </div>
    </div>`;
  }).join('') || '<div class="empty">記録がありません</div>';

  ['mental-member-list','mental-member-list-m'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=memberHtml;});
}

window.loadMentalData     = loadMentalData;
window.renderMentalFiltered = renderMentalFiltered;
window.mentalBadge        = mentalBadge;
