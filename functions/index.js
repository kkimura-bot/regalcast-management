const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp }  = require('firebase-admin/app');
const { getFirestore }   = require('firebase-admin/firestore');
const { getAuth }        = require('firebase-admin/auth');
const nodemailer         = require('nodemailer');

initializeApp();
const db = getFirestore();

// ── Auth ユーザー削除 ─────────────────────────────────────
// 管理者がスタッフを削除する際にFirebase AuthアカウントもAdmin SDKで削除する

exports.deleteAuthUser = onCall(
  { invoker: 'public' },
  async (request) => {
    // ── 認証チェック ──────────────────────────────────────
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '認証が必要です');
    }

    const callerUid = request.auth.uid;
    const { uid } = request.data || {};

    if (typeof uid !== 'string' || !uid) {
      throw new HttpsError('invalid-argument', 'uid（string）が必要です');
    }

    // ── 安全弁: 自分自身の削除不可 ───────────────────────
    if (uid === callerUid) {
      throw new HttpsError('invalid-argument', '自分自身を削除することはできません');
    }

    // ── 権限チェック: 呼び出し元が admin か ──────────────
    const callerSnap = await db.doc(`users/${callerUid}`).get();
    if (!callerSnap.exists || callerSnap.data()?.role !== 'admin') {
      throw new HttpsError('permission-denied', '管理者のみ実行できます');
    }

    try {
      await getAuth().deleteUser(uid);
      return { success: true };
    } catch (e) {
      // Auth上に存在しない場合（noAuthユーザー等）はエラーを無視して成功扱い
      if (e.code === 'auth/user-not-found') return { success: true };
      throw e;
    }
  }
);

// ── アカウント停止 / 再開 ──────────────────────────────────
// 管理者がスタッフの Auth アカウントを一時停止・再開する
// 入力: { targetUid: string, disabled: boolean }

exports.adminSetUserDisabled = onCall(
  { invoker: 'public' },
  async (request) => {
    // ── 認証チェック ──────────────────────────────────────
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '認証が必要です');
    }

    const callerUid = request.auth.uid;
    const { targetUid, disabled } = request.data || {};

    // ── 入力バリデーション ────────────────────────────────
    if (typeof targetUid !== 'string' || !targetUid) {
      throw new HttpsError('invalid-argument', 'targetUid（string）が必要です');
    }
    if (typeof disabled !== 'boolean') {
      throw new HttpsError('invalid-argument', 'disabled（boolean）が必要です');
    }

    // ── 安全弁: 自分自身を停止不可 ───────────────────────
    if (targetUid === callerUid) {
      throw new HttpsError('invalid-argument', '自分自身を停止/再開することはできません');
    }

    // ── 権限チェック: 呼び出し元が admin か ──────────────
    const callerSnap = await db.doc(`users/${callerUid}`).get();
    if (!callerSnap.exists || callerSnap.data()?.role !== 'admin') {
      throw new HttpsError('permission-denied', '管理者のみ実行できます');
    }

    // ── 対象ユーザー存在チェック ──────────────────────────
    const targetSnap = await db.doc(`users/${targetUid}`).get();
    if (!targetSnap.exists) {
      throw new HttpsError('not-found', '対象ユーザーが見つかりません');
    }

    // ── 対象が admin なら操作不可 ─────────────────────────
    if (targetSnap.data()?.role === 'admin') {
      throw new HttpsError('permission-denied', '管理者アカウントは停止できません。先にロールを変更してください');
    }

    // ── Auth 更新 ─────────────────────────────────────────
    await getAuth().updateUser(targetUid, { disabled });

    // ── Firestore 更新（アプリ表示用）────────────────────
    await db.doc(`users/${targetUid}`).update({
      authDisabled:   disabled,
      authDisabledAt: new Date(),
      authDisabledBy: callerUid,
    });

    // ── 監査ログ（構造化）────────────────────────────────
    // 新コレクションは作らない（共有PJのwildcardルール下での改ざんリスク回避）
    console.log(JSON.stringify({
      who:    callerUid,
      target: targetUid,
      action: disabled ? 'disable_auth' : 'enable_auth',
      at:     new Date().toISOString(),
    }));

    return { success: true };
  }
);

// ── Gemini API プロキシ ────────────────────────────────────
// GEMINI_API_KEY を安全にサーバーサイドで保持するためのプロキシ

exports.geminiProxy = onCall(
  {},
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new HttpsError('internal', 'GEMINI_API_KEY not set');
    }

    const { contents, systemInstruction } = request.data || {};
    if (!contents) {
      throw new HttpsError('invalid-argument', 'contents required');
    }

    const payload = { contents };
    if (systemInstruction) payload.systemInstruction = systemInstruction;

    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    const data = await upstream.json();
    return data;
  }
);

// ── 日付・時刻ヘルパー（JST） ─────────────────────────────

function todayJST() {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  return jst.toISOString().slice(0, 10); // YYYY-MM-DD
}

function nowHHMM() {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  return jst.toISOString().slice(11, 16); // HH:MM
}

// 休みとみなすシフト名のキーワード
const SHIFT_OFF_WORDS = [
  '休', 'off', 'OFF', 'Off', '公休', '休み', '非番', '振休', '有休', '有給', '代休', '-', '—', '×'
];

function isOffShift(shift) {
  if (!shift.startTime || !shift.endTime) return true;
  const name = shift.name || '';
  return SHIFT_OFF_WORDS.some(w => name === w || name.includes(w));
}

// ── メール送信 ────────────────────────────────────────────

function createTransporter(gmailUser, gmailPass) {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: gmailUser, pass: gmailPass },
  });
}

async function sendMail(transporter, from, to, subject, text) {
  try {
    await transporter.sendMail({ from, to, subject, text });
    console.log(`✅ メール送信: ${to} → ${subject}`);
  } catch (e) {
    console.error(`❌ メール送信失敗: ${to}`, e.message);
  }
}

// ── メイン処理 ────────────────────────────────────────────

exports.checkAttendanceNotifications = onSchedule(
  { schedule: 'every 30 minutes', timeZone: 'Asia/Tokyo' },
  async () => {
    // 通知設定を取得
    const settingsSnap = await db.doc('settings/notifications').get();
    const settings = settingsSnap.data();
    if (!settings?.enabled) {
      console.log('通知設定が無効です');
      return;
    }

    const { gmailUser, gmailPass } = settings;
    if (!gmailUser || !gmailPass) {
      console.log('Gmail設定が未入力です');
      return;
    }

    const today   = todayJST();
    const nowTime = nowHHMM();
    console.log(`実行: ${today} ${nowTime}`);

    // 今日の通知ログ（重複送信防止）
    const logRef  = db.doc(`notification_logs/${today}`);
    const logSnap = await logRef.get();
    const log     = logSnap.data() || {};
    const clockInLog  = log.clockIn  || {};  // { uid: true }
    const clockOutLog = log.clockOut || {};  // { uid: true }

    const transporter = createTransporter(gmailUser, gmailPass);
    const fromAddr    = `RegalCast <${gmailUser}>`;

    // 今日のシフトを全件取得
    const shiftsSnap = await db.collection('shifts')
      .where('date', '==', today).get();
    const shifts = shiftsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 休みシフトを除外
    const workShifts = shifts.filter(s => s.uid && !isOffShift(s));
    console.log(`本日の出勤シフト: ${workShifts.length}件`);

    const clockInUpdates  = {};
    const clockOutUpdates = {};

    for (const shift of workShifts) {
      const { uid, startTime, endTime } = shift;

      // ユーザー情報取得（キャッシュしたいが簡易実装でok）
      const userSnap = await db.doc(`users/${uid}`).get();
      const user = userSnap.data();
      if (!user?.email) continue;

      // 勤怠記録取得
      const attSnap = await db.doc(`attendance/${uid}_${today}`).get();
      const att = attSnap.exists ? attSnap.data() : null;

      // ── 入店チェック ──────────────────────────────────
      // シフト開始時刻を過ぎていて、clockIn がなく、まだ通知していない
      if (startTime && nowTime >= startTime && !clockInLog[uid] && !(att?.clockIn)) {
        await sendMail(
          transporter,
          fromAddr,
          user.email,
          '【RegalCast】入店打刻の確認をお願いします',
          `${user.name} さん\n\n` +
          `本日（${today}）のシフト開始時刻（${startTime}）を過ぎましたが、入店打刻が確認できていません。\n\n` +
          `出勤している場合は、アプリから打刻または修正申請をお願いします。\n\n` +
          `─────────────────\nRegalCast Management System`
        );
        clockInUpdates[`clockIn.${uid}`] = true;
      }

      // ── 退店チェック ──────────────────────────────────
      // シフト終了時刻を過ぎていて、clockIn はあるが clockOut がなく、まだ通知していない
      if (endTime && nowTime >= endTime && !clockOutLog[uid] && att?.clockIn && !(att?.clockOut)) {
        await sendMail(
          transporter,
          fromAddr,
          user.email,
          '【RegalCast】退店打刻の確認をお願いします',
          `${user.name} さん\n\n` +
          `本日（${today}）のシフト終了時刻（${endTime}）を過ぎましたが、退店打刻が確認できていません。\n\n` +
          `退勤している場合は、アプリから打刻または修正申請をお願いします。\n\n` +
          `─────────────────\nRegalCast Management System`
        );
        clockOutUpdates[`clockOut.${uid}`] = true;
      }
    }

    // ログをまとめて保存
    const allUpdates = { ...clockInUpdates, ...clockOutUpdates };
    if (Object.keys(allUpdates).length > 0) {
      await logRef.set(allUpdates, { merge: true });
    }

    console.log(`完了: 入店通知 ${Object.keys(clockInUpdates).length}件, 退店通知 ${Object.keys(clockOutUpdates).length}件`);
  }
);
