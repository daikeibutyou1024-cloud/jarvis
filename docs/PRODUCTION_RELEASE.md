# J.A.R.V.I.S. 初期版 Production移行・復旧手順

2026-11-17。対象は `feature/ai-business-rebuild`。最新HOME修正 `73596bc` を基準に、前回の未commit作業を退避・統合した。本書・SQL・自動化スクリプトの作成は本番への反映ではない。Production、main、実DB、バックアップは今回変更しない。

## 反映範囲と運用制限

青い球体を最上部にする最新HOME、音声操作、5部門、業務報告・承認・履歴、手動の記事・収支保存を維持する。現在・時間別天気と雨雲レーダーは独立した `assets/weather.js` から従来と同じ固定地点の無料公開先を利用し、Googleのプログラムに依存しない。気象の真偽や可用性を保証しない。取得失敗時は古い予報を消して取得失敗と表示し、雨雲は詳細を開いた時だけ取得する。APIキーや位置情報の追加取得、課金契約、定期ポーリングはない。

カレンダー・動画へのメニューは出さない。旧HTML、画像、Google/R2/動画プログラムは保持するが、旧ページURLはHOMEへリダイレクトし、旧外部連携APIは停止する。動画の保存済みIndexedDB、localStorage、Googleトークン、バックアップは削除・移行しない。動画ページの欠けたボタン参照による初期化停止を修正し、URLの指令からAI生成を自動クリックする処理を手動待ちへ変更した。復元した画面は退役コードのローカル回帰テストでのみ直接開く。

**本番の実AIは停止したまま。** Claude/OpenAIを呼ばず、音声の入力・読み上げと手動編集は残す。Previewのモック会話・記事生成は本番で403、クラウドのモックジョブ起動・モック修正も403。Productionセッション応答に基づきモック選択・起動を無効化する。既存実AI実装はGitおよび `lib/legacy-chat.js` に保持するが有効化しない。実AI会話の実運用には、別途明示承認と残高・他経路利用・費用上限の確認が必要。「API課金なしで実AIが使える」「Previewモックが本番AI」とは扱わない。

本番の定期収集・モック自動化APIも拒否する。Cron、投稿、無人運転、外部販売や決済は一切開始しない。初期版の承認は、この手動運用・実AI停止の範囲を明記して得る。実AI会話を必須にする全面稼働の承認とは区別する。

## 接続先・設定

- Cloudflareアカウント: `a58aa91d4347b0a3691d51d2e382a392`
- Pagesプロジェクト: `asset-simulator`（サブドメイン名と異なる）
- Productionホスト: `asset-simulator-87y.pages.dev`、branch `main`
- Preview: `feature-ai-business-rebuild.asset-simulator-87y.pages.dev`
- Preview DB: `jarvis-preview` / `5ec09d38-2ed8-4c7a-ba67-bfd9c2ed32d0`
- Production DB: `jarvis-calendar` / `4cae3d2a-eff6-4a1d-871e-56491bdf082a`

今回の直接照会はPages/D1メタデータだけ。**Production実DBにはSELECTを含めSQLを実行しない。** 現行スキーマの最終照合は明示承認後、書込前の必須停止条件にする。前回読取で観測された既存7ユーザーテーブルとGoogleの列定義は参考情報であり、現在値の保証ではない。

承認後、Productionにだけ追加する値:

|キー|値|目的|
|---|---|---|
|JARVIS_RELEASE_ID|jarvis-initial-v1|本番を明示的に解放する固定識別子|
|JARVIS_CLOUD_DB_ID|上記Production DB ID|Previewへの誤接続拒否|
|PREVIEW_MOCK_AUTOMATION_ENABLED|false|モック自動化停止・保存先ガード|
|COLLECTION_AUTOMATION_ENABLED|false|定期収集停止|
|JARVIS_MEMORY_ENABLED|false|今回未適用の追加記憶を停止|

`CF_PAGES_BRANCH` / `CF_PAGES_URL` はCloudflare提供値を使う。既存の管理パスワード、暗号化キー、AIキー、Google設定、JARVIS_DB binding、料金プランは変更しない。パスワードが変わるとクラウドownerも変わるためローテーションを混ぜない。設定更新後は旧値のメタデータ・binding・互換日付を照合してからmainを進める。

認証は8時間の署名付きHttpOnly/Secure/SameSite=StrictホストCookie。同一オリジン・正しいbranch/host/runtime URL・サーバー設定・DB内識別行が揃わなければ停止する。Preview CookieをProductionへ流用しない。クライアントが送る環境名・ownerやURLで解放しない。

## SQLの必要性と互換性

旧案20表・7索引は採用しない。初期版に不要な `jarvis_memories` と `collection_schedules` / `collection_runs` / `research_inbox` は除外した。記憶と定期収集はAPI側でも停止。日次報告は未作成の収集表を未接続として扱う。

今回準備するのは **新規16表・明示6索引**（PK/UNIQUEのSQLite自動索引は別）。

|SQL|追加表と必要性|
|---|---|
|release/production-cloud.sql|autonomous_projects/jobs/sources/documents/reviews/reports の6表。案件・原情報・原稿版・承認履歴・排他・日本時間報告。4索引|
|release/production-business.sql|document_revisions、editorial_reviews、paid_content_drafts の3表。既存の手動CONTENT保存・有料記事下書き・版と確認記録|
|同上|business_records/history/imports/write_guards の4表。収益・経費・成果の手動記録、追記履歴、競合と操作IDの保護。1索引|
|同上|business_job_generations の1表。既存business_jobsの原稿メタデータを分離して保持。既存表のstatus制約を変更しない|
|同上|ai_operations、ai_reconciliations の2表。既存の費用表示・手動照合コードが初回アクセス時に作る表を事前に明示化。実AIの有効化や請求確定を意味しない。1索引|

両SQLは追加専用。既存表へのALTER/DROP/DELETE/UPDATEはない。INSERTは新しいautonomous_reportsへのProduction識別行1件だけ。Previewのデータ・承認をコピーしない。既存端末データも自動アップロードしない。

同名表・索引の存在、既存列の不一致、別DB ID、使用枠や料金条件の不明点があれば書込を止める。SQLは一括トランザクションで実行し、途中失敗を部分適用扱いにしない。既存migrationsディレクトリの一括適用は禁止。適用前後に既存表の定義・件数・正規化SHA-256を比較し、`_cf_KV` の内容は取得・変更しない。

## 承認前にできる自動確認

```sh
npm test
python scripts/production-release.py --plan work/production-plan.json
```

後者は **メタデータGETだけ**。本番SQLや更新・配備をしない。git SHA、mainの基準SHA、本番配備ID、設定ハッシュ、SQLハッシュ、追加表/索引一覧を固定した計画を作る。未確認の証拠欄はfalseのままにする。計画をリポジトリにcommitしない（`work/`は除外済み）。

Playwrightが用意されている環境で、以下をPCと `MOBILE_TEST=1` の両方で実施する。`home-weather-browser.mjs` は1440/390/375pxを同一実行で検証する。外部応答・気象画像・資格情報・DBは模擬で、実有料APIや本番D1は使わない。

```sh
node tests/home-weather-browser.mjs
node tests/cloud-workspace-browser.mjs
node tests/production-browser.mjs
node tests/legacy-preservation-browser.mjs
node tests/voice-conversation-browser.mjs
```

## 承認後の順序（今回は実行しない）

1. 候補commitとSQL一覧・制限付き運用範囲を利用者が明示承認する。実Previewの本人ログイン後保存/再読込/承認履歴、天気、iPhoneの音声確認が未完なら証拠をtrueにしない。
2. `release/production-evidence.example.json` をworkへコピーし、新しい計画と候補の単体/PC/スマホテスト成功を証拠JSONに記録。`tested_commit`、`unit_failed:0`、`unit_passed`、`desktop_passed:true`、`mobile_passed:true` と計画のrequired_evidence各項目を事実に基づいて設定する。
3. 明示承認後、Production DBの実定義・既存行ハッシュを読取。追加16表に同名表があれば、二重適用せず停止して互換性をレビュー。全索引名の重複も停止。既存Google・jobs・研究キャッシュの行は更新しない。
4. 新規SQLだけをProduction DB ID固定で適用。旧データ不変を照合。通常のjobs/費用GETも本番では自動中断整理やスキーマ作成をせず、既存行を読み取りだけにする。既存管理パスワードを保持して必要設定だけ追加し、旧設定・bindingの保持を再確認する。
5. mainが計画時のSHAのまま、開発branchが承認SHAと同じ、テスト成功である場合だけ非forceのfast-forward push。本番Gitビルドが成功したことをAPIで確認する。
6. 実配備のbranch/commit/Production DB binding/停止フラグを照合。本人ログイン、保存→再読込→版参照→承認→手動編集で承認解除、期限切れ・別origin拒否を確認する。天気・音声・収支の手動記録、カレンダー/動画の非表示、実AI/モック/Cron停止も確認する。検証は新規専用案件だけで行い、既存データを編集しない。

以下は最終承認後に限る:

```sh
python scripts/production-release.py --plan work/production-plan.json \
  --apply-approved-commit <承認された完全SHA> --evidence work/production-evidence.json
```

スクリプトは証拠不足・候補不一致・計画/設定の変化・テスト失敗・mainの変化で停止する。mainへのpush後の配備完了待ちと実機検証は、成功扱いに省略しない。

## 復旧・中断

- 配備失敗時は旧Production配備を維持。新コードが公開された後の重大不具合は、計画に記録した前配備へPagesコードだけロールバックする。mainのforce巻戻し、DBバックアップへの上書きはしない。
- ロールバック後も新規16表と保存済み原稿・承認履歴・収支を残す。旧コードはそれらを使用しない。新表をDROPして戻す方法は禁止。
- DB適用後に設定更新やpushが失敗しても自動で再適用・削除しない。適用済みスキーマと識別行、旧データハッシュを承認範囲で確認し、既存表扱いの互換性レビューから再開する。
- 保存結果が不明ならまず再取得し、同じmutation IDの再送で確定結果を回収する。異なる本文・古い版は409として止める。未保存編集は退避し、自動無限再試行しない。
- 実D1の災害復旧・バックアップ復元は今回のコードロールバックと別。既存バックアップは変更しない。

コードだけのロールバックも明示承認後、計画に固定した旧配備IDで行う:

```sh
python scripts/production-release.py --plan work/production-plan.json \
  --rollback-approved-deployment <計画に固定した旧Production配備ID>
```

## 残る実環境確認

ローカルの合成資格情報・SQLite・模擬天気応答の成功は、実管理ログインや実機Safariの成功ではない。現在の環境はPreviewホストへのHTTP通信が許可されておらず、管理パスワードも取得不能。実Previewで本人がログインして行う保存・音声確認は未検証と明示する。Productionの実DBスキーマは今回SQL禁止のため承認後確認に残す。実AI会話の費用・認証・応答品質は未検証で、今回は起動しない。

## 今回の検証記録

- 単体324件成功・失敗0・skip 0。原稿、承認、収支、費用保護、環境分離を含む。旧AI内部処理の模擬テストは既存のテスト専用loaderを使い、実ルートの費用停止は無加工のコードで別途確認する。
- HOMEは1440/390/375px、球体と状態表示は320/375/390/430/768/1440pxで確認。iPhone Safariエンジンや実マイクの確認ではない。
- Preview想定のPC/スマホで保存・再読込・承認/修正・版参照・保存障害からの再取得/再送・旧端末データ保持を確認。
- Production想定の使い捨てDBと実セッション応答で、モックUI停止・手動編集/承認/再読込をPC/スマホで確認。認証待ちの原稿選択中は編集をロックし、入力の上書きを防止する。
- 実Preview D1では新規テストownerだけを使い、4版の保存・承認履歴・重複防止・競合拒否・同操作再送・応答喪失復旧・制約失敗のロールバック・リース期限/フェンスを再確認した。テスト行は新規表に保持し、削除しない。
- 退役動画画面の初期化、既存localStorage保持、音声の状態遷移/二重送信防止/停止、RESEARCH→CONTENT→MARKETINGの既存フローが成功。実課金API・外部投稿は未実行。
- Functionsビルド成功。Production/main/本番D1/バックアップは変更しない。本番へのSQLはSELECTを含め今回未実行。
