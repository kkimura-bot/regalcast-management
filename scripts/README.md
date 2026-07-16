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

## その他のスクリプト

| ファイル | 用途 |
|---|---|
| `debug_daily.mjs` | 当日確認リストに出ない原因の調査 |
| `fix_alliance_flag.mjs` | isAlliance フラグの修正 |
| `seed_gantt.mjs` | gantt_data.json を Firestore に投入 |
| `update_gantt_example.mjs` | gantt サンプルデータ更新 |
