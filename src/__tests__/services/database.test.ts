import { DatabaseService } from '../../services/database';
import { Member } from '../../types';
import fs from 'fs';
import path from 'path';

describe('DatabaseService', () => {
  let db: DatabaseService;
  const testDbPath = './test-database.db';

  beforeEach(async () => {
    // テスト用のデータベースサービスを作成
    db = new DatabaseService();
    process.env.DATABASE_PATH = testDbPath;
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
    // テストデータベースファイルを削除
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('Member operations', () => {
    const testMember: Member = {
      name: 'テスト太郎',
      discordDisplayName: 'Test Taro',
      discordUsername: 'test_taro',
      studentId: 'S12345',
      gender: '男性',
      team: 'A班',
      membershipFeeRecord: '未納',
      grade: 2,
    };

    test('should insert and retrieve member', async () => {
      const discordId = 'test123456789';
      
      await db.insertMember(testMember, discordId);
      const retrieved = await db.getMemberByDiscordId(discordId);
      
      expect(retrieved).toBeTruthy();
      expect(retrieved.name).toBe(testMember.name);
      expect(retrieved.discord_id).toBe(discordId);
      expect(retrieved.student_id).toBe(testMember.studentId);
    });

    test('should update member information', async () => {
      const discordId = 'test123456789';
      
      await db.insertMember(testMember, discordId);
      await db.updateMember(discordId, { name: '更新太郎' });
      
      const updated = await db.getMemberByDiscordId(discordId);
      expect(updated.name).toBe('更新太郎');
    });

    test('should search members', async () => {
      const discordId = 'test123456789';
      
      await db.insertMember(testMember, discordId);
      const results = await db.searchMembers('テスト');
      
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe(testMember.name);
    });

    test('should get unpaid members', async () => {
      const discordId = 'test123456789';
      
      await db.insertMember(testMember, discordId);
      const unpaidMembers = await db.getUnpaidMembers();
      
      expect(unpaidMembers).toHaveLength(1);
      expect(unpaidMembers[0].membership_fee_record).toContain('未納');
    });
  });

});