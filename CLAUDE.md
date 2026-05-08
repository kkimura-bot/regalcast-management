@/Users/koyakimura/projects/regalcast-ai/CLAUDE.md

# 入店退店管理アプリ — デプロイルール

## ⚠️ 絶対厳守：デプロイ手順

**このアプリはFirebase Hostingで運用している。コード変更後は必ず以下の2ステップを実行すること。**

### ステップ1: GitHubにpush
```bash
cd /Users/koyakimura/projects/regalcast-ai/agents/forge/outputs/入店退店管理アプリ-v2
git add -A
git commit -m "変更内容"
git push
```

### ステップ2: Firebase Hostingにデプロイ（絶対忘れるな）
```bash
npx firebase deploy --only hosting
```

**GitHubにpushしただけでは本番に反映されない！必ずFirebase Hostingへのデプロイも実行すること。**

Firebase Functionsを変更した場合は追加で：
```bash
npx firebase deploy --only functions
```

## 本番URL
- https://management.regalcast.co.jp（Firebase Hosting）
- https://regalcast-app.web.app（Firebase Hosting 確認用）

## 技術スタック
- 静的HTML + JavaScript（モジュール形式）
- Firebase Auth + Firestore + Storage + Cloud Functions
- Firebase Hosting

## デプロイ時の認証エラーが出たら
```bash
npx firebase login --reauth
```
