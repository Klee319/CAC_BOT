import { GoogleFormsService } from '../src/services/forms';
import { logger } from '../src/utils/logger';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Google FormsのプリフィルURLをテストするスクリプト
 * 
 * 使用方法:
 * npm run ts-node scripts/test-form-prefill.ts <formId>
 */

async function testFormPrefill() {
  const formId = process.argv[2];
  
  if (!formId) {
    console.error('使用方法: npm run ts-node scripts/test-form-prefill.ts <formId>');
    process.exit(1);
  }
  
  try {
    console.log('Google Forms APIに接続中...');
    const formsService = GoogleFormsService.getInstance();
    
    // フォームメタデータを取得
    console.log('\nフォームメタデータを取得中...');
    const metadata = await formsService.getFormMetadata(formId);
    console.log('フォームタイトル:', metadata.title);
    console.log('フォームURL:', metadata.responderUri);
    
    // フィールドマッピングを取得
    console.log('\nフィールドマッピングを取得中...');
    const mappings = await formsService.getFormFieldMappings(formId);
    console.log('取得したマッピング:', JSON.stringify(mappings, null, 2));
    
    // テストデータ
    const testData = {
      name: 'テスト太郎',
      studentId: '2024001',
      discordUsername: 'test_user#1234'
    };
    
    // プリフィルURLを生成
    console.log('\nプリフィルURLを生成中...');
    const prefilledUrl = await formsService.buildPrefilledUrl(
      formId,
      metadata.responderUri,
      testData
    );
    
    console.log('\n生成されたURL:');
    console.log(prefilledUrl);
    
    // URLの解析
    const url = new URL(prefilledUrl);
    console.log('\nURLパラメータ:');
    url.searchParams.forEach((value, key) => {
      console.log(`  ${key} = ${value}`);
    });
    
    // 手動でentry IDを試す
    console.log('\n\n--- 別の形式のentry IDをテスト ---');
    const testUrls = [
      // 通常の数値形式
      buildTestUrl(metadata.responderUri, {
        'entry.1234567890': testData.name,
        'entry.0987654321': testData.studentId,
        'entry.1111111111': testData.discordUsername
      }),
      // アンダースコア形式
      buildTestUrl(metadata.responderUri, {
        'entry_1234567890': testData.name,
        'entry_0987654321': testData.studentId,
        'entry_1111111111': testData.discordUsername
      })
    ];
    
    testUrls.forEach((url, index) => {
      console.log(`\nテストURL ${index + 1}:`);
      console.log(url);
    });
    
    console.log('\n\n💡 ヒント:');
    console.log('1. Google Formsを開いて、開発者ツールでネットワークタブを確認');
    console.log('2. フォームを手動で送信して、実際のentry IDを確認');
    console.log('3. entry IDは通常、entry.XXXXXXXXXX の形式（10桁の数字）');
    
  } catch (error) {
    console.error('エラーが発生しました:', error);
  }
}

function buildTestUrl(baseUrl: string, params: Record<string, string>): string {
  const url = new URL(baseUrl);
  url.pathname = url.pathname.replace('/edit', '/viewform');
  url.searchParams.append('usp', 'pp_url');
  
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.append(key, value);
  }
  
  return url.toString();
}

// スクリプトを実行
testFormPrefill().catch(console.error);