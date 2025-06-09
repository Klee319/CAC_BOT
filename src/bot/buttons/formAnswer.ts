import { ButtonInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { FormManager } from '../../services/forms/formManager';
import { DatabaseService } from '../../services/database';
import { logger } from '../../utils/logger';
import { FormErrorCode } from '../../types/forms';
import { hasAdminRole } from '../../utils/permissions';

export async function handleFormAnswerButton(interaction: ButtonInteraction) {
  try {
    // インタラクションの年齢チェック
    const age = Date.now() - interaction.createdTimestamp;
    if (age > 2500) { // 2.5秒以上経過している場合はタイムアウトリスク
      logger.warn('回答ボタンがタイムアウトリスクありのためスキップ', {
        ageMs: age,
        customId: interaction.customId,
        userId: interaction.user.id
      });
      return;
    }

    const formId = interaction.customId.replace('form_answer_', '');
    const userId = interaction.user.id;
    const member = interaction.member;

    if (!member) {
      await interaction.reply({
        content: '❌ メンバー情報を取得できませんでした。',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // 早期defer実行
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // FormManager取得（内部でDB初期化も実行される）
    const formManager = await FormManager.getInstance(interaction.client);
    const db = await DatabaseService.getInstance();
    
    // FormManager.getInstance()で既にDB初期化済みのため、重複実行を回避

    // フォームの存在確認（削除済みチェック）
    const form = await db.getFormById(formId);
    if (!form) {
      await interaction.editReply({
        content: '❌ このフォームは削除されているか、存在しません。'
      });
      return;
    }

    // ユーザーのロールを取得
    const userRoles = Array.isArray(member.roles) 
      ? member.roles 
      : member.roles.cache.map(role => role.id);

    // 回答可能かチェック
    const canRespond = await formManager.canUserRespond(formId, userId, userRoles);
    
    if (!canRespond.canRespond) {
      const errorMessage = getErrorMessage(canRespond.reason);
      await interaction.editReply({
        content: `❌ ${errorMessage}`
      });
      return;
    }

    // メンバー情報を取得
    const memberData = await db.getMemberByDiscordId(userId);
    if (!memberData) {
      await interaction.editReply({
        content: '❌ メンバー登録が必要です。先に部員登録を完了してください。'
      });
      return;
    }

    // Google FormsのプリフィルURLを直接生成（JWT認証なし）
    const formUrl = await formManager.generateDirectFormUrl(formId, userId, {
      name: memberData.name,
      discordDisplayName: memberData.discord_display_name,
      discordUsername: memberData.discord_username,
      studentId: memberData.student_id,
      gender: memberData.gender,
      team: memberData.team,
      membershipFeeRecord: memberData.membership_fee_record,
      grade: memberData.grade
    });

    // 成功メッセージ
    const embed = new EmbedBuilder()
      .setTitle('📝 フォーム回答へのアクセス')
      .setDescription('以下のリンクからフォームに回答してください。')
      .setColor(0x0099FF)
      .addFields([
        {
          name: '⚠️ 注意事項',
          value: [
            '• 名前、学籍番号、Discordユーザー名は自動入力されます',
            '• 回答内容がメンバー情報と紐付けられます',
            '• 期限に注意してください'
          ].join('\n')
        },
        {
          name: '🔗 回答リンク',
          value: `[こちらからフォームに回答](${formUrl})`
        }
      ])
      .setFooter({ text: 'このリンクには個人情報が含まれています' })
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed]
    });

    logger.info('フォーム回答用URLを生成しました', {
      formId,
      userId,
      memberName: memberData.name
    });

  } catch (error) {
    // Discord APIの既知エラーをフィルタリング
    const isDiscordTimeoutError = error instanceof Error && (
      error.message.includes('Unknown interaction') ||
      error.message.includes('Interaction has already been acknowledged') ||
      error.message.includes('The reply to this interaction has not been sent or deferred')
    );

    if (isDiscordTimeoutError) {
      // タイムアウトエラーは警告レベルでログ出力（詳細なスタックトレースは出力しない）
      logger.warn('フォーム回答ボタンでインタラクションタイムアウト', {
        error: error.message,
        formId: interaction.customId.replace('form_answer_', ''),
        userId: interaction.user.id,
        age: Date.now() - interaction.createdTimestamp
      });
      return; // ユーザーへのエラー応答は送信しない
    }

    // その他の実際のエラーのみログ出力
    logger.error('フォーム回答ボタン処理エラー', error);
    
    const errorMessage = error instanceof Error ? error.message : 'エラーが発生しました';
    
    try {
      if (interaction.deferred) {
        await interaction.editReply({
          content: `❌ ${errorMessage}`
        });
      } else if (!interaction.replied) {
        await interaction.reply({
          content: `❌ ${errorMessage}`,
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (replyError) {
      // 応答エラーも抑制
      logger.debug('エラー応答の送信に失敗（タイムアウトの可能性）', {
        originalError: error.message,
        replyError: replyError.message
      });
    }
  }
}

export async function handleFormStatusButton(interaction: ButtonInteraction) {
  try {
    // インタラクションの年齢チェック
    const age = Date.now() - interaction.createdTimestamp;
    if (age > 2500) { // 2.5秒以上経過している場合はタイムアウトリスク
      logger.warn('状況確認ボタンがタイムアウトリスクありのためスキップ', {
        ageMs: age,
        customId: interaction.customId,
        userId: interaction.user.id
      });
      return;
    }

    const formId = interaction.customId.replace('form_status_', '');
    const userId = interaction.user.id;

    // 早期defer実行
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // FormManager取得（内部でDB初期化も実行される）
    const formManager = await FormManager.getInstance(interaction.client);
    const db = await DatabaseService.getInstance();
    
    // FormManager.getInstance()で既にDB初期化済みのため、重複実行を回避

    // フォーム情報を取得
    const form = await db.getFormById(formId);
    if (!form) {
      await interaction.editReply({
        content: '❌ フォームが見つかりません。'
      });
      return;
    }

    // 統計情報を取得
    const stats = await formManager.getFormStatistics(formId);
    
    // ユーザーの回答状況を確認
    const hasResponded = await db.hasUserResponded(formId, userId);

    const embed = new EmbedBuilder()
      .setTitle(`📊 ${form.title} - 回答状況`)
      .setColor(0x0099FF)
      .addFields([
        {
          name: '📈 全体統計',
          value: [
            `回答数: ${stats.totalResponses}/${stats.totalTargets}人`,
            `回答率: ${stats.responseRate.toFixed(1)}%`,
            `期限: ${form.deadline ? `<t:${Math.floor(new Date(form.deadline).getTime() / 1000)}:R>` : '期限なし'}`
          ].join('\n'),
          inline: false
        },
        {
          name: '👤 あなたの状況',
          value: hasResponded ? '✅ 回答済み' : '❌ 未回答',
          inline: true
        },
        {
          name: '📅 最終回答',
          value: stats.lastResponseAt 
            ? `<t:${Math.floor(stats.lastResponseAt.getTime() / 1000)}:R>`
            : 'まだ回答がありません',
          inline: true
        }
      ])
      .setTimestamp();

    await interaction.editReply({
      embeds: [embed]
    });

  } catch (error) {
    // Discord APIの既知エラーをフィルタリング
    const isDiscordTimeoutError = error instanceof Error && (
      error.message.includes('Unknown interaction') ||
      error.message.includes('Interaction has already been acknowledged') ||
      error.message.includes('The reply to this interaction has not been sent or deferred')
    );

    if (isDiscordTimeoutError) {
      // タイムアウトエラーは警告レベルでログ出力
      logger.warn('フォーム状況確認ボタンでインタラクションタイムアウト', {
        error: error.message,
        formId: interaction.customId.replace('form_status_', ''),
        userId: interaction.user.id,
        age: Date.now() - interaction.createdTimestamp
      });
      return;
    }

    // その他の実際のエラーのみログ出力
    logger.error('フォーム状況確認ボタン処理エラー', error);
    
    const errorMessage = error instanceof Error ? error.message : 'エラーが発生しました';
    
    try {
      if (interaction.deferred) {
        await interaction.editReply({
          content: `❌ ${errorMessage}`
        });
      } else if (!interaction.replied) {
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

function getErrorMessage(reason?: FormErrorCode): string {
  switch (reason) {
    case FormErrorCode.FORM_NOT_FOUND:
      return 'フォームが見つからないか、公開されていません。';
    case FormErrorCode.ALREADY_RESPONDED:
      return 'このフォームには既に回答済みです。編集は許可されていません。';
    case FormErrorCode.DEADLINE_PASSED:
      return 'フォームの回答期限が過ぎています。';
    case FormErrorCode.NOT_AUTHORIZED:
      return 'このフォームに回答する権限がありません。';
    case FormErrorCode.TOKEN_EXPIRED:
      return '認証トークンの有効期限が切れています。';
    case FormErrorCode.API_LIMIT_EXCEEDED:
      return 'API制限に達しました。しばらく時間を置いてから再試行してください。';
    default:
      return '回答できない状態です。';
  }
}

export async function handleFormDeleteConfirmButton(interaction: ButtonInteraction) {
  try {
    // インタラクションの年齢チェック
    const age = Date.now() - interaction.createdTimestamp;
    if (age > 2500) { // 2.5秒以上経過している場合はタイムアウトリスク
      logger.warn('削除確認ボタンがタイムアウトリスクありのためスキップ', {
        ageMs: age,
        customId: interaction.customId,
        userId: interaction.user.id
      });
      return;
    }

    const formId = interaction.customId.replace('form_delete_confirm_', '');

    if (!hasAdminRole(interaction.member)) {
      await interaction.reply({
        content: '❌ この機能は管理者のみ利用できます。',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // 早期defer実行
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // FormManager取得（内部でDB初期化も実行される）
    const formManager = await FormManager.getInstance(interaction.client);
    
    // フォームの存在確認
    const db = await DatabaseService.getInstance();
    // FormManager.getInstance()で既にDB初期化済みのため、重複実行を回避
    const existingForm = await db.getFormById(formId);
    if (!existingForm) {
      await interaction.editReply({
        content: '❌ フォームは既に削除されています。'
      });
      return;
    }
    
    // フォーム削除実行
    await formManager.deleteForm(formId);

    await interaction.editReply({
      content: '✅ フォームを削除しました。'
    });

    // 元のメッセージも更新（エラーハンドリング付き）
    try {
      await interaction.message.edit({
        content: '🗑️ このフォームは削除されました。',
        embeds: [],
        components: []
      });
    } catch (messageError: any) {
      logger.warn('元のメッセージの更新に失敗しました（メッセージが既に削除済みの可能性）', {
        error: messageError.message,
        code: messageError.code,
        formId
      });
    }

    logger.info('フォームを削除しました', {
      formId,
      userId: interaction.user.id,
      userName: interaction.user.username
    });

  } catch (error) {
    // Discord APIの既知エラーをフィルタリング
    const isDiscordTimeoutError = error instanceof Error && (
      error.message.includes('Unknown interaction') ||
      error.message.includes('Interaction has already been acknowledged') ||
      error.message.includes('The reply to this interaction has not been sent or deferred')
    );

    if (isDiscordTimeoutError) {
      // タイムアウトエラーは警告レベルでログ出力
      logger.warn('フォーム削除確認ボタンでインタラクションタイムアウト', {
        error: error.message,
        formId: interaction.customId.replace('form_delete_confirm_', ''),
        userId: interaction.user.id,
        age: Date.now() - interaction.createdTimestamp
      });
      return;
    }

    // その他の実際のエラーのみログ出力
    logger.error('フォーム削除確認ボタン処理エラー', error);
    
    const errorMessage = error instanceof Error ? error.message : 'フォーム削除に失敗しました';
    
    try {
      if (interaction.deferred) {
        await interaction.editReply({
          content: `❌ ${errorMessage}`
        });
      } else if (!interaction.replied) {
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