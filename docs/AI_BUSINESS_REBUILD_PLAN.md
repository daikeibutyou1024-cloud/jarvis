# AI Business Rebuild — 統合司令室

2026-11-09 / feature/ai-business-rebuild / ローカル実装・テスト

5部門を共通ブリーフとAI下書きで統合。天気、雨雲、カレンダー、動画編集、旧スタッフ表示を削除。
青い球体・音声・Claude既定のAPI接続・既存認証・D1スキーマ・下書き取得を維持。

実装: RESEARCH調査計画、CONTENT記事・SNS原稿、MARKETING導線案、ANALYTICS手入力月次集計、FINANCE手入力収支。
RESEARCH 2.0: 官公庁RSS・GitHub公開APIの限定取得、比較資料取り込み、出典記録とCONTENT引き継ぎを追加（詳細: RESEARCH_2.md）。
未接続: Web全体の検索、SNS投稿、成果自動取得、API請求自動取得、定期実行。
端末保存とクラウド保存を区別し、接続状態は操作成功時に更新する。

mainとバックアップブランチを維持。本番公開・自動投稿・リモートDB操作なし。
次段階はPreview環境で認証とD1を確認し、利用者確認のもとで実API検証。
