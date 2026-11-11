# 本番反映を妨げている項目の確認（2026-11-11）

対象はfeature/ai-business-rebuild。本書は本番反映の承認ではない。main・Production・バックアップの変更、実Claude/OpenAI API、追加契約、定期起動の有効化は行っていない。

## 今回確認できた事実

| 項目 | 結果 | 限界 |
|---|---|---|
| Cloudflareの接続 | 管理画面が/loginに遷移。専用接続の検索結果なし。実行環境から使える認証情報も未確認 | 実DB ID・無料枠・実環境変数を確認できていない |
| Previewの認証・保存・再読込 | 未実施。DB分離未確認のため書き込まなかった | Previewの表示確認を保存検証済みとは扱わない |
| note制作から承認 | 使い捨てSQLiteと実PagesハンドラーへHTTP要求する一連検証に成功 | リモートPreviewと実D1、ブラウザDOMの検証ではない |
| 月額AI予算 | 公式価格を参照した準備用計画と設定計算を用意。月額上限・導入前利用額は未決定 | 設定を適用せず、実APIは呼んでいない |
| ブラウザ実行環境 | Unixソケットの作成がEPERM。Chromiumも同じ箇所で起動不能。共有ブラウザからローカル検証サーバーは接続拒否 | 本環境でのブラウザE2E成功とは報告しない。制限を回避・緩和していない |

## 1. D1分離の確認に必要なもの

優先する方法は、対象Cloudflareアカウントへ利用者が安全にログインすること。パスワード・2FAをチャットやGitへ貼らない。閲覧権限で対象PagesプロジェクトのSettings → Bindingsを、ProductionとPreviewそれぞれ確認する。

- バインディング名は既存のJARVIS_DBを維持する。
- ProductionのDB IDとPreviewのDB IDを両方記録し、異なることを確認する。名前が違うだけでは分離確認としない。
- Preview側が未設定・継承扱いなら未確認。Productionと同じIDなら書込検証を開始しない。
- GitHubチェックが示すPagesプロジェクト名はasset-simulator。アカウントと連携リポジトリdaikeibutyou1024-cloud/jarvisを管理画面で照合する。ドメイン名だけから設定を推測しない。
- 現行の開発ブランチPreviewの配備にもその設定が適用されていることを確認する。設定画面の比較だけで実行中の配備のバインディングまで検証したとは扱わない。
- 同じDBだった場合、Preview専用D1の用意とPreviewのバインディング変更が必要。無料枠・既存データの扱いを確認してから別途判断する。Production側を変更しない。

CLIで読取確認する場合は、対象アカウント限定のCloudflare Pages ReadとD1 Readのトークンを安全な実行環境へ設定する。Edit・SQL実行・デプロイ権限は不要。必要な変数名はCLOUDFLARE_ACCOUNT_ID、CLOUDFLARE_PAGES_PROJECT、CLOUDFLARE_API_TOKEN。トークン値を出力・保存しない。

```bash
npm run check:preview-config
```

scripts/check-preview-config.mjsは固定のapi.cloudflare.comへGETだけを送る。Pages設定とD1のメタデータを最大3要求で確認し、DB内容のSQL取得・更新・自動再試行をしない。環境変数は有無のみを報告し、値・生のAPI応答は出力しない。プロキシを使う環境ではNode 24のNODE_USE_ENV_PROXY=1を起動時に設定し、既存のプロキシ・CA設定を維持する。接続先へのネットワーク許可も必要。

認証情報がなければblocked・exit 2で終了し、外部要求は0件。configuration_checked_onlyも配備時設定や実DB操作の検証完了ではない。

## 2. 実Previewでの認証・保存・再読込とnote制作

次の条件がそろってから実行する。実際のPreview操作は今回行っていない。

- DB分離と現行Preview配備の設定を確認済み。
- Cloudflareの実利用枠・追加課金がないことを確認済み。
- PreviewのJARVIS_ACCESS_PASSWORDを安全なブラウザ入力または秘密設定で利用できる。
- 開発ブランチのコミットに対応するPreview URLを使用。mainのURLを使わない。

手順:

1. 未認証・誤った認証では読取/保存できず、原稿が追加されないことを確認する。
2. 検証専用の案件ID・題名で、架空の無料note原稿を手入力する。AI生成・続き生成・チャットは押さない。
3. 制作案件を保存し、版1を確認する。ページを再読込して認証し直し、制作一覧から同じ案件を開く。本文・資料・企画・構成が一致することを確認する。
4. 5項目の全文確認をして承認し、Markdownを出力する。外部へ投稿・販売しない。
5. 本文を修正して版2を保存し、版1の承認を使い回せないこと、再読込して版2が保持されることを確認する。
6. 有料noteも架空の資料・本文・テンプレートで保存・再読込・承認・無料/有料部分の出力を確認する。未完成の原稿は承認できないことを確認する。
7. 別タブの古い版からの保存は409で停止し、最新版と古い版が保持されることを確認する。

検証案件は自動で削除しない。記録したDB ID、配備コミット、案件ID、各版、確認日時、成否を残す。実D1のバックアップ/復元はこの流れとは別に確認する。バックアップブランチは変更しない。

## 3. 月額AI予算の導入準備

config/preview-ai-budget.plan.jsonは準備用のファイルで、自動適用されない。秘密は含めない。Claude Sonnet 4.6の通常料金は公式資料で確認した入力3 USD/100万トークン・出力15 USD/100万トークンを記載した。コードの料金単位とも照合済み。モデル・契約・キャッシュ・料金変更で条件が変わり得るので、実際の適用時にも公式価格を確認する。

```bash
npm run check:ai-budget-plan
```

月額上限と導入前利用額がnullの間はdecisions_required・exit 2となり、適用用の変数を出力しない。準備に必要な利用者の判断・情報は次の2点。

- approvedMonthlyBudgetUSD: 利用者が承認する月額上限（USDの文字列）。0ならAI停止を維持する。勝手に金額を決めない。
- verifiedOpeningSpendUSD: UTCの今月に、アプリの利用台帳の外で既に使った額。入金残高と区別し、台帳と二重計上しないよう請求履歴で照合する。不明なら再開しない。

計算はaiConfigを呼ぶだけで、API接続・D1・秘密・設定変更はない。サンプル要求の予約額は実際の原稿や実請求ではない。prepared_not_appliedも適用済み・実行可能を意味しない。実際の残枠・前月未確定・プロバイダー側の上限も別途確認する。

準備後も、まずPreviewのAI_MONTHLY_BUDGET_USD=0を維持し、認証・手入力保存の検証を先に済ませる。Productionの環境変数は変更しない。実Claude API禁止が解除されるまでは、動作確認のための生成要求も送らない。

## 4. ブラウザ検証の実行環境

実行可能な環境の条件は、Node 24、Playwright 1.62.1、対応Chromium、UnixソケットとローカルTCPの利用、Chromiumの通常起動が許可されていること。今回OSのセキュリティ制限を変えていない。

既存の作業環境固有パスに依存しない実行入口を追加した。通常のローカルPlaywrightを優先し、管理環境ではCODEX_PRIMARY_RUNTIME_NODE_MODULESも参照する。CHROMIUM_PATHで既に導入されたChromiumを指定できる。自動インストールや外部CIの有効化はしない。

```bash
npm run test:release-http
npm run test:release-browser
```

ブラウザに必要な依存を別の許可済み開発環境へ用意する場合の例:

```bash
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install chromium
npm run test:release-browser
```

実行環境のOS依存パッケージはPlaywright公式手順を参照する。上記のインストールは今回実行していない。

- HTTP版は認証・無料noteの保存/再取得/承認/出力/修正後の承認失効/競合、有料noteの保存/再取得/承認/分割出力を実Pagesハンドラーと使い捨てSQLiteで確認する。今回成功、外部要求0件。
- ブラウザ版はローカル専用サーバーを自動起動し、無料記事をUIで保存・再読込・承認・出力・修正、有料記事を実HTTPで模擬データ保存後にUIで再開・承認・出力する。外部通信を遮断し、実Preview URLを受け付けない。今回はBROWSER_ENV_BLOCKEDで未実行。
- サーバーは127.0.0.1のみ、APIキーなし、AI予算0、収集停止、実fetch禁止。静的ファイルはindex.html/assets/libに限定し、実行時の環境の秘密やDBを取り込まない。終了時に使い捨てDBを閉じる。

環境で禁止された場合はblocked・exit 2を返し、成功扱いしない。ブラウザE2Eの成功やローカルHTTPの成功を実Previewの検証完了と置き換えない。

## 参照した公式仕様

- https://developers.cloudflare.com/pages/functions/bindings/
- https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/get/
- https://developers.cloudflare.com/fundamentals/api/reference/permissions/
- https://platform.claude.com/docs/en/about-claude/pricing
- https://playwright.dev/docs/browsers
- https://playwright.dev/docs/ci
