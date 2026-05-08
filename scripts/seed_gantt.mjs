/**
 * seed_gantt.mjs
 *
 * ガントチャート初期データを Firestore に投入するスクリプト。
 * 既存データを上書きするため、2回目以降の実行でも使える（べき等）。
 *
 * 【使い方】
 * 1. firebase-admin をインストール（初回のみ）
 *    npm install firebase-admin
 *
 * 2. Firebase Console → プロジェクト設定 → サービスアカウント
 *    → 「新しい秘密鍵を生成」でJSONをダウンロード
 *    → このファイルと同じフォルダに置いて serviceAccount.json に名前変更
 *    ※ 絶対に git commit しないこと！.gitignore に含めること
 *
 * 3. 実行
 *    node scripts/seed_gantt.mjs
 *
 * 【コレクション構成】
 *   gantt_config/decisions  → 判断待ちカード（items 配列）
 *   gantt_config/focus_may  → 今月のフォーカス（items 配列）
 *   gantt_sections/{id}     → ガントセクション（1ドキュメント = 1部門）
 *
 * 【AIKATAが更新するとき】
 *   - decisions/focus_may はドキュメント全体を setDoc で上書き
 *   - gantt_sections はセクションIDのドキュメントを setDoc で上書き
 *   - updatedAt フィールドを "YYYY-MM-DD" 形式で更新すること
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore }        from 'firebase-admin/firestore';
import { createRequire }       from 'module';
import { fileURLToPath }       from 'url';
import { dirname, join }       from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);

const serviceAccount = require(join(__dirname, 'serviceAccount.json'));

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const TODAY = new Date().toISOString().slice(0, 10);

// ────────────────────────────────────────────────────────────
// 1. 判断待ちカード
// ────────────────────────────────────────────────────────────
const DECISIONS = {
  updatedAt: TODAY,
  items: [
    {
      priority: 'red',
      label:    'VAULT管理部 — 7月採用確定',
      desc:     'Koyaが現在担当。7月採用の1人に業務を引き継ぎ。',
      deadline: '採用：7月着任',
      blocker:  'SUMMON：採用要件を6月末までに設計',
      status:   'done',
    },
    {
      priority: 'done',
      label:    'アライアンス管理 — STRATAGEM確定',
      desc:     'STRATAGEMが一元管理。児島さんと連携し稼働・業績・契約を数字で管理。',
      deadline: '7月〜運用開始',
      blocker:  'STRATAGEM',
      status:   'done',
    },
    {
      priority: 'yellow',
      label:    'アライアンス採用チャネル',
      desc:     '自社採用と別ルートが必要。既存チャネルの有無も含めて。',
      deadline: '2026-06-15',
      blocker:  'SUMMON',
      status:   'open',
    },
    {
      priority: 'yellow',
      label:    '増員人件費の予算上限',
      desc:     'ACADEMIA講師・TAVERN店舗・配布パートの採用予算上限。',
      deadline: '2026-06-15',
      blocker:  'SUMMON × STRATAGEM',
      status:   'open',
    },
    {
      priority: 'green',
      label:    'リファラル報酬の単価と予算枠',
      desc:     '制度設計はSUMMON×VAULTで進行可能。Koyaの予算承認のみ。',
      deadline: '2026-06-30',
      blocker:  'SUMMON',
      status:   'open',
    },
  ],
};

// ────────────────────────────────────────────────────────────
// 2. 今月のフォーカス
// ────────────────────────────────────────────────────────────
const FOCUS_MAY = {
  updatedAt: TODAY,
  items: [
    { label: 'キックオフ会議で全部門アクション確定',    owner: 'AIKATA',            status: 'done' },
    { label: 'VAULT増員・アライアンス窓口を即決',       owner: 'Koya',              status: 'done' },
    { label: '体験→入塾の実績集計（KPI再設定起点）',   owner: 'STRATAGEM×ACADEMIA', status: 'wip'  },
    { label: 'チラシ最新版制作着手',                   owner: 'BEACON',             status: 'wip'  },
    { label: '採用チャネル・予算上限の判断',            owner: 'Koya',              status: 'todo' },
    { label: '宿題リスト回収開始（全部門）',            owner: 'STRATAGEM',          status: 'wip'  },
    { label: 'アライアンス採用チャネル設計',            owner: 'SUMMON',             status: 'todo' },
  ],
};

// ────────────────────────────────────────────────────────────
// 3. ガントセクション（order で表示順を管理）
// ────────────────────────────────────────────────────────────
const GANTT_SECTIONS = [
  {
    id: 'hanidan', order: 0, section: '判断', color: '#EF4444',
    updatedAt: TODAY,
    tasks: [
      { label: 'VAULT採用(7月着任)',     start: '2026-05-09', end: '2026-07-01', type: 'success' },
      { label: 'アライアンス管理確定',   start: '2026-05-09', end: '2026-05-10', type: 'success' },
      { label: '採用チャネル/予算',      start: '2026-05-15', end: '2026-06-15', type: 'crit'    },
      { label: 'リファラル予算枠',       start: '2026-06-01', end: '2026-06-30', type: 'pending' },
    ],
  },
  {
    id: 'academia', order: 1, section: 'ACADEMIA', color: '#8B5CF6',
    updatedAt: TODAY,
    tasks: [
      { label: '体験→入塾実績集計',        start: '2026-05-10', end: '2026-05-31', type: 'active'  },
      { label: '配布パート採用',            start: '2026-05-15', end: '2026-06-15', type: 'active'  },
      { label: '中学生eスポカリキュラム',   start: '2026-05-15', end: '2026-06-30', type: 'active'  },
      { label: '校門前配布許可取得',        start: '2026-06-01', end: '2026-06-30', type: 'pending' },
      { label: '業務マニュアル作成',        start: '2026-06-01', end: '2026-06-30', type: 'pending' },
      { label: '講師増員求人公開',          start: '2026-08-01', end: '2026-08-31', type: 'pending' },
    ],
  },
  {
    id: 'dojo', order: 2, section: 'DOJO', color: '#0EA5E9',
    updatedAt: TODAY,
    tasks: [
      { label: '研修商品仕様2本',    start: '2026-05-10', end: '2026-06-30', type: 'active'  },
      { label: '単価/原価試算',      start: '2026-05-15', end: '2026-06-30', type: 'active'  },
      { label: '法人LP・事例集',     start: '2026-06-15', end: '2026-07-15', type: 'pending' },
      { label: 'BAZAAR連携営業',     start: '2026-07-01', end: '2026-09-30', type: 'pending' },
    ],
  },
  {
    id: 'arena', order: 3, section: 'ARENA', color: '#F59E0B',
    updatedAt: TODAY,
    tasks: [
      { label: '大会スケジュール確定', start: '2026-05-10', end: '2026-06-30', type: 'active'  },
      { label: 'スポンサーメニュー',   start: '2026-05-15', end: '2026-06-30', type: 'active'  },
      { label: '配信体制確定',         start: '2026-06-01', end: '2026-06-30', type: 'pending' },
      { label: '月4回大会本番',        start: '2026-07-01', end: '2026-12-31', type: 'pending' },
    ],
  },
  {
    id: 'bazaar', order: 4, section: 'BAZAAR', color: '#10B981',
    updatedAt: TODAY,
    tasks: [
      { label: '100社リスト作成',          start: '2026-05-10', end: '2026-06-30', type: 'active'  },
      { label: 'アライアンス契約テンプレ', start: '2026-05-20', end: '2026-06-30', type: 'active'  },
      { label: '法人/通信本番開拓',        start: '2026-07-01', end: '2026-12-31', type: 'pending' },
    ],
  },
  {
    id: 'beacon', order: 5, section: 'BEACON', color: '#F97316',
    updatedAt: TODAY,
    tasks: [
      { label: 'チラシ最新版',          start: '2026-05-10', end: '2026-05-31', type: 'active'  },
      { label: 'コンテンツカレンダー',   start: '2026-05-15', end: '2026-06-30', type: 'active'  },
      { label: 'LP・CTA整備',           start: '2026-06-01', end: '2026-07-31', type: 'pending' },
      { label: '月12本本番運用',         start: '2026-07-01', end: '2026-12-31', type: 'pending' },
    ],
  },
  {
    id: 'tavern', order: 6, section: 'TAVERN', color: '#EC4899',
    updatedAt: TODAY,
    tasks: [
      { label: '現状値把握',            start: '2026-05-10', end: '2026-06-30', type: 'active'  },
      { label: '新メニュー試作',        start: '2026-06-01', end: '2026-07-31', type: 'pending' },
      { label: '店舗大会(ARENA連動)',   start: '2026-07-01', end: '2026-12-31', type: 'pending' },
    ],
  },
  {
    id: 'stratagem', order: 7, section: 'STRATAGEM', color: '#6366F1',
    updatedAt: TODAY,
    tasks: [
      { label: '全部門宿題回答',         start: '2026-05-10', end: '2026-06-30', type: 'active'  },
      { label: 'KPIシート設計',         start: '2026-05-15', end: '2026-06-30', type: 'active'  },
      { label: '数字吸い上げフロー',    start: '2026-06-01', end: '2026-06-30', type: 'pending' },
      { label: 'KPIモニタリング本番',   start: '2026-07-01', end: '2026-12-31', type: 'pending' },
    ],
  },
  {
    id: 'summon', order: 8, section: 'SUMMON', color: '#14B8A6',
    updatedAt: TODAY,
    tasks: [
      { label: 'リファラル制度設計',    start: '2026-05-15', end: '2026-06-30', type: 'active'  },
      { label: '採用ペルソナ整備',      start: '2026-06-01', end: '2026-06-30', type: 'pending' },
      { label: '採用フロー本番稼働',    start: '2026-07-01', end: '2026-12-31', type: 'pending' },
    ],
  },
  {
    id: 'vault', order: 9, section: 'VAULT', color: '#94A3B8',
    updatedAt: TODAY,
    tasks: [
      { label: '就業規則完成',            start: '2026-05-10', end: '2026-07-31', type: 'active'  },
      { label: '契約書テンプレ整備',      start: '2026-05-15', end: '2026-06-30', type: 'active'  },
      { label: '学校配布許可フロー',      start: '2026-06-01', end: '2026-06-30', type: 'pending' },
      { label: 'インシデント記録運用',    start: '2026-07-01', end: '2026-12-31', type: 'pending' },
    ],
  },
];

// ────────────────────────────────────────────────────────────
// 実行
// ────────────────────────────────────────────────────────────
async function seed() {
  const batch = db.batch();

  // gantt_config/decisions
  batch.set(db.collection('gantt_config').doc('decisions'), DECISIONS);

  // gantt_config/focus_may
  batch.set(db.collection('gantt_config').doc('focus_may'), FOCUS_MAY);

  // gantt_sections（各セクション）
  for (const sec of GANTT_SECTIONS) {
    const { id, ...data } = sec;
    batch.set(db.collection('gantt_sections').doc(id), data);
  }

  await batch.commit();
  console.log(`✅ Firestore 初期データ投入完了 (${TODAY})`);
  console.log(`   gantt_config/decisions  : ${DECISIONS.items.length} items`);
  console.log(`   gantt_config/focus_may  : ${FOCUS_MAY.items.length} items`);
  console.log(`   gantt_sections          : ${GANTT_SECTIONS.length} sections`);
}

seed().catch(err => {
  console.error('❌ 投入失敗:', err);
  process.exit(1);
});
