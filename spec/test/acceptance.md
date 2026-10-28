# 受入と検証計画

登録検査 `node scripts/review-check.mjs` は新規checkoutを前提に、lockfileから開発依存を含めて `npm ci --include=dev --ignore-scripts` で準備し、TypeScriptコンパイル後に列挙した境界テストを実行する。サービス起動や外部BOT接続は行わない。PR #3248の初回検査は依存未配置でコンパイラを起動できず失敗したため、この準備を追加した。再検査成功は通知で別途確認する。

人間の明示指示なしにsessionがテストを実行しない。build/typecheckは静的確認、実稼働成功の代用ではない。起動検証はConcordia testing claim/releaseを行い、Excubitorから本体checkoutだけで実施する。

| 条件 | 正常例 | 拒否/障害例 |
|---|---|---|
| 認証 | 期限内tokenで自routeへ送信 | tokenなし、期限切れ、他service、操作外、停止bot |
| 検疫 | 日本語textを両方向配送 | 秘密らしい本文、未知field、危険URL、添付、長大body |
| 署名 | LINE raw body署名一致、空events | 改変body、不正署名、圧縮、過大body |
| Slack | Socket Mode保存後ack、team/channel/actor一致 | team不一致、BOT echo、添付隔離、特殊mention、provider 5xxでuncertain |
| inbox | 永続化→pull→業務保存→ack | 再配信重複、他serviceのack、失効後pull |
| outbox | 同key同bodyは同job | 同key別body409、失効/宛先変更後の送信拒否 |
| 編集削除 | 自routeで作成したmessage | 別routeまたは未所有message |
| 障害 | 429待機後復旧、LINE同retry key | Discord送信中断はuncertain、再起動でsendingを再送しない |
| 保存 | 暗号化payload復号、整合backup | 鍵不一致、改ざん、既存DB上書き、Taildrop外入力 |
| 移行 | 検証routeで旧経路停止→新有効 | 同token Gateway二重稼働、旧未処理の無視 |

未検証のまま本番切替しない。Concordiaの添付・forum/channel操作など既存能力の差分が残る場合、部分的な新経路を全置換と報告しない。
