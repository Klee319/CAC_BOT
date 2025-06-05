import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { validateAdvancedPermissions, getSecurityService } from '../../utils/permissions';
import { DatabaseService } from '../../services/database';
import { logger } from '../../utils/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('security')
    .setDescription('セキュリティ関連の管理コマンド（管理者専用）')
    .addSubcommand(subcommand =>
      subcommand
        .setName('stats')
        .setDescription('セキュリティ統計情報を表示します')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('events')
        .setDescription('最近のセキュリティイベントを表示します')
        .addStringOption(option =>
          option
            .setName('severity')
            .setDescription('重要度でフィルタ')
            .addChoices(
              { name: '低', value: 'low' },
              { name: '中', value: 'medium' },
              { name: '高', value: 'high' },
              { name: '重大', value: 'critical' }
            )
            .setRequired(false)
        )
        .addStringOption(option =>
          option
            .setName('type')
            .setDescription('イベントタイプでフィルタ')
            .addChoices(
              { name: 'コマンド実行', value: 'command_execution' },
              { name: '権限拒否', value: 'permission_denied' },
              { name: 'レート制限', value: 'rate_limit_exceeded' },
              { name: '不審なアクティビティ', value: 'suspicious_activity' }
            )
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option
            .setName('limit')
            .setDescription('表示件数（デフォルト: 20）')
            .setMinValue(1)
            .setMaxValue(50)
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('cleanup')
        .setDescription('古いセキュリティイベントをクリーンアップします')
        .addIntegerOption(option =>
          option
            .setName('days')
            .setDescription('何日前のデータを削除するか（デフォルト: 30日）')
            .setMinValue(7)
            .setMaxValue(365)
            .setRequired(false)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();
    
    // 管理者権限が必要
    if (!await validateAdvancedPermissions(interaction, { level: 'admin' })) {
      return;
    }

    const db = new DatabaseService();
    await db.initialize();
    
    const securityService = getSecurityService();

    try {
      switch (subcommand) {
        case 'stats':
          await handleStats(interaction, securityService, db);
          break;
        case 'events':
          await handleEvents(interaction, db);
          break;
        case 'cleanup':
          await handleCleanup(interaction, db);
          break;
      }
    } catch (error) {
      logger.error(`セキュリティコマンドエラー: ${subcommand}`, { 
        error: (error as Error).message,
        userId: interaction.user.id 
      });
      
      const errorMessage = 'セキュリティコマンドの実行中にエラーが発生しました。';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    } finally {
      await db.close();
    }
  },
};

async function handleStats(
  interaction: ChatInputCommandInteraction,
  securityService: any,
  db: DatabaseService
) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const stats = securityService ? await securityService.getSecurityStats() : {
      activeRateLimits: 0,
      totalRateLimits: 0,
      suspiciousActivityCount: 0,
      recentSecurityEvents: 0
    };

    // 24時間以内のイベント統計
    const recentEvents = await db.getSecurityEvents(100);
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCount = recentEvents.filter(event => 
      new Date(event.timestamp) > last24Hours
    ).length;

    // 重要度別統計
    const severityStats = recentEvents.reduce((acc, event) => {
      acc[event.severity] = (acc[event.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // タイプ別統計
    const typeStats = recentEvents.reduce((acc, event) => {
      acc[event.type] = (acc[event.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const embed = new EmbedBuilder()
      .setColor('#ff9900')
      .setTitle('🔒 セキュリティ統計情報')
      .setDescription('システムのセキュリティ状況')
      .addFields(
        {
          name: '📊 全体統計',
          value: [
            `**24時間以内のイベント**: ${recentCount}件`,
            `**総セキュリティイベント**: ${recentEvents.length}件`,
            `**アクティブなレート制限**: ${stats.activeRateLimits}件`,
            `**不審なアクティビティ**: ${stats.suspiciousActivityCount}件`
          ].join('\n'),
          inline: true,
        },
        {
          name: '🚨 重要度別（全期間）',
          value: Object.entries(severityStats)
            .map(([severity, count]) => {
              const emoji = {
                'low': '🟢',
                'medium': '🟡', 
                'high': '🟠',
                'critical': '🔴'
              }[severity] || '⚪';
              return `${emoji} **${severity}**: ${count}件`;
            })
            .join('\n') || 'データなし',
          inline: true,
        },
        {
          name: '📋 イベントタイプ別（全期間）',
          value: Object.entries(typeStats)
            .map(([type, count]) => {
              const emoji = {
                'command_execution': '⚙️',
                'permission_denied': '❌',
                'rate_limit_exceeded': '⏱️',
                'suspicious_activity': '🚨'
              }[type] || '📝';
              const displayName = {
                'command_execution': 'コマンド実行',
                'permission_denied': '権限拒否',
                'rate_limit_exceeded': 'レート制限',
                'suspicious_activity': '不審なアクティビティ'
              }[type] || type;
              return `${emoji} **${displayName}**: ${count}件`;
            })
            .join('\n') || 'データなし',
          inline: false,
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    logger.error('セキュリティ統計の取得に失敗しました', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    await interaction.editReply({
      content: 'セキュリティ統計の取得中にエラーが発生しました。'
    });
  }
}

async function handleEvents(interaction: ChatInputCommandInteraction, db: DatabaseService) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const severity = interaction.options.getString('severity') || undefined;
    const type = interaction.options.getString('type') || undefined;
    const limit = interaction.options.getInteger('limit') || 20;

    const events = await db.getSecurityEvents(limit, severity, type);

    if (events.length === 0) {
      await interaction.editReply({
        content: '指定された条件に一致するセキュリティイベントはありません。'
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor('#ff6600')
      .setTitle('🛡️ セキュリティイベント一覧')
      .setDescription(`最新の${events.length}件のセキュリティイベント`)
      .setTimestamp();

    if (severity || type) {
      embed.setFooter({ 
        text: `フィルタ: ${severity ? `重要度=${severity}` : ''}${severity && type ? ', ' : ''}${type ? `タイプ=${type}` : ''}`
      });
    }

    // イベントを5件ずつグループ化してフィールドに追加
    for (let i = 0; i < Math.min(events.length, 25); i += 5) {
      const eventGroup = events.slice(i, i + 5);
      const fieldValue = eventGroup.map(event => {
        const timestamp = Math.floor(new Date(event.timestamp).getTime() / 1000);
        const severityEmoji = {
          'low': '🟢',
          'medium': '🟡',
          'high': '🟠', 
          'critical': '🔴'
        }[event.severity] || '⚪';
        
        const typeEmoji = {
          'command_execution': '⚙️',
          'permission_denied': '❌',
          'rate_limit_exceeded': '⏱️',
          'suspicious_activity': '🚨'
        }[event.type] || '📝';

        return `${severityEmoji}${typeEmoji} <@${event.user_id}> - ${event.command_name || 'N/A'} <t:${timestamp}:R>`;
      }).join('\n');

      embed.addFields({
        name: i === 0 ? '最近のイベント' : `\u200b`,
        value: fieldValue,
        inline: false,
      });
    }

    if (events.length > 25) {
      embed.addFields({
        name: '\u200b',
        value: `他に ${events.length - 25} 件のイベントがあります`,
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });

  } catch (error) {
    logger.error('セキュリティイベントの取得に失敗しました', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    await interaction.editReply({
      content: 'セキュリティイベントの取得中にエラーが発生しました。'
    });
  }
}

async function handleCleanup(interaction: ChatInputCommandInteraction, db: DatabaseService) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const days = interaction.options.getInteger('days') || 30;
    
    const deletedCount = await db.cleanupOldSecurityEvents(days);

    const embed = new EmbedBuilder()
      .setColor('#00ff00')
      .setTitle('🧹 セキュリティイベントクリーンアップ完了')
      .setDescription(`${days}日前より古いセキュリティイベントを削除しました。`)
      .addFields({
        name: '削除されたイベント数',
        value: `${deletedCount}件`,
        inline: true,
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    logger.info('セキュリティイベントのクリーンアップが完了しました', {
      deletedCount,
      daysOld: days,
      executedBy: interaction.user.id
    });

  } catch (error) {
    logger.error('セキュリティイベントのクリーンアップに失敗しました', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    await interaction.editReply({
      content: 'セキュリティイベントのクリーンアップ中にエラーが発生しました。'
    });
  }
}