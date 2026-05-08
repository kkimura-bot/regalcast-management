/**
 * update_gantt_example.mjs
 *
 * AIKATAがガントデータを更新するときのサンプル。
 * seed_gantt.mjs と同じ前提（firebase-admin + serviceAccount.json）で動く。
 *
 * 【使い方】
 *   node scripts/update_gantt_example.mjs
 *
 * ──────────────────────────────────────────────────────
 * パターン1: 判断待ちカードを丸ごと差し替え
 * ──────────────────────────────────────────────────────
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

// ── パターン1: decisions を更新 ──────────────────────────
async function updateDecisions() {
  await db.collection('gantt_config').doc('decisions').set({
    updatedAt: TODAY,
    items: [
      // ← ここに最新の判断待ちリストを全部書く（差し替え）
      {
        priority: 'red',
        label:    'VAULT管理部 — 7月採用確定',
        desc:     'Koyaが現在担当。7月採用の1人に業務を引き継ぎ。',
        deadline: '採用：7月着任',
        blocker:  'SUMMON：採用要件を6月末までに設計',
        status:   'done',
      },
      // 以下同様...
    ],
  });
  console.log('✅ decisions 更新完了');
}

// ── パターン2: 特定セクション（例: ACADEMIA）のみ更新 ─────
async function updateSection() {
  await db.collection('gantt_sections').doc('academia').set({
    order:     1,
    section:   'ACADEMIA',
    color:     '#8B5CF6',
    updatedAt: TODAY,
    tasks: [
      { label: '体験→入塾実績集計',      start: '2026-05-10', end: '2026-05-31', type: 'done'    },
      { label: '配布パート採用',          start: '2026-05-15', end: '2026-06-15', type: 'active'  },
      { label: '中学生eスポカリキュラム', start: '2026-05-15', end: '2026-06-30', type: 'active'  },
      // type の選択肢: 'active'(青), 'crit'(赤), 'done'(グレー), 'success'(緑), 'pending'(紫)
    ],
  });
  console.log('✅ academia セクション更新完了');
}

// ── パターン3: focus_may を更新 ──────────────────────────
async function updateFocus() {
  await db.collection('gantt_config').doc('focus_may').set({
    updatedAt: TODAY,
    items: [
      { label: 'キックオフ会議で全部門アクション確定',  owner: 'AIKATA',             status: 'done' },
      { label: 'VAULT増員・アライアンス窓口を即決',    owner: 'Koya',               status: 'done' },
      // status の選択肢: 'done'(完了), 'wip'(進行中), 'todo'(未着手)
    ],
  });
  console.log('✅ focus_may 更新完了');
}

// 実際に使うときはコメントアウトを外して実行
// await updateDecisions();
// await updateSection();
// await updateFocus();

console.log('このファイルはサンプルです。使いたい関数のコメントを外して実行してください。');
