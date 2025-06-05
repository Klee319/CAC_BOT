# 部活動管理BOT（CAC BOT）仕様書

## 1. プロジェクト概要

### 1.1 目的
部活動の運営管理を効率化するDiscord BOTシステムの構築。部員情報管理、部費管理、投票機能、各種記録機能を統合的に提供する。

### 1.2 主要機能
- Google Sheetsと連携した部員データ管理
- 部費納入状況の確認・管理
- Google Forms連携による高度な投票・アンケート機能
- 自動部員登録システム
- リアルタイムデータ同期
- 包括的な通知・ログシステム

### 1.3 技術スタック
- **言語**: TypeScript 5.x
- **ランタイム**: Node.js 20.x LTS
- **Discord Library**: discord.js v14.x
- **Google API**: googleapis v134.x
- **データベース**: SQLite3（ローカルキャッシュ）
- **その他主要ライブラリ**:
  - dotenv（環境変数管理）
  - node-cron（定期実行）
  - winston（ログ管理）
  - zod（バリデーション）

## 2. システムアーキテクチャ

### 2.1 ディレクトリ構造
```
CAC_discord/
├── src/
│   ├── bot/
│   │   ├── commands/           # スラッシュコマンド
│   │   ├── events/            # Discordイベントハンドラ
│   │   ├── buttons/           # ボタンインタラクション
│   │   └── modals/            # モーダルハンドラ
│   ├── services/
│   │   ├── google/            # Google API関連
│   │   ├── database/          # SQLite操作
│   │   └── notification/      # 通知サービス
│   ├── utils/                 # ユーティリティ関数
│   ├── types/                 # TypeScript型定義
│   └── config/                # 設定関連
├── logs/                      # ログファイル
├── database/                  # SQLiteデータベース
├── .env                       # 環境変数
├── config.json               # 動的設定ファイル
├── package.json
├── tsconfig.json
└── README.md
```

### 2.2 データフロー
1. Discord → BOT → Google Sheets（メインデータストレージ）
2. Google Sheets（メインデータストレージ） → BOT → Discord
3. Google Forms → Google Sheets → BOT → Discord（投票データ）
4. SQLite（キャッシュ、設定、一時データ）

## 3. 機能詳細仕様

### 3.1 部員データ管理機能

#### 3.1.1 データ構造
```typescript
interface Member {
  name: string;                  // 本名
  discordDisplayName: string;    // Discord表示名
  discordUsername: string;       // Discordユーザー名
  studentId: string;            // 学籍番号
  gender: string;               // 性別
  team: string;                 // 班
  membershipFeeRecord: string;  // 部費納入記録
  grade: number | string;       // 学年（1-4またはOB）
}
```

**部費納入記録フォーマット**
- 形式: 自由記述形式（例: "2024年度納入済", "未納", "2024/04/15納入"）
- 管理者が任意の形式で記録可能

#### 3.1.2 自動登録フロー
1. 新規ユーザーがサーバーに参加
2. BOTが自動的にDMで登録フォームのリンクを送信
3. ユーザーが本名、学籍番号、性別を入力
4. スプレッドシートに自動追加
5. 完了通知を指定チャンネルに送信

#### 3.1.3 コマンド仕様

**基本部員管理**
- `/member register` - 手動登録（管理者）
- `/member update` - 情報更新（管理者）
- `/member delete` - 削除（管理者）
- `/member list` - 一覧表示（管理者）
- `/member grade-up` - 全部員の学年一括繰り上げ（管理者）
  - 1→2年生、2→3年生、3→4年生
  - 4年生は「OB」としてマーク（学年欄に「OB」と記録）
  - 実行前に確認メッセージを表示
  - 処理結果をログチャンネルに出力

**部員情報検索（管理者のみ）**
- `/member search <query>` - 特定ユーザー情報の詳細確認
  - 検索可能項目: 名前、Discord表示名、ユーザー名、学籍番号
  - 複数該当時は選択メニューで絞り込み
  - 表示内容: 全登録情報（学籍番号、性別、班、学年、部費納入状況等）

**部費管理**
- `/fee check` - 自身の部費納入状況確認（部員）
  - 現在の納入状況を表示
  - 未納の場合は納入方法の案内も表示
  
- `/fee update @user <record>` - 部費状況更新（管理者）
  - 例: `/fee update @田中 "2024年度納入済"`
  - 例: `/fee update @佐藤 "未納"`
  
- `/fee unpaid` - 部費未納入者一覧表示（管理者）
  - 納入記録に「未納」が含まれる部員をリスト表示
  - 学年・班でのフィルタリングオプション
  - CSV形式でのエクスポート機能

### 3.2 Google Sheets連携

#### 3.2.1 初期設定
```typescript
// コマンド: /sheet setup
// モーダル入力:
// - スプレッドシートURL
// - シート名（デフォルト: "部員名簿"）
```

#### 3.2.2 列マッピング設定（config.json）
```json
{
  "sheetColumns": {
    "name": "A",
    "discordDisplayName": "B",
    "discordUsername": "C",
    "studentId": "D",
    "gender": "E",
    "team": "F",
    "membershipFeeRecord": "G",
    "grade": "H"
  }
}
```

#### 3.2.3 同期仕様
- リアルタイム同期（変更検知時即座に反映）
- 5分ごとの定期同期（差分チェック）
- 手動同期コマンド: `/sync sheets`

### 3.3 投票・アンケート機能

#### 3.3.1 Google Forms連携フロー
1. 管理者がGoogle Formsでアンケートを作成
2. `/vote create`コマンドでフォームURLを指定
3. BOTがForms APIで質問内容と形式を取得
4. Discord用のインタラクティブフォームに自動変換
5. 回答をGoogle Sheetsに保存

#### 3.3.2 対応する質問形式
- テキスト入力 → モーダルのテキスト入力
- ラジオボタン → セレクトメニュー
- チェックボックス → 複数選択可能なセレクトメニュー
- プルダウン → セレクトメニュー
- 画像添付 → Embed内に画像表示

#### 3.3.3 投票作成モーダル
```typescript
interface VoteCreationModal {
  formUrl: string;           // Google Forms URL
  outputSheet?: string;      // 出力先URL（省略時はフォームと同じディレクトリ）
  deadline: Date;           // 回答期限
  allowEdit: boolean;       // 編集許可
  anonymous: boolean;       // 匿名モード
}
```

#### 3.3.4 コマンド仕様
- `/vote create` - 新規投票作成（管理者）
- `/vote edit` - 投票編集（管理者）
- `/vote list` - 進行中の投票一覧
- `/vote response` - 自分の回答確認・編集（部員）
- `/vote close` - 投票終了（管理者）
- `/vote results` - 結果確認（管理者）

### 3.4 通知機能

#### 3.4.1 通知種別
- 部費未納リマインド（月初自動送信）
- アンケート期限通知（期限24時間前）
- 重要なお知らせ（管理者手動送信）
- システム通知（エラー、同期完了等）

#### 3.4.2 通知設定（config.json）
```json
{
  "notifications": {
    "feeReminder": {
      "enabled": true,
      "schedule": "0 9 1 * *",  // 毎月1日9時
      "channelId": "CHANNEL_ID"
    },
    "voteReminder": {
      "enabled": true,
      "hoursBeforeDeadline": 24
    },
    "systemNotifications": {
      "channelId": "LOG_CHANNEL_ID"
    }
  }
}
```

### 3.5 ログ機能

#### 3.5.1 ログレベル
- ERROR: エラー情報
- WARN: 警告
- INFO: 一般情報
- DEBUG: デバッグ情報

#### 3.5.2 ログ出力先
- ファイル: `logs/app-YYYY-MM-DD.log`
- Discord: 指定ログチャンネル（ERROR/WARNのみ）
- コンソール: 開発時のみ

#### 3.5.3 監査ログ
```typescript
interface AuditLog {
  timestamp: Date;
  userId: string;
  action: string;
  target?: string;
  oldValue?: any;
  newValue?: any;
  result: 'success' | 'failure';
}
```

## 4. セキュリティ・権限管理

### 4.1 環境変数（.env）
```env
DISCORD_TOKEN=your_discord_bot_token
GOOGLE_CLIENT_EMAIL=service_account_email
GOOGLE_PRIVATE_KEY=service_account_private_key
GOOGLE_PROJECT_ID=your_project_id
```

### 4.2 権限設定
```typescript
interface Permissions {
  adminRoleIds: string[];        // 管理者ロールID
  memberRoleIds: string[];       // 部員ロールID
  allowedChannelIds: string[];   // コマンド実行可能チャンネル
}
```

### 4.3 コマンド権限
- 管理者限定: sheet setup, member管理, member grade-up, vote create/edit/close, fee update, fee unpaid, member search
- 部員: fee check, vote list/response
- 全員: help, status

## 5. エラーハンドリング

### 5.1 Google API制限対策
- リトライ機能（最大3回、指数バックオフ）
- レート制限到達時はキャッシュから応答
- エラー通知をログチャンネルに送信

### 5.2 ネットワークエラー
- 自動再接続（Discord WebSocket）
- オフライン時はローカルキューに保存
- 復旧時に自動同期

## 6. 拡張性考慮事項

### 6.1 将来実装予定機能への対応
- 出欠確認機能
- 部室利用記録
- 部活図書利用記録

### 6.2 プラグインアーキテクチャ
```typescript
interface Plugin {
  name: string;
  version: string;
  commands: Command[];
  events: EventHandler[];
  initialize: () => Promise<void>;
}
```

## 7. 初期セットアップ手順

### 7.1 必要な準備
1. Discord Developer PortalでBOTを作成
2. Google Cloud ConsoleでサービスアカウントとAPIを有効化
3. Node.js 20.x LTSをインストール

### 7.2 インストール手順
```bash
# リポジトリクローン
git clone [repository_url]
cd CAC_discord

# 依存関係インストール
npm install

# 環境変数設定
cp .env.example .env
# .envファイルを編集

# TypeScriptビルド
npm run build

# BOT起動
npm start
```

### 7.3 初期設定コマンド
1. `/setup admin @role` - 管理者ロール設定
2. `/setup member @role` - 部員ロール設定
3. `/setup channel #channel` - コマンドチャンネル設定
4. `/sheet setup` - スプレッドシート連携
5. `/setup notification #channel` - 通知チャンネル設定

## 8. 運用・保守

### 8.1 バックアップ
- SQLiteデータベース: 日次自動バックアップ
- 設定ファイル: 変更時自動バックアップ
- Google Sheets: Google側で自動バージョン管理

### 8.2 監視項目
- BOTの稼働状態
- API使用量
- エラー発生率
- レスポンスタイム

### 8.3 定期メンテナンス
- 月次: ログファイルのローテーション
- 四半期: 依存関係の更新
- 年次: セキュリティ監査

## 9. トラブルシューティング

### 9.1 よくある問題
- Q: BOTがオフラインになる
  - A: トークンの有効性確認、ネットワーク接続確認

- Q: Google Sheetsが同期されない
  - A: API制限確認、認証情報確認、権限設定確認

- Q: コマンドが反応しない
  - A: 権限設定確認、チャンネル設定確認

### 9.2 デバッグモード
```bash
# デバッグモードで起動
npm run dev

# ログレベルをDEBUGに設定
LOG_LEVEL=debug npm start
```

## 10. 付録

### 10.1 コマンド一覧

#### 部員管理コマンド
- `/member register` - 新規部員の手動登録（管理者のみ）
- `/member update @user <field> <value>` - 部員情報の更新（管理者のみ）
- `/member delete @user` - 部員の削除（管理者のみ）
- `/member list` - 全部員一覧の表示（管理者のみ）
- `/member search <query>` - 特定ユーザー情報の検索（管理者のみ）
  - query: 名前、Discord表示名、ユーザー名、学籍番号のいずれか
- `/member grade-up` - 全部員の学年一括繰り上げ（管理者のみ）
  - 年度更新時に使用（通常は4月に実行）
  - 4年生→OB、3年生→4年生、2年生→3年生、1年生→2年生
  - 実行前に確認ダイアログを表示
  - 処理完了後、変更内容のサマリーを表示

#### 部費管理コマンド
- `/fee check` - 自身の部費納入状況確認（部員）
- `/fee update @user <record>` - 部費納入記録の更新（管理者のみ）
  - record: 納入記録文字列（例: "2024年度納入済", "未納"）
- `/fee unpaid` - 部費未納入者一覧の表示（管理者のみ）

#### 投票・アンケートコマンド
- `/vote create` - 新規投票の作成（管理者のみ）
- `/vote edit <vote_id>` - 既存投票の編集（管理者のみ）
- `/vote list` - 進行中の投票一覧
- `/vote response <vote_id>` - 自分の回答確認・編集（部員）
- `/vote close <vote_id>` - 投票の終了（管理者のみ）
- `/vote results <vote_id>` - 投票結果の確認（管理者のみ）

#### システム管理コマンド
- `/sheet setup` - スプレッドシート連携設定（管理者のみ）
- `/sync sheets` - 手動でシート同期実行（管理者のみ）
- `/setup admin @role` - 管理者ロール設定（初回設定時）
- `/setup member @role` - 部員ロール設定（管理者のみ）
- `/setup channel #channel` - コマンド実行可能チャンネル設定（管理者のみ）
- `/setup notification #channel` - 通知チャンネル設定（管理者のみ）

#### その他コマンド
- `/help` - ヘルプ表示（全員）
- `/status` - BOT稼働状況確認（全員）

### 10.2 設定ファイルサンプル

```json
{
  "sheetColumns": {
    "name": "A",
    "discordDisplayName": "B",
    "discordUsername": "C",
    "studentId": "D",
    "gender": "E",
    "team": "F",
    "membershipFeeRecord": "G",
    "grade": "H"
  },
  "permissions": {
    "adminRoleIds": ["ADMIN_ROLE_ID_1", "ADMIN_ROLE_ID_2"],
    "memberRoleIds": ["MEMBER_ROLE_ID"],
    "allowedChannelIds": ["CHANNEL_ID_1", "CHANNEL_ID_2"]
  },
  "notifications": {
    "feeReminder": {
      "enabled": true,
      "schedule": "0 9 1 * *",
      "channelId": "REMINDER_CHANNEL_ID"
    },
    "voteReminder": {
      "enabled": true,
      "hoursBeforeDeadline": 24
    },
    "systemNotifications": {
      "channelId": "LOG_CHANNEL_ID"
    }
  },
  "sheets": {
    "spreadsheetId": "",
    "sheetName": "部員名簿"
  },
  "registration": {
    "formUrl": "https://forms.google.com/your-registration-form",
    "welcomeMessage": "ようこそ！以下のフォームから部員登録をお願いします。"
  }
}
```

### 10.3 API制限一覧
- Discord API: 5リクエスト/秒
- Google Sheets API: 100リクエスト/100秒
- Google Forms API: 読み取りのみ、作成は手動

---

この仕様書に基づいて実装を進めることで、拡張性と保守性の高い部活動管理BOTを構築できます。