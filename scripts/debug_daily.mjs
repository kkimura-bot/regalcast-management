/**
 * debug_daily.mjs - 当日確認リストに出ない原因を調査する
 * node scripts/debug_daily.mjs
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault(), projectId: 'regalcast-app' });
const db = getFirestore();

const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
console.log(`\n=== 調査日: ${today} ===\n`);

// 宇山・林・渡辺のユーザードキュメントを確認
const usersSnap = await db.collection('users').get();
const targets = usersSnap.docs.filter(d => {
  const name = d.data().name || '';
  return ['宇山', '林徳', '渡辺勇'].some(n => name.includes(n));
});

console.log('【対象ユーザードキュメント】');
targets.forEach(d => {
  const data = d.data();
  console.log(`  名前: ${data.name} | id: ${d.id} | isAlliance: ${data.isAlliance}`);
});

// 今日のシフトを確認
const shiftSnap = await db.collection('shifts').where('date', '==', today).get();
console.log(`\n【本日(${today})のシフト全件 - uid一覧】`);
shiftSnap.docs.forEach(d => {
  const s = d.data();
  const isTarget = targets.some(t => t.id === s.uid || ['宇山','林徳','渡辺勇'].some(n => (s.name||'').includes(n)));
  if (isTarget) {
    console.log(`  ★ 名前: ${s.name} | uid: ${s.uid} | date: ${s.date}`);
  }
});

// uidマッチ確認
console.log('\n【uid マッチ確認】');
targets.forEach(user => {
  const shift = shiftSnap.docs.find(d => d.data().uid === user.id);
  if (shift) {
    console.log(`  ✅ ${user.data().name}: シフトあり (uid一致)`);
  } else {
    // 名前でシフトを探す
    const shiftByName = shiftSnap.docs.find(d => (d.data().name||'').includes(user.data().name?.slice(0,2)));
    if (shiftByName) {
      console.log(`  ❌ ${user.data().name}: シフトあるが uid不一致`);
      console.log(`     users id: ${user.id}`);
      console.log(`     shifts uid: ${shiftByName.data().uid}`);
    } else {
      console.log(`  ❌ ${user.data().name}: 本日シフトなし`);
    }
  }
});
