#!/usr/bin/env node
/**
 * merge-duplicate-accounts.mjs — 重複アカウント統合スクリプト
 *
 * 背景:
 *   研修アプリの新規登録フローが users マスタを作らずに Auth + trainingProfiles を
 *   直接作成できたため、既存メンバーと重複するアカウントが 4 件生まれた。
 *   本スクリプトはこれらを正規の uid に統合する。
 *
 * 使い方:
 *   node scripts/merge-duplicate-accounts.mjs           # dry-run（デフォルト・書き込みなし）
 *   node scripts/merge-duplicate-accounts.mjs --execute # 実行（🔴RED 航也のGOサイン必須）
 *
 * 事前準備（ADC方式）:
 *   gcloud auth application-default login
 *   gcloud auth application-default set-quota-project regalcast-app
 */

const IS_EXECUTE = process.argv.includes('--execute')
const IS_DRY_RUN = !IS_EXECUTE
const PROJECT_ID = 'regalcast-app'

// ── 統合マッピング（固定リスト・絶対に変更・並び替え禁止） ─────────────────────────
//
// oldUid:     研修アプリで誤作成された重複 Auth の uid（削除対象）
// oldEmail:   旧 Auth に紐付いていたメールアドレス（Auth 再発行に使用）
// targetUid:  null = usersコレクションで名前解決 / string = 直書き
// reissueAuth: true = old削除後に target uid でAuth再発行 / false = 削除のみ（既存Auth有り）
//
const MERGE_MAP = [
  {
    label:       '加藤拓郎',
    oldUid:      'KBqpNZ8R9XMzzpxhT3cOAtc0S462',
    oldEmail:    'tqkurokato@gmail.com',
    targetUid:   null,      // usersコレクションで名前解決
    reissueAuth: true,
  },
  {
    label:       '岩田真実',
    oldUid:      'fTlsWFjun6UPJOlYjj3xERj9AlJ2',
    oldEmail:    'kathia.0516.dq@gmail.com',
    targetUid:   null,
    reissueAuth: true,
  },
  {
    label:       '宮地就太',
    oldUid:      'i0A7TJKoE9QJi89cSrGIF2Fs6Aa2',
    oldEmail:    'sh.myc3101@gmail.com',
    targetUid:   'pKbGfMKqmVQ7r2MRbunQDvhYw3l2',  // 既存 Auth あり → 再発行なし
    reissueAuth: false,
  },
  {
    label:       '助野恵大朗',
    oldUid:      'yuM10sFSpdgT2TN2FBEBpvb3a033',
    oldEmail:    'keitaro02192002@gmail.com',
    targetUid:   null,
    reissueAuth: true,
  },
]

// ────────────────────────────────────────────────────────────────────────────────
// 安全装置: deleteUser できる uid のホワイトリスト（定数・変更禁止）
//
// auth.deleteUser() を呼べるのは、この Set に含まれる oldUid のみ。
// targetUid は絶対にこの Set に入らない実装になっており、
// 変数の取り違えで targetUid を削除することを構造的に防ぐ。
// ────────────────────────────────────────────────────────────────────────────────
const DELETABLE_OLD_UIDS = Object.freeze(new Set(MERGE_MAP.map(m => m.oldUid)))

// ── Firebase Admin 初期化 ──────────────────────────────────────────────────────
let auth, db, Timestamp

try {
  const { initializeApp, applicationDefault } = await import('firebase-admin/app')
  const { getAuth: _getAuth }                 = await import('firebase-admin/auth')
  const { getFirestore, Timestamp: TS }       = await import('firebase-admin/firestore')

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID })
  auth      = _getAuth()
  db        = getFirestore()
  Timestamp = TS

  console.log(`[MERGE] Firebase 初期化: プロジェクト「${PROJECT_ID}」`)
  console.log(`[MERGE] モード: ${IS_DRY_RUN ? 'dry-run（書き込みなし）' : '⚠️  EXECUTE（実行）'}\n`)
} catch (err) {
  console.error(`Firebase Admin 初期化失敗: ${err.message}`)
  console.error('ADC を設定してください:')
  console.error('  gcloud auth application-default login')
  console.error(`  gcloud auth application-default set-quota-project ${PROJECT_ID}`)
  process.exit(1)
}

// ── ユーティリティ ─────────────────────────────────────────────────────────────

/**
 * 指定フィールドが oldUid のドキュメントを全件取得し targetUid に更新する。
 * dry-run 時は件数を出力するのみで書き込みはしない。
 */
async function replaceFieldUid(collection, field, oldUid, targetUid) {
  const snap = await db.collection(collection).where(field, '==', oldUid).get()
  console.log(`[MERGE]   ${collection}.${field}: ${snap.size}件`)
  if (IS_DRY_RUN || snap.empty) return snap.size
  for (const doc of snap.docs) {
    await doc.ref.update({ [field]: targetUid })
  }
  return snap.size
}

/**
 * 配列フィールド内に oldUid を含むドキュメントを全件取得し、
 * 配列要素を oldUid → targetUid に置換する。
 * dry-run 時は件数を出力するのみ。
 */
async function replaceArrayElement(collection, arrayField, oldUid, targetUid) {
  const snap = await db.collection(collection).where(arrayField, 'array-contains', oldUid).get()
  console.log(`[MERGE]   ${collection}.${arrayField}[]: ${snap.size}件`)
  if (IS_DRY_RUN || snap.empty) return snap.size
  for (const doc of snap.docs) {
    const arr = (doc.data()[arrayField] ?? []).map(uid => (uid === oldUid ? targetUid : uid))
    await doc.ref.update({ [arrayField]: arr })
  }
  return snap.size
}

/**
 * usersコレクションを name で検索し、isRetired!=true のアクティブなドキュメントの uid を返す。
 * 0件 or 2件以上ヒットしたらエラーを返す（誤統合防止）。
 *
 * Firestore の != クエリはフィールドが存在しないドキュメントを除外するため、
 * JS 側でフィルタリングしている。
 */
async function resolveTargetUid(name) {
  const snap   = await db.collection('users').where('name', '==', name).get()
  const active = snap.docs.filter(d => d.data().isRetired !== true)

  if (active.length === 0) {
    return { error: `users に "${name}"（isRetired!=true）が 0 件` }
  }
  if (active.length >= 2) {
    const detail = active.map(d => `${d.id}(${d.data().email || 'email不明'})`).join(', ')
    return { error: `users に "${name}"（isRetired!=true）が ${active.length} 件: [${detail}]` }
  }
  return { uid: active[0].id }
}

// ── メイン処理 ─────────────────────────────────────────────────────────────────

const finalSummary = []

// ── Step A: 全員の targetUid を事前解決 ──────────────────────────────────────
console.log('[MERGE] === targetUid 解決フェーズ ===')
for (const entry of MERGE_MAP) {
  if (entry.targetUid !== null) {
    console.log(`[MERGE] ${entry.label}: targetUid 直書き = ${entry.targetUid}`)
    continue
  }
  const resolved = await resolveTargetUid(entry.label)
  if (resolved.error) {
    console.log(`[MERGE] SKIP(名前解決失敗) ${entry.label}: ${resolved.error}`)
    finalSummary.push({ label: entry.label, status: 'SKIP', reason: resolved.error })
    entry._skip = true
  } else {
    entry.targetUid = resolved.uid
    console.log(`[MERGE] ${entry.label}: 名前解決 → targetUid = ${resolved.uid}`)
  }
}

// ── Step B: 各人を処理 ───────────────────────────────────────────────────────
for (const entry of MERGE_MAP) {
  if (entry._skip) continue

  const { label, oldUid, oldEmail, targetUid, reissueAuth } = entry

  console.log(`\n${'─'.repeat(65)}`)
  console.log(`[MERGE] ▶ 処理開始: ${label}`)
  console.log(`[MERGE]   old    = ${oldUid}`)
  console.log(`[MERGE]   target = ${targetUid}`)

  // ── 冪等チェック ─────────────────────────────────────────────────────────────
  // trainingProfiles/{oldUid} が既に無ければ「統合済み」と判断して全工程をスキップする。
  // （二重実行安全）
  const tpOldRef  = db.collection('trainingProfiles').doc(oldUid)
  const tpOldSnap = await tpOldRef.get()
  if (!tpOldSnap.exists) {
    console.log(`[MERGE] SKIP（統合済み）: trainingProfiles/${oldUid} が既に存在しない`)
    finalSummary.push({ label, status: 'SKIP（統合済み）' })
    continue
  }

  // ── 事前チェック: old の Auth 存在確認 ──────────────────────────────────────
  let oldAuthUser = null
  try {
    oldAuthUser = await auth.getUser(oldUid)
    console.log(`[MERGE]   old Auth: 確認OK (email=${oldAuthUser.email ?? '不明'})`)
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      // Auth が既に消えていても Firestore 付け替えは続行する
      console.log(`[MERGE]   old Auth: 存在しない（Firestore 付け替えは続行）`)
    } else {
      console.log(`[MERGE] ERROR: ${label} Auth 取得失敗: ${err.message} → SKIP`)
      finalSummary.push({ label, status: 'ERROR', reason: `Auth 取得失敗: ${err.message}` })
      continue
    }
  }

  // ── 事前チェック: target の users doc 存在確認 ──────────────────────────────
  const targetUsersSnap = await db.collection('users').doc(targetUid).get()
  if (!targetUsersSnap.exists) {
    console.log(`[MERGE] SKIP: target users/${targetUid} が存在しない`)
    finalSummary.push({ label, status: 'SKIP', reason: `target users/${targetUid} が見つからない` })
    continue
  }
  const targetDisplayName = targetUsersSnap.data().name || label

  // ────────────────────────────────────────────────────────────────────────────
  // Step 1: trainingProfiles 移動
  //   trainingProfiles/{oldUid} → trainingProfiles/{targetUid}
  //   target 側に既存があれば SKIP して手動判断を促す
  // ────────────────────────────────────────────────────────────────────────────
  console.log(`[MERGE] Step1: trainingProfiles`)
  const tpTargetRef  = db.collection('trainingProfiles').doc(targetUid)
  const tpTargetSnap = await tpTargetRef.get()

  if (tpTargetSnap.exists) {
    console.log(`[MERGE]   SKIP: trainingProfiles/${targetUid} が既に存在 → 手動確認が必要`)
  } else {
    if (IS_DRY_RUN) {
      console.log(`[MERGE]   [dry-run] trainingProfiles/${oldUid} → ${targetUid} へコピー後に旧 doc 削除予定`)
    } else {
      // displayName 含め全フィールドを維持してコピー
      await tpTargetRef.set(tpOldSnap.data())
      await tpOldRef.delete()
      console.log(`[MERGE]   trainingProfiles 移動完了`)
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Step 2: 研修データの uid 付け替え
  //   全コレクションで oldUid → targetUid に置換する。
  //   対象フィールドはコメントの通り。型定義は regalcast-training/src/lib/types.ts 参照。
  // ────────────────────────────────────────────────────────────────────────────
  console.log(`[MERGE] Step2: 研修データ uid 付け替え`)

  // trainingAssignments (traineeUid / trainerUid)
  await replaceFieldUid('trainingAssignments', 'traineeUid', oldUid, targetUid)
  await replaceFieldUid('trainingAssignments', 'trainerUid', oldUid, targetUid)

  // trainingJournals (traineeUid / trainerUids[])
  await replaceFieldUid('trainingJournals', 'traineeUid', oldUid, targetUid)
  await replaceArrayElement('trainingJournals', 'trainerUids', oldUid, targetUid)

  // trainingEvaluations (traineeUid / evaluatorUid / approvedByUid?)
  await replaceFieldUid('trainingEvaluations', 'traineeUid', oldUid, targetUid)
  await replaceFieldUid('trainingEvaluations', 'evaluatorUid', oldUid, targetUid)
  await replaceFieldUid('trainingEvaluations', 'approvedByUid', oldUid, targetUid)  // optional

  // trainingFeedbacks (traineeUid / fromUid)
  await replaceFieldUid('trainingFeedbacks', 'traineeUid', oldUid, targetUid)
  await replaceFieldUid('trainingFeedbacks', 'fromUid', oldUid, targetUid)

  // trainingStageHistory (traineeUid)
  await replaceFieldUid('trainingStageHistory', 'traineeUid', oldUid, targetUid)

  // trainingGoals: ドキュメント移動（{oldUid} → {targetUid}）
  // traineeUid フィールドも書き換える
  const goalsOldRef  = db.collection('trainingGoals').doc(oldUid)
  const goalsOldSnap = await goalsOldRef.get()
  if (goalsOldSnap.exists) {
    const goalsTargetRef  = db.collection('trainingGoals').doc(targetUid)
    const goalsTargetSnap = await goalsTargetRef.get()
    if (goalsTargetSnap.exists) {
      console.log(`[MERGE]   trainingGoals: SKIP（target 側に既存あり）`)
    } else {
      if (IS_DRY_RUN) {
        console.log(`[MERGE]   [dry-run] trainingGoals/${oldUid} → ${targetUid} へ移動予定`)
      } else {
        await goalsTargetRef.set({ ...goalsOldSnap.data(), traineeUid: targetUid })
        await goalsOldRef.delete()
        console.log(`[MERGE]   trainingGoals 移動完了`)
      }
    }
  } else {
    console.log(`[MERGE]   trainingGoals/${oldUid}: なし（スキップ）`)
  }

  // trainingStaffDailies (authorUid / readByUids[])
  // 注意: doc ID は "{authorUid}_{date}" 形式だが、フィールドのみ更新（doc 移動はしない）
  // app が authorUid フィールドでクエリする実装なら問題なし
  await replaceFieldUid('trainingStaffDailies', 'authorUid', oldUid, targetUid)
  await replaceArrayElement('trainingStaffDailies', 'readByUids', oldUid, targetUid)

  // trainingOjtReports (authorUid)
  await replaceFieldUid('trainingOjtReports', 'authorUid', oldUid, targetUid)

  // trainingOjtComments (authorUid)
  await replaceFieldUid('trainingOjtComments', 'authorUid', oldUid, targetUid)

  // trainingMaterialChangeRequests (requestedByUid / submittedByUid)
  // rules は submittedByUid を検査、型は requestedByUid を持つ。本番では両フィールドをセット（互換）。
  await replaceFieldUid('trainingMaterialChangeRequests', 'requestedByUid', oldUid, targetUid)
  await replaceFieldUid('trainingMaterialChangeRequests', 'submittedByUid', oldUid, targetUid)

  // trainingEvaluationApprovals (traineeUid / evaluatorUid / approvedByLeaderUid? / approvedByAdminUid?)
  await replaceFieldUid('trainingEvaluationApprovals', 'traineeUid', oldUid, targetUid)
  await replaceFieldUid('trainingEvaluationApprovals', 'evaluatorUid', oldUid, targetUid)
  await replaceFieldUid('trainingEvaluationApprovals', 'approvedByLeaderUid', oldUid, targetUid)  // optional
  await replaceFieldUid('trainingEvaluationApprovals', 'approvedByAdminUid', oldUid, targetUid)   // optional

  // ────────────────────────────────────────────────────────────────────────────
  // Step 3: voice_profiles
  //   - voice_profiles/{oldUid}: 存在すれば削除
  //   - voice_profiles/{targetUid}: 未存在なら新規作成
  // ────────────────────────────────────────────────────────────────────────────
  console.log(`[MERGE] Step3: voice_profiles`)

  const voiceOldRef     = db.collection('voice_profiles').doc(oldUid)
  const voiceOldSnap    = await voiceOldRef.get()
  const voiceTargetRef  = db.collection('voice_profiles').doc(targetUid)
  const voiceTargetSnap = await voiceTargetRef.get()

  if (voiceOldSnap.exists) {
    if (IS_DRY_RUN) {
      console.log(`[MERGE]   [dry-run] voice_profiles/${oldUid} 削除予定`)
    } else {
      await voiceOldRef.delete()
      console.log(`[MERGE]   voice_profiles/${oldUid} 削除完了`)
    }
  } else {
    console.log(`[MERGE]   voice_profiles/${oldUid}: なし（スキップ）`)
  }

  if (!voiceTargetSnap.exists) {
    const now    = Timestamp.now()
    const newDoc = {
      uid:         targetUid,
      voiceRoles:  ['reader'],
      displayName: targetDisplayName,
      createdAt:   now,
      updatedAt:   now,
    }
    if (IS_DRY_RUN) {
      console.log(`[MERGE]   [dry-run] voice_profiles/${targetUid} 新規作成予定 (displayName="${targetDisplayName}")`)
    } else {
      await voiceTargetRef.set(newDoc)
      console.log(`[MERGE]   voice_profiles/${targetUid} 新規作成完了`)
    }
  } else {
    console.log(`[MERGE]   voice_profiles/${targetUid}: 既存 → SKIP`)
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Step 4: Auth 整理
  //
  //   1. auth.deleteUser(oldUid)  ← 重複垢を削除（email が解放される）
  //   2. auth.createUser({ uid: targetUid, email: oldEmail, emailVerified: false })
  //      ← reissueAuth=true の人のみ。uid 指定発行で target の Auth を確立する。
  //      ← 宮地は既存 Auth があるため deleteUser のみ（reissueAuth=false）。
  //
  //   安全弁: auth.deleteUser を呼べるのは DELETABLE_OLD_UIDS に含まれる uid のみ。
  //   この assert を外した場合は処理を中断する。
  // ────────────────────────────────────────────────────────────────────────────
  console.log(`[MERGE] Step4: Auth`)

  // 安全弁（絶対に削除しないこと・構造上 targetUid はここに入らない）
  if (!DELETABLE_OLD_UIDS.has(oldUid)) {
    throw new Error(
      `[SAFETY] ${oldUid} は DELETABLE_OLD_UIDS に含まれていない。` +
      `targetUid との取り違え疑いがあるため処理を中断する。`
    )
  }

  if (oldAuthUser !== null) {
    if (IS_DRY_RUN) {
      console.log(`[MERGE]   [dry-run] auth.deleteUser("${oldUid}") 予定`)
    } else {
      await auth.deleteUser(oldUid)
      console.log(`[MERGE]   auth.deleteUser("${oldUid}") 完了`)
    }
  } else {
    console.log(`[MERGE]   old Auth が存在しないため deleteUser スキップ`)
  }

  if (reissueAuth) {
    if (IS_DRY_RUN) {
      console.log(
        `[MERGE]   [dry-run] auth.createUser({ uid: "${targetUid}", email: "${oldEmail}", emailVerified: false }) 予定`
      )
    } else {
      try {
        await auth.createUser({ uid: targetUid, email: oldEmail, emailVerified: false })
        console.log(`[MERGE]   auth.createUser uid="${targetUid}" email="${oldEmail}" 完了`)
      } catch (err) {
        if (err.code === 'auth/uid-already-exists') {
          // target uid の Auth が既に存在する場合（二重実行等）
          console.log(`[MERGE]   SKIP: uid "${targetUid}" の Auth が既に存在（再発行不要）`)
        } else if (err.code === 'auth/email-already-exists') {
          // email が deleteUser 前から別 Auth に使われていた場合
          console.log(`[MERGE]   WARN: email "${oldEmail}" が既に別 Auth に紐付き → 手動確認が必要`)
        } else {
          throw err
        }
      }
    }
  } else {
    // 宮地就太: target に既存 Auth があるため再発行なし
    console.log(`[MERGE]   Auth 再発行なし（target に既存 Auth あり）`)
  }

  console.log(`[MERGE] ✓ ${label} 処理完了`)
  finalSummary.push({ label, status: 'OK' })
}

// ── 最終サマリー ────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(65)}`)
console.log(`[MERGE] 最終サマリー（${IS_DRY_RUN ? 'dry-run' : '実行結果'}）`)
console.log()
for (const r of finalSummary) {
  const icon = r.status === 'OK' ? '✓' : r.status.startsWith('ERROR') ? '✗' : '⚠'
  console.log(`[MERGE]   ${icon} ${r.label}: ${r.status}${r.reason ? ` — ${r.reason}` : ''}`)
}

if (IS_DRY_RUN) {
  console.log()
  console.log('[dry-run] Firestore/Auth への書き込みはゼロです。')
  console.log('実行: node scripts/merge-duplicate-accounts.mjs --execute')
  console.log()
  console.log('⚠️  --execute は 🔴RED 操作。航也のGOサインを必ずもらうこと。')
} else {
  console.log()
  console.log('[MERGE] ✅ 統合処理 完了。')
  console.log('次のステップ:')
  console.log('  1. Firebase Console で Auth を確認:')
  console.log(`     https://console.firebase.google.com/project/${PROJECT_ID}/authentication/users`)
  console.log('  2. Auth 再発行した人（加藤・岩田・助野）に「パスワードを忘れた方」から')
  console.log('     PWリセットを案内する（元のパスワードは不明でOK）')
}
