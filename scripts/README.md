# regalcast-management スクリプト

## セットアップ（初回のみ）

```bash
# ADC 認証（必須）
gcloud auth application-default login
gcloud auth application-default set-quota-project regalcast-app

# 依存パッケージ（firebase-admin）インストール
cd scripts
npm install
cd ..
```

---

## provision-member.mjs — アカウント基盤刷新 Phase 1

**設計の核**: Firebase Admin SDK は uid を指定して Auth を作成できる。既存 users の uid をそのまま Auth uid として発行 = attendance/shifts/給与の過去データが1件も壊れない。

### モード1: --sync-all（全メンバー一括整備）

```bash
# dry-run（何が起きるかを一覧表示）
node scripts/provision-member.mjs --sync-all

# 実行（🔴RED: 航也のGOサイン必須）
node scripts/provision-member.mjs --sync-all --execute
```

各メンバーに対して以下を冪等に実行:
1. `employmentType` 追加（isAlliance/noAuth → 'contractor'、それ以外 → 'employee'。既存値があればスキップ）
2. Auth 未発行かつメールあり・非退職 → `createUser({ uid: 既存docId, email })` で Auth 発行
3. `trainingProfiles` の `displayName` が空なら `users.name` で update（新規作成しない）
4. `voice_profiles` が未作成なら作成、displayName が空なら update（既存 doc は update のみ。followerCount 保護）

メールなし・退職者は SKIP して SKIP 理由一覧を最後に表示。

### モード2: --repair（中途半端状態の検出）

```bash
node scripts/provision-member.mjs --repair
```

書き込みなし。以下を検出してレポート:
- Auth にいるが users にいない
- users にいてメールあり・非退職なのに Auth にいない
- メールアドレスの食い違い（Auth vs Firestore）
- メールなし（当面 Auth 発行不可）

Auth の削除・無効化は絶対に行わない。

### モード3: --add（新規1名を一括作成）

```bash
# dry-run
node scripts/provision-member.mjs --add --email=foo@example.com --name="山田太郎" --type=employee

# contractor（業務委託）
node scripts/provision-member.mjs --add --email=foo@example.com --name="山田花子" --type=contractor --role=member

# 実行（🔴RED: 航也のGOサイン必須）
node scripts/provision-member.mjs --add --email=foo@example.com --name="山田太郎" --type=employee --execute
```

Auth（uid 自動生成）→ users/{authUid} → voice_profiles/{authUid} を一括作成。
trainingProfiles は作成しない（研修対象は研修アプリで追加する運用）。

---

### モード4: --add-noauth（メールなし業務委託の users 登録）

メールアドレスが未収集の業務委託（外部アライアンス）を users のみに登録する。
**Auth/voice_profiles は作らない。** メール取得後に `--sync-all` で Auth 化する導線。

```bash
# dry-run（デフォルト）
node scripts/provision-member.mjs --add-noauth --name="山田花子"

# role 指定あり
node scripts/provision-member.mjs --add-noauth --name="山田花子" --role=member

# 実行（🔴RED: 航也のGOサイン必須）
node scripts/provision-member.mjs --add-noauth --name="山田花子" --execute
```

作成される users ドキュメント（docId は自動生成）:

| フィールド | 値 |
|---|---|
| name | 指定した氏名 |
| role | 指定（デフォルト: `member`） |
| employmentType | `'contractor'` |
| isAlliance | `true`（後方互換フラグ） |
| noAuth | `true`（Auth 未発行を明示） |
| createdAt | Timestamp |

**Auth 化の導線（メール取得後）:**
1. Firebase Console で `users/{docId}` に `email` フィールドを手動追加
2. `node scripts/provision-member.mjs --sync-all` を実行
   → Auth 発行（既存 docId を uid として引き継ぎ = 過去データ無傷）・voice_profiles 作成まで自動実行
3. Auth 発行後は「パスワードを忘れた方」から本人にPWリセットを案内

---

## その他のスクリプト

| ファイル | 用途 |
|---|---|
| `debug_daily.mjs` | 当日確認リストに出ない原因の調査 |
| `fix_alliance_flag.mjs` | isAlliance フラグの修正 |
| `seed_gantt.mjs` | gantt_data.json を Firestore に投入 |
| `update_gantt_example.mjs` | gantt サンプルデータ更新 |
