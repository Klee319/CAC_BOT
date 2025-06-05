import { ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { configManager } from '../config';
import { logger } from './logger';
import { SecurityService, PermissionLevel } from '../services/security';
import { DatabaseService } from '../services/database';

export interface PermissionCheckResult {
  hasPermission: boolean;
  message?: string;
}

let securityService: SecurityService | null = null;

export function initializeSecurityService(database?: DatabaseService): SecurityService {
  if (!securityService) {
    securityService = new SecurityService(database);
  }
  return securityService;
}

export function getSecurityService(): SecurityService | null {
  return securityService;
}

export function checkAdminPermission(interaction: ChatInputCommandInteraction): PermissionCheckResult {
  const member = interaction.member as GuildMember;
  if (!member) {
    return {
      hasPermission: false,
      message: 'このコマンドはサーバー内でのみ使用できます。',
    };
  }

  const userRoles = member.roles.cache.map(role => role.id);
  const adminRoleIds = configManager.getConfig().permissions.adminRoleIds;
  const isAdmin = configManager.isAdmin(userRoles);

  logger.debug('管理者権限チェック', {
    userId: interaction.user.id,
    userName: interaction.user.username,
    userRoles,
    adminRoleIds,
    isAdmin,
    commandName: interaction.commandName
  });

  if (!isAdmin) {
    return {
      hasPermission: false,
      message: 'このコマンドは管理者のみが使用できます。',
    };
  }

  return { hasPermission: true };
}

export function checkMemberPermission(interaction: ChatInputCommandInteraction): PermissionCheckResult {
  const member = interaction.member as GuildMember;
  if (!member) {
    return {
      hasPermission: false,
      message: 'このコマンドはサーバー内でのみ使用できます。',
    };
  }

  const userRoles = member.roles.cache.map(role => role.id);
  const isAdmin = configManager.isAdmin(userRoles);
  const isMember = configManager.isMember(userRoles);

  if (!isAdmin && !isMember) {
    return {
      hasPermission: false,
      message: 'このコマンドは部員のみが使用できます。',
    };
  }

  return { hasPermission: true };
}

export function checkChannelPermission(interaction: ChatInputCommandInteraction): PermissionCheckResult {
  const isAllowedChannel = configManager.isAllowedChannel(interaction.channelId);

  if (!isAllowedChannel) {
    return {
      hasPermission: false,
      message: 'このチャンネルではコマンドを使用できません。',
    };
  }

  return { hasPermission: true };
}

export async function validatePermissions(
  interaction: ChatInputCommandInteraction,
  requiredLevel: 'admin' | 'member' | 'all' = 'all'
): Promise<boolean> {
  return await validateAdvancedPermissions(interaction, {
    level: requiredLevel
  });
}

export async function validateAdvancedPermissions(
  interaction: ChatInputCommandInteraction,
  permissionLevel: PermissionLevel,
  enableRateLimit: boolean = true
): Promise<boolean> {
  try {
    // レート制限チェック
    if (enableRateLimit && securityService) {
      const rateLimitCheck = securityService.checkRateLimit(
        interaction.user.id,
        interaction.commandName
      );

      if (!rateLimitCheck.allowed) {
        const resetTime = Math.floor((rateLimitCheck.resetTime?.getTime() || 0) / 1000);
        await interaction.reply({
          content: `レート制限に達しました。<t:${resetTime}:R>後に再試行してください。`,
          ephemeral: true,
        });
        return false;
      }
    }

    // 不審なアクティビティ検出
    if (securityService?.detectSuspiciousActivity(interaction.user.id, interaction)) {
      await interaction.reply({
        content: '不審なアクティビティが検出されました。一時的にコマンドの使用が制限されています。',
        ephemeral: true,
      });
      return false;
    }

    // 高度な権限チェック
    if (securityService) {
      const permissionCheck = await securityService.checkAdvancedPermissions(
        interaction,
        permissionLevel
      );

      if (!permissionCheck.allowed) {
        await interaction.reply({
          content: permissionCheck.reason || 'コマンドの実行権限がありません。',
          ephemeral: true,
        });
        return false;
      }
    } else {
      // フォールバック: 従来の権限チェック
      const channelCheck = checkChannelPermission(interaction);
      if (!channelCheck.hasPermission) {
        await interaction.reply({
          content: channelCheck.message,
          ephemeral: true,
        });
        return false;
      }

      if (permissionLevel.level === 'admin') {
        const adminCheck = checkAdminPermission(interaction);
        if (!adminCheck.hasPermission) {
          await interaction.reply({
            content: adminCheck.message,
            ephemeral: true,
          });
          return false;
        }
      } else if (permissionLevel.level === 'member') {
        const memberCheck = checkMemberPermission(interaction);
        if (!memberCheck.hasPermission) {
          await interaction.reply({
            content: memberCheck.message,
            ephemeral: true,
          });
          return false;
        }
      }
    }

    // 成功ログの記録
    await logSecurityEvent(interaction, 'command_execution', 'success');
    
    return true;

  } catch (error) {
    logger.error('権限検証中にエラーが発生しました', {
      error: error instanceof Error ? error.message : 'Unknown error',
      userId: interaction.user.id,
      commandName: interaction.commandName
    });

    await interaction.reply({
      content: 'コマンドの実行中にエラーが発生しました。',
      ephemeral: true,
    });

    return false;
  }
}

export function getUserRoles(interaction: ChatInputCommandInteraction): string[] {
  const member = interaction.member as GuildMember;
  if (!member) return [];
  
  return member.roles.cache.map(role => role.id);
}

export function logCommandUsage(
  interaction: ChatInputCommandInteraction,
  action: string,
  target?: string,
  result: 'success' | 'failure' = 'success'
): void {
  logger.info(`コマンド使用ログ: ${action}`, {
    userId: interaction.user.id,
    userName: interaction.user.username,
    commandName: interaction.commandName,
    target,
    result,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
  });
}

export async function logSecurityEvent(
  interaction: ChatInputCommandInteraction,
  type: 'command_execution' | 'permission_denied' | 'rate_limit_exceeded' | 'suspicious_activity',
  result: 'success' | 'failure' = 'success',
  details?: Record<string, any>
): Promise<void> {
  if (securityService) {
    await securityService.logSecurityEvent({
      type,
      userId: interaction.user.id,
      userName: interaction.user.username,
      guildId: interaction.guildId || undefined,
      channelId: interaction.channelId,
      commandName: interaction.commandName,
      details: { result, ...details },
      timestamp: new Date(),
      severity: result === 'failure' ? 'medium' : 'low'
    });
  }

  // 従来のログも継続
  logCommandUsage(interaction, `${type}:${result}`, undefined, result);
}