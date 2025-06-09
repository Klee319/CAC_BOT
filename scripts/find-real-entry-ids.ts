import axios from 'axios';
import { JSDOM } from 'jsdom';

/**
 * Google FormsのHTMLから実際のentry IDを取得するスクリプト
 * 
 * 使用方法:
 * npx ts-node scripts/find-real-entry-ids.ts <formUrl>
 */

async function findRealEntryIds() {
  const formUrl = process.argv[2];
  
  if (!formUrl) {
    console.error('使用方法: npx ts-node scripts/find-real-entry-ids.ts <formUrl>');
    process.exit(1);
  }
  
  try {
    console.log('Google FormsのHTMLを取得中...');
    
    // フォームのHTMLを取得
    const response = await axios.get(formUrl);
    const html = response.data;
    
    console.log('\nHTMLから entry ID を検索中...');
    
    // entry.で始まる数値IDを検索（10桁前後の数字）
    const entryIdPattern = /entry\.(\d{8,12})/g;
    const matches = [...html.matchAll(entryIdPattern)];
    
    const uniqueEntryIds = [...new Set(matches.map(m => m[1]))];
    
    console.log('\n見つかった entry ID:');
    uniqueEntryIds.forEach(id => {
      console.log(`  entry.${id}`);
    });
    
    // data-params属性からの情報も取得
    console.log('\n\ndata-params属性を検索中...');
    const dataParamsPattern = /data-params="([^"]+)"/g;
    const dataParamsMatches = [...html.matchAll(dataParamsPattern)];
    
    dataParamsMatches.forEach((match, index) => {
      try {
        const decoded = decodeURIComponent(match[1]);
        if (decoded.includes('entry.')) {
          console.log(`\ndata-params ${index + 1}:`, decoded.substring(0, 200) + '...');
        }
      } catch (e) {
        // デコードエラーは無視
      }
    });
    
    // フィールドのラベルとの対応を見つける
    console.log('\n\nフィールドラベルとの対応を推測中...');
    
    // JSDocのFB_PUBLIC_LOAD_DATA_を探す
    const fbDataPattern = /FB_PUBLIC_LOAD_DATA_\s*=\s*(\[[\s\S]*?\]);/;
    const fbDataMatch = html.match(fbDataPattern);
    
    if (fbDataMatch) {
      try {
        console.log('\nFB_PUBLIC_LOAD_DATA_を解析中...');
        // 安全のため、詳細な解析はスキップ
        console.log('フォームデータ構造が見つかりました（詳細解析は手動で行ってください）');
      } catch (e) {
        console.log('フォームデータの解析に失敗しました');
      }
    }
    
    console.log('\n\n💡 次のステップ:');
    console.log('1. ブラウザでフォームを開く');
    console.log('2. 開発者ツールでConsoleを開く');
    console.log('3. 以下のコマンドを実行:');
    console.log(`   Array.from(document.querySelectorAll('[name^="entry."]')).map(e => ({ name: e.name, label: e.closest('.freebirdFormviewerComponentsQuestionBaseRoot')?.querySelector('.freebirdFormviewerComponentsQuestionBaseTitle')?.textContent }))`);
    console.log('4. これで各entry IDとフィールドラベルの対応が確認できます');
    
  } catch (error: any) {
    console.error('エラーが発生しました:', error.message);
  }
}

// スクリプトを実行
findRealEntryIds().catch(console.error);