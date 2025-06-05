import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

async function testGoogleAuth() {
  try {
    console.log('Google API認証テストを開始します...');
    
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        project_id: process.env.GOOGLE_PROJECT_ID,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const authClient = await auth.getClient();
    console.log('✅ 認証成功！');
    console.log('📧 サービスアカウント:', process.env.GOOGLE_CLIENT_EMAIL);
    
    // スプレッドシートIDが設定されている場合は接続テスト
    if (process.env.MEMBER_SPREADSHEET_ID) {
      const sheets = google.sheets({ version: 'v4', auth: auth });
      const response = await sheets.spreadsheets.get({
        spreadsheetId: process.env.MEMBER_SPREADSHEET_ID,
      });
      console.log('📊 スプレッドシート名:', response.data.properties?.title);
      console.log('✅ スプレッドシートへのアクセス成功！');
    }
  } catch (error) {
    console.error('❌ エラー:', error.message);
    if (error.message.includes('invalid_grant')) {
      console.error('→ サービスアカウントの認証情報を確認してください');
    }
    if (error.message.includes('403')) {
      console.error('→ スプレッドシートへのアクセス権限を確認してください');
      console.error('→ サービスアカウントのメールアドレスを共有設定に追加してください');
    }
  }
}

testGoogleAuth();