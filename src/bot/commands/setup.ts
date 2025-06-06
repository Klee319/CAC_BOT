import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, Role, TextChannel } from 'discord.js';
import { validateAdvancedPermissions, logCommandUsage } from '../../utils/permissions';
import { configManager } from '../../config';
import { logger } from '../../utils/logger';

export default {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('BOTの設定を行います（管理者専用）')
    .addSubcommand(subcommand =>
      subcommand
        .setName('admin')
        .setDescription('管理者ロールを設定します')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('管理者ロール')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('member')
        .setDescription('部員ロールを設定します')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('部員ロール')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('channel')
        .setDescription('コマンド実行可能チャンネルを設定します')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('コマンド実行可能チャンネル')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('notification')
        .setDescription('通知チャンネルを設定します')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('通知チャンネル')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('show')
        .setDescription('現在の設定を表示します')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();
    
    // setup コマンドは最高権限が必要で、レート制限も厳しく
    if (!await validateAdvancedPermissions(interaction, { 
      level: 'admin',
      // 特定のチャンネルのみで使用可能にする場合
      allowedChannels: undefined // 設定により制限
    }, true)) return;

    try {
      switch (subcommand) {
        case 'admin':
          await handleAdminRole(interaction);
          break;
        case 'member':
          await handleMemberRole(interaction);
          break;
        case 'channel':
          await handleChannel(interaction);
          break;
        case 'notification':
          await handleNotification(interaction);
          break;
        case 'show':
          await handleShow(interaction);
          break;
      }
    } catch (error) {
      logger.error(`設定コマンドエラー: ${subcommand}`, { error: error.message });
      
      const errorMessage = 'コマンドの実行中にエラーが発生しました。';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    }
  },
};

async function handleAdminRole(interaction: ChatInputCommandInteraction) {
  const role = interaction.options.getRole('role', true) as Role;

  const config = configManager.getConfig();
  const currentAdminRoles = [...config.permissions.adminRoleIds];
  
  if (!currentAdminRoles.includes(role.id)) {
    currentAdminRoles.push(role.id);
  }

  configManager.updatePermissions({
    ...config.permissions,
    adminRoleIds: currentAdminRoles,
  });

  const embed = new EmbedBuilder()
    .setColor('#00ff00')
    .setTitle('⚙️ 管理者ロール設定完了')
    .setDescription(`${role.name} を管理者ロールに設定しました。`)
    .addFields({
      name: '現在の管理者ロール',
      value: currentAdminRoles.map(id => `<@&${id}>`).join('\n') || 'なし',
      inline: false,
    })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
  logCommandUsage(interaction, '管理者ロール設定', role.name);
}

async function handleMemberRole(interaction: ChatInputCommandInteraction) {
  const role = interaction.options.getRole('role', true) as Role;

  const config = configManager.getConfig();
  const currentMemberRoles = [...config.permissions.memberRoleIds];
  
  if (!currentMemberRoles.includes(role.id)) {
    currentMemberRoles.push(role.id);
  }

  configManager.updatePermissions({
    ...config.permissions,
    memberRoleIds: currentMemberRoles,
  });

  const embed = new EmbedBuilder()
    .setColor('#00ff00')
    .setTitle('⚙️ 部員ロール設定完了')
    .setDescription(`${role.name} を部員ロールに設定しました。`)
    .addFields({
      name: '現在の部員ロール',
      value: currentMemberRoles.map(id => `<@&${id}>`).join('\n') || 'なし',
      inline: false,
    })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
  logCommandUsage(interaction, '部員ロール設定', role.name);
}

async function handleChannel(interaction: ChatInputCommandInteraction) {
  const channel = interaction.options.getChannel('channel', true) as TextChannel;

  if (!channel.isTextBased()) {
    await interaction.reply({
      content: 'テキストチャンネルを指定してください。',
      ephemeral: true,
    });
    return;
  }

  const config = configManager.getConfig();
  const currentChannels = [...config.permissions.allowedChannelIds];
  
  if (!currentChannels.includes(channel.id)) {
    currentChannels.push(channel.id);
  }

  configManager.updatePermissions({
    ...config.permissions,
    allowedChannelIds: currentChannels,
  });

  const embed = new EmbedBuilder()
    .setColor('#00ff00')
    .setTitle('⚙️ 実行可能チャンネル設定完了')
    .setDescription(`${channel.name} をコマンド実行可能チャンネルに設定しました。`)
    .addFields({
      name: '現在の実行可能チャンネル',
      value: currentChannels.map(id => `<#${id}>`).join('\n') || 'すべてのチャンネル',
      inline: false,
    })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
  logCommandUsage(interaction, 'コマンドチャンネル設定', channel.name);
}

async function handleNotification(interaction: ChatInputCommandInteraction) {
  const channel = interaction.options.getChannel('channel', true) as TextChannel;

  if (!channel.isTextBased()) {
    await interaction.reply({
      content: 'テキストチャンネルを指定してください。',
      ephemeral: true,
    });
    return;
  }

  configManager.updateNotifications({
    ...configManager.getConfig().notifications,
    systemNotifications: {
      channelId: channel.id,
    },
  });

  const embed = new EmbedBuilder()
    .setColor('#00ff00')
    .setTitle('⚙️ 通知チャンネル設定完了')
    .setDescription(`${channel.name} を通知チャンネルに設定しました。`)
    .addFields({
      name: '通知内容',
      value: [
        '• システムエラー通知',
        '• 重要な操作のログ',
        '• 新規メンバー参加通知',
        '• その他の重要な通知'
      ].join('\n'),
      inline: false,
    })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
  logCommandUsage(interaction, '通知チャンネル設定', channel.name);
}

async function handleShow(interaction: ChatInputCommandInteraction) {
  const config = configManager.getConfig();

  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('⚙️ 現在の設定')
    .setDescription('BOTの現在の設定状況')
    .setTimestamp();

  embed.addFields({
    name: '👨‍💼 管理者ロール',
    value: config.permissions.adminRoleIds.length > 0 
      ? config.permissions.adminRoleIds.map(id => `<@&${id}>`).join('\n')
      : '未設定',
    inline: true,
  });

  embed.addFields({
    name: '👥 部員ロール',
    value: config.permissions.memberRoleIds.length > 0 
      ? config.permissions.memberRoleIds.map(id => `<@&${id}>`).join('\n')
      : '未設定',
    inline: true,
  });

  embed.addFields({
    name: '📝 実行可能チャンネル',
    value: config.permissions.allowedChannelIds.length > 0 
      ? config.permissions.allowedChannelIds.map(id => `<#${id}>`).join('\n')
      : 'すべてのチャンネル',
    inline: true,
  });

  embed.addFields({
    name: '🔔 通知チャンネル',
    value: config.notifications.systemNotifications.channelId 
      ? `<#${config.notifications.systemNotifications.channelId}>`
      : '未設定',
    inline: true,
  });

  embed.addFields({
    name: '📊 Google Sheets',
    value: config.sheets.spreadsheetId ? '✅ 設定済み' : '❌ 未設定',
    inline: true,
  });


  embed.addFields({
    name: '🔔 通知設定',
    value: [
      `部費リマインド: ${config.notifications.feeReminder.enabled ? '✅' : '❌'}`,
    ].join('\n'),
    inline: false,
  });

  await interaction.reply({ embeds: [embed], ephemeral: true });
  logCommandUsage(interaction, '設定確認');
}