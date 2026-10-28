# HTTP contract v1

JSON UTF-8。Authorization: Bearer (Vaultのservice credential)。ブラウザOriginは拒否。管理設定を変更する公開APIは無い。未知body fieldは拒否。

| Method | Path | Contract |
|---|---|---|
| GET | /health | liveness only、秘密や構成情報なし |
| GET | /v1/ready | 認証必須、adapter接続準備状態 |
| POST | /hooks/line/:bot | 生body 1MiB以内、X-Line-Signature必須、LINE検証用空eventsも可 |
| POST | /v1/messages | Idempotency-Key必須、body={route,operation,text?,messageId?}。operation=send/edit/delete。202は受付 |
| GET | /v1/messages/:id | 自serviceのstate/reason/providerId/attempts |
| GET | /v1/inbox | 自serviceの未ackデータ最大100件。重複を前提に業務側でevent IDを冪等処理 |
| POST | /v1/inbox/:id/ack | 業務処理保存後に実行。再ack可 |

受信event: {version:1,trust:"external-untrusted",provider,eventId,actor,destination,kind,text,timestamp}。provider=discord/line/slack、kind=message/action。actorはprovider由来ID、Cernere userや操作権限ではない。messageIdはDiscordのsnowflakeまたはSlackのtimestamp ID。

401=credential無効、403=許可外、404=対象なし、409=idempotency衝突、413=過大body、415=形式違反、429=流量制限、503=保存/設定/準備失敗。署名失敗は再配送を要求する失敗として返す。検疫で隔離した外部イベントは監査記録後200、無限再送を避ける。

state: pending → sending → sent / failed / uncertain。inboxはpending → acked。retention経過でexpired。sentはproviderの受付確認。uncertainは結果を調べるまで新しいkeyで再投稿しない。

v1はadditive-only。既存field意味変更はv2。旧Nuntius API互換を名乗らない。移行時は利用サービスがclientを差し替える。
