# Conexus — 双方向 BOT 連携と統合検疫

設計日: 2026-10-18。根拠: neco「Conexusつくる」「Nuntiusを正式にobsolete」「入口/出口の検疫を一本化」「サービス同士…トークンが必要」。設計・実装の開始指示はこの依頼に含まれる。実稼働への切替、秘密の移管、外部送信の成功は別途検証する。

追加指示のSlack対応とCc再設計の反映は [concordia-redesign-alignment.md](concordia-redesign-alignment.md) に記録。現行実装providerはDiscord / LINE / Slack。追加指示によるEmail / SMS / Webhook / Web通知一覧 / Voice / Alexaの継承とPush除外は [nuntius-capability-migration.md](nuntius-capability-migration.md) を対応計画の正本とする。

## 責務

Conexus は Discord Gateway / LINE webhook の受信、外部 API 送信、明示したサービスごとの接続許可、検疫、永続 inbox/outbox、重複抑止と監査を所有する。Concordia はセッション管理・人間の操作認可・AI 実行の判断を所有する。各サービスは業務データと業務操作を所有する。ユーザーの本人認証は Cernere の責務であり、Conexus はユーザーログインや独自 JWT 発行を追加しない。

コアドメインは `integration-boundary`。価値は「接続を許した通信だけを、同じ検査経路で届ける」。配送保存、設定、プラットフォームアダプタは支援責務。依存は transport → application → policy/storage ports。各サービス固有の画面・コマンド・業務判断はコアに入れない。

## 経路

外部 → provider 認証 → 明示 route → ingress 検疫 → 暗号化 inbox → サービスがトークンで pull → 業務処理 → ack。

サービス → 接続トークン → service/route/operation 認可 → egress 検疫 → 暗号化 outbox → 配送直前に再認可・再検査 → provider adapter → 結果記録。

pull/ack を標準とする。登録しただけで任意 URL へ callback しないので SSRF と callback 秘密共有を減らせる。Conexus 停止時も各サービスの本体は動作を続け、外部連携だけ unavailable になる。直接 BOT へ迂回する自動フォールバックは禁止。

## トークンと接続

サービスの credential と Discord/LINE の BOT credential は別物。接続には service ID、期限つき token hash、enabled、許可 route、許可 operation を明示する。未登録、無効、期限切れ、scope 不一致は拒否。localhost も免除しない。他サービスの ID を本文で申告して権限を得ることはできない。

サービス bearer は十分なランダム値を Vault 側で発行・配送し、検証側は SHA-256 hash のみ持つ（高エントロピー machine credential でありパスワードではない）。複数 hash の期限を重ねてローテーションし、旧 hash 削除で失効させる。設定は各要求と配送直前に再読込し、失効は待機中の配送にも適用する。トークンそのもの、署名、本文はログに出さない。管理 API による自己登録・自動発見・wildcard grant は作らない。

Conexus → サービスのデータ取得も同じサービスが認証して pull する。将来 push を追加するなら、専用 audience の別 credential と相互合意した固定 endpoint が必須。provider user ID は受信経路の証跡であり、その人の業務操作権限を意味しない。

## 検疫

署名は生バイトに対して検証し、その後 JSON を解釈する。文字列は UTF-8、NFC、制御文字除去、上限確認を共通経路で実施。未知フィールドや生 provider payload の透過送信は認めない。資格情報らしい文字列、危険な URL scheme、許可外の URL host、添付・未知イベントは拒否/隔離して理由コードだけ記録する。Discord の通知先指定は常に allowed_mentions を空にし、意図しない全員通知を防ぐ。

検疫はプロンプトインジェクションを完全に防ぐ仕組みではない。外部入力は常に `trust: external-untrusted`、各サービスは本文を実行権限に使わず、ツール操作の認可を別に行う。検疫は業務判断の代用ではない。添付を自動ダウンロードしない。添付対応の切替は別途 MIME/実体/容量/スキャナ/配布先の検証が完了するまで停止する。

## 配送

SQLite のトランザクションで受付とキューを一緒に保存し、保存完了前に受付成功を返さない。payload は AES-256-GCM で暗号化し、鍵は Vault の起動時注入。inbox は ack まで再取得できる。provider event ID と route の一意制約で再配信を抑止。outbox は service + idempotency key の一意制約、異なる本文のキー再利用は409。

送信中のクラッシュは uncertain とする。LINE push の retry key のように provider が再送安全性を提供する場合だけ自動再送する。Discord の長時間後の再送に exactly-once を約束しない。429 は待機時間を尊重し、永久エラーは failed、上限到達は failed。再送時も現在の grant と検疫を評価する。ACK・監査・暗号化データの保存期間を設定し、古いイベントが無制限に蓄積しない。

## 置換と移行

Nuntius は新規採用・新機能追加を終了する。BOT 連携の後継は Conexus。テンプレート、通知予定、業務上の通知要否は発信元が所有し、Conexus を別の業務通知基盤に肥大化させない。Email/SMS/Alexa を使う既存利用者は移行台帳で個別確認し、Discord/LINE の完成だけで Nuntius 全機能を移行済みとしない。

1. provider account、接続サービス、guild/channel/LINE destination、必要操作、credential 所有者を棚卸しする。
2. 空 grant・autostart=false で導入。Vault 参照だけを設定する。
3. 隔離した BOT/宛先で受入条件を検証し、未許可・失効・再送・障害復旧も確認する。
4. 一つの route ごとに旧送受信を止めて drain し、新経路を有効にする。同じ token の Gateway を並行稼働させない。LINE webhook URL は署名検証の所有先と同時に切り替える。
5. inbox/outbox の配送結果と利用サービスの ack を照合する。戻す場合も新経路を止め、未確定配送を照合してから旧経路へ戻す。
6. Concordia の旧 transport と Nuntius を停止できるのは利用者全件移行・未処理配送ゼロ・rollback 確保後。削除・外部公開・実データ移管は自動で行わない。

## 調査根拠

- Conexus main `89202cd`: README のみ。旧 worktree `feat/integration-gateway-mvp` の未追跡設計 (2026-08-03) は Discord/Slack と Nuntius非代替を前提とするため、今回の要求が優先。他作業のファイルは変更しない。
- Concordia `08dd053c` (2026-10-18再確認): `spec/feature/line-webhook-relay.md` / `src/line-webhook/route.ts` はCcがチャネル秘密を保持し、生バイト署名を検証、relay tokenで転送し、返信を代行する構成へ更新された。初回調査時の `40f8a292` の純粋な転送設計は現行ではない。署名検証・返信の契約を移行元として照合し、Conexusへチャネル所有権を移す。現在のConexusはpushのみでreplyは未移行。`spec/feature/trust-boundaries.md` の人間権限とtransport権限は分離を維持。
- Nuntius `4f165de`: README は現役表記。LUDIARS/PROJECT-CODES.md は既に obsolete (2026-09-15)、共通化先 Lapilli と記載。今回のBOT統合の後継は Conexus と整理。
- Cc registry: Nx=Conexus。Praeforma project 一覧と Anatomia project list に Conexus は未登録。Anatomia concordia plan は解析が完了せず中止、解析成功とはしない。現行 spec とソースを根拠に継続。
- LINE署名: https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/
- LINE再送: https://developers.line.biz/en/reference/messaging-api/
- Discord Gateway / mentions: https://github.com/discord/discord-api-docs/tree/main/developers

## 受入条件

`spec/test/acceptance.md` を満たす。設計済み、実装済み、審査済み、本番切替済みは別の状態。今回のコードが完成しても旧サービスを停止したことにはならない。
