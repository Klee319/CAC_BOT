import { Events, GuildMember, EmbedBuilder } from 'discord.js';
import { logger } from '../../utils/logger';
import { configManager } from '../../config';

export default {
  name: Events.GuildMemberAdd,
  async execute(member: GuildMember) {
    try {
      const config = configManager.getConfig();
      
      if (!config.registration.formUrl) {
        logger.warn('登録フォームURLが設定されていないため、自動登録案内をスキップします');
        return;
      }

      const welcomeEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('部活動へようこそ！')
        .setDescription(config.registration.welcomeMessage)
        .addFields(
          {
            name: '登録フォーム',
            value: `[こちらから登録してください](${config.registration.formUrl})`,
            inline: false,
          },
          {
            name: '注意事項',
            value: '• 本名、学籍番号、性別は正確に入力してください\n• 登録完了後、管理者に通知されます\n• 不明な点があれば管理者にお問い合わせください',
            inline: false,
          }
        )
        .setFooter({
          text: '部活動管理BOT',
        })
        .setTimestamp();

      await member.send({ embeds: [welcomeEmbed] });
      
      logger.info('新規メンバーに登録案内を送信しました', {
        userId: member.id,
        userName: member.user.username,
        displayName: member.displayName,
      });

      if (config.notifications.systemNotifications.channelId) {
        try {
          const notificationChannel = await member.guild.channels.fetch(
            config.notifications.systemNotifications.channelId
          );
          
          if (notificationChannel?.isTextBased()) {
            const notificationEmbed = new EmbedBuilder()
              .setColor('#00ff00')
              .setTitle('新しいメンバーが参加しました')
              .addFields(
                {
                  name: 'ユーザー',
                  value: `${member.user.tag} (${member.id})`,
                  inline: true,
                },
                {
                  name: '表示名',
                  value: member.displayName,
                  inline: true,
                },
                {
                  name: '参加日時',
                  value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
                  inline: false,
                }
              )
              .setThumbnail(member.user.displayAvatarURL())
              .setTimestamp();

            await notificationChannel.send({ embeds: [notificationEmbed] });
          }
        } catch (error) {
          logger.error('システム通知の送信に失敗しました', { error: error.message });
        }
      }

    } catch (error) {
      logger.error('新規メンバー処理でエラーが発生しました', {
        error: error.message,
        userId: member.id,
        userName: member.user.username,
      });

      if (error.code === 50007) {
        logger.warn('ユーザーのDMが無効になっているため、登録案内を送信できませんでした', {
          userId: member.id,
          userName: member.user.username,
        });
      }
    }
  },
};