# Conexus
LUDIARS の外部 BOT 連携窓口。Discord / LINE / Slack と各サービスの双方向通信、接続認可、入口・出口の検疫、配送記録を所有する。

正式名称は **Conexus**、project code は **Nx**。依頼中の Conxus は同じサービスを指す。

- [設計と移行条件](spec/plan/unified-bot-gateway.md)
- [Concordia再設計との整合・Slack対応](spec/plan/concordia-redesign-alignment.md)
- [Nuntiusの追加6チャネル継承・Push除外](spec/plan/nuntius-capability-migration.md)
- [利用者の目的](spec/ux/product.md)
- [接続・検疫仕様](spec/feature/gateway.md)
- [Webhook送信](spec/feature/webhook.md) / [メール送信](spec/feature/email.md)（実配送未確認）
- [API](spec/interface/http.md)
- [運用](spec/setup/operations.md)
- [受入条件](spec/test/acceptance.md)

Nuntius は obsolete。後継の外部 BOT 連携は Conexus が担う。廃止宣言は既存配送の停止や移行完了を意味しない。
