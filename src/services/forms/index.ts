import { google, forms_v1 } from 'googleapis';
import { env } from '../../utils/env';
import { logger } from '../../utils/logger';
import { 
  FormMetadata, 
  FormQuestion, 
  FormResponseFromAPI, 
  RequiredFieldsStatus 
} from '../../types/forms';
import { getCustomMapping } from '../../config/formFieldMappings';

export class GoogleFormsService {
  private static instance: GoogleFormsService;
  private formsClient: forms_v1.Forms;
  
  private constructor() {
    try {
      // Google認証設定
      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: env.GOOGLE_CLIENT_EMAIL,
          private_key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          project_id: env.GOOGLE_PROJECT_ID,
        },
        scopes: [
          'https://www.googleapis.com/auth/forms',
          'https://www.googleapis.com/auth/forms.body',
          'https://www.googleapis.com/auth/forms.body.readonly',
          'https://www.googleapis.com/auth/forms.responses.readonly',
          'https://www.googleapis.com/auth/drive',
          'https://www.googleapis.com/auth/drive.file',
          'https://www.googleapis.com/auth/drive.resource',
          'https://www.googleapis.com/auth/drive.readonly'
        ],
      });

      this.formsClient = google.forms({
        version: 'v1',
        auth,
      });
      
      logger.info('Google Forms API認証の初期化が完了しました');
    } catch (error) {
      logger.error('Google Forms API認証の初期化に失敗しました', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        hasClientEmail: !!env.GOOGLE_CLIENT_EMAIL,
        hasPrivateKey: !!env.GOOGLE_PRIVATE_KEY,
        hasProjectId: !!env.GOOGLE_PROJECT_ID
      });
      throw error;
    }
  }

  public static getInstance(): GoogleFormsService {
    if (!GoogleFormsService.instance) {
      GoogleFormsService.instance = new GoogleFormsService();
    }
    return GoogleFormsService.instance;
  }

  /**
   * フォームIDをURLから抽出
   */
  public extractFormId(formUrl: string): string | null {
    try {
      // Google Forms URLのパターン: https://docs.google.com/forms/d/{FORM_ID}/...
      const match = formUrl.match(/\/forms\/d\/([a-zA-Z0-9_-]+)/);
      return match ? match[1] : null;
    } catch (error) {
      logger.error('フォームIDの抽出に失敗しました', { formUrl, error });
      return null;
    }
  }

  /**
   * フォームのメタデータを取得
   */
  public async getFormMetadata(formId: string): Promise<FormMetadata> {
    try {
      logger.debug('Google Forms API呼び出し開始', { 
        formId,
        timestamp: new Date().toISOString()
      });
      
      const response = await this.formsClient.forms.get({
        formId,
      });

      const form = response.data;
      
      logger.debug('Google Forms APIレスポンス成功', { 
        formId,
        title: form.info?.title,
        hasDescription: !!form.info?.description,
        responderUri: form.responderUri
      });
      
      return {
        formId: form.formId!,
        title: form.info?.title || 'Untitled Form',
        description: form.info?.description,
        responderUri: form.responderUri || '',
        linkedSheetId: form.linkedSheetId,
      };
    } catch (error: any) {
      logger.error('フォームメタデータの取得に失敗しました', { 
        formId, 
        errorStatus: error.status || error.code,
        errorMessage: error.message,
        errorResponse: error.response?.data,
        errorDetails: error.details || error.error,
        errorStack: error.stack,
        fullError: {
          name: error.name,
          message: error.message,
          status: error.status,
          code: error.code,
          config: error.config ? {
            url: error.config.url,
            method: error.config.method
          } : undefined
        }
      });
      
      // 403エラー（権限不足）の場合、詳細なメッセージを提供
      if (error.status === 403 || error.code === 403) {
        throw new Error(
          'Google Formsへのアクセス権限が不足しています。\n' +
          '• フォームの共有設定を確認してください\n' +
          '• BOTのサービスアカウントにフォームのアクセス権限を付与してください\n' +
          '• Google Cloud コンソールでGoogle Forms APIが有効になっているか確認してください'
        );
      }
      
      // フォームが見つからない場合
      if (error.status === 404 || error.code === 404) {
        throw new Error('指定されたフォームが見つかりません。URLが正しいか確認してください。');
      }
      
      // 認証エラーの場合
      if (error.status === 401 || error.code === 401) {
        throw new Error(
          'Google APIの認証に失敗しました。\n' +
          'サービスアカウントキーが正しく設定されているか確認してください。'
        );
      }
      
      // その他のエラー
      throw new Error(`フォーム情報の取得に失敗しました: ${error.message || 'Unknown error'} (HTTP ${error.status || error.code || 'Unknown'})`);
    }
  }

  /**
   * フォームの質問項目を取得
   */
  public async getFormQuestions(formId: string): Promise<FormQuestion[]> {
    try {
      const response = await this.formsClient.forms.get({
        formId,
      });

      const items = response.data.items || [];
      
      return items.map(item => ({
        questionId: item.itemId!,
        title: item.title || '',
        description: item.description,
        required: (item.questionItem as any)?.required || false,
        type: this.getQuestionType(item),
      }));
    } catch (error) {
      logger.error('フォーム質問項目の取得に失敗しました', { formId, error });
      throw new Error('質問項目の取得に失敗しました');
    }
  }

  /**
   * フォームの回答を取得
   */
  public async getFormResponses(formId: string): Promise<FormResponseFromAPI[]> {
    try {
      const response = await this.formsClient.forms.responses.list({
        formId,
      });

      const responses = response.data.responses || [];
      
      return responses.map(resp => ({
        responseId: resp.responseId!,
        createTime: resp.createTime!,
        lastSubmittedTime: resp.lastSubmittedTime!,
        answers: this.parseAnswers(resp.answers),
      }));
    } catch (error) {
      logger.error('フォーム回答の取得に失敗しました', { formId, error });
      throw new Error('回答の取得に失敗しました');
    }
  }

  /**
   * 必須フィールドの存在確認
   */
  public async checkRequiredFields(formId: string): Promise<RequiredFieldsStatus> {
    try {
      const questions = await this.getFormQuestions(formId);
      
      const hasNameField = questions.some(q => 
        q.title.includes('名前') || q.title.includes('氏名') || q.title.toLowerCase().includes('name')
      );
      
      const hasStudentIdField = questions.some(q => 
        q.title.includes('学籍番号') || q.title.includes('学生番号') || q.title.toLowerCase().includes('student')
      );
      
      const hasDiscordUsernameField = questions.some(q => 
        q.title.toLowerCase().includes('discord') || q.title.includes('ユーザー名')
      );

      const missingFields: string[] = [];
      if (!hasNameField) missingFields.push('名前');
      if (!hasStudentIdField) missingFields.push('学籍番号');
      if (!hasDiscordUsernameField) missingFields.push('Discordユーザー名');

      return {
        hasNameField,
        hasStudentIdField,
        hasDiscordUsernameField,
        missingFields,
      };
    } catch (error) {
      logger.error('必須フィールドの確認に失敗しました', { formId, error });
      throw error;
    }
  }

  /**
   * フォームに必須フィールドを追加
   */
  public async addRequiredFields(formId: string, missingFields: string[]): Promise<void> {
    try {
      const requests: any[] = [];
      
      // 各必須フィールドを追加するリクエストを作成
      for (const fieldName of missingFields) {
        let fieldConfig: any = {
          title: fieldName,
          description: '',
          required: true,
        };

        // フィールドごとのヘルプテキストを設定
        switch (fieldName) {
          case '名前':
            fieldConfig.description = '氏名を入力してください（例: 山田太郎）';
            break;
          case '学籍番号':
            fieldConfig.description = '学籍番号を入力してください（例: 2024001）';
            break;
          case 'Discordユーザー名':
            fieldConfig.description = 'Discordのユーザー名を入力してください（例: username#1234）';
            break;
        }

        requests.push({
          createItem: {
            item: {
              title: fieldConfig.title,
              description: fieldConfig.description,
              questionItem: {
                question: {
                  required: fieldConfig.required,
                  textQuestion: {
                    paragraph: false
                  }
                }
              }
            },
            location: {
              index: 0
            }
          }
        });
      }

      // batchUpdateリクエストを送信
      await this.formsClient.forms.batchUpdate({
        formId,
        requestBody: {
          requests
        }
      });

      logger.info('必須フィールドを追加しました', {
        formId,
        addedFields: missingFields
      });

    } catch (error: any) {
      logger.error('必須フィールドの追加に失敗しました', { formId, error });
      
      // 権限エラーの場合
      if (error.status === 403 || error.code === 403) {
        throw new Error(
          'Google Formsへの編集権限が不足しています。\n' +
          'フォームの編集にはより高い権限が必要です。\n' +
          'フォームを手動で編集し、以下のフィールドを追加してください：\n' +
          missingFields.map(f => `• ${f}`).join('\n')
        );
      }
      
      throw new Error('必須フィールドの追加に失敗しました');
    }
  }

  /**
   * 質問タイプを判定
   */
  private getQuestionType(item: forms_v1.Schema$Item): string {
    if (item.questionItem?.question?.textQuestion) return 'TEXT';
    if (item.questionItem?.question?.choiceQuestion) {
      return item.questionItem.question.choiceQuestion.type === 'RADIO' ? 'RADIO' : 'CHECKBOX';
    }
    if (item.questionItem?.question?.scaleQuestion) return 'SCALE';
    if (item.questionItem?.question?.dateQuestion) return 'DATE';
    if (item.questionItem?.question?.timeQuestion) return 'TIME';
    if (item.questionItem?.question?.fileUploadQuestion) return 'FILE_UPLOAD';
    return 'UNKNOWN';
  }

  /**
   * 回答データをパース
   */
  private parseAnswers(answers?: { [key: string]: forms_v1.Schema$Answer }): Record<string, any> {
    if (!answers) return {};
    
    const parsed: Record<string, any> = {};
    
    for (const [questionId, answer] of Object.entries(answers)) {
      if (answer.textAnswers?.answers) {
        parsed[questionId] = answer.textAnswers.answers.map(a => a.value).join(', ');
      } else if (answer.fileUploadAnswers?.answers) {
        parsed[questionId] = answer.fileUploadAnswers.answers.map(a => a.fileId);
      }
    }
    
    return parsed;
  }

  /**
   * フォームの存在確認
   */
  public async checkFormExists(formId: string): Promise<boolean> {
    try {
      await this.getFormMetadata(formId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * フォームのフィールドマッピングを取得
   * Google Forms APIからフォーム構造を解析してentry IDを取得
   */
  public async getFormFieldMappings(formId: string): Promise<Record<string, string>> {
    try {
      // まずカスタムマッピングを確認
      const customMapping = getCustomMapping(formId);
      if (customMapping && Object.keys(customMapping.fieldMappings).length > 0) {
        logger.info('カスタムフィールドマッピングを使用', {
          formId,
          mappings: customMapping.fieldMappings
        });
        return customMapping.fieldMappings;
      }
      
      const response = await this.formsClient.forms.get({
        formId,
      });

      const items = response.data.items || [];
      const mappings: Record<string, string> = {};
      
      for (const item of items) {
        if (!item.questionItem || !item.itemId) continue;
        
        const title = item.title?.toLowerCase() || '';
        const itemId = item.itemId || '';
        
        // Google Forms APIのitemIdは8文字の16進数
        // 実際のentry IDは10桁の数字の可能性が高い
        // ここではAPIのitemIdを一旦保存し、実際のentry IDはカスタムマッピングで対応
        const entryId = itemId.startsWith('entry.') ? itemId : `entry.${itemId}`;
        
        // 名前フィールドを検出
        if (title.includes('名前') || title.includes('氏名') || title.toLowerCase().includes('name')) {
          mappings['name'] = entryId;
          logger.debug(`名前フィールドを検出: title="${item.title}", itemId="${itemId}", entryId="${entryId}"`);
        }
        
        // 学籍番号フィールドを検出
        if (title.includes('学籍番号') || title.includes('学生番号') || title.toLowerCase().includes('student')) {
          mappings['studentId'] = entryId;
          logger.debug(`学籍番号フィールドを検出: title="${item.title}", itemId="${itemId}", entryId="${entryId}"`);
        }
        
        // Discordユーザー名フィールドを検出
        if (title.toLowerCase().includes('discord') || title.includes('ユーザー名')) {
          mappings['discordUsername'] = entryId;
          logger.debug(`Discordフィールドを検出: title="${item.title}", itemId="${itemId}", entryId="${entryId}"`);
        }
      }
      
      logger.info('フォームフィールドマッピングを取得しました', {
        formId,
        mappings,
        foundFields: {
          name: !!mappings['name'],
          studentId: !!mappings['studentId'],
          discordUsername: !!mappings['discordUsername']
        },
        itemCount: items.length,
        itemTitles: items.map(item => ({ title: item.title, itemId: item.itemId }))
      });
      
      logger.warn('⚠️ Google Forms APIのitemIdは実際のentry IDと異なる場合があります。プリフィルが機能しない場合は、src/config/formFieldMappings.tsにカスタムマッピングを設定してください。');
      
      return mappings;
    } catch (error) {
      logger.error('フォームフィールドマッピングの取得に失敗しました', { formId, error });
      return {};
    }
  }

  /**
   * プリフィル用URLを生成
   */
  public async buildPrefilledUrl(
    formId: string,
    formUrl: string,
    values: Record<string, string>
  ): Promise<string> {
    try {
      const mappings = await this.getFormFieldMappings(formId);
      
      const url = new URL(formUrl);
      url.pathname = url.pathname.replace('/edit', '/viewform');
      
      // プリフィルパラメータを追加
      url.searchParams.append('usp', 'pp_url');
      
      for (const [field, entryId] of Object.entries(mappings)) {
        if (values[field]) {
          url.searchParams.append(entryId, values[field]);
        }
      }
      
      logger.info('プリフィルURLを生成しました', {
        formId,
        originalUrl: formUrl,
        prefilledUrl: url.toString(),
        mappings,
        values,
        appliedEntries: Object.entries(mappings)
          .filter(([field, _]) => values[field])
          .map(([field, entryId]) => ({ field, entryId, value: values[field] }))
      });
      
      return url.toString();
    } catch (error) {
      logger.error('プリフィルURL生成エラー', { formId, error });
      // フォールバック: 元のURLを返す
      const url = new URL(formUrl);
      url.pathname = url.pathname.replace('/edit', '/viewform');
      return url.toString();
    }
  }

  /**
   * レガシー版のプリフィルURL生成（手動マッピング用）
   */
  public buildPrefilledUrlWithMappings(
    formUrl: string, 
    fieldMappings: Record<string, string>,
    values: Record<string, string>
  ): string {
    const url = new URL(formUrl);
    url.pathname = url.pathname.replace('/edit', '/viewform');
    
    // プリフィルパラメータを追加
    url.searchParams.append('usp', 'pp_url');
    
    for (const [field, entryId] of Object.entries(fieldMappings)) {
      if (values[field]) {
        url.searchParams.append(entryId, values[field]);
      }
    }
    
    return url.toString();
  }
}