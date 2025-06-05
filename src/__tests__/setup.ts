// テスト共通のセットアップファイル
import dotenv from 'dotenv';

// テスト用の環境変数を設定
dotenv.config({ path: '.env.test' });

// テスト用のデフォルト環境変数
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:'; // インメモリSQLite
process.env.LOG_LEVEL = 'error'; // テスト中はエラーのみログ出力
process.env.DISCORD_TOKEN = 'test_token';
process.env.DISCORD_CLIENT_ID = 'test_client_id';
process.env.GOOGLE_CLIENT_EMAIL = 'test@example.com';
process.env.GOOGLE_PRIVATE_KEY = 'test_private_key';
process.env.GOOGLE_PROJECT_ID = 'test_project';

// グローバルなテスト設定
beforeAll(() => {
  // テスト開始前の共通処理
});

afterAll(() => {
  // テスト終了後の共通処理
});

// タイムアウトを無効にする（長時間のテストを可能にする）
jest.setTimeout(30000);