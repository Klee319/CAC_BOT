import { REST, Routes } from 'discord.js';
import { env } from '../src/utils/env';

async function forceUpdate() {
  const rest = new REST().setToken(env.DISCORD_TOKEN);

  try {
    console.log('🗑️ 既存のグローバルコマンドを削除中...');
    
    // すべてのグローバルコマンドを削除
    await rest.put(
      Routes.applicationCommands(env.DISCORD_CLIENT_ID),
      { body: [] }
    );
    
    console.log('✅ 既存のコマンドを削除しました');
    console.log('⏳ 1秒待機中...');
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('📝 コマンドを再登録するには以下を実行:');
    console.log('   npm run deploy-commands');
    
  } catch (error) {
    console.error('❌ エラー:', error);
  }
}

forceUpdate();