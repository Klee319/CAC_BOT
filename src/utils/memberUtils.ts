import { Member, MemberSchema, MemberUpdate, MemberUpdateSchema, DiscordMember, DiscordMemberSchema } from '../types';
import { logger } from './logger';

/**
 * 部員データのバリデーションユーティリティクラス
 */
export class MemberValidator {
  /**
   * 部員データをバリデーションする
   */
  static validateMember(data: unknown): { success: true; data: Member } | { success: false; errors: string[] } {
    const result = MemberSchema.safeParse(data);
    if (result.success) {
      return { success: true, data: result.data };
    } else {
      const errors = result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
      return { success: false, errors };
    }
  }

  /**
   * 部員データの更新内容をバリデーションする
   */
  static validateMemberUpdate(data: unknown): { success: true; data: MemberUpdate } | { success: false; errors: string[] } {
    const result = MemberUpdateSchema.safeParse(data);
    if (result.success) {
      return { success: true, data: result.data };
    } else {
      const errors = result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
      return { success: false, errors };
    }
  }

  /**
   * Discord部員データをバリデーションする
   */
  static validateDiscordMember(data: unknown): { success: true; data: DiscordMember } | { success: false; errors: string[] } {
    const result = DiscordMemberSchema.safeParse(data);
    if (result.success) {
      return { success: true, data: result.data };
    } else {
      const errors = result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
      return { success: false, errors };
    }
  }
}

/**
 * 部員データの変換ユーティリティクラス
 */
export class MemberConverter {
  /**
   * スプレッドシートの行データを部員データに変換
   */
  static rowToMember(row: (string | undefined)[]): Member | null {
    try {
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

      const validation = MemberValidator.validateMember(memberData);
      if (validation.success) {
        return validation.data;
      } else {
        const errors = 'errors' in validation ? validation.errors : ['バリデーションエラー'];
        logger.warn('スプレッドシートデータの変換に失敗しました', { 
          row: row,
          errors: errors 
        });
        return null;
      }
    } catch (error) {
      logger.error('行データの変換中にエラーが発生しました', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        row 
      });
      return null;
    }
  }

  /**
   * 部員データをスプレッドシートの行データに変換
   */
  static memberToRow(member: Member): string[] {
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

  /**
   * データベースの行データを部員データに変換
   */
  static dbRowToMember(row: any): Member | null {
    try {
      const memberData = {
        name: row.name || '',
        discordDisplayName: row.discord_display_name || '',
        discordUsername: row.discord_username || '',
        studentId: row.student_id || '',
        gender: row.gender || '未回答',
        team: row.team || '',
        membershipFeeRecord: row.membership_fee_record || '未納',
        grade: row.grade || '1',
      };

      const validation = MemberValidator.validateMember(memberData);
      if (validation.success) {
        return validation.data;
      } else {
        const errors = 'errors' in validation ? validation.errors : ['バリデーションエラー'];
        logger.warn('データベースデータの変換に失敗しました', { 
          row: row,
          errors: errors 
        });
        return null;
      }
    } catch (error) {
      logger.error('データベース行データの変換中にエラーが発生しました', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        row 
      });
      return null;
    }
  }

  /**
   * 部員データをデータベース挿入用のオブジェクトに変換
   */
  static memberToDbObject(member: Member, discordId: string): Record<string, any> {
    return {
      discord_id: discordId,
      name: member.name,
      discord_display_name: member.discordDisplayName,
      discord_username: member.discordUsername,
      student_id: member.studentId,
      gender: member.gender,
      team: member.team,
      membership_fee_record: member.membershipFeeRecord,
      grade: member.grade.toString(),
    };
  }
}

/**
 * 部員データのフォーマットユーティリティクラス
 */
export class MemberFormatter {
  /**
   * 部員データをDiscord埋め込み用に整形
   */
  static toEmbed(member: Member, discordId?: string): {
    title: string;
    fields: Array<{ name: string; value: string; inline: boolean }>;
    color: number;
  } {
    const feeColor = member.membershipFeeRecord === '完納' ? 0x00ff00 : 
                     member.membershipFeeRecord === '未納' ? 0xff0000 : 0xffaa00;

    const fields = [
      { name: '名前', value: member.name, inline: true },
      { name: '学籍番号', value: member.studentId, inline: true },
      { name: '学年', value: `${member.grade}年`, inline: true },
      { name: 'Discord表示名', value: member.discordDisplayName, inline: true },
      { name: 'Discordユーザー名', value: `@${member.discordUsername}`, inline: true },
      { name: '性別', value: member.gender, inline: true },
      { name: '班', value: member.team, inline: true },
      { name: '部費納入状況', value: member.membershipFeeRecord, inline: true },
    ];

    if (discordId) {
      fields.push({ name: 'Discord ID', value: discordId, inline: true });
    }

    return {
      title: `部員情報: ${member.name}`,
      fields,
      color: feeColor,
    };
  }

  /**
   * 部員一覧を表形式で整形
   */
  static toTable(members: Member[]): string {
    if (members.length === 0) {
      return '該当する部員が見つかりませんでした。';
    }

    const header = '| 名前 | 学年 | 班 | 部費 |';
    const separator = '|------|------|------|------|';
    
    const rows = members.map(member => 
      `| ${member.name} | ${member.grade}年 | ${member.team} | ${member.membershipFeeRecord} |`
    );

    return [header, separator, ...rows].join('\n');
  }

  /**
   * 部員データの差分を表示用に整形
   */
  static formatChanges(oldMember: Member, newMember: Member): string[] {
    const changes: string[] = [];
    
    if (oldMember.name !== newMember.name) {
      changes.push(`名前: ${oldMember.name} → ${newMember.name}`);
    }
    if (oldMember.discordDisplayName !== newMember.discordDisplayName) {
      changes.push(`Discord表示名: ${oldMember.discordDisplayName} → ${newMember.discordDisplayName}`);
    }
    if (oldMember.discordUsername !== newMember.discordUsername) {
      changes.push(`Discordユーザー名: ${oldMember.discordUsername} → ${newMember.discordUsername}`);
    }
    if (oldMember.studentId !== newMember.studentId) {
      changes.push(`学籍番号: ${oldMember.studentId} → ${newMember.studentId}`);
    }
    if (oldMember.gender !== newMember.gender) {
      changes.push(`性別: ${oldMember.gender} → ${newMember.gender}`);
    }
    if (oldMember.team !== newMember.team) {
      changes.push(`班: ${oldMember.team} → ${newMember.team}`);
    }
    if (oldMember.membershipFeeRecord !== newMember.membershipFeeRecord) {
      changes.push(`部費納入記録: ${oldMember.membershipFeeRecord} → ${newMember.membershipFeeRecord}`);
    }
    if (oldMember.grade !== newMember.grade) {
      changes.push(`学年: ${oldMember.grade}年 → ${newMember.grade}年`);
    }

    return changes;
  }
}