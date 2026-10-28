# 接続と検疫の不変条件

- NX-AUTH-01: health と署名検証する LINE hook 以外は bearer 必須。サービスIDは検証済み credential から決める。
- NX-AUTH-02: service、route、bot の enabled と operation の積集合だけ許可。route は一つの service に所属。受信 actor も明示許可。
- NX-AUTH-03: outbox は受付時 credential hash と宛先bindingを保持。失効、期限切れ、宛先変更時は未送信分を拒否。
- NX-QUAR-01: LINE の生バイト署名検証後に解釈。Discord は認証済み Gateway からのみ受信する。
- NX-QUAR-02: 共通 text 検査は両方向で使い、出力は配送直前に再検査。添付・未対応イベントは理由付きで隔離。原文や秘密は監査ログへ残さない。
- NX-QUAR-03: 外部入力の trust ラベルを維持し、業務権限として扱わない。人間の本人認証と操作認可は利用サービス/Cernereの責務。
- NX-QUEUE-01: 受付は永続化の後。inbox は ack まで再取得可能。受信 event ID と送信 idempotency key を重複検出に使う。
- NX-QUEUE-02: provider受付は利用者への到着証明ではない。送信中断は uncertain。Discord の不明送信を自動再送しない。
- NX-QUEUE-03: 他サービスの inbox / job / message にアクセス不可。edit/delete は同routeで作成を記録したmessageだけ。

対応: Discord guild channel のテキスト受信、interaction受信、テキスト送信/編集/削除。LINE message/postback受信とpush送信。
SlackはSocket Modeによるmessage/block action/slash command受信とchat.postMessage/update/delete。App tokenとBot tokenは別のVault参照、team/channel/userを明示routeに照合する。特殊mentionはエスケープし、mrkdwn・自動展開を抑制する。
未対応の添付、DM、channel/forum管理、slash command登録、LINE reply/画像/動画等は透過転送で回避せず拒否する。Concordia全機能切替はこの差分を解消するまで未完了。
