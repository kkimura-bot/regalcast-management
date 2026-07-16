// 助野恵大朗の二重登録の空ドキュメント削除（2026-07-16 調査済み: 参照ゼロ確認済み）
// 実行: node fix-sukeno-duplicate.mjs           (dry-run: 再検証と削除予定の表示)
//       node fix-sukeno-duplicate.mjs --execute (削除実行)
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const EXECUTE = process.argv.includes('--execute');
const DUP_UID = 'UKuDanBf416ewSUra1KR'; // 空の重複（isRetired=true・データ参照ゼロ）
const KEEP_UID = 'I8CFVdc6dCmAe4kIDmou'; // 正（シフト31・配置14・勤怠7）

initializeApp({ credential: applicationDefault(), projectId: 'regalcast-app' });
const db = getFirestore();

// 実行時再検証（安全弁）
const [dup, keep] = await Promise.all([
  db.doc(`users/${DUP_UID}`).get(),
  db.doc(`users/${KEEP_UID}`).get(),
]);
if (!dup.exists) { console.log('✅ 既に削除済み。何もしない。'); process.exit(0); }
if (dup.data().name !== '助野恵大朗' || dup.data().isRetired !== true) {
  console.log('❌ 対象docの内容が想定と違う。中断。', dup.data().name, dup.data().isRetired);
  process.exit(1);
}
if (!keep.exists || keep.data().name !== '助野恵大朗') {
  console.log('❌ 正の方のdocが見つからない。中断。');
  process.exit(1);
}
const refs = await Promise.all([
  db.collection('shifts').where('uid', '==', DUP_UID).limit(1).get(),
  db.collection('assignments').where('staffId', '==', DUP_UID).limit(1).get(),
  db.collection('attendance').where('uid', '==', DUP_UID).limit(1).get(),
  db.collection('salary').where('uid', '==', DUP_UID).limit(1).get(),
]);
if (refs.some((s) => s.size > 0)) {
  console.log('❌ 参照データが見つかった（調査時と状況が変化）。中断。');
  process.exit(1);
}

console.log(`${EXECUTE ? '🗑 削除実行' : '[dry-run] 削除予定'}: users/${DUP_UID}（助野恵大朗の空重複・参照ゼロ再確認済み）`);
if (EXECUTE) {
  await db.doc(`users/${DUP_UID}`).delete();
  console.log('✅ 削除完了。オーダー表・各アプリの一覧から消えます。');
} else {
  console.log('※ 実行は --execute を付けて');
}
