# Concordia 再設計との整合とSlack対応

2026-10-18追加指示: 「Ccの再設計資料を読んで参考にして。あとSlackもここで対応」。同じConexus作業の範囲に追加する。

実際に参照した正本:

- `Concordia/spec/architecture/ddd.md` (CC-DDD-POLICY): Ccのコアは協働/委任で、配達は支援境界。権限は操作時に検証、結果不明は照合待ち、成果と配達の事実を区別する (CC-INV-02/03/04/06/07)。
- `Concordia/spec/architecture/nodejs-service-principles.md` (2026-10-09, CC-NODEJS-SERVICE-PRINCIPLES): 短い受付、有界入力/キュー、永続状態、所有権、停止/復旧、health/readinessの区別 (CC-NODE-01〜10)。規範であり全実装適合済みではない。
- `Concordia/spec/plan/refactor-3axis-architecture.md` (2026-07-02): AI協働・チャット連携・コスト集計の分離。チャット障害で協働コアを止めない。
- `Concordia/spec/plan/process-isolation-v2.md` (2026-07-12): C1〜C5。ack/defer前にCcへの同期往復を挟まない。業務側停止時も閲覧と受付を維持し、再接続で照合する。旧計画のCc内SQLite共有案は、独立サービスConexusでは採用せず版付きinbox/outbox契約に置換する。
- `Concordia/spec/feature/slack-platform.md` (2026-07-16): Socket Mode、session channel、message更新、channel ID routing、archive。Cc固有のsession/質問/委任の意味はCcが保持する。

## 反映

1. Conexusは配達境界だけを所有し、Ccのspawnや人間の承認判断を取り込まない。外部イベントのactorは認可済み業務命令ではない。
2. provider受付/永続受付/業務処理/配達完了は別の状態。API 202とSlack ackを「業務完了」と表示しない。
3. SlackはApp-level token (`connections:write`) とBot tokenを別のVault参照で設定。Socket Modeで受信するため公開webhookを追加しない。認証済みSocketから受けたteam/channel/userをrouteに照合。
4. Socket eventは永続化または検疫記録を完了してからack。Ccへの同期問い合わせをしない。永続化失敗ではackせずproviderの再送に任せる。ACK期限と永続化遅延は受入検証で計測する。
5. Slack message/actionを共通のexternal-untrusted envelopeへ正規化。BOT投稿・変更通知の再取り込みを防ぎループを避ける。添付は既定で隔離。
6. Slack chat.postMessage/update/deleteは共通のtoken/route/operation/所有権/検疫を通す。mrkdwn、link_names、unfurlを抑制し、特殊mention構文を表示文字として無害化する。
7. 429はRetry-Afterを尊重。HTTP応答喪失や5xxはuncertain、Slack client_msg_idだけで無期限のexactly-onceを主張しない。SQLite記録と実メッセージの照合を切替条件とする。
8. provider接続状態を分離する。一つのBOTの切断で別providerの受付を停止しない。/readyは全体状態の要約だが、個々の受付は永続保存が可能なら継続する。

公式契約: https://docs.slack.dev/apis/events-api/using-socket-mode/ と https://docs.slack.dev/reference/methods/chat.postMessage/ (2026-10-18参照)。

## Cc全置換の確認点

既存Slackのsession channel作成/終了archive、Hub/Canvas、質問modal、Discord forum/添付の能力差分も移行台帳で確認する。今回の指示はSlackをConexusが所有することを確定するが、旧機能の移行済みを意味しない。通信契約と業務UIの責務を混同せず、利用側移行と切替検証を完了するまで旧経路は停止しない。
