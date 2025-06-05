import { REST, Routes } from 'discord.js';
import { env } from '../src/utils/env';

async function checkCommands() {
  const rest = new REST().setToken(env.DISCORD_TOKEN);

  try {
    // グローバルコマンドの確認
    console.log('📋 グローバルコマンドを確認中...');
    const globalCommands = await rest.get(
      Routes.applicationCommands(env.DISCORD_CLIENT_ID)
    ) as any[];
    
    console.log(`\n✅ 登録済みグローバルコマンド数: ${globalCommands.length}`);
    globalCommands.forEach((cmd, index) => {
      console.log(`  ${index + 1}. /${cmd.name} - ${cmd.description}`);
    });

    // 特定のギルドのコマンドも確認したい場合
    const guildId = process.argv[2];
    if (guildId) {
      console.log(`\n📋 ギルド ${guildId} のコマンドを確認中...`);
      const guildCommands = await rest.get(
        Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, guildId)
      ) as any[];
      
      console.log(`\n✅ 登録済みギルドコマンド数: ${guildCommands.length}`);
      guildCommands.forEach((cmd, index) => {
        console.log(`  ${index + 1}. /${cmd.name} - ${cmd.description}`);
      });
    }

  } catch (error) {
    console.error('❌ エラー:', error);
  }
}

checkCommands();

// 使い方を表示
if (!process.argv[2]) {
  console.log('\n💡 特定のサーバーのコマンドを確認する場合:');
  console.log('   npx ts-node scripts/check-commands.ts YOUR_GUILD_ID');
}