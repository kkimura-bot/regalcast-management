// 退職者7名のAuthアカウント無効化（2026-07-16 航也承認済み・対象は固定リスト）
// 実行: node disable-retired-auth.mjs           (対象一覧の表示のみ)
//       node disable-retired-auth.mjs --execute (無効化を実行)
// ※ 削除はしない（無効化のみ・コンソールからいつでも再有効化可能）
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const EXECUTE = process.argv.includes('--execute');

// 対象: --repair で検出した「退職者でAuthあり」7名（2026-07-16時点）
const TARGETS = [
  { uid: '0SLkF9BlaqSLsDxXyPImu5k9djB3', name: '馬場有希' },
  { uid: '24qccJVJzscASjalEwyA8xnavXr1', name: '世羅駿多' },
  { uid: '4j9JyHfWv9M63J6WxDO7jthutKX2', name: '名嘉胡々呂' },
  { uid: 'AEilT2l09GMFat5nC5J0IO8zKon2', name: '梅木誠也' },
  { uid: 'Bu8bq6ktzcdBP79zxqgqLKIidE83', name: '村田莉菜' },
  { uid: 'QeCzHTiCpCaIPNfz2zYaIC5cnF62', name: '藤尾愛士' },
  { uid: 'xNatku11UqgvzcAArLXPVCj0Qlv1', name: '今田翔太' },
];

initializeApp({ credential: applicationDefault(), projectId: 'regalcast-app' });
const auth = getAuth();

let done = 0, already = 0, failed = 0;
for (const t of TARGETS) {
  try {
    const u = await auth.getUser(t.uid);
    if (u.disabled) {
      console.log(`SKIP(無効化済み) ${t.name}`);
      already++;
      continue;
    }
    if (EXECUTE) {
      await auth.updateUser(t.uid, { disabled: true });
      console.log(`🔒 無効化完了 ${t.name} (${u.email})`);
    } else {
      console.log(`[dry-run] 無効化予定 ${t.name} (${u.email})`);
    }
    done++;
  } catch (e) {
    console.log(`❌ 失敗 ${t.name}: ${e.message}`);
    failed++;
  }
}
console.log('---');
console.log(`${EXECUTE ? '無効化' : '無効化予定'}: ${done}件 / 済みスキップ: ${already}件 / 失敗: ${failed}件`);
if (!EXECUTE) console.log('※ 実行は --execute を付けて');
