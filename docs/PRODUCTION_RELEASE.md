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

1. 候補commitとSQL一覧・制限付き運用範囲、安全復旧bundleを利用者が明示承認する。実Previewの本人ログイン後保存/再読込/承認履歴、天気、iPhoneの音声確認が未完なら証拠をtrueにしない。
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

## 復旧・中断（2026-11-18 改訂）

**658b3bcと既存の旧Pages配備は安全な復旧先ではない。** 旧実AIコードと当時の資格情報が動く可能性があるため、Pagesの過去配備への直接rollbackは禁止する。計画中の `production_deployment` は監査用の現在値であり、許可された復旧先ではない。`--rollback-approved-deployment` はIDが一致していてもCloudflareへ要求せず停止する。

安全な復旧先は、本リリースcommitに固定した `jarvis-readonly-no-ai-v1` バンドル。`release/recovery/worker-template.mjs` と `index.html` だけから作り、Pages advanced modeの `_worker.js` が応答する。旧Functions・Netlify Functionsを含めず、旧コードへ制御を渡さない。旧画面が既に別タブに残っていても、復旧先に届くAPI要求はこのworkerで拒否する。認証済みCookie・パスワード・APIキー・AI有効化フラグがあっても、すべてのAPI・更新要求は503。D1/R2/外部fetchを使わず、画面のCSPでもscript/connectを拒否する。復旧画面はパスワード入力も要求しない。

復旧版は一時的な案内画面。天気・音声・編集・保存は停止するが、クラウドDB・localStorage・IndexedDB・未保存の別タブを削除しない。旧UIを再利用したい場合も、未対策の旧workerを有効にする方法は不可。新たに検証・承認された復旧bundleを用意する。

候補をcommitした後、ローカルだけで生成・照合する（配備はしない）:

```sh
python scripts/prepare-safe-recovery.py --source-commit <候補の完全SHA> \
  --output work/safe-recovery/<候補の完全SHA>
python scripts/prepare-safe-recovery.py --verify --source-commit <候補の完全SHA> \
  --output work/safe-recovery/<候補の完全SHA>
```

Gitの固定commitからだけ生成し、worker/HTML・ZIPのSHA-256とファイル一覧をmanifestへ記録する。ローカルMiniflare/workerdが用意されている場合は `node tests/safe-recovery-runtime.mjs work/safe-recovery/<候補の完全SHA>` で実ランタイムの認証済みAPI阻止も検査する（リモート接続なし）。改変・余分な旧Functions・別commit・658b3bcを拒否する。既存の出力も上書きしない。通常のPreviewはこの復旧モードへ切り替わらない。

本番移行用の証拠JSONには `safe_recovery_bundle_verified:true` と `recovery_bundle_path` を記録する。移行スクリプト自身も承認SHAとの一致・全ファイル/ZIPのハッシュを、Productionへの最初の変更前に再検証する。チェック済みと申告するだけでは通らない。

障害時は別途明示承認を得て、この検証済みbundleの `public/` を同じPagesプロジェクトへ新しいProduction配備として公開する。**今回は実行しない。** 例えば承認後に限り:

```sh
# まず上記verifyを固定SHAで実行し、manifestを照合する。
CLOUDFLARE_ACCOUNT_ID=a58aa91d4347b0a3691d51d2e382a392 \
CLOUDFLARE_API_TOKEN="$CLOUDFLARE_PAGES_EDIT_TOKEN" \
wrangler pages deploy work/safe-recovery/<承認SHA>/public \
  --project-name asset-simulator --branch main
```

これはmainへのpushや過去配備の再有効化ではない。復旧配備の成功、`/__recovery__` のpolicy、認証済みAPI要求が503になることを確認し、新しい復旧配備IDを記録する。元のDB bindingやAIキーが残っていても復旧workerは一切読まない。Productionへ実配備しての確認は未実施。

- 新規16表と保存済み原稿・承認履歴・収支は残す。DROPやバックアップへの上書きで戻す方法は禁止。
- DB適用後に設定更新やpushが失敗しても自動で再適用・削除しない。承認範囲で既存スキーマとハッシュを確認して再開する。
- 保存結果が不明ならまず再取得し、同じmutation IDで確定結果を回収する。異なる本文・古い版は409として止め、未保存編集は退避する。
- 復旧前の未保存入力が残る別タブは閉じず、利用者がコピー退避する。復旧workerは未保存入力を回収できない。
- 実D1の災害復旧・バックアップ復元は別の承認事項。既存バックアップは変更しない。
- Cloudflare管理画面から人が禁止された旧配備を直接選ぶ操作まで、アプリ内コードでは無効化できない。管理画面・別CLIでの旧rollbackも禁止し、全復旧を上記bundleに統一する。

## 残る実環境確認

ローカルの合成資格情報・SQLite・模擬天気応答の成功は、実管理ログインや実機Safariの成功ではない。現在の環境はPreviewホストへのHTTP通信が許可されておらず、管理パスワードも取得不能。天気・時間別予報・雨雲、音声入力/読み上げ、記事保存/再読込、D1履歴は2026-11-18に利用者が実機確認済みと報告。本環境からの実管理ログインを実行したとは扱わない。Productionの実DBスキーマは今回SQL禁止のため承認後確認に残す。実AI会話の費用・認証・応答品質は未検証で、今回は起動しない。

## 今回の検証記録

- 単体324件成功・失敗0・skip 0。原稿、承認、収支、費用保護、環境分離を含む。旧AI内部処理の模擬テストは既存のテスト専用loaderを使い、実ルートの費用停止は無加工のコードで別途確認する。
- HOMEは1440/390/375px、球体と状態表示は320/375/390/430/768/1440pxで確認。iPhone Safariエンジンや実マイクの確認ではない。
- Preview想定のPC/スマホで保存・再読込・承認/修正・版参照・保存障害からの再取得/再送・旧端末データ保持を確認。
- Production想定の使い捨てDBと実セッション応答で、モックUI停止・手動編集/承認/再読込をPC/スマホで確認。認証待ちの原稿選択中は編集をロックし、入力の上書きを防止する。
- 実Preview D1では新規テストownerだけを使い、4版の保存・承認履歴・重複防止・競合拒否・同操作再送・応答喪失復旧・制約失敗のロールバック・リース期限/フェンスを再確認した。テスト行は新規表に保持し、削除しない。
- 退役動画画面の初期化、既存localStorage保持、音声の状態遷移/二重送信防止/停止、RESEARCH→CONTENT→MARKETINGの既存フローが成功。実課金API・外部投稿は未実行。
- Functionsビルド成功。Production/main/本番D1/バックアップは変更しない。本番へのSQLはSELECTを含め今回未実行。

## 2026-11-18 公開前点検の是正

旧配備へのrollback経路を拒否し、固定commit由来の実AI停止・読み取り専用復旧bundleへ変更した。認証済みの合成Productionセッション、旧パスワードヘッダー、APIキー、有効化フラグを与えても、復旧workerの外部通信とbinding参照は0件。改変・旧Functions混入・別commitを拒否する。Productionでの復旧実行は行わない。

球体の回帰テストは、認証後にハンズフリー音声認識を始める現仕様へ更新。PC/スマホで6幅の配置、待機の青・録音の赤・異常の橙、考慮中・読み上げ、球体による停止、停止後の古いイベントの拒否を模擬応答で確認する。実Claude/OpenAIは呼ばない。

今回の追加後は単体332件が成功。球体のPC/スマホ回帰、通常の保存・承認・復旧、天気の3幅表示も成功。復旧bundleは本番へ配備せず、固定commitから生成・照合して保管する。

復旧workerはローカルworkerdでも、認証済みの6つのAPI経路を503で拒否し、外部通信・旧ASSETS/backend呼出しがともに0件であることを確認した。Productionでは未実行。
