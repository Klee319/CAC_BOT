import { ModalSubmitInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { FormManager } from '../../services/forms/formManager';
import { logger } from '../../utils/logger';
import { hasAdminRole } from '../../utils/permissions';
import { FormCreateInput, FormModalSubmitData } from '../../types/forms';

export async function handleFormCreateModal(interaction: ModalSubmitInteraction) {
  try {
    // インタラクション状態をチェック
    if (interaction.replied || interaction.deferred) {
      logger.warn('インタラクションは既に処理済みです', { 
        customId: interaction.customId,
        userId: interaction.user.id,
        replied: interaction.replied,
        deferred: interaction.deferred
      });
      return;
    }
    
    // インタラクションの詳細ログ
    const now = Date.now();
    const age = now - interaction.createdTimestamp;
    logger.info('モーダル処理開始', {
      customId: interaction.customId,
      userId: interaction.user.id,
      replied: interaction.replied,
      deferred: interaction.deferred,
      interactionId: interaction.id,
      createdTimestamp: interaction.createdTimestamp,
      ageMs: age,
      isExpired: age > 3000  // 3秒以上経過
    });
    
    // インタラクションの有効期限チェック
    if (age > 2900) { // 2.9秒以上経過している場合は警告
      logger.warn('インタラクションが期限に近づいています', { 
        ageMs: age,
        customId: interaction.customId 
      });
    }
    
    // 最初にdeferReplyを実行
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
  } catch (deferError: any) {
    // deferエラーの詳細ログ
    logger.error('deferReply実行エラー', {
      error: deferError.message,
      code: deferError.code,
      customId: interaction.customId,
      userId: interaction.user.id,
      replied: interaction.replied,
      deferred: interaction.deferred
    });
    
    // 既に応答済みエラーの場合は処理を続行
    if (deferError.code === 10062 || deferError.message?.includes('already been acknowledged')) {
      logger.warn('インタラクションは既に応答済み、処理を続行します');
    } else {
      // その他のエラーは再スロー
      throw deferError;
    }
  }
  
  try {
    // 権限チェック
    if (!hasAdminRole(interaction.member)) {
      await interaction.editReply({
        content: '❌ この機能は管理者のみ利用できます。'
      });
      return;
    }

    // モーダルからデータを取得
    const modalData: FormModalSubmitData = {
      googleFormUrl: interaction.fields.getTextInputValue('google_form_url'),
      deadline: interaction.fields.getTextInputValue('deadline') || undefined,
      targetRoles: interaction.fields.getTextInputValue('target_roles') || undefined,
      isAnonymous: interaction.fields.getTextInputValue('is_anonymous') || 'false',
      allowEdit: interaction.fields.getTextInputValue('allow_edit') || 'true'
    };

    // データを変換
    const formInput: FormCreateInput = {
      googleFormUrl: modalData.googleFormUrl,
      deadline: modalData.deadline,
      targetRoles: modalData.targetRoles,
      isAnonymous: modalData.isAnonymous.toLowerCase() === 'true',
      allowEdit: modalData.allowEdit.toLowerCase() === 'true'
    };

    // バリデーション
    const validation = validateFormInput(formInput);
    if (!validation.isValid) {
      await interaction.editReply({
        content: `❌ 入力エラー: ${validation.errors.join(', ')}`
      });
      return;
    }

    // まず処理開始の応答を送信（3秒以内）
    await interaction.editReply({
      content: '🔄 フォームを作成中です...'
    });

    try {
      // フォーム作成（重い処理）
      const formManager = await FormManager.getInstance(interaction.client);
      const form = await formManager.createForm(formInput, interaction.user.id);

      // 成功メッセージで更新
      const embed = new EmbedBuilder()
        .setTitle('✅ フォームを作成しました')
        .setColor(0x00FF00)
        .addFields([
          { name: 'タイトル', value: form.title },
          { name: 'フォームID', value: form.id },
          { name: '期限', value: form.deadline ? `<t:${Math.floor(form.deadline.getTime() / 1000)}:F>` : '期限なし' },
          { name: '対象者', value: form.targetRoles?.length ? `${form.targetRoles.length}ロール` : '全員' },
          { name: '匿名回答', value: form.isAnonymous ? 'はい' : 'いいえ' },
          { name: '編集許可', value: form.allowEdit ? 'はい' : 'いいえ' },
          { name: '状態', value: '下書き（未公開）' }
        ])
        .setTimestamp();

      await interaction.editReply({
        content: null,
        embeds: [embed]
      });

      logger.info('フォームが作成されました', {
        formId: form.id,
        title: form.title,
        createdBy: interaction.user.id
      });

    } catch (formError: any) {
      // フォーム作成エラーの詳細処理
      let errorMessage = 'フォームの作成に失敗しました';
      
      if (formError instanceof Error) {
        if (formError.message.includes('既に登録されています')) {
          errorMessage = `❌ **重複エラー**\n\n${formError.message}`;
        } else if (formError.message.includes('Google Formsへのアクセス権限が不足')) {
          errorMessage = [
            '❌ **Google Formsアクセス権限エラー**',
            '',
            'フォームにアクセスできません。以下を確認してください：',
            '• フォームの共有設定でBOTサービスアカウントに権限を付与',
            '• Google Cloud ConsoleでGoogle Forms APIが有効',
            '• フォームのURLが正しい',
            '',
            '詳細は `GOOGLE_FORMS_SETUP.md` を参照してください。'
          ].join('\n');
        } else {
          errorMessage = `❌ ${formError.message}`;
        }
      }

      await interaction.editReply({
        content: errorMessage,
        embeds: []
      });
      throw formError; // エラーを再スローして外側のcatchでログに記録
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
      logger.warn('フォーム作成モーダルでインタラクションタイムアウト', {
        error: error.message,
        userId: interaction.user.id,
        age: Date.now() - interaction.createdTimestamp
      });
      return;
    }

    // 内側でフォーム作成エラーが既に処理されている場合はログのみ
    if (error && error.message && (
        error.message.includes('既に登録されています') ||
        error.message.includes('Google Formsへのアクセス権限が不足')
      )) {
      // 既に適切なエラーメッセージが表示されているので、ログのみ記録
      logger.info('フォーム作成エラー（ユーザーに通知済み）', {
        error: error.message,
        userId: interaction.user.id
      });
      return;
    }
    
    // その他の実際のエラーのみログ出力
    logger.error('フォーム作成モーダル処理エラー', error);
    
    let errorMessage = '❌ 予期しないエラーが発生しました';
    
    if (error instanceof Error) {
      errorMessage = `❌ ${error.message}`;
    }
    
    try {
      // インタラクションの状態を再確認してから応答
      if (interaction.replied) {
        await interaction.followUp({
          content: errorMessage,
          flags: MessageFlags.Ephemeral
        });
      } else if (interaction.deferred) {
        await interaction.editReply({
          content: errorMessage
        });
      } else {
        await interaction.reply({
          content: errorMessage,
          flags: MessageFlags.Ephemeral
        });
      }
    } catch (replyError: any) {
      logger.debug('エラー応答の送信に失敗（タイムアウトの可能性）', {
        originalError: error.message,
        replyError: replyError.message,
        customId: interaction.customId,
        userId: interaction.user.id,
        replied: interaction.replied,
        deferred: interaction.deferred
      });
    }
  }
}

// 入力データのバリデーション
function validateFormInput(input: FormCreateInput): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // URL形式チェック
  try {
    const url = new URL(input.googleFormUrl);
    if (!url.hostname.includes('docs.google.com') || !url.pathname.includes('/forms/')) {
      errors.push('有効なGoogle Forms URLではありません');
    }
  } catch {
    errors.push('無効なURL形式です');
  }

  // 期限形式チェック
  if (input.deadline) {
    const datePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
    if (!datePattern.test(input.deadline)) {
      errors.push('期限は YYYY-MM-DD HH:mm 形式で入力してください');
    } else {
      const deadline = new Date(input.deadline);
      if (isNaN(deadline.getTime())) {
        errors.push('無効な日時です');
      } else if (deadline <= new Date()) {
        errors.push('期限は現在時刻より後に設定してください');
      }
    }
  }

  // ロール形式チェック（簡易）
  if (input.targetRoles) {
    const roles = input.targetRoles.split(',').map(r => r.trim()).filter(r => r);
    if (roles.some(role => role.length > 100)) {
      errors.push('ロール名が長すぎます');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}