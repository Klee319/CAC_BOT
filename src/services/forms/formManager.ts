import { v4 as uuidv4 } from 'uuid';
import { GoogleFormsService } from './index';
import { DatabaseService } from '../database';
import { logger } from '../../utils/logger';
import { 
  GoogleForm, 
  FormState, 
  FormCreateInput,
  FormListItem,
  FormStatistics,
  FormErrorCode 
} from '../../types/forms';
import { Member } from '../../types';
import { Client } from 'discord.js';

export class FormManager {
  private static instance: FormManager;
  private googleForms: GoogleFormsService;
  private db: DatabaseService;
  private client: Client;

  private isInitialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  private constructor(client: Client) {
    this.googleForms = GoogleFormsService.getInstance();
    this.client = client;
  }

  private async initializeDatabase(): Promise<void> {
    if (this.isInitialized) return;
    
    try {
      this.db = await DatabaseService.getInstance();
      this.isInitialized = true;
      logger.info('FormManager: データベースを初期化しました');
    } catch (error) {
      logger.error('FormManager: データベース初期化エラー', error);
      throw error;
    }
  }

  public static async getInstance(client: Client): Promise<FormManager> {
    if (!FormManager.instance) {
      FormManager.instance = new FormManager(client);
    }
    
    // データベース初期化を確実に実行
    if (!FormManager.instance.initPromise) {
      FormManager.instance.initPromise = FormManager.instance.initializeDatabase();
    }
    
    await FormManager.instance.initPromise;
    return FormManager.instance;
  }

  /**
   * フォームを作成
   */
  public async createForm(
    input: FormCreateInput,
    createdBy: string
  ): Promise<GoogleForm> {
    try {
      // データベース初期化を確実に実行
      await this.initializeDatabase();
      
      // URLからフォームIDを抽出
      const formId = this.googleForms.extractFormId(input.googleFormUrl);
      if (!formId) {
        throw new Error('無効なGoogle Forms URLです');
      }

      // 既存フォームの重複チェック
      const existingForm = await this.db.query(
        'SELECT id, title, state FROM google_forms WHERE form_id = ?',
        [formId]
      );
      
      if (existingForm.length > 0) {
        const existing = existingForm[0];
        throw new Error(`このGoogleフォームは既に登録されています（ID: ${existing.id}, タイトル: ${existing.title}, 状態: ${existing.state}）`);
      }

      // フォームの存在確認とメタデータ取得
      const metadata = await this.googleForms.getFormMetadata(formId);
      
      // 必須フィールドの確認
      const requiredFields = await this.googleForms.checkRequiredFields(formId);
      if (requiredFields.missingFields.length > 0) {
        logger.warn('必須フィールドが不足しています', {
          formId,
          missingFields: requiredFields.missingFields
        });
        
        // 必須フィールドの自動追加を試みる
        try {
          await this.googleForms.addRequiredFields(formId, requiredFields.missingFields);
          logger.info('必須フィールドを自動追加しました', {
            formId,
            addedFields: requiredFields.missingFields
          });
        } catch (addError) {
          logger.warn('必須フィールドの自動追加に失敗しました', {
            formId,
            error: addError instanceof Error ? addError.message : 'Unknown error'
          });
          // エラーは警告として記録するが、フォーム作成は続行
        }
      }

      // 期限をパース
      let deadline: Date | undefined;
      if (input.deadline) {
        deadline = new Date(input.deadline);
        if (isNaN(deadline.getTime())) {
          throw new Error('無効な期限形式です');
        }
      }

      // ロールIDをパース
      const targetRoles = input.targetRoles
        ? input.targetRoles.split(',').map(r => r.trim()).filter(r => r)
        : undefined;

      // フォーム情報を保存
      const form: GoogleForm = {
        id: uuidv4(),
        formId,
        formUrl: input.googleFormUrl,
        title: metadata.title,
        description: metadata.description,
        createdBy,
        createdAt: new Date(),
        deadline,
        state: 'draft' as FormState,
        targetRoles,
        isAnonymous: input.isAnonymous,
        allowEdit: input.allowEdit,
        updatedAt: new Date()
      };

      await this.db.createForm({
        id: form.id,
        formId: form.formId,
        formUrl: form.formUrl,
        title: form.title,
        description: form.description,
        createdBy: form.createdBy,
        deadline: form.deadline,
        targetRoles: form.targetRoles,
        isAnonymous: form.isAnonymous,
        allowEdit: form.allowEdit
      });
      
      logger.info('フォームを作成しました', {
        formId: form.id,
        title: form.title,
        createdBy
      });

      return form;
    } catch (error) {
      logger.error('フォーム作成エラー', error);
      throw error;
    }
  }

  /**
   * フォームを公開
   */
  public async publishForm(formId: string): Promise<void> {
    try {
      // データベース初期化を確実に実行
      await this.initializeDatabase();
      
      const form = await this.db.getFormById(formId);
      if (!form) {
        throw new Error('フォームが見つかりません');
      }

      if (form.state === 'published') {
        throw new Error('既に公開されています');
      }

      await this.db.updateFormState(formId, 'published');
      
      logger.info('フォームを公開しました', {
        formId,
        title: form.title
      });
    } catch (error) {
      logger.error('フォーム公開エラー', error);
      throw error;
    }
  }

  /**
   * フォームを削除
   */
  public async deleteForm(formId: string): Promise<void> {
    try {
      // データベース初期化を確実に実行
      await this.initializeDatabase();
      
      const form = await this.db.getFormById(formId);
      if (!form) {
        throw new Error('フォームが見つかりません');
      }

      // 公開済みメッセージがある場合は削除
      if (form.message_id && form.channel_id) {
        try {
          const channel = await this.client.channels.fetch(form.channel_id);
          if (channel?.isTextBased()) {
            const message = await channel.messages.fetch(form.message_id);
            await message.delete();
          }
        } catch (error) {
          logger.warn('フォームメッセージの削除に失敗しました', error);
        }
      }

      await this.db.deleteForm(formId);
      
      logger.info('フォームを削除しました', {
        formId,
        title: form.title
      });
    } catch (error) {
      logger.error('フォーム削除エラー', error);
      throw error;
    }
  }

  /**
   * フォームを更新
   */
  public async updateForm(
    formId: string,
    updates: {
      deadline?: Date;
      targetRoles?: string[];
      isAnonymous?: boolean;
      allowEdit?: boolean;
    }
  ): Promise<void> {
    try {
      // データベース初期化を確実に実行
      await this.initializeDatabase();
      
      const form = await this.db.getFormById(formId);
      if (!form) {
        throw new Error('フォームが見つかりません');
      }

      await this.db.updateForm(formId, updates);
      
      logger.info('フォームを更新しました', {
        formId,
        updates
      });
    } catch (error) {
      logger.error('フォーム更新エラー', error);
      throw error;
    }
  }

  /**
   * アクティブなフォーム一覧を取得
   */
  public async getActiveForms(userId?: string): Promise<FormListItem[]> {
    try {
      // データベース初期化を確実に実行
      await this.initializeDatabase();
      
      const forms = await this.db.getActiveForms();
      const formList: FormListItem[] = [];

      for (const form of forms) {
        const responses = await this.db.getFormResponses(form.id);
        const responseCount = responses.length;

        // 対象者数を計算（簡易版）
        let targetCount = 0;
        if (form.target_roles && form.target_roles.length > 0) {
          // ロールメンバー数を取得（実装が必要）
          targetCount = await this.getTargetMemberCount(form.target_roles);
        } else {
          // 全メンバー数を取得
          targetCount = await this.db.getTotalMembersCount();
        }

        let hasResponded = false;
        if (userId) {
          hasResponded = await this.db.hasUserResponded(form.id, userId);
        }

        formList.push({
          id: form.id,
          title: form.title,
          deadline: form.deadline ? new Date(form.deadline) : undefined,
          state: form.state,
          responseCount,
          targetCount,
          hasResponded,
          targetRoles: form.target_roles
        });
      }

      return formList;
    } catch (error) {
      logger.error('アクティブフォーム一覧の取得エラー', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  /**
   * フォームをIDで取得
   */
  public async getFormById(formId: string): Promise<any | null> {
    try {
      // データベース初期化を確実に実行
      await this.initializeDatabase();
      
      return await this.db.getFormById(formId);
    } catch (error) {
      logger.error('フォーム取得エラー', error);
      throw error;
    }
  }

  /**
   * フォーム回答一覧を取得
   */
  public async getFormResponses(formId: string): Promise<any[]> {
    try {
      // データベース初期化を確実に実行
      await this.initializeDatabase();
      
      return await this.db.getFormResponses(formId);
    } catch (error) {
      logger.error('フォーム回答取得エラー', error);
      throw error;
    }
  }

  /**
   * フォームメッセージIDを設定
   */
  public async setFormMessage(formId: string, messageId: string, channelId: string): Promise<void> {
    try {
      // データベース初期化を確実に実行
      await this.initializeDatabase();
      
      await this.db.setFormMessage(formId, messageId, channelId);
    } catch (error) {
      logger.error('フォームメッセージ設定エラー', error);
      throw error;
    }
  }

  /**
   * 全フォーム一覧を取得（管理者用）
   */
  public async getAllForms(userId?: string): Promise<FormListItem[]> {
    try {
      // データベース初期化を確実に実行
      await this.initializeDatabase();
      
      const forms = await this.db.getAllForms();
      const formList: FormListItem[] = [];

      for (const form of forms) {
        const responses = await this.db.getFormResponses(form.id);
        const responseCount = responses.length;

        // 対象者数を計算（簡易版）
        let targetCount = 0;
        if (form.target_roles && form.target_roles.length > 0) {
          // ロールメンバー数を取得（実装が必要）
          targetCount = await this.getTargetMemberCount(form.target_roles);
        } else {
          // 全メンバー数を取得
          targetCount = await this.db.getTotalMembersCount();
        }

        let hasResponded = false;
        if (userId) {
          hasResponded = await this.db.hasUserResponded(form.id, userId);
        }

        formList.push({
          id: form.id,
          title: form.title,
          deadline: form.deadline ? new Date(form.deadline) : undefined,
          state: form.state,
          responseCount,
          targetCount,
          hasResponded,
          targetRoles: form.target_roles
        });
      }

      return formList;
    } catch (error) {
      logger.error('全フォーム一覧の取得エラー', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }

  /**
   * 対象ロールのメンバー数を取得
   */
  private async getTargetMemberCount(targetRoles: string[]): Promise<number> {
    try {
      // 実際のDiscordサーバーからロールメンバー数を取得する場合
      // 現在は簡易実装として全メンバー数を返す
      return await this.db.getTotalMembersCount();
    } catch (error) {
      logger.error('対象メンバー数の取得エラー', error);
      return 0;
    }
  }

  /**
   * フォームの統計情報を取得
   */
  public async getFormStatistics(formId: string): Promise<FormStatistics> {
    try {
      // データベース初期化を確実に実行
      await this.initializeDatabase();
      
      const form = await this.db.getFormById(formId);
      if (!form) {
        throw new Error('フォームが見つかりません');
      }

      const responses = await this.db.getFormResponses(formId);
      const responseCount = responses.length;

      let targetCount = 0;
      if (form.target_roles && form.target_roles.length > 0) {
        targetCount = await this.getTargetMemberCount(form.target_roles);
      } else {
        targetCount = await this.db.getTotalMembersCount();
      }

      const lastResponse = responses.length > 0
        ? new Date(responses[0].responded_at)
        : undefined;

      return {
        totalTargets: targetCount,
        totalResponses: responseCount,
        responseRate: targetCount > 0 ? (responseCount / targetCount) * 100 : 0,
        lastResponseAt: lastResponse
      };
    } catch (error) {
      logger.error('フォーム統計情報の取得エラー', error);
      throw error;
    }
  }

  /**
   * ユーザーがフォームに回答可能かチェック
   */
  public async canUserRespond(
    formId: string,
    userId: string,
    userRoles: string[]
  ): Promise<{ canRespond: boolean; reason?: FormErrorCode }> {
    try {
      // データベース初期化を確実に実行
      await this.initializeDatabase();
      
      const form = await this.db.getFormById(formId);
      if (!form) {
        return { canRespond: false, reason: FormErrorCode.FORM_NOT_FOUND };
      }

      // 状態チェック
      if (form.state !== 'published') {
        return { canRespond: false, reason: FormErrorCode.FORM_NOT_FOUND };
      }

      // 期限チェック
      if (form.deadline && new Date(form.deadline) < new Date()) {
        return { canRespond: false, reason: FormErrorCode.DEADLINE_PASSED };
      }

      // ロールチェック
      if (form.target_roles && form.target_roles.length > 0) {
        const hasRole = form.target_roles.some(role => userRoles.includes(role));
        if (!hasRole) {
          return { canRespond: false, reason: FormErrorCode.NOT_AUTHORIZED };
        }
      }

      // 回答済みチェック（編集不可の場合）
      if (!form.allow_edit) {
        const hasResponded = await this.db.hasUserResponded(formId, userId);
        if (hasResponded) {
          return { canRespond: false, reason: FormErrorCode.ALREADY_RESPONDED };
        }
      }

      return { canRespond: true };
    } catch (error) {
      logger.error('回答可能チェックエラー', error);
      return { canRespond: false };
    }
  }

  /**
   * 回答用の直接フォームURLを生成（JWT認証なし）
   */
  public async generateDirectFormUrl(
    formId: string,
    userId: string,
    member: Member
  ): Promise<string> {
    try {
      // データベース初期化を確実に実行
      await this.initializeDatabase();
      
      const form = await this.db.getFormById(formId);
      if (!form) {
        throw new Error('フォームが見つかりません');
      }

      // Google FormsのプリフィルURLを直接生成
      const prefilledUrl = await this.googleForms.buildPrefilledUrl(
        form.form_id,
        form.form_url,
        {
          name: member.name,
          studentId: member.studentId,
          discordUsername: member.discordUsername
        }
      );

      return prefilledUrl;
    } catch (error) {
      logger.error('フォームURL生成エラー', error);
      throw error;
    }
  }

  /**
   * 期限切れフォームを処理
   */
  public async processExpiredForms(): Promise<void> {
    try {
      // データベース初期化を確実に実行
      await this.initializeDatabase();
      
      const expiredForms = await this.db.getExpiredForms();
      
      for (const form of expiredForms) {
        await this.db.updateFormState(form.id, 'expired');
        logger.info('フォームを期限切れに設定しました', {
          formId: form.id,
          title: form.title
        });
      }
    } catch (error) {
      logger.error('期限切れフォーム処理エラー', error);
    }
  }

}