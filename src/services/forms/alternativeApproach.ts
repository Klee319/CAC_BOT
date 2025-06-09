import { GoogleFormsService } from './index';
import { DatabaseService } from '../database';
import { logger } from '../../utils/logger';

/**
 * Google Formsのプリフィル問題を回避する代替アプローチ
 */

export class AlternativeFormApproach {
  /**
   * 方法1: 一意のトークンを使用した回答追跡
   * 
   * フローp：
   * 1. ユーザーごとに一意のトークンを生成
   * 2. トークンをフォームの隠しフィールドまたは最初の質問として含める
   * 3. 回答後、トークンでユーザーを特定
   */
  public static async generateUniqueTokenUrl(
    formUrl: string,
    userId: string,
    formId: string
  ): Promise<{url: string; token: string}> {
    const token = `${userId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // トークンをDBに保存
    const db = await DatabaseService.getInstance();
    await db.query(
      'INSERT INTO form_tokens (token, discord_id, form_id, created_at) VALUES (?, ?, ?, ?)',
      [token, userId, formId, new Date()]
    );
    
    // フォームURLにトークンを含める（説明文として表示される）
    const url = new URL(formUrl);
    
    logger.info('一意トークンを生成しました', {
      userId,
      formId,
      token
    });
    
    return { url: url.toString(), token };
  }

  /**
   * 方法2: Discord内フォーム（モーダル）を使用
   * 
   * Google Formsを使わず、Discordのモーダルでデータ収集
   */
  public static createDiscordFormModal(): any {
    return {
      title: 'アンケート回答',
      custom_id: 'survey_modal',
      components: [
        {
          type: 1,
          components: [{
            type: 4,
            custom_id: 'additional_info',
            label: '追加情報',
            style: 2,
            min_length: 0,
            max_length: 1000,
            placeholder: 'その他、ご意見があればお書きください',
            required: false
          }]
        }
      ]
    };
  }

  /**
   * 方法3: Webhook経由でGoogle Sheetsに直接書き込み
   * 
   * Google FormsをスキップしてSheetsに直接データを送信
   */
  public static async submitDirectlyToSheets(
    sheetId: string,
    memberData: any,
    surveyData: any
  ): Promise<void> {
    // Google Sheets APIを使用して直接書き込み
    const rowData = [
      new Date().toISOString(),
      memberData.discordId,
      memberData.name,
      memberData.studentId,
      memberData.discordUsername,
      ...Object.values(surveyData)
    ];
    
    // ここでSheets APIを呼び出し
    logger.info('Sheetsに直接データを書き込みました', {
      sheetId,
      discordId: memberData.discordId
    });
  }

  /**
   * 方法4: 簡易Webフォームを自前でホスト
   * 
   * Express.jsで簡単なフォームをホストし、
   * メンバー情報を事前入力
   */
  public static generateCustomFormUrl(
    userId: string,
    formId: string,
    memberData: any
  ): string {
    // JWTトークンでメンバー情報をエンコード
    const token = Buffer.from(JSON.stringify({
      userId,
      formId,
      memberData,
      exp: Date.now() + 3600000 // 1時間
    })).toString('base64');
    
    return `${process.env.AUTH_SERVER_URL || 'http://localhost:3001'}/custom-form/${token}`;
  }
}

/**
 * 推奨される解決策のまとめ：
 * 
 * 1. 短期的解決策:
 *    - 重要なフォームは手動でentry IDを確認してマッピング
 *    - または、トークンベースの追跡システムを実装
 * 
 * 2. 中期的解決策:
 *    - Google Sheetsと直接連携（Forms APIをスキップ）
 *    - Discord内でモーダルフォームを使用
 * 
 * 3. 長期的解決策:
 *    - 独自のフォームシステムを構築
 *    - または、プリフィルが正しく動作する他のフォームサービスを使用
 *    （Microsoft Forms、Typeform、JotFormなど）
 */