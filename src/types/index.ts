import { z } from 'zod';

// 部員データのバリデーションスキーマ
export const MemberSchema = z.object({
  name: z.string().min(1, '名前は必須です').max(50, '名前は50文字以内で入力してください'),
  discordDisplayName: z.string().min(1, 'Discord表示名は必須です').max(32, 'Discord表示名は32文字以内です'),
  discordUsername: z.string().min(1, 'Discordユーザー名は必須です').max(32, 'Discordユーザー名は32文字以内です'),
  studentId: z.string().regex(/^[A-Za-z0-9]+$/, '学籍番号は英数字のみで入力してください').min(4, '学籍番号は4文字以上で入力してください').max(20, '学籍番号は20文字以内で入力してください'),
  gender: z.enum(['男性', '女性', 'その他', '未回答'], { 
    errorMap: () => ({ message: '性別は「男性」「女性」「その他」「未回答」のいずれかを選択してください' })
  }),
  team: z.string().min(1, '班は必須です').max(20, '班名は20文字以内で入力してください'),
  membershipFeeRecord: z.enum(['完納', '未納', '一部納入', '免除'], {
    errorMap: () => ({ message: '部費納入記録は「完納」「未納」「一部納入」「免除」のいずれかを選択してください' })
  }),
  grade: z.union([
    z.number().int().min(1).max(6),
    z.string().regex(/^[1-6]$/, '学年は1-6の数字で入力してください')
  ]).transform(val => typeof val === 'string' ? parseInt(val, 10) : val)
});

export type Member = z.infer<typeof MemberSchema>;

// 部員データ更新用のスキーマ（部分的な更新を許可）
export const MemberUpdateSchema = MemberSchema.partial();
export type MemberUpdate = z.infer<typeof MemberUpdateSchema>;

// Discord部員データ（DiscordIDを含む）
export const DiscordMemberSchema = MemberSchema.extend({
  discordId: z.string().regex(/^\d{17,19}$/, '有効なDiscord IDではありません')
});

export type DiscordMember = z.infer<typeof DiscordMemberSchema>;

export interface AuditLog {
  timestamp: Date;
  userId: string;
  action: string;
  target?: string;
  oldValue?: any;
  newValue?: any;
  result: 'success' | 'failure';
}

export interface VoteCreationModal {
  formUrl: string;
  outputSheet?: string;
  deadline: Date;
  allowEdit: boolean;
  anonymous: boolean;
}

export interface Vote {
  id: string;
  title: string;
  description: string;
  formUrl: string;
  deadline: Date;
  createdBy: string;
  createdAt: Date;
  isActive: boolean;
  allowEdit: boolean;
  anonymous: boolean;
  responses: VoteResponse[];
}

export interface VoteResponse {
  userId: string;
  voteId: string;
  responses: Record<string, any>;
  submittedAt: Date;
}

export interface Permissions {
  adminRoleIds: string[];
  memberRoleIds: string[];
  allowedChannelIds: string[];
}

export interface Config {
  sheetColumns: {
    name: string;
    discordDisplayName: string;
    discordUsername: string;
    studentId: string;
    gender: string;
    team: string;
    membershipFeeRecord: string;
    grade: string;
  };
  permissions: Permissions;
  notifications: {
    feeReminder: {
      enabled: boolean;
      schedule: string;
      channelId: string;
    };
    voteReminder: {
      enabled: boolean;
      hoursBeforeDeadline: number;
    };
    systemNotifications: {
      channelId: string;
    };
  };
  sheets: {
    spreadsheetId: string;
    sheetName: string;
  };
  registration: {
    formUrl: string;
    welcomeMessage: string;
  };
  database: {
    path: string;
    backupEnabled: boolean;
    backupSchedule: string;
  };
  api: {
    retryAttempts: number;
    retryDelay: number;
    rateLimit: {
      requests: number;
      window: number;
    };
  };
  logging: {
    level: string;
    enableFileLogging: boolean;
    enableDiscordLogging: boolean;
    enableConsoleLogging: boolean;
    rotationSchedule: string;
  };
}

export interface Plugin {
  name: string;
  version: string;
  commands: any[];
  events: any[];
  initialize: () => Promise<void>;
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface DatabaseSchema {
  members: {
    id: number;
    discord_id: string;
    name: string;
    discord_display_name: string;
    discord_username: string;
    student_id: string;
    gender: string;
    team: string;
    membership_fee_record: string;
    grade: string;
    created_at: string;
    updated_at: string;
  };
  votes: {
    id: string;
    title: string;
    description: string;
    form_url: string;
    deadline: string;
    created_by: string;
    created_at: string;
    is_active: number;
    allow_edit: number;
    anonymous: number;
  };
  vote_responses: {
    id: number;
    vote_id: string;
    user_id: string;
    responses: string;
    submitted_at: string;
  };
  audit_logs: {
    id: number;
    timestamp: string;
    user_id: string;
    action: string;
    target?: string;
    old_value?: string;
    new_value?: string;
    result: string;
  };
  settings: {
    key: string;
    value: string;
    updated_at: string;
  };
}

export interface GoogleSheetsRow {
  [key: string]: string | number;
}

export interface NotificationPayload {
  type: 'fee_reminder' | 'vote_reminder' | 'system' | 'custom';
  recipient?: string;
  channelId?: string;
  title: string;
  message: string;
  embedColor?: number;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
}