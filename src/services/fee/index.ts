import { DatabaseService } from '../database';
import { notificationService } from '../notification';
import { MemberConverter } from '../../utils/memberUtils';
import { logger } from '../../utils/logger';
import { configManager } from '../../config';
import { Client, EmbedBuilder, Guild } from 'discord.js';
import cron from 'node-cron';

export interface FeeStats {
  total: number;
  paid: number;
  unpaid: number;
  partiallyPaid: number;
  exempt: number;
  collectionRate: number;
  byGrade: Record<string, {
    total: number;
    paid: number;
    unpaid: number;
    partiallyPaid: number;
    exempt: number;
    rate: number;
  }>;
  byTeam: Record<string, {
    total: number;
    paid: number;
    unpaid: number;
    partiallyPaid: number;
    exempt: number;
    rate: number;
  }>;
}

export class FeeManagementService {
  private database: DatabaseService;
  private client: Client | null = null;
  private reminderJob: cron.ScheduledTask | null = null;

  constructor(database: DatabaseService) {
    this.database = database;
  }

  public setClient(client: Client): void {
    this.client = client;
  }

  /**
   * 定期的な部費リマインダーを開始
   */
  public startFeeReminder(): void {
    const config = configManager.getConfig();
    
    if (!config.notifications.feeReminder.enabled) {
      logger.info('部費リマインダーが無効になっています');
      return;
    }

    if (this.reminderJob) {
      this.reminderJob.stop();
    }

    // デフォルト: 毎月1日の10:00に実行
    const schedule = config.notifications.feeReminder.schedule || '0 10 1 * *';

    this.reminderJob = cron.schedule(schedule, async () => {
      try {
        await this.sendFeeReminders();
      } catch (error) {
        logger.error('定期部費リマインダーの実行に失敗しました', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, {
      scheduled: true,
      timezone: 'Asia/Tokyo'
    });

    logger.info('部費リマインダーを開始しました', { schedule });
  }

  /**
   * 部費リマインダーを停止
   */
  public stopFeeReminder(): void {
    if (this.reminderJob) {
      this.reminderJob.stop();
      this.reminderJob = null;
      logger.info('部費リマインダーを停止しました');
    }
  }

  /**
   * 部費統計を取得
   */
  public async getFeeStats(): Promise<FeeStats> {
    try {
      const allMembers = await this.database.getAllMembers();
      
      const stats: FeeStats = {
        total: allMembers.length,
        paid: 0,
        unpaid: 0,
        partiallyPaid: 0,
        exempt: 0,
        collectionRate: 0,
        byGrade: {},
        byTeam: {}
      };

      for (const dbMember of allMembers) {
        const member = MemberConverter.dbRowToMember(dbMember);
        if (!member) continue;

        const grade = member.grade.toString();
        const team = member.team;
        const feeStatus = member.membershipFeeRecord;

        // 全体統計
        if (feeStatus === '完納') stats.paid++;
        else if (feeStatus === '未納') stats.unpaid++;
        else if (feeStatus === '一部納入') stats.partiallyPaid++;
        else if (feeStatus === '免除') stats.exempt++;

        // 学年別統計の初期化
        if (!stats.byGrade[grade]) {
          stats.byGrade[grade] = { total: 0, paid: 0, unpaid: 0, partiallyPaid: 0, exempt: 0, rate: 0 };
        }
        stats.byGrade[grade].total++;
        if (feeStatus === '完納') stats.byGrade[grade].paid++;
        else if (feeStatus === '未納') stats.byGrade[grade].unpaid++;
        else if (feeStatus === '一部納入') stats.byGrade[grade].partiallyPaid++;
        else if (feeStatus === '免除') stats.byGrade[grade].exempt++;

        // 班別統計の初期化
        if (!stats.byTeam[team]) {
          stats.byTeam[team] = { total: 0, paid: 0, unpaid: 0, partiallyPaid: 0, exempt: 0, rate: 0 };
        }
        stats.byTeam[team].total++;
        if (feeStatus === '完納') stats.byTeam[team].paid++;
        else if (feeStatus === '未納') stats.byTeam[team].unpaid++;
        else if (feeStatus === '一部納入') stats.byTeam[team].partiallyPaid++;
        else if (feeStatus === '免除') stats.byTeam[team].exempt++;
      }

      // 納入率を計算
      stats.collectionRate = stats.total > 0 ? 
        ((stats.paid + stats.exempt) / stats.total * 100) : 0;

      // 学年別・班別の納入率を計算
      for (const grade in stats.byGrade) {
        const gradeData = stats.byGrade[grade];
        gradeData.rate = gradeData.total > 0 ? 
          ((gradeData.paid + gradeData.exempt) / gradeData.total * 100) : 0;
      }

      for (const team in stats.byTeam) {
        const teamData = stats.byTeam[team];
        teamData.rate = teamData.total > 0 ? 
          ((teamData.paid + teamData.exempt) / teamData.total * 100) : 0;
      }

      return stats;

    } catch (error) {
      logger.error('部費統計の取得に失敗しました', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * 未納者にリマインダーを送信
   */
  public async sendFeeReminders(customMessage?: string): Promise<{ success: number; failure: number }> {
    if (!this.client) {
      throw new Error('Discord クライアントが設定されていません');
    }

    try {
      const unpaidMembers = await this.database.getUnpaidMembers();
      
      if (unpaidMembers.length === 0) {
        logger.info('部費未納者がいないため、リマインダーをスキップしました');
        return { success: 0, failure: 0 };
      }

      const defaultMessage = [
        '🔔 **部費納入のお知らせ**',
        '',
        '今月の部費の納入期限が近づいています。',
        'まだ納入がお済みでない方は、お早めにお手続きをお願いいたします。',
        '',
        '**納入方法**:',
        '• 現金: 部室にて部費担当者まで',
        '• 振込: 指定口座への振込',
        '• その他: 管理者にお問い合わせください',
        '',
        'ご質問やご不明な点がございましたら、いつでも管理者までお問い合わせください。'
      ].join('\n');

      const message = customMessage || defaultMessage;
      let successCount = 0;
      let failureCount = 0;

      // 各ギルドで処理
      for (const [, guild] of this.client.guilds.cache) {
        for (const dbMember of unpaidMembers) {
          try {
            const member = MemberConverter.dbRowToMember(dbMember);
            if (!member) continue;

            const discordMember = await guild.members.fetch(dbMember.discord_id).catch(() => null);
            if (!discordMember) continue;

            const embed = new EmbedBuilder()
              .setColor('#ffaa00')
              .setTitle('💰 部費納入リマインダー')
              .setDescription(message)
              .addFields(
                {
                  name: '現在の状況',
                  value: `**納入状況**: ${member.membershipFeeRecord}`,
                  inline: false,
                },
                {
                  name: '部員情報',
                  value: [
                    `**学年**: ${member.grade}年`,
                    `**班**: ${member.team}`
                  ].join('\n'),
                  inline: true,
                }
              )
              .setFooter({ text: '部活動管理BOT - 自動リマインダー' })
              .setTimestamp();

            await discordMember.send({ embeds: [embed] });
            successCount++;

            // レート制限対策
            await new Promise(resolve => setTimeout(resolve, 2000));

          } catch (error) {
            logger.warn('部費リマインダー送信に失敗しました', {
              memberId: dbMember.discord_id,
              error: error instanceof Error ? error.message : 'Unknown error'
            });
            failureCount++;
          }
        }
      }

      // 管理者に結果を通知
      await notificationService.sendSystemNotification(
        '部費リマインダー送信完了',
        `定期部費リマインダーの送信が完了しました。\n\n` +
        `**送信結果**:\n` +
        `• 成功: ${successCount}名\n` +
        `• 失敗: ${failureCount}名\n` +
        `• 対象者: ${unpaidMembers.length}名`
      );

      logger.info('部費リマインダーの送信が完了しました', {
        success: successCount,
        failure: failureCount,
        total: unpaidMembers.length
      });

      return { success: successCount, failure: failureCount };

    } catch (error) {
      logger.error('部費リマインダーの送信に失敗しました', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * 月次部費レポートを生成・送信
   */
  public async sendMonthlyFeeReport(): Promise<void> {
    try {
      const stats = await this.getFeeStats();
      const now = new Date();
      const monthName = now.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' });

      const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`📊 ${monthName} 部費納入レポート`)
        .setDescription(`総部員数: ${stats.total}名 | 納入率: ${stats.collectionRate.toFixed(1)}%`)
        .addFields(
          {
            name: '📈 納入状況',
            value: [
              `✅ **完納**: ${stats.paid}名`,
              `❌ **未納**: ${stats.unpaid}名`,
              `⚠️ **一部納入**: ${stats.partiallyPaid}名`,
              `🆓 **免除**: ${stats.exempt}名`
            ].join('\n'),
            inline: true,
          }
        )
        .setTimestamp();

      // 学年別上位3位
      const topGrades = Object.entries(stats.byGrade)
        .sort((a, b) => b[1].rate - a[1].rate)
        .slice(0, 3);

      if (topGrades.length > 0) {
        const gradeStats = topGrades.map(([grade, data], index) => {
          const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
          return `${medal} **${grade}年**: ${data.rate.toFixed(1)}% (${data.paid + data.exempt}/${data.total})`;
        }).join('\n');

        embed.addFields({
          name: '🏆 学年別納入率ランキング',
          value: gradeStats,
          inline: true,
        });
      }

      // 班別上位3位
      const topTeams = Object.entries(stats.byTeam)
        .sort((a, b) => b[1].rate - a[1].rate)
        .slice(0, 3);

      if (topTeams.length > 0) {
        const teamStats = topTeams.map(([team, data], index) => {
          const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
          return `${medal} **${team}**: ${data.rate.toFixed(1)}% (${data.paid + data.exempt}/${data.total})`;
        }).join('\n');

        embed.addFields({
          name: '🏆 班別納入率ランキング',
          value: teamStats,
          inline: true,
        });
      }

      await notificationService.sendSystemNotification(
        '月次部費レポート',
        '',
        embed
      );

      logger.info('月次部費レポートを送信しました', {
        collectionRate: stats.collectionRate.toFixed(1),
        totalMembers: stats.total
      });

    } catch (error) {
      logger.error('月次部費レポートの送信に失敗しました', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * 特定のメンバーの部費履歴を取得
   */
  public async getMemberFeeHistory(discordId: string): Promise<any[]> {
    try {
      // TODO: 部費履歴テーブルが実装されたら、そこから履歴を取得
      // 現在は監査ログから部費関連の変更を取得
      const auditLogs = await this.database.getAuditLogsByUser(discordId, 'fee_update');
      return auditLogs || [];
    } catch (error) {
      logger.error('部費履歴の取得に失敗しました', {
        discordId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  /**
   * 部費納入期限のチェック
   */
  public async checkFeeDeadlines(): Promise<void> {
    try {
      // TODO: 部費期限管理機能の実装
      // 現在は基本的な実装のプレースホルダー
      logger.info('部費期限チェックを実行しました');
    } catch (error) {
      logger.error('部費期限チェックに失敗しました', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}