# J.A.R.V.I.S. AI副業司令室

開発ブランチ: `feature/ai-business-rebuild`。main・`backup-before-business-rebuild-2026-11-09` は保持。本番公開・自動投稿なし。

## 構成と機能
- `index.html` / `assets/`: 5部門、青い球体、音声入力・読み上げ、AI会話、編集可能な下書き。
- RESEARCH 3.0: 官公庁RSS・GitHub、許可された公式記事本文、比較資料、AI仮説の企画評価、確認済み資料とCONTENT引き継ぎ。任意URL巡回なし。
- CONTENT: note・アフィリエイト記事・X・Instagram・TikTokの下書き。
- MARKETING: 集客・CTA・広告導線の設計。投稿・提携登録なし。
- ANALYTICS: 月次アクセス・クリック・成果を手入力、CTR・成果率を集計。旧端末保存と認証付きD1共有記録に対応。
- FINANCE: 円建ての売上・経費・API費用を手入力し、入力差額を集計。旧端末保存と認証付きD1共有記録に対応。実利益・API請求の自動取得なし。
- `functions/api/chat.js`: 既存認証・Claude既定・OpenAI切替を維持。
- `functions/api/research/collect.js`: 固定接続先の無料取得・D1共有制限・キャッシュ（詳細はdocs/RESEARCH_2.md）。
- `functions/api/business/jobs.js`: 全部門のAI下書きを既存D1のbusiness_jobsへ保存・最新20件取得。
- `business-lab.html`: CONTENTへの移動用に保持。

## ローカル開発
静的表示のみ: `python3 -m http.server 8080`。
API付き: `npx wrangler pages dev . --d1 JARVIS_DB --persist-to work/d1`（Wranglerが必要）。
既存のWrangler設定がある環境では、その設定のD1 IDを使ってローカルD1に `migrations/0001_business_jobs.sql` を適用してから使用。設定のない環境ではローカル専用のD1設定を用意し、Pages側と同じID・保存先を指定する。business_jobsのリモートDBへの自動適用はしない。RESEARCH用の独立テーブルは認証付き取得の初回に作成する。
`npm test` で単体テスト（Node.js 22.13以降、開発では24）。ブラウザ検証は `node tests/browser.mjs` と `node tests/research-browser.mjs`（Playwright・Chromiumが必要、静的サーバーを8080で起動）。

## Cloudflare設定（既存名を維持）
- `JARVIS_ACCESS_PASSWORD`: 共通認証パスワード。
- `ANTHROPIC_API_KEY`、任意 `ANTHROPIC_MODEL`（既定claude-sonnet-4-6）。
- `AI_PROVIDER`: 既定anthropic。openaiの場合 `OPENAI_API_KEY`、任意 `OPENAI_MODEL`。
- `JARVIS_DB`: 既存D1バインディング。business_jobsテーブルの構造は変更しない。

アクセス用パスワードはこのタブのメモリ内のみ保持。APIキーはブラウザへ渡さない。
旧端末下書きのキーは維持。クラウド生成はUTC日次5回（失敗含む）、単一INSERTの条件で枠を予約。
AI利用は通常会話・生成・企画を合算してUTC日次10回、企画は2回、クラウド記事は5回まで（失敗含む）。既存API料金が発生する。利用回数を確保できないD1未接続時はAI呼び出しを停止する。
旧Googleテーブルやトークン・R2データは削除しない。旧画面・動画・Google API・Netlify重複実装はGit履歴とバックアップブランチに保持。

## 検証の限界
実API課金・本番認証・リモートD1・音声デバイスはローカルの模擬テストでは検証できない。
Preview連携により開発ブランチへのpushでPreviewを更新する。本番mainへのpush・マージ・本番公開は行わない。

RESEARCH 2.0の利用手順・取り込み仕様・制限・検証範囲は [docs/RESEARCH_2.md](docs/RESEARCH_2.md) を参照。

RESEARCH 3.0の本文取得・企画評価・利用回数制限は [docs/RESEARCH_3.md](docs/RESEARCH_3.md) を参照。

CONTENTの未完成状態・章/続き生成・資料更新確認は [docs/CONTENT_COMPLETION_FIX.md](docs/CONTENT_COMPLETION_FIX.md) を参照。

続き生成専用の指示・重複検査・原稿保護は [docs/CONTENT_CONTINUATION_FIX.md](docs/CONTENT_CONTINUATION_FIX.md) を参照。

有料記事の制作手順と制限: [PAID_CONTENT_WORKFLOW.md](docs/PAID_CONTENT_WORKFLOW.md)

## 保存・費用管理

案件ID・原稿の版履歴、保存競合の拒否、共通AIタイムアウトと中断記録、USD月額予算の事前予約を追加。全形式のAIを使わないクラウド保存に対応。
**PreviewでAIを使う前に `AI_MONTHLY_BUDGET_USD` と `AI_PRICING_JSON` の設定が必要。未設定では課金呼び出しを停止する。** 請求実額の自動取得ではない。
旧データの扱い・料金設定・照合・検証範囲は [STABILITY.md](docs/STABILITY.md) を参照。

## note記事の制作フロー

資料・企画・構成・本文を案件として保存・再開し、章の不足一覧から補完できます。保存原稿からの長文章再開、版ごとの人間の全文確認、確認済みMarkdown出力、制作・確認待ち一覧を追加。自動公開・販売は行いません。
手順・互換性・検証範囲は [EDITORIAL_WORKFLOW.md](docs/EDITORIAL_WORKFLOW.md) を参照。

## 定期収集・運用状況

収集設定・重複防止と中断管理・未確認資料の受信箱・日本時間の日次運用レポートを追加。AIの定期生成や外部投稿は行わず、全体停止が既定。起動元のひな型は未配備・未有効化です。
[COLLECTION_AUTOMATION.md](docs/COLLECTION_AUTOMATION.md) と [本番反映の判断](docs/RELEASE_READINESS.md) を参照。

## 公開準備・共有収支と成果

全文確認済みの保存版から公開用本文と未確認の告知案を取り出し、利用者が手動公開したURLを申告として記録できます。外部への投稿・販売・実績照合は行いません。
認証付きの収支・成果記録には版履歴、競合拒否、取消・復元を用意。旧端末データは明示操作でコピーし、元データを保持します。CSV取り込みと現行値のJSONコピーに対応します。
手順・形式・移行の限界は [SHARED_BUSINESS_RECORDS.md](docs/SHARED_BUSINESS_RECORDS.md) を参照。

## 運用開始前の確認

認証付きの読取専用診断で、保存先の必須列・AIの設定形式と停止条件・定期収集の開始条件を確認できます。データ作成・修復・AI呼出・収集開始は行いません。実DB分離・請求・復元・認証後の主要フローは別途検証が必要です。
詳細: [PREFLIGHT.md](docs/PREFLIGHT.md)。
