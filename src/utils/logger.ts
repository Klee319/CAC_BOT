import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import fs from 'fs';
import path from 'path';
import { LogLevel } from '../types';
import { configManager } from '../config';

class Logger {
  private static instance: Logger;
  private logger: winston.Logger;

  private constructor() {
    this.createLogsDirectory();
    this.logger = this.createLogger();
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private createLogsDirectory(): void {
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
  }

  private createLogger(): winston.Logger {
    const config = configManager.getConfig();
    const transports: winston.transport[] = [];

    if (config.logging && config.logging.enableFileLogging) {
      const dailyRotateFileTransport = new DailyRotateFile({
        filename: path.join(process.cwd(), 'logs', 'app-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        level: config.logging.level,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        ),
        maxSize: '20m',
        maxFiles: '7d',
        zippedArchive: true,
        auditFile: path.join(process.cwd(), 'logs', 'audit.json')
      });

      dailyRotateFileTransport.on('rotate', (oldFilename, newFilename) => {
        console.log(`ログファイルがローテーションされました: ${oldFilename} -> ${newFilename}`);
      });

      dailyRotateFileTransport.on('archive', (zipFilename) => {
        console.log(`ログファイルがアーカイブされました: ${zipFilename}`);
      });

      transports.push(dailyRotateFileTransport);
    }

    if (config.logging && config.logging.enableConsoleLogging) {
      transports.push(
        new winston.transports.Console({
          level: config.logging.level,
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
              return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
            })
          ),
        })
      );
    }

    const logLevel = config.logging?.level || 'info';
    
    return winston.createLogger({
      level: logLevel,
      transports,
      exceptionHandlers: transports,
      rejectionHandlers: transports,
    });
  }

  public error(message: string, meta?: any): void {
    this.logger.error(message, meta);
  }

  public warn(message: string, meta?: any): void {
    this.logger.warn(message, meta);
  }

  public info(message: string, meta?: any): void {
    this.logger.info(message, meta);
  }

  public debug(message: string, meta?: any): void {
    this.logger.debug(message, meta);
  }

  public async logToDiscord(level: LogLevel, message: string, meta?: any): Promise<void> {
    const config = configManager.getConfig();
    if (!config.logging?.enableDiscordLogging || !config.notifications?.systemNotifications?.channelId) {
      return;
    }

    if (level === 'error' || level === 'warn') {
      try {
        const { Client } = require('discord.js');
        const client = Client.getInstance?.();
        if (client) {
          const channel = await client.channels.fetch(config.notifications.systemNotifications.channelId);
          if (channel?.isTextBased()) {
            const embed = {
              color: level === 'error' ? 0xff0000 : 0xffaa00,
              title: `${level.toUpperCase()}: システム通知`,
              description: message,
              timestamp: new Date().toISOString(),
              fields: meta ? [{ name: 'メタデータ', value: JSON.stringify(meta, null, 2) }] : [],
            };
            await channel.send({ embeds: [embed] });
          }
        }
      } catch (error) {
        this.logger.error('Discord への ログ送信に失敗しました', { error: error.message });
      }
    }
  }

  public updateConfig(): void {
    this.logger = this.createLogger();
  }
}

export const logger = Logger.getInstance();