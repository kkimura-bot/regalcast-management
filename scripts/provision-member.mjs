#!/usr/bin/env node
/**
 * provision-member.mjs — regalcast-management アカウント基盤刷新 Phase 1
 * プロビジョニング一元化スクリプト
 *
 * =========================================================
 * 設計の核:
 *   Firebase Admin SDK は uid を指定して Auth アカウントを作成できる。
 *   既存の users ドキュメントの uid をそのまま Auth uid として発行すれば、
 *   attendance（{uid}_{日付}キー）・shifts・給与関連の過去データは
 *   1件も触らずに委託メンバーを Auth 化できる。
 *   Authは既存uid指定発行＝過去データ無傷が本設計の核。
 *   「登録し直し不要・uid付け替えバッチ不要」の根幹がここにある。
 * =========================================================
 *
 * 使い方（詳細は scripts/README.md）:
 *
 *   # モード1: 全メンバーを一括整備（dry-run デフォルト）
 *   node scripts/provision-member.mjs --sync-all
 *   node scripts/provision-member.mjs --sync-all --execute  # 🔴RED 航也GOサイン必須
 *
 *   # モード2: 中途半端状態の検出レポート（書き込みなし）
 *   node scripts/provision-member.mjs --repair
 *
 *   # モード3: 新規1名を一括作成（dry-run デフォルト）
 *   node scripts/provision-member.mjs --add --email=foo@example.com --name="山田太郎" --type=employee
 *   node scripts/provision-member.mjs --add --email=foo@example.com --name="山田太郎" --type=contractor --role=member --execute
 *
 *   # モード4: メールなし業務委託を users のみ登録（dry-run デフォルト）
 *   node scripts/provision-member.mjs --add-noauth --name="山田花子"
 *   node scripts/provision-member.mjs --add-noauth --name="山田花子" --role=member --execute
 *   ※ Auth/voice_profiles は作らない。メール取得後に --sync-all で Auth 化する導線。
 *
 * 事前準備（ADC方式）:
 *   gcloud auth application-default login
 *   gcloud auth application-default set-quota-project regalcast-app
 *
 * 禁止事項（このスクリプトが絶対にやらないこと）:
 *   - --execute なしでの書き込み（dry-run がデフォルト）
 *   - Auth の削除・無効化
 *   - users/attendance/shifts の既存フィールドの変更・削除
 *   - voice_profiles 既存 doc の set() による上書き（followerCount 等を守るため update() のみ）
 */

import { randomBytes } from 'crypto'

// ===== コマンドライン引数 =======================================================

const args        = process.argv.slice(2)
const IS_EXECUTE      = args.includes('--execute')
const IS_DRY_RUN      = !IS_EXECUTE
const IS_FORCE        = args.includes('--force')
const MODE_SYNC       = args.includes('--sync-all')
const MODE_REPAIR     = args.includes('--repair')
const MODE_ADD        = args.includes('--add')
const MODE_ADD_NOAUTH = args.includes('--add-noauth')

/** "--key=value" 形式の引数を取得 */
const getArg = (key) => {
  const found = args.find(a => a.startsWith(`${key}=`))
  return found ? found.slice(key.length + 1) : null
}

// --add 用パラメータ
const ADD_EMAIL = getArg('--email')
const ADD_NAME  = getArg('--name')
const ADD_TYPE  = getArg('--type')   // 'employee' | 'contractor'
const ADD_ROLE  = getArg('--role') || 'member'

// ===== バリデーション ===========================================================

const modeCount = [MODE_SYNC, MODE_REPAIR, MODE_ADD, MODE_ADD_NOAUTH].filter(Boolean).length
if (modeCount !== 1) {
  console.error('エラー: モードをひとつだけ指定してください。')
  console.error('  --sync-all   全メンバーを一括整備')
  console.error('  --repair     中途半端状態の検出レポート')
  console.error('  --add        新規1名を一括作成（メールあり）')
  console.error('  --add-noauth メールなし業務委託を users のみ登録')
  process.exit(1)
}

if (MODE_ADD_NOAUTH) {
  if (!ADD_NAME) {
    console.error('エラー: --add-noauth には --name=X が必要です。')
    process.exit(1)
  }
}

if (MODE_ADD) {
  if (!ADD_EMAIL || !ADD_NAME || !ADD_TYPE) {
    console.error('エラー: --add には --email=X --name=Y --type=employee|contractor が必要です。')
    process.exit(1)
  }
  if (ADD_TYPE !== 'employee' && ADD_TYPE !== 'contractor') {
    console.error('エラー: --type は employee または contractor を指定してください。')
    process.exit(1)
  }
}

// ===== Firebase Admin 初期化 ====================================================

const PROJECT_ID = 'regalcast-app'

let auth, db, Timestamp

try {
  const { initializeApp, applicationDefault } = await import('firebase-admin/app')
  const { getAuth: _getAuth }                 = await import('firebase-admin/auth')
  const { getFirestore, Timestamp: TS }       = await import('firebase-admin/firestore')

  initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID })
  auth      = _getAuth()
  db        = getFirestore()
  Timestamp = TS

  console.log(`Firebase 初期化: プロジェクト「${PROJECT_ID}」\n`)
} catch (err) {
  console.error(`Firebase Admin 初期化失敗: ${err.message}`)
  console.error('ADC を設定してください:')
  console.error('  gcloud auth application-default login')
  console.error(`  gcloud auth application-default set-quota-project ${PROJECT_ID}`)
  process.exit(1)
}

// ===== ユーティリティ ===========================================================

/**
 * Auth の全ユーザーをページネーションで取得（最大 1000 件ずつ）
 */
async function listAllAuthUsers() {
  const users = []
  let pageToken
  do {
    const res = await auth.listUsers(1000, pageToken)
    users.push(...res.users)
    pageToken = res.pageToken
  } while (pageToken)
  return users
}

/**
 * Firestore の全 users ドキュメントを取得
 */
async function listAllFirestoreUsers() {
  const snap = await db.collection('users').get()
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

/**
 * 初期パスワード生成（Auth 発行時に設定するが本人には教えない）
 * 本人は「パスワードを忘れた方」からリセットして初回ログインする（hit-board 実績あり）
 */
function generateTempPassword() {
  return randomBytes(16).toString('base64url').slice(0, 20)
}

/** モードタグ表示用 */
const dryTag = IS_DRY_RUN ? '[dry-run] ' : ''

// ===== モード1: --sync-all ======================================================

async function runSyncAll() {
  console.log('=== sync-all: 全メンバー一括整備 ===')
  console.log(`モード: ${IS_DRY_RUN ? 'dry-run（書き込みなし）' : '⚠️  EXECUTE（実行）'}`)

  if (IS_EXECUTE) {
    console.log('\n    航也のGOサインが必須です。3秒後に開始...')
    await new Promise(r => setTimeout(r, 3000))
  }
  console.log()

  // ── 全データ一括取得 ───────────────────────────────────

  console.log('データ取得中...')
  const [authUsers, firestoreUsers, voiceSnap, trainingSnap] = await Promise.all([
    listAllAuthUsers(),
    listAllFirestoreUsers(),
    db.collection('voice_profiles').get(),
    db.collection('trainingProfiles').get()
  ])

  const authByUid       = new Map(authUsers.map(u => [u.uid, u]))
  const authByEmail     = new Map(authUsers.filter(u => u.email).map(u => [u.email.toLowerCase(), u]))
  const voiceByUid      = new Map(voiceSnap.docs.map(d => [d.id, d.data()]))
  const trainingByUid   = new Map(trainingSnap.docs.map(d => [d.id, d.data()]))

  console.log(`Auth ユーザー: ${authUsers.length}名`)
  console.log(`Firestore users: ${firestoreUsers.length}件`)
  console.log(`voice_profiles: ${voiceSnap.size}件`)
  console.log(`trainingProfiles: ${trainingSnap.size}件`)
  console.log()

  // ── サマリーカウンタ ────────────────────────────────────

  const summary = {
    employmentTypeAdded:       0,
    employmentTypeSkipped:     0,
    authCreated:               0,
    authSkipped:               0,
    authSkipDetails:           [],   // { name, uid, reason }
    trainingUpdated:           0,
    trainingSkipped:           0,
    voiceCreated:              0,
    voiceUpdated:              0,
    voiceSkipped:              0,
    errors:                    []    // エラーが出ても続行し、最後にまとめて表示
  }

  const now = Timestamp.now()

  // ── 各メンバーを処理 ────────────────────────────────────

  for (const user of firestoreUsers) {
    const uid  = user.id
    const name = (user.name || '').trim()
    const tag  = `[${uid.slice(0, 8)}…] ${name || '(名前なし)'}`

    console.log(tag)

    // ────────────────────────────────────────────────────────
    // A. employmentType 付与
    //    isAlliance==true または noAuth==true → 'contractor'
    //    それ以外 → 'employee'（既に値があればスキップ）
    // ────────────────────────────────────────────────────────
    try {
      const isContractor   = user.isAlliance === true || user.noAuth === true
      const expectedType   = isContractor ? 'contractor' : 'employee'

      if (user.employmentType) {
        console.log(`  employmentType: SKIP（既に "${user.employmentType}" 設定済み）`)
        summary.employmentTypeSkipped++
      } else {
        if (IS_DRY_RUN) {
          console.log(`  employmentType: ${dryTag}users/${uid} に { employmentType: "${expectedType}" } を update 予定`)
        } else {
          // update = 指定フィールドのみ追加。既存フィールドは一切消さない
          await db.collection('users').doc(uid).update({ employmentType: expectedType })
          console.log(`  employmentType: ✓ "${expectedType}" を追加`)
        }
        summary.employmentTypeAdded++
      }
    } catch (err) {
      console.error(`  employmentType: ❌ ${err.message}`)
      summary.errors.push(`employmentType[${uid}]: ${err.message}`)
    }

    // ────────────────────────────────────────────────────────
    // B. Auth 存在チェック → 必要なら既存 uid で Auth 発行
    //
    //    ★ Authは既存uid指定発行 = 過去データ無傷が本設計の核 ★
    //    createUser({ uid: 既存docId, email }) を使うことで
    //    attendance / shifts / 給与の過去データが1件も壊れない。
    //
    //    メールなし / 退職者 → SKIP（当面現状のまま動く設計）
    // ────────────────────────────────────────────────────────
    try {
      if (authByUid.has(uid)) {
        console.log(`  Auth: SKIP（既に Auth あり）`)
        summary.authSkipped++
      } else {
        const email = user.email ? user.email.toLowerCase().trim() : null

        if (!email) {
          const detail = `${name || uid}: メールなし → SKIP`
          console.log(`  Auth: ${detail}`)
          summary.authSkipDetails.push(detail)
          summary.authSkipped++
        } else if (user.isRetired === true) {
          const detail = `${name || uid}: 退職者 → SKIP`
          console.log(`  Auth: ${detail}`)
          summary.authSkipDetails.push(detail)
          summary.authSkipped++
        } else {
          // ── Auth 発行対象 ────────────────────────────────
          if (IS_DRY_RUN) {
            console.log(`  Auth: ${dryTag}createUser({ uid: "${uid}", email: "${email}", emailVerified: false }) 予定`)
            summary.authCreated++
          } else {
            try {
              // ★ uid を既存 Firestore docId に固定して Auth 発行（核心部分）
              await auth.createUser({
                uid,             // 既存ドキュメントIDを uid として指定 = 過去データ無傷
                email,
                emailVerified: false,
                password: generateTempPassword() // 本人には知らせない。PW忘れリセットで初回ログイン
              })
              console.log(`  Auth: ✓ uid="${uid}" で Auth 発行完了（${email}）`)
              summary.authCreated++
            } catch (err) {
              if (err.code === 'auth/email-already-exists') {
                // メールが別 uid の Auth に使われている → 突合結果を表示してスキップ
                const conflict = authByEmail.get(email)
                const detail = `${name || uid}: メール重複 → SKIP（既存 Auth uid=${conflict?.uid ?? '不明'} / email=${email}）`
                console.log(`  Auth: ⚠ ${detail}`)
                summary.authSkipDetails.push(detail)
                summary.authSkipped++
              } else if (err.code === 'auth/uid-already-exists') {
                // listUsers では取れなかったが既に uid が存在する（極めて稀）
                const detail = `${name || uid}: uid 既存（listUsers 未収録の可能性） → SKIP`
                console.log(`  Auth: ⚠ ${detail}`)
                summary.authSkipDetails.push(detail)
                summary.authSkipped++
              } else {
                console.error(`  Auth: ❌ ${err.message}`)
                summary.errors.push(`Auth.createUser[${uid}]: ${err.message}`)
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(`  Auth チェック: ❌ ${err.message}`)
      summary.errors.push(`Auth.check[${uid}]: ${err.message}`)
    }

    // ────────────────────────────────────────────────────────
    // C. trainingProfiles: 存在して displayName が空なら users.name で update
    //    新規作成はしない（研修対象は研修アプリで追加する運用を維持）
    //    docID = uid（trainingProfiles/{uid}）
    // ────────────────────────────────────────────────────────
    try {
      const training = trainingByUid.get(uid)

      if (!training) {
        console.log(`  trainingProfiles: SKIP（ドキュメントなし）`)
        summary.trainingSkipped++
      } else if (training.displayName && training.displayName.trim()) {
        console.log(`  trainingProfiles: SKIP（displayName="${training.displayName}" 設定済み）`)
        summary.trainingSkipped++
      } else if (!name) {
        console.log(`  trainingProfiles: SKIP（users.name が空）`)
        summary.trainingSkipped++
      } else {
        if (IS_DRY_RUN) {
          console.log(`  trainingProfiles: ${dryTag}trainingProfiles/${uid} に { displayName: "${name}" } を update 予定`)
        } else {
          await db.collection('trainingProfiles').doc(uid).update({ displayName: name, updatedAt: now })
          console.log(`  trainingProfiles: ✓ displayName="${name}" を update`)
        }
        summary.trainingUpdated++
      }
    } catch (err) {
      console.error(`  trainingProfiles: ❌ ${err.message}`)
      summary.errors.push(`trainingProfiles[${uid}]: ${err.message}`)
    }

    // ────────────────────────────────────────────────────────
    // D. voice_profiles
    //    - 存在しない → 新規作成 { uid, voiceRoles: ['reader'], displayName, createdAt, updatedAt }
    //    - 存在して displayName 空 → update（⚠️ followerCount 等を保護するため set 禁止・update のみ）
    //    - 存在して displayName あり → SKIP
    // ────────────────────────────────────────────────────────
    try {
      const voice = voiceByUid.get(uid)

      if (!voice) {
        // 新規作成（docが存在しないので set() は安全）
        // 退職者は RegalVoice のメンバー一覧から除外する方針のため新規作成しない
        if (user.isRetired === true) {
          console.log(`  voice_profiles: SKIP（退職者のため新規作成しない）`)
          summary.voiceSkipped++
        } else {
          const newDoc = {
            uid,
            voiceRoles: ['reader'],
            displayName: name,
            createdAt: now,
            updatedAt: now
          }
          if (IS_DRY_RUN) {
            console.log(`  voice_profiles: ${dryTag}voice_profiles/${uid} を新規作成予定 voiceRoles=["reader"] displayName="${name}"`)
          } else {
            await db.collection('voice_profiles').doc(uid).set(newDoc)
            console.log(`  voice_profiles: ✓ 新規作成 displayName="${name}"`)
          }
          summary.voiceCreated++
        }
      } else if (!voice.displayName || !voice.displayName.trim()) {
        // displayName が空 → update のみ（set 上書き禁止。followerCount・その他既存フィールドを守る）
        if (!name) {
          console.log(`  voice_profiles: SKIP（displayName 空だが users.name も空）`)
          summary.voiceSkipped++
        } else {
          if (IS_DRY_RUN) {
            console.log(`  voice_profiles: ${dryTag}voice_profiles/${uid} に { displayName: "${name}" } を update 予定`)
          } else {
            await db.collection('voice_profiles').doc(uid).update({ displayName: name, updatedAt: now })
            console.log(`  voice_profiles: ✓ displayName="${name}" を update`)
          }
          summary.voiceUpdated++
        }
      } else {
        console.log(`  voice_profiles: SKIP（displayName="${voice.displayName}" 設定済み）`)
        summary.voiceSkipped++
      }
    } catch (err) {
      console.error(`  voice_profiles: ❌ ${err.message}`)
      summary.errors.push(`voice_profiles[${uid}]: ${err.message}`)
    }

    console.log()
  }

  // ── サマリー出力 ─────────────────────────────────────────

  console.log('─'.repeat(65))
  console.log(`サマリー（${IS_DRY_RUN ? 'dry-run' : '実行結果'}）`)
  console.log(`  employmentType 追加: ${summary.employmentTypeAdded}件 / SKIP: ${summary.employmentTypeSkipped}件`)
  console.log(`  Auth 発行:           ${summary.authCreated}件 / SKIP: ${summary.authSkipped}件`)
  console.log(`  trainingProfiles update: ${summary.trainingUpdated}件 / SKIP: ${summary.trainingSkipped}件`)
  console.log(`  voice_profiles 作成: ${summary.voiceCreated}件 / update: ${summary.voiceUpdated}件 / SKIP: ${summary.voiceSkipped}件`)

  if (summary.authSkipDetails.length > 0) {
    console.log('\nAuth SKIP 一覧:')
    summary.authSkipDetails.forEach(d => console.log(`  - ${d}`))
  }

  if (summary.errors.length > 0) {
    console.log('\n⚠️  エラー一覧（スキップして続行した処理）:')
    summary.errors.forEach(e => console.log(`  ❌ ${e}`))
  }

  console.log('─'.repeat(65))

  if (IS_DRY_RUN) {
    console.log('\n[dry-run] Firestore/Auth への書き込みはスキップしました。')
    console.log('実行: node scripts/provision-member.mjs --sync-all --execute')
    console.log('\n⚠️  --execute は 🔴RED 操作。航也のGOサインを必ずもらうこと。')
    console.log('   Auth 発行後は本人に「パスワードを忘れた方」でPWリセットを案内する。')
  } else {
    console.log('\n✅ sync-all 完了。')
    console.log('次のステップ:')
    console.log('  1. Auth 発行したメンバーに「パスワードを忘れた方」でPWリセットを案内')
    console.log('  2. Firebase コンソールで Auth 発行状況を確認:')
    console.log('     https://console.firebase.google.com/project/regalcast-app/authentication/users')
    console.log('  3. Phase 2: アライアンス画面廃止 → rules の attendance/shifts 全開放を閉鎖')
  }
}

// ===== モード2: --repair =========================================================

async function runRepair() {
  console.log('=== repair: 中途半端状態の検出レポート ===')
  console.log('このモードは書き込みを行いません（レポートのみ）\n')

  console.log('データ取得中...')
  const [authUsers, firestoreUsers] = await Promise.all([
    listAllAuthUsers(),
    listAllFirestoreUsers()
  ])

  const authByUid         = new Map(authUsers.map(u => [u.uid, u]))
  const firestoreByUid    = new Map(firestoreUsers.map(u => [u.id, u]))
  const authByEmail       = new Map(authUsers.filter(u => u.email).map(u => [u.email.toLowerCase(), u]))

  console.log(`Auth ユーザー: ${authUsers.length}名`)
  console.log(`Firestore users: ${firestoreUsers.length}件\n`)

  const issues = {
    authOnlyNoFirestore:      [],  // Auth にいるが users にない
    firestoreEmailNoAuth:     [],  // users にいてメールあり・非退職なのに Auth にない（--sync-all 対象）
    noEmail:                  [],  // users にいてメールなし（当面 Auth 発行不可）
    emailMismatch:            [],  // Auth メールと Firestore メールが食い違う
    retired:                  []   // 退職者で Auth が存在する（念のため報告・削除しない）
  }

  // Auth にいるが users にいない
  for (const u of authUsers) {
    if (!firestoreByUid.has(u.uid)) {
      issues.authOnlyNoFirestore.push({ uid: u.uid, email: u.email || '(emailなし)', displayName: u.displayName || '(名前なし)' })
    }
  }

  // users を走査
  for (const user of firestoreUsers) {
    const uid      = user.id
    const authUser = authByUid.get(uid)
    const email    = user.email ? user.email.toLowerCase().trim() : null

    if (!authUser) {
      if (!email) {
        issues.noEmail.push({ uid, name: user.name })
      } else if (user.isRetired === true) {
        // 退職者かつ Auth なし → 正常（Auth 不要）
      } else {
        issues.firestoreEmailNoAuth.push({ uid, name: user.name, email })
      }
    } else {
      // Auth あり → メール突合
      const authEmail = authUser.email ? authUser.email.toLowerCase() : null
      if (email && authEmail && email !== authEmail) {
        issues.emailMismatch.push({ uid, name: user.name, firestoreEmail: email, authEmail })
      }
      if (user.isRetired === true) {
        issues.retired.push({ uid, name: user.name, email: authUser.email || '(emailなし)' })
      }
    }
  }

  // ── レポート出力 ─────────────────────────────────────────

  console.log('─'.repeat(65))

  // 1. Auth のみ（users なし）
  if (issues.authOnlyNoFirestore.length === 0) {
    console.log('✅ Auth のみ（users なし）: 問題なし')
  } else {
    console.log(`⚠️  Auth のみ・users なし: ${issues.authOnlyNoFirestore.length}件（手動確認が必要）`)
    issues.authOnlyNoFirestore.forEach(u => {
      console.log(`   uid=${u.uid}  email=${u.email}  name=${u.displayName}`)
    })
    console.log('   → このスクリプトでは自動修復しません（削除・無効化も行いません）')
  }

  console.log()

  // 2. users のみ（Auth なし・メールあり・非退職）= --sync-all で発行可能
  if (issues.firestoreEmailNoAuth.length === 0) {
    console.log('✅ Auth 未発行（メールあり・非退職）: なし')
  } else {
    console.log(`📋 Auth 未発行（--sync-all で発行可能）: ${issues.firestoreEmailNoAuth.length}件`)
    issues.firestoreEmailNoAuth.forEach(u => {
      console.log(`   uid=${u.uid}  name=${u.name}  email=${u.email}`)
    })
  }

  console.log()

  // 3. メールなし（Auth 発行不可）
  if (issues.noEmail.length === 0) {
    console.log('✅ メールなし（Auth 発行不可）: なし')
  } else {
    console.log(`ℹ️  メールなし（当面 Auth 無しのまま・要メール収集）: ${issues.noEmail.length}件`)
    issues.noEmail.forEach(u => {
      console.log(`   uid=${u.uid}  name=${u.name}`)
    })
  }

  console.log()

  // 4. メール食い違い
  if (issues.emailMismatch.length === 0) {
    console.log('✅ メール食い違い: なし')
  } else {
    console.log(`⚠️  メール食い違い（手動確認が必要）: ${issues.emailMismatch.length}件`)
    issues.emailMismatch.forEach(u => {
      console.log(`   uid=${u.uid}  name=${u.name}`)
      console.log(`     Firestore: ${u.firestoreEmail}`)
      console.log(`     Auth:      ${u.authEmail}`)
    })
  }

  console.log()

  // 5. 退職者で Auth が存在する
  if (issues.retired.length > 0) {
    console.log(`ℹ️  退職者で Auth あり（参考情報・削除不要なら無視可）: ${issues.retired.length}件`)
    issues.retired.forEach(u => {
      console.log(`   uid=${u.uid}  name=${u.name}  email=${u.email}`)
    })
    console.log('   → このスクリプトでは Auth の削除・無効化は絶対に行いません')
    console.log()
  }

  console.log('─'.repeat(65))
  console.log('\n[repair] 上記は検出レポートのみです。')
  console.log('  - Auth 未発行の修復 → node scripts/provision-member.mjs --sync-all --execute')
  console.log('  - Auth のみ・メール食い違いの修復 → 手動対応')
  console.log('  - Auth の削除・無効化 → このスクリプトでは絶対に行いません')
}

// ===== モード3: --add ============================================================

async function runAdd() {
  console.log('=== add: 新規メンバー一括作成 ===')
  console.log(`モード: ${IS_DRY_RUN ? 'dry-run（書き込みなし）' : '⚠️  EXECUTE（実行）'}`)
  console.log(`  email: ${ADD_EMAIL}`)
  console.log(`  name:  ${ADD_NAME}`)
  console.log(`  type:  ${ADD_TYPE}`)
  console.log(`  role:  ${ADD_ROLE}`)
  console.log()

  if (IS_EXECUTE) {
    console.log('3秒後に開始します...')
    await new Promise(r => setTimeout(r, 3000))
    console.log()
  }

  const email = ADD_EMAIL.toLowerCase().trim()
  const now   = Timestamp.now()

  // 既存 Auth チェック
  let existingAuthUser = null
  try {
    existingAuthUser = await auth.getUserByEmail(email)
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err
  }

  if (existingAuthUser) {
    console.error(`エラー: "${email}" は既に Auth に存在します（uid=${existingAuthUser.uid}）。`)
    console.error('既存メンバーの場合は --sync-all で整備してください。')
    process.exit(1)
  }

  if (IS_DRY_RUN) {
    console.log(`${dryTag}Auth.createUser({ email: "${email}", emailVerified: false }) 予定 → uid 自動生成`)
    console.log(`${dryTag}users/{uid} を set 予定:`)
    console.log(`  { name: "${ADD_NAME}", email: "${email}", role: "${ADD_ROLE}", employmentType: "${ADD_TYPE}"`)
    if (ADD_TYPE === 'contractor') console.log(`    isAlliance: true（後方互換）`)
    console.log(`    hasSalaryInfo: false, createdAt }`)
    console.log(`${dryTag}voice_profiles/{uid} を set 予定:`)
    console.log(`  { uid, voiceRoles: ["reader"], displayName: "${ADD_NAME}", createdAt, updatedAt }`)
    console.log()
    console.log('[dry-run] 書き込みは行いませんでした。')
    console.log('実行: node scripts/provision-member.mjs --add --email=... --name=... --type=... --execute')
    console.log('\n⚠️  --execute は 🔴RED 操作。航也のGOサインを必ずもらうこと。')
    return
  }

  // 1. Auth 作成（uid は Auth 自動生成 = 既存uidへの干渉なし）
  const record = await auth.createUser({
    email,
    emailVerified: false,
    password: generateTempPassword()
  })
  const authUid = record.uid
  console.log(`✓ Auth 作成: uid="${authUid}"`)

  // 2. users/{authUid} を作成（docId = authUid で統一）
  const userDoc = {
    name:            ADD_NAME,
    email,
    role:            ADD_ROLE,
    employmentType:  ADD_TYPE,
    // isAlliance は後方互換のために contractor の場合のみ付与
    ...(ADD_TYPE === 'contractor' ? { isAlliance: true } : {}),
    hasSalaryInfo:   false,
    createdAt:       now
  }
  await db.collection('users').doc(authUid).set(userDoc)
  console.log(`✓ users/${authUid} 作成`)

  // 3. voice_profiles/{authUid} を作成
  const voiceDoc = {
    uid:          authUid,
    voiceRoles:   ['reader'],
    displayName:  ADD_NAME,
    createdAt:    now,
    updatedAt:    now
  }
  await db.collection('voice_profiles').doc(authUid).set(voiceDoc)
  console.log(`✓ voice_profiles/${authUid} 作成`)

  console.log()
  console.log('✅ 新規メンバー作成完了。')
  console.log('次のステップ:')
  console.log(`  1. ${ADD_NAME}（${email}）に「パスワードを忘れた方」からPWリセットを案内`)
  console.log('  2. 研修対象の場合は研修アプリで trainingProfiles を追加（このスクリプトは作成しない）')
  console.log(`  3. Firebase コンソールで確認: https://console.firebase.google.com/project/${PROJECT_ID}/authentication/users`)
}

// ===== モード4: --add-noauth =====================================================

async function runAddNoAuth() {
  console.log('=== add-noauth: メールなし業務委託の users 登録 ===')
  console.log(`モード: ${IS_DRY_RUN ? 'dry-run（書き込みなし）' : '⚠️  EXECUTE（実行）'}`)
  console.log(`  name: ${ADD_NAME}`)
  console.log(`  role: ${ADD_ROLE}`)
  console.log()

  // ── 同名ユーザーの重複チェック（name 完全一致） ────────
  const dupSnap = await db.collection('users').where('name', '==', ADD_NAME).get()
  if (!dupSnap.empty) {
    const hits = dupSnap.docs.map(d => `uid=${d.id}  name="${d.data().name}"`)
    console.error(`エラー: 同名ユーザーが存在します（${dupSnap.size}件）:`)
    hits.forEach(h => console.error(`  ${h}`))
    if (!IS_FORCE) {
      console.error('\n同名でも別人の場合は --force を付けて再実行してください:')
      console.error(`  node scripts/provision-member.mjs --add-noauth --name="${ADD_NAME}" [--role=...] [--execute] --force`)
      process.exit(1)
    }
    console.log(`⚠️  --force 指定: 同名ユーザーが存在しますが続行します。`)
    console.log()
  }

  if (IS_EXECUTE) {
    console.log('3秒後に開始します...')
    await new Promise(r => setTimeout(r, 3000))
    console.log()
  }

  const now      = Timestamp.now()
  // Firestore の .doc() で自動ID を取得（実際の書き込みは set() で行う）
  const newDocRef = db.collection('users').doc()
  const newDocId  = newDocRef.id

  const userDoc = {
    name:           ADD_NAME,
    role:           ADD_ROLE,
    employmentType: 'contractor',
    isAlliance:     true,  // 後方互換フラグ
    noAuth:         true,  // メール未収集・Auth 未発行であることを明示
    createdAt:      now,
  }

  if (IS_DRY_RUN) {
    console.log(`${dryTag}users/${newDocId}（自動生成ID）を set 予定:`)
    // Timestamp はシリアライズ不可なので表示用に差し替え
    const displayDoc = { ...userDoc, createdAt: '(Timestamp.now())' }
    console.log(JSON.stringify(displayDoc, null, 2))
    console.log()
    console.log('[dry-run] 書き込みは行いませんでした。')
    console.log('実行: node scripts/provision-member.mjs --add-noauth --name=... [--role=member] --execute')
    console.log('\n⚠️  --execute は 🔴RED 操作。航也のGOサインを必ずもらうこと。')
    console.log('\n--- メール取得後の Auth 化導線 ---')
    console.log('  1. Firebase Console で users/{docId} に email フィールドを手動追加')
    console.log('  2. node scripts/provision-member.mjs --sync-all')
    console.log('     → Auth 発行・voice_profiles 作成・employmentType 付与を自動実行')
    return
  }

  await newDocRef.set(userDoc)
  console.log(`✓ users/${newDocId} 作成（noAuth 業務委託メンバー）`)
  console.log()
  console.log('✅ noAuth メンバー登録完了。')
  console.log(`  docId: ${newDocId}`)
  console.log(`  name:  ${ADD_NAME}`)
  console.log()
  console.log('--- メール取得後の Auth 化導線 ---')
  console.log('  1. Firebase Console で users/{docId} に email フィールドを手動追加')
  console.log(`     https://console.firebase.google.com/project/${PROJECT_ID}/firestore/data/users/${newDocId}`)
  console.log('  2. node scripts/provision-member.mjs --sync-all')
  console.log('     → Auth 発行（既存 uid を引き継いで過去データ無傷）・voice_profiles 作成まで自動実行')
  console.log('  3. Auth 発行後は「パスワードを忘れた方」からPWリセットを本人に案内')
}

// ===== エントリーポイント ========================================================

console.log('=== provision-member.mjs — regalcast-app アカウント基盤刷新 Phase 1 ===\n')

try {
  if (MODE_SYNC)      await runSyncAll()
  if (MODE_REPAIR)    await runRepair()
  if (MODE_ADD)       await runAdd()
  if (MODE_ADD_NOAUTH) await runAddNoAuth()
} catch (err) {
  console.error('\n❌ 予期しないエラーが発生しました:', err.message)
  if (err.stack) console.error(err.stack)
  process.exit(1)
}

process.exit(0)
