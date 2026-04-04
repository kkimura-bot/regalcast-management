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
  S:  { base: 350000, overtime: 2188 },
  A:  { base: 300000, overtime: 1875 },
  B:  { base: 270000, overtime: 1688 },
  C:  { base: 250000, overtime: 1563 },
  D:  { base: 230000, overtime: 1438 },
  E:  { base: 210000, overtime: 1313 },
  F:  { base: 190000, overtime: 1188 },
  G:  { base: 170000, overtime: 1063 },
  H:  { base: 150000, overtime: 938  },
};

export const RANK_ORDER  = ['S','A','B','C','D','E','F','G','H'];
export const RANK_COLORS = {
  S: '#b8860b', A: '#2a5298', B: '#3a7d5a', C: '#c8472a',
  D: '#7c5cbf', E: '#d4720a', F: '#5b6ca8', G: '#8c867c', H: '#4a453e'
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
