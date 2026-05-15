/**
 * seed_gantt.mjs
 *
 * gantt_data.json を読み込んで Firestore に投入する。
 * タスクの追加・編集は gantt_data.json を直接編集してから実行すればOK。
 * FORGEへの依頼は不要。
 *
 * 【使い方】
 *   node scripts/seed_gantt.mjs
 *
 * 【コレクション構成】
 *   gantt_config/decisions  → 判断待ちカード（items 配列）
 *   gantt_config/focus_may  → 今月のフォーカス（items 配列）
 *   gantt_sections/{id}     → ガントセクション（1ドキュメント = 1部門）
 *
 * 【⚠️ 実行前確認ルール】
 *   1. gantt_data.json の全ステータスが最新か確認する
 *   2. 確定済み（success/done）が正しく反映されているか確認する
 *   3. 再実行 = 全データ上書き（べき等）
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault(), projectId: 'regalcast-app' });
const db = getFirestore();

const DATA_FILE = resolve('/Users/koyakimura/projects/会社経営/agents/aikata/gantt_tasks.json');
const data = JSON.parse(readFileSync(DATA_FILE, 'utf-8'));

const TODAY = new Date().toISOString().slice(0, 10);

async function seed() {
  // 既存の gantt_sections を全削除してから再投入
  const existing = await db.collection('gantt_sections').get();
  const deleteBatch = db.batch();
  existing.docs.forEach(d => deleteBatch.delete(d.ref));
  if (!existing.empty) {
    await deleteBatch.commit();
    console.log(`🗑  既存 gantt_sections ${existing.size} 件を削除`);
  }

  const batch = db.batch();

  // gantt_config/decisions
  batch.set(db.collection('gantt_config').doc('decisions'), {
    updatedAt: TODAY,
    items: data.decisions,
  });

  // gantt_config/focus_may
  batch.set(db.collection('gantt_config').doc('focus_may'), {
    updatedAt: TODAY,
    items: data.focus_may,
  });

  // gantt_config/program_progress
  if (data.program_progress) {
    batch.set(db.collection('gantt_config').doc('program_progress'), {
      ...data.program_progress,
      updatedAt: TODAY,
    });
  }

  // gantt_config/focus_archive
  if (data.focus_archive !== undefined) {
    batch.set(db.collection('gantt_config').doc('focus_archive'), {
      updatedAt: TODAY,
      months: data.focus_archive,
    });
  }

  // gantt_config/mtg_actions
  if (data.mtg_actions) {
    batch.set(db.collection('gantt_config').doc('mtg_actions'), {
      ...data.mtg_actions,
      updatedAt: TODAY,
    });
  }

  // gantt_sections
  for (const sec of data.sections) {
    const { id, ...rest } = sec;
    batch.set(db.collection('gantt_sections').doc(id), {
      ...rest,
      updatedAt: TODAY,
    });
  }

  await batch.commit();
  console.log(`✅ Firestore 投入完了 (${TODAY})`);
  console.log(`   decisions : ${data.decisions.length} items`);
  console.log(`   focus_may : ${data.focus_may.length} items`);
  console.log(`   sections  : ${data.sections.length} sections`);
  console.log(`   データソース: /会社経営/agents/aikata/gantt_tasks.json`);
}

seed().catch(err => {
  console.error('❌ 投入失敗:', err);
  process.exit(1);
});
