# Nuntiusの対応予定をConexusへ取り込む

2026-10-18 neco指示: 「Discord、Slack、LINE以外でNuntiusでサポート予定だった内容があれば取り込む。Push通知は別」。本書はConexusの対応範囲を拡張する決定であり、アダプタの実装済み宣言ではない。

## 根拠と区分

追加情報: necoよりSMS/SESのAWS環境を構築済みの可能性が示された。Emailの継承にはSESを含め、既存環境の再利用を優先する。現地確認の事実と未確認項目は `spec/setup/aws-messaging.md`。AWSログイン期限切れのため構築済み・利用可能とはまだ判定しない。

Nuntius `4f165dea9b644fbda5ef94be1172d3af23775985` の `README.md`、`src/db/schema.ts` のChannelType、`src/channels/index.ts` と各dispatcherを照合した。列挙された11種は、Discordの2方式をまとめると10チャネル。既存3サービスとWebPushを除く追加対象は次の6種。Nuntiusのソース実装は確認したが実配送は未検証。

| Conexus追加対象 | Nuntiusの根拠 | 取り込む契約 | 境界・残る実装 |
|---|---|---|---|
| Email | `src/channels/email.ts` | SMTP送信、件名、本文、To/CC/BCC、Reply-To、検査済み添付 | SMTP認証と送信元は接続設定。宛先は許可routeに固定。ヘッダ改行拒否、HTML検疫、TLS、添付検査。SMTP受付と利用者への到達を区別。受信メールは旧対応として確認できないため自動的に追加しない |
| SMS | `src/channels/sms.ts` | AWS SNSによる電話番号宛てのテキスト送信、sender ID | E.164宛先と送信元、regionを登録。SNSのTopic通知/モバイルPushへ拡張しない。料金上限・分割数上限を設定。添付は許可済みURLだけ。旧コードにSMS受信はない |
| Webhook | `src/channels/webhook.ts` | 登録した外部サービスへのJSON配送 | 接続先URL・HTTP method・認証方式・payload schemaを事前登録。要求bodyによる任意URL/任意header指定は移植しない。HTTPS、リダイレクト拒否、DNS/IPのSSRF対策、サイズ上限、期限を必須とする。サービス間トークンなしの経路は禁止 |
| Web / アプリ内通知一覧 | `src/channels/web.ts`、READMEのinbox API | 宛先ユーザーごとのタイトル・本文・リンク・検査済みメディア・未読/既読 | 現行のサービス間inboxとは別契約。projectとuser双方を認可し、他ユーザーへ漏らさない。画面側が認証付きで取得する通知一覧でありOS/ブラウザPushではない |
| Voice / 音声 | `src/channels/voice.ts` | Imperativusへの読み上げ依頼、voice指定、検査済み音声参照 | 合成・再生・デバイス紐付けはImperativus。Conexusは認可済み配送のみ。固定endpointと必須サービス間tokenで接続。旧コードの `/api/voice/speak` は前提記載であり、受信側の現行契約は実装前に照合する |
| Alexa | `src/channels/alexa.ts` | Alexa固有のイベント、対象ユーザー、referenceId、有効期限、locale | NuntiusにあるのはProactive Events送信。一般的な音声対話/Skill受信が実装済みとは扱わない。イベント型ごとの検疫とLWA資格情報分離が必要。ブラウザ/モバイルPushとは別のAlexa契約として対応計画に保持する |

Push通知はConexusの移管対象外。具体的にはNuntius `src/channels/webpush.ts` のWeb Push/VAPID、購読endpoint、Service Worker配信を移さない。FCM/APNs等の端末Pushも追加しない。Alexa Proactive Eventsは通知型の機能であるため、Push機構との責務分担を移行台帳に明示し、これを根拠に汎用PushをConexusへ取り込まない。LINE Messaging APIの `push` は既存LINEチャネルの送信方式名であり、WebPush除外により削除しない。

## 共通機能も移行漏れをなくす

READMEにあるQueue/Topic/Reminder、予約・繰り返し、優先度、テンプレート・メンション、購読、REST/WS、メディアも移行確認項目とする。

- Conexusが所有するのは認可済み配送、provider操作、検疫、暗号化保存、再送制御、配送結果、重複防止。追加6チャネルにも既存3チャネルと同じ入口/出口を適用する。
- 通知要否、テンプレート生成、予約・繰り返しの時刻計算、業務上の購読先選択は利用サービス側が所有する。旧Nuntius利用者ごとに引受先を台帳へ記録し、単に削除しない。具体的な引受先が未確認なら未移行。
- Topic配信は許可routeを展開した個別配送として扱い、購読だけで未許可サービスへの接続を作らない。部分成功と失敗を宛先別に保持する。優先度は上限付きで、他サービスを無期限に待たせない。
- REST/WSの旧契約は新APIへ変換する利用者別の移行項目。既存のservice inboxをユーザー通知一覧の代用にして権限境界を崩さない。
- メディアは種類・実体・サイズ・保存期限・所有者・宛先を検査し、URL取得にはSSRF対策を必須とする。スキャンや変換失敗を無視して「添付以外は成功」としない。準備前は拒否を維持する。
- credentials未設定時にログだけでsuccessとする旧dev fallbackは移植しない。未設定/未対応は明示拒否。SDKが内部で自動再送する場合も配送の重複方針と合わせる。
- 片方向しかないproviderへ見かけの双方向対応を付けない。receive/edit/deleteの能力をprovider別に宣言し、非対応operationは受付時に拒否する。

## 実装・切替の受入条件

1. 追加6種のschema・認証・宛先制約を確定し、各providerの現行一次資料または受信サービス契約と照合してからadapterを実装する。
2. 共通認可/検疫/outbox経由を必須にし、provider別の資格情報・接続先・宛先の差替えで未送信ジョブが旧許可を引き継がないようにする。
3. 認可なし、失効、別project/user、未対応操作、不正URL/ヘッダ/添付、再送、結果不明、再起動後復旧を登録テストに含める。成功は送信先の受理根拠を保存した場合だけ。
4. 既存利用者、宛先、資格情報の所有者、未処理配送、API・テンプレート・予約の移行先を確認する。外部配送や有料SMSの実検証は本書だけを根拠に実行しない。
5. Push購読やPush資格情報を巻き込まず、旧経路停止→新経路有効化→結果照合→rollback確認をチャネル単位で行う。すべての対象利用者が移行するまでNuntiusを全停止可能とは判定しない。

追加6種は設計への取り込み済み。Webhookは固定endpointへのテキストPOST、Emailは固定宛先への件名付きテキストSMTP送信を実装し、詳細と未対応範囲は `spec/feature/webhook.md` / `spec/feature/email.md` に記録。ほか4種のConexus adapterは未実装。実配送と本番切替は未確認。既存Discord/Slack/LINEの審査合格だけでこの追加範囲を完了にしない。

調査補助: PraeformaのNuntius project `01M3FVMG08NMYXJWWVY76JJ5S0` を参照したがUX欄は空。Anatomia `plan --project nuntius --no-llm` はdomain定義なしで着地を特定できなかった。したがって上記ソースとREADMEの裏付けを使い、仕様・動作の網羅性をツールが保証したとはしない。
