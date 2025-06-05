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
   * スプレッドシートからデータベースへの同期を実行
   */
  public async syncFromSheetToDatabase(trigger: 'manual' | 'startup' | 'periodic' | 'webhook' = 'manual'): Promise<{ success: number; errors: number; skipped: number }> {
    if (this.isRunning) {
      logger.warn('同期処理が既に実行中です');
      return { success: 0, errors: 0, skipped: 0 };
    }

    this.isRunning = true;
    const startTime = new Date();
    
    const db = new DatabaseService();
    const sheetsService = new GoogleSheetsService();
    
    try {
      logger.info('スプレッドシート→データベース同期を開始', { trigger });
      
      await db.initialize();
      
      const config = configManager.getConfig();
      if (!config.sheets.spreadsheetId) {
        throw new Error('スプレッドシートIDが設定されていません');
      }

      // スプレッドシートから部員データを取得
      const sheetMembers = await sheetsService.getAllMembers();
      
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
      logger.info('スプレッドシート→データベース同期完了', {
        trigger,
        duration: `${duration}ms`,
        success: successCount,
        errors: errorCount,
        skipped: skippedCount
      });

      this.lastSyncTime = new Date();
      
      return { success: successCount, errors: errorCount, skipped: skippedCount };

    } catch (error) {
      logger.error('同期処理でエラーが発生しました', { error: error.message });
      throw error;
    } finally {
      this.isRunning = false;
      await db.close();
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
}

// シングルトンインスタンス
export const syncService = new SyncService();