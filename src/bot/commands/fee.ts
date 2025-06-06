import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, AttachmentBuilder, User } from 'discord.js';
import { validateAdvancedPermissions, logCommandUsage } from '../../utils/permissions';
import { DatabaseService } from '../../services/database';
import { GoogleSheetsService } from '../../services/google';
import { MemberConverter, MemberFormatter } from '../../utils/memberUtils';
import { logger } from '../../utils/logger';
import { Member } from '../../types';
import { syncService } from '../../services/sync';

export default {
  data: new SlashCommandBuilder()
    .setName('fee')
    .setDescription('部費管理コマンド')
    .addSubcommand(subcommand =>
      subcommand
        .setName('check')
        .setDescription('自分の部費納入状況を確認します')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('update')
        .setDescription('部費納入記録を更新します（管理者専用）')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('更新するDiscordユーザー')
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName('record')
            .setDescription('部費納入記録')
            .setRequired(true)
            .addChoices(
              { name: '完納', value: '完納' },
              { name: '未納', value: '未納' },
              { name: '一部納入', value: '一部納入' },
              { name: '免除', value: '免除' }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('unpaid')
        .setDescription('部費未納入者一覧を表示します（管理者専用）')
        .addStringOption(option =>
          option
            .setName('grade')
            .setDescription('特定学年でフィルタリング')
            .setRequired(false)
            .addChoices(
              { name: '1年生', value: '1' },
              { name: '2年生', value: '2' },
              { name: '3年生', value: '3' },
              { name: '4年生', value: '4' },
              { name: 'OB', value: 'OB' }
            )
        )
        .addStringOption(option =>
          option
            .setName('team')
            .setDescription('特定班でフィルタリング')
            .setRequired(false)
        )
        .addBooleanOption(option =>
          option
            .setName('export')
            .setDescription('CSV形式でエクスポートする')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('stats')
        .setDescription('部費統計情報を表示します（管理者専用）')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remind')
        .setDescription('未納者に通知を送信します（管理者専用）')
        .addStringOption(option =>
          option
            .setName('message')
            .setDescription('カスタムメッセージ（省略時はデフォルトメッセージ）')
            .setRequired(false)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();
    
    const isAdminCommand = ['update', 'unpaid', 'stats', 'remind'].includes(subcommand);
    const permissionLevel = {
      level: isAdminCommand ? 'admin' : 'member',
      // 統計機能は軽度な制限レベル
      restrictedChannels: subcommand === 'stats' ? [] : undefined
    } as const;
    
    if (!await validateAdvancedPermissions(interaction, permissionLevel)) return;

    const db = new DatabaseService();
    await db.initialize();
    
    const sheetsService = new GoogleSheetsService();

    try {
      switch (subcommand) {
        case 'check':
          await handleCheck(interaction, db);
          break;
        case 'update':
          await handleUpdate(interaction, db, sheetsService);
          break;
        case 'unpaid':
          await handleUnpaid(interaction, db);
          break;
        case 'stats':
          await handleStats(interaction, db);
          break;
        case 'remind':
          await handleRemind(interaction, db);
          break;
      }
    } catch (error) {
      logger.error(`部費管理コマンドエラー: ${subcommand}`, { error: (error as Error).message });
      
      const errorMessage = 'コマンドの実行中にエラーが発生しました。';
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

async function handleCheck(interaction: ChatInputCommandInteraction, db: DatabaseService) {
  // データ操作前の自動同期
  const syncResult = await syncService.syncBeforeDataOperation();
  if (!syncResult.success) {
    logger.warn('同期に失敗しましたが、処理を続行します', { error: syncResult.message });
  }

  const dbMember = await db.getMemberByDiscordId(interaction.user.id);
  
  if (!dbMember) {
    await interaction.reply({
      content: 'あなたは部員として登録されていません。管理者にお問い合わせください。',
      ephemeral: true,
    });
    return;
  }

  const member = MemberConverter.dbRowToMember(dbMember);
  if (!member) {
    await interaction.reply({
      content: 'データの取得に失敗しました。管理者にお問い合わせください。',
      ephemeral: true,
    });
    return;
  }

  const isPaid = member.membershipFeeRecord === '完納';
  const isExempt = member.membershipFeeRecord === '免除';
  const isPartiallyPaid = member.membershipFeeRecord === '一部納入';
  
  let statusColor = '#ff0000'; // 未納
  if (isPaid) statusColor = '#00ff00'; // 完納
  else if (isExempt) statusColor = '#0099ff'; // 免除
  else if (isPartiallyPaid) statusColor = '#ffaa00'; // 一部納入

  let statusText = '❌ 未納';
  if (isPaid) statusText = '✅ 完納済み';
  else if (isExempt) statusText = '🆓 免除';
  else if (isPartiallyPaid) statusText = '⚠️ 一部納入';

  const embed = new EmbedBuilder()
    .setColor(statusColor as any)
    .setTitle('💰 部費納入状況')
    .setDescription(`${member.name} さんの部費納入状況`)
    .addFields(
      {
        name: '基本情報',
        value: [
          `**学年**: ${member.grade}年`,
          `**班**: ${member.team}`,
          `**学籍番号**: ${member.studentId}`
        ].join('\n'),
        inline: true,
      },
      {
        name: '納入状況',
        value: member.membershipFeeRecord,
        inline: true,
      },
      {
        name: 'ステータス',
        value: statusText,
        inline: true,
      }
    )
    .setTimestamp();

  if (!isPaid && !isExempt) {
    embed.addFields({
      name: '💡 納入方法',
      value: [
        '• **現金**: 部室にて部費担当者に直接納入',
        '• **振込**: 指定口座への銀行振込',
        '• **その他**: PayPayなど（詳細は管理者まで）',
        '',
        '❓ 不明な点は管理者にお問い合わせください'
      ].join('\n'),
      inline: false,
    });
  }

  if (isPartiallyPaid) {
    embed.addFields({
      name: '📋 今後の対応',
      value: '残額の納入をお願いします。金額については管理者にご確認ください。',
      inline: false,
    });
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
  logCommandUsage(interaction, '部費状況確認', member.membershipFeeRecord);
}

async function handleUpdate(
  interaction: ChatInputCommandInteraction,
  db: DatabaseService,
  sheetsService: GoogleSheetsService
) {
  const user = interaction.options.getUser('user', true);
  const record = interaction.options.getString('record', true);

  await interaction.deferReply();

  const existingMember = await db.getMemberByDiscordId(user.id);
  if (!existingMember) {
    await interaction.editReply('このユーザーは部員として登録されていません。');
    return;
  }

  const oldRecord = existingMember.membership_fee_record;
  
  await db.updateMember(user.id, { membershipFeeRecord: record });

  // 既存メンバーデータをMemberオブジェクトに変換
  const currentMember = MemberConverter.dbRowToMember(existingMember);
  if (!currentMember) {
    await interaction.editReply('既存の部員データの変換に失敗しました。');
    return;
  }

  const updatedMember: Member = {
    ...currentMember,
    membershipFeeRecord: record as '完納' | '未納' | '一部納入' | '免除',
  };

  // 編集後の自動シート更新（環境変数に関係なく実行）
  try {
    const sheetUpdateResult = await syncService.updateMemberToSheet({
      discordId: user.id,
      name: updatedMember.name,
      discordDisplayName: updatedMember.discordDisplayName,
      discordUsername: updatedMember.discordUsername,
      studentId: updatedMember.studentId,
      gender: updatedMember.gender,
      team: updatedMember.team,
      membershipFeeRecord: updatedMember.membershipFeeRecord,
      grade: updatedMember.grade.toString()
    });
    
    if (sheetUpdateResult.success) {
      logger.info('部費更新後のシート更新成功', { memberName: updatedMember.name });
    } else {
      logger.warn('部費更新後のシート更新失敗', { 
        memberName: updatedMember.name, 
        error: sheetUpdateResult.message 
      });
    }
  } catch (error) {
    logger.error('部費更新後のシート更新でエラー', { 
      memberName: updatedMember.name, 
      error: (error as Error).message 
    });
  }

  const embed = new EmbedBuilder()
    .setColor('#ffaa00')
    .setTitle('💰 部費記録更新完了')
    .setDescription(`${existingMember.name} さんの部費記録を更新しました。`)
    .addFields(
      {
        name: '変更前',
        value: oldRecord,
        inline: true,
      },
      {
        name: '変更後',
        value: record,
        inline: true,
      }
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  logCommandUsage(interaction, '部費記録更新', user.username);
}

async function handleUnpaid(interaction: ChatInputCommandInteraction, db: DatabaseService) {
  const gradeFilter = interaction.options.getString('grade');
  const teamFilter = interaction.options.getString('team');
  const exportCsv = interaction.options.getBoolean('export') || false;

  // データ操作前の自動同期
  const syncResult = await syncService.syncBeforeDataOperation();
  if (!syncResult.success) {
    logger.warn('同期に失敗しましたが、処理を続行します', { error: syncResult.message });
  }

  await interaction.deferReply({ ephemeral: true });

  let unpaidMembers = await db.getUnpaidMembers();
  
  if (gradeFilter) {
    unpaidMembers = unpaidMembers.filter(member => member.grade === gradeFilter);
  }
  
  if (teamFilter) {
    unpaidMembers = unpaidMembers.filter(member => 
      member.team.toLowerCase().includes(teamFilter.toLowerCase())
    );
  }

  if (unpaidMembers.length === 0) {
    const filterText = gradeFilter || teamFilter ? 
      ` (フィルター: ${[gradeFilter, teamFilter].filter(Boolean).join(', ')})` : '';
    await interaction.editReply(`部費未納入者はいません${filterText}。`);
    return;
  }

  const embed = new EmbedBuilder()
    .setColor('#ff0000')
    .setTitle('💸 部費未納入者一覧')
    .setDescription(`未納入者数: ${unpaidMembers.length}名`)
    .setTimestamp();

  if (gradeFilter || teamFilter) {
    const filters = [];
    if (gradeFilter) filters.push(`学年: ${gradeFilter}年生`);
    if (teamFilter) filters.push(`班: ${teamFilter}`);
    embed.addFields({
      name: 'フィルター条件',
      value: filters.join(', '),
      inline: false,
    });
  }

  const membersByGrade = unpaidMembers.reduce((acc, member) => {
    const grade = member.grade || '不明';
    if (!acc[grade]) acc[grade] = [];
    acc[grade].push(member);
    return acc;
  }, {} as Record<string, any[]>);

  const gradeOrder = ['1', '2', '3', '4', 'OB', '不明'];
  
  for (const grade of gradeOrder) {
    if (membersByGrade[grade]) {
      const memberList = membersByGrade[grade]
        .map(member => `${member.name} (${member.team}) - ${member.membership_fee_record}`)
        .join('\n');
      
      if (memberList.length < 1024) {
        embed.addFields({
          name: `${grade}年生 (${membersByGrade[grade].length}名)`,
          value: memberList,
          inline: false,
        });
      } else {
        const truncated = memberList.substring(0, 1000) + '...';
        embed.addFields({
          name: `${grade}年生 (${membersByGrade[grade].length}名)`,
          value: truncated,
          inline: false,
        });
      }
    }
  }

  const replyOptions: any = { embeds: [embed] };

  if (exportCsv) {
    try {
      const csvContent = generateCsv(unpaidMembers);
      const attachment = new AttachmentBuilder(
        Buffer.from(csvContent, 'utf-8'),
        { name: `unpaid_members_${new Date().toISOString().split('T')[0]}.csv` }
      );
      replyOptions.files = [attachment];
      
      embed.addFields({
        name: '📁 CSVエクスポート',
        value: 'CSVファイルを添付しました。',
        inline: false,
      });
    } catch (error) {
      logger.error('CSVエクスポートに失敗しました', { error: error.message });
      embed.addFields({
        name: '⚠️ エクスポートエラー',
        value: 'CSVファイルの生成に失敗しました。',
        inline: false,
      });
    }
  }

  await interaction.editReply(replyOptions);
  logCommandUsage(interaction, '未納者一覧表示', `${unpaidMembers.length}名`);
}

function generateCsv(members: any[]): string {
  const headers = ['名前', 'Discord表示名', 'Discordユーザー名', '学籍番号', '性別', '班', '学年', '部費納入記録'];
  
  const rows = members.map(member => [
    member.name,
    member.discord_display_name,
    member.discord_username,
    member.student_id,
    member.gender,
    member.team,
    member.grade,
    member.membership_fee_record
  ]);

  const csvContent = [headers, ...rows]
    .map(row => row.map(field => `"${field.toString().replace(/"/g, '""')}"`).join(','))
    .join('\n');

  return `\uFEFF${csvContent}`;
}

async function handleStats(interaction: ChatInputCommandInteraction, db: DatabaseService) {
  await interaction.deferReply({ ephemeral: true });

  // データ操作前の自動同期
  const syncResult = await syncService.syncBeforeDataOperation();
  if (!syncResult.success) {
    logger.warn('同期に失敗しましたが、処理を続行します', { error: syncResult.message });
  }

  try {
    const allMembers = await db.getAllMembers();
    
    if (allMembers.length === 0) {
      await interaction.editReply('登録されている部員がいません。');
      return;
    }

    // 統計情報を計算
    const stats = {
      total: allMembers.length,
      paid: 0,
      unpaid: 0,
      partiallyPaid: 0,
      exempt: 0,
      byGrade: {} as Record<string, { total: number; paid: number; unpaid: number; partiallyPaid: number; exempt: number }>,
      byTeam: {} as Record<string, { total: number; paid: number; unpaid: number; partiallyPaid: number; exempt: number }>
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

      // 学年別統計
      if (!stats.byGrade[grade]) {
        stats.byGrade[grade] = { total: 0, paid: 0, unpaid: 0, partiallyPaid: 0, exempt: 0 };
      }
      stats.byGrade[grade].total++;
      if (feeStatus === '完納') stats.byGrade[grade].paid++;
      else if (feeStatus === '未納') stats.byGrade[grade].unpaid++;
      else if (feeStatus === '一部納入') stats.byGrade[grade].partiallyPaid++;
      else if (feeStatus === '免除') stats.byGrade[grade].exempt++;

      // 班別統計
      if (!stats.byTeam[team]) {
        stats.byTeam[team] = { total: 0, paid: 0, unpaid: 0, partiallyPaid: 0, exempt: 0 };
      }
      stats.byTeam[team].total++;
      if (feeStatus === '完納') stats.byTeam[team].paid++;
      else if (feeStatus === '未納') stats.byTeam[team].unpaid++;
      else if (feeStatus === '一部納入') stats.byTeam[team].partiallyPaid++;
      else if (feeStatus === '免除') stats.byTeam[team].exempt++;
    }

    const collectionRate = ((stats.paid + stats.exempt) / stats.total * 100).toFixed(1);

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('📊 部費納入統計')
      .setDescription(`総部員数: ${stats.total}名 | 納入率: ${collectionRate}%`)
      .addFields(
        {
          name: '📈 全体統計',
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

    // 学年別統計（上位5学年）
    const gradeEntries = Object.entries(stats.byGrade)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .slice(0, 5);

    if (gradeEntries.length > 0) {
      const gradeStats = gradeEntries.map(([grade, data]) => {
        const gradeRate = ((data.paid + data.exempt) / data.total * 100).toFixed(1);
        return `**${grade}年**: ${gradeRate}% (${data.paid + data.exempt}/${data.total})`;
      }).join('\n');

      embed.addFields({
        name: '🎓 学年別納入率',
        value: gradeStats,
        inline: true,
      });
    }

    // 班別統計（上位5班）
    const teamEntries = Object.entries(stats.byTeam)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 5);

    if (teamEntries.length > 0) {
      const teamStats = teamEntries.map(([team, data]) => {
        const teamRate = ((data.paid + data.exempt) / data.total * 100).toFixed(1);
        return `**${team}**: ${teamRate}% (${data.paid + data.exempt}/${data.total})`;
      }).join('\n');

      embed.addFields({
        name: '👥 班別納入率 (上位5班)',
        value: teamStats,
        inline: true,
      });
    }

    await interaction.editReply({ embeds: [embed] });
    logCommandUsage(interaction, '部費統計表示', `納入率: ${collectionRate}%`);

  } catch (error) {
    logger.error('部費統計の取得に失敗しました', { error: error instanceof Error ? error.message : 'Unknown error' });
    await interaction.editReply('統計情報の取得に失敗しました。');
  }
}

async function handleRemind(interaction: ChatInputCommandInteraction, db: DatabaseService) {
  const customMessage = interaction.options.getString('message');
  
  await interaction.deferReply({ ephemeral: true });

  try {
    const unpaidMembers = await db.getUnpaidMembers();
    
    if (unpaidMembers.length === 0) {
      await interaction.editReply('現在、部費未納入者はいません。');
      return;
    }

    const defaultMessage = [
      '🔔 **部費納入のお知らせ**',
      '',
      '部費の納入がまだ完了していません。',
      'お手続きをお願いいたします。',
      '',
      '**納入方法**:',
      '• 現金: 部室にて部費担当者まで',
      '• 振込: 指定口座への振込',
      '• その他: 管理者にお問い合わせください',
      '',
      'ご不明な点がございましたら、管理者までお問い合わせください。'
    ].join('\n');

    const message = customMessage || defaultMessage;
    let successCount = 0;
    let failureCount = 0;

    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply('サーバー情報の取得に失敗しました。');
      return;
    }

    // バッチ処理で通知を送信
    for (const dbMember of unpaidMembers) {
      try {
        const member = MemberConverter.dbRowToMember(dbMember);
        if (!member) continue;

        const discordMember = await guild.members.fetch(dbMember.discord_id);
        if (!discordMember) continue;

        const embed = new EmbedBuilder()
          .setColor('#ffaa00')
          .setTitle('💰 部費納入のお知らせ')
          .setDescription(message)
          .addFields({
            name: '現在の状況',
            value: `**納入状況**: ${member.membershipFeeRecord}`,
            inline: false,
          })
          .setFooter({ text: '部活動管理BOT' })
          .setTimestamp();

        await discordMember.send({ embeds: [embed] });
        successCount++;

        // レート制限対策で短い間隔を設ける
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        logger.warn('未納者への通知送信に失敗しました', { 
          memberId: dbMember.discord_id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        failureCount++;
      }
    }

    const embed = new EmbedBuilder()
      .setColor('#00ff00')
      .setTitle('📤 通知送信完了')
      .setDescription('未納者への通知送信が完了しました。')
      .addFields(
        {
          name: '送信結果',
          value: [
            `✅ **成功**: ${successCount}名`,
            `❌ **失敗**: ${failureCount}名`,
            `📊 **総対象者**: ${unpaidMembers.length}名`
          ].join('\n'),
          inline: false,
        }
      )
      .setTimestamp();

    if (failureCount > 0) {
      embed.addFields({
        name: '⚠️ 注意',
        value: '一部のユーザーへの通知送信に失敗しました。DMが無効になっている可能性があります。',
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
    logCommandUsage(interaction, '未納者通知送信', `成功: ${successCount}名, 失敗: ${failureCount}名`);

  } catch (error) {
    logger.error('未納者通知の送信に失敗しました', { error: error instanceof Error ? error.message : 'Unknown error' });
    await interaction.editReply('通知の送信に失敗しました。');
  }
}