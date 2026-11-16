# 自律運用への移行準備（2026-11-16）

## 今回反映する範囲

基準は `68ecdef`、対象は `feature/ai-business-rebuild` のPreviewのみ。
`lib/autonomous-engine.js` に画面・localStorage・Cloudflare・AI SDKに依存しないジョブ処理を抽出した。ブラウザは既存保存・認証・公開情報収集・モック生成をアダプターとして渡す。既存5部門、原稿、承認履歴、8時間セッション、音声機能の実装は維持する。

通常ホームは業務報告・確認・承認・修正依頼を優先し、既存の一括作成ボタンは「内部ジョブの詳細・手動作成」に残す。エラー・再試行は報告に表示する。成果・収支は既存の手入力レポートを再利用し、未登録値やAPI請求未確認を実績扱いしない。

これは24時間自律運用の開始ではない。今回は手動起動のモック処理のみ。ページロードでジョブを開始しない。ブラウザを閉じると処理しない。クラウド永続化・実AI・スケジューラー・外部投稿の接続は無効。`PREVIEW_MOCK_AUTOMATION_ENABLED=false` は変更しない。このフラグは別の旧モック自動運転機構用で、今回の手動一括作成を有効化するフラグではない。

## 実行インターフェースと安全契約

`executeAutonomousJob({id, trigger:'manual', ports})` は次を順に呼ぶ。

|ポート|責任|
|---|---|
|exclusive|排他実行。未取得なら実行を拒否。ブラウザ版はWeb Locksで全ジョブを直列化|
|jobs.get/update|ID、状態、試行回数、完了段階、エラー、再開用出典の記録|
|research.collect|公開情報取得。失敗を架空情報で補完しない|
|packs.get/findSource/put|案件と版の保存。同一出典URL＋公開日時を重複排除、版競合を拒否|
|ai.kind/build|現在はpreview-mockのみ。記事＋SNS案を既存生成関数で作成|
|records.snapshot / analysis.summarize|登録済み成果・収支を整理。外部取得を装わない|
|notify|進捗通知。エンジンからDOMは操作しない|

新規生成は未承認・出典未確認を強制する。失敗はfailedとして記録し、自動再送しない。保存済み原稿がある場合の再試行は収集・生成を繰り返さず、後続整理から再開する。承認・修正依頼は既存の版管理を使用する。

`schedulerDescriptor` と `publicationDescriptor` は無効な接続情報のみを返す。投稿記述子は特定案件・承認版を要求するが、認証や承認の証明にはならず、投稿処理も存在しない。将来のサーバーは必ず保存済みの本人承認と原稿ハッシュを照合する。`cloudPersistenceAdapter()` は承認・未設定エラーで停止する。実AI種別やschedulerトリガーを渡しても実行を拒否する。

将来のクラウド排他はWeb Locksの代用では不十分。D1の条件付き更新・一意制約・トランザクションで、job_id、lease_owner、lease_until、単調増加するfencing_token、expected_versionを管理する必要がある。期限切れワーカーの結果は保存拒否。冪等キーはテーマ/出典版/処理版から作る。lease取得後でも停止フラグ・予算・対象DB/ブランチを各外部呼出し前に再検証する。外部結果不明時は自動再送せず照合待ちにする。

## Preview D1読み取り確認

Cloudflare GETと、以下Preview DBだけへのSELECTで調査した。Production DBにはSQLを実行していない。

- Pages `asset-simulator` Preview: `JARVIS_DB` → `jarvis-preview` / `5ec09d38-2ed8-4c7a-ba67-bfd9c2ed32d0`
- Production: `JARVIS_DB` → `jarvis-calendar` / `4cae3d2a-eff6-4a1d-871e-56491bdf082a`
- 既存表: `_cf_KV`, `ai_operations`, `ai_reconciliations`, `ai_usage`, `automation_control`, `automation_events`, `automation_runs`, `automation_work_items`, `business_job_generations`, `business_jobs`, `document_revisions`, `editorial_reviews`, `jarvis_memories`
- 既存索引: `idx_ai_operations_month`, `idx_ai_usage_created`, `idx_automation_events_time`, `idx_automation_items_day`, `idx_automation_runs_day`, `idx_business_jobs_created` とSQLite自動索引
- 旧モック4表の件数: control=1 / runs=5 / events=14 / work_items=5。内容は公開せず、前後ハッシュで保持を比較する。

### 提案する永続化（未実施・要承認）

既存automation_*は旧モックのデータなので流用しない。新しい名前空間に以下を提案する。DDL、Binding変更、インポート、DB書き込みは今回行っていない。

|論理テーブル|主な項目と制約|
|---|---|
|autonomous_jobs|job_id PK、project_id、stage/state、attempt、next_retry_at、dedup_key UNIQUE、lease_owner/until、fencing_token、version、error、安全停止理由|
|autonomous_projects|project_id PK、テーマ、状態、最新原稿版、作成/更新日時|
|autonomous_sources|source_id、URL、公開/取得日時、内容ハッシュ、取得元、本人確認状態。URL＋原文版を一意化|
|autonomous_documents|project_id＋revision UNIQUE、記事とSNS案、生成種別/モデル、出典参照、内容ハッシュ、品質結果|
|autonomous_reviews|review_id、案件/版/ハッシュ、本人、承認/差戻し/修正指示、日時。追記型|
|autonomous_reports|日付＋対象範囲 UNIQUE、ジョブ/原稿/収支の集計元、未取得項目、改善提案と根拠|
|autonomous_publications|案件/版/媒体 UNIQUE、承認ハッシュ、冪等キー、予約/取消/結果不明/失敗/公開ID。今回未接続|
|autonomous_budget|月/プロジェクト/通貨、確定消費、未精算予約、上限、確認時刻、停止状態。並列予約を原子的に処理|

索引はjob state＋next_retry_at、project_id＋更新日時、source版、日付、投稿stateに限定する。既存表との関係・アクセス権・保持期限・行数費用を確認してからDDLを別途承認する。個人データ・鍵は原稿やエラー列に入れない。

移行: 既存localStorageは削除しない。本人操作で端末データを書き出し、件数・版・ハッシュを検証、Previewへのdry-run差分を表示する。端末ID＋案件ID＋版＋ハッシュの一意キーで再インポートを冪等化。旧承認は自動的にサーバー承認にせず本人が再確認。クラウド読込成功後も旧保存を維持し、移行切替は段階実施する。

復旧: まず全ジョブと投稿を停止し、読み取りで障害範囲と最後の確定版を特定する。承認されたPreview限定のスナップショット/Time Travel等から別DBへ復旧・検証後、承認を得て切替する。復旧した投稿ジョブを自動再送せず外部公開IDと照合する。既存バックアップ、本番DBを今回操作しない。

## 実AI・品質・費用停止の設計

収集は引き続き許可した公式RSS/公開URLの取得処理とし、AIの記憶を事実ソースにしない。URL・公開日時・取得日時・引用箇所を保持する。要約、初心者向けnote記事、X/Instagram案、修正、品質チェック、報告/改善提案を別の生成タスクとして定義し、構造化出力・最大入出力・モデル固定・出典参照を検証する。指示文として読ませた外部記事によるプロンプト注入を防ぎ、外部資料からツール実行・投稿を許可しない。AI出力と本人確認済み事実は別状態。モックの完成は実AI品質確認の代わりにならない。

実接続にはサーバー側秘密値、専用プロジェクト、モデル権限、使用量の照合、最大出力、月額上限、予約枠、緊急停止が必要。アプリ上限は設定値だけでは保証にならない。他経路消費・請求遅延・未精算リクエストが不明なら新規生成を停止する。最悪額を原子的に予約し、残額が不足なら拒否。並列実行、再試行、税・換算・ツール料金も別枠で扱う。キーの失効・プロバイダー側停止とアプリ停止を併用する。金額アラートを強制停止とみなさない。現行AI_BUDGET_UNVERIFIEDガードは維持する。

ChatGPT Plus / Codex利用枠は外部アプリのAPI残高ではない。API用契約・請求・鍵は別管理。今回はAPIを呼ばず、AIポートはモックだけで検証している。

## 公式サービス調査と概算（月額・USD、税/為替別、調査時点）

例は月30案件、全生成工程の合計で1案件あたり入力10,000＋出力5,000トークン、合計入力30万＋出力15万。品質修正、推論、検索ツール、再試行、画像生成は追加になり得る。この見積りは上限保証でも現在の請求額でもない。

|候補|条件・概算・停止方法|
|---|---|
|OpenAI GPT-5.4 mini|公式単価入力$0.75/100万・出力$4.50/100万→例$0.90/月。Free tier非対応。API用課金確認が必要。キー失効＋アプリの予算停止|
|Claude Sonnet 5.5|入力$2/100万・出力$10/100万→例$2.10/月。継続無料枠を前提にしない。現行モデルを変更したわけではない。組織上限/鍵失効＋予約管理|
|Workers AI|無料10,000 neurons/日。Freeプランで超過時エラー。一部モデルは有料のみ。モデルごと換算・品質評価が必要。無料対象＋Freeのままに限定する設計を先に承認|
|Ollamaローカル|ローカルモデルなら従量API費不要。ただしPC/GPU・電気代・常時稼働・安全な接続環境が必要。端末停止で停止。24時間無料ホスティングとは扱わない|
|Cloudflare Workers/D1|Free枠内なら$0。Workers 100,000リクエスト/日、D1読取500万行/日・書込10万行/日・5GB。24時間HTTPサーバーを常駐するのでなく、将来の短時間Worker起動＋D1リースを候補とする。Paid選択ならWorkers最低$5/月＋超過。今回契約・Cron・Worker作成なし|
|X|従量・事前クレジット。作成$0.015/回、URL付き$0.200/回。例30リンク投稿=$6/月、対象条件を満たす自分のデータ読取$0.001/件を900件なら+$0.90。税・失敗/再試行等別。支出上限と自動チャージ無効を要確認|
|Instagram|公式公開ドキュメントだけで月額API料金を確定できず、料金未確認。画像/動画の制作・保存/配信は別途。無料と保証しない|
|note|個人一般向け無料投稿APIを利用できるとは確認できない。公式APIはnote pro法人向け・対応サービス契約が条件。API自体追加料なしでもnote proと対応サービスの料金が別途必要。月額は契約見積りが必要|
|アフィリエイト|登録/広告主審査・媒体条件・PR表記が必要。汎用の無料成果APIは未確認。まず手入力/公式管理画面の出力。報酬確定前を売上確定としない|

完全無料の現実的な開始範囲は、公開情報取得＋Previewモック作成＋端末保存＋本人承認＋手動公開＋手入力成果/収支。将来D1/Workerも無料枠内で設計できる可能性はあるが、現在アカウント全体の残枠・全サービスの課金上限は保証していない。自動運用の無料保証はしていない。

### 投稿・成果連携の条件

- **note:** note pro対象・契約対応サービス/連携パートナー条件を満たす場合に、作成/公開/更新とアクセスデータ取得が公式提供される。現ユーザーの資格は未確認。非公式内部API/ブラウザ自動投稿で代用しない。
- **X:** 開発者アプリ、ユーザーOAuth、書込/読込権限、料金・レート制限確認が必要。機械的重複・スパム禁止と利用規約に従う。閲覧/反応の取得権限と対象エンドポイントは実アプリで承認後に検証する。フォロワー全データ等を取得可能と仮定しない。
- **Instagram:** Business/Creator等のプロアカウント、OAuth、公開/insights権限と利用形態に応じた審査が必要。Instagram LoginとFacebook Loginで条件・権限が異なる（前者にFacebook Page必須と一律にはしない）。投稿には画像/動画が必要で、現在のテキスト案だけでは公開できない。公開メディアURL、権利、保存先が別途必要。API公開上限はローリング24時間100件、content_publishing_limitで確認する。利用可能なinsights指標は媒体・種別・API版による。
- **アフィリエイト:** A8等は媒体登録と各広告主の承認、SNS掲載条件、広告表示/PR、リンク取り扱いを確認する。大量自動提携申請はしない。収益を保証しない。

将来の自動公開は、保存された「本人承認済み特定版＋内容ハッシュ」だけをoutboxに登録し、編集で承認を解除する。媒体＋案件＋版の一意キー、送信前取消、外部ID保存、結果不明時の照合、失敗通知が必須。公開後の取消は削除権限・実際の外部結果確認が必要で、取消依頼だけで削除済みと表示しない。承認しても今回は外部投稿しない。

## 推奨順序と必要承認

1. 現Previewで報告・下書き・承認フローを本人確認（モック、無料公開情報、現在の端末保存）。
2. 新スキーマ/移行/復旧設計を承認後、Preview専用クラウド保存とサーバー認証・フェンス付き排他を実装する。
3. 利用モデル、月額上限、専用キー・他経路消費の把握・停止手段を承認。上限を検証できる場合だけ、本人承認済みの最小1回AIテストを別作業で行う。
4. クラウド再開と費用停止を検証してから、Preview限定スケジューラー/必要Bindingsを別途承認し段階起動。日次1案件から始める。無制限の24時間ループにしない。
5. 投稿は当面本人がコピーして手動公開。媒体契約・審査・OAuth・画像素材・費用の承認後、承認特定版の公式連携だけを追加する。
6. 公式成果取得・改善案・日次通知を追加する。収益をAI推定で確定しない。

### 公式出典

- [OpenAI GPT-5.4 mini・料金](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
- [ChatGPT PlusとAPI課金の違い](https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus)
- [Claude API料金](https://platform.claude.com/docs/en/about-claude/pricing)
- [Workers料金](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1料金](https://developers.cloudflare.com/d1/platform/pricing/)
- [Workers AI料金](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [X API料金](https://docs.x.com/x-api/getting-started/pricing)
- [Instagram公式公開手順](https://developers.facebook.com/documentation/instagram-platform/content-publishing)
- [Instagram API変更履歴](https://developers.facebook.com/docs/instagram/platform/instagram-api/changelog/)
- [Instagram公式IG User参照](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/v21.0/)
- [note公式APIの提供対象](https://www.help-note.com/hc/ja/articles/46643492548121-noteが公式で公開しているAPIはありますか)
- [A8メディア利用規約](https://www.a8.net/compliance/media-userpolicy.php)
- [A8禁止事項](https://www.a8.net/compliance/prohibited-matter.php)
- [A8広告表示](https://www.a8.net/compliance/prNotation-urlSubmission.php)

## 重点検証

- ネットワークを禁止した単体検証: 排他、重複排除、6段階の完了、保存後失敗からの再開、実AI/定期起動/未接続DB/投稿の拒否、セッション/CSRF、既存の課金停止。
- ローカルHTTPSブラウザ検証（デスクトップ/モバイル幅）: 模擬認証、再読込後のセッションと保存、6段階ジョブ、重複、取得エラーと手動再試行、修正/差戻し/再承認、ログアウト、秘密値を端末保存しないこと。
- ブラウザ検証では外部RSSとAIをモック化し、実管理パスワード・有料API・D1は使わない。iPhone実機Safariや本物の管理ログインの実行確認とは区別する。
