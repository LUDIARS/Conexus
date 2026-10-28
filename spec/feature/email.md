# SMTPによるメール送信

- NX-EMAIL-01: email接続はSMTP host/user/fromを設定し、passwordはtokenEnvで参照する。port465のTLS接続のみ許可し、証明書検証を無効化できない。route.destinationに単一メールアドレスを固定する。宛先変更は待機ジョブを失効させる。
- NX-EMAIL-02: send専用。subject必須、改行・制御文字拒否・200文字以内。subjectとtextは共通検疫を通す。HTML・任意header・添付・CC/BCCはこの段階では未対応として入口で拒否し、透明な生payload転送はしない。
- NX-EMAIL-03: ログへ本文・宛先・SMTP応答を出さない。認証未設定で成功扱いにしない。SMTP受付を受信者の既読とは扱わない。通信エラーは結果不明とし、自動再送しない。SMTP接続は送信ごとに終了し、期限内に処理を終える。

この文書はテキストメールの最初の実装契約。NuntiusのHTML/添付/複数宛先機能の継承は別途検疫と部分成功の設計が必要で、まだ移行完了ではない。
SESも対応対象。既存SES環境の再利用と資格情報の区別は `spec/setup/aws-messaging.md` に従う。現行SMTP実装だけでAWS上のSES送信確認済みとはしない。
参照した一次資料: https://nodemailer.com/smtp と https://nodemailer.com/message (2026-10-18)。
