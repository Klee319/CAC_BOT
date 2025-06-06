import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { validatePermissions, getUserRoles } from '../../utils/permissions';
import { configManager } from '../../config';

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('利用可能なコマンドの一覧を表示します'),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!await validatePermissions(interaction, 'all')) return;

    const userRoles = getUserRoles(interaction);
    const isAdmin = configManager.isAdmin(userRoles);
    const isMember = configManager.isMember(userRoles);

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('CAC BOT ヘルプ')
      .setDescription('利用可能なコマンド一覧')
      .setTimestamp();

    embed.addFields({
      name: '📋 基本コマンド',
      value: '`/help` - このヘルプを表示\n`/status` - BOTの稼働状況を確認',
      inline: false,
    });

    if (isMember || isAdmin) {
      embed.addFields({
        name: '💰 部費関連（部員用）',
        value: '`/fee check` - 自分の部費納入状況を確認',
        inline: false,
      });
    }

    if (isAdmin) {
      embed.addFields({
        name: '👥 部員管理（管理者専用）',
        value: [
          '`/member register` - 新規部員の手動登録',
          '`/member update` - 部員情報の更新',
          '`/member delete` - 部員の削除',
          '`/member list` - 全部員一覧の表示',
          '`/member search` - 部員情報の検索',
          '`/member grade-up` - 全部員の学年一括繰り上げ'
        ].join('\n'),
        inline: false,
      });

      embed.addFields({
        name: '💰 部費管理（管理者専用）',
        value: [
          '`/fee update` - 部費納入記録の更新',
          '`/fee unpaid` - 部費未納入者一覧の表示'
        ].join('\n'),
        inline: false,
      });


      embed.addFields({
        name: '⚙️ システム管理（管理者専用）',
        value: [
          '`/sheet setup` - スプレッドシート連携設定',
          '`/sync sheets` - 手動でシート同期実行',
          '`/setup admin` - 管理者ロール設定',
          '`/setup member` - 部員ロール設定',
          '`/setup channel` - コマンド実行可能チャンネル設定',
          '`/setup notification` - 通知チャンネル設定'
        ].join('\n'),
        inline: false,
      });
    }

    embed.addFields({
      name: 'ℹ️ サポート情報',
      value: [
        '• コマンドの詳細は各コマンドのヘルプを参照してください',
        '• 問題が発生した場合は管理者にお問い合わせください',
        '• BOTの設定は管理者が `/setup` コマンドで行います'
      ].join('\n'),
      inline: false,
    });

    await interaction.reply({ embeds: [embed] });
  },
};