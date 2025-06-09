import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { env } from '../../utils/env';
import { logger } from '../../utils/logger';
import { Member, AuditLog, DatabaseSchema } from '../../types';

export class DatabaseService {
  private static instance: DatabaseService | null = null;
  private db: sqlite3.Database | null = null;
  private dbPath: string;

  constructor() {
    this.dbPath = env.DATABASE_PATH;
  }

  public static async getInstance(): Promise<DatabaseService> {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
      await DatabaseService.instance.initialize();
    }
    return DatabaseService.instance;
  }

  public async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ensureDatabaseDirectory();
        
        this.db = new sqlite3.Database(this.dbPath, (err) => {
          if (err) {
            logger.error('データベースの初期化に失敗しました', { error: err.message });
            reject(err);
          } else {
            this.createTables().then(() => {
              logger.info('データベースの初期化が完了しました');
              resolve();
            }).catch(reject);
          }
        });
      } catch (error) {
        logger.error('データベースの初期化に失敗しました', { error: error.message });
        reject(error);
      }
    });
  }

  private ensureDatabaseDirectory(): void {
    const dbDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    // まずテーブルを作成
    await this.createTablesIfNotExists();
    
    // 次にマイグレーションを実行
    await this.runMigrations();
  }

  private async createTablesIfNotExists(): Promise<void> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    const tables = [
      `CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        discord_display_name TEXT NOT NULL,
        discord_username TEXT NOT NULL,
        student_id TEXT UNIQUE NOT NULL,
        gender TEXT NOT NULL,
        team TEXT NOT NULL,
        membership_fee_record TEXT NOT NULL DEFAULT '未納',
        grade TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        old_value TEXT,
        new_value TEXT,
        result TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS security_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        type TEXT NOT NULL,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        guild_id TEXT,
        channel_id TEXT,
        command_name TEXT,
        details TEXT,
        severity TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS sync_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sync_type TEXT NOT NULL,
        last_sync_timestamp DATETIME NOT NULL,
        sheet_last_modified DATETIME,
        records_processed INTEGER DEFAULT 0,
        records_updated INTEGER DEFAULT 0,
        records_added INTEGER DEFAULT 0,
        records_skipped INTEGER DEFAULT 0,
        sync_duration INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'completed',
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
    ];

    return new Promise((resolve, reject) => {
      let completed = 0;
      tables.forEach((sql) => {
        this.db!.run(sql, (err) => {
          if (err) {
            reject(err);
          } else {
            completed++;
            if (completed === tables.length) {
              logger.info('データベーステーブルの作成が完了しました');
              resolve();
            }
          }
        });
      });
    });
  }

  private async runMigrations(): Promise<void> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    // 将来的にマイグレーションが必要な場合はここに追加
    const migrations: any[] = [];

    for (const migration of migrations) {
      try {
        await new Promise<void>((resolve, reject) => {
          this.db!.run(migration.sql, (err) => {
            if (err) {
              // カラムが既に存在する場合のエラーは無視
              if (err.message.includes('duplicate column name')) {
                logger.debug(`マイグレーション ${migration.name} はスキップされました（カラムが既に存在）`);
                resolve();
              } else {
                reject(err);
              }
            } else {
              logger.info(`マイグレーション ${migration.name} が完了しました`);
              resolve();
            }
          });
        });
      } catch (error) {
        logger.error(`マイグレーション ${migration.name} に失敗しました`, { error: error.message });
        // マイグレーションエラーは致命的ではないので続行
      }
    }
  }

  public async insertMember(member: Member, discordId: string): Promise<void> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    const sql = `
      INSERT INTO members (
        discord_id, name, discord_display_name, discord_username,
        student_id, gender, team, membership_fee_record, grade
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    return new Promise((resolve, reject) => {
      this.db!.run(sql, [
        discordId,
        member.name,
        member.discordDisplayName,
        member.discordUsername,
        member.studentId,
        member.gender,
        member.team,
        member.membershipFeeRecord,
        member.grade.toString(),
      ], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public async getMemberByDiscordId(discordId: string): Promise<any | null> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    const sql = 'SELECT * FROM members WHERE discord_id = ?';
    return new Promise((resolve, reject) => {
      this.db!.get(sql, [discordId], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  public async getAllMembers(limit?: number, offset?: number): Promise<any[]> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    let sql = 'SELECT * FROM members ORDER BY name';
    const params: any[] = [];
    
    if (limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(limit.toString());
      
      if (offset !== undefined) {
        sql += ' OFFSET ?';
        params.push(offset.toString());
      }
    }

    return new Promise((resolve, reject) => {
      this.db!.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  public async updateMember(discordId: string, updates: Record<string, any>): Promise<void> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    const fields = Object.keys(updates);
    if (fields.length === 0) return;

    const setClause = fields.map(field => `${this.camelToSnake(field)} = ?`).join(', ');
    const values = fields.map(field => updates[field]);

    const sql = `UPDATE members SET ${setClause} WHERE discord_id = ?`;
    return new Promise((resolve, reject) => {
      this.db!.run(sql, [...values, discordId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public async searchMembers(query: string, limit?: number, offset?: number): Promise<any[]> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    let sql = `
      SELECT * FROM members 
      WHERE name LIKE ? 
         OR discord_display_name LIKE ? 
         OR discord_username LIKE ? 
         OR student_id LIKE ?
      ORDER BY name
    `;
    
    const searchQuery = `%${query}%`;
    const params = [searchQuery, searchQuery, searchQuery, searchQuery];
    
    if (limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(limit.toString());
      
      if (offset !== undefined) {
        sql += ' OFFSET ?';
        params.push(offset.toString());
      }
    }

    return new Promise((resolve, reject) => {
      this.db!.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  public async getMemberByDiscordUsername(discordUsername: string): Promise<any | null> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    const sql = 'SELECT * FROM members WHERE discord_username = ?';
    return new Promise((resolve, reject) => {
      this.db!.get(sql, [discordUsername], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  public async getMemberByStudentId(studentId: string): Promise<any | null> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    const sql = 'SELECT * FROM members WHERE student_id = ?';
    return new Promise((resolve, reject) => {
      this.db!.get(sql, [studentId], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  public async getUnpaidMembers(): Promise<any[]> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    const sql = "SELECT * FROM members WHERE membership_fee_record LIKE '%未納%' ORDER BY name";
    return new Promise((resolve, reject) => {
      this.db!.all(sql, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }


  public async insertAuditLog(log: AuditLog): Promise<void> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    const sql = `
      INSERT INTO audit_logs (timestamp, user_id, action, target, old_value, new_value, result)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    return new Promise((resolve, reject) => {
      this.db!.run(sql, [
        log.timestamp.toISOString(),
        log.userId,
        log.action,
        log.target,
        log.oldValue ? JSON.stringify(log.oldValue) : null,
        log.newValue ? JSON.stringify(log.newValue) : null,
        log.result,
      ], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  public getMemoryUsage(): { heapUsed: string; heapTotal: string; rss: string } {
    const memUsage = process.memoryUsage();
    return {
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
      rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`
    };
  }

  public async getTotalMembersCount(): Promise<number> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    // OBを除外して部員数をカウント
    const sql = "SELECT COUNT(*) as count FROM members WHERE grade != 'OB'";
    return new Promise((resolve, reject) => {
      this.db!.get(sql, (err, row: any) => {
        if (err) reject(err);
        else resolve(row.count || 0);
      });
    });
  }

  public async getAuditLogsByUser(userId: string, action?: string): Promise<any[]> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    let sql = 'SELECT * FROM audit_logs WHERE user_id = ?';
    const params = [userId];
    
    if (action) {
      sql += ' AND action = ?';
      params.push(action);
    }
    
    sql += ' ORDER BY timestamp DESC';

    return new Promise((resolve, reject) => {
      this.db!.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  public async logSecurityEvent(event: {
    type: string;
    userId: string;
    userName: string;
    guildId?: string;
    channelId?: string;
    commandName?: string;
    details?: Record<string, any>;
    timestamp: Date;
    severity: string;
  }): Promise<void> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    const sql = `
      INSERT INTO security_events (
        type, user_id, user_name, guild_id, channel_id, 
        command_name, details, severity, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    return new Promise((resolve, reject) => {
      this.db!.run(sql, [
        event.type,
        event.userId,
        event.userName,
        event.guildId || null,
        event.channelId || null,
        event.commandName || null,
        event.details ? JSON.stringify(event.details) : null,
        event.severity,
        event.timestamp.toISOString()
      ], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public async getSecurityEventCount(hoursBack: number): Promise<number> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    const cutoffTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
    const sql = 'SELECT COUNT(*) as count FROM security_events WHERE timestamp >= ?';
    
    return new Promise((resolve, reject) => {
      this.db!.get(sql, [cutoffTime], (err, row: any) => {
        if (err) reject(err);
        else resolve(row.count || 0);
      });
    });
  }

  public async getSecurityEvents(
    limit: number = 50,
    severity?: string,
    type?: string
  ): Promise<any[]> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    let sql = 'SELECT * FROM security_events WHERE 1=1';
    const params: any[] = [];

    if (severity) {
      sql += ' AND severity = ?';
      params.push(severity);
    }

    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }

    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    return new Promise((resolve, reject) => {
      this.db!.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  public async cleanupOldSecurityEvents(daysOld: number = 30): Promise<number> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    const cutoffTime = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
    const sql = 'DELETE FROM security_events WHERE timestamp < ?';
    
    return new Promise((resolve, reject) => {
      this.db!.run(sql, [cutoffTime], function(err) {
        if (err) reject(err);
        else resolve(this.changes || 0);
      });
    });
  }

  // 同期メタデータ関連のメソッド
  public async getLastSyncMetadata(syncType: string = 'sheet-to-db'): Promise<any | null> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    const sql = 'SELECT * FROM sync_metadata WHERE sync_type = ? ORDER BY created_at DESC LIMIT 1';
    
    return new Promise((resolve, reject) => {
      this.db!.get(sql, [syncType], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  public async saveSyncMetadata(metadata: {
    syncType: string;
    lastSyncTimestamp: Date;
    sheetLastModified?: Date;
    recordsProcessed: number;
    recordsUpdated: number;
    recordsAdded: number;
    recordsSkipped: number;
    syncDuration: number;
    status: string;
    errorMessage?: string;
  }): Promise<void> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    const sql = `
      INSERT INTO sync_metadata (
        sync_type, last_sync_timestamp, sheet_last_modified,
        records_processed, records_updated, records_added, records_skipped,
        sync_duration, status, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    return new Promise((resolve, reject) => {
      this.db!.run(sql, [
        metadata.syncType,
        metadata.lastSyncTimestamp.toISOString(),
        metadata.sheetLastModified?.toISOString() || null,
        metadata.recordsProcessed,
        metadata.recordsUpdated,
        metadata.recordsAdded,
        metadata.recordsSkipped,
        metadata.syncDuration,
        metadata.status,
        metadata.errorMessage || null
      ], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public async getMembersUpdatedAfter(timestamp: Date): Promise<any[]> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    const sql = 'SELECT * FROM members WHERE updated_at > ? ORDER BY updated_at DESC';
    
    return new Promise((resolve, reject) => {
      this.db!.all(sql, [timestamp.toISOString()], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  public async updateMemberWithTimestamp(discordId: string, updates: any): Promise<void> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    const fields = Object.keys(updates);
    const values = Object.values(updates);
    
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const sql = `UPDATE members SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE discord_id = ?`;
    
    return new Promise((resolve, reject) => {
      this.db!.run(sql, [...values, discordId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }


  public async query(sql: string, params: any[] = []): Promise<any[]> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    return new Promise((resolve, reject) => {
      if (sql.trim().toLowerCase().startsWith('select')) {
        // SELECT クエリ
        this.db!.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      } else {
        // INSERT, UPDATE, DELETE クエリ
        this.db!.run(sql, params, function(err) {
          if (err) reject(err);
          else resolve([{ changes: this.changes, lastID: this.lastID }]);
        });
      }
    });
  }



  public async close(): Promise<void> {
    if (this.db) {
      return new Promise((resolve) => {
        this.db!.close((err) => {
          if (err) {
            logger.error('データベース接続の終了でエラーが発生しました', { error: err.message });
          } else {
            logger.info('データベース接続を閉じました');
          }
          this.db = null;
          resolve();
        });
      });
    }
  }

  // フォーム関連のメソッド（スタブ実装）
  public async createForm(form: any): Promise<any> {
    logger.warn('createForm メソッドは未実装です');
    return { ...form, id: Date.now().toString() };
  }

  public async getFormById(id: string): Promise<any | null> {
    logger.warn('getFormById メソッドは未実装です');
    return null;
  }

  public async updateFormState(id: string, state: string): Promise<void> {
    logger.warn('updateFormState メソッドは未実装です');
  }

  public async deleteForm(id: string): Promise<void> {
    logger.warn('deleteForm メソッドは未実装です');
  }

  public async updateForm(id: string, updates: any): Promise<void> {
    logger.warn('updateForm メソッドは未実装です');
  }

  public async getActiveForms(userId?: string): Promise<any[]> {
    logger.warn('getActiveForms メソッドは未実装です');
    return [];
  }

  public async getAllForms(): Promise<any[]> {
    logger.warn('getAllForms メソッドは未実装です');
    return [];
  }

  public async hasUserResponded(formId: string, userId: string): Promise<boolean> {
    logger.warn('hasUserResponded メソッドは未実装です');
    return false;
  }

  public async getFormResponses(formId: string): Promise<any[]> {
    logger.warn('getFormResponses メソッドは未実装です');
    return [];
  }

  public async setFormMessage(formId: string, messageId: string, channelId: string): Promise<void> {
    logger.warn('setFormMessage メソッドは未実装です');
  }

  public async getExpiredForms(): Promise<any[]> {
    logger.warn('getExpiredForms メソッドは未実装です');
    return [];
  }

  public async recordFormResponse(data: any): Promise<void> {
    logger.warn('recordFormResponse メソッドは未実装です');
  }

  public async isTokenUsed(token: string): Promise<boolean> {
    logger.warn('isTokenUsed メソッドは未実装です');
    return false;
  }
}