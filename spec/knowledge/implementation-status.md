# 実装・検証・移行の記録

2026-10-18 / neco 指示。Actio: `actio:edb6054c-a774-4f40-9df0-730d23e0ac15`。状態の正本はActio。文書は根拠と残件だけを保持する。

## 作成したもの

設計、UX、domain宣言、API契約、データ保護、運用/復元、受入条件。
TypeScript実装: 明示登録token/service/route認可、両方向text検疫、LINE生バイト署名、Discord Gateway、永続暗号化inbox/outbox、ack、重複防止、配送直前再認可、送信状態と監査、Excubitor catalog/setup/export/import。

追加指示: CcのDDD/Nodeサービス原則/3軸分離/プロセス分離v2とSlack仕様を参照。Slack Socket Mode、team/channel/actor認可、message/action/slash受信、送信/編集/削除、mention無害化とuncertain処理を追加。Slack追加後のbuildも成功。依存の@slack/socket-modeはMIT。

Nuntius継承追加: Webhookの固定HTTPS先へのPOSTとEmailの認証付きTLSテキスト送信を追加。Webhookは公開IPv4の検査とDNS固定、Emailは固定宛先と件名検疫、両者とも送信先変更で待機ジョブ失効・通信喪失時uncertain。nodemailer 10.1.2はMIT。機能テストは作成のみで未実行、外部送信も未実施。SMS/Web通知一覧/Voice/AlexaとEmail HTML/添付/複数宛先は未実装。

## 確認

`npm run build`: 成功（初回は開発依存が省かれていたためTypeScriptを追加し、再実行で成功）。TypeScriptは本体とテストコードを含む。単体/統合/実BOT/起動テストは未実施。buildは送信や安全性の実証ではない。

Conexusは初回調査時Praeforma/Anatomia project未登録、AnatomiaのCc解析も完了していない。既存ソースとspecに限定して設計した。Cc LINE relayは調査中に更新され、`08dd053c` ではCcが署名検証・token転送・返信を所有する。移行元の現行契約として再確認した。Conexusの署名検証は実装済みだがreply契約は未移行。Discord SDKは既存Ccと同系統を採用。

依存license: discord.js と zod / TypeScript はApache-2.0またはMIT、Node型はMIT。固定解決はpackage-lock.json。依存installのlifecycle scriptは実行していない。

## 移行前に必要な残件

- Revisorの審査と受入検証。暗号化、認可失効、provider再送、復元を実経路で検証する。
- Concordiaの添付、channel/forum管理、既存interaction UI等との能力差分を解消し、Concordiaの送受信を新clientへ接続する。LINEの既存consumerはraw署名bodyではなく検疫後eventを受けるため、consumer側の移行が必要。
- 実接続先、BOT所有者、Vaultの参照、利用サービスtokenを設定する。現時点は空設定で外部未接続。
- Email/SMS/Alexa等のNuntius利用実態を確認し、発信元の通知予定/テンプレートと配送先の移行を個別に完了する。
- 旧経路のdrainと切替、Concordia旧transport撤去、Nuntius停止。未実施。

Nuntiusの廃止文書は別のNt作業に保存し、local PR #3247へ提出。稼働停止とは区別する。
