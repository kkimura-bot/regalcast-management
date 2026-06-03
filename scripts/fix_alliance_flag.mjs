/**
 * fix_alliance_flag.mjs
 *
 * 林さん・渡辺さん・宇山さんの isAlliance フラグを修正する。
 * isAlliance: true になっていると当日確認リストから除外されるため。
 *
 * 【使い方】
 *   node scripts/fix_alliance_flag.mjs          # ドライラン（変更なし・確認のみ）
 *   node scripts/fix_alliance_flag.mjs --fix    # 実際に修正
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault(), projectId: 'regalcast-app' });
const db = getFirestore();

const TARGET_NAMES = ['林', '渡辺', '宇山'];
const isDryRun = !process.argv.includes('--fix');

if (isDryRun) {
  console.log('=== DRY RUN（--fix を付けると実際に修正されます）===\n');
}

const snap = await db.collection('users').get();
const targets = snap.docs.filter(d => {
  const name = d.data().name || '';
  const data = d.data();
  // isAlliance: true が明示されているメンバーのみ対象（アライアンスIDは除外）
  return TARGET_NAMES.some(n => name.includes(n))
    && data.isAlliance === false  // 誤って false にしたものを true に戻す
    && !d.id.startsWith('alliance_');
});

if (!targets.length) {
  console.log('対象ユーザーが見つかりませんでした。');
  console.log('全ユーザー名一覧:');
  snap.docs.forEach(d => console.log(`  - ${d.data().name} (id: ${d.id})`));
  process.exit(0);
}

console.log(`対象ユーザー ${targets.length} 名:\n`);
for (const d of targets) {
  const data = d.data();
  console.log(`名前: ${data.name}`);
  console.log(`ID: ${d.id}`);
  console.log(`isAlliance: ${data.isAlliance ?? '（フィールドなし）'}`);
  console.log(`isRetired: ${data.isRetired ?? '（フィールドなし）'}`);
  console.log(`isHidden: ${data.isHidden ?? '（フィールドなし）'}`);
  console.log('---');

  if (!isDryRun) {
    await db.collection('users').doc(d.id).update({ isAlliance: true });
    console.log(`✅ ${data.name} の isAlliance を true に戻しました`);
  }
}

if (isDryRun) {
  console.log('\n上記が修正対象です。問題なければ --fix を付けて実行してください。');
} else {
  console.log('\n修正完了。アプリをリロードして当日確認リストを確認してください。');
}
