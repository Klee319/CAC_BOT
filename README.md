# CAC BOT - 部活動管理Discord BOT

部活動の運営管理を効率化するDiscord BOTシステム。部員情報管理、部費管理、投票機能、各種記録機能を統合的に提供します。

## 🌟 主要機能

- **部員データ管理**: Google Sheetsと連携した部員情報の一元管理
- **部費管理**: 納入状況の確認・管理・未納者追跡
- **自動登録システム**: 新規メンバーの自動案内とフォーム連携
- **権限管理**: ロールベースの機能制限
- **リアルタイム同期**: Google Sheetsとの自動データ同期
- **包括的ログシステム**: 操作履歴とエラー追跡

## 🛠️ 技術スタック

- **言語**: TypeScript 5.x
- **ランタイム**: Node.js 20.x LTS
- **Discord**: discord.js v14.x
- **Google API**: googleapis v134.x
- **データベース**: SQLite3（ローカルキャッシュ）
- **その他**: dotenv, winston, zod

## 📋 必要な準備

### 1. Discord Bot の作成
1. [Discord Developer Portal](https://discord.com/developers/applications)でBOTを作成
2. 必要な権限を設定:
   - `Send Messages`
   - `Use Slash Commands`
   - `Embed Links`
   - `Attach Files`
   - `Read Message History`
   - `Manage Roles`（オプション）

### 2. Google Cloud Console の設定
1. Google Cloud Consoleでプロジェクトを作成
2. Google Sheets API と Google Drive API を有効化
3. サービスアカウントを作成し、認証情報をJSONで取得
4. スプレッドシートにサービスアカウントの編集権限を付与

## 🚀 インストール・セットアップ

### 1. プロジェクトのセットアップ
```bash
# リポジトリをクローン
git clone <repository-url>
cd CAC_discord

# 依存関係をインストール
npm install

# 環境変数を設定
cp .env.example .env
# .envファイルを編集して必要な値を設定

# プロジェクトをビルド
npm run build
```

### 2. 環境変数の設定
`.env`ファイルに以下の情報を設定:

```env
# Discord BOT 設定
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id

# Google API 設定
GOOGLE_CLIENT_EMAIL=service_account_email
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
GOOGLE_PROJECT_ID=your_project_id

# その他設定
NODE_ENV=production
LOG_LEVEL=info
DATABASE_PATH=./database/cac_bot.db
```

### 3. コマンド登録とBOT起動
```bash
# スラッシュコマンドをDiscordに登録
npm run deploy-commands

# BOTを起動
npm start

# 開発モード（ホットリロード付き）
npm run dev

# テストの実行
npm test

# リントチェック
npm run lint
```

## ⚙️ 初期設定

BOT起動後、以下のコマンドで初期設定を行ってください:

### 1. 基本設定
```
/setup admin @管理者ロール      # 管理者ロールを設定
/setup member @部員ロール      # 部員ロールを設定
/setup channel #チャンネル     # コマンド実行可能チャンネルを設定
/setup notification #チャンネル # 通知チャンネルを設定
```

### 2. Google Sheets連携
```
/sheet setup                    # スプレッドシート連携を設定
/sheet validate                 # シート構造を検証
/sheet create-header           # ヘッダーを作成（必要に応じて）
```

## 📖 コマンド一覧

### 基本コマンド（全員）
- `/help` - ヘルプを表示
- `/status` - BOTの稼働状況を確認

### 部員用コマンド
- `/fee check` - 自分の部費納入状況を確認

### 管理者専用コマンド

#### 部員管理
- `/member register` - 新規部員の手動登録
- `/member update` - 部員情報の更新
- `/member delete` - 部員の削除
- `/member list` - 全部員一覧の表示
- `/member search` - 部員情報の検索
- `/member grade-up` - 全部員の学年一括繰り上げ

#### 部費管理
- `/fee update` - 部費納入記録の更新
- `/fee unpaid` - 部費未納入者一覧の表示

#### システム管理
- `/sheet setup` - スプレッドシート連携設定
- `/sheet sync` - 手動シート同期
- `/setup admin/member/channel/notification` - 各種設定

## 🗂️ プロジェクト構造

```
CAC_discord/
├── src/
│   ├── bot/
│   │   ├── commands/          # スラッシュコマンド
│   │   ├── events/           # Discordイベントハンドラ
│   │   ├── modals/           # モーダルハンドラ
│   │   └── buttons/          # ボタンインタラクション
│   ├── services/
│   │   ├── database/         # SQLite操作
│   │   ├── google/           # Google API関連
│   │   └── notification/     # 通知サービス
│   ├── utils/                # ユーティリティ関数
│   ├── types/                # TypeScript型定義
│   └── config/               # 設定管理
├── database/                 # SQLiteデータベース
├── logs/                     # ログファイル
├── config.json              # 動的設定ファイル
└── .env                     # 環境変数
```

## 📊 データ構造

### 部員データ（Google Sheets）
| 列 | 項目 | 説明 |
|---|---|---|
| A | 名前 | 部員の本名 |
| B | Discord表示名 | Discordでの表示名 |
| C | Discordユーザー名 | @username |
| D | 学籍番号 | 学校の学籍番号 |
| E | 性別 | 性別 |
| F | 班 | 所属班 |
| G | 部費納入記録 | 納入状況（自由記述） |
| H | 学年 | 1-4またはOB |

## 🔧 トラブルシューティング

### よくある問題

**BOTがオフラインになる**
- Discord トークンの有効性を確認
- ネットワーク接続を確認
- ログファイルでエラーを確認

**Google Sheetsが同期されない**
- API制限に達していないか確認
- サービスアカウントの権限を確認
- スプレッドシートの共有設定を確認

**コマンドが反応しない**
- 権限設定を確認（`/setup show`）
- チャンネル設定を確認
- ログでエラーを確認

### デバッグモード
```bash
# デバッグログを有効にして起動
LOG_LEVEL=debug npm start

# 開発モードで起動
npm run dev
```

## 📝 ログの確認

ログは以下の場所に出力されます:
- **ファイル**: `logs/app-YYYY-MM-DD.log`
- **Discord**: 設定した通知チャンネル（エラー・警告のみ）
- **コンソール**: 開発モード時

## 🔒 セキュリティ注意事項

- `.env`ファイルは絶対にGitにコミットしない
- Google API認証情報は適切に管理する
- BOTトークンは定期的に再生成を検討する
- 管理者権限は必要最小限のユーザーにのみ付与する

## 📄 ライセンス

MIT License

## 🤝 サポート

問題が発生した場合:
1. ログファイルを確認
2. `/status`コマンドでBOTの状況を確認
3. 設定を`/setup show`で確認
4. GitHubのIssuesで報告

---

**CAC BOT** - 部活動運営をより効率的に 🎯