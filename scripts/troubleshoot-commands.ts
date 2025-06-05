import { Client, GatewayIntentBits } from 'discord.js';
import { env } from '../src/utils/env';

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

async function troubleshoot() {
  try {
    await client.login(env.DISCORD_TOKEN);
    
    console.log('🤖 BOT情報:');
    console.log(`  名前: ${client.user?.tag}`);
    console.log(`  ID: ${client.user?.id}`);
    console.log(`  サーバー数: ${client.guilds.cache.size}`);
    
    console.log('\n📋 参加しているサーバー:');
    client.guilds.cache.forEach((guild, index) => {
      console.log(`  ${index + 1}. ${guild.name} (ID: ${guild.id})`);
      console.log(`     - BOTの権限: ${guild.members.me?.permissions.toArray().join(', ')}`);
    });
    
    console.log('\n✅ トラブルシューティング:');
    console.log('1. 上記のサーバーIDを使って特定サーバーにコマンドを登録:');
    console.log('   npm run deploy-commands:guild -- --guild=SERVER_ID');
    console.log('\n2. Discordクライアントを再起動 (Ctrl+R)');
    console.log('\n3. BOTがサーバーに「applications.commands」権限を持っているか確認');
    console.log('\n4. 別のチャンネルで試す（権限の問題の可能性）');
    
    client.destroy();
  } catch (error) {
    console.error('❌ エラー:', error);
  }
}

troubleshoot();