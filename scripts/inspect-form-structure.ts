import { google, forms_v1 } from 'googleapis';
import { env } from '../src/utils/env';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Google Formsの構造を詳細に調査するスクリプト
 * 
 * 使用方法:
 * npm run ts-node scripts/inspect-form-structure.ts <formId or formUrl>
 */

async function inspectFormStructure() {
  const input = process.argv[2];
  
  if (!input) {
    console.error('使用方法: npm run ts-node scripts/inspect-form-structure.ts <formId or formUrl>');
    process.exit(1);
  }
  
  // URLからformIdを抽出
  let formId = input;
  if (input.includes('forms.google.com')) {
    const match = input.match(/\/forms\/d\/([a-zA-Z0-9_-]+)/);
    if (match) {
      formId = match[1];
    }
  }
  
  try {
    console.log('Google Forms APIに接続中...');
    
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: env.GOOGLE_CLIENT_EMAIL,
        private_key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        project_id: env.GOOGLE_PROJECT_ID,
      },
      scopes: [
        'https://www.googleapis.com/auth/forms',
        'https://www.googleapis.com/auth/forms.body',
        'https://www.googleapis.com/auth/forms.body.readonly',
      ],
    });

    const formsClient = google.forms({
      version: 'v1',
      auth,
    });
    
    console.log(`\nフォームID: ${formId}`);
    console.log('フォーム情報を取得中...');
    
    const response = await formsClient.forms.get({
      formId,
    });
    
    const form = response.data;
    
    console.log('\n=== フォーム基本情報 ===');
    console.log('タイトル:', form.info?.title);
    console.log('説明:', form.info?.description);
    console.log('回答用URL:', form.responderUri);
    
    console.log('\n=== フォーム項目詳細 ===');
    const items = form.items || [];
    
    items.forEach((item, index) => {
      console.log(`\n--- 項目 ${index + 1} ---`);
      console.log('タイトル:', item.title);
      console.log('説明:', item.description);
      console.log('itemId:', item.itemId);
      console.log('質問タイプ:', item.questionItem?.question ? Object.keys(item.questionItem.question)[0] : 'なし');
      
      // テキスト質問の詳細
      if (item.questionItem?.question?.textQuestion) {
        console.log('テキスト質問設定:');
        console.log('  - 段落:', item.questionItem.question.textQuestion.paragraph);
      }
      
      // 必須かどうか
      if (item.questionItem?.question?.required !== undefined) {
        console.log('必須:', item.questionItem.question.required);
      }
    });
    
    console.log('\n\n=== プリフィルURL生成テスト ===');
    
    // 実際のフォームURLからプリフィルURLを構築
    const baseUrl = form.responderUri || `https://docs.google.com/forms/d/${formId}/viewform`;
    const url = new URL(baseUrl);
    
    // プリフィルパラメータを追加
    console.log('\n各項目のプリフィルパラメータ:');
    items.forEach((item) => {
      if (item.itemId && item.questionItem) {
        console.log(`${item.title}: entry.${item.itemId}=<値>`);
      }
    });
    
    console.log('\n\n💡 プリフィルURLの正しい使い方:');
    console.log('1. Google Formsの公開URLに以下のパラメータを追加');
    console.log('2. entry.XXXXXXXXXX=値 の形式で各フィールドの値を指定');
    console.log('3. 複数の値は&で連結');
    console.log('4. 日本語などはURLエンコードが必要');
    
    // サンプルURL生成
    const sampleUrl = new URL(baseUrl);
    const nameItem = items.find(item => 
      item.title?.toLowerCase().includes('名前') || 
      item.title?.toLowerCase().includes('name')
    );
    
    if (nameItem) {
      sampleUrl.searchParams.append(`entry.${nameItem.itemId}`, 'テスト太郎');
      console.log('\nサンプルプリフィルURL:');
      console.log(sampleUrl.toString());
    }
    
  } catch (error: any) {
    console.error('\nエラーが発生しました:', error.message);
    if (error.response?.data) {
      console.error('詳細:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// スクリプトを実行
inspectFormStructure().catch(console.error);