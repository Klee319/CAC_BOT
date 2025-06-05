import { DatabaseService } from '../database';
import { GoogleFormsService } from '../google/forms';
import { notificationService } from '../notification';
import { logger } from '../../utils/logger';
import { configManager } from '../../config';
import { Vote, VoteResponse } from '../../types';
import { 
  Client, 
  EmbedBuilder, 
  ActionRowBuilder, 
  StringSelectMenuBuilder, 
  ButtonBuilder, 
  ButtonStyle,
  ComponentType,
  SelectMenuInteraction,
  ButtonInteraction
} from 'discord.js';
import cron from 'node-cron';

export interface VoteStats {
  totalVotes: number;
  activeVotes: number;
  completedVotes: number;
  totalResponses: number;
  averageResponseRate: number;
  recentVotes: Vote[];
}

export interface VoteOption {
  id: string;
  text: string;
  type: 'text' | 'choice' | 'multiple_choice' | 'scale' | 'date';
  required: boolean;
  choices?: string[];
  min?: number;
  max?: number;
}

export interface DiscordVoteData {
  id: string;
  title: string;
  description: string;
  options: VoteOption[];
  deadline: Date;
  allowEdit: boolean;
  anonymous: boolean;
  multipleChoice: boolean;
}

export class VoteService {
  private database: DatabaseService;
  private formsService: GoogleFormsService;
  private client: Client | null = null;
  private reminderJob: cron.ScheduledTask | null = null;

  constructor(database: DatabaseService) {
    this.database = database;
    this.formsService = new GoogleFormsService();
  }

  public setClient(client: Client): void {
    this.client = client;
  }

  /**
   * 投票期限リマインダーを開始
   */
  public startVoteReminder(): void {
    const config = configManager.getConfig();
    
    if (!config.notifications.voteReminder.enabled) {
      logger.info('投票リマインダーが無効になっています');
      return;
    }

    if (this.reminderJob) {
      this.reminderJob.stop();
    }

    // 毎時0分に実行
    this.reminderJob = cron.schedule('0 * * * *', async () => {
      try {
        await this.checkVoteDeadlines();
      } catch (error) {
        logger.error('投票期限チェックに失敗しました', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, {
      scheduled: true,
      timezone: 'Asia/Tokyo'
    });

    logger.info('投票リマインダーを開始しました');
  }

  /**
   * 投票リマインダーを停止
   */
  public stopVoteReminder(): void {
    if (this.reminderJob) {
      this.reminderJob.stop();
      this.reminderJob = null;
      logger.info('投票リマインダーを停止しました');
    }
  }

  /**
   * Google FormsをDiscordインターフェースに変換
   */
  public async convertFormsToDiscord(formUrl: string): Promise<DiscordVoteData | null> {
    try {
      const formId = this.formsService.extractFormIdFromUrl(formUrl);
      if (!formId) {
        logger.warn('無効なGoogle FormsのURLです', { formUrl });
        return null;
      }

      const formInfo = await this.formsService.getFormInfo(formId);
      if (!formInfo) {
        logger.warn('Google Formsの情報を取得できませんでした', { formId });
        return null;
      }

      // Discord用の投票データに変換
      const voteOptions: VoteOption[] = [];
      
      for (const question of formInfo.questions.slice(0, 10)) { // Discord制限で最大10個
        const option: VoteOption = {
          id: question.id,
          text: question.title,
          required: question.required,
          type: 'text'
        };

        switch (question.type) {
          case 'TEXT':
          case 'PARAGRAPH':
            option.type = 'text';
            break;
          case 'RADIO':
            option.type = 'choice';
            option.choices = question.options;
            break;
          case 'CHECKBOX':
            option.type = 'multiple_choice';
            option.choices = question.options;
            break;
          case 'DROPDOWN':
            option.type = 'choice';
            option.choices = question.options;
            break;
        }

        voteOptions.push(option);
      }

      return {
        id: this.generateVoteId(),
        title: formInfo.title,
        description: formInfo.description,
        options: voteOptions,
        deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // デフォルト7日後
        allowEdit: true,
        anonymous: false,
        multipleChoice: false
      };

    } catch (error) {
      logger.error('Google Formsの変換に失敗しました', {
        formUrl,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Discord投票UIを生成
   */
  public generateDiscordVoteUI(voteData: DiscordVoteData): {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<any>[];
  } {
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`🗳️ ${voteData.title}`)
      .setDescription(voteData.description || '投票にご参加ください')
      .addFields(
        {
          name: '回答期限',
          value: `<t:${Math.floor(voteData.deadline.getTime() / 1000)}:F>`,
          inline: true,
        },
        {
          name: '設定',
          value: [
            `匿名: ${voteData.anonymous ? 'はい' : 'いいえ'}`,
            `編集可能: ${voteData.allowEdit ? 'はい' : 'いいえ'}`
          ].join('\n'),
          inline: true,
        }
      )
      .setFooter({ text: `投票ID: ${voteData.id}` })
      .setTimestamp();

    const components: ActionRowBuilder<any>[] = [];

    // 選択肢が5個以下の場合はボタン、それ以上はセレクトメニュー
    for (let i = 0; i < voteData.options.length; i += 5) {
      const optionBatch = voteData.options.slice(i, i + 5);
      
      if (optionBatch.every(opt => opt.type === 'choice' && opt.choices && opt.choices.length <= 5)) {
        // ボタンで表示
        const buttonRow = new ActionRowBuilder<ButtonBuilder>();
        
        for (const option of optionBatch) {
          if (option.choices) {
            for (const [choiceIndex, choice] of option.choices.entries()) {
              if (buttonRow.components.length >= 5) break;
              
              buttonRow.addComponents(
                new ButtonBuilder()
                  .setCustomId(`vote_${voteData.id}_${option.id}_${choiceIndex}`)
                  .setLabel(choice.substring(0, 80))
                  .setStyle(ButtonStyle.Primary)
              );
            }
          }
        }
        
        if (buttonRow.components.length > 0) {
          components.push(buttonRow);
        }
      } else {
        // セレクトメニューで表示
        for (const option of optionBatch) {
          if (option.type === 'choice' || option.type === 'multiple_choice') {
            if (option.choices && option.choices.length > 0) {
              const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`vote_select_${voteData.id}_${option.id}`)
                .setPlaceholder(option.text.substring(0, 150))
                .setMinValues(option.required ? 1 : 0)
                .setMaxValues(option.type === 'multiple_choice' ? Math.min(option.choices.length, 25) : 1);

              for (const [choiceIndex, choice] of option.choices.entries()) {
                if (selectMenu.options.length >= 25) break;
                
                selectMenu.addOptions({
                  label: choice.substring(0, 100),
                  value: `${option.id}_${choiceIndex}`,
                  description: option.required ? '必須項目' : '任意項目'
                });
              }

              const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>()
                .addComponents(selectMenu);
              
              components.push(selectRow);
            }
          }
        }
      }
    }

    // 投票送信ボタン
    if (components.length < 5) {
      const submitRow = new ActionRowBuilder<ButtonBuilder>()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`vote_submit_${voteData.id}`)
            .setLabel('投票を送信')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅'),
          new ButtonBuilder()
            .setCustomId(`vote_cancel_${voteData.id}`)
            .setLabel('キャンセル')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('❌')
        );
      
      components.push(submitRow);
    }

    return { embeds: [embed], components };
  }

  /**
   * 投票統計を取得
   */
  public async getVoteStats(): Promise<VoteStats> {
    try {
      const allVotes = await this.database.getActiveVotes();
      const completedVotes = []; // TODO: 完了した投票を取得する機能を実装
      
      let totalResponses = 0;
      for (const vote of allVotes) {
        const responses = await this.database.getVoteResponses(vote.id);
        totalResponses += responses.length;
      }

      const averageResponseRate = allVotes.length > 0 ? totalResponses / allVotes.length : 0;

      return {
        totalVotes: allVotes.length + completedVotes.length,
        activeVotes: allVotes.length,
        completedVotes: completedVotes.length,
        totalResponses,
        averageResponseRate,
        recentVotes: allVotes.slice(0, 5)
      };

    } catch (error) {
      logger.error('投票統計の取得に失敗しました', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * 投票期限をチェックしてリマインダーを送信
   */
  public async checkVoteDeadlines(): Promise<void> {
    try {
      const config = configManager.getConfig();
      const reminderHours = config.notifications.voteReminder.hoursBeforeDeadline || 24;
      
      const activeVotes = await this.database.getActiveVotes();
      const now = new Date();
      const reminderTime = new Date(now.getTime() + (reminderHours * 60 * 60 * 1000));

      for (const vote of activeVotes) {
        const deadline = new Date(vote.deadline);
        
        // 期限がリマインダー時間内にある投票を対象
        if (deadline > now && deadline <= reminderTime) {
          await this.sendVoteReminder(vote);
        }
        
        // 期限が過ぎた投票を自動終了
        if (deadline <= now && vote.is_active) {
          await this.database.updateVote(vote.id, { is_active: false });
          await this.sendVoteExpiredNotification(vote);
        }
      }

    } catch (error) {
      logger.error('投票期限チェックに失敗しました', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 投票リマインダーを送信
   */
  private async sendVoteReminder(vote: any): Promise<void> {
    try {
      const responses = await this.database.getVoteResponses(vote.id);
      const allMembers = await this.database.getAllMembers();
      const respondedUserIds = new Set(responses.map(r => r.user_id));
      
      // 未回答者を特定
      const unrespondedMembers = allMembers.filter(member => 
        !respondedUserIds.has(member.discord_id)
      );

      if (unrespondedMembers.length === 0) {
        logger.info('全員が回答済みのため、リマインダーをスキップしました', { voteId: vote.id });
        return;
      }

      const deadline = new Date(vote.deadline);
      const embed = new EmbedBuilder()
        .setColor('#ffaa00')
        .setTitle('⏰ 投票期限リマインダー')
        .setDescription(`「${vote.title}」の回答期限が近づいています。`)
        .addFields(
          {
            name: '回答期限',
            value: `<t:${Math.floor(deadline.getTime() / 1000)}:F>`,
            inline: true,
          },
          {
            name: '回答方法',
            value: `\`/vote response ${vote.id}\``,
            inline: true,
          }
        )
        .setTimestamp();

      await notificationService.sendSystemNotification(
        '投票期限リマインダー',
        '',
        embed
      );

      logger.info('投票リマインダーを送信しました', {
        voteId: vote.id,
        title: vote.title,
        unrespondedCount: unrespondedMembers.length
      });

    } catch (error) {
      logger.error('投票リマインダーの送信に失敗しました', {
        voteId: vote.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 投票期限切れ通知を送信
   */
  private async sendVoteExpiredNotification(vote: any): Promise<void> {
    try {
      const responses = await this.database.getVoteResponses(vote.id);
      
      const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('🔒 投票期限終了')
        .setDescription(`「${vote.title}」の投票が期限により自動終了しました。`)
        .addFields(
          {
            name: '最終回答数',
            value: `${responses.length}名`,
            inline: true,
          },
          {
            name: '結果確認',
            value: `\`/vote results ${vote.id}\``,
            inline: true,
          }
        )
        .setTimestamp();

      await notificationService.sendSystemNotification(
        '投票期限終了',
        '',
        embed
      );

      logger.info('投票期限終了通知を送信しました', {
        voteId: vote.id,
        title: vote.title,
        responseCount: responses.length
      });

    } catch (error) {
      logger.error('投票期限終了通知の送信に失敗しました', {
        voteId: vote.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * 投票IDを生成
   */
  private generateVoteId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * 投票の詳細分析を取得
   */
  public async getVoteAnalysis(voteId: string): Promise<any> {
    try {
      const vote = await this.database.getVote(voteId);
      if (!vote) {
        throw new Error('投票が見つかりません');
      }

      const responses = await this.database.getVoteResponses(voteId);
      const allMembers = await this.database.getAllMembers();
      
      // 回答率の計算
      const responseRate = allMembers.length > 0 ? 
        (responses.length / allMembers.length * 100) : 0;

      // 学年別・班別の回答率
      const membersByGrade: Record<string, any[]> = {};
      const membersByTeam: Record<string, any[]> = {};
      
      for (const member of allMembers) {
        const grade = member.grade || '不明';
        const team = member.team || '不明';
        
        if (!membersByGrade[grade]) membersByGrade[grade] = [];
        if (!membersByTeam[team]) membersByTeam[team] = [];
        
        membersByGrade[grade].push(member);
        membersByTeam[team].push(member);
      }

      const gradeAnalysis: Record<string, { total: number; responded: number; rate: number }> = {};
      const teamAnalysis: Record<string, { total: number; responded: number; rate: number }> = {};

      const respondedUserIds = new Set(responses.map(r => r.user_id));

      for (const [grade, members] of Object.entries(membersByGrade)) {
        const respondedCount = members.filter(m => respondedUserIds.has(m.discord_id)).length;
        gradeAnalysis[grade] = {
          total: members.length,
          responded: respondedCount,
          rate: members.length > 0 ? (respondedCount / members.length * 100) : 0
        };
      }

      for (const [team, members] of Object.entries(membersByTeam)) {
        const respondedCount = members.filter(m => respondedUserIds.has(m.discord_id)).length;
        teamAnalysis[team] = {
          total: members.length,
          responded: respondedCount,
          rate: members.length > 0 ? (respondedCount / members.length * 100) : 0
        };
      }

      return {
        vote,
        totalMembers: allMembers.length,
        responseCount: responses.length,
        responseRate: responseRate.toFixed(1),
        gradeAnalysis,
        teamAnalysis,
        responses: vote.anonymous ? [] : responses
      };

    } catch (error) {
      logger.error('投票分析の取得に失敗しました', {
        voteId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }
}