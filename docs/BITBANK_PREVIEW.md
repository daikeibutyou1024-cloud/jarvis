# bitbank資産報告：Preview架空データ版

## 今回の範囲

`feature/ai-business-rebuild` のPreviewのみ。FINANCEの「bitbank資産レポート（架空データ）」から手動取得する。HOMEではPreviewモックを選び、既存オーブへ「ジャービス、資産状況を報告して」と話す。入力欄への同じ文字指示にも対応する。認証が必要。

報告は固定の架空保有資産・架空価格から計算し、実資産や現在相場と明確に区別する。実Claude/bitbank API呼び出し、売買、注文取消、出金、送金、定期実行、DB変更はない。ページを開くだけでは取得しない。既存費用台帳・保存データ・API承認は変更しない。

`GET /api/business/bitbank-preview` はPreviewホスト・ブランチ・署名セッションを検証し、常にmockを返す。POSTや任意パラメータは拒否する。Secretや有効化フラグを設定しても実接続に切り替わらない。レスポンスはno-store。資産報告はClaudeに送る前に専用処理へ分岐し、AI文脈・会話記憶・localStorageへ報告数値を追加しない。読み上げは既存の端末音声合成、認識は既存の共有マイクを使用する。音声設定や実AI承認の変更は不要。

## 計算・表示

- 公式assetsの `onhand_amount`（保有量）を評価対象にする。free/lockedを再加算しない。withdrawingはlockedの内数であり、重ねて足さない。
- 円は1円として扱い、暗号資産はJPYペアの `last`（最終約定価格）を掛ける。これは手数料・板の流動性を含まない参考評価。
- 数量・価格は小数文字列から18桁固定小数整数へ変換し、浮動小数点の丸め誤差を回避する。表示は円・比率とも小数2桁で四捨五入する。
- 24時間変動率は `(last / open - 1) × 100`。評価変動額は「現在の保有量 × (last - open)」。過去の保有量・売買・入出金を反映する運用成績や実現損益ではない。
- JPYペアが未取得の資産を0円と決めつけず除外し、「小計」「評価対象外」として表示する。基準価格openが0なら変動は未取得。
- 不正数量・整合しないロック量・重複・5分を超えた価格は拒否する。失敗時は表示済み明細を消し、自動再試行しない。

## 確認した公式仕様

- [Private REST API（日本語）](https://github.com/bitbankinc/bitbank-api-docs/blob/master/rest-api_JP.md)
- [Public REST API](https://github.com/bitbankinc/bitbank-api-docs/blob/master/public-api.md)
- [JPYペアを含むペア一覧](https://github.com/bitbankinc/bitbank-api-docs/blob/master/pairs.md)

将来の保有量取得は `GET https://api.bitbank.cc/v1/user/assets`。価格は認証不要の `GET https://public.bitbank.cc/{pair}/ticker` または公式のJPY ticker一覧を検討する。今回これらのAPIへは一度も接続していない（公式仕様ファイルだけを参照）。

Private GETはACCESS-KEYとHMAC-SHA256署名を使用する。公式には単調増加ACCESS-NONCE方式とACCESS-REQUEST-TIME / ACCESS-TIME-WINDOW方式がある。将来Cloudflareで並列実行する場合、単純なDate.now()だけのnonce共有は衝突し得るため、公式の短いTIME-WINDOW方式（例5000ms以下）を検討する。署名には `/v1` を含む固定パスを使う。時刻誤差や429・認証失敗は停止し、署名付きリクエストを自動再送しない。公式取得系制限は基本10回/秒だが、実接続版ではさらに少数に制限する。

## 実接続前に必要な設定（今回は未実施）

1. 本人がbitbankのAPI管理画面で参照権限のみの専用キーを作成する。注文・取消・出金などの更新権限は付与しない。権限設定が確認できなければ接続しない。IP制限を使う場合、Cloudflareの実際の送信元条件との整合が必要で、固定IPがあると仮定しない。
2. 本人がCloudflare Pages `asset-simulator` の **Preview** のSecrets欄へ `BITBANK_API_KEY` と `BITBANK_API_SECRET` を直接登録する。通常の公開変数やGitHub Secrets、コード、.envのコミット、会話入力、ブラウザ向け設定には入れない。Codexへ値を貼り付けたり、登録画面の値を撮影・共有したりしない。Productionは変更しない。
3. 将来の実接続は別途承認後にサーバー側だけへ固定GET専用adapterを実装する。Secretを画面・API応答・ログ・URL・AIプロンプトに含めない。任意URL、任意HTTPメソッド、注文・出金のendpointを受け取る汎用proxyは作らない。redirect禁止、短いtimeout、件数・サイズ・頻度上限、認証・権限失敗時の停止が必要。
4. Preview DBとの分離、HTTPS、署名セッション、参照専用権限、料金条件を確認後、本人承認のもと必要最小限の読取を行う。ダミーからの自動切替はしない。

今回Secretsは未登録。実口座との照合、署名の実環境動作、権限の実証、実iPhoneの認識・読み上げは未検証。

## 将来拡張と復旧

計算は `lib/bitbank-report.js` の入力形式（assets/tickers/asOf）と表示を分離している。将来の価格分析・報告adapterはこの入力境界に追加できる。実接続や定期報告の開始は別途承認とし、現時点でscheduler/Cron/AI分析は実装しない。

今回の変更にDB移行はなく、Previewコードを戻しても既存データへ影響しない。障害時は新機能を使わず既存機能を継続する。Production・main・バックアップは復旧先として操作しない。
