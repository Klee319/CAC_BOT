import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { env } from './utils/env';
import { logger } from './utils/logger';
import { configManager } from './config';
import { DatabaseService } from './services/database';
import { GoogleSheetsService } from './services/google';
import { RegistrationService } from './services/registration';
import { FeeManagementService } from './services/fee';
import { SecurityService } from './services/security';
import { notificationService } from './services/notification';
import { syncService } from './services/sync';
import { initializeSecurityService } from './utils/permissions';
import fs from 'fs';
import path from 'path';

class CACBot {
  private client: Client;
  private databaseService: DatabaseService;
  private googleSheetsService: GoogleSheetsService;
  private registrationService: RegistrationService;
  private feeManagementService: FeeManagementService;
  private securityService: SecurityService;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [
        Partials.Channel,
        Partials.Message,
        Partials.User,
        Partials.GuildMember,
      ],
    });

    this.databaseService = new DatabaseService();
    this.googleSheetsService = new GoogleSheetsService();
    this.registrationService = new RegistrationService(this.googleSheetsService, this.databaseService);
    this.feeManagementService = new FeeManagementService(this.databaseService);
    this.securityService = new SecurityService(this.databaseService);
    this.setupEventHandlers();
  }

  private async setupEventHandlers(): Promise<void> {
    this.client.once('ready', async () => {
      logger.info(`BOT が正常に起動しました: ${this.client.user?.tag}`);
      logger.info(`サーバー数: ${this.client.guilds.cache.size}`);
      
      try {
        await this.databaseService.initialize();
        logger.info('データベースの初期化が完了しました');
        
        // 通知サービスの初期化
        notificationService.setClient(this.client);
        logger.info('通知サービスが初期化されました');
        
        // 登録サービスの初期化
        this.registrationService.setClient(this.client);
        this.registrationService.startRegistrationMonitoring(10); // 10分間隔
        logger.info('登録サービスが初期化されました');
        
        // 部費管理サービスの初期化
        this.feeManagementService.setClient(this.client);
        this.feeManagementService.startFeeReminder();
        logger.info('部費管理サービスが初期化されました');
        
        
        // セキュリティサービスの初期化
        this.securityService.setClient(this.client);
        this.securityService.setDatabase(this.databaseService);
        initializeSecurityService(this.databaseService);
        logger.info('セキュリティサービスが初期化されました');
        
        // 同期サービスの初期化
        await syncService.performInitialSync();
        syncService.startPeriodicSync();
        logger.info('同期サービスが初期化されました');
        
        
        await this.loadCommands();
        await this.loadEvents();
        
        // メモリ監視の開始
        this.startMemoryMonitoring();
        
        logger.info('CAC BOT の起動が完了しました');
        
        // システム通知を送信
        await notificationService.sendSystemNotification(
          'BOT起動完了',
          `CAC BOTが正常に起動しました。サーバー数: ${this.client.guilds.cache.size}`
        );
        
      } catch (error) {
        logger.error('BOT の初期化中にエラーが発生しました', { error: error.message });
        process.exit(1);
      }
    });

    this.client.on('error', (error) => {
      logger.error('Discord クライアントエラー', { error: error.message });
    });

    this.client.on('warn', (warning) => {
      logger.warn('Discord クライアント警告', { warning });
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('未処理の Promise 拒否', { reason, promise });
    });

    process.on('uncaughtException', (error) => {
      logger.error('未キャッチの例外', { error: error.message });
      process.exit(1);
    });

    process.on('SIGINT', async () => {
      logger.info('終了シグナルを受信しました。BOT をシャットダウンします...');
      await this.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      logger.info('終了シグナルを受信しました。BOT をシャットダウンします...');
      await this.shutdown();
      process.exit(0);
    });
  }

  private async loadCommands(): Promise<void> {
    const commandsPath = path.join(__dirname, 'bot', 'commands');
    
    if (!fs.existsSync(commandsPath)) {
      logger.warn('コマンドディレクトリが見つかりません');
      return;
    }

    const commandFiles = fs.readdirSync(commandsPath).filter(file => 
      (file.endsWith('.js') || file.endsWith('.ts')) && !file.endsWith('.d.ts')
    );

    for (const file of commandFiles) {
      try {
        const commandModule = await import(path.join(commandsPath, file));
        const command = commandModule.default || commandModule;
        
        if (command && command.data && command.execute) {
          logger.info(`コマンドを読み込みました: ${command.data.name}`);
        }
      } catch (error) {
        logger.error(`コマンドファイルの読み込みに失敗しました: ${file}`, { error: error.message });
      }
    }
  }

  private async loadEvents(): Promise<void> {
    const eventsPath = path.join(__dirname, 'bot', 'events');
    
    if (!fs.existsSync(eventsPath)) {
      logger.warn('イベントディレクトリが見つかりません');
      return;
    }

    const eventFiles = fs.readdirSync(eventsPath).filter(file => 
      (file.endsWith('.js') || file.endsWith('.ts')) && !file.endsWith('.d.ts')
    );

    for (const file of eventFiles) {
      try {
        const eventModule = await import(path.join(eventsPath, file));
        const event = eventModule.default || eventModule;
        
        if (event && event.name && event.execute) {
          if (event.once) {
            this.client.once(event.name, (...args) => event.execute(...args));
          } else {
            this.client.on(event.name, (...args) => event.execute(...args));
          }
          logger.info(`イベントを読み込みました: ${event.name}`);
        }
      } catch (error) {
        logger.error(`イベントファイルの読み込みに失敗しました: ${file}`, { error: error.message });
      }
    }
  }

  private startMemoryMonitoring(): void {
    // 30分ごとにメモリ使用状況をログに出力
    setInterval(() => {
      const memUsage = this.databaseService.getMemoryUsage();
      logger.info('メモリ使用状況', memUsage);
      
      // ヒープ使用量が3GB以上の場合は警告
      const heapUsedMB = parseInt(memUsage.heapUsed.replace('MB', ''));
      if (heapUsedMB > 3072) {
        logger.warn('メモリ使用量が高くなっています', { 
          heapUsed: memUsage.heapUsed,
          threshold: '3GB'
        });
      }
    }, 30 * 60 * 1000); // 30分間隔

    // プロセス終了時の警告
    process.on('warning', (warning) => {
      if (warning.name === 'MaxListenersExceededWarning') {
        logger.warn('EventEmitterの最大リスナー数を超過しました', { 
          warning: warning.message 
        });
      }
    });
  }

  private async shutdown(): Promise<void> {
    try {
      logger.info('BOT をシャットダウンしています...');
      
      // 通知サービスの停止
      notificationService.destroy();
      logger.info('通知サービスを停止しました');
      
      // 登録サービスの停止
      this.registrationService.stopRegistrationMonitoring();
      logger.info('登録サービスを停止しました');
      
      // 部費管理サービスの停止
      this.feeManagementService.stopFeeReminder();
      logger.info('部費管理サービスを停止しました');
      
      
      // セキュリティサービスの停止
      this.securityService.destroy();
      logger.info('セキュリティサービスを停止しました');
      
      // 同期サービスの停止
      syncService.stopPeriodicSync();
      logger.info('同期サービスを停止しました');
      
      
      await this.databaseService.close();
      logger.info('データベース接続を閉じました');
      
      this.client.destroy();
      logger.info('Discord クライアントを破棄しました');
      
    } catch (error) {
      logger.error('シャットダウン中にエラーが発生しました', { error: error.message });
    }
  }

  public async start(): Promise<void> {
    try {
      logger.info('CAC BOT を起動しています...');
      await this.client.login(env.DISCORD_TOKEN);
    } catch (error) {
      logger.error('BOT のログインに失敗しました', { error: error.message });
      process.exit(1);
    }
  }

  public getClient(): Client {
    return this.client;
  }

  public getDatabaseService(): DatabaseService {
    return this.databaseService;
  }

  public getGoogleSheetsService(): GoogleSheetsService {
    return this.googleSheetsService;
  }

  public getRegistrationService(): RegistrationService {
    return this.registrationService;
  }

  public getFeeManagementService(): FeeManagementService {
    return this.feeManagementService;
  }


  public getSecurityService(): SecurityService {
    return this.securityService;
  }

}

const bot = new CACBot();
bot.start().catch((error) => {
  logger.error('BOT の起動に失敗しました', { error: error.message });
  process.exit(1);
});

export default bot;