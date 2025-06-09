# CAC BOT Google Forms 連携機能 詳細仕様書

## 1. 概要

### 1.1 目的
Discord内からGoogle Formsを作成・管理し、部員がDiscord経由でのみアンケートに回答できるシステムを構築する。JWT認証を用いて安全かつシームレスなアンケート回答を実現する。

### 1.2 解決する課題
- Google Formsのリダイレクト問題とUX向上
- Discord部員管理とアンケート結果の効率的な紐づけ
- アンケート作成者の負担軽減
- 重複回答や外部からの不正アクセスの防止

## 2. システムアーキテクチャ

### 2.1 全体構成
```
Discord Bot (TypeScript)
    ├── Google Forms API
    ├── Google Sheets API (既存)
    ├── SQLite Database
    └── JWT認証サーバー (Node.js/Express)
        └── VPSホスティング
```

### 2.2 データフロー
1. 管理者がDiscordでフォーム作成コマンドを実行
2. BotがGoogle Forms APIでフォームを作成
3. 部員がDiscordでフォーム回答ボタンをクリック
4. JWT認証付きリダイレクトURLを生成
5. 認証サーバーでJWTを検証し、Google Formsに自動入力
6. 回答データをBotが取得・管理

## 3. データベース設計

### 3.1 新規テーブル

#### google_forms テーブル
```sql
CREATE TABLE google_forms (
  id TEXT PRIMARY KEY,
  form_id TEXT UNIQUE NOT NULL,
  form_url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  created_by TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deadline DATETIME,
  state TEXT DEFAULT 'draft',
  target_roles TEXT,
  is_anonymous BOOLEAN DEFAULT 0,
  allow_edit BOOLEAN DEFAULT 1,
  message_id TEXT,
  channel_id TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### form_responses テーブル
```sql
CREATE TABLE form_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  responded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  jwt_token_hash TEXT,
  response_edit_url TEXT,
  FOREIGN KEY (form_id) REFERENCES google_forms(id),
  UNIQUE(form_id, discord_id)
);
```

#### form_reminders テーブル
```sql
CREATE TABLE form_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id TEXT NOT NULL,
  discord_id TEXT NOT NULL,
  reminder_type TEXT NOT NULL,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (form_id) REFERENCES google_forms(id)
);
```

## 4. コマンド仕様

### 4.1 フォーム管理コマンド（管理者限定）

#### /form create
```typescript
// モーダル入力項目
interface FormCreateModal {
  googleFormUrl: string;        // Google Forms URL
  deadline: string;            // 期限 (YYYY-MM-DD HH:mm)
  targetRoles?: string;        // 対象ロール（カンマ区切り）
  isAnonymous: boolean;        // 匿名回答（デフォルト: false）
  allowEdit: boolean;          // 編集許可（デフォルト: true）
}
```

#### /form delete
- フォーム一覧をセレクトメニューで表示
- 削除確認後、データベースから削除
- 公開済みの回答パネルも削除

#### /form edit
- 既存フォームの設定を編集
- 期限、対象ロール、匿名設定の変更可能

#### /form publish
- 未公開フォームを公開
- 指定チャンネルに回答パネルを投稿
- 対象者への通知

#### /form status
- 特定フォームの回答状況確認
- 回答率、未回答者リスト表示

### 4.2 部員用コマンド

#### /form my
- 自分が対象のアクティブなフォーム一覧
- 回答済み状況の表示
- セレクトメニューから直接回答

## 5. JWT認証システム

### 5.1 認証フロー
```typescript
interface JWTPayload {
  discordId: string;
  formId: string;
  memberData: {
    name: string;
    studentId: string;
    discordUsername: string;
  };
  issuedAt: number;
  expiresAt: number;
}
```

### 5.2 認証サーバー仕様
```typescript
// エンドポイント: /auth/form/:token
// 処理内容:
// 1. JWTトークンの検証
// 2. 有効期限チェック
// 3. 使用済みトークンチェック
// 4. Google Formsへのリダイレクト（事前入力付き）
```

## 6. 回答パネル仕様

### 6.1 Embed表示内容
```typescript
interface FormPanelEmbed {
  title: string;              // フォームタイトル
  description: string;        // フォーム説明
  fields: [
    { name: "回答期限", value: string },
    { name: "対象者", value: string },
    { name: "回答状況", value: string },
    { name: "設定", value: string }  // 匿名/編集可否
  ];
  color: number;             // 状態による色分け
  timestamp: Date;
}
```

### 6.2 ボタンインタラクション
```typescript
// 回答ボタン
customId: `form_answer_${formId}`

// ボタンクリック時の処理:
// 1. 対象者チェック
// 2. 回答済みチェック
// 3. JWT生成
// 4. 認証URL生成・送信
```

## 7. Google Forms API連携

### 7.1 フォーム作成時の処理
```typescript
interface FormCreationProcess {
  // 1. Google FormsからメタデータXU
  // 2. 必須項目の確認（名前、学籍番号など）
  // 3. 不足項目の自動追加
  // 4. フォーム設定の適用
}
```

### 7.2 回答データ取得
```typescript
interface ResponseFetchProcess {
  // 1. Forms APIで回答一覧取得
  // 2. Discord IDとの紐付け
  // 3. データベース更新
  // 4. 統計情報の計算
}
```

## 8. リマインダーシステム

### 8.1 リマインダータイミング
- 期限3日前：最初のリマインダー
- 期限1日前：2回目のリマインダー
- 期限3時間前：最終リマインダー

### 8.2 通知内容
```typescript
interface ReminderMessage {
  title: "アンケート回答のお願い";
  description: string;  // フォーム名と期限
  fields: [
    { name: "回答方法", value: string },
    { name: "所要時間", value: string }
  ];
  buttons: [回答ボタン];
}
```

## 9. セキュリティ対策

### 9.1 アクセス制御
- Discord認証必須
- ロールベースアクセス制御
- IPアドレス記録

### 9.2 JWT セキュリティ
- 署名アルゴリズム: HS256
- 有効期限: 1時間
- ワンタイム使用
- トークンハッシュの保存

### 9.3 レート制限
- コマンド実行: 1分間に5回まで
- フォーム作成: 1日10個まで
- API呼び出し: Google API制限に準拠

## 10. エラーハンドリング

### 10.1 エラーケース
```typescript
enum FormErrorCode {
  FORM_NOT_FOUND = "フォームが見つかりません",
  ALREADY_RESPONDED = "既に回答済みです",
  DEADLINE_PASSED = "回答期限を過ぎています",
  NOT_AUTHORIZED = "回答権限がありません",
  TOKEN_EXPIRED = "認証トークンの有効期限が切れています",
  API_LIMIT_EXCEEDED = "API制限に達しました"
}
```

### 10.2 エラー通知
- ユーザーには分かりやすいエラーメッセージ
- 管理者には詳細なエラーログ
- 重大なエラーは即時通知

## 11. 実装優先順位

### Phase 1: 基本機能
1. データベーススキーマ作成
2. form create/delete/edit コマンド
3. 基本的な回答パネル表示

### Phase 2: 認証システム
1. JWT認証サーバー構築
2. 認証フロー実装
3. セキュリティ機能

### Phase 3: 高度な機能
1. リマインダーシステム
2. 統計・分析機能
3. 一括操作機能

## 12. 運用考慮事項

### 12.1 バックアップ
- フォーム情報の定期バックアップ
- 回答データの二重保存（DB + Sheets）

### 12.2 メンテナンス
- 期限切れフォームの自動クリーンアップ
- トークンテーブルの定期清掃
- ログローテーション

### 12.3 監視項目
- API使用量
- エラー発生率
- 認証成功率
- レスポンスタイム

## 13. 技術仕様

### 13.1 使用ライブラリ
```json
{
  "dependencies": {
    "jsonwebtoken": "^9.0.0",
    "express": "^4.18.0",
    "helmet": "^7.0.0",
    "express-rate-limit": "^6.0.0",
    "@google-cloud/forms": "^1.0.0"
  }
}
```

### 13.2 環境変数
```env
# 既存の環境変数に追加
JWT_SECRET=your_jwt_secret_key
AUTH_SERVER_URL=https://your-vps-domain.com
AUTH_SERVER_PORT=3000
FORMS_API_KEY=your_forms_api_key
```

---

この仕様書に基づいて実装を進めることで、セキュアで使いやすいGoogle Forms連携システムを構築できます。