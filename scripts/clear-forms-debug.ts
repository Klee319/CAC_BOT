#!/usr/bin/env npx ts-node

/**
 * デバッグ用フォームデータクリアスクリプト
 * 
 * このスクリプトはフォーム関連のデータベーステーブルを完全にクリアします。
 * デバッグ時の重複エラーや古いデータの干渉を解決するために使用します。
 * 
 * 使用方法:
 *   npm run clear-forms-debug
 *   または
 *   npx ts-node scripts/clear-forms-debug.ts
 * 
 * オプション:
 *   --backup : クリア前にバックアップを作成
 *   --confirm : 確認プロンプトをスキップ
 *   --table <table_name> : 特定のテーブルのみクリア
 * 
 * 例:
 *   npx ts-node scripts/clear-forms-debug.ts --backup --confirm
 *   npx ts-node scripts/clear-forms-debug.ts --table google_forms
 */

import { DatabaseService } from '../src/services/database';
import { logger } from '../src/utils/logger';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

interface ClearOptions {
  backup: boolean;
  confirm: boolean;
  table?: string;
  verbose: boolean;
}

const FORM_TABLES = [
  'form_reminders',      // 外部キー制約のため最初に削除
  'form_responses',      // 外部キー制約のため2番目に削除
  'google_forms'         // メインテーブルを最後に削除
];

class FormDataCleaner {
  private db: DatabaseService;
  private options: ClearOptions;

  constructor(options: ClearOptions) {
    this.db = DatabaseService.getInstance();
    this.options = options;
  }

  /**
   * メイン実行関数
   */
  public async run(): Promise<void> {
    try {
      console.log('🧹 フォームデータクリアスクリプト開始');
      console.log('=====================================');

      // データベース初期化
      await this.db.initialize();
      console.log('✅ データベース接続完了');

      // バックアップ作成
      if (this.options.backup) {
        await this.createBackup();
      }

      // 現在のデータ状況を確認
      await this.showCurrentData();

      // 確認プロンプト
      if (!this.options.confirm) {
        const confirmed = await this.confirmDeletion();
        if (!confirmed) {
          console.log('❌ 操作がキャンセルされました');
          return;
        }
      }

      // データクリア実行
      await this.clearFormData();

      // 結果確認
      await this.showCurrentData();

      console.log('✅ フォームデータクリア完了');

    } catch (error) {
      logger.error('フォームデータクリアエラー', error);
      console.error('❌ エラーが発生しました:', error.message);
      process.exit(1);
    } finally {
      await this.db.close();
    }
  }

  /**
   * バックアップ作成
   */
  private async createBackup(): Promise<void> {
    try {
      console.log('📦 バックアップを作成中...');
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = path.join(process.cwd(), 'database');
      const backupFile = path.join(backupDir, `forms_backup_${timestamp}.sql`);

      // バックアップディレクトリの作成
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      let backupContent = `-- フォームデータバックアップ ${new Date().toISOString()}\n\n`;

      // 各テーブルのデータをエクスポート
      for (const table of [...FORM_TABLES].reverse()) {
        const rows = await this.db.query(`SELECT * FROM ${table}`);
        
        if (rows.length > 0) {
          backupContent += `-- ${table} テーブルデータ\n`;
          
          for (const row of rows) {
            const columns = Object.keys(row).join(', ');
            const values = Object.values(row).map(v => 
              v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`
            ).join(', ');
            
            backupContent += `INSERT INTO ${table} (${columns}) VALUES (${values});\n`;
          }
          backupContent += '\n';
        }
      }

      fs.writeFileSync(backupFile, backupContent, 'utf8');
      console.log(`✅ バックアップ完了: ${backupFile}`);

    } catch (error) {
      logger.error('バックアップ作成エラー', error);
      throw new Error(`バックアップ作成に失敗しました: ${error.message}`);
    }
  }

  /**
   * 現在のデータ状況を表示
   */
  private async showCurrentData(): Promise<void> {
    try {
      console.log('\n📊 現在のフォームデータ状況:');
      console.log('--------------------------------');

      for (const table of FORM_TABLES) {
        try {
          const rows = await this.db.query(`SELECT COUNT(*) as count FROM ${table}`);
          const count = rows[0]?.count || 0;
          console.log(`${table}: ${count}件`);

          if (this.options.verbose && count > 0) {
            if (table === 'google_forms') {
              const forms = await this.db.query(
                'SELECT id, title, state, created_at FROM google_forms ORDER BY created_at DESC LIMIT 5'
              );
              forms.forEach((form: any) => {
                console.log(`  - ${form.id}: ${form.title} (${form.state}) - ${form.created_at}`);
              });
            }
          }
        } catch (error) {
          console.log(`${table}: テーブルが存在しない`);
        }
      }
      console.log('');
    } catch (error) {
      logger.warn('データ状況確認エラー', error);
    }
  }

  /**
   * 削除確認プロンプト
   */
  private async confirmDeletion(): Promise<boolean> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question('\n⚠️  フォーム関連データを完全に削除しますか？ (yes/no): ', (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
      });
    });
  }

  /**
   * フォームデータクリア実行
   */
  private async clearFormData(): Promise<void> {
    try {
      console.log('🗑️  フォームデータをクリア中...');

      if (this.options.table) {
        // 特定のテーブルのみクリア
        await this.clearTable(this.options.table);
      } else {
        // 全テーブルクリア（外部キー制約を考慮した順序）
        for (const table of FORM_TABLES) {
          await this.clearTable(table);
        }
      }

      console.log('✅ データクリア完了');

    } catch (error) {
      logger.error('データクリアエラー', error);
      throw error;
    }
  }

  /**
   * 特定のテーブルをクリア
   */
  private async clearTable(tableName: string): Promise<void> {
    try {
      const result = await this.db.query(`DELETE FROM ${tableName}`);
      const deletedCount = result[0]?.changes || 0;
      console.log(`  ✅ ${tableName}: ${deletedCount}件削除`);
      
      // SQLite の場合、AUTOINCREMENT のリセット
      if (tableName === 'form_responses' || tableName === 'form_reminders') {
        await this.db.query(`DELETE FROM sqlite_sequence WHERE name = ?`, [tableName]);
        console.log(`  🔄 ${tableName}: AUTO_INCREMENT リセット`);
      }

    } catch (error) {
      if (error.message.includes('no such table')) {
        console.log(`  ⚠️  ${tableName}: テーブルが存在しません`);
      } else {
        logger.error(`テーブル ${tableName} のクリアエラー`, error);
        throw error;
      }
    }
  }
}

/**
 * コマンドライン引数解析
 */
function parseArguments(): ClearOptions {
  const args = process.argv.slice(2);
  const options: ClearOptions = {
    backup: false,
    confirm: false,
    table: undefined,
    verbose: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--backup':
        options.backup = true;
        break;
      case '--confirm':
        options.confirm = true;
        break;
      case '--table':
        options.table = args[++i];
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
フォームデータクリアスクリプト

使用方法:
  npx ts-node scripts/clear-forms-debug.ts [オプション]

オプション:
  --backup           クリア前にバックアップを作成
  --confirm          確認プロンプトをスキップ
  --table <name>     特定のテーブルのみクリア
  --verbose, -v      詳細情報を表示
  --help, -h         このヘルプを表示

例:
  # バックアップ作成してクリア
  npx ts-node scripts/clear-forms-debug.ts --backup

  # 確認なしでクリア
  npx ts-node scripts/clear-forms-debug.ts --confirm

  # 特定のテーブルのみクリア
  npx ts-node scripts/clear-forms-debug.ts --table google_forms

  # すべてのオプション
  npx ts-node scripts/clear-forms-debug.ts --backup --confirm --verbose

対象テーブル:
  - google_forms      メインのフォーム情報
  - form_responses    フォーム回答記録
  - form_reminders    リマインダー送信記録
`);
}

/**
 * メイン実行
 */
if (require.main === module) {
  const options = parseArguments();
  const cleaner = new FormDataCleaner(options);
  
  cleaner.run().catch((error) => {
    console.error('スクリプト実行エラー:', error);
    process.exit(1);
  });
}

export { FormDataCleaner };