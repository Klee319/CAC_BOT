import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { validateAdvancedPermissions, logCommandUsage } from '../../utils/permissions';
import { DatabaseService } from '../../services/database';
import { VoteService } from '../../services/vote';
import { GoogleFormsService } from '../../services/google/forms';
import { logger } from '../../utils/logger';
import { Vote } from '../../types';

export default {
  data: new SlashCommandBuilder()
    .setName('vote')
    .setDescription('投票・アンケート管理コマンド')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('新規投票を作成します（管理者専用）')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('進行中の投票一覧を表示します')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('response')
        .setDescription('自分の回答を確認・編集します')
        .addStringOption(option =>
          option
            .setName('vote_id')
            .setDescription('投票ID')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('close')
        .setDescription('投票を終了します（管理者専用）')
        .addStringOption(option =>
          option
            .setName('vote_id')
            .setDescription('投票ID')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('results')
        .setDescription('投票結果を確認します（管理者専用）')
        .addStringOption(option =>
          option
            .setName('vote_id')
            .setDescription('投票ID')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit')
        .setDescription('既存投票を編集します（管理者専用）')
        .addStringOption(option =>
          option
            .setName('vote_id')
            .setDescription('投票ID')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('stats')
        .setDescription('投票統計情報を表示します（管理者専用）')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('analysis')
        .setDescription('投票の詳細分析を表示します（管理者専用）')
        .addStringOption(option =>
          option
            .setName('vote_id')
            .setDescription('投票ID')
            .setRequired(true)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();
    
    const isAdminCommand = ['create', 'close', 'results', 'edit', 'stats', 'analysis'].includes(subcommand);
    const permissionLevel = {
      level: isAdminCommand ? 'admin' : 'member',
      // list, response コマンドはより柔軟に
      restrictedChannels: ['list', 'response'].includes(subcommand) ? [] : undefined
    } as const;
    
    if (!await validateAdvancedPermissions(interaction, permissionLevel)) return;

    const db = new DatabaseService();
    await db.initialize();
    
    const voteService = new VoteService(db);

    try {
      switch (subcommand) {
        case 'create':
          await handleCreate(interaction);
          break;
        case 'list':
          await handleList(interaction, db);
          break;
        case 'response':
          await handleResponse(interaction, db);
          break;
        case 'close':
          await handleClose(interaction, db);
          break;
        case 'results':
          await handleResults(interaction, db);
          break;
        case 'edit':
          await handleEdit(interaction, db);
          break;
        case 'stats':
          await handleStats(interaction, voteService);
          break;
        case 'analysis':
          await handleAnalysis(interaction, voteService);
          break;
      }
    } catch (error) {
      logger.error(`投票コマンドエラー: ${subcommand}`, { error: (error as Error).message });
      
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

async function handleCreate(interaction: ChatInputCommandInteraction) {
  const modal = new ModalBuilder()
    .setCustomId('vote_create_modal')
    .setTitle('新規投票作成');

  const titleInput = new TextInputBuilder()
    .setCustomId('vote_title')
    .setLabel('投票タイトル')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('例: 次回イベントの場所について')
    .setRequired(true)
    .setMaxLength(100);

  const descriptionInput = new TextInputBuilder()
    .setCustomId('vote_description')
    .setLabel('投票説明（オプション）')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('投票の詳細説明を入力してください')
    .setRequired(false)
    .setMaxLength(1000);

  const formUrlInput = new TextInputBuilder()
    .setCustomId('form_url')
    .setLabel('Google FormsのURL（オプション）')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('https://forms.google.com/...')
    .setRequired(false);

  const deadlineInput = new TextInputBuilder()
    .setCustomId('deadline')
    .setLabel('回答期限（例: 2024-12-31 23:59）')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('YYYY-MM-DD HH:MM')
    .setRequired(true);

  const optionsInput = new TextInputBuilder()
    .setCustomId('options')
    .setLabel('選択肢（改行区切り、Google Formsの場合は不要）')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('選択肢1\n選択肢2\n選択肢3')
    .setRequired(false);

  const titleRow = new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput);
  const descriptionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput);
  const formUrlRow = new ActionRowBuilder<TextInputBuilder>().addComponents(formUrlInput);
  const deadlineRow = new ActionRowBuilder<TextInputBuilder>().addComponents(deadlineInput);
  const optionsRow = new ActionRowBuilder<TextInputBuilder>().addComponents(optionsInput);

  modal.addComponents(titleRow, descriptionRow, formUrlRow, deadlineRow, optionsRow);

  await interaction.showModal(modal);
}

async function handleList(interaction: ChatInputCommandInteraction, db: DatabaseService) {
  await interaction.deferReply();

  try {
    const votes = await db.getActiveVotes();
    
    if (votes.length === 0) {
      await interaction.editReply('現在進行中の投票はありません。');
      return;
    }

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('🗳️ 進行中の投票一覧')
      .setDescription(`現在進行中の投票: ${votes.length}件`)
      .setTimestamp();

    for (const vote of votes.slice(0, 10)) {
      const deadline = new Date(vote.deadline);
      const now = new Date();
      const isExpired = deadline < now;
      
      embed.addFields({
        name: `${vote.title} ${isExpired ? '⏰' : '🟢'}`,
        value: [
          `**ID**: ${vote.id}`,
          `**説明**: ${vote.description || 'なし'}`,
          `**期限**: <t:${Math.floor(deadline.getTime() / 1000)}:F>`,
          `**作成者**: <@${vote.created_by}>`,
          `**匿名**: ${vote.anonymous ? 'はい' : 'いいえ'}`,
          `**編集可能**: ${vote.allow_edit ? 'はい' : 'いいえ'}`
        ].join('\n'),
        inline: false,
      });
    }

    if (votes.length > 10) {
      embed.setFooter({ text: `他に ${votes.length - 10} 件の投票があります` });
    }

    await interaction.editReply({ embeds: [embed] });
    logCommandUsage(interaction, '投票一覧表示', `${votes.length}件`);

  } catch (error) {
    logger.error('投票一覧の取得に失敗しました', { error: (error as Error).message });
    await interaction.editReply('投票一覧の取得中にエラーが発生しました。');
  }
}

async function handleResponse(interaction: ChatInputCommandInteraction, db: DatabaseService) {
  const voteId = interaction.options.getString('vote_id', true);
  
  await interaction.deferReply({ ephemeral: true });

  try {
    const vote = await db.getVote(voteId);
    
    if (!vote) {
      await interaction.editReply('指定された投票が見つかりません。');
      return;
    }

    if (!vote.is_active) {
      await interaction.editReply('この投票は既に終了しています。');
      return;
    }

    const deadline = new Date(vote.deadline);
    const now = new Date();
    
    if (deadline < now) {
      await interaction.editReply('この投票の回答期限が過ぎています。');
      return;
    }

    const response = await db.getVoteResponse(voteId, interaction.user.id);

    const embed = new EmbedBuilder()
      .setColor(response ? '#ffaa00' : '#0099ff')
      .setTitle(`🗳️ ${vote.title}`)
      .setDescription(vote.description || '投票にご参加ください')
      .addFields(
        {
          name: '回答期限',
          value: `<t:${Math.floor(deadline.getTime() / 1000)}:F>`,
          inline: true,
        },
        {
          name: '回答状況',
          value: response ? '✅ 回答済み' : '❌ 未回答',
          inline: true,
        }
      )
      .setTimestamp();

    if (response) {
      embed.addFields({
        name: '現在の回答',
        value: JSON.stringify(JSON.parse(response.responses), null, 2),
        inline: false,
      });

      if (vote.allow_edit) {
        embed.addFields({
          name: '📝 編集可能',
          value: '新しい回答を送信すると、前の回答が上書きされます。',
          inline: false,
        });
      }
    }

    if (vote.form_url) {
      embed.addFields({
        name: '📋 Google Formsで回答',
        value: `[こちらから回答してください](${vote.form_url})`,
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
    logCommandUsage(interaction, '投票回答確認', voteId);

  } catch (error) {
    logger.error('投票回答の確認に失敗しました', { error: (error as Error).message });
    await interaction.editReply('投票回答の確認中にエラーが発生しました。');
  }
}

async function handleClose(interaction: ChatInputCommandInteraction, db: DatabaseService) {
  const voteId = interaction.options.getString('vote_id', true);
  
  await interaction.deferReply();

  try {
    const vote = await db.getVote(voteId);
    
    if (!vote) {
      await interaction.editReply('指定された投票が見つかりません。');
      return;
    }

    if (!vote.is_active) {
      await interaction.editReply('この投票は既に終了しています。');
      return;
    }

    await db.updateVote(voteId, { is_active: false });

    const embed = new EmbedBuilder()
      .setColor('#ff0000')
      .setTitle('🔒 投票終了')
      .setDescription(`「${vote.title}」の投票を終了しました。`)
      .addFields({
        name: '終了時刻',
        value: `<t:${Math.floor(Date.now() / 1000)}:F>`,
        inline: false,
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    logCommandUsage(interaction, '投票終了', voteId);

  } catch (error) {
    logger.error('投票の終了に失敗しました', { error: (error as Error).message });
    await interaction.editReply('投票の終了中にエラーが発生しました。');
  }
}

async function handleResults(interaction: ChatInputCommandInteraction, db: DatabaseService) {
  const voteId = interaction.options.getString('vote_id', true);
  
  await interaction.deferReply({ ephemeral: true });

  try {
    const vote = await db.getVote(voteId);
    
    if (!vote) {
      await interaction.editReply('指定された投票が見つかりません。');
      return;
    }

    const responses = await db.getVoteResponses(voteId);

    const embed = new EmbedBuilder()
      .setColor('#00ff00')
      .setTitle(`📊 投票結果: ${vote.title}`)
      .setDescription(vote.description || '')
      .addFields(
        {
          name: '投票情報',
          value: [
            `**回答数**: ${responses.length}名`,
            `**期限**: <t:${Math.floor(new Date(vote.deadline).getTime() / 1000)}:F>`,
            `**状況**: ${vote.is_active ? '進行中' : '終了'}`,
            `**匿名**: ${vote.anonymous ? 'はい' : 'いいえ'}`
          ].join('\n'),
          inline: false,
        }
      )
      .setTimestamp();

    if (responses.length === 0) {
      embed.addFields({
        name: '⚠️ 回答なし',
        value: 'まだ誰も回答していません。',
        inline: false,
      });
    } else {
      if (vote.anonymous) {
        embed.addFields({
          name: '📋 回答一覧（匿名）',
          value: responses.map((r, i) => 
            `**回答${i + 1}**: ${JSON.stringify(JSON.parse(r.responses))}`
          ).join('\n').substring(0, 1024),
          inline: false,
        });
      } else {
        embed.addFields({
          name: '📋 回答一覧',
          value: responses.map(r => 
            `**<@${r.user_id}>**: ${JSON.stringify(JSON.parse(r.responses))}`
          ).join('\n').substring(0, 1024),
          inline: false,
        });
      }
    }

    await interaction.editReply({ embeds: [embed] });
    logCommandUsage(interaction, '投票結果確認', voteId);

  } catch (error) {
    logger.error('投票結果の確認に失敗しました', { error: (error as Error).message });
    await interaction.editReply('投票結果の確認中にエラーが発生しました。');
  }
}

async function handleEdit(interaction: ChatInputCommandInteraction, db: DatabaseService) {
  const voteId = interaction.options.getString('vote_id', true);
  
  await interaction.deferReply({ ephemeral: true });

  try {
    const vote = await db.getVote(voteId);
    
    if (!vote) {
      await interaction.editReply('指定された投票が見つかりません。');
      return;
    }

    await interaction.editReply('投票編集機能は現在開発中です。');
    
  } catch (error) {
    logger.error('投票の編集に失敗しました', { error: (error as Error).message });
    await interaction.editReply('投票の編集中にエラーが発生しました。');
  }
}

async function handleStats(interaction: ChatInputCommandInteraction, voteService: VoteService) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const stats = await voteService.getVoteStats();

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('📊 投票統計情報')
      .setDescription('システム全体の投票統計')
      .addFields(
        {
          name: '📈 全体統計',
          value: [
            `**総投票数**: ${stats.totalVotes}件`,
            `**進行中**: ${stats.activeVotes}件`,
            `**完了済み**: ${stats.completedVotes}件`,
            `**総回答数**: ${stats.totalResponses}件`
          ].join('\n'),
          inline: true,
        },
        {
          name: '📊 平均回答率',
          value: `${stats.averageResponseRate.toFixed(1)}回答/投票`,
          inline: true,
        }
      )
      .setTimestamp();

    if (stats.recentVotes.length > 0) {
      const recentVotesList = stats.recentVotes.map(vote => {
        const deadline = new Date(vote.deadline);
        const isExpired = deadline < new Date();
        return `${isExpired ? '⏰' : '🟢'} **${vote.title}** (${vote.id})`;
      }).join('\n');

      embed.addFields({
        name: '🕒 最近の投票',
        value: recentVotesList,
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
    logCommandUsage(interaction, '投票統計表示');

  } catch (error) {
    logger.error('投票統計の取得に失敗しました', { error: (error as Error).message });
    await interaction.editReply('投票統計の取得中にエラーが発生しました。');
  }
}

async function handleAnalysis(interaction: ChatInputCommandInteraction, voteService: VoteService) {
  const voteId = interaction.options.getString('vote_id', true);
  
  await interaction.deferReply({ ephemeral: true });

  try {
    const analysis = await voteService.getVoteAnalysis(voteId);

    const embed = new EmbedBuilder()
      .setColor('#00ff00')
      .setTitle(`📊 投票分析: ${analysis.vote.title}`)
      .setDescription(`ID: ${voteId}`)
      .addFields(
        {
          name: '📈 回答状況',
          value: [
            `**総部員数**: ${analysis.totalMembers}名`,
            `**回答数**: ${analysis.responseCount}名`,
            `**回答率**: ${analysis.responseRate}%`
          ].join('\n'),
          inline: true,
        },
        {
          name: '⚙️ 設定',
          value: [
            `**匿名**: ${analysis.vote.anonymous ? 'はい' : 'いいえ'}`,
            `**編集可能**: ${analysis.vote.allow_edit ? 'はい' : 'いいえ'}`,
            `**状況**: ${analysis.vote.is_active ? '進行中' : '終了'}`
          ].join('\n'),
          inline: true,
        }
      )
      .setTimestamp();

    // 学年別分析
    const gradeAnalysisText = Object.entries(analysis.gradeAnalysis)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .map(([grade, data]: [string, any]) => `**${grade}年**: ${data.rate.toFixed(1)}% (${data.responded}/${data.total})`)
      .join('\n');

    if (gradeAnalysisText) {
      embed.addFields({
        name: '🎓 学年別回答率',
        value: gradeAnalysisText,
        inline: true,
      });
    }

    // 班別分析（上位5班）
    const teamAnalysisText = Object.entries(analysis.teamAnalysis)
      .sort((a: [string, any], b: [string, any]) => b[1].rate - a[1].rate)
      .slice(0, 5)
      .map(([team, data]: [string, any]) => `**${team}**: ${data.rate.toFixed(1)}% (${data.responded}/${data.total})`)
      .join('\n');

    if (teamAnalysisText) {
      embed.addFields({
        name: '👥 班別回答率（上位5班）',
        value: teamAnalysisText,
        inline: true,
      });
    }

    await interaction.editReply({ embeds: [embed] });
    logCommandUsage(interaction, '投票分析表示', voteId);

  } catch (error) {
    logger.error('投票分析の取得に失敗しました', { error: (error as Error).message });
    await interaction.editReply('投票分析の取得中にエラーが発生しました。');
  }
}