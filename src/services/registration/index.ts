import { GoogleSheetsService } from '../google';
import { DatabaseService } from '../database';
import { notificationService } from '../notification';
import { MemberValidator, MemberConverter } from '../../utils/memberUtils';
import { logger } from '../../utils/logger';
import { configManager } from '../../config';
import { Member } from '../../types';
import { Client, Guild, GuildMember } from 'discord.js';

export interface RegistrationCandidate {
  member: Member;
  timestamp: Date;
  discordId?: string;
  source: 'manual';
}

export class RegistrationService {
  private googleSheets: GoogleSheetsService;
  private database: DatabaseService;
  private client: Client | null = null;
  private lastCheckTimestamp: Date = new Date();
  private registrationInterval: NodeJS.Timeout | null = null;

  constructor(googleSheets: GoogleSheetsService, database: DatabaseService) {
    this.googleSheets = googleSheets;
    this.database = database;
  }

  public setClient(client: Client): void {
    this.client = client;
  }

  /**
   * 定期的な登録監視を開始
   */
  public startRegistrationMonitoring(intervalMinutes: number = 5): void {
    if (this.registrationInterval) {
      clearInterval(this.registrationInterval);
    }

    this.registrationInterval = setInterval(async () => {
      try {
        await this.checkForNewRegistrations();
      } catch (error) {
        logger.error('登録監視でエラーが発生しました', { 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }, intervalMinutes * 60 * 1000);

    logger.info('登録監視を開始しました', { intervalMinutes });
  }

  /**
   * 登録監視を停止
   */
  public stopRegistrationMonitoring(): void {
    if (this.registrationInterval) {
      clearInterval(this.registrationInterval);
      this.registrationInterval = null;
      logger.info('登録監視を停止しました');
    }
  }

  /**
   * 新規登録をチェック
   */
  public async checkForNewRegistrations(): Promise<RegistrationCandidate[]> {
    try {
      const config = configManager.getConfig();
      if (!config.sheets.spreadsheetId) {
        logger.warn('スプレッドシートIDが設定されていません');
        return [];
      }

      // スプレッドシートから全データを取得
      const allMembers = await this.googleSheets.getAllMembers();
      const newRegistrations: RegistrationCandidate[] = [];

      for (const member of allMembers) {
        try {
          // データベースで既存チェック
          const existingMember = await this.findExistingMember(member);
          
          if (!existingMember) {
            // 新規登録候補
            const candidate: RegistrationCandidate = {
              member,
              timestamp: new Date(),
              source: 'manual'
            };

            // Discord上でユーザーを検索
            const discordMember = await this.findDiscordMember(member);
            if (discordMember) {
              candidate.discordId = discordMember.id;
              
              // 自動登録を実行
              await this.processRegistration(candidate, discordMember);
              newRegistrations.push(candidate);
            } else {
              // Discord上にユーザーが見つからない場合の処理
              await this.handleUnmatchedRegistration(candidate);
              newRegistrations.push(candidate);
            }
          }
        } catch (error) {
          logger.error('個別メンバーの処理でエラーが発生しました', {
            memberName: member.name,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      if (newRegistrations.length > 0) {
        logger.info('新規登録を検出しました', { count: newRegistrations.length });
      }

      return newRegistrations;

    } catch (error) {
      logger.error('新規登録チェックでエラーが発生しました', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return [];
    }
  }

  /**
   * 既存メンバーの検索
   */
  private async findExistingMember(member: Member): Promise<any | null> {
    try {
      // 学籍番号で検索
      const existingByStudentId = await this.database.searchMembers(member.studentId, 1);
      if (existingByStudentId.length > 0) {
        return existingByStudentId[0];
      }

      // Discordユーザー名で検索
      const existingByUsername = await this.database.searchMembers(member.discordUsername, 1);
      if (existingByUsername.length > 0) {
        return existingByUsername[0];
      }

      return null;
    } catch (error) {
      logger.error('既存メンバー検索でエラーが発生しました', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        memberName: member.name
      });
      return null;
    }
  }

  /**
   * Discordメンバーの検索
   */
  private async findDiscordMember(member: Member): Promise<GuildMember | null> {
    if (!this.client) {
      logger.warn('Discord クライアントが設定されていません');
      return null;
    }

    try {
      const guilds = this.client.guilds.cache;
      
      for (const [, guild] of guilds) {
        try {
          // ユーザー名で検索
          const members = await guild.members.fetch();
          const foundMember = members.find(m => 
            m.user.username === member.discordUsername ||
            m.displayName === member.discordDisplayName ||
            m.nickname === member.discordDisplayName
          );

          if (foundMember) {
            return foundMember;
          }
        } catch (error) {
          logger.debug('ギルドメンバー検索でエラー', { 
            guildId: guild.id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      return null;
    } catch (error) {
      logger.error('Discord メンバー検索でエラーが発生しました', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        memberName: member.name
      });
      return null;
    }
  }

  /**
   * 登録処理の実行
   */
  public async processRegistration(candidate: RegistrationCandidate, discordMember?: GuildMember): Promise<void> {
    try {
      const discordId = candidate.discordId || discordMember?.id;
      
      if (!discordId) {
        throw new Error('Discord IDが特定できません');
      }

      // データベースに登録
      await this.database.insertMember(candidate.member, discordId);
      
      logger.info('新規メンバーを登録しました', {
        name: candidate.member.name,
        studentId: candidate.member.studentId,
        discordId: discordId
      });

      // 登録完了通知を送信
      await this.sendRegistrationNotification(candidate, discordMember);

      // 監査ログの記録
      await this.logRegistration(candidate, discordId);

    } catch (error) {
      logger.error('登録処理でエラーが発生しました', {
        memberName: candidate.member.name,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * 一致しない登録の処理
   */
  private async handleUnmatchedRegistration(candidate: RegistrationCandidate): Promise<void> {
    logger.warn('Discord上でユーザーが見つかりませんでした', {
      name: candidate.member.name,
      discordUsername: candidate.member.discordUsername,
      discordDisplayName: candidate.member.discordDisplayName
    });

    // 管理者に通知
    await notificationService.sendSystemNotification(
      'Discordユーザー未確認の登録',
      `以下の登録でDiscordユーザーが見つかりませんでした：\n\n` +
      `**名前**: ${candidate.member.name}\n` +
      `**学籍番号**: ${candidate.member.studentId}\n` +
      `**Discordユーザー名**: ${candidate.member.discordUsername}\n` +
      `**Discord表示名**: ${candidate.member.discordDisplayName}\n\n` +
      `手動での確認が必要です。`
    );
  }

  /**
   * 登録完了通知の送信
   */
  private async sendRegistrationNotification(candidate: RegistrationCandidate, discordMember?: GuildMember): Promise<void> {
    try {
      const config = configManager.getConfig();
      
      // 本人への通知
      if (discordMember) {
        try {
          const memberEmbed = MemberConverter.memberToRow(candidate.member);
          await discordMember.send({
            embeds: [{
              title: '🎉 登録完了',
              description: '部活動への登録が完了しました！',
              fields: [
                { name: '名前', value: candidate.member.name, inline: true },
                { name: '学年', value: `${candidate.member.grade}年`, inline: true },
                { name: '班', value: candidate.member.team, inline: true }
              ],
              color: 0x00ff00,
              timestamp: new Date().toISOString()
            }]
          });
        } catch (error) {
          logger.warn('本人への登録完了通知送信に失敗しました', { 
            error: error instanceof Error ? error.message : 'Unknown error',
            userId: discordMember.id
          });
        }
      }

      // 管理者への通知
      await notificationService.sendSystemNotification(
        '新規メンバー登録完了',
        `新しいメンバーが登録されました：\n\n` +
        `**名前**: ${candidate.member.name}\n` +
        `**学籍番号**: ${candidate.member.studentId}\n` +
        `**学年**: ${candidate.member.grade}年\n` +
        `**班**: ${candidate.member.team}\n` +
        `**部費状況**: ${candidate.member.membershipFeeRecord}\n` +
        `**Discord**: ${discordMember ? `<@${discordMember.id}>` : candidate.member.discordUsername}`
      );

    } catch (error) {
      logger.error('登録完了通知の送信でエラーが発生しました', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        memberName: candidate.member.name
      });
    }
  }

  /**
   * 登録の監査ログ記録
   */
  private async logRegistration(candidate: RegistrationCandidate, discordId: string): Promise<void> {
    try {
      await this.database.insertAuditLog({
        timestamp: new Date(),
        userId: discordId,
        action: 'member_registration',
        target: candidate.member.studentId,
        oldValue: null,
        newValue: candidate.member,
        result: 'success'
      });
    } catch (error) {
      logger.error('監査ログの記録に失敗しました', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        memberName: candidate.member.name
      });
    }
  }

  /**
   * 手動登録
   */
  public async manualRegistration(member: Member, discordId: string): Promise<void> {
    const candidate: RegistrationCandidate = {
      member,
      timestamp: new Date(),
      discordId,
      source: 'manual'
    };

    await this.processRegistration(candidate);
  }

  /**
   * 登録状況の統計取得
   */
  public async getRegistrationStats(): Promise<{
    totalMembers: number;
    recentRegistrations: number;
    unmatchedRegistrations: number;
  }> {
    try {
      const totalMembers = await this.database.getTotalMembersCount();
      
      // 直近24時間の登録数（実装により調整）
      const recentRegistrations = 0; // TODO: 実装
      
      // 未確認登録数（実装により調整）
      const unmatchedRegistrations = 0; // TODO: 実装

      return {
        totalMembers,
        recentRegistrations,
        unmatchedRegistrations
      };
    } catch (error) {
      logger.error('登録統計の取得でエラーが発生しました', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return {
        totalMembers: 0,
        recentRegistrations: 0,
        unmatchedRegistrations: 0
      };
    }
  }
}