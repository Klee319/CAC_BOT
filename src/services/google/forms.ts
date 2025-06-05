import { google } from 'googleapis';
import { env } from '../../utils/env';
import { logger } from '../../utils/logger';

export interface FormQuestion {
  id: string;
  title: string;
  type: 'TEXT' | 'RADIO' | 'CHECKBOX' | 'DROPDOWN' | 'PARAGRAPH';
  options?: string[];
  required: boolean;
}

export interface FormInfo {
  id: string;
  title: string;
  description: string;
  questions: FormQuestion[];
}

export class GoogleFormsService {
  private forms: any;
  private auth: any;

  constructor() {
    this.initializeAuth();
    this.forms = google.forms({ version: 'v1', auth: this.auth });
  }

  private initializeAuth(): void {
    try {
      this.auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: env.GOOGLE_CLIENT_EMAIL,
          private_key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          project_id: env.GOOGLE_PROJECT_ID,
        },
        scopes: [
          'https://www.googleapis.com/auth/forms.body.readonly',
          'https://www.googleapis.com/auth/forms.responses.readonly',
        ],
      });
      logger.info('Google Forms API認証の初期化が完了しました');
    } catch (error) {
      logger.error('Google Forms API認証の初期化に失敗しました', { error: (error as Error).message });
      throw error;
    }
  }

  public async getFormInfo(formId: string): Promise<FormInfo | null> {
    try {
      const response = await this.forms.forms.get({
        formId: formId,
      });

      const form = response.data;
      if (!form) {
        logger.warn('フォームが見つかりませんでした', { formId });
        return null;
      }

      const questions: FormQuestion[] = [];
      
      if (form.items) {
        for (const item of form.items) {
          if (item.questionItem) {
            const question = item.questionItem.question;
            let type: FormQuestion['type'] = 'TEXT';
            let options: string[] = [];

            if (question.textQuestion) {
              type = question.textQuestion.paragraph ? 'PARAGRAPH' : 'TEXT';
            } else if (question.choiceQuestion) {
              if (question.choiceQuestion.type === 'RADIO') {
                type = 'RADIO';
              } else if (question.choiceQuestion.type === 'CHECKBOX') {
                type = 'CHECKBOX';
              } else if (question.choiceQuestion.type === 'DROP_DOWN') {
                type = 'DROPDOWN';
              }

              if (question.choiceQuestion.options) {
                options = question.choiceQuestion.options
                  .map(opt => opt.value || '')
                  .filter(val => val.length > 0);
              }
            }

            questions.push({
              id: item.itemId || '',
              title: item.title || '',
              type,
              options: options.length > 0 ? options : undefined,
              required: question.required || false,
            });
          }
        }
      }

      return {
        id: formId,
        title: form.info?.title || 'タイトルなし',
        description: form.info?.description || '',
        questions,
      };

    } catch (error) {
      logger.error('フォーム情報の取得に失敗しました', { 
        error: (error as Error).message,
        formId 
      });
      
      // APIアクセス権限がない場合の対処
      if ((error as any).code === 403) {
        logger.warn('Google Forms APIへのアクセス権限がありません', { formId });
        return null;
      }
      
      throw error;
    }
  }

  public async getFormResponses(formId: string): Promise<any[]> {
    try {
      const response = await this.forms.forms.responses.list({
        formId: formId,
      });

      return response.data.responses || [];

    } catch (error) {
      logger.error('フォーム回答の取得に失敗しました', { 
        error: (error as Error).message,
        formId 
      });
      
      if ((error as any).code === 403) {
        logger.warn('Google Forms APIへのアクセス権限がありません', { formId });
        return [];
      }
      
      throw error;
    }
  }

  public extractFormIdFromUrl(url: string): string | null {
    try {
      // Google Forms URLからフォームIDを抽出
      const match = url.match(/\/forms\/d\/([a-zA-Z0-9-_]+)/);
      return match ? match[1] : null;
    } catch (error) {
      logger.error('フォームIDの抽出に失敗しました', { error: (error as Error).message, url });
      return null;
    }
  }

  public async validateFormAccess(formId: string): Promise<boolean> {
    try {
      const formInfo = await this.getFormInfo(formId);
      return formInfo !== null;
    } catch (error) {
      logger.error('フォームアクセス検証に失敗しました', { 
        error: (error as Error).message,
        formId 
      });
      return false;
    }
  }

  public convertFormToDiscordFormat(formInfo: FormInfo): any {
    // Google Formsの質問をDiscord UIコンポーネントに変換
    const components = [];

    for (const question of formInfo.questions.slice(0, 5)) { // Discord制限で最大5個
      if (question.type === 'TEXT' || question.type === 'PARAGRAPH') {
        // テキスト入力は後でモーダルで処理
        continue;
      } else if (question.type === 'RADIO' || question.type === 'DROPDOWN') {
        // セレクトメニューに変換
        if (question.options && question.options.length > 0) {
          const options = question.options.slice(0, 25).map((option, index) => ({
            label: option.substring(0, 100),
            value: `${question.id}_${index}`,
            description: question.required ? '必須' : '任意',
          }));

          components.push({
            type: 1, // ActionRow
            components: [{
              type: 3, // SelectMenu
              custom_id: question.id,
              placeholder: question.title.substring(0, 150),
              min_values: question.required ? 1 : 0,
              max_values: 1,
              options: options,
            }]
          });
        }
      } else if (question.type === 'CHECKBOX') {
        // マルチセレクトメニューに変換
        if (question.options && question.options.length > 0) {
          const options = question.options.slice(0, 25).map((option, index) => ({
            label: option.substring(0, 100),
            value: `${question.id}_${index}`,
            description: question.required ? '必須' : '任意',
          }));

          components.push({
            type: 1, // ActionRow
            components: [{
              type: 3, // SelectMenu
              custom_id: question.id,
              placeholder: question.title.substring(0, 150),
              min_values: question.required ? 1 : 0,
              max_values: Math.min(options.length, 25),
              options: options,
            }]
          });
        }
      }
    }

    return {
      title: formInfo.title,
      description: formInfo.description,
      components: components.slice(0, 5), // Discord制限
    };
  }
}