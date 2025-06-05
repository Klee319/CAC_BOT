import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { validatePermissions, logCommandUsage } from '../../utils/permissions';
import { logger } from '../../utils/logger';
import { syncService } from '../../services/sync';

export default {
  data: new SlashCommandBuilder()
    .setName('test')
    .setDescription('テスト用コマンド（管理者専用）')
    .addSubcommand(subcommand =>
      subcommand
        .setName('sync-status')
        .setDescription('同期ステータスを確認')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('env-check')
        .setDescription('環境変数を確認')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('debug-testtest')
        .setDescription('Test Testユーザーのデータを詳細確認')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!await validatePermissions(interaction, 'admin')) return;

    const subcommand = interaction.options.getSubcommand();

    try {
      switch (subcommand) {
        case 'sync-status':
          await handleSyncStatus(interaction);
          break;
        case 'env-check':
          await handleEnvCheck(interaction);
          break;
        case 'debug-testtest':
          await handleDebugTestTest(interaction);
          break;
      }
    } catch (error) {
      logger.error(`テストコマンドエラー: ${subcommand}`, { error: error.message });
      
      const errorMessage = 'テストコマンドの実行中にエラーが発生しました。';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    }
  },
};

async function handleSyncStatus(interaction: ChatInputCommandInteraction) {
  await interaction.reply({
    content: '🔄 同期ステータス確認中...',
    ephemeral: true
  });

  try {
    const status = syncService.getSyncStatus();
    
    const response = [
      `**自動同期**: ${status.autoSyncEnabled ? '有効' : '無効'}`,
      `**実行中**: ${status.isRunning ? 'はい' : 'いいえ'}`,
      `**同期間隔**: ${status.syncInterval}`,
      `**最終同期**: ${status.lastSyncTime ? status.lastSyncTime.toISOString() : '未実行'}`
    ].join('\n');

    await interaction.editReply({ content: response });
    
  } catch (error) {
    await interaction.editReply({ content: `エラー: ${error.message}` });
  }
}

async function handleEnvCheck(interaction: ChatInputCommandInteraction) {
  await interaction.reply({
    content: '⚙️ 環境変数確認中...',
    ephemeral: true
  });

  const envVars = [
    `PROTECT_SPREADSHEET: ${process.env.PROTECT_SPREADSHEET}`,
    `AUTO_SYNC_ENABLED: ${process.env.AUTO_SYNC_ENABLED}`,
    `AUTO_SYNC_INTERVAL: ${process.env.AUTO_SYNC_INTERVAL}`,
    `MEMBER_SPREADSHEET_ID: ${process.env.MEMBER_SPREADSHEET_ID?.slice(0, 10)}...`,
    `MEMBER_SHEET_NAME: ${process.env.MEMBER_SHEET_NAME}`,
  ];

  await interaction.editReply({ 
    content: '```\n' + envVars.join('\n') + '\n```' 
  });
}

async function handleDebugTestTest(interaction: ChatInputCommandInteraction) {
  await interaction.reply({
    content: '🔍 Test Testユーザーのデータを確認中...',
    ephemeral: true
  });

  try {
    const { GoogleSheetsService } = await import('../../services/google');
    const { DatabaseService } = await import('../../services/database');
    
    const sheetsService = new GoogleSheetsService();
    const db = new DatabaseService();
    await db.initialize();

    // スプレッドシートからTest Testユーザーを検索
    const sheetMembers = await sheetsService.getAllMembers();
    const testUserSheet = sheetMembers.find(member => 
      member.name === 'Test Test' || member.discordUsername === 'sabubakudan'
    );

    // データベースからTest Testユーザーを検索
    const dbMembers = await db.getAllMembers();
    const testUserDb = dbMembers.find(member => 
      member.name === 'Test Test' || member.discord_username === 'sabubakudan'
    );

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('🔍 Test Test ユーザーデータ比較')
      .setTimestamp();

    if (testUserSheet) {
      embed.addFields({
        name: '📊 スプレッドシートデータ',
        value: [
          `名前: ${testUserSheet.name}`,
          `Discord: ${testUserSheet.discordUsername}`,
          `学籍番号: ${testUserSheet.studentId}`,
          `性別: ${testUserSheet.gender}`,
          `班: ${testUserSheet.team}`,
          `部費: ${testUserSheet.membershipFeeRecord}`,
          `学年: ${testUserSheet.grade}`
        ].join('\n'),
        inline: true
      });
    } else {
      embed.addFields({
        name: '📊 スプレッドシートデータ',
        value: '❌ Test Testユーザーが見つかりません',
        inline: true
      });
    }

    if (testUserDb) {
      embed.addFields({
        name: '🗄️ データベースデータ',
        value: [
          `名前: ${testUserDb.name}`,
          `Discord: ${testUserDb.discord_username}`,
          `学籍番号: ${testUserDb.student_id}`,
          `性別: ${testUserDb.gender}`,
          `班: ${testUserDb.team}`,
          `部費: ${testUserDb.membership_fee_record}`,
          `学年: ${testUserDb.grade}`
        ].join('\n'),
        inline: true
      });
    } else {
      embed.addFields({
        name: '🗄️ データベースデータ',
        value: '❌ Test Testユーザーが見つかりません',
        inline: true
      });
    }

    // 差分があるかチェック
    if (testUserSheet && testUserDb) {
      const differences = [];
      if (testUserSheet.membershipFeeRecord !== testUserDb.membership_fee_record) {
        differences.push(`部費: シート="${testUserSheet.membershipFeeRecord}" vs DB="${testUserDb.membership_fee_record}"`);
      }
      if (testUserSheet.name !== testUserDb.name) {
        differences.push(`名前: シート="${testUserSheet.name}" vs DB="${testUserDb.name}"`);
      }
      if (testUserSheet.team !== testUserDb.team) {
        differences.push(`班: シート="${testUserSheet.team}" vs DB="${testUserDb.team}"`);
      }

      if (differences.length > 0) {
        embed.addFields({
          name: '⚠️ データの差分',
          value: differences.join('\n'),
          inline: false
        });
      } else {
        embed.addFields({
          name: '✅ データの一致',
          value: 'スプレッドシートとデータベースのデータは一致しています',
          inline: false
        });
      }
    }

    await interaction.editReply({ embeds: [embed] });
    await db.close();
    
  } catch (error) {
    await interaction.editReply({ content: `エラー: ${error.message}` });
  }
}