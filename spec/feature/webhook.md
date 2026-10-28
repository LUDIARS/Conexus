# 登録済みWebhookへの配送

- NX-WEBHOOK-01: `platform: webhook` のbotに固定 `endpoint` と接続先用 `tokenEnv` を設定する。HTTPS/443、DNSホスト、クエリ・userinfoなし。DNS解決に上限を置き、すべてのIPv4応答が公開範囲であることを確認してから、そのIPへ接続を固定する。TLS証明書は元のホスト名で検証する。IPv6専用宛先は現在非対応として拒否する。redirectを追跡しない。
- NX-WEBHOOK-02: routeはsend専用。共通認可/検疫を経たテキストをUTF-8 JSON `{version:1,id,destination,text}` としてPOSTする。BearerとIdempotency-Keyは固定ヘッダで、呼出元によるURL/header/method/bodyの差替えは禁止。受信側もサービス間tokenを検証する。10秒の送信期限、8KiBの応答header上限、応答本文は保存しない。
- NX-WEBHOOK-03: 2xxはprovider受付として記録し、業務完了としない。4xx/3xxは拒否、通信喪失/5xxは結果不明。受信側の冪等性を未確認なので自動再送しない。endpoint/credential参照の変更は再起動後も旧ジョブのbinding不一致として拒否する。

設定例（秘密は値を記載せず環境変数名だけ）:

```json
{"id":"partner","platform":"webhook","enabled":false,"tokenEnv":"PARTNER_TOKEN","endpoint":"https://receiver.example/events"}
```

routeのdestinationはURLではなく受信側が事前合意した宛先識別子。従来どおりservice/route/operationを明示する。匿名Webhook、任意JSON、PUT、任意添付は未対応。実装の一次資料はNode.js HTTPSとDNS API。実配送は未確認。
