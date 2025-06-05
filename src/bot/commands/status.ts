import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { validatePermissions } from '../../utils/permissions';
import { configManager } from '../../config';
import os from 'os';

export default {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('BOTの稼働状況を確認します'),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!await validatePermissions(interaction, 'all')) return;

    const client = interaction.client;
    const uptime = process.uptime();
    const uptimeString = formatUptime(uptime);
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    const embed = new EmbedBuilder()
      .setColor('#00ff00')
      .setTitle('🤖 CAC BOT ステータス')
      .setDescription('現在のBOT稼働状況')
      .addFields(
        {
          name: '⏱️ 稼働時間',
          value: uptimeString,
          inline: true,
        },
        {
          name: '🌐 接続状況',
          value: client.ws.ping > 0 ? `✅ オンライン (${client.ws.ping}ms)` : '❌ オフライン',
          inline: true,
        },
        {
          name: '🏠 サーバー数',
          value: client.guilds.cache.size.toString(),
          inline: true,
        },
        {
          name: '👥 ユーザー数',
          value: client.users.cache.size.toString(),
          inline: true,
        },
        {
          name: '💾 メモリ使用量',
          value: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
          inline: true,
        },
        {
          name: '🖥️ システム情報',
          value: `${os.platform()} ${os.arch()}`,
          inline: true,
        }
      )
      .setFooter({
        text: `Node.js ${process.version}`,
      })
      .setTimestamp();

    try {
      const config = configManager.getConfig();
      
      const statusFields = [];
      
      if (config.sheets.spreadsheetId) {
        statusFields.push('✅ Google Sheets連携');
      } else {
        statusFields.push('❌ Google Sheets未設定');
      }
      
      if (config.permissions.adminRoleIds.length > 0) {
        statusFields.push('✅ 管理者ロール設定済み');
      } else {
        statusFields.push('❌ 管理者ロール未設定');
      }
      
      if (config.permissions.memberRoleIds.length > 0) {
        statusFields.push('✅ 部員ロール設定済み');
      } else {
        statusFields.push('❌ 部員ロール未設定');
      }

      if (config.notifications.systemNotifications.channelId) {
        statusFields.push('✅ 通知チャンネル設定済み');
      } else {
        statusFields.push('❌ 通知チャンネル未設定');
      }

      embed.addFields({
        name: '⚙️ 設定状況',
        value: statusFields.join('\n'),
        inline: false,
      });

    } catch (error) {
      embed.addFields({
        name: '⚠️ 設定エラー',
        value: '設定の読み込みに失敗しました',
        inline: false,
      });
    }

    await interaction.reply({ embeds: [embed] });
  },
};

function formatUptime(uptime: number): string {
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}日`);
  if (hours > 0) parts.push(`${hours}時間`);
  if (minutes > 0) parts.push(`${minutes}分`);
  if (seconds > 0) parts.push(`${seconds}秒`);

  return parts.length > 0 ? parts.join(' ') : '1秒未満';
}