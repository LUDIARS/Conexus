# 導入・停止・復元

Node >=24。Excubitorが本体checkoutでsetup→build→startする。worktreeからサービスを起動しない。初期autostart=false、service/bot/route空配列、暗号鍵なしなら起動失敗。空配列は接続未登録であり、外部連携成功ではない。

Conexusカタログの11230がこのサービスの割当案。本体導入時に実拠点の競合を確認する。host/port/allowedHostsは設定で一致させる。公開する場合、Tunnelは/hooks/line/だけを許可し、管理/APIを外へ透過公開しない。遠隔service APIを必要とする場合もTLS+bearerを必須とし、公開許可は別途確認する。

非秘密設定はconexus.config.json。拠点固有設定はCONEXUS_CONFIGで*.local.jsonを指定可。tokenはVaultで生成し、serviceにはbearer、ConexusにはSHA-256 hashとexpiresAtを渡す。32byte以上の乱数base64urlを用い、人間のパスワードを流用しない。

設定例の形（すべて実値に置換、秘密はファイルへ書かない）:

```json
{"id":"consumer","enabled":true,"tokens":[{"hash":"64桁SHA256","expiresAt":"2026-12-01T00:00:00Z"}],"routes":["consumer-chat"],"operations":["send","receive"]}
```

bot={id,platform:discord|line,enabled,tokenEnv,secretEnv?}。LINEはsecretEnv必須。route={id,service,bot,enabled,destination,guild?,actors:[許可provider ID],operations}。Discordはguildとchannel ID、LINEはuser/group/room ID。wildcard無し。Discord Developer Portalで必要intentsを明示設定し、一つのBOTは一つの稼働Gatewayだけにする。

Slackの場合はplatform=slack、tokenEnv=Bot token参照、appTokenEnv=App-level token参照（connections:write）、routeにteamとchannel IDが必須。Botにはchat:writeと受信対象のhistory scope、Event Subscriptionsのmessageイベント、必要なInteractivity/Slash Commandsを設定する。Socket Mode接続なので公開Request URLは作らない。Bot credential、App credential、利用サービスcredentialの3種を共用しない。

service/token/route/urlHostsの変更は要求時と配送時に再読込。bot/storage/listener変更はExcubitorで制御した再起動を要する。壊れた設定は通信拒否となり旧設定で黙って継続しない。

停止は進行中配送の完了を待ちHTTP/Gateway/DBを閉じる。data/*.runningが残ると起動・export/importを拒否。異常終了後はExcubitorで当該プロセス停止を確認した管理者だけがmarkerを除去する。勝手にロックを奪わない。

export: 停止後 `scripts/site/export-data.mjs --output <絶対新規ファイル>`。SQLite backup APIで整合snapshot。import: 停止後 `--input <Taildrop内絶対パス> --sha256 <bundle hash>`。EXCUBITOR_TAILDROP_DIR必須、256MiB上限、service/version/hash/integrity確認、既存DB拒否。失敗時は元DB/bundleを保持する。鍵は別途Vaultから供給。復元後は全routeを無効にした状態で配送照合してから有効化する。

実BOT接続、外部送信、公開URL、Concordiaからの切替、Nuntius停止はこの文書の作成をもって実行済みとはしない。
