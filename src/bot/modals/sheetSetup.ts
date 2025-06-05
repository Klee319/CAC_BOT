import { ModalSubmitInteraction, EmbedBuilder } from 'discord.js';
import { configManager } from '../../config';
import { GoogleSheetsService } from '../../services/google';
import { logger } from '../../utils/logger';
import { logCommandUsage } from '../../utils/permissions';

export default {
  customId: 'sheet_setup_modal',
  async execute(interaction: ModalSubmitInteraction) {
    const spreadsheetUrl = interaction.fields.getTextInputValue('spreadsheet_url');
    const sheetName = interaction.fields.getTextInputValue('sheet_name');

    await interaction.deferReply({ ephemeral: true });

    try {
      const spreadsheetIdMatch = spreadsheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      
      if (!spreadsheetIdMatch || !spreadsheetIdMatch[1]) {
        await interaction.editReply({
          content: '無効なスプレッドシートURLです。正しい形式のURLを入力してください。',
        });
        return;
      }

      const spreadsheetId = spreadsheetIdMatch[1];

      const sheetsService = new GoogleSheetsService();
      
      try {
        await sheetsService.readSheet(spreadsheetId, `${sheetName}!A1:A1`);
      } catch (error) {
        await interaction.editReply({
          content: `スプレッドシートまたはシートにアクセスできませんでした。\n• URLが正しいか確認してください\n• BOTのサービスアカウントに共有権限があるか確認してください\n• シート名が正しいか確認してください\n\nエラー: ${error.message}`,
        });
        return;
      }

      configManager.updateSheetConfig({
        spreadsheetId,
        sheetName,
      });

      const isValid = await sheetsService.validateSheetStructure(spreadsheetId, sheetName);

      const embed = new EmbedBuilder()
        .setColor(isValid ? '#00ff00' : '#ffaa00')
        .setTitle('📊 Google Sheets 連携設定完了')
        .setDescription('スプレッドシートの連携設定が完了しました。')
        .addFields(
          {
            name: 'スプレッドシートID',
            value: spreadsheetId || '不明',
            inline: false,
          },
          {
            name: 'シート名',
            value: sheetName,
            inline: true,
          },
          {
            name: 'アクセス状況',
            value: '✅ 正常',
            inline: true,
          },
          {
            name: 'ヘッダー構造',
            value: isValid ? '✅ 正常' : '⚠️ 要修正',
            inline: true,
          }
        )
        .setTimestamp();

      if (!isValid) {
        embed.addFields({
          name: '⚠️ 注意',
          value: [
            'シートのヘッダー構造が期待する形式と異なります。',
            '`/sheet create-header` でヘッダーを作成するか、',
            '手動で以下のヘッダーを設定してください：',
            '',
            '名前, Discord表示名, Discordユーザー名, 学籍番号, 性別, 班, 部費納入記録, 学年'
          ].join('\n'),
          inline: false,
        });
      }

      embed.addFields({
        name: '次のステップ',
        value: [
          '• `/sheet validate` でシート構造を確認',
          '• `/sheet sync` で既存データを同期',
          '• `/member register` で部員を登録開始'
        ].join('\n'),
        inline: false,
      });

      await interaction.editReply({ embeds: [embed] });
      
      logger.info('Google Sheets連携が設定されました', {
        spreadsheetId,
        sheetName,
        userId: interaction.user.id,
        isValid,
      });

    } catch (error) {
      logger.error('Google Sheets設定に失敗しました', { 
        error: error.message,
        userId: interaction.user.id,
      });

      await interaction.editReply({
        content: `設定中にエラーが発生しました: ${error.message}`,
      });
    }
  },
};