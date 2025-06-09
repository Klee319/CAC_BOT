import { google, forms_v1 } from 'googleapis';
import { env } from '../../utils/env';
import { logger } from '../../utils/logger';

/**
 * Google Formsを自動作成するサービス
 * 必須フィールドを事前に定義し、entry IDを管理
 */
export class FormCreatorService {
  private static instance: FormCreatorService;
  private formsClient: forms_v1.Forms;
  
  private constructor() {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: env.GOOGLE_CLIENT_EMAIL,
        private_key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        project_id: env.GOOGLE_PROJECT_ID,
      },
      scopes: [
        'https://www.googleapis.com/auth/forms',
        'https://www.googleapis.com/auth/drive',
      ],
    });

    this.formsClient = google.forms({
      version: 'v1',
      auth,
    });
  }

  public static getInstance(): FormCreatorService {
    if (!FormCreatorService.instance) {
      FormCreatorService.instance = new FormCreatorService();
    }
    return FormCreatorService.instance;
  }

  /**
   * 標準フィールドを持つフォームを作成
   */
  public async createStandardForm(
    title: string,
    description: string,
    additionalQuestions?: forms_v1.Schema$Item[]
  ): Promise<{
    formId: string;
    formUrl: string;
    editUrl: string;
    fieldMappings: Record<string, string>;
  }> {
    try {
      // 新しいフォームを作成
      const createResponse = await this.formsClient.forms.create({
        requestBody: {
          info: {
            title,
            documentTitle: title,
          },
        },
      });

      const formId = createResponse.data.formId!;
      
      // 標準フィールドを追加
      const standardFields = [
        {
          title: '名前',
          description: '氏名を入力してください（例: 山田太郎）',
          fieldName: 'name',
        },
        {
          title: '学籍番号',
          description: '学籍番号を入力してください（例: 2024001）',
          fieldName: 'studentId',
        },
        {
          title: 'Discordユーザー名',
          description: 'Discordのユーザー名を入力してください',
          fieldName: 'discordUsername',
        },
      ];

      const requests: forms_v1.Schema$Request[] = [];
      const fieldMappings: Record<string, string> = {};

      // 説明を追加
      if (description) {
        requests.push({
          updateFormInfo: {
            info: {
              description,
            },
            updateMask: 'description',
          },
        });
      }

      // 標準フィールドを追加
      for (let i = 0; i < standardFields.length; i++) {
        const field = standardFields[i];
        requests.push({
          createItem: {
            item: {
              title: field.title,
              description: field.description,
              questionItem: {
                question: {
                  required: true,
                  textQuestion: {
                    paragraph: false,
                  },
                },
              },
            },
            location: {
              index: i,
            },
          },
        });
      }

      // 追加の質問があれば追加
      if (additionalQuestions) {
        additionalQuestions.forEach((question, index) => {
          requests.push({
            createItem: {
              item: question,
              location: {
                index: standardFields.length + index,
              },
            },
          });
        });
      }

      // バッチ更新を実行
      const updateResponse = await this.formsClient.forms.batchUpdate({
        formId,
        requestBody: {
          requests,
        },
      });

      // 更新後のフォーム情報を取得
      const formResponse = await this.formsClient.forms.get({
        formId,
      });

      // 作成されたフィールドのitemIdを取得
      const items = formResponse.data.items || [];
      items.forEach((item, index) => {
        if (index < standardFields.length && item.itemId) {
          const fieldName = standardFields[index].fieldName;
          fieldMappings[fieldName] = `entry.${item.itemId}`;
        }
      });

      logger.info('標準フォームを作成しました', {
        formId,
        title,
        fieldMappings,
      });

      return {
        formId,
        formUrl: formResponse.data.responderUri!,
        editUrl: `https://docs.google.com/forms/d/${formId}/edit`,
        fieldMappings,
      };
    } catch (error) {
      logger.error('フォーム作成エラー', error);
      throw error;
    }
  }

  /**
   * フォームにGoogle Sheetsを連携
   */
  public async linkGoogleSheet(formId: string): Promise<string> {
    try {
      // この機能はForms APIでは直接サポートされていないため、
      // 手動で行うか、別のアプローチが必要
      logger.warn('Google Sheets連携は手動で行ってください');
      return '';
    } catch (error) {
      logger.error('Sheets連携エラー', error);
      throw error;
    }
  }
}