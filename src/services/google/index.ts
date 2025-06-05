import { google, sheets_v4 } from 'googleapis';
import { env } from '../../utils/env';
import { logger } from '../../utils/logger';
import { configManager } from '../../config';
import { Member, GoogleSheetsRow, MemberSchema } from '../../types';

export class GoogleSheetsService {
  private sheets: sheets_v4.Sheets;
  private auth: any;

  constructor() {
    this.initializeAuth();
    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
    
    // 環境変数の状態をデバッグログ出力
    logger.warn('GoogleSheetsService初期化 - 保護設定確認', {
      PROTECT_SPREADSHEET: process.env.PROTECT_SPREADSHEET
    });
  }

  private initializeAuth(): void {
    try {
      this.auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: env.GOOGLE_CLIENT_EMAIL,
          private_key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          project_id: env.GOOGLE_PROJECT_ID,
        },
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive',
        ],
      });
      logger.info('Google API認証の初期化が完了しました');
    } catch (error) {
      logger.error('Google API認証の初期化に失敗しました', { error: error.message });
      throw error;
    }
  }

  public async readSheet(spreadsheetId: string, range: string): Promise<any[][]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
      });
      return response.data.values || [];
    } catch (error) {
      logger.error('スプレッドシートの読み取りに失敗しました', { 
        error: error.message, 
        spreadsheetId,
        range 
      });
      throw error;
    }
  }

  public async writeSheet(
    spreadsheetId: string, 
    range: string, 
    values: any[][]
  ): Promise<void> {
    // スプレッドシート書き込み保護
    if (process.env.PROTECT_SPREADSHEET === 'true') {
      logger.warn('スプレッドシート保護モード: writeSheetをスキップ', { range, valueCount: values.length });
      return;
    }

    try {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values,
        },
      });
      logger.info('スプレッドシートの書き込みが完了しました', { range });
    } catch (error) {
      logger.error('スプレッドシートの書き込みに失敗しました', { 
        error: error.message,
        spreadsheetId,
        range 
      });
      throw error;
    }
  }

  public async appendToSheet(
    spreadsheetId: string, 
    range: string, 
    values: any[][]
  ): Promise<void> {
    // スプレッドシート書き込み保護
    if (process.env.PROTECT_SPREADSHEET === 'true') {
      logger.warn('スプレッドシート保護モード: appendToSheetをスキップ', { range, valueCount: values.length });
      return;
    }

    try {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values,
        },
      });
      logger.info('スプレッドシートに行を追加しました', { range });
    } catch (error) {
      logger.error('スプレッドシートへの行追加に失敗しました', { 
        error: error.message,
        spreadsheetId,
        range 
      });
      throw error;
    }
  }

  public async getAllMembers(limit?: number, offset?: number): Promise<Member[]> {
    const config = configManager.getConfig();
    if (!config.sheets.spreadsheetId) {
      throw new Error('スプレッドシートIDが設定されていません');
    }

    logger.debug('getAllMembers 開始', {
      spreadsheetId: config.sheets.spreadsheetId,
      sheetName: config.sheets.sheetName,
      limit,
      offset
    });

    try {
      const startRow = offset ? offset + 2 : 2; // ヘッダー行をスキップ
      const endRow = limit ? startRow + limit - 1 : '';
      const range = endRow 
        ? `${config.sheets.sheetName}!A${startRow}:H${endRow}`
        : `${config.sheets.sheetName}!A${startRow}:H`;
      
      logger.debug('スプレッドシート読み込み', { range });
      
      const rows = await this.readSheet(config.sheets.spreadsheetId, range);
      
      logger.warn('スプレッドシートデータ取得結果', { 
        rowCount: rows.length,
        firstRowSample: rows.length > 0 ? rows[0] : null,
        allRows: rows
      });
      
      if (rows.length === 0) {
        logger.warn('スプレッドシートにデータがありません');
        return [];
      }

      // ヘッダーを別途取得
      const headerRange = `${config.sheets.sheetName}!A1:H1`;
      const headerRows = await this.readSheet(config.sheets.spreadsheetId, headerRange);
      const headers = headerRows[0] || [];

      return rows.map(row => this.rowToMember(row || [], headers));
    } catch (error) {
      logger.error('全部員データの取得に失敗しました', { error: error.message });
      throw error;
    }
  }

  public async addMember(member: Member): Promise<void> {
    // スプレッドシート書き込み保護
    if (process.env.PROTECT_SPREADSHEET === 'true') {
      logger.warn('スプレッドシート保護モード: addMemberをスキップ', { memberName: member.name });
      return;
    }

    const config = configManager.getConfig();
    if (!config.sheets.spreadsheetId) {
      throw new Error('スプレッドシートIDが設定されていません');
    }

    try {
      const range = `${config.sheets.sheetName}!A:H`;
      const values = [this.memberToRow(member)];
      
      await this.appendToSheet(config.sheets.spreadsheetId, range, values);
      logger.info('部員データをスプレッドシートに追加しました', { name: member.name });
    } catch (error) {
      logger.error('部員データの追加に失敗しました', { 
        error: error.message, 
        memberName: member.name 
      });
      throw error;
    }
  }

  public async updateMember(member: Member, rowIndex: number): Promise<void> {
    // スプレッドシート書き込み保護
    if (process.env.PROTECT_SPREADSHEET === 'true') {
      logger.warn('スプレッドシート保護モード: updateMemberをスキップ', { memberName: member.name, rowIndex });
      return;
    }

    const config = configManager.getConfig();
    if (!config.sheets.spreadsheetId) {
      throw new Error('スプレッドシートIDが設定されていません');
    }

    try {
      const range = `${config.sheets.sheetName}!A${rowIndex + 2}:H${rowIndex + 2}`;
      const values = [this.memberToRow(member)];
      
      await this.writeSheet(config.sheets.spreadsheetId, range, values);
      logger.info('部員データを更新しました', { name: member.name, rowIndex });
    } catch (error) {
      logger.error('部員データの更新に失敗しました', { 
        error: error.message, 
        memberName: member.name,
        rowIndex 
      });
      throw error;
    }
  }

  public async findMemberRow(member: Member): Promise<number | null> {
    const config = configManager.getConfig();
    if (!config.sheets.spreadsheetId) {
      throw new Error('スプレッドシートIDが設定されていません');
    }

    try {
      const range = `${config.sheets.sheetName}!A:H`;
      const rows = await this.readSheet(config.sheets.spreadsheetId, range);
      
      if (rows.length === 0) {
        return null;
      }

      const dataRows = rows.slice(1);
      
      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i] || [];
        if (row[3] === member.studentId || row[2] === member.discordUsername) {
          return i;
        }
      }
      
      return null;
    } catch (error) {
      logger.error('部員行の検索に失敗しました', { 
        error: error.message, 
        memberName: member.name 
      });
      throw error;
    }
  }

  public async syncMemberToSheets(member: Member): Promise<void> {
    logger.warn('スプレッドシートへの同期が要求されました', { 
      memberName: member.name,
      stackTrace: new Error().stack 
    });
    
    // スプレッドシート書き込み保護
    if (process.env.PROTECT_SPREADSHEET === 'true') {
      logger.warn('スプレッドシート保護モード: syncMemberToSheetsをスキップ', { memberName: member.name });
      return;
    }
    
    try {
      const rowIndex = await this.findMemberRow(member);
      
      if (rowIndex !== null) {
        logger.info('既存の行を更新', { memberName: member.name, rowIndex });
        await this.updateMember(member, rowIndex);
      } else {
        logger.info('新規行を追加', { memberName: member.name });
        await this.addMember(member);
      }
      
      logger.info('部員データの同期が完了しました', { name: member.name });
    } catch (error) {
      logger.error('部員データの同期に失敗しました', { 
        error: error.message, 
        memberName: member.name 
      });
      throw error;
    }
  }

  public async batchSyncMembers(members: Member[], batchSize: number = 10): Promise<void> {
    logger.info('部員データの一括同期を開始します', { count: members.length });
    
    // スプレッドシート書き込み保護
    if (process.env.PROTECT_SPREADSHEET === 'true') {
      logger.warn('スプレッドシート保護モード: batchSyncMembersをスキップ');
      return;
    }
    
    // バッチ処理でメモリ効率を改善
    for (let i = 0; i < members.length; i += batchSize) {
      const batch = members.slice(i, i + batchSize);
      const batchPromises = batch.map(async (member) => {
        try {
          await this.syncMemberToSheets(member);
        } catch (error) {
          logger.error('部員データの同期でエラーが発生しました', { 
            memberName: member.name, 
            error: error.message 
          });
        }
      });
      
      await Promise.all(batchPromises);
      
      // バッチ間で短い待機時間を設定（API制限対策）
      if (i + batchSize < members.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // メモリ使用量ログ
      const memUsage = process.memoryUsage();
      logger.debug('メモリ使用状況', {
        heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
        progress: `${Math.min(i + batchSize, members.length)}/${members.length}`
      });
    }
    
    logger.info('部員データの一括同期が完了しました');
  }

  private memberToRow(member: Member): string[] {
    return [
      member.name,
      member.discordDisplayName,
      member.discordUsername,
      member.studentId,
      member.gender,
      member.team,
      member.membershipFeeRecord,
      member.grade.toString(),
    ];
  }

  private rowToMember(row: string[], headers: string[]): Member {
    logger.warn('rowToMember変換', { 
      rawRow: row,
      rowLength: row.length 
    });
    
    const memberData = {
      name: row[0] || '',
      discordDisplayName: row[1] || '',
      discordUsername: row[2] || '',
      studentId: row[3] || '',
      gender: row[4] || '未回答',
      team: row[5] || '',
      membershipFeeRecord: row[6] || '未納',
      grade: row[7] || '1',
    };
    
    logger.warn('変換後のメンバーデータ', { memberData });

    // バリデーションを通してから返す
    const validation = MemberSchema.safeParse(memberData);
    if (validation.success) {
      return validation.data;
    } else {
      // デフォルト値で返す
      return {
        name: memberData.name,
        discordDisplayName: memberData.discordDisplayName,
        discordUsername: memberData.discordUsername,
        studentId: memberData.studentId,
        gender: '未回答' as const,
        team: memberData.team,
        membershipFeeRecord: '未納' as const,
        grade: 1,
      };
    }
  }

  public async validateSheetStructure(spreadsheetId: string, sheetName: string): Promise<boolean> {
    try {
      const range = `${sheetName}!A1:H1`;
      const rows = await this.readSheet(spreadsheetId, range);
      
      if (rows.length === 0) {
        logger.warn('スプレッドシートにヘッダー行がありません');
        return false;
      }

      const expectedHeaders = [
        '名前', 'Discord表示名', 'Discordユーザー名', '学籍番号',
        '性別', '班', '部費納入記録', '学年'
      ];

      const headers = rows[0] || [];
      const isValid = expectedHeaders.every((expected, index) => 
        headers[index] === expected
      );

      if (!isValid) {
        logger.warn('スプレッドシートのヘッダーが期待する形式と異なります', { 
          expected: expectedHeaders, 
          actual: headers 
        });
      }

      return isValid;
    } catch (error) {
      logger.error('スプレッドシート構造の検証に失敗しました', { error: error.message });
      return false;
    }
  }

  public async createSheetHeader(spreadsheetId: string, sheetName: string): Promise<void> {
    try {
      const headers = [
        '名前', 'Discord表示名', 'Discordユーザー名', '学籍番号',
        '性別', '班', '部費納入記録', '学年'
      ];

      const range = `${sheetName}!A1:H1`;
      await this.writeSheet(spreadsheetId, range, [headers]);
      
      logger.info('スプレッドシートのヘッダーを作成しました');
    } catch (error) {
      logger.error('スプレッドシートヘッダーの作成に失敗しました', { error: error.message });
      throw error;
    }
  }
}