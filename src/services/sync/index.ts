import { CronJob } from 'cron';
import { GoogleSheetsService } from '../google';
import { DatabaseService } from '../database';
import { logger } from '../../utils/logger';
import { configManager } from '../../config';
import { Member } from '../../types';

export class SyncService {
  private cronJob: CronJob | null = null;
  private isRunning: boolean = false;
  private lastSyncTime: Date | null = null;
  private syncInterval: string;
  private autoSyncEnabled: boolean;

  constructor() {
    // 環境変数から設定を読み込む
    this.syncInterval = process.env.AUTO_SYNC_INTERVAL || '0 */30 * * * *'; // デフォルト: 30分ごと
    this.autoSyncEnabled = process.env.AUTO_SYNC_ENABLED !== 'false'; // デフォルト: 有効
  }

  /**
   * 起動時の初期同期を実行
   */
  public async performInitialSync(): Promise<void> {
    if (!this.autoSyncEnabled) {
      logger.info('自動同期が無効化されているため、初期同期をスキップします');
      return;
    }

    logger.info('起動時の初期同期を開始します');
    await this.syncFromSheetToDatabase('startup');
  }

  /**
   * 定期同期を開始
   */
  public startPeriodicSync(): void {
    if (!this.autoSyncEnabled) {
      logger.info('自動同期が無効化されているため、定期同期を開始しません');
      return;
    }

    if (this.cronJob) {
      logger.warn('定期同期は既に実行中です');
      return;
    }

    this.cronJob = new CronJob(
      this.syncInterval,
      async () => {
        await this.syncFromSheetToDatabase('periodic');
      },
      null,
      true,
      'Asia/Tokyo'
    );

    logger.info('定期同期を開始しました', { interval: this.syncInterval });
  }

  /**
   * 定期同期を停止
   */
  public stopPeriodicSync(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      logger.info('定期同期を停止しました');
    }
  }

  /**
   * スプレッドシートからデータベースへの最適化された同期を実行
   */
  public async syncFromSheetToDatabase(trigger: 'manual' | 'startup' | 'periodic' | 'webhook' | 'pre-operation' = 'manual'): Promise<{ success: number; errors: number; skipped: number }> {
    if (this.isRunning) {
      logger.warn('同期処理が既に実行中です');
      return { success: 0, errors: 0, skipped: 0 };
    }

    this.isRunning = true;
    const startTime = new Date();
    
    const db = new DatabaseService();
    const sheetsService = new GoogleSheetsService();
    
    try {
      logger.info('最適化された同期処理を開始', { trigger });
      
      await db.initialize();
      
      const config = configManager.getConfig();
      if (!config.sheets.spreadsheetId) {
        throw new Error('スプレッドシートIDが設定されていません');
      }

      // 最後の同期メタデータを確認
      const lastSyncMeta = await db.getLastSyncMetadata('sheet-to-db');
      
      // スプレッドシートのメタデータ付きデータ取得
      const sheetResult = await sheetsService.getAllMembersWithMetadata();
      
      // 最適化判定: スプレッドシートが更新されていない場合はスキップ
      if (lastSyncMeta && sheetResult.lastModified && trigger === 'pre-operation') {
        const lastSync = new Date(lastSyncMeta.last_sync_timestamp);
        const sheetLastModified = sheetResult.lastModified;
        
        if (sheetLastModified <= lastSync) {
          logger.info('スプレッドシートに変更がないため同期をスキップ', {
            lastSync: lastSync.toISOString(),
            sheetLastModified: sheetLastModified.toISOString(),
            trigger
          });
          
          // 同期スキップのメタデータを保存
          await db.saveSyncMetadata({
            syncType: 'sheet-to-db',
            lastSyncTimestamp: new Date(),
            sheetLastModified: sheetResult.lastModified,
            recordsProcessed: 0,
            recordsUpdated: 0,
            recordsAdded: 0,
            recordsSkipped: 0,
            syncDuration: Date.now() - startTime.getTime(),
            status: 'skipped_no_changes'
          });
          
          return { success: 0, errors: 0, skipped: 0 };
        }
      }

      const sheetMembers = sheetResult.members;
      
      if (sheetMembers.length === 0) {
        logger.warn('スプレッドシートに部員データがありません');
        return { success: 0, errors: 0, skipped: 0 };
      }

      logger.info(`${sheetMembers.length}名の部員データを同期します`);

      let successCount = 0;
      let errorCount = 0;
      let skippedCount = 0;

      // 各部員データを処理
      for (const member of sheetMembers) {
        try {
          // Discord IDは仮でユーザー名から生成（実際の運用では要改善）
          const existingMember = await db.getMemberByDiscordUsername(member.discordUsername);
          
          if (existingMember) {
            // 既存メンバーの更新
            const hasChanges = this.detectChanges(existingMember, member);
            
            // Test Testユーザーの詳細ログ
            if (member.name === 'Test Test' || member.discordUsername === 'sabubakudan') {
              logger.warn('Test Testユーザーの同期処理', {
                sheetData: {
                  name: member.name,
                  discordUsername: member.discordUsername,
                  membershipFeeRecord: member.membershipFeeRecord,
                  team: member.team
                },
                dbData: {
                  name: existingMember.name,
                  discord_username: existingMember.discord_username,
                  membership_fee_record: existingMember.membership_fee_record,
                  team: existingMember.team
                },
                hasChanges,
                trigger
              });
            }
            
            if (hasChanges) {
              // Test Testユーザーの更新ログ
              if (member.name === 'Test Test' || member.discordUsername === 'sabubakudan') {
                logger.warn('Test Testユーザーをデータベースで更新', {
                  updates: {
                    name: member.name,
                    discordDisplayName: member.discordDisplayName,
                    studentId: member.studentId,
                    gender: member.gender,
                    team: member.team,
                    membershipFeeRecord: member.membershipFeeRecord,
                    grade: member.grade
                  }
                });
              }
              
              await db.updateMember(existingMember.discord_id, {
                name: member.name,
                discordDisplayName: member.discordDisplayName,
                studentId: member.studentId,
                gender: member.gender,
                team: member.team,
                membershipFeeRecord: member.membershipFeeRecord,
                grade: member.grade
              });
              logger.debug(`更新: ${member.name}`);
              successCount++;
            } else {
              logger.debug(`変更なし: ${member.name}`);
              skippedCount++;
            }
          } else {
            // 新規メンバーの場合はスキップ（Discord IDが不明のため）
            logger.info(`新規メンバーをスキップ: ${member.name} (Discord IDが不明)`);
            skippedCount++;
          }
        } catch (error) {
          logger.error(`部員データの同期エラー: ${member.name}`, { error: error.message });
          errorCount++;
        }
      }

      const duration = Date.now() - startTime.getTime();
      const syncEndTime = new Date();
      
      logger.info('最適化された同期処理完了', {
        trigger,
        duration: `${duration}ms`,
        success: successCount,
        errors: errorCount,
        skipped: skippedCount,
        totalProcessed: sheetMembers.length,
        lastModified: sheetResult.lastModified?.toISOString(),
        performanceGain: lastSyncMeta ? 'timestamp_optimization_enabled' : 'first_sync'
      });

      // 同期メタデータを保存
      await db.saveSyncMetadata({
        syncType: 'sheet-to-db',
        lastSyncTimestamp: syncEndTime,
        sheetLastModified: sheetResult.lastModified,
        recordsProcessed: sheetMembers.length,
        recordsUpdated: successCount,
        recordsAdded: 0, // 新規追加は現在未対応
        recordsSkipped: skippedCount,
        syncDuration: duration,
        status: errorCount > 0 ? 'completed_with_errors' : 'completed',
        errorMessage: errorCount > 0 ? `${errorCount}件のエラー` : undefined
      });

      this.lastSyncTime = syncEndTime;
      
      return { success: successCount, errors: errorCount, skipped: skippedCount };

    } catch (error) {
      const duration = Date.now() - startTime.getTime();
      logger.error('同期処理でエラーが発生しました', { 
        error: error.message, 
        trigger,
        duration: `${duration}ms`
      });
      
      // エラー時もメタデータを保存
      try {
        await db.saveSyncMetadata({
          syncType: 'sheet-to-db',
          lastSyncTimestamp: new Date(),
          recordsProcessed: 0,
          recordsUpdated: 0,
          recordsAdded: 0,
          recordsSkipped: 0,
          syncDuration: duration,
          status: 'failed',
          errorMessage: error.message
        });
      } catch (metaError) {
        logger.error('同期エラーメタデータの保存に失敗', { error: metaError.message });
      }
      
      throw error;
    } finally {
      this.isRunning = false;
      await db.close();
      
      // メモリクリーンアップ
      if (global.gc) {
        global.gc();
        logger.debug('同期処理後にガベージコレクションを実行');
      }
    }
  }

  /**
   * 変更を検知
   */
  private detectChanges(dbMember: any, sheetMember: Member): boolean {
    const changes = [];
    
    if (dbMember.name !== sheetMember.name) {
      changes.push(`name: "${dbMember.name}" → "${sheetMember.name}"`);
    }
    if (dbMember.discord_display_name !== sheetMember.discordDisplayName) {
      changes.push(`discord_display_name: "${dbMember.discord_display_name}" → "${sheetMember.discordDisplayName}"`);
    }
    if (dbMember.student_id !== sheetMember.studentId) {
      changes.push(`student_id: "${dbMember.student_id}" → "${sheetMember.studentId}"`);
    }
    if (dbMember.gender !== sheetMember.gender) {
      changes.push(`gender: "${dbMember.gender}" → "${sheetMember.gender}"`);
    }
    if (dbMember.team !== sheetMember.team) {
      changes.push(`team: "${dbMember.team}" → "${sheetMember.team}"`);
    }
    if (dbMember.membership_fee_record !== sheetMember.membershipFeeRecord) {
      changes.push(`membership_fee_record: "${dbMember.membership_fee_record}" → "${sheetMember.membershipFeeRecord}"`);
    }
    if (dbMember.grade !== sheetMember.grade) {
      changes.push(`grade: ${dbMember.grade} → ${sheetMember.grade}`);
    }
    
    if (changes.length > 0 && (sheetMember.name === 'Test Test' || sheetMember.discordUsername === 'sabubakudan')) {
      logger.warn('Test Testユーザーの変更詳細', {
        memberName: sheetMember.name,
        changes: changes
      });
    }
    
    return changes.length > 0;
  }

  /**
   * 最後の同期時刻を取得
   */
  public getLastSyncTime(): Date | null {
    return this.lastSyncTime;
  }

  /**
   * 同期状態を取得
   */
  public getSyncStatus(): { isRunning: boolean; lastSyncTime: Date | null; autoSyncEnabled: boolean; syncInterval: string } {
    return {
      isRunning: this.isRunning,
      lastSyncTime: this.lastSyncTime,
      autoSyncEnabled: this.autoSyncEnabled,
      syncInterval: this.syncInterval
    };
  }

  /**
   * スプレッドシートとデータベースの差分を比較
   */
  public async compareSheetAndDatabase(): Promise<{
    hasChanges: boolean;
    sheetOnly: Member[];
    dbOnly: any[];
    different: { sheet: Member; db: any }[];
  }> {
    const db = new DatabaseService();
    const sheetsService = new GoogleSheetsService();
    
    try {
      await db.initialize();
      
      const config = configManager.getConfig();
      if (!config.sheets.spreadsheetId) {
        throw new Error('スプレッドシートIDが設定されていません');
      }

      const [sheetMembers, dbMembers] = await Promise.all([
        sheetsService.getAllMembers(),
        db.getAllMembers()
      ]);

      const sheetOnly: Member[] = [];
      const dbOnly: any[] = [];
      const different: { sheet: Member; db: any }[] = [];

      // スプレッドシートにのみ存在するメンバー
      for (const sheetMember of sheetMembers) {
        const dbMember = dbMembers.find(db => db.discord_username === sheetMember.discordUsername);
        if (!dbMember) {
          sheetOnly.push(sheetMember);
        } else if (this.detectChanges(dbMember, sheetMember)) {
          different.push({ sheet: sheetMember, db: dbMember });
        }
      }

      // データベースにのみ存在するメンバー
      for (const dbMember of dbMembers) {
        const sheetMember = sheetMembers.find(sheet => sheet.discordUsername === dbMember.discord_username);
        if (!sheetMember) {
          dbOnly.push(dbMember);
        }
      }

      const hasChanges = sheetOnly.length > 0 || dbOnly.length > 0 || different.length > 0;

      logger.info('差分比較結果', {
        hasChanges,
        sheetOnly: sheetOnly.length,
        dbOnly: dbOnly.length,
        different: different.length
      });

      return { hasChanges, sheetOnly, dbOnly, different };

    } finally {
      await db.close();
    }
  }

  /**
   * 部員データ操作前の自動同期
   */
  public async syncBeforeDataOperation(): Promise<{ success: boolean; message: string; syncResult?: any }> {
    try {
      logger.info('データ操作前の自動同期を開始');
      
      const comparison = await this.compareSheetAndDatabase();
      
      if (!comparison.hasChanges) {
        logger.info('差分がないため同期をスキップ');
        return { 
          success: true, 
          message: 'スプレッドシートとデータベースに差分はありません' 
        };
      }

      logger.info('差分が検出されたため同期を実行', {
        sheetOnly: comparison.sheetOnly.length,
        different: comparison.different.length
      });

      const syncResult = await this.syncFromSheetToDatabase('pre-operation');
      
      return {
        success: true,
        message: `差分を同期しました（成功: ${syncResult.success}名, エラー: ${syncResult.errors}名）`,
        syncResult
      };

    } catch (error) {
      logger.error('データ操作前の同期でエラー', { error: error.message });
      return {
        success: false,
        message: `同期エラー: ${error.message}`
      };
    }
  }

  /**
   * 特定の部員データをスプレッドシートに更新（編集後の強制更新）
   */
  public async updateMemberToSheet(member: {
    discordId: string;
    name: string;
    discordDisplayName: string;
    discordUsername: string;
    studentId: string;
    gender: string;
    team: string;
    membershipFeeRecord: string;
    grade: string;
  }): Promise<{ success: boolean; message: string }> {
    if (this.isRunning) {
      logger.warn('同期処理が実行中のため、シート更新を待機');
      return { success: false, message: '同期処理が実行中です。しばらく待ってから再試行してください。' };
    }

    const sheetsService = new GoogleSheetsService();
    
    try {
      logger.info('編集後のシート更新を開始', { 
        memberName: member.name,
        discordUsername: member.discordUsername 
      });

      const config = configManager.getConfig();
      if (!config.sheets.spreadsheetId) {
        throw new Error('スプレッドシートIDが設定されていません');
      }

      // 環境変数に関係なく強制的に更新
      logger.warn('編集コマンドによる強制シート更新', {
        member: member.name,
        protectSetting: process.env.PROTECT_SPREADSHEET
      });

      await sheetsService.updateMemberInSheet({
        name: member.name,
        discordDisplayName: member.discordDisplayName,
        discordUsername: member.discordUsername,
        studentId: member.studentId,
        gender: member.gender as '男性' | '女性' | 'その他' | '未回答',
        team: member.team,
        membershipFeeRecord: member.membershipFeeRecord as '完納' | '未納' | '一部納入' | '免除',
        grade: typeof member.grade === 'string' ? parseInt(member.grade) || 1 : member.grade
      });

      logger.info('編集後のシート更新完了', { memberName: member.name });
      
      return {
        success: true,
        message: `${member.name}のデータをスプレッドシートに更新しました`
      };

    } catch (error) {
      logger.error('編集後のシート更新でエラー', { 
        error: error.message,
        memberName: member.name 
      });
      return {
        success: false,
        message: `シート更新エラー: ${error.message}`
      };
    }
  }
}

// シングルトンインスタンス
export const syncService = new SyncService();