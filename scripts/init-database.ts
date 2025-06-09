#!/usr/bin/env npx ts-node

/**
 * データベース初期化スクリプト
 * 
 * このスクリプトはBOT起動前にデータベースを確実に初期化します。
 * FormManagerとDatabaseServiceの初期化を事前に行うことで、
 * BOT実行時のインタラクション遅延を防ぎます。
 * 
 * 使用方法:
 *   npm run init-db
 *   または
 *   npx ts-node scripts/init-database.ts
 * 
 * オプション:
 *   --force : 既存のデータベースを再初期化
 *   --verbose : 詳細ログを表示
 * 
 * 例:
 *   npx ts-node scripts/init-database.ts --force --verbose
 */

import { DatabaseService } from '../src/services/database';
import { logger } from '../src/utils/logger';
import fs from 'fs';
import path from 'path';

interface InitOptions {
  force: boolean;
  verbose: boolean;
}

class DatabaseInitializer {
  private options: InitOptions;

  constructor(options: InitOptions) {
    this.options = options;
  }

  /**
   * メイン実行関数
   */
  public async run(): Promise<void> {
    try {
      console.log('🚀 データベース初期化スクリプト開始');
      console.log('=====================================');

      // データベースサービス初期化
      const db = DatabaseService.getInstance();
      
      console.log('📦 データベース接続を初期化中...');
      await db.initialize();
      console.log('✅ データベース接続初期化完了');

      // テーブル構造確認
      await this.verifyTables(db);

      // インデックス作成（パフォーマンス向上）
      await this.createIndexes(db);

      // データベース接続終了
      await db.close();
      
      console.log('✅ データベース初期化完了');
      console.log('BOTを安全に起動できます。');

    } catch (error) {
      logger.error('データベース初期化エラー', error);
      console.error('❌ 初期化に失敗しました:', error.message);
      process.exit(1);
    }
  }

  /**
   * テーブル構造確認
   */
  private async verifyTables(db: DatabaseService): Promise<void> {
    try {
      console.log('🔍 テーブル構造を確認中...');
      
      const tables = [
        'members',
        'audit_logs', 
        'settings',
        'security_events',
        'sync_metadata',
        'google_forms',
        'form_responses',
        'form_reminders'
      ];

      for (const table of tables) {
        try {
          const result = await db.query(`SELECT COUNT(*) as count FROM ${table}`);
          const count = result[0]?.count || 0;
          console.log(`  ✅ ${table}: ${count}件`);
          
          if (this.options.verbose && table === 'google_forms' && count > 0) {
            const forms = await db.query(
              'SELECT id, title, state, created_at FROM google_forms ORDER BY created_at DESC LIMIT 3'
            );
            forms.forEach((form: any) => {
              console.log(`    - ${form.id}: ${form.title} (${form.state})`);
            });
          }
        } catch (error) {
          console.log(`  ❌ ${table}: テーブルエラー - ${error.message}`);
        }
      }
      
      console.log('✅ テーブル構造確認完了');
    } catch (error) {
      logger.error('テーブル構造確認エラー', error);
      throw error;
    }
  }

  /**
   * インデックス作成（パフォーマンス向上）
   */
  private async createIndexes(db: DatabaseService): Promise<void> {
    try {
      console.log('🚀 インデックスを作成中...');
      
      const indexes = [
        // フォーム関連のインデックス
        'CREATE INDEX IF NOT EXISTS idx_google_forms_state ON google_forms(state)',
        'CREATE INDEX IF NOT EXISTS idx_google_forms_deadline ON google_forms(deadline)',
        'CREATE INDEX IF NOT EXISTS idx_google_forms_created_by ON google_forms(created_by)',
        
        // 回答関連のインデックス
        'CREATE INDEX IF NOT EXISTS idx_form_responses_form_id ON form_responses(form_id)',
        'CREATE INDEX IF NOT EXISTS idx_form_responses_discord_id ON form_responses(discord_id)',
        'CREATE INDEX IF NOT EXISTS idx_form_responses_responded_at ON form_responses(responded_at)',
        
        // メンバー関連のインデックス
        'CREATE INDEX IF NOT EXISTS idx_members_discord_id ON members(discord_id)',
        'CREATE INDEX IF NOT EXISTS idx_members_student_id ON members(student_id)',
        'CREATE INDEX IF NOT EXISTS idx_members_grade ON members(grade)',
        
        // セキュリティイベント関連のインデックス
        'CREATE INDEX IF NOT EXISTS idx_security_events_timestamp ON security_events(timestamp)',
        'CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON security_events(user_id)',
        'CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity)'
      ];

      for (const indexSql of indexes) {
        try {
          await db.query(indexSql);
          if (this.options.verbose) {
            const indexName = indexSql.match(/CREATE INDEX IF NOT EXISTS (\w+)/)?.[1];
            console.log(`  ✅ インデックス作成: ${indexName}`);
          }
        } catch (error) {
          console.log(`  ⚠️  インデックス作成エラー: ${error.message}`);
        }
      }
      
      console.log('✅ インデックス作成完了');
    } catch (error) {
      logger.error('インデックス作成エラー', error);
      // インデックス作成エラーは致命的ではないので続行
    }
  }
}

/**
 * コマンドライン引数解析
 */
function parseArguments(): InitOptions {
  const args = process.argv.slice(2);
  const options: InitOptions = {
    force: false,
    verbose: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--force':
        options.force = true;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
    }
  }

  return options;
}

/**
 * ヘルプ表示
 */
function showHelp(): void {
  console.log(`
データベース初期化スクリプト

使用方法:
  npx ts-node scripts/init-database.ts [オプション]

オプション:
  --force           既存のデータベースを再初期化
  --verbose, -v     詳細情報を表示
  --help, -h        このヘルプを表示

例:
  # 基本的な初期化
  npx ts-node scripts/init-database.ts

  # 詳細ログ付きで実行
  npx ts-node scripts/init-database.ts --verbose

  # 強制再初期化
  npx ts-node scripts/init-database.ts --force

説明:
  このスクリプトはBOT起動前にデータベースの初期化を行います。
  FormManagerの初期化遅延を防ぎ、インタラクションの応答速度を向上させます。
`);
}

/**
 * メイン実行
 */
if (require.main === module) {
  const options = parseArguments();
  const initializer = new DatabaseInitializer(options);
  
  initializer.run().catch((error) => {
    console.error('スクリプト実行エラー:', error);
    process.exit(1);
  });
}

export { DatabaseInitializer };