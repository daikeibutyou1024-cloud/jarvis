# RESEARCH 2.0

開発対象: feature/ai-business-rebuild。本番main・バックアップブランチには反映しない。
新規有料サービス・カード登録・有料検索API・自動投稿は使用しない。

## 操作
1. RESEARCHで情報源（デジタル庁RSS・消費者庁RSS・GitHub公開リポジトリ）とキーワードを指定し取得。
2. 商品の価格・機能・提携条件などは公式ページを人が確認し、比較資料に手入力。またはUTF-8のJSON/CSVを取り込む。
3. 記録を最大5件選択し「選択資料をCONTENTへ引き継ぐ」。CONTENTでnote記事またはアフィリエイト比較記事を選びAI生成する。
4. AI出力と出典を人が確認。通常の端末保存・既存のD1クラウド生成を利用できる。

情報の取得だけではClaudeを呼び出さない。AI生成・分析は既存のAPI料金と制限の対象。

## 記録と区分
- 外部取得: URL・取得日時・記録日時・元情報の日付・掲載情報を保存。掲載は事実の正しさの保証ではない。
- 手入力/取り込み: 未検証の事実主張、または仮説として保存。外部取得日時はnull（未取得）。
- AIの結果: 「仮説として記録」で保存。自動的に事実へ昇格しない。
- 価格・報酬条件など空欄は「未取得」。RSS記事本文・Web全体・サービスの売上も未取得。
- 取得成功0件と取得失敗を区別。失敗時に旧記録を今回の取得成功として表示しない。
- 調査ノートはこのブラウザに最大100件。JSON出力で出典記録も保管できる。
- 取り込む際は元ファイルの取得済み表示・取得日時・originなどを信用せず、新たに未検証として保存。
- CONTENTの引き継ぎは最大5件・3500文字のスナップショット。AIへの全指示は6000文字を超えたら明示的に停止。
- 通常生成・クラウド生成とも、引き継ぎ資料を原稿の末尾に機械的に付記し、AIが出典を省いても記録を残す。

## ファイル仕様
JSON: オブジェクトの配列。CSV: 同じキーのヘッダー。
必須 `title` (160字), `text` (1000字)。任意 `sourceUrl` (公開HTTPS・400字), `kind` (fact/hypothesis), `price` (160字), `affiliate` (300字)。
ファイルは100KB・1〜50件。全件検証成功後に保存。既存端末データは失敗時に変更しない。

## 安全な外部取得
- 認証: 既存JARVIS_ACCESS_PASSWORD。ユーザーのパスワード・APIキーを外部へ転送しない。
- 接続は固定HTTPS URLのみ。デジタル庁 `https://www.digital.go.jp/rss/news.xml`、消費者庁 `https://www.caa.go.jp/news.rss`、GitHub `https://api.github.com/search/repositories`。
- 利用者のURLをサーバーが取得することはない。任意ホスト/パス/ポート/リダイレクトを拒否。
- 8秒（本文読み込み含む）、1MB（実際に読んだバイトも確認）、MIME型の確認、DTD/ENTITY禁止。
- User-AgentでアプリとGitHubリポジトリを明示。アクセス制限応答で自動再試行しない。Retry-After等に従い情報源全体を待機。
- D1内の条件付きINSERTにより回数枠を先に確保。失敗も枠を消費する。
- 共有上限: 全体20回/直近1時間、GitHub8回/直近1時間、各RSS6回/直近1時間、同じ情報源は60秒間隔。
- 正常キャッシュ: RSS1時間（全体を共有してキーワードを絞る）、GitHub6時間（検索別）。失敗キャッシュ5分。
- キャッシュ利用でも元の取得日時を保持。期限切れデータを取得成功として返さない。
- D1利用不可・回数確保失敗なら外部取得を停止。メモリ内だけの制限にフォールバックしない。
- 最初の認証付き取得時にresearch_cache/research_requestsとインデックスを自動作成（SQLは0002にも記録）。既存テーブルはALTER/DROPしない。
- 期限切れキャッシュと24時間以上前の回数記録を整理。専用KV・有料プランは不要。既存Cloudflare無料枠の実際の使用量は別途確認が必要。

## 対象範囲・利用条件
RSSは直近最大60件から部分一致、表示最大10件。GitHubは公開リポジトリ最大10件。不完全な検索結果は失敗として扱う。
記事全文・画像・コードの転載は行わず、RSS見出し・短い配信要約とAPIメタ情報を記録。原文リンクを残す。
出典の画像や本文を記事へ転用するときは、その提供元・第三者の権利やライセンスを別途確認する。
公式RSS案内: https://www.digital.go.jp/rss / https://www.caa.go.jp/rss/
GitHub制限: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
GitHub規約: https://docs.github.com/en/site-policy/github-terms/github-terms-of-service

## 検証
`npm test`（ランタイム依存の追加インストール不要）。テストはnode:sqliteを使うためNode.js 22.13以降（開発では24）。
静的サーバーを8080で起動し `node tests/browser.mjs` と `node tests/research-browser.mjs`（PlaywrightとChromiumが必要）。
Cloudflare Functionsのビルドも検証。テスト内の外部取得・AIは模擬応答を使用し、実課金なし。
開発環境の送信先ポリシーでは官公庁RSSへの直接接続が拒否されるため、実RSS本文の疎通はこの環境では未検証。Previewデプロイ成功は実取得成功と区別する。

今回の確認結果: 単体テスト25件成功、既存5部門とRESEARCHのブラウザ操作（390/768/1440px）成功、Cloudflare Functionsビルド成功。ローカルWorkerで認証拒否・入力制限・D1初期化・未取得応答とキャッシュを確認。依存パッケージのnpm auditは既知脆弱性0件。

Previewビルドの環境差を避けるため、XMLパーサーはレビューしたバージョンの自己完結ESMをvendor/xmlへ同梱。各パッケージのバージョン・MITライセンスを保持し、node_modulesなしのFunctionsビルドと全テストを検証する。
