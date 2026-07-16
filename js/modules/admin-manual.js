// ============================================================
// Admin Manual — 管理者マニュアルモジュール（admin 専用）
// ============================================================

let _loaded = false;

// ── ヘルパー（HTML断片を返す関数群） ─────────────────────────

function section(id, icon, title, content, openByDefault) {
  return `
<details ${openByDefault ? 'open' : ''} style="margin-bottom:10px;border:1px solid var(--border);border-radius:10px;overflow:hidden">
  <summary id="${id}" style="padding:14px 16px;cursor:pointer;font-size:13px;font-weight:700;background:var(--surface);display:flex;align-items:center;gap:10px;list-style:none;-webkit-appearance:none;user-select:none">
    <span style="font-size:17px">${icon}</span>
    <span>${title}</span>
    <span style="margin-left:auto;font-size:10px;color:var(--ink3);font-weight:400">▾</span>
  </summary>
  <div style="padding:16px;border-top:1px solid var(--border);background:var(--surface)">
    ${content}
  </div>
</details>`;
}

function step(num, title, desc) {
  return `
<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:12px">
  <div style="width:22px;height:22px;border-radius:50%;background:var(--ink);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">${num}</div>
  <div style="flex:1">
    <div style="font-size:12px;font-weight:700;margin-bottom:3px">${title}</div>
    <div style="font-size:12px;color:var(--ink2);line-height:1.7">${desc}</div>
  </div>
</div>`;
}

function noteWarn(text) {
  return `<div style="background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.22);border-radius:6px;padding:10px 13px;font-size:12px;color:#b91c1c;margin:10px 0;line-height:1.7">${text}</div>`;
}

function noteInfo(text) {
  return `<div style="background:rgba(37,99,235,.06);border:1px solid rgba(37,99,235,.22);border-radius:6px;padding:10px 13px;font-size:12px;color:var(--blue);margin:10px 0;line-height:1.7">${text}</div>`;
}

function noteOk(text) {
  return `<div style="background:rgba(5,150,105,.07);border:1px solid rgba(5,150,105,.22);border-radius:6px;padding:10px 13px;font-size:12px;color:var(--accent2);margin:10px 0;line-height:1.7">${text}</div>`;
}

function subHeading(text) {
  return `<div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.5px;margin-top:16px;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid var(--border)">${text}</div>`;
}

function errCard(stepNum, title, detail, action) {
  return `
<div style="border:1px solid rgba(239,68,68,.18);border-radius:8px;padding:11px 13px;margin-bottom:8px;background:rgba(239,68,68,.025)">
  <div style="font-size:10px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px">Step ${stepNum} 失敗</div>
  <div style="font-size:12px;font-weight:600;margin-bottom:4px">${title}</div>
  ${detail ? `<div style="font-size:11px;color:var(--ink2);font-family:'DM Mono',monospace;background:var(--surface2);padding:4px 8px;border-radius:4px;margin-bottom:6px;word-break:break-all">${detail}</div>` : ''}
  <div style="font-size:11px;color:var(--ink2);line-height:1.6"><strong>対処法：</strong>${action}</div>
</div>`;
}

// ── A. 入社処理 ───────────────────────────────────────────────

function buildSectionA() {
  return `
${step(1, 'フォームURLを発行する',
  '「管理」タブグループ →「📋 入社手続き」タブ（モバイル：ナビ下部の「入社」ボタン）を開く。<br>' +
  '・<strong>個別発行</strong>：「🔗 新規入社フォームを発行」ボタン → 採用予定者の名前を入力 → URLをコピーして本人にLINE/メールで送る<br>' +
  '・<strong>一括発行</strong>：「📋 一括URL発行」ボタン → フォーム未発行・未提出の全メンバーに一括発行 → URLリストをコピーして各自に送る'
)}
${step(2, '提出されたことを確認する',
  '「管理」→「📬 入社フォーム確認」タブ（モバイル：「入社フォーム」）を開く。<br>' +
  'フォームが提出されると「🆕 未処理」タブに表示され、ナビバーに件数バッジも出る。'
)}
${step(3, 'アカウントを作成する',
  '一覧の「✅ アカウント作成」ボタン、または「📄 詳細を見る」→「✅ 承認 &amp; アカウント作成」ボタンをクリック。<br>' +
  '確認ダイアログの「OK」を押すと4段階で処理が走り、完了後に<strong>パスワード設定メールが本人に自動送信</strong>される。'
)}

${noteInfo('📧 差出人は <strong>noreply@regalcast-app.firebaseapp.com</strong> になるため迷惑メールに入りやすい。採用予定者には「迷惑メールフォルダも確認してください」と事前案内すること。')}

${subHeading('⛔ 二重実行ブロック')}
<p style="font-size:12px;color:var(--ink2);line-height:1.7;margin-bottom:12px">
  すでにアカウントが作成済みの場合は「このアカウントはすでに作成済みです。パスワード設定メールを再送したい場合は〈📧 パスワード設定メール再送〉ボタンを使ってください。」が表示されてブロックされる。
  再送のみが必要な場合は下の「パスワード設定メールを再送する」を参照。
</p>

${subHeading('⚠ エラーが出たときの対処（4段階）')}
${errCard(1, 'auth/email-already-in-use', 'このメールアドレスはすでにAuthアカウントが存在します', '「🔗 既存アカウントに紐づける」ボタンで既存アカウントに手動紐づけする')}
${errCard(1, 'Authアカウント作成（その他エラー）', '', '時間をおいて再試行する')}
${errCard(2, 'Firestoreへのメンバーデータ登録失敗', 'Authアカウントは作成済みだが users ドキュメントがない', '「🔗 既存アカウントに紐づける」でこのフォームを既存アカウントに手動紐づけする')}
${errCard(3, 'form_submissions 更新失敗', 'アカウント・メンバーデータは作成済みだが提出記録の更新に失敗', '「🔗 既存アカウントに紐づける」で手動紐づけする')}
${errCard(4, 'パスワード設定メール送信失敗', 'アカウント作成は完了。メール送信のみ失敗', '「📧 パスワード設定メール再送」ボタンで手動再送する')}

${subHeading('📧 パスワード設定メールを再送する')}
<p style="font-size:12px;color:var(--ink2);line-height:1.7;margin-bottom:6px">「📧 パスワード設定メール再送」ボタンは以下の<strong>3箇所</strong>にある：</p>
<ul style="font-size:12px;color:var(--ink2);padding-left:18px;line-height:2;margin-bottom:8px">
  <li>「📬 入社フォーム確認」一覧のアカウント作成済み行（アクションボタン列）</li>
  <li>「📄 詳細を見る」モーダル内のボタン</li>
  <li>「📨 報告確認」→「📋 入社フォーム」カテゴリの各カード</li>
</ul>
<p style="font-size:12px;color:var(--ink2);line-height:1.7">本人がメールを受け取れなかった・迷惑メールに入っていた・削除してしまった場合に使う。</p>
`;
}

// ── B. 退職処理 ───────────────────────────────────────────────

function buildSectionB() {
  return `
${step(1, '退職手続き管理を開く',
  '「管理」タブグループ →「🚪 退職手続き」タブ（モバイル：「退職」ボタン）を開く。'
)}
${step(2, '対象者をクリック',
  '一覧から対象メンバーの行をクリックして詳細モーダルを開く。'
)}
${step(3, '退職届URLの発行（任意）',
  '本人に退職届フォームを記入させる場合は「🔗 退職届URLを発行する」ボタンでURLを発行してLINE/メールで送る。<br>' +
  '記入不要の場合はスキップ可。'
)}
${step(4, '退職完了にマークして保存',
  '「✅ 退職手続きをすべて完了としてマークする」チェックボックスをONにして「保存」ボタンをクリック。<br>' +
  '保存すると Firestore の <code style="background:var(--surface2);padding:1px 5px;border-radius:3px">users/{uid}.isRetired</code> が <strong>true</strong> に設定される。'
)}

${subHeading('退職完了後の効果（isRetired: true）')}
<ul style="font-size:12px;color:var(--ink2);padding-left:18px;line-height:2;margin-bottom:6px">
  <li>「👥 メンバー管理」の通常一覧から非表示になる（「退職者を表示」チェックで再表示可）</li>
  <li>勤怠表・メンタル天気のメンバーフィルターから除外される</li>
  <li>RegalVoice（社内SNS）のメンバー一覧からも非表示になる</li>
</ul>

${noteWarn('⚠️ <strong>重要な仕様</strong>：退職処理（isRetired フラグ変更）だけでは Firebase Auth へのログインは止まらない。本人のログインを確実に無効化するには続けて「C. アカウントの停止」を実施すること。')}
`;
}

// ── C. アカウントの停止（退職・業務委託終了時） ────────────────

function buildSectionC() {
  return `
<p style="font-size:12px;color:var(--ink2);line-height:1.7;margin-bottom:14px">
  退職処理（B）の <strong>isRetired フラグはFirestoreのデータのみを変更</strong>する。Firebase Auth のログイン制御とは連動していないため、isRetired を立てただけでは退職者はアプリにログインし続けることができる。<br><br>
  ログインを確実に止めるには Firebase Console で Auth アカウントを直接無効化する。<strong>社員の退職・業務委託の契約終了どちらも操作は同じ。</strong>
</p>

${subHeading('推奨フロー（3ステップ）')}
${step(1, 'アプリで退職処理を行う（B の手順）',
  'isRetired を true にして各アプリのリストから除外する。'
)}
${step(2, 'Firebase Console で Auth アカウントを無効化する',
  '<a href="https://console.firebase.google.com/project/regalcast-app/authentication/users" target="_blank" style="color:var(--blue);font-weight:600">Firebase Console → Authentication → Users</a>（上記URLをクリック） を開く。<br>' +
  '① 検索ボックスに退職者のメールアドレスを入力<br>' +
  '② 該当ユーザーを見つけて行末の「…」メニューをクリック<br>' +
  '③「アカウントを無効にする」を選択して確認<br>' +
  '→ これで当該アカウントはログインできなくなる。'
)}
${step(3, '（任意）健康診断を依頼する',
  'Auth と退職者データの不整合が心配な場合は FORGE/開発チームに「<code style="background:var(--surface2);padding:1px 5px;border-radius:3px">--repair</code> で退職者の Auth 残りを確認してください」と依頼する。<br>' +
  'コマンドの詳細は <code style="background:var(--surface2);padding:1px 5px;border-radius:3px">scripts/README.md</code> を参照。'
)}

${noteOk('💡 業務委託（contractor）の契約終了も手順はまったく同じ。employmentType に関わらず Firebase Console での Auth 無効化がログイン遮断の唯一の確実な方法。')}
`;
}

// ── D. 入店・退店（勤怠データ）の管理 ────────────────────────

function buildSectionD() {
  return `
${subHeading('データ構造')}
<div style="background:var(--surface2);border-radius:6px;padding:10px 13px;font-size:12px;color:var(--ink2);margin-bottom:14px;line-height:1.9">
  コレクション：<code style="font-family:'DM Mono',monospace">attendance</code><br>
  ドキュメントID：<code style="font-family:'DM Mono',monospace">{uid}_{YYYY-MM-DD}</code>（1人1日1レコード）<br>
  主なフィールド：clockIn（入店時刻）、clockOut（退店時刻）、mentalWeather（メンタル天気）、<br>
  &emsp;fare（出勤/退勤/その他交通費）、fareStationFrom/To（乗降駅）、note（メモ）、location（位置情報）
</div>

${subHeading('管理画面での見方')}
<ul style="font-size:12px;color:var(--ink2);padding-left:18px;line-height:2;margin-bottom:14px">
  <li>「勤怠」タブグループ →「📋 勤怠表」タブ（モバイル：「勤怠表」ボタン）を開く</li>
  <li>対象月を選択して「🔄 更新」ボタンをクリック</li>
  <li>メンバーフィルター（管理者は全員・個人指定が可能）</li>
  <li>「🚨 漏れ全件」フィルターで入店/退店漏れのレコードだけを一覧表示できる</li>
</ul>

${subHeading('RegalVoice（社内SNS）との連携')}
<p style="font-size:12px;color:var(--ink2);line-height:1.7;margin-bottom:14px">
  社内SNS「RegalVoice」からも入店・退店・出発を記録できる。どちらで記録しても同じ Firestore ドキュメント（<code style="background:var(--surface2);padding:1px 5px;border-radius:3px">attendance/{uid}_{日付}</code>）に書き込まれるため、<strong>二重記録にはならない</strong>。
</p>

${subHeading('修正が必要な時')}
<ul style="font-size:12px;color:var(--ink2);padding-left:18px;line-height:2">
  <li>「📋 勤怠表」タブ → 対象レコードの行末「修正」ボタン（管理者のみ表示）をクリック</li>
  <li>モーダルで入店/退店時刻・交通費・シフト時間等を編集して「保存」</li>
  <li>退勤漏れは「🚨 漏れ全件」フィルターから「修正する」ボタンが表示される</li>
  <li>修正機能がない場合は FORGE/開発チームに依頼する</li>
</ul>
`;
}

// ── E. 一括整備（管理者向け上級） ────────────────────────────

function buildSectionE() {
  return `
<p style="font-size:12px;color:var(--ink2);line-height:1.7;margin-bottom:12px">
  <code style="background:var(--surface2);padding:2px 6px;border-radius:4px;font-size:11px">scripts/provision-member.mjs</code> は新メンバー発行後に全アプリのプロフィール（Firestore の users / voice_profiles / trainingProfiles）を一括整備したり、Auth と Firestore の不整合を検出したりするスクリプト。<strong>実行は FORGE/開発チームに依頼する運用</strong>とすること。
</p>

${subHeading('主なモード')}
<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">
  <div style="border:1px solid var(--border);border-radius:6px;padding:10px 12px">
    <div style="font-size:11px;font-weight:700;color:var(--blue);margin-bottom:3px">--sync-all（全メンバー一括整備）</div>
    <div style="font-size:11px;color:var(--ink2);line-height:1.7">全メンバーの employmentType 補完・Auth 未発行者への Auth 発行・voice_profiles 作成などを冪等に実行。新メンバーの初期設定が1コマンドで完了する。</div>
  </div>
  <div style="border:1px solid var(--border);border-radius:6px;padding:10px 12px">
    <div style="font-size:11px;font-weight:700;color:var(--warn);margin-bottom:3px">--repair（健康診断）</div>
    <div style="font-size:11px;color:var(--ink2);line-height:1.7">書き込みなし。Auth・Firestore の不整合（メールアドレス不一致・Auth 未発行・孤立 Auth アカウント等）を検出してレポートする。</div>
  </div>
  <div style="border:1px solid var(--border);border-radius:6px;padding:10px 12px">
    <div style="font-size:11px;font-weight:700;color:var(--accent2);margin-bottom:3px">--add（新規1名を一括作成）</div>
    <div style="font-size:11px;color:var(--ink2);line-height:1.7">Auth・users・voice_profiles を一括作成。入社フォーム経由を使わない場合の代替手段。</div>
  </div>
</div>

${noteWarn('🔴 <code style="font-size:10px">--execute</code> フラグを付けた実行は FORGE/開発チームへ依頼すること。詳細なコマンドは <code style="font-size:10px">scripts/README.md</code> を参照。')}
`;
}

// ── マニュアル全体 HTML を組み立て ────────────────────────────

function buildManualHtml() {
  return `
<div style="max-width:760px;margin:0 auto;padding:0 0 48px">
  <div style="margin-bottom:20px">
    <div class="section-title" style="margin:0">📖 管理者マニュアル</div>
    <div style="font-size:11px;color:var(--ink3);margin-top:4px">管理者（admin）専用 &mdash; 最終更新: 2026-07-16</div>
  </div>
  ${section('manual-a', '✅', 'A. 入社処理（アカウント発行）', buildSectionA(), true)}
  ${section('manual-b', '🚪', 'B. 退職処理', buildSectionB())}
  ${section('manual-c', '🔒', 'C. アカウントの停止（退職・業務委託終了時）', buildSectionC())}
  ${section('manual-d', '📍', 'D. 入店・退店（勤怠データ）の管理', buildSectionD())}
  ${section('manual-e', '⚙', 'E. 一括整備（管理者向け上級）', buildSectionE())}
</div>
`;
}

// ── 公開 API ──────────────────────────────────────────────────

export function loadAdminManual() {
  if (_loaded) return;
  _loaded = true;
  const html = buildManualHtml();
  const pcView = document.getElementById('view-admin-manual');
  const mView  = document.getElementById('m-view-admin-manual');
  if (pcView) pcView.innerHTML = html;
  if (mView)  mView.innerHTML  = html;
}

window.loadAdminManual = loadAdminManual;
