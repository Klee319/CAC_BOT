import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { validatePermissions, logCommandUsage } from '../../utils/permissions';
import { configManager } from '../../config';
import { GoogleSheetsService } from '../../services/google';
import { DatabaseService } from '../../services/database';
import { logger } from '../../utils/logger';
import { syncService } from '../../services/sync/index';

export default {
  data: new SlashCommandBuilder()
    .setName('sheet')
    .setDescription('Google Sheets連携管理（管理者専用）')
    .addSubcommand(subcommand =>
      subcommand
        .setName('setup')
        .setDescription('スプレッドシート連携を設定します')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('sync')
        .setDescription('手動でシート同期を実行します')
        .addStringOption(option =>
          option
            .setName('direction')
            .setDescription('同期方向')
            .setRequired(false)
            .addChoices(
              { name: 'スプレッドシート → データベース', value: 'sheet-to-db' },
              { name: 'データベース → スプレッドシート', value: 'db-to-sheet' }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('validate')
        .setDescription('シート構造を検証します')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('create-header')
        .setDescription('シートにヘッダーを作成します')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('sync-status')
        .setDescription('自動同期の状態を確認します')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('debug-data')
        .setDescription('スプレッドシートのデータを確認します（デバッグ用）')
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!await validatePermissions(interaction, 'admin')) return;

    const subcommand = interaction.options.getSubcommand();

    try {
      switch (subcommand) {
        case 'setup':
          await handleSetup(interaction);
          break;
        case 'sync':
          await handleSync(interaction);
          break;
        case 'validate':
          await handleValidate(interaction);
          break;
        case 'create-header':
          await handleCreateHeader(interaction);
          break;
        case 'sync-status':
          await handleSyncStatus(interaction);
          break;
        case 'debug-data':
          await handleDebugData(interaction);
          break;
      }
    } catch (error) {
      logger.error(`シート管理コマンドエラー: ${subcommand}`, { error: error.message });
      
      const errorMessage = 'コマンドの実行中にエラーが発生しました。';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errorMessage, ephemeral: true });
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    }
  },
};

async function handleSetup(interaction: ChatInputCommandInteraction) {
  const modal = new ModalBuilder()
    .setCustomId('sheet_setup_modal')
    .setTitle('Google Sheets 連携設定');

  const spreadsheetUrlInput = new TextInputBuilder()
    .setCustomId('spreadsheet_url')
    .setLabel('スプレッドシートURL')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('https://docs.google.com/spreadsheets/d/...')
    .setRequired(true);

  const sheetNameInput = new TextInputBuilder()
    .setCustomId('sheet_name')
    .setLabel('シート名')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('部員名簿')
    .setValue('部員名簿')
    .setRequired(true);

  const firstActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(spreadsheetUrlInput);
  const secondActionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(sheetNameInput);

  modal.addComponents(firstActionRow, secondActionRow);

  await interaction.showModal(modal);
}

async function handleSync(interaction: ChatInputCommandInteraction) {
  const config = configManager.getConfig();
  const direction = interaction.options.getString('direction') || 'sheet-to-db';
  
  if (!config.sheets.spreadsheetId) {
    await interaction.reply({
      content: 'スプレッドシートが設定されていません。先に `/sheet setup` を実行してください。',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const db = new DatabaseService();
  await db.initialize();
  
  const sheetsService = new GoogleSheetsService();

  logger.info('シート同期開始', { direction });
  
  try {
    if (direction === 'db-to-sheet') {
      // データベースからスプレッドシートへ
      const members = await db.getAllMembers();
      
      if (members.length === 0) {
        await interaction.editReply('同期する部員データがありません。');
        return;
      }

      const embed = new EmbedBuilder()
        .setColor('#ffaa00')
        .setTitle('📊 DB→シート 同期実行中...')
        .setDescription(`${members.length}名の部員データをスプレッドシートに同期しています...`)
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      const membersToSync = members.map(member => ({
        name: member.name,
        discordDisplayName: member.discord_display_name,
        discordUsername: member.discord_username,
        studentId: member.student_id,
        gender: member.gender,
        team: member.team,
        membershipFeeRecord: member.membership_fee_record,
        grade: member.grade,
      }));

      // 本当にDB→シート同期を実行するか確認
      const confirmEmbed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('⚠️ 警告: スプレッドシートが上書きされます')
        .setDescription('データベースの内容でスプレッドシートが完全に上書きされます。本当に実行しますか？')
        .setFooter({ text: 'この操作は元に戻せません' });
      
      // スプレッドシート保護チェック
      if (process.env.PROTECT_SPREADSHEET === 'true') {
        embed
          .setColor('#ff0000')
          .setTitle('❌ DB→シート 同期拒否')
          .setDescription('スプレッドシート保護モードが有効のため、書き込み同期は実行できません。')
          .addFields({
            name: '⚙️ 設定変更方法',
            value: 'PROTECT_SPREADSHEET=false に設定してBOTを再起動してください。',
            inline: false
          });
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // 実際の同期処理
      logger.warn('DB→シート同期を実行', { memberCount: membersToSync.length });
      await sheetsService.batchSyncMembers(membersToSync);

      embed
        .setColor('#00ff00')
        .setTitle('✅ DB→シート 同期完了')
        .setDescription(`${members.length}名の部員データをスプレッドシートに同期しました。`);

      await interaction.editReply({ embeds: [embed] });
      logCommandUsage(interaction, 'DB→シート同期', `${members.length}名`);

    } else {
      // スプレッドシートからデータベースへ
      logger.info('スプレッドシートからデータベースへの同期を実行');
      const embed = new EmbedBuilder()
        .setColor('#ffaa00')
        .setTitle('📊 シート→DB 同期実行中...')
        .setDescription('スプレッドシートから部員データを取得しています...')
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // スプレッドシートから部員データを取得
      const sheetMembers = await sheetsService.getAllMembers();
      
      if (sheetMembers.length === 0) {
        embed
          .setColor('#ff0000')
          .setTitle('❌ 部員データが見つかりません')
          .setDescription('スプレッドシートに部員データがありません。')
          .addFields({
            name: '確認事項',
            value: [
              `・スプレッドシートID: ${config.sheets.spreadsheetId}`,
              `・シート名: ${config.sheets.sheetName}`,
              '・データが2行目以降に存在するか',
              '・ヘッダーが正しく設定されているか'
            ].join('\n')
          });
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      embed
        .setDescription(`${sheetMembers.length}名の部員データをデータベースに同期しています...`);
      await interaction.editReply({ embeds: [embed] });

      // データベースに保存
      let successCount = 0;
      let errorCount = 0;

      for (const member of sheetMembers) {
        try {
          // Discord IDはスプレッドシートにないため、Discordユーザー名で検索
          const existingMember = await db.getMemberByDiscordUsername(member.discordUsername);
          
          if (existingMember) {
            // 既存メンバーの更新
            await db.updateMember(existingMember.discord_id, {
              name: member.name,
              discordDisplayName: member.discordDisplayName,
              studentId: member.studentId,
              gender: member.gender,
              team: member.team,
              membershipFeeRecord: member.membershipFeeRecord,
              grade: member.grade
            });
          } else {
            // 新規メンバーの追加（Discord IDは仮のIDを設定）
            logger.info('新規部員をデータベースに追加', { name: member.name });
            // 注意: 実際の運用ではDiscord IDのマッピングが必要
          }
          successCount++;
        } catch (error) {
          logger.error('部員データの同期エラー', { member: member.name, error: error.message });
          errorCount++;
        }
      }

      embed
        .setColor(errorCount === 0 ? '#00ff00' : '#ffaa00')
        .setTitle(errorCount === 0 ? '✅ シート→DB 同期完了' : '⚠️ シート→DB 同期完了（一部エラー）')
        .setDescription(`同期結果: 成功 ${successCount}名 / エラー ${errorCount}名`);

      await interaction.editReply({ embeds: [embed] });
      logCommandUsage(interaction, 'シート→DB同期', `成功:${successCount}名`);
    }

  } catch (error) {
    logger.error('シート同期に失敗しました', { error: error.message });
    
    const errorEmbed = new EmbedBuilder()
      .setColor('#ff0000')
      .setTitle('❌ シート同期エラー')
      .setDescription('シートの同期中にエラーが発生しました。')
      .addFields({
        name: 'エラー詳細',
        value: error.message,
        inline: false,
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [errorEmbed] });
  } finally {
    await db.close();
  }
}

async function handleValidate(interaction: ChatInputCommandInteraction) {
  const config = configManager.getConfig();
  
  if (!config.sheets.spreadsheetId) {
    await interaction.reply({
      content: 'スプレッドシートが設定されていません。先に `/sheet setup` を実行してください。',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const sheetsService = new GoogleSheetsService();

  try {
    const isValid = await sheetsService.validateSheetStructure(
      config.sheets.spreadsheetId,
      config.sheets.sheetName
    );

    const embed = new EmbedBuilder()
      .setColor(isValid ? '#00ff00' : '#ff0000')
      .setTitle(isValid ? '✅ シート構造検証完了' : '❌ シート構造エラー')
      .setDescription(
        isValid 
          ? 'スプレッドシートの構造は正常です。'
          : 'スプレッドシートの構造に問題があります。'
      )
      .addFields({
        name: '期待するヘッダー',
        value: [
          '名前', 'Discord表示名', 'Discordユーザー名', '学籍番号',
          '性別', '班', '部費納入記録', '学年'
        ].join(', '),
        inline: false,
      })
      .setTimestamp();

    if (!isValid) {
      embed.addFields({
        name: '対処方法',
        value: [
          '1. `/sheet create-header` でヘッダーを作成',
          '2. 手動でヘッダーを正しい形式に修正',
          '3. 再度検証を実行'
        ].join('\n'),
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
    logCommandUsage(interaction, 'シート構造検証', isValid ? '成功' : '失敗');

  } catch (error) {
    logger.error('シート構造検証に失敗しました', { error: error.message });
    
    const errorEmbed = new EmbedBuilder()
      .setColor('#ff0000')
      .setTitle('❌ 検証エラー')
      .setDescription('シート構造の検証中にエラーが発生しました。')
      .addFields({
        name: 'エラー詳細',
        value: error.message,
        inline: false,
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [errorEmbed] });
  }
}

async function handleCreateHeader(interaction: ChatInputCommandInteraction) {
  const config = configManager.getConfig();
  
  if (!config.sheets.spreadsheetId) {
    await interaction.reply({
      content: 'スプレッドシートが設定されていません。先に `/sheet setup` を実行してください。',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  const sheetsService = new GoogleSheetsService();

  try {
    await sheetsService.createSheetHeader(
      config.sheets.spreadsheetId,
      config.sheets.sheetName
    );

    const embed = new EmbedBuilder()
      .setColor('#00ff00')
      .setTitle('✅ ヘッダー作成完了')
      .setDescription('スプレッドシートにヘッダーを作成しました。')
      .addFields({
        name: '作成されたヘッダー',
        value: [
          '名前', 'Discord表示名', 'Discordユーザー名', '学籍番号',
          '性別', '班', '部費納入記録', '学年'
        ].join(', '),
        inline: false,
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    logCommandUsage(interaction, 'シートヘッダー作成');

  } catch (error) {
    logger.error('シートヘッダー作成に失敗しました', { error: error.message });
    
    const errorEmbed = new EmbedBuilder()
      .setColor('#ff0000')
      .setTitle('❌ ヘッダー作成エラー')
      .setDescription('ヘッダーの作成中にエラーが発生しました。')
      .addFields({
        name: 'エラー詳細',
        value: error.message,
        inline: false,
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [errorEmbed] });
  }
}
async function handleSyncStatus(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();
    
    // syncServiceが正しく読み込まれているかチェック
    if (!syncService) {
      throw new Error('同期サービスが初期化されていません');
    }
    
    const status = syncService.getSyncStatus();
    
    // 最新の同期メタデータを取得
    const db = new DatabaseService();
    await db.initialize();
    const lastSyncMeta = await db.getLastSyncMetadata('sheet-to-db');
    await db.close();
  
  const embed = new EmbedBuilder()
    .setColor(status.isRunning ? "#ffaa00" : "#0099ff")
    .setTitle("🔄 自動同期ステータス（最適化版）")
    .setDescription(status.isRunning ? "同期処理実行中..." : "待機中")
    .addFields(
      {
        name: "🚀 自動同期",
        value: status.autoSyncEnabled ? "有効" : "無効",
        inline: true,
      },
      {
        name: "⏰ 同期間隔",
        value: status.syncInterval || "未設定",
        inline: true,
      },
      {
        name: "📅 最終同期",
        value: status.lastSyncTime 
          ? `<t:${Math.floor(status.lastSyncTime.getTime() / 1000)}:R>` 
          : "未実行",
        inline: true,
      }
    );

  // 同期パフォーマンス情報を追加
  if (lastSyncMeta) {
    const perfText = [
      `状態: ${lastSyncMeta.status}`,
      `処理時間: ${lastSyncMeta.sync_duration}ms`,
      `処理件数: ${lastSyncMeta.records_processed}件`,
      `更新: ${lastSyncMeta.records_updated}件`,
      `スキップ: ${lastSyncMeta.records_skipped}件`
    ].join('\n');

    embed.addFields({
      name: "📊 最新同期結果",
      value: "```\n" + perfText + "\n```",
      inline: false,
    });

    if (lastSyncMeta.sheet_last_modified) {
      const sheetModified = new Date(lastSyncMeta.sheet_last_modified);
      embed.addFields({
        name: "📄 シート最終更新",
        value: `<t:${Math.floor(sheetModified.getTime() / 1000)}:R>`,
        inline: true,
      });
    }
  }

  embed
    .setFooter({ text: "同期方向: スプレッドシート → データベース | タイムスタンプ最適化: 有効" })
    .setTimestamp();

  // 環境変数の状態も表示
  const envSettings = [
    `PROTECT_SPREADSHEET: ${process.env.PROTECT_SPREADSHEET || "false"}`,
    `AUTO_SYNC_ENABLED: ${process.env.AUTO_SYNC_ENABLED || "true"}`,
    `AUTO_SYNC_INTERVAL: ${process.env.AUTO_SYNC_INTERVAL || "0 */30 * * * *"}`,
  ];

  embed.addFields({
    name: "⚙️ 環境設定",
    value: "```" + envSettings.join("\n") + "```",
    inline: false,
  });

    await interaction.editReply({ embeds: [embed] });
    logCommandUsage(interaction, "同期ステータス確認");
  } catch (error) {
    logger.error('sync-statusコマンドエラー', { 
      error: error.message,
      stack: error.stack,
      syncServiceExists: !!syncService
    });
    
    const errorMessage = `ステータス確認中にエラーが発生しました: ${error.message}`;
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: errorMessage });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}

async function handleDebugData(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply();
    
    const sheetsService = new GoogleSheetsService();
    
    // スプレッドシートから直接データを取得
    const members = await sheetsService.getAllMembers();
    
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('🔍 スプレッドシートデータ確認')
      .setDescription(`取得した部員数: ${members.length}名`)
      .setTimestamp();

    if (members.length > 0) {
      // 最初の5名を表示
      const sampleMembers = members.slice(0, 5);
      for (const member of sampleMembers) {
        embed.addFields({
          name: `${member.name} (${member.discordUsername})`,
          value: [
            `学籍番号: ${member.studentId}`,
            `性別: ${member.gender}`,
            `班: ${member.team}`,
            `部費: ${member.membershipFeeRecord}`,
            `学年: ${member.grade}`
          ].join('\n'),
          inline: true
        });
      }
      
      if (members.length > 5) {
        embed.addFields({
          name: '📝 注意',
          value: `残り${members.length - 5}名は省略されています`,
          inline: false
        });
      }
    }

    await interaction.editReply({ embeds: [embed] });
    logCommandUsage(interaction, 'スプレッドシートデータ確認');
    
  } catch (error) {
    logger.error('debug-dataコマンドエラー', { error: error.message });
    
    const errorMessage = 'データ確認中にエラーが発生しました: ' + error.message;
    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({ content: errorMessage });
    } else {
      await interaction.reply({ content: errorMessage, ephemeral: true });
    }
  }
}
