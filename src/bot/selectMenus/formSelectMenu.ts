import { StringSelectMenuInteraction, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { FormManager } from '../../services/forms/formManager';
import { DatabaseService } from '../../services/database';
import { logger } from '../../utils/logger';
import { hasAdminRole } from '../../utils/permissions';
import { handleFormAnswerButton } from '../buttons/formAnswer';

export async function handleFormSelectMenu(interaction: StringSelectMenuInteraction) {
  try {
    // インタラクションの年齢チェック
    const age = Date.now() - interaction.createdTimestamp;
    if (age > 2500) { // 2.5秒以上経過している場合はタイムアウトリスク
      logger.warn('セレクトメニューがタイムアウトリスクありのためスキップ', {
        ageMs: age,
        customId: interaction.customId,
        userId: interaction.user.id
      });
      return;
    }

    // 最初にdeferReplyを確実に実行
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
    
    const formManager = await FormManager.getInstance(interaction.client);
    const selectedValue = interaction.values[0];

    switch (interaction.customId) {
      case 'form_delete_select':
        await handleFormDeleteSelect(interaction, formManager, selectedValue);
        break;
      case 'form_edit_select':
        await handleFormEditSelect(interaction, formManager, selectedValue);
        break;
      case 'form_publish_select':
        await handleFormPublishSelect(interaction, formManager, selectedValue);
        break;
      case 'form_status_select':
        await handleFormStatusSelect(interaction, formManager, selectedValue);
        break;
      case 'form_my_select':
        await handleFormMySelect(interaction, formManager, selectedValue);
        break;
      default:
        await interaction.editReply({
          content: '❌ 不明な操作です。'
        });
    }
  } catch (error) {
    // Discord APIの既知エラーをフィルタリング
    const isDiscordTimeoutError = error instanceof Error && (
      error.message.includes('Unknown interaction') ||
      error.message.includes('Interaction has already been acknowledged') ||
      error.message.includes('The reply to this interaction has not been sent or deferred')
    );

    if (isDiscordTimeoutError) {
      // タイムアウトエラーは警告レベルでログ出力
      logger.warn('フォームセレクトメニューでインタラクションタイムアウト', {
        error: error.message,
        customId: interaction.customId,
        userId: interaction.user.id,
        age: Date.now() - interaction.createdTimestamp
      });
      return;
    }

    // その他の実際のエラーのみログ出力
    logger.error('フォームセレクトメニュー処理エラー', error);
    
    const errorMessage = error instanceof Error ? error.message : 'エラーが発生しました';
    
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: `❌ ${errorMessage}`,
          flags: MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: `❌ ${errorMessage}`,
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (replyError) {
      logger.debug('エラー応答の送信に失敗（タイムアウトの可能性）', {
        originalError: error.message,
        replyError: replyError.message
      });
    }
  }
}

// フォーム削除確認
async function handleFormDeleteSelect(
  interaction: StringSelectMenuInteraction,
  formManager: FormManager,
  formId: string
) {
  if (!hasAdminRole(interaction.member)) {
    await interaction.editReply({
      content: '❌ この機能は管理者のみ利用できます。'
    });
    return;
  }

  const form = await formManager.getFormById(formId);
  
  if (!form) {
    await interaction.editReply({
      content: '❌ フォームが見つかりません。'
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('⚠️ フォーム削除確認')
    .setDescription('以下のフォームを削除してもよろしいですか？')
    .setColor(0xFF0000)
    .addFields([
      { name: 'タイトル', value: form.title },
      { name: 'ID', value: form.id },
      { name: '状態', value: form.state },
      { name: '⚠️ 注意', value: 'この操作は取り消せません。\n回答データも全て削除されます。' }
    ])
    .setTimestamp();

  const confirmButton = new ButtonBuilder()
    .setCustomId(`form_delete_confirm_${formId}`)
    .setLabel('削除する')
    .setStyle(ButtonStyle.Danger);

  const cancelButton = new ButtonBuilder()
    .setCustomId('form_delete_cancel')
    .setLabel('キャンセル')
    .setStyle(ButtonStyle.Secondary);

  const row = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(confirmButton, cancelButton);

  await interaction.editReply({
    embeds: [embed],
    components: [row]
  });
}

// フォーム編集
async function handleFormEditSelect(
  interaction: StringSelectMenuInteraction,
  formManager: FormManager,
  formId: string
) {
  if (!hasAdminRole(interaction.member)) {
    await interaction.editReply({
      content: '❌ この機能は管理者のみ利用できます。'
    });
    return;
  }

  await interaction.editReply({
    content: '📝 フォーム編集機能は実装中です。現在は期限の変更のみサポートしています。'
  });
}

// フォーム公開
async function handleFormPublishSelect(
  interaction: StringSelectMenuInteraction,
  formManager: FormManager,
  formId: string
) {
  try {
    if (!hasAdminRole(interaction.member)) {
      await interaction.editReply({
        content: '❌ この機能は管理者のみ利用できます。'
      });
      return;
    }

    const form = await formManager.getFormById(formId);
    
    if (!form) {
      await interaction.editReply({
        content: '❌ フォームが見つかりません。'
      });
      return;
    }

    // フォームを公開
    await formManager.publishForm(formId);

    // 回答パネルを作成
    const embed = createFormPanelEmbed(form);
    const buttons = createFormButtons(formId);

    // チャンネルに投稿（現在のチャンネル）
    const channel = interaction.channel;
    if (!channel?.isTextBased()) {
      await interaction.editReply({
        content: '❌ このチャンネルにはメッセージを投稿できません。'
      });
      return;
    }

    const message = await channel.send({
      embeds: [embed],
      components: [buttons]
    });

    // メッセージIDを保存（FormManagerに移譲する必要がある）
    await formManager.setFormMessage(formId, message.id, channel.id);

    await interaction.editReply({
      content: `✅ フォーム「${form.title}」を公開しました。`
    });

    logger.info('フォームを公開しました', {
      formId,
      title: form.title,
      channelId: channel.id,
      messageId: message.id
    });

  } catch (error) {
    await interaction.editReply({
      content: `❌ フォームの公開に失敗しました: ${error.message}`
    });
  }
}

// フォーム状況確認
async function handleFormStatusSelect(
  interaction: StringSelectMenuInteraction,
  formManager: FormManager,
  formId: string
) {
  try {
    if (!hasAdminRole(interaction.member)) {
      await interaction.editReply({
        content: '❌ この機能は管理者のみ利用できます。'
      });
      return;
    }

    const form = await formManager.getFormById(formId);
    
    if (!form) {
      await interaction.editReply({
        content: '❌ フォームが見つかりません。'
      });
      return;
    }

    const stats = await formManager.getFormStatistics(formId);
    // FormManagerから応答データも取得できるようにする必要がある
    const responses = await formManager.getFormResponses(formId);

    const embed = new EmbedBuilder()
      .setTitle(`📊 ${form.title} - 詳細状況`)
      .setColor(0x0099FF)
      .addFields([
        {
          name: '📈 統計情報',
          value: [
            `回答数: ${stats.totalResponses}/${stats.totalTargets}人`,
            `回答率: ${stats.responseRate.toFixed(1)}%`,
            `状態: ${form.state}`,
            `期限: ${form.deadline ? `<t:${Math.floor(new Date(form.deadline).getTime() / 1000)}:F>` : '期限なし'}`
          ].join('\n'),
          inline: false
        },
        {
          name: '⚙️ 設定',
          value: [
            `匿名回答: ${form.is_anonymous ? 'はい' : 'いいえ'}`,
            `編集許可: ${form.allow_edit ? 'はい' : 'いいえ'}`,
            `対象者: ${form.target_roles?.length ? `${form.target_roles.length}ロール` : '全員'}`
          ].join('\n'),
          inline: true
        },
        {
          name: '📅 最終活動',
          value: stats.lastResponseAt 
            ? `<t:${Math.floor(stats.lastResponseAt.getTime() / 1000)}:R>`
            : 'まだ回答がありません',
          inline: true
        }
      ])
      .setTimestamp();

    if (responses.length > 0) {
      const recentResponses = responses.slice(0, 5).map(resp => 
        `<t:${Math.floor(new Date(resp.responded_at).getTime() / 1000)}:R>`
      ).join('\n');

      embed.addFields({
        name: '🕒 最近の回答',
        value: recentResponses,
        inline: false
      });
    }

    await interaction.editReply({
      embeds: [embed]
    });

  } catch (error) {
    await interaction.editReply({
      content: `❌ 状況確認に失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`
    });
  }
}

// 自分のフォーム選択（回答）
async function handleFormMySelect(
  interaction: StringSelectMenuInteraction,
  formManager: FormManager,
  formId: string
) {
  // フォーム回答ボタンと同じ処理を実行
  const fakeButtonInteraction = {
    ...interaction,
    customId: `form_answer_${formId}`
  };

  await handleFormAnswerButton(fakeButtonInteraction as any);
}

// フォームパネルのEmbed作成
function createFormPanelEmbed(form: any): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`📋 ${form.title}`)
    .setDescription(form.description || 'アンケートにご協力ください')
    .setColor(getColorByState(form.state))
    .addFields([
      {
        name: '📅 回答期限',
        value: form.deadline 
          ? `<t:${Math.floor(new Date(form.deadline).getTime() / 1000)}:F>`
          : '期限なし',
        inline: true
      },
      {
        name: '👥 対象者',
        value: form.target_roles?.length 
          ? `${form.target_roles.length}個のロール`
          : '全員',
        inline: true
      },
      {
        name: '⚙️ 設定',
        value: [
          form.is_anonymous ? '🔒 匿名回答' : '👤 記名回答',
          form.allow_edit ? '✏️ 編集可能' : '🔒 編集不可'
        ].join('\n'),
        inline: true
      }
    ])
    .setFooter({ text: 'Discord経由の認証が必要です' })
    .setTimestamp();
    
  return embed;
}

// フォームボタン作成
function createFormButtons(formId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`form_answer_${formId}`)
        .setLabel('回答する')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📝'),
      new ButtonBuilder()
        .setCustomId(`form_status_${formId}`)
        .setLabel('回答状況')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('📊')
    );
}

function getColorByState(state: string): number {
  switch (state) {
    case 'draft': return 0x95a5a6;     // グレー
    case 'published': return 0x27ae60;  // グリーン
    case 'expired': return 0xe74c3c;    // レッド
    default: return 0x3498db;           // ブルー
  }
}