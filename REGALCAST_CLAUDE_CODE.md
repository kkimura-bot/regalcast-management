# RegalCast Management System — Claude Code 引き継ぎドキュメント

## プロジェクト概要

株式会社RegalCastの社内向けスタッフ管理システム。
出退勤・シフト・勤怠・給与・メンタル状態を一元管理。

---

## 技術スタック

| 項目 | 内容 |
|---|---|
| フロントエンド | 素のHTML/CSS/JavaScript（ES Modules） |
| バックエンド | Firebase Firestore + Firebase Auth |
| ホスティング | Netlify |
| Firebase Project ID | `regalcast-app` |
| 本番URL | `https://regalcast-management.netlify.app/` |

---

## 権限ロール

| ロール | 説明 |
|---|---|
| `admin` | 全機能アクセス可 |
| `leader` | 部署管理・勤怠確認 |
| `member` | 自分の出退勤・シフト確認 |
| `委託` (alliance) | 出退勤のみ（パスワードなしログイン） |

---

## Firestoreコレクション構造

### users
```
{
  uid: string,
  name: string,
  role: "admin" | "leader" | "member" | "委託",
  dept: string,           // 部署名
  email: string,
  nearestStation: string, // 最寄駅
  fareTemplates: [...],   // 交通費テンプレート
  noAuth: boolean,        // 委託フラグ
}
```

### attendance
```
{
  uid: string,
  name: string,
  date: "YYYY-MM-DD",
  clockIn: ISO8601,       // 出勤打刻（生データ）
  clockOut: ISO8601,      // 退勤打刻（生データ）
  breakMinutes: number,   // 休憩時間（分）デフォルト60
  shiftStart: "HH:MM",    // シフト開始（突合後）
  shiftEnd: "HH:MM",      // シフト終了（突合後）
  fare: number,           // 交通費合計
  mentalWeather: string,  // メンタル天気（必須）
  isEarly: boolean,       // 早退フラグ
  isEarlyLeave: boolean,  // 早退フラグ（別名）
  absent: boolean,        // 欠勤フラグ
  missedClockIn: boolean, // 入店報告漏れ
  missedClockOut: boolean,// 退店報告漏れ
  approvedOvertimeMinutes: number, // 承認済み残業（分）
  overtimePendingMinutes: number,  // 申請中残業（分）
}
```

### shifts
```
{
  uid: string,
  name: string,
  date: "YYYY-MM-DD",
  month: "YYYY-MM",
  startTime: "HH:MM",
  endTime: "HH:MM",
  location: string,   // 勤務場所
  type: "work" | "off",
  approved: boolean,  // 希望休承認フラグ
}
```

### overtimeRequests
```
{
  uid: string,
  name: string,
  date: "YYYY-MM-DD",
  minutes: number,        // 申請残業時間（15分単位・上限120分）
  reason: string,         // 残業理由（必須）
  hasShift: boolean,      // シフトあり/なし
  status: "pending" | "approved" | "rejected",
  approvedBy: string,
  approvedAt: ISO8601,
  createdAt: ISO8601,
}
```

### meetingRequests（メンバー→管理者）
```
{ uid, name, message, status: "pending" | "confirmed" }
```

### adminMeetingRequests（管理者→メンバー）
```
{ targetUid, adminName, category, message, status: "unread" | "read" }
```

### error_reports
```
{ reporter, type, detail, status: "未対応" | "対応済" }
```

### shops
```
{ name, defaultStart, defaultEnd }
```

---

## 勤務時間の計算ロジック（重要）

```javascript
function calcHours(r) {
  const breakM = r.breakMinutes ?? 60; // 未設定はデフォルト60分

  // 欠勤 → null
  if (r.absent) return null;

  // 早退 → 打刻ベース（実働時間）
  if ((r.isEarly || r.isEarlyLeave) && r.clockIn && r.clockOut) {
    const rawH = (new Date(r.clockOut) - new Date(r.clockIn)) / 3600000;
    const shiftM = Math.max(0, rawH * 60 - breakM);
    return (shiftM + (r.approvedOvertimeMinutes || 0)) / 60 || null;
  }

  // 通常 → シフトベース（MF整合）
  if (r.shiftStart && r.shiftEnd) {
    const [sh,sm] = r.shiftStart.split(':').map(Number);
    const [eh,em] = r.shiftEnd.split(':').map(Number);
    const shiftM = Math.max(0, (eh*60+em) - (sh*60+sm) - breakM);
    return (shiftM + (r.approvedOvertimeMinutes || 0)) / 60 || null;
  }

  // シフト情報なし → 打刻ベースfallback
  if (r.clockIn && r.clockOut) {
    const rawH = (new Date(r.clockOut) - new Date(r.clockIn)) / 3600000;
    const shiftM = Math.max(0, rawH * 60 - breakM);
    return (shiftM + (r.approvedOvertimeMinutes || 0)) / 60 || null;
  }

  return null;
}
```

## 時刻の丸め表示ルール

- **入店時刻**: 15分単位で**切り上げ**（打刻生データは保持）
  - 例: 10:03 → 10:15
- **退勤時刻**: 15分単位で**切り捨て**（打刻生データは保持）
  - 例: 18:47 → 18:45
- CSVエクスポート・編集モーダルは生データをそのまま使用

## 残業申請ルール

- 15分単位・上限2時間（120分）
- 退勤後に申請ボタンが表示（全ロール対象）
- 管理者がダッシュボードから承認/却下
- 承認後にattendance.approvedOvertimeMinutesに記録
- 申請中はattendance.overtimePendingMinutesに記録

---

## 表示制御（非表示タブ）

以下のタブは現在非表示（data-roles=""）。データは保持。
- PJ管理（projects）
- タスク管理（tasks）

---

## シフトと勤怠の突合ロジック

loadMonthlyAttendanceで当月シフトを取得し、
attendance.shiftStart/shiftEndが未設定のレコードに補完する。

**同日に複数シフトがある場合は最長のシフトを優先。**

```javascript
const shiftDuration = (s) => {
  const [sh,sm] = s.startTime.split(':').map(Number);
  const [eh,em] = s.endTime.split(':').map(Number);
  return (eh*60+em) - (sh*60+sm);
};
// 既存より長ければ上書き
if (!shiftMap[key] || shiftDuration(s) > shiftDuration(shiftMap[key])) {
  shiftMap[key] = s;
}
```

---

## 移行時の注意事項

1. **Firebaseの認証ドメイン設定**
   - Firebase Console → Authentication → Settings → Authorized domains
   - 新しいNetlifyのドメインを追加すること

2. **環境変数**
   - Firebase APIキー等は現在HTMLにハードコード
   - 移行時は `.env` ファイルに分離することを推奨

3. **委託スタッフ（alliance）のUID形式**
   - `alliance_[timestamp]_[random5文字]` の形式
   - パスワードなしで名前選択ログイン

4. **Firestoreインデックス**
   - `!=` 演算子は複合インデックスが必要なため使用禁止
   - 全件取得してJavaScript側でフィルタすること

5. **クールダウン設定**
   - ダッシュボード: 手動更新のみ
   - 当日確認: 5分クールダウン
   - 勤怠表: 15分クールダウン

---

## メンタル天気の種類

| 値 | アイコン |
|---|---|
| 快晴 | ☀️ |
| 曇り | ☁️ |
| 雨 | 🌧 |
| 豪雨 | ⛈ |
| 雷 | 🌩 |
| 嵐 | 🌀 |
| 天災 | 🔥 |

出勤打刻時に選択必須。

---

## 現在のバージョン

- 最新: v126
- ファイル: RegalCast_App_v126.html
- 行数: 約10,000行
