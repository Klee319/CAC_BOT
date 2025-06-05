import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { env } from '../../utils/env';
import { logger } from '../../utils/logger';
import { Member, Vote, VoteResponse, AuditLog, DatabaseSchema } from '../../types';

export class DatabaseService {
  private db: sqlite3.Database | null = null;
  private dbPath: string;

  constructor() {
    this.dbPath = env.DATABASE_PATH;
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
      `CREATE TABLE IF NOT EXISTS votes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        form_url TEXT NOT NULL,
        deadline DATETIME NOT NULL,
        created_by TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active INTEGER DEFAULT 1,
        allow_edit INTEGER DEFAULT 1,
        anonymous INTEGER DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS vote_responses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vote_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        responses TEXT NOT NULL,
        submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(vote_id, user_id)
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
      )`
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

  public async insertVote(vote: Vote): Promise<void> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    const sql = `
      INSERT INTO votes (
        id, title, description, form_url, deadline, created_by,
        is_active, allow_edit, anonymous
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    return new Promise((resolve, reject) => {
      this.db!.run(sql, [
        vote.id,
        vote.title,
        vote.description,
        vote.formUrl,
        vote.deadline.toISOString(),
        vote.createdBy,
        vote.isActive ? 1 : 0,
        vote.allowEdit ? 1 : 0,
        vote.anonymous ? 1 : 0,
      ], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public async getVote(voteId: string): Promise<any | null> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    const sql = 'SELECT * FROM votes WHERE id = ?';
    return new Promise((resolve, reject) => {
      this.db!.get(sql, [voteId], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  public async getActiveVotes(): Promise<any[]> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    const sql = 'SELECT * FROM votes WHERE is_active = 1 ORDER BY created_at DESC';
    return new Promise((resolve, reject) => {
      this.db!.all(sql, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  public async updateVote(voteId: string, updates: Record<string, any>): Promise<void> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    const fields = Object.keys(updates);
    if (fields.length === 0) return;

    const setClause = fields.map(field => `${this.camelToSnake(field)} = ?`).join(', ');
    const values = fields.map(field => updates[field]);

    const sql = `UPDATE votes SET ${setClause} WHERE id = ?`;
    return new Promise((resolve, reject) => {
      this.db!.run(sql, [...values, voteId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public async insertVoteResponse(voteId: string, userId: string, responses: Record<string, any>): Promise<void> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    const sql = `
      INSERT OR REPLACE INTO vote_responses (vote_id, user_id, responses, submitted_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `;

    return new Promise((resolve, reject) => {
      this.db!.run(sql, [
        voteId,
        userId,
        JSON.stringify(responses)
      ], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public async getVoteResponse(voteId: string, userId: string): Promise<any | null> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    const sql = 'SELECT * FROM vote_responses WHERE vote_id = ? AND user_id = ?';
    return new Promise((resolve, reject) => {
      this.db!.get(sql, [voteId, userId], (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  public async getVoteResponses(voteId: string): Promise<any[]> {
    if (!this.db) throw new Error('データベースが初期化されていません');

    const sql = 'SELECT * FROM vote_responses WHERE vote_id = ? ORDER BY submitted_at ASC';
    return new Promise((resolve, reject) => {
      this.db!.all(sql, [voteId], (err, rows) => {
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

    const sql = 'SELECT COUNT(*) as count FROM members';
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
}