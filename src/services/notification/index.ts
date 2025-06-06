import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import { configManager } from '../../config';
import { DatabaseService } from '../database';
import { logger } from '../../utils/logger';
import { NotificationPayload } from '../../types';
import * as cron from 'node-cron';

export class NotificationService {
  private static instance: NotificationService;
  private client: Client | null = null;
  private scheduledJobs: Map<string, cron.ScheduledTask> = new Map();

  private constructor() {}

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  public setClient(client: Client): void {
    this.client = client;
    this.initializeScheduledNotifications();
  }

  public async sendNotification(payload: NotificationPayload): Promise<void> {
    if (!this.client) {
      logger.warn('Discord クライアントが設定されていないため、通知を送信できません');
      return;
    }

    try {
      const config = configManager.getConfig();
      let channelId = payload.channelId;

      // デフォルトチャンネルの設定
      if (!channelId) {
        if (payload.type === 'system') {
          channelId = config.notifications.systemNotifications.channelId;
        } else {
          channelId = config.notifications.systemNotifications.channelId;
        }
      }

      if (!channelId) {
        logger.warn('通知チャンネルが設定されていません', { type: payload.type });
        return;
      }

      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        logger.error('通知チャンネルが見つからないか、テキストチャンネルではありません', { channelId });
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(payload.title)
        .setDescription(payload.message)
        .setColor(payload.embedColor || this.getDefaultColor(payload.type))
        .setTimestamp();

      if (payload.fields && payload.fields.length > 0) {
        embed.addFields(payload.fields);
      }

      // 特定ユーザーへの通知の場合
      if (payload.recipient) {
        const content = `<@${payload.recipient}>`;
        await (channel as TextChannel).send({ content, embeds: [embed] });
      } else {
        await (channel as TextChannel).send({ embeds: [embed] });
      }

      logger.info('通知を送信しました', {
        type: payload.type,
        title: payload.title,
        channelId,
        recipient: payload.recipient,
      });

    } catch (error) {
      logger.error('通知の送信に失敗しました', {
        error: (error as Error).message,
        payload: payload,
      });
    }
  }

  public async sendFeeReminder(): Promise<void> {
    logger.info('部費未納リマインドを開始します');

    try {
      const db = new DatabaseService();
      await db.initialize();

      const unpaidMembers = await db.getUnpaidMembers();
      
      if (unpaidMembers.length === 0) {
        logger.info('部費未納者がいないため、リマインドをスキップします');
        await db.close();
        return;
      }

      // 全体通知
      await this.sendNotification({
        type: 'fee_reminder',
        title: '💰 部費納入リマインド',
        message: `${unpaidMembers.length}名の部員に部費未納があります。`,
        fields: [
          {
            name: '対象者数',
            value: `${unpaidMembers.length}名`,
            inline: true,
          },
          {
            name: '確認方法',
            value: '`/fee unpaid` コマンドで詳細を確認できます',
            inline: false,
          }
        ],
        embedColor: 0xffaa00,
      });

      // 個別通知（オプション）
      const config = configManager.getConfig();
      if (config.notifications.feeReminder.enabled) {
        for (const member of unpaidMembers) {
          try {
            if (this.client) {
              const user = await this.client.users.fetch(member.discord_id);
              await user.send({
                embeds: [{
                  title: '💰 部費納入のお知らせ',
                  description: '部費の納入をお忘れではありませんか？',
                  fields: [
                    {
                      name: '現在の状況',
                      value: member.membership_fee_record,
                      inline: false,
                    },
                    {
                      name: '確認方法',
                      value: 'Discordサーバーで `/fee check` コマンドを使用して確認できます',
                      inline: false,
                    }
                  ],
                  color: 0xffaa00,
                  timestamp: new Date().toISOString(),
                }]
              });
            }
          } catch (error) {
            logger.warn('個別リマインドの送信に失敗しました', {
              memberId: member.discord_id,
              memberName: member.name,
              error: (error as Error).message,
            });
          }
        }
      }

      await db.close();
      logger.info('部費未納リマインドを完了しました', { count: unpaidMembers.length });

    } catch (error) {
      logger.error('部費未納リマインドに失敗しました', { error: (error as Error).message });
    }
  }


  private initializeScheduledNotifications(): void {
    const config = configManager.getConfig();

    // 部費リマインダーのスケジュール
    if (config.notifications.feeReminder.enabled && config.notifications.feeReminder.schedule) {
      try {
        const task = cron.schedule(config.notifications.feeReminder.schedule, () => {
          this.sendFeeReminder().catch(error => {
            logger.error('スケジュールされた部費リマインドに失敗しました', { error: error.message });
          });
        }, {
          scheduled: false,
          timezone: 'Asia/Tokyo',
        });

        task.start();
        this.scheduledJobs.set('feeReminder', task);
        logger.info('部費リマインダーのスケジュールを設定しました', { 
          schedule: config.notifications.feeReminder.schedule 
        });
      } catch (error) {
        logger.error('部費リマインダーのスケジュール設定に失敗しました', { 
          error: (error as Error).message,
          schedule: config.notifications.feeReminder.schedule 
        });
      }
    }

  }

  public updateSchedules(): void {
    // 既存のスケジュールを停止
    for (const [name, task] of this.scheduledJobs) {
      task.stop();
      logger.info('スケジュールを停止しました', { name });
    }
    this.scheduledJobs.clear();

    // 新しいスケジュールを設定
    this.initializeScheduledNotifications();
  }

  private getDefaultColor(type: NotificationPayload['type']): number {
    switch (type) {
      case 'fee_reminder':
        return 0xffaa00;
      case 'system':
        return 0x0099ff;
      case 'custom':
        return 0x00ff00;
      default:
        return 0x999999;
    }
  }

  public async sendSystemNotification(title: string, message: string, isError?: boolean): Promise<void>;
  public async sendSystemNotification(title: string, message: string, customEmbed: EmbedBuilder): Promise<void>;
  public async sendSystemNotification(title: string, message: string, isErrorOrEmbed?: boolean | EmbedBuilder): Promise<void> {
    if (isErrorOrEmbed instanceof EmbedBuilder) {
      // カスタムEmbedを使用
      if (!this.client) {
        logger.warn('Discord クライアントが設定されていないため、通知を送信できません');
        return;
      }

      try {
        const config = configManager.getConfig();
        const channelId = config.notifications.systemNotifications.channelId;

        if (!channelId) {
          logger.warn('システム通知チャンネルが設定されていません');
          return;
        }

        const channel = await this.client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) {
          logger.error('通知チャンネルが見つからないか、テキストチャンネルではありません', { channelId });
          return;
        }

        await (channel as TextChannel).send({ embeds: [isErrorOrEmbed] });
        logger.info('カスタムEmbed通知を送信しました', { title });

      } catch (error) {
        logger.error('カスタムEmbed通知の送信に失敗しました', {
          error: (error as Error).message,
          title
        });
      }
    } else {
      // 従来の方式
      const isError = isErrorOrEmbed === true;
      await this.sendNotification({
        type: 'system',
        title: `${isError ? '🚨' : 'ℹ️'} ${title}`,
        message,
        embedColor: isError ? 0xff0000 : 0x0099ff,
      });
    }
  }

  public destroy(): void {
    for (const [name, task] of this.scheduledJobs) {
      task.stop();
      logger.info('スケジュールを破棄しました', { name });
    }
    this.scheduledJobs.clear();
  }
}

export const notificationService = NotificationService.getInstance();