import { Config } from '../types';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

const ConfigSchema = z.object({
  sheetColumns: z.object({
    name: z.string(),
    discordDisplayName: z.string(),
    discordUsername: z.string(),
    studentId: z.string(),
    gender: z.string(),
    team: z.string(),
    membershipFeeRecord: z.string(),
    grade: z.string(),
  }),
  permissions: z.object({
    adminRoleIds: z.array(z.string()),
    memberRoleIds: z.array(z.string()),
    allowedChannelIds: z.array(z.string()),
  }),
  notifications: z.object({
    feeReminder: z.object({
      enabled: z.boolean(),
      schedule: z.string(),
      channelId: z.string(),
    }),
    systemNotifications: z.object({
      channelId: z.string(),
    }),
  }),
  sheets: z.object({
    spreadsheetId: z.string(),
    sheetName: z.string(),
  }),
  registration: z.object({
    welcomeMessage: z.string(),
  }),
  database: z.object({
    path: z.string(),
    backupEnabled: z.boolean(),
    backupSchedule: z.string(),
  }),
  api: z.object({
    retryAttempts: z.number(),
    retryDelay: z.number(),
    rateLimit: z.object({
      requests: z.number(),
      window: z.number(),
    }),
  }),
  logging: z.object({
    level: z.string(),
    enableFileLogging: z.boolean(),
    enableDiscordLogging: z.boolean(),
    enableConsoleLogging: z.boolean(),
    rotationSchedule: z.string(),
  }),
});

class ConfigManager {
  private static instance: ConfigManager;
  private config: Config;
  private configPath: string;

  private constructor() {
    this.configPath = path.join(process.cwd(), 'config.json');
    this.config = this.loadConfig();
  }

  public static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  private loadConfig(): Config {
    try {
      const configFile = fs.readFileSync(this.configPath, 'utf-8');
      const parsedConfig = JSON.parse(configFile);
      return ConfigSchema.parse(parsedConfig) as Config;
    } catch (error) {
      throw new Error(`設定ファイルの読み込みに失敗しました: ${error}`);
    }
  }

  public getConfig(): Config {
    return this.config;
  }

  public updateConfig(updates: any): void {
    this.config = { ...this.config, ...updates };
    this.saveConfig();
  }

  public updateSheetConfig(updates: any): void {
    this.config.sheets = { ...this.config.sheets, ...updates };
    this.saveConfig();
  }

  public updatePermissions(updates: any): void {
    this.config.permissions = { ...this.config.permissions, ...updates };
    this.saveConfig();
  }

  public updateNotifications(updates: any): void {
    this.config.notifications = { ...this.config.notifications, ...updates };
    this.saveConfig();
  }

  private saveConfig(): void {
    try {
      const configData = JSON.stringify(this.config, null, 2);
      fs.writeFileSync(this.configPath, configData, 'utf-8');
    } catch (error) {
      throw new Error(`設定ファイルの保存に失敗しました: ${error}`);
    }
  }

  public reloadConfig(): void {
    this.config = this.loadConfig();
  }

  public isAdmin(roleIds: string[]): boolean {
    return roleIds.some(roleId => this.config.permissions.adminRoleIds.includes(roleId));
  }

  public isMember(roleIds: string[]): boolean {
    return roleIds.some(roleId => this.config.permissions.memberRoleIds.includes(roleId));
  }

  public isAllowedChannel(channelId: string): boolean {
    return this.config.permissions.allowedChannelIds.length === 0 || 
           this.config.permissions.allowedChannelIds.includes(channelId);
  }
}

export const configManager = ConfigManager.getInstance();