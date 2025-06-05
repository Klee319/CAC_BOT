import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { DatabaseService } from '../src/services/database';
import { logger } from '../src/utils/logger';
import { Member } from '../src/types';

async function importCSVToDatabase() {
  const csvPath = path.join(__dirname, '../database/test_members.csv');
  const db = new DatabaseService();

  try {
    console.log('📂 CSVファイルを読み込んでいます...');
    // CSVファイルを読み込む
    const fileContent = fs.readFileSync(csvPath, 'utf-8');
    const records = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
    });

    console.log(`📊 ${records.length}件のレコードを検出しました`);

    // データベースを初期化
    console.log('🗄️  データベースを初期化しています...');
    await db.initialize();

    let successCount = 0;
    let errorCount = 0;

    // 各レコードをデータベースに登録
    for (const record of records) {
      const member: Member = {
        name: record['名前'],
        discordDisplayName: record['Discord表示名'],
        discordUsername: record['Discordユーザー名'],
        studentId: record['学籍番号'],
        gender: record['性別'] as '男性' | '女性' | 'その他' | '未回答',
        team: record['班'],
        membershipFeeRecord: record['部費納入記録'] as '完納' | '未納' | '一部納入' | '免除',
        grade: parseInt(record['学年'], 10),
      };

      // Discord IDは仮のIDを生成（実際の運用では実際のIDを使用）
      const fakeDiscordId = `${1000000000000000000 + Math.floor(Math.random() * 9000000000000000)}`;

      try {
        // 既存のメンバーをチェック
        const existingMember = await db.getMemberByStudentId(member.studentId);
        
        if (existingMember) {
          console.log(`⚠️  ${member.name} (${member.studentId}) は既に登録されています。スキップします。`);
        } else {
          await db.insertMember(member, fakeDiscordId);
          console.log(`✅ ${member.name} (${member.studentId}) を登録しました`);
          successCount++;
        }
      } catch (error) {
        console.error(`❌ ${member.name} の登録に失敗しました:`, error);
        errorCount++;
      }
    }

    console.log('\n=== インポート結果 ===');
    console.log(`✅ 成功: ${successCount}件`);
    console.log(`❌ エラー: ${errorCount}件`);
    console.log(`⏭️  スキップ: ${records.length - successCount - errorCount}件`);

    // データベースの内容を確認
    const allMembers = await db.getAllMembers();
    console.log(`\n📊 データベース内の総部員数: ${allMembers.length}名`);

  } catch (error) {
    console.error('❌ CSVインポートエラー:', error);
  } finally {
    await db.close();
    console.log('\n🔒 データベース接続を閉じました');
  }
}

// スクリプトを実行
console.log('🚀 CSVインポートスクリプトを開始します\n');
importCSVToDatabase()
  .then(() => {
    console.log('\n✨ CSVインポートが完了しました');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ エラーが発生しました:', error);
    process.exit(1);
  });