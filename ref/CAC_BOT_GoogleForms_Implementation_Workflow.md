# CAC BOT Google Forms 連携機能 実装ワークフロー

## 実装スケジュール
- **総工数**: 約40-50時間
- **推奨期間**: 2-3週間

## Phase 1: 基盤構築（8時間）

### 1.1 データベース拡張（2時間）
- [ ] データベースマイグレーションファイルの作成
- [ ] 新規テーブル（google_forms, form_responses, form_reminders）の追加
- [ ] インデックスの作成
- [ ] データベースサービスクラスへのメソッド追加

### 1.2 型定義・インターフェース（2時間）
- [ ] src/types/forms.ts の作成
- [ ] Google Forms API関連の型定義
- [ ] JWT関連の型定義
- [ ] エラー型の定義

### 1.3 設定・環境変数（1時間）
- [ ] .env.example に新規環境変数追加
- [ ] config.json への設定項目追加
- [ ] 環境変数読み込み処理の更新

### 1.4 依存関係インストール（1時間）
- [ ] package.json更新（jsonwebtoken, express等）
- [ ] 開発用パッケージの追加
- [ ] npm install実行

### 1.5 ディレクトリ構造作成（2時間）
- [ ] services/forms/ ディレクトリ作成
- [ ] services/auth/ ディレクトリ作成
- [ ] auth-server/ ディレクトリ作成
- [ ] 基本的なindex.tsファイルの配置

## Phase 2: Google Forms API連携（8時間）

### 2.1 API クライアント実装（3時間）
- [ ] Google Forms API認証設定
- [ ] フォームメタデータ取得機能
- [ ] フォーム質問項目取得機能
- [ ] エラーハンドリング実装

### 2.2 フォームサービス実装（3時間）
- [ ] FormManager クラスの実装
- [ ] フォームCRUD操作
- [ ] 状態管理ロジック
- [ ] キャッシュ機能

### 2.3 回答追跡サービス（2時間）
- [ ] ResponseTracker クラスの実装
- [ ] 回答状況の取得・更新
- [ ] 統計情報の計算

## Phase 3: コマンド実装（10時間）

### 3.1 /form create コマンド（3時間）
- [ ] モーダル作成（formCreate.ts）
- [ ] フォーム作成ロジック
- [ ] バリデーション処理
- [ ] エラーハンドリング

### 3.2 /form delete, edit コマンド（2時間）
- [ ] セレクトメニューによるフォーム選択
- [ ] 削除確認処理
- [ ] 編集モーダル実装

### 3.3 /form publish コマンド（2時間）
- [ ] 公開処理ロジック
- [ ] 回答パネルEmbed生成
- [ ] ボタンコンポーネント作成
- [ ] チャンネルへの投稿

### 3.4 /form my, status コマンド（2時間）
- [ ] フォーム一覧取得
- [ ] 回答状況表示
- [ ] ページネーション実装

### 3.5 ボタンインタラクション（1時間）
- [ ] 回答ボタンハンドラー
- [ ] 状況確認ボタンハンドラー

## Phase 4: JWT認証システム（8時間）

### 4.1 JWTサービス実装（3時間）
- [ ] トークン生成機能
- [ ] トークン検証機能
- [ ] 使用済みトークン管理
- [ ] セキュリティ対策

### 4.2 認証サーバー構築（3時間）
- [ ] Express アプリケーション設定
- [ ] ミドルウェア設定（helmet, rate-limit）
- [ ] ルーティング設定
- [ ] エラーページテンプレート

### 4.3 認証フロー実装（2時間）
- [ ] トークン検証エンドポイント
- [ ] Google Forms事前入力URL生成
- [ ] リダイレクト処理
- [ ] ログ記録

## Phase 5: リマインダーシステム（4時間）

### 5.1 スケジューラー実装（2時間）
- [ ] node-cron設定
- [ ] リマインダータイミング計算
- [ ] ジョブ管理システム

### 5.2 通知送信機能（2時間）
- [ ] DM送信ロジック
- [ ] 送信済み記録管理
- [ ] エラーハンドリング

## Phase 6: 運用機能（4時間）

### 6.1 ライフサイクル管理（2時間）
- [ ] 期限切れフォーム処理
- [ ] 自動クリーンアップ
- [ ] アーカイブ機能

### 6.2 監視・ログ機能（2時間）
- [ ] パフォーマンス監視
- [ ] エラー通知
- [ ] 利用統計収集

## テスト項目チェックリスト

### 単体テスト
- [ ] JWTサービステスト
- [ ] フォーム管理ロジックテスト
- [ ] データベース操作テスト

### 統合テスト
- [ ] コマンド実行フロー
- [ ] 認証フロー全体
- [ ] リマインダー動作確認

### エンドツーエンドテスト
- [ ] フォーム作成から回答までの一連の流れ
- [ ] エラーケースの確認
- [ ] 権限チェックの動作確認

## リリース前チェックリスト

### セキュリティ
- [ ] JWT秘密鍵の適切な管理
- [ ] 環境変数の確認
- [ ] HTTPS設定確認
- [ ] レート制限の動作確認

### パフォーマンス
- [ ] API呼び出し最適化
- [ ] キャッシュ動作確認
- [ ] データベースインデックス確認

### ドキュメント
- [ ] README.md更新
- [ ] 管理者向け操作マニュアル
- [ ] トラブルシューティングガイド

## 実装優先順位

1. **必須機能（MVP）**
   - 基本的なフォーム作成・公開
   - JWT認証による回答
   - 回答状況確認

2. **追加機能（Phase 2）**
   - リマインダーシステム
   - 詳細な統計機能
   - 高度な管理機能

## リスクと対策

### 技術的リスク
- **Google API制限**: バッチ処理とキャッシュで対応
- **JWT有効期限**: 適切な期限設定と再発行機能
- **同時アクセス**: データベースロックとトランザクション

### 運用リスク
- **フォーム削除制限**: 運用ガイドライン作成
- **データ不整合**: 定期的な整合性チェック

---

このワークフローに従って実装を進めることで、計画的にGoogle Forms連携機能を完成させることができます。