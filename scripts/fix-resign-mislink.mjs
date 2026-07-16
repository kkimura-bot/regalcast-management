// 退職URL誤紐付けの修復（2026-07-16 事案: 島野さんの回答が宮永さんのURLに入った）
// 実行: node fix-resign-mislink.mjs           (dry-run: 何をするか表示のみ)
//       node fix-resign-mislink.mjs --execute (修復実行)
// 内容: ①島野uidで退職記録＋新URLトークンを作成し回答を移植 ②宮永側の誤記録を削除
// 根拠: offboarding/宮永 は 2026-07-14 の誤発行時に新規作成されたもの（それ以前のデータなし・調査済み）
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { randomBytes } from 'crypto';

const EXECUTE = process.argv.includes('--execute');

const SHIMANO_UID = 'PMVHRkSna9PYxI0rTBDOwyXEZ1B3';   // 島野裕李（本来の対象）
const MIYANAGA_UID = 'wd6AiSFLydeii0s4miT9TAQSPam1';  // 宮永祥英（誤紐付け先）
const OLD_TOKEN = 'togykq01e8l20q40m91hvghw61auwxy8';

initializeApp({ credential: applicationDefault(), projectId: 'regalcast-app' });
const db = getFirestore();

// 現状取得と安全チェック
const [oldSub, obMiyanaga, obShimano] = await Promise.all([
  db.doc(`resignation_submissions/${OLD_TOKEN}`).get(),
  db.doc(`offboarding/${MIYANAGA_UID}`).get(),
  db.doc(`offboarding/${SHIMANO_UID}`).get(),
]);
if (!oldSub.exists || !obMiyanaga.exists) {
  console.log('❌ 対象データが見つからない（既に修復済み？）。中断。');
  process.exit(1);
}
if (obShimano.exists) {
  console.log('❌ offboarding/島野 が既に存在する。二重実行防止のため中断（内容を確認して）。');
  process.exit(1);
}
const sub = oldSub.data();
const ob = obMiyanaga.data();
if (sub.uid !== MIYANAGA_UID) {
  console.log('❌ 想定と異なるuidが入っている。中断。');
  process.exit(1);
}

const newToken = randomBytes(16).toString('hex');
const now = Timestamp.now();

console.log('=== 修復プラン ===');
console.log('① 作成: offboarding/島野 …', { resignDate: ob.resignDate, lastWorkday: ob.lastWorkday, note: ob.note, completed: ob.completed });
console.log('② 作成: resignation_submissions/新token …', { 回答: { reason: sub.reason, resignDate: sub.resignDate, submittedAt: sub.submittedAt } });
console.log('③ 削除: offboarding/宮永（誤発行で生まれた記録・事前調査で他データ無しを確認済み）');
console.log('④ 削除: resignation_submissions/旧token（島野さんの回答が宮永さん名義で入っている文書）');

if (!EXECUTE) {
  console.log('---');
  console.log('※ dry-run。実行は --execute を付けて');
  process.exit(0);
}

const batch = db.batch();
batch.set(db.doc(`offboarding/${SHIMANO_UID}`), {
  uid: SHIMANO_UID,
  name: '島野裕李',
  formToken: newToken,
  formIssuedAt: sub.issuedAt,
  resignDate: ob.resignDate ?? sub.resignDate ?? '',
  lastWorkday: ob.lastWorkday ?? '',
  note: ob.note ?? '',
  procedures: ob.procedures ?? {},
  completed: ob.completed ?? false,
  createdAt: now,
  updatedAt: now,
  repairedFrom: OLD_TOKEN, // 監査用: 2026-07-16 誤紐付け修復
});
batch.set(db.doc(`resignation_submissions/${newToken}`), {
  token: newToken,
  uid: SHIMANO_UID,
  name: '島野裕李',
  issuedAt: sub.issuedAt,
  reason: sub.reason ?? '',
  resignDate: sub.resignDate ?? '',
  submittedAt: sub.submittedAt ?? '',
  repairedFrom: OLD_TOKEN,
});
batch.delete(db.doc(`offboarding/${MIYANAGA_UID}`));
batch.delete(db.doc(`resignation_submissions/${OLD_TOKEN}`));
await batch.commit();

console.log('---');
console.log('✅ 修復完了: 島野さんに退職記録＋回答を移植・宮永さんの誤記録を削除');
