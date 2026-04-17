// ============================================================
// Application-wide constants
// ============================================================

// Department options
export const depts_options = [
  'モバイルセールス・ソリューション部',
  'デジタルライフ・コンサルティング部',
  'クリエイティブ・エンターテイメント部',
  '経営戦略室'
];

// ── Salary / Rank ──────────────────────────────────────────

export const SALARY_TABLE = {
  'スターター1':  { rank:'スターター NOVICE',      grade:1, base:203000, duty:12000, fixedOT:8,  sales:0,     total:215000 },
  'スターター2':  { rank:'スターター NOVICE',      grade:2, base:203000, duty:12000, fixedOT:8,  sales:2000,  total:217000 },
  'スターター3':  { rank:'スターター NOVICE',      grade:3, base:203000, duty:12000, fixedOT:8,  sales:4000,  total:219000 },
  'スターター4':  { rank:'スターター NOVICE',      grade:4, base:203000, duty:12000, fixedOT:8,  sales:6000,  total:221000 },
  'スターター5':  { rank:'スターター NOVICE',      grade:5, base:203000, duty:12000, fixedOT:8,  sales:8000,  total:223000 },
  'プロモーター1':{ rank:'プロモーター FIGHTER',   grade:1, base:203000, duty:22000, fixedOT:15, sales:0,     total:225000 },
  'プロモーター2':{ rank:'プロモーター FIGHTER',   grade:2, base:203000, duty:22000, fixedOT:15, sales:2500,  total:227500 },
  'プロモーター3':{ rank:'プロモーター FIGHTER',   grade:3, base:203000, duty:22000, fixedOT:15, sales:5000,  total:230000 },
  'プロモーター4':{ rank:'プロモーター FIGHTER',   grade:4, base:203000, duty:22000, fixedOT:15, sales:7500,  total:232500 },
  'プロモーター5':{ rank:'プロモーター FIGHTER',   grade:5, base:203000, duty:22000, fixedOT:15, sales:10000, total:235000 },
  'キーパーソン1':{ rank:'キーパーソン SPECIALIST', grade:1, base:216000, duty:24000, fixedOT:15, sales:0,     total:240000 },
  'キーパーソン2':{ rank:'キーパーソン SPECIALIST', grade:2, base:216000, duty:24000, fixedOT:15, sales:15000, total:255000 },
  'キーパーソン3':{ rank:'キーパーソン SPECIALIST', grade:3, base:216000, duty:24000, fixedOT:15, sales:30000, total:270000 },
  'キーパーソン4':{ rank:'キーパーソン SPECIALIST', grade:4, base:216000, duty:24000, fixedOT:15, sales:45000, total:285000 },
  'キーパーソン5':{ rank:'キーパーソン SPECIALIST', grade:5, base:216000, duty:24000, fixedOT:15, sales:60000, total:300000 },
  'メンター1':    { rank:'メンター LEADER',         grade:1, base:216000, duty:24000, fixedOT:15, sales:0,     total:240000 },
  'メンター2':    { rank:'メンター LEADER',         grade:2, base:218000, duty:32000, fixedOT:20, sales:0,     total:250000 },
  'メンター3':    { rank:'メンター LEADER',         grade:3, base:218000, duty:32000, fixedOT:20, sales:10000, total:260000 },
  'メンター4':    { rank:'メンター LEADER',         grade:4, base:228000, duty:42000, fixedOT:25, sales:0,     total:270000 },
  'メンター5':    { rank:'メンター LEADER',         grade:5, base:228000, duty:42000, fixedOT:25, sales:10000, total:280000 },
  'リーダー1':    { rank:'リーダー LEADER',         grade:1, base:228000, duty:42000, fixedOT:25, sales:15000, total:285000 },
  'リーダー2':    { rank:'リーダー LEADER',         grade:2, base:228000, duty:42000, fixedOT:25, sales:25000, total:295000 },
  'リーダー3':    { rank:'リーダー LEADER',         grade:3, base:228000, duty:42000, fixedOT:25, sales:35000, total:305000 },
  'リーダー4':    { rank:'リーダー LEADER',         grade:4, base:228000, duty:42000, fixedOT:25, sales:42500, total:312500 },
  'リーダー5':    { rank:'リーダー LEADER',         grade:5, base:228000, duty:42000, fixedOT:25, sales:50000, total:320000 },
  '管理職①1':    { rank:'管理職① HERO',            grade:1, base:263000, duty:57000, fixedOT:30, role:20000,  total:340000 },
  '管理職①2':    { rank:'管理職① HERO',            grade:2, base:263000, duty:57000, fixedOT:30, role:40000,  total:360000 },
  '管理職①3':    { rank:'管理職① HERO',            grade:3, base:263000, duty:57000, fixedOT:30, role:60000,  total:380000 },
  '管理職②1':    { rank:'管理職② LEGEND',          grade:1, base:300000, role:100000, orgInc:15000, total:400000 },
  '管理職②2':    { rank:'管理職② LEGEND',          grade:2, base:300000, role:100000, orgInc:15000, total:415000 },
  '管理職②3':    { rank:'管理職② LEGEND',          grade:3, base:300000, role:100000, orgInc:30000, total:430000 },
  '管理職②4':    { rank:'管理職② LEGEND',          grade:4, base:300000, role:100000, orgInc:45000, total:445000 },
  '管理職②5':    { rank:'管理職② LEGEND',          grade:5, base:300000, role:100000, orgInc:60000, total:460000 },
};

export const RANK_ORDER = [
  'スターター1','スターター2','スターター3','スターター4','スターター5',
  'プロモーター1','プロモーター2','プロモーター3','プロモーター4','プロモーター5',
  'キーパーソン1','キーパーソン2','キーパーソン3','キーパーソン4','キーパーソン5',
  'メンター1','メンター2','メンター3','メンター4','メンター5',
  'リーダー1','リーダー2','リーダー3','リーダー4','リーダー5',
  '管理職①1','管理職①2','管理職①3',
  '管理職②1','管理職②2','管理職②3','管理職②4','管理職②5',
];

export const RANK_COLORS = {
  'スターター1':'#5b9bd5','スターター2':'#5b9bd5','スターター3':'#5b9bd5','スターター4':'#5b9bd5','スターター5':'#5b9bd5',
  'プロモーター1':'#3a7d5a','プロモーター2':'#3a7d5a','プロモーター3':'#3a7d5a','プロモーター4':'#3a7d5a','プロモーター5':'#3a7d5a',
  'キーパーソン1':'#d4720a','キーパーソン2':'#d4720a','キーパーソン3':'#d4720a','キーパーソン4':'#d4720a','キーパーソン5':'#d4720a',
  'メンター1':'#7c5cbf','メンター2':'#7c5cbf','メンター3':'#7c5cbf','メンター4':'#7c5cbf','メンター5':'#7c5cbf',
  'リーダー1':'#2a5298','リーダー2':'#2a5298','リーダー3':'#2a5298','リーダー4':'#2a5298','リーダー5':'#2a5298',
  '管理職①1':'#c8472a','管理職①2':'#c8472a','管理職①3':'#c8472a',
  '管理職②1':'#b8860b','管理職②2':'#b8860b','管理職②3':'#b8860b','管理職②4':'#b8860b','管理職②5':'#b8860b',
};

// ── Mental weather ─────────────────────────────────────────

export const MENTAL_WEATHER = {
  '快晴': { icon:'☀️',  color:'#e67e22', bg:'rgba(230,126,34,.08)'  },
  '曇り': { icon:'☁️',  color:'#7f8c8d', bg:'rgba(127,140,141,.08)' },
  '雨':   { icon:'🌧',  color:'#2980b9', bg:'rgba(41,128,185,.08)'  },
  '豪雨': { icon:'⛈',  color:'#1a5276', bg:'rgba(26,82,118,.1)'    },
  '雷':   { icon:'🌩',  color:'#f39c12', bg:'rgba(243,156,18,.1)'   },
  '嵐':   { icon:'🌀',  color:'#7c5cbf', bg:'rgba(124,92,191,.1)'   },
  '天災': { icon:'🔥',  color:'#c8472a', bg:'rgba(200,71,42,.1)'    },
};

// ── Shift off words (for CSV import parsing) ───────────────

export const SHIFT_OFF_WORDS = [
  '休', 'off', 'OFF', 'Off', '公休', '休み', '非番', '振休', '有休', '有給', '代休', '-', '—', '×'
];

// ── Goals tree ────────────────────────────────────────────

export const GOALS_TREE = {
  '売上目標': [
    '月次売上達成',
    '新規顧客獲得',
    'リピート率向上',
    '単価アップ'
  ],
  '業務改善': [
    'オペレーション効率化',
    'コスト削減',
    'ミス・クレーム削減',
    'マニュアル整備'
  ],
  '人材育成': [
    '研修・スキルアップ',
    '採用・定着率向上',
    'チームビルディング',
    '評価制度運用'
  ],
  '戦略・企画': [
    '新規事業検討',
    'マーケティング施策',
    'パートナー連携',
    'IT・DX推進'
  ]
};

// ── Alliance members CSV ───────────────────────────────────
// Name list used for alliance login dropdown (populated dynamically from Firestore)
// This constant is kept here for reference; actual list is loaded at runtime.
export const CSV_ALLIANCE_MEMBERS = [];

// ── Member display order（社員番号ベースの並び順。名前でマッチ） ──
// 新規入社メンバーはこのリストに無いため自動的に末尾（名前順）に並ぶ
export const MEMBER_ORDER = [
  '木村航也',
  '中田勝馬',
  '児島拓也',
  '中川久史',
  '碩真也',
  '迫沙紀',
  '西田浩',
  '永田浩太郎',
  '森本隆之',
  '伊藤弘幸',
  '岩崎七海',
  '横山翔',
  '蓮井瑛人',
  '梅木誠也',
  '小田祐志郎',
  '村上絢信',
  '馬場有希',
  '三浦真之介',
  '原泰彰',
  '大小田脩人',
  '松田柊哉',
  '今田翔太',
  '村山航汰',
  '岩崎成陽',
  '世羅駿多',
  '田中野乃香',
  '佐々木星羅',
  '島野裕李'
];

export function sortMembersByOrder(members) {
  const orderMap = new Map(MEMBER_ORDER.map((name, i) => [name, i]));
  return [...members].sort((a, b) => {
    const ai = orderMap.has(a.name) ? orderMap.get(a.name) : Infinity;
    const bi = orderMap.has(b.name) ? orderMap.get(b.name) : Infinity;
    if (ai !== bi) return ai - bi;
    return (a.name || '').localeCompare(b.name || '', 'ja');
  });
}
