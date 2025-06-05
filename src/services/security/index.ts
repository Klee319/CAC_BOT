import { Client, ChatInputCommandInteraction, GuildMember, User } from 'discord.js';
import { logger } from '../../utils/logger';
import { configManager } from '../../config';
import { DatabaseService } from '../database';

export interface SecurityEvent {
  type: 'command_execution' | 'permission_denied' | 'rate_limit_exceeded' | 'suspicious_activity';
  userId: string;
  userName: string;
  guildId?: string;
  channelId?: string;
  commandName?: string;
  details?: Record<string, any>;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface RateLimitInfo {
  userId: string;
  commandName: string;
  count: number;
  resetTime: Date;
}

export interface PermissionLevel {
  level: 'admin' | 'member' | 'all';
  allowedRoles?: string[];
  allowedUsers?: string[];
  restrictedChannels?: string[];
  allowedChannels?: string[];
}

export class SecurityService {
  private client?: Client;
  private db?: DatabaseService;
  private rateLimitMap: Map<string, RateLimitInfo> = new Map();
  private suspiciousActivityTracker: Map<string, number> = new Map();
  
  // レート制限設定（コマンドごと）
  private readonly rateLimits = {
    'member': { limit: 10, window: 60000 }, // 1分間に10回
    'fee': { limit: 5, window: 60000 },     // 1分間に5回
    'vote': { limit: 8, window: 60000 },    // 1分間に8回
    'sheet': { limit: 3, window: 60000 },   // 1分間に3回
    'setup': { limit: 2, window: 300000 },  // 5分間に2回
    'default': { limit: 15, window: 60000 }  // デフォルト: 1分間に15回
  };

  constructor(database?: DatabaseService) {
    this.db = database;
    this.startCleanupTimer();
  }

  public setClient(client: Client): void {
    this.client = client;
  }

  public setDatabase(database: DatabaseService): void {
    this.db = database;
  }

  /**
   * 高度な権限チェック
   */
  public async checkAdvancedPermissions(
    interaction: ChatInputCommandInteraction,
    permissionLevel: PermissionLevel
  ): Promise<{ allowed: boolean; reason?: string }> {
    const member = interaction.member as GuildMember;
    if (!member) {
      return { allowed: false, reason: 'サーバー内でのみ使用可能です' };
    }

    // チャンネル制限チェック
    const channelCheck = this.checkChannelPermissions(interaction, permissionLevel);
    if (!channelCheck.allowed) {
      await this.logSecurityEvent({
        type: 'permission_denied',
        userId: interaction.user.id,
        userName: interaction.user.username,
        guildId: interaction.guildId || undefined,
        channelId: interaction.channelId,
        commandName: interaction.commandName,
        details: { reason: 'channel_restriction', ...channelCheck },
        timestamp: new Date(),
        severity: 'medium'
      });
      return channelCheck;
    }

    // ロールベース権限チェック
    const roleCheck = this.checkRolePermissions(member, permissionLevel);
    if (!roleCheck.allowed) {
      await this.logSecurityEvent({
        type: 'permission_denied',
        userId: interaction.user.id,
        userName: interaction.user.username,
        guildId: interaction.guildId || undefined,
        channelId: interaction.channelId,
        commandName: interaction.commandName,
        details: { reason: 'role_restriction', ...roleCheck },
        timestamp: new Date(),
        severity: 'medium'
      });
      return roleCheck;
    }

    // ユーザー固有権限チェック
    const userCheck = this.checkUserPermissions(interaction.user, permissionLevel);
    if (!userCheck.allowed) {
      await this.logSecurityEvent({
        type: 'permission_denied',
        userId: interaction.user.id,
        userName: interaction.user.username,
        guildId: interaction.guildId || undefined,
        channelId: interaction.channelId,
        commandName: interaction.commandName,
        details: { reason: 'user_restriction', ...userCheck },
        timestamp: new Date(),
        severity: 'high'
      });
      return userCheck;
    }

    return { allowed: true };
  }

  /**
   * レート制限チェック
   */
  public checkRateLimit(
    userId: string,
    commandName: string
  ): { allowed: boolean; resetTime?: Date; remaining?: number } {
    const key = `${userId}-${commandName}`;
    const now = new Date();
    
    const rateLimitConfig = this.rateLimits[commandName] || this.rateLimits.default;
    const existing = this.rateLimitMap.get(key);

    if (!existing || existing.resetTime <= now) {
      // 新しいウィンドウを開始
      const resetTime = new Date(now.getTime() + rateLimitConfig.window);
      this.rateLimitMap.set(key, {
        userId,
        commandName,
        count: 1,
        resetTime
      });
      return { 
        allowed: true, 
        resetTime,
        remaining: rateLimitConfig.limit - 1
      };
    }

    if (existing.count >= rateLimitConfig.limit) {
      // レート制限に達している
      this.logSecurityEvent({
        type: 'rate_limit_exceeded',
        userId,
        userName: 'Unknown', // ここではユーザー名が不明
        commandName,
        details: { 
          count: existing.count,
          limit: rateLimitConfig.limit,
          windowMs: rateLimitConfig.window
        },
        timestamp: now,
        severity: 'medium'
      });

      return { 
        allowed: false, 
        resetTime: existing.resetTime,
        remaining: 0
      };
    }

    // カウントを増加
    existing.count++;
    return { 
      allowed: true, 
      resetTime: existing.resetTime,
      remaining: rateLimitConfig.limit - existing.count
    };
  }

  /**
   * 不審なアクティビティの検出
   */
  public detectSuspiciousActivity(
    userId: string,
    interaction: ChatInputCommandInteraction
  ): boolean {
    const now = Date.now();
    const key = `${userId}-${Math.floor(now / 10000)}`; // 10秒ウィンドウ
    
    const currentCount = this.suspiciousActivityTracker.get(key) || 0;
    this.suspiciousActivityTracker.set(key, currentCount + 1);

    // 10秒間に20回以上のコマンド実行は不審とみなす
    if (currentCount >= 20) {
      this.logSecurityEvent({
        type: 'suspicious_activity',
        userId: interaction.user.id,
        userName: interaction.user.username,
        guildId: interaction.guildId || undefined,
        channelId: interaction.channelId,
        commandName: interaction.commandName,
        details: { 
          rapidCommandCount: currentCount,
          windowSeconds: 10
        },
        timestamp: new Date(),
        severity: 'high'
      });
      return true;
    }

    return false;
  }

  /**
   * セキュリティイベントのログ記録
   */
  public async logSecurityEvent(event: SecurityEvent): Promise<void> {
    try {
      // Winstonでのログ記録
      logger.warn(`セキュリティイベント: ${event.type}`, {
        userId: event.userId,
        userName: event.userName,
        guildId: event.guildId,
        channelId: event.channelId,
        commandName: event.commandName,
        severity: event.severity,
        details: event.details,
        timestamp: event.timestamp.toISOString()
      });

      // データベースへの記録
      if (this.db) {
        await this.db.logSecurityEvent(event);
      }

      // 重要度が高い場合は管理者に通知
      if (event.severity === 'high' || event.severity === 'critical') {
        await this.notifyAdmins(event);
      }

    } catch (error) {
      logger.error('セキュリティイベントのログ記録に失敗しました', {
        error: error instanceof Error ? error.message : 'Unknown error',
        event
      });
    }
  }

  /**
   * チャンネル権限チェック
   */
  private checkChannelPermissions(
    interaction: ChatInputCommandInteraction,
    permissionLevel: PermissionLevel
  ): { allowed: boolean; reason?: string } {
    const channelId = interaction.channelId;

    // 制限チャンネルのチェック
    if (permissionLevel.restrictedChannels?.includes(channelId)) {
      return {
        allowed: false,
        reason: 'このチャンネルでは使用が制限されています'
      };
    }

    // 許可チャンネルのチェック（設定されている場合）
    if (permissionLevel.allowedChannels && permissionLevel.allowedChannels.length > 0) {
      if (!permissionLevel.allowedChannels.includes(channelId)) {
        return {
          allowed: false,
          reason: 'このチャンネルでは使用できません'
        };
      }
    }

    // 既存のチャンネル許可チェックも実行
    const isAllowedChannel = configManager.isAllowedChannel(channelId);
    if (!isAllowedChannel) {
      return {
        allowed: false,
        reason: 'このチャンネルではコマンドを使用できません'
      };
    }

    return { allowed: true };
  }

  /**
   * ロール権限チェック
   */
  private checkRolePermissions(
    member: GuildMember,
    permissionLevel: PermissionLevel
  ): { allowed: boolean; reason?: string } {
    const userRoles = member.roles.cache.map(role => role.id);

    // 管理者権限のチェック
    if (permissionLevel.level === 'admin') {
      const isAdmin = configManager.isAdmin(userRoles);
      if (!isAdmin) {
        return {
          allowed: false,
          reason: 'このコマンドは管理者のみが使用できます'
        };
      }
    }

    // メンバー権限のチェック
    if (permissionLevel.level === 'member') {
      const isAdmin = configManager.isAdmin(userRoles);
      const isMember = configManager.isMember(userRoles);
      
      if (!isAdmin && !isMember) {
        return {
          allowed: false,
          reason: 'このコマンドは部員のみが使用できます'
        };
      }
    }

    // カスタムロールのチェック
    if (permissionLevel.allowedRoles && permissionLevel.allowedRoles.length > 0) {
      const hasAllowedRole = permissionLevel.allowedRoles.some(roleId => 
        userRoles.includes(roleId)
      );
      
      if (!hasAllowedRole) {
        return {
          allowed: false,
          reason: '必要なロールを持っていません'
        };
      }
    }

    return { allowed: true };
  }

  /**
   * ユーザー固有権限チェック
   */
  private checkUserPermissions(
    user: User,
    permissionLevel: PermissionLevel
  ): { allowed: boolean; reason?: string } {
    // 許可ユーザーのチェック（設定されている場合）
    if (permissionLevel.allowedUsers && permissionLevel.allowedUsers.length > 0) {
      if (!permissionLevel.allowedUsers.includes(user.id)) {
        return {
          allowed: false,
          reason: 'このコマンドの使用権限がありません'
        };
      }
    }

    return { allowed: true };
  }

  /**
   * 管理者への通知
   */
  private async notifyAdmins(event: SecurityEvent): Promise<void> {
    try {
      if (!this.client || !event.guildId) return;

      const guild = this.client.guilds.cache.get(event.guildId);
      if (!guild) return;

      // 管理者ロールを持つメンバーを取得
      const adminRoleIds = configManager.getConfig().permissions.adminRoleIds;
      const adminMembers = guild.members.cache.filter(member =>
        member.roles.cache.some(role => adminRoleIds.includes(role.id))
      );

      const notificationMessage = `🚨 **セキュリティアラート**\n` +
        `**タイプ**: ${event.type}\n` +
        `**ユーザー**: <@${event.userId}> (${event.userName})\n` +
        `**コマンド**: ${event.commandName || 'N/A'}\n` +
        `**重要度**: ${event.severity}\n` +
        `**時刻**: <t:${Math.floor(event.timestamp.getTime() / 1000)}:F>\n` +
        (event.details ? `**詳細**: \`${JSON.stringify(event.details)}\`` : '');

      // DMで管理者に通知（最大3人まで）
      let notifiedCount = 0;
      for (const [, member] of adminMembers) {
        if (notifiedCount >= 3) break;
        
        try {
          await member.send(notificationMessage);
          notifiedCount++;
        } catch (error) {
          // DMが送信できない場合は無視
          logger.debug(`管理者 ${member.user.tag} にDMを送信できませんでした`);
        }
      }

      logger.info(`セキュリティアラートを ${notifiedCount} 人の管理者に通知しました`, {
        eventType: event.type,
        severity: event.severity
      });

    } catch (error) {
      logger.error('管理者への通知に失敗しました', {
        error: error instanceof Error ? error.message : 'Unknown error',
        event
      });
    }
  }

  /**
   * 定期的なクリーンアップ処理
   */
  private startCleanupTimer(): void {
    // 5分ごとに期限切れのレート制限データを削除
    setInterval(() => {
      const now = new Date();
      
      for (const [key, rateLimitInfo] of this.rateLimitMap.entries()) {
        if (rateLimitInfo.resetTime <= now) {
          this.rateLimitMap.delete(key);
        }
      }

      // 不審なアクティビティトラッカーもクリーンアップ
      const currentWindow = Math.floor(now.getTime() / 10000);
      for (const key of this.suspiciousActivityTracker.keys()) {
        const windowTime = parseInt(key.split('-').pop() || '0');
        if (currentWindow - windowTime > 6) { // 1分前のデータは削除
          this.suspiciousActivityTracker.delete(key);
        }
      }

    }, 5 * 60 * 1000); // 5分間隔
  }

  /**
   * レート制限情報の取得
   */
  public getRateLimitInfo(): { total: number; active: number } {
    const now = new Date();
    let active = 0;
    
    for (const rateLimitInfo of this.rateLimitMap.values()) {
      if (rateLimitInfo.resetTime > now) {
        active++;
      }
    }

    return {
      total: this.rateLimitMap.size,
      active
    };
  }

  /**
   * セキュリティ統計の取得
   */
  public async getSecurityStats(): Promise<{
    activeRateLimits: number;
    totalRateLimits: number;
    suspiciousActivityCount: number;
    recentSecurityEvents: number;
  }> {
    const rateLimitInfo = this.getRateLimitInfo();
    
    // 過去24時間のセキュリティイベント数を取得
    let recentEvents = 0;
    if (this.db) {
      try {
        recentEvents = await this.db.getSecurityEventCount(24);
      } catch (error) {
        logger.error('セキュリティイベント数の取得に失敗しました', {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return {
      activeRateLimits: rateLimitInfo.active,
      totalRateLimits: rateLimitInfo.total,
      suspiciousActivityCount: this.suspiciousActivityTracker.size,
      recentSecurityEvents: recentEvents
    };
  }

  /**
   * サービスの破棄
   */
  public destroy(): void {
    this.rateLimitMap.clear();
    this.suspiciousActivityTracker.clear();
  }
}

export default SecurityService;