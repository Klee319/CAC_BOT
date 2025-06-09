import { z } from 'zod';

// Google Forms関連のスキーマと型定義

// フォーム状態
export type FormState = 'draft' | 'published' | 'expired';

// リマインダータイプ
export type ReminderType = '3days' | '1day' | '3hours';

// Google Form データのバリデーションスキーマ
export const GoogleFormSchema = z.object({
  id: z.string(),
  formId: z.string(),
  formUrl: z.string().url(),
  title: z.string().min(1, 'タイトルは必須です').max(200),
  description: z.string().optional(),
  createdBy: z.string(),
  createdAt: z.date(),
  deadline: z.date().optional(),
  state: z.enum(['draft', 'published', 'expired']),
  targetRoles: z.array(z.string()).optional(),
  isAnonymous: z.boolean().default(false),
  allowEdit: z.boolean().default(true),
  messageId: z.string().optional(),
  channelId: z.string().optional(),
  updatedAt: z.date()
});

export type GoogleForm = z.infer<typeof GoogleFormSchema>;

// フォーム作成時の入力データ
export const FormCreateInputSchema = z.object({
  googleFormUrl: z.string().url('有効なGoogle Forms URLを入力してください'),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, '期限は YYYY-MM-DD HH:mm 形式で入力してください').optional(),
  targetRoles: z.string().optional(),
  isAnonymous: z.boolean().default(false),
  allowEdit: z.boolean().default(true)
});

export type FormCreateInput = z.infer<typeof FormCreateInputSchema>;

// フォーム回答記録
export interface FormResponse {
  id: number;
  formId: string;
  discordId: string;
  respondedAt: Date;
  jwtTokenHash?: string;
  responseEditUrl?: string;
}

// リマインダー記録
export interface FormReminder {
  id: number;
  formId: string;
  discordId: string;
  reminderType: ReminderType;
  sentAt: Date;
}

// JWT トークンペイロード
export interface FormTokenPayload {
  discordId: string;
  formId: string;
  memberData: {
    name: string;
    studentId: string;
    discordUsername: string;
  };
  iat: number;
  exp: number;
}

// Google Forms API関連の型
export interface FormMetadata {
  formId: string;
  title: string;
  description?: string;
  responderUri: string;
  linkedSheetId?: string;
}

export interface FormQuestion {
  questionId: string;
  title: string;
  description?: string;
  required: boolean;
  type: string;
}

export interface FormResponseFromAPI {
  responseId: string;
  createTime: string;
  lastSubmittedTime: string;
  answers: Record<string, any>;
}

// フォーム統計情報
export interface FormStatistics {
  totalTargets: number;
  totalResponses: number;
  responseRate: number;
  lastResponseAt?: Date;
}

// エラーコード
export enum FormErrorCode {
  FORM_NOT_FOUND = 'FORM_NOT_FOUND',
  ALREADY_RESPONDED = 'ALREADY_RESPONDED',
  DEADLINE_PASSED = 'DEADLINE_PASSED',
  NOT_AUTHORIZED = 'NOT_AUTHORIZED',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  API_LIMIT_EXCEEDED = 'API_LIMIT_EXCEEDED',
  INVALID_FORM_URL = 'INVALID_FORM_URL',
  FORM_FETCH_FAILED = 'FORM_FETCH_FAILED'
}

// フォームリスト表示用の型
export interface FormListItem {
  id: string;
  title: string;
  deadline?: Date;
  state: FormState;
  responseCount: number;
  targetCount: number;
  hasResponded?: boolean;
  targetRoles?: string[];
}

// モーダル送信データ
export interface FormModalSubmitData {
  googleFormUrl: string;
  deadline?: string;
  targetRoles?: string;
  isAnonymous: string;
  allowEdit: string;
}

// 必須フィールドのステータス
export interface RequiredFieldsStatus {
  hasNameField: boolean;
  hasStudentIdField: boolean;
  hasDiscordUsernameField: boolean;
  missingFields: string[];
}