# Preview実行時診断

対象ブランチ feature/ai-business-rebuild。既存の管理パスワード・API認証・モックAPIを変更しない。

追加画面 /preview-runtime.html は公開静的ファイルだが、環境情報を埋め込まない。
GET /api/business/preview-runtime は既存の x-jarvis-password 認証を必須とする。
未認証では情報を返さない。対象PreviewのHTTPSホスト以外、明示的な他ブランチ、GET以外は拒否する。
CF_PAGES_BRANCH が欠けても診断できるよう、認証とリクエストURLのPreview制限を先に適用する。
認証は既存パスワードと同等であり、ブランチ所有者の独立した証明ではない。
DB、外部クライアント、共有初期化処理をインポートせず、DB・AI・外部投稿へ触れない。

## 応答

branch.present / branch.matchesExpected と url.present / url.matchesAllowedPreview、mockEnabled の真偽値だけ。
URL・ブランチの実値、秘密、DBの内容・接続先は返さない。両変数が不在なら false。
URLはこのプロジェクトの8桁16進Previewホストまたは対象ブランチエイリアスを許可。
この診断はURLとブランチ情報の検査であり、DB分離や実行許可の証明ではない。

## 将来のPreview反映

今回はローカル修正・テストのみ。push、配備、Cloudflare設定変更は未実施。
1. 差分をレビューしてコミットする。
2. 許可を得た対象ブランチへのpushはPagesの自動Preview配備を起動する。mainへ反映しない。
3. 成功した新配備のコミットとPreview D1 IDをGETで照合する。旧固定配備URLには新APIは追加されない。
4. 新固定Preview URLの /preview-runtime.html を開く。本人が既存パスワードを入力して1回確認する。
5. 4つの present / matches がtrueかを確認する。パスワードをCodexやチャットに共有しない。
6. falseや拒否の場合、モックは有効化せず原因を調べる。診断はフラグ無効のまま使用可能。

診断画面は入力欄と送信用変数を消去し、ストレージやURL、ログへパスワードを保存しない。
手動送信1回につきGET1回。自動取得・ポーリング・自動再送なし。
今回の作業ではモックの有効化・開始、実DBのテストは行わない。
