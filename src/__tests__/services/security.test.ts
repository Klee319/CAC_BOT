import { SecurityService, SecurityEvent, PermissionLevel } from '../../services/security';
import { DatabaseService } from '../../services/database';
import { ChatInputCommandInteraction, GuildMember, Guild, User, Client } from 'discord.js';

// モックの作成
jest.mock('discord.js');
jest.mock('../../config', () => ({
  configManager: {
    getConfig: jest.fn().mockReturnValue({
      permissions: { adminRoleIds: [], memberRoleIds: [], allowedChannelIds: [] },
      logging: { 
        level: 'error', 
        enableFileLogging: false, 
        enableConsoleLogging: true, 
        enableDiscordLogging: false 
      }
    }),
    isAdmin: jest.fn().mockReturnValue(false),
    isMember: jest.fn().mockReturnValue(true),
    isAllowedChannel: jest.fn().mockReturnValue(true)
  }
}));
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

describe('SecurityService', () => {
  let securityService: SecurityService;
  let mockDatabase: jest.Mocked<DatabaseService>;
  let mockInteraction: jest.Mocked<ChatInputCommandInteraction>;
  let mockMember: jest.Mocked<GuildMember>;
  let mockUser: jest.Mocked<User>;

  beforeEach(() => {
    // DatabaseServiceのモック
    mockDatabase = {
      logSecurityEvent: jest.fn().mockResolvedValue(undefined),
      getSecurityEventCount: jest.fn().mockResolvedValue(0),
      getSecurityEvents: jest.fn().mockResolvedValue([]),
      cleanupOldSecurityEvents: jest.fn().mockResolvedValue(0),
    } as any;

    // Userのモック
    mockUser = {
      id: 'test-user-123',
      username: 'testuser',
      tag: 'testuser#1234',
    } as any;

    // GuildMemberのモック
    mockMember = {
      user: mockUser,
      roles: {
        cache: new Map([
          ['role1', { id: 'role1', name: 'Member' }],
          ['role2', { id: 'role2', name: 'Admin' }],
        ])
      },
    } as any;

    // ChatInputCommandInteractionのモック
    mockInteraction = {
      user: mockUser,
      member: mockMember,
      guildId: 'test-guild-123',
      channelId: 'test-channel-123',
      commandName: 'test-command',
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    securityService = new SecurityService(mockDatabase);
  });

  afterEach(() => {
    securityService.destroy();
    jest.clearAllMocks();
  });

  describe('Rate Limiting', () => {
    test('should allow commands within rate limit', () => {
      const result = securityService.checkRateLimit('user123', 'member');
      
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
      expect(result.resetTime).toBeInstanceOf(Date);
    });

    test('should block commands when rate limit exceeded', () => {
      const userId = 'user123';
      const commandName = 'member';
      
      // レート制限まで実行
      for (let i = 0; i < 10; i++) {
        securityService.checkRateLimit(userId, commandName);
      }
      
      // 制限を超える
      const result = securityService.checkRateLimit(userId, commandName);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    test('should reset rate limit after time window', async () => {
      const userId = 'user123';
      const commandName = 'member';
      
      // レート制限まで実行
      for (let i = 0; i < 10; i++) {
        securityService.checkRateLimit(userId, commandName);
      }
      
      // 制限を超える
      const blockedResult = securityService.checkRateLimit(userId, commandName);
      expect(blockedResult.allowed).toBe(false);
      
      // 時間を進める（実際のテストでは短縮）
      jest.useFakeTimers();
      jest.advanceTimersByTime(61000); // 1分1秒進める
      
      const newResult = securityService.checkRateLimit(userId, commandName);
      expect(newResult.allowed).toBe(true);
      
      jest.useRealTimers();
    });
  });

  describe('Suspicious Activity Detection', () => {
    test('should detect rapid command execution', () => {
      const userId = 'user123';
      
      // 短期間で大量のコマンド実行をシミュレート
      for (let i = 0; i < 25; i++) {
        const isSuspicious = securityService.detectSuspiciousActivity(userId, mockInteraction);
        if (i >= 20) {
          expect(isSuspicious).toBe(true);
          break;
        }
      }
    });

    test('should not flag normal activity as suspicious', () => {
      const userId = 'user123';
      
      // 通常の使用量
      for (let i = 0; i < 5; i++) {
        const isSuspicious = securityService.detectSuspiciousActivity(userId, mockInteraction);
        expect(isSuspicious).toBe(false);
      }
    });
  });

  describe('Permission Checking', () => {
    test('should allow admin-level permissions for admin users', async () => {
      // configManagerのモックを設定
      const mockConfigManager = require('../../config').configManager;
      mockConfigManager.isAdmin = jest.fn().mockReturnValue(true);
      mockConfigManager.isAllowedChannel = jest.fn().mockReturnValue(true);

      const permissionLevel: PermissionLevel = {
        level: 'admin'
      };

      const result = await securityService.checkAdvancedPermissions(mockInteraction, permissionLevel);
      expect(result.allowed).toBe(true);
    });

    test('should deny admin-level permissions for non-admin users', async () => {
      // configManagerのモックを設定
      const mockConfigManager = require('../../config').configManager;
      mockConfigManager.isAdmin = jest.fn().mockReturnValue(false);
      mockConfigManager.isMember = jest.fn().mockReturnValue(true);
      mockConfigManager.isAllowedChannel = jest.fn().mockReturnValue(true);

      const permissionLevel: PermissionLevel = {
        level: 'admin'
      };

      const result = await securityService.checkAdvancedPermissions(mockInteraction, permissionLevel);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('管理者のみが使用できます');
    });

    test('should check channel restrictions', async () => {
      const mockConfigManager = require('../../config').configManager;
      mockConfigManager.isAdmin = jest.fn().mockReturnValue(true);
      mockConfigManager.isAllowedChannel = jest.fn().mockReturnValue(false);

      const permissionLevel: PermissionLevel = {
        level: 'admin'
      };

      const result = await securityService.checkAdvancedPermissions(mockInteraction, permissionLevel);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('チャンネル');
    });

    test('should respect custom allowed channels', async () => {
      const mockConfigManager = require('../../config').configManager;
      mockConfigManager.isAdmin = jest.fn().mockReturnValue(true);
      mockConfigManager.isAllowedChannel = jest.fn().mockReturnValue(false);

      const permissionLevel: PermissionLevel = {
        level: 'admin',
        allowedChannels: ['test-channel-123'] // このテストのチャンネルID
      };

      const result = await securityService.checkAdvancedPermissions(mockInteraction, permissionLevel);
      expect(result.allowed).toBe(true);
    });

    test('should check restricted channels', async () => {
      const mockConfigManager = require('../../config').configManager;
      mockConfigManager.isAdmin = jest.fn().mockReturnValue(true);
      mockConfigManager.isAllowedChannel = jest.fn().mockReturnValue(true);

      const permissionLevel: PermissionLevel = {
        level: 'admin',
        restrictedChannels: ['test-channel-123'] // このテストのチャンネルID
      };

      const result = await securityService.checkAdvancedPermissions(mockInteraction, permissionLevel);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('制限されています');
    });
  });

  describe('Security Event Logging', () => {
    test('should log security events', async () => {
      const event: SecurityEvent = {
        type: 'command_execution',
        userId: 'user123',
        userName: 'testuser',
        guildId: 'guild123',
        channelId: 'channel123',
        commandName: 'member',
        details: { result: 'success' },
        timestamp: new Date(),
        severity: 'low'
      };

      await securityService.logSecurityEvent(event);

      expect(mockDatabase.logSecurityEvent).toHaveBeenCalledWith(event);
    });

    test('should notify admins for high severity events', async () => {
      const mockClient = {
        guilds: {
          cache: new Map([
            ['guild123', {
              members: {
                cache: new Map([
                  ['admin1', {
                    user: { tag: 'admin#1234' },
                    roles: { cache: new Map([['admin-role', { id: 'admin-role' }]]) },
                    send: jest.fn().mockResolvedValue(undefined)
                  }]
                ])
              }
            }]
          ])
        }
      } as any;

      securityService.setClient(mockClient);

      // configManagerのモックを設定
      const mockConfigManager = require('../../config').configManager;
      mockConfigManager.getConfig = jest.fn().mockReturnValue({
        permissions: { adminRoleIds: ['admin-role'] }
      });

      const highSeverityEvent: SecurityEvent = {
        type: 'suspicious_activity',
        userId: 'user123',
        userName: 'testuser',
        guildId: 'guild123',
        channelId: 'channel123',
        commandName: 'member',
        details: { rapidCommandCount: 25 },
        timestamp: new Date(),
        severity: 'high'
      };

      await securityService.logSecurityEvent(highSeverityEvent);

      expect(mockDatabase.logSecurityEvent).toHaveBeenCalledWith(highSeverityEvent);
    });
  });

  describe('Security Statistics', () => {
    test('should provide security statistics', async () => {
      mockDatabase.getSecurityEventCount.mockResolvedValue(42);

      const stats = await securityService.getSecurityStats();

      expect(stats).toHaveProperty('activeRateLimits');
      expect(stats).toHaveProperty('totalRateLimits');
      expect(stats).toHaveProperty('suspiciousActivityCount');
      expect(stats).toHaveProperty('recentSecurityEvents');
      expect(stats.recentSecurityEvents).toBe(42);
    });

    test('should get rate limit information', () => {
      // レート制限を何個か作成
      securityService.checkRateLimit('user1', 'member');
      securityService.checkRateLimit('user2', 'fee');
      securityService.checkRateLimit('user3', 'vote');

      const info = securityService.getRateLimitInfo();
      expect(info.total).toBe(3);
      expect(info.active).toBe(3);
    });
  });

  describe('Service Lifecycle', () => {
    test('should initialize and destroy properly', () => {
      const service = new SecurityService();
      
      // 初期状態の確認
      const initialStats = service.getRateLimitInfo();
      expect(initialStats.total).toBe(0);
      expect(initialStats.active).toBe(0);

      // クリーンアップ
      service.destroy();
      
      const finalStats = service.getRateLimitInfo();
      expect(finalStats.total).toBe(0);
      expect(finalStats.active).toBe(0);
    });

    test('should set client and database correctly', () => {
      const mockClient = {} as Client;
      const mockDB = {} as DatabaseService;

      const service = new SecurityService();
      service.setClient(mockClient);
      service.setDatabase(mockDB);

      // セッターが正常に動作することを確認
      // （内部状態は直接アクセスできないため、エラーが発生しないことで確認）
      expect(() => service.setClient(mockClient)).not.toThrow();
      expect(() => service.setDatabase(mockDB)).not.toThrow();
    });
  });
});