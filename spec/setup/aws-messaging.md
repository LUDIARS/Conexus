# 既存AWS環境の再利用確認

2026-10-18 neco: 「SMSとSESはAWSの環境作った気がする」。新規AWS環境を作る前に既存環境を調べて再利用する。SMSはNuntiusのSNS実装を移行元とし、EmailはSESを対応対象に追加する。既存SMTPアダプタの追加だけでSES対応完了とはしない。

## 確認した事実

- Nuntius `4f165dea9b644fbda5ef94be1172d3af23775985` の `src/channels/sms.ts` はAWS SNS Publishを使う。これは実装の存在であり、AWS環境の開通を証明しない。
- 作業端末にAWS CLIがあり、default profileのregionは `ap-northeast-1`。これはローカル既定値で、SES/SMSリソースの所在地を確定するものではない。
- 読み取り専用のSTS照会を試みたが、AWSログイン期限切れで失敗。アカウント、送信権限、SES送信元、SMS利用可能状態は未取得。
- 案内された `Archived/memory/` とNuntius専用memoryは見つからず、読了扱いにしていない。見つかったworkspace memory backupの対象検索にもSES/SMSの根拠はなかった。

## 再ログイン後の読み取り確認

1. 接続アカウントと使用regionを確認。default regionだけから対象環境を決め打ちしない。
2. SESの送信有効状態、sandbox/本番アクセス、確認済み送信元・ドメイン、DKIM、利用する設定セット、送信上限を確認。送信元一覧などの個人情報は公開資料へ転記しない。
3. SMSがSNS経由かEnd User Messaging SMSの構成か、sandbox、本番アクセス、送信元番号/Sender ID、必要な登録、利用region、料金上限を確認。電話番号は資料・ログに残さない。
4. Conexus用権限の付与経路と秘密の保管先を確認。CLIの人間用ログインを常駐サービスの資格情報として流用しない。既存資格情報の値をソースやログへ複写しない。
5. SES SMTPを使う場合、SES SMTP用資格情報と通常のAWSアクセスキーは別物として扱う。既存SMTPアダプタには確認したSMTP endpoint/fromと専用資格情報を設定する。SES API方式を使う場合は別adapterとし、認証・再送・結果不明の契約を検証する。

確認中は新規リソース作成、DNS変更、権限変更、本番アクセス申請、有料SMSやメール送信を実行しない。Push通知はこの移行に含めない。

AWS再ログインが必要なのは実環境の照会であり、SMS/SES実装全体の人間判断待ちとはしない。ほかの許可済み実装は継続可能。
