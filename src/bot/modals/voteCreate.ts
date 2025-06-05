import { ModalSubmitInteraction, EmbedBuilder } from 'discord.js';
import { DatabaseService } from '../../services/database';
import { VoteService } from '../../services/vote';
import { GoogleFormsService } from '../../services/google/forms';
import { logger } from '../../utils/logger';
import { logCommandUsage } from '../../utils/permissions';
import { Vote } from '../../types';

export default {
  customId: 'vote_create_modal',
  async execute(interaction: ModalSubmitInteraction) {
    const title = interaction.fields.getTextInputValue('vote_title');
    const description = interaction.fields.getTextInputValue('vote_description') || '';
    const formUrl = interaction.fields.getTextInputValue('form_url') || '';
    const deadlineStr = interaction.fields.getTextInputValue('deadline');
    const optionsStr = interaction.fields.getTextInputValue('options') || '';

    await interaction.deferReply();

    try {
      // 期限の解析
      const deadline = parseDeadline(deadlineStr);
      if (!deadline) {
        await interaction.editReply({
          content: '無効な期限形式です。正しい形式: YYYY-MM-DD HH:MM（例: 2024-12-31 23:59）',
        });
        return;
      }

      if (deadline <= new Date()) {
        await interaction.editReply({
          content: '期限は現在時刻より後に設定してください。',
        });
        return;
      }

      // Google FormsのURL検証
      if (formUrl && !isValidGoogleFormsUrl(formUrl)) {
        await interaction.editReply({
          content: '無効なGoogle FormsのURLです。正しいURLを入力してください。',
        });
        return;
      }

      // 投票データの作成
      const voteId = generateVoteId();
      const vote: Vote = {
        id: voteId,
        title,
        description,
        formUrl,
        deadline,
        createdBy: interaction.user.id,
        createdAt: new Date(),
        isActive: true,
        allowEdit: true,
        anonymous: false,
        responses: [],
      };

      // データベースに保存
      const db = new DatabaseService();
      await db.initialize();
      
      const voteService = new VoteService(db);
      
      try {
        await db.insertVote(vote);

        // Google FormsのURLがある場合、Discord UIに変換を試行
        let discordVoteData = null;
        if (formUrl) {
          try {
            discordVoteData = await voteService.convertFormsToDiscord(formUrl);
            if (discordVoteData) {
              logger.info('Google FormsをDiscord UIに変換しました', { voteId, formUrl });
            }
          } catch (error) {
            logger.warn('Google Formsの変換に失敗しました', { 
              voteId, 
              formUrl, 
              error: error instanceof Error ? error.message : 'Unknown error' 
            });
          }
        }
        
        // 選択肢がある場合は別途処理（現在は簡易実装）
        if (optionsStr && !formUrl) {
          const options = optionsStr.split('\n').filter(opt => opt.trim());
          if (options.length > 0) {
            // シンプルな選択肢投票として保存
            await db.insertVoteResponse(voteId, 'system', { 
              type: 'options', 
              options: options 
            });
          }
        }

        const embed = new EmbedBuilder()
          .setColor('#00ff00')
          .setTitle('✅ 投票作成完了')
          .setDescription(`「${title}」の投票を作成しました。`)
          .addFields(
            {
              name: '投票ID',
              value: voteId,
              inline: true,
            },
            {
              name: '回答期限',
              value: `<t:${Math.floor(deadline.getTime() / 1000)}:F>`,
              inline: true,
            },
            {
              name: '投票形式',
              value: formUrl ? 'Google Forms連携' : '選択肢投票',
              inline: true,
            }
          )
          .setTimestamp();

        if (description) {
          embed.addFields({
            name: '説明',
            value: description,
            inline: false,
          });
        }

        if (formUrl) {
          embed.addFields({
            name: '📋 Google Forms',
            value: `[こちらから回答してください](${formUrl})`,
            inline: false,
          });
          
          // Discord UIが利用可能な場合の案内
          if (discordVoteData) {
            embed.addFields({
              name: '🎮 Discord上での回答',
              value: 'このフォームはDiscord上でも回答できるように変換されました。',
              inline: false,
            });
          }
        } else if (optionsStr) {
          const options = optionsStr.split('\n').filter(opt => opt.trim());
          if (options.length > 0) {
            embed.addFields({
              name: '選択肢',
              value: options.map((opt, i) => `${i + 1}. ${opt}`).join('\n'),
              inline: false,
            });
          }
        }

        embed.addFields({
          name: '📝 投票参加方法',
          value: [
            `\`/vote response ${voteId}\` - 回答状況確認`,
            `\`/vote list\` - 進行中の投票一覧`,
            formUrl ? 'Google Formsから直接回答してください' : 'Discord上で選択肢を選んで回答'
          ].join('\n'),
          inline: false,
        });

        // Discord UIコンポーネントがある場合は表示
        const replyOptions: any = { embeds: [embed] };
        
        if (discordVoteData) {
          try {
            const { embeds: voteEmbeds, components } = voteService.generateDiscordVoteUI(discordVoteData);
            // 元の作成完了メッセージと投票UIを両方表示
            replyOptions.embeds = [embed, ...voteEmbeds];
            replyOptions.components = components;
          } catch (error) {
            logger.warn('Discord UI生成に失敗しました', { 
              voteId, 
              error: error instanceof Error ? error.message : 'Unknown error' 
            });
          }
        }

        await interaction.editReply(replyOptions);
        
        logger.info('新しい投票が作成されました', {
          voteId,
          title,
          createdBy: interaction.user.id,
          deadline: deadline.toISOString(),
          hasFormUrl: !!formUrl,
        });

      } finally {
        await db.close();
      }

    } catch (error) {
      logger.error('投票作成に失敗しました', { 
        error: (error as Error).message,
        userId: interaction.user.id,
      });

      await interaction.editReply({
        content: `投票作成中にエラーが発生しました: ${(error as Error).message}`,
      });
    }
  },
};

function parseDeadline(deadlineStr: string): Date | null {
  try {
    // YYYY-MM-DD HH:MM 形式の解析
    const match = deadlineStr.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
    if (!match) return null;

    const [, year, month, day, hour, minute] = match;
    const date = new Date(
      parseInt(year),
      parseInt(month) - 1, // 月は0ベース
      parseInt(day),
      parseInt(hour),
      parseInt(minute)
    );

    // 有効な日付かチェック
    if (isNaN(date.getTime())) return null;
    
    return date;
  } catch (error) {
    return null;
  }
}

function isValidGoogleFormsUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname === 'forms.google.com' || 
           urlObj.hostname === 'docs.google.com';
  } catch (error) {
    return false;
  }
}

function generateVoteId(): string {
  // 短いIDを生成（8文字の英数字）
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}