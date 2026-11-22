# 音声自由会話の候補とProduction移行

この変更はPreviewブランチだけ。実モデルへの送信、Production設定・DB・main・バックアップの変更は実施しない。

## 操作

COREは音声会話。入力欄のマイクは文字起こし専用で送信しない。COREでは確定発話を約3秒の認識イベント無変化後に自動送信し、端末内speechSynthesisの日本語回答終了後に再待ち受けする。音量を測るVADではない。

認識・認証・API・TTSエラーは自動再試行しない。Safariが開始・再開を拒否したら「会話を再開」。TTS失敗時は「回答を再生」で取得済みの回答だけを再生し、APIを送らない。会話終了・オーブ再タップ・画面非表示・ログアウトで認識と音声と再待ち受けを停止する。既に送信済みの費用は取り消せない。

「回答を読み上げ」の希望だけを `jarvis.speech.preference.v1` に保存する。本文・鍵・承認をこの設定には保存しない。CORE会話は従来どおり常に回答を読み上げる。手動送信はこの希望設定に従う。設定OFFはCORE会話の読み上げを無効化する意味ではない。

Claudeとモックの表示を区別する。会話の記憶は既存設定を維持。実会話は3往復で停止、承認全体の回数・期限・UTC日10回・5秒間隔・同時実行禁止・未確定額保持を維持する。再タップしてもサーバー側の承認回数は戻らない。

## 実APIなしの検証

- `npm test`（外部通信禁止、合成provider、使い捨てSQLite）
- `node tests/voice-conversation-browser.mjs`
- `node tests/voice-recovery-browser.mjs`
- `node tests/claude-conversation-browser.mjs`
- 既存の天気・保存・認証・Production想定ブラウザ試験

幅を変えたChromium試験はiPhone Safariの実機試験ではない。iPhoneの認識許可/拒否、TTS再生、再待ち受け、ロック・着信・Bluetoothは本人確認が必要。実APIテストは別途承認された回数だけ。

## Production専用経路（初期状態は停止）

`/api/business/chat-conversation` はProductionのみ。旧 `/api/business/chat-claude-preview` はPreviewのみに制限したまま。一般 `/api/chat`・記事生成・Threads・Cronの停止は解除しない。

Productionは既存workspaceTarget（main、正規ホスト、リリース識別、Production DB ID）と署名セッション、POSTの同一Originを必須とする。実送信前に jarvis-production 識別行のDB IDを照合する。Previewの承認は利用できない。

次の追加設定は将来の明示承認後にのみ適用する。今回は変更しない。

- `JARVIS_PRODUCTION_CONVERSATION_ENABLED=true`：会話専用。未設定/falseは停止。
- `JARVIS_PRODUCTION_PREPAID_SNAPSHOT`：Previewと同形式のverified/autoRechargeOff/observedAt/settledThrough/balanceMicroUSD。最新の確認済み値だけを使う。
- `JARVIS_PRODUCTION_PREPAID_APPROVAL`：purpose=conversation、environment=production、databaseId=4cae3d2a-eff6-4a1d-871e-56491bdf082a、model=claude-sonnet-4-6、id=chat-から始まる新規ID、snapshotObservedAt、maxCalls、expiresAt。
- 既存ANTHROPIC_API_KEYを保持。モデルとAI_PRICING_JSONの既存設定を照合する。キーを文書・画面へ出さない。

残高確認から15分以内の期限、初回maxCalls=1を提案する。日常利用は3往復/セッション・UTC日10回・送信5秒間隔を維持する案。長時間承認や回数増加は今回実装せず、別途審査・承認とする。

Preview/Productionは別台帳のため、共有Anthropic残高の同時消費を自動集計できない。Production承認発行前にPreviewを含む他経路の有効承認がないことを照合し、一方だけを有効化する。過去3.04 USDは現在残高ではない。completedを二重控除せず、uncertain/予約を保持して残高を照合する。自動チャージはOFFを維持。

## 移行前後（別途承認が必要）

1. 候補SHA・全テスト・Preview/iPhone実機確認を固定する。実Claudeの結果は模擬結果と分けて記録。
2. Production現在配備・main・DB ID・認証設定・スキーマを再照合。ai_operations、ai_usage（id/purpose/created_at）、必要索引と識別行の互換性を確認する。既存の追加16表SQLを再実行しない。本変更のための新規SQLは現時点では用意しない。Production会話は実行時スキーマ作成をしない。不足時は停止し、別途変更を審査する。
3. 本人の未保存入力退避、端末保存保護、既存バックアップの状態を確認。必要な新規バックアップ/復旧点は無料条件・保存先・承認を確認して作成し、既存バックアップを上書きしない。秘密値をログに出さず、設定復旧は管理画面内で扱う。
4. 固定SHAの安全復旧bundleを生成し、ハッシュ/ルーティング/認証済みAPI503/外部fetchなしをローカル検証する。
5. 明示承認後にmainへ非force反映し、本番コードは実AI停止状態で配備。認証・保存・履歴・天気・音声・BTC・既存カレンダーの公開方針を検証する。Preview承認をコピーしない。
6. 別途有料テスト承認後に本番専用の短期限・1回設定を適用。1送信の結果と台帳を確認後、停止へ戻す。結果不明なら再送しない。

## 復旧

Productionへの最初の変更前に、実送信の停止とメンテナンスbundle配備を含む復旧範囲の承認を得る。障害時は本番会話フラグをfalseにし、認証済みでも送信できないことを確認する。必要なら検証済みメンテナンスbundleを配備（通常機能は一時停止）。旧658b3bcや未検証の過去配備へ戻さない。

台帳・未確定予約・既存記事・版履歴・承認・収支・端末データを削除しない。DBをDROP/復元上書きしてコードを戻さない。設定や配備結果が不明なら停止し、読み取り確認後に再開計画を作る。
