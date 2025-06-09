import {
  SlashCommandBuilder,
  CommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ComponentType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
  MessageFlags
} from 'discord.js';
import { FormManager } from '../../services/forms/formManager';
import { DatabaseService } from '../../services/database';
import { logger } from '../../utils/logger';
import { hasAdminRole } from '../../utils/permissions';
import { FormCreateInput, FormModalSubmitData } from '../../types/forms';

const formCommand = {
  data: new SlashCommandBuilder()
    .setName('form')
    .setDescription('フォーム管理')
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('新しいフォームを作成'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('delete')
        .setDescription('フォームを削除'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('edit')
        .setDescription('フォームを編集'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('publish')
        .setDescription('フォームを公開'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('フォームの状況確認'))
    .addSubcommand(subcommand =>
      subcommand
        .setName('my')
        .setDescription('自分が対象のフォーム一覧')),

  async execute(interaction: CommandInteraction) {
    const subcommand = (interaction.options as any).getSubcommand();
    
    try {
      switch (subcommand) {
        case 'create':
          // createコマンドはモーダル表示のためFormManager初期化を後回し
          await handleFormCreate(interaction);
          break;
        case 'delete':
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const formManager1 = await FormManager.getInstance(interaction.client);
          await handleFormDelete(interaction, formManager1);
          break;
        case 'edit':
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const formManager2 = await FormManager.getInstance(interaction.client);
          await handleFormEdit(interaction, formManager2);
          break;
        case 'publish':
          // インタラクションの年齢チェック
          const publishAge = Date.now() - interaction.createdTimestamp;
          if (publishAge > 2500) {
            logger.warn('form publishコマンドがタイムアウトリスクありのためスキップ', {
              ageMs: publishAge,
              userId: interaction.user.id
            });
            return;
          }
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const formManager3 = await FormManager.getInstance(interaction.client);
          await handleFormPublish(interaction, formManager3);
          break;
        case 'status':
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const formManager4 = await FormManager.getInstance(interaction.client);
          await handleFormStatus(interaction, formManager4);
          break;
        case 'my':
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const formManager5 = await FormManager.getInstance(interaction.client);
          await handleFormMy(interaction, formManager5);
          break;
        default:
          await interaction.reply({
            content: '無効なサブコマンドです。',
            flags: MessageFlags.Ephemeral
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
        logger.warn('formコマンドでインタラクションタイムアウト', {
          error: error.message,
          subcommand,
          userId: interaction.user.id,
          age: Date.now() - interaction.createdTimestamp
        });
        return;
      }

      // その他の実際のエラーのみログ出力
      logger.error('Form command error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        subcommand,
        userId: interaction.user.id
      });
      
      const errorMessage = error instanceof Error ? error.message : 'エラーが発生しました';
      
      try {
        if (interaction.replied) {
          await interaction.followUp({
            content: `❌ ${errorMessage}`,
            flags: MessageFlags.Ephemeral
          });
        } else if (interaction.deferred) {
          await interaction.editReply({
            content: `❌ ${errorMessage}`
          });
        } else {
          await interaction.reply({
            content: `❌ ${errorMessage}`,
            flags: MessageFlags.Ephemeral
          });
        }
      } catch (replyError) {
        logger.error('エラー応答の送信に失敗', replyError);
      }
    }
  },
};

// フォーム作成
async function handleFormCreate(interaction: CommandInteraction) {
  try {
    // インタラクションの年齢チェック
    const age = Date.now() - interaction.createdTimestamp;
    if (age > 2500) { // 2.5秒以上経過している場合はタイムアウトリスク
      logger.warn('form createコマンドがタイムアウトリスクありのためスキップ', {
        ageMs: age,
        userId: interaction.user.id
      });
      return;
    }

    if (!hasAdminRole(interaction.member)) {
      await interaction.reply({
        content: '❌ この機能は管理者のみ利用できます。',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // モーダルを効率的に構築
    const modal = new ModalBuilder()
      .setCustomId('form_create_modal')
      .setTitle('フォーム作成')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('google_form_url')
            .setLabel('Google Forms URL')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://docs.google.com/forms/d/...')
            .setRequired(true)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('deadline')
            .setLabel('回答期限 (YYYY-MM-DD HH:mm)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('2024-12-31 23:59')
            .setRequired(false)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('target_roles')
            .setLabel('対象ロール (カンマ区切り、空白は全員)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('@role1, @role2')
            .setRequired(false)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('is_anonymous')
            .setLabel('匿名回答 (true/false)')
            .setStyle(TextInputStyle.Short)
            .setValue('false')
            .setRequired(false)
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('allow_edit')
            .setLabel('編集許可 (true/false)')
            .setStyle(TextInputStyle.Short)
            .setValue('true')
            .setRequired(false)
        )
      );

    await interaction.showModal(modal);
    
  } catch (error) {
    // Discord APIの既知エラーをフィルタリング
    const isDiscordTimeoutError = error instanceof Error && (
      error.message.includes('Unknown interaction') ||
      error.message.includes('Interaction has already been acknowledged') ||
      error.message.includes('The reply to this interaction has not been sent or deferred')
    );

    if (isDiscordTimeoutError) {
      // タイムアウトエラーは警告レベルでログ出力
      logger.warn('form createコマンドでインタラクションタイムアウト', {
        error: error.message,
        userId: interaction.user.id,
        age: Date.now() - interaction.createdTimestamp
      });
      return; // モーダルが表示されている可能性があるため応答しない
    }

    // その他の実際のエラーのみログ出力
    logger.error('フォーム作成モーダル表示エラー', error);
    
    // その他のエラーの場合のみ応答を試行
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ フォーム作成画面の表示に失敗しました。もう一度お試しください。',
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

// フォーム削除
async function handleFormDelete(
  interaction: CommandInteraction,
  formManager: FormManager
) {
  if (!hasAdminRole(interaction.member)) {
    await interaction.editReply({
      content: '❌ この機能は管理者のみ利用できます。'
    });
    return;
  }

  const forms = await formManager.getAllForms();
  
  if (forms.length === 0) {
    await interaction.editReply({
      content: '削除可能なフォームがありません。'
    });
    return;
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('form_delete_select')
    .setPlaceholder('削除するフォームを選択')
    .addOptions(
      forms.slice(0, 25).map(form => ({
        label: form.title,
        value: form.id,
        description: `回答数: ${form.responseCount}/${form.targetCount}`
      }))
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  await interaction.editReply({
    content: '削除するフォームを選択してください：',
    components: [row]
  });
}

// フォーム編集
async function handleFormEdit(
  interaction: CommandInteraction,
  formManager: FormManager
) {
  if (!hasAdminRole(interaction.member)) {
    await interaction.editReply({
      content: '❌ この機能は管理者のみ利用できます。'
    });
    return;
  }

  const forms = await formManager.getAllForms();
  
  if (forms.length === 0) {
    await interaction.editReply({
      content: '編集可能なフォームがありません。'
    });
    return;
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('form_edit_select')
    .setPlaceholder('編集するフォームを選択')
    .addOptions(
      forms.slice(0, 25).map(form => ({
        label: form.title,
        value: form.id,
        description: `状態: ${form.state}`
      }))
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  await interaction.editReply({
    content: '編集するフォームを選択してください：',
    components: [row]
  });
}

// フォーム公開
async function handleFormPublish(
  interaction: CommandInteraction,
  formManager: FormManager
) {
  if (!hasAdminRole(interaction.member)) {
    await interaction.editReply({
      content: '❌ この機能は管理者のみ利用できます。'
    });
    return;
  }

  // 未公開フォームを取得
  const allForms = await formManager.getAllForms();
  const draftForms = allForms.filter(form => form.state === 'draft');
  
  if (draftForms.length === 0) {
    await interaction.editReply({
      content: '公開可能なフォームがありません。'
    });
    return;
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('form_publish_select')
    .setPlaceholder('公開するフォームを選択')
    .addOptions(
      draftForms.slice(0, 25).map(form => ({
        label: form.title,
        value: form.id,
        description: form.state || '説明なし'
      }))
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  await interaction.editReply({
    content: '公開するフォームを選択してください：',
    components: [row]
  });
}

// フォーム状況確認
async function handleFormStatus(
  interaction: CommandInteraction,
  formManager: FormManager
) {
  if (!hasAdminRole(interaction.member)) {
    await interaction.editReply({
      content: '❌ この機能は管理者のみ利用できます。'
    });
    return;
  }

  const forms = await formManager.getAllForms();
  
  if (forms.length === 0) {
    await interaction.editReply({
      content: '確認可能なフォームがありません。'
    });
    return;
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('form_status_select')
    .setPlaceholder('状況を確認するフォームを選択')
    .addOptions(
      forms.slice(0, 25).map(form => {
        const responseRate = form.targetCount > 0 
          ? Math.round((form.responseCount/form.targetCount)*100) 
          : 0;
        return {
          label: form.title,
          value: form.id,
          description: `回答率: ${responseRate}% (${form.responseCount}/${form.targetCount}名)`
        };
      })
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  await interaction.editReply({
    content: '状況を確認するフォームを選択してください：',
    components: [row]
  });
}

// 自分のフォーム一覧
async function handleFormMy(
  interaction: CommandInteraction,
  formManager: FormManager
) {
  const userId = interaction.user.id;
  const member = interaction.member;
  
  if (!member) {
    await interaction.editReply({
      content: '❌ メンバー情報を取得できませんでした。'
    });
    return;
  }

  const userRoles = Array.isArray(member.roles) 
    ? member.roles 
    : member.roles.cache.map(role => role.id);

  const forms = await formManager.getActiveForms(userId);
  
  // ユーザーが対象のフォームのみフィルタリング
  const userForms = [];
  for (const form of forms) {
    if (!form.targetRoles || form.targetRoles.length === 0) {
      // 全員対象
      userForms.push(form);
    } else {
      // 特定ロール対象
      const hasRole = form.targetRoles.some(roleId => userRoles.includes(roleId));
      if (hasRole) {
        userForms.push(form);
      }
    }
  }

  if (userForms.length === 0) {
    await interaction.editReply({
      content: '現在、あなたが対象のアクティブなフォームはありません。'
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('📋 あなたが対象のフォーム一覧')
    .setColor(0x0099FF)
    .setTimestamp();

  for (const form of userForms.slice(0, 10)) {
    const status = form.hasResponded ? '✅ 回答済み' : '❌ 未回答';
    const deadline = form.deadline 
      ? `<t:${Math.floor(form.deadline.getTime() / 1000)}:R>`
      : '期限なし';

    embed.addFields({
      name: form.title,
      value: `${status} | 期限: ${deadline}`,
      inline: false
    });
  }

  if (userForms.length > 0) {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('form_my_select')
      .setPlaceholder('回答するフォームを選択')
      .addOptions(
        userForms.slice(0, 25).map(form => ({
          label: form.title,
          value: form.id,
          description: form.hasResponded ? '回答済み' : '未回答',
          emoji: form.hasResponded ? '✅' : '📝'
        }))
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

    await interaction.editReply({
      embeds: [embed],
      components: [row]
    });
  } else {
    await interaction.editReply({
      embeds: [embed]
    });
  }
}

export default formCommand;