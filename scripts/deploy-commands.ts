import { REST, Routes } from 'discord.js';
import { env } from '../src/utils/env';
import fs from 'fs';
import path from 'path';

const commands = [];

// コマンドファイルを読み込み
const commandsPath = path.join(__dirname, '..', 'src', 'bot', 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => 
  (file.endsWith('.js') || file.endsWith('.ts')) && !file.endsWith('.d.ts')
);

async function loadCommands() {
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    try {
      // TypeScriptファイルの場合、ビルド後のJSファイルを参照
      const commandPath = file.endsWith('.ts') 
        ? filePath.replace('/src/', '/dist/').replace('.ts', '.js')
        : filePath;
      
      const command = require(commandPath);
      const commandData = command.default || command;
      
      if (commandData && commandData.data) {
        commands.push(commandData.data.toJSON());
        console.log(`✅ コマンドを読み込みました: ${commandData.data.name}`);
      } else {
        console.warn(`⚠️  無効なコマンドファイル: ${file}`);
      }
    } catch (error) {
      console.error(`❌ コマンドファイルの読み込みに失敗: ${file}`, error.message);
    }
  }
}

async function deployCommands() {
  try {
    console.log('🚀 Discord スラッシュコマンドの登録を開始します...');

    await loadCommands();

    if (commands.length === 0) {
      console.error('❌ 登録するコマンドがありません');
      process.exit(1);
    }

    const rest = new REST().setToken(env.DISCORD_TOKEN);

    console.log(`📝 ${commands.length}個のコマンドを登録します`);

    // グローバルコマンドとして登録
    const data = await rest.put(
      Routes.applicationCommands(env.DISCORD_CLIENT_ID),
      { body: commands },
    ) as any[];

    console.log(`✅ ${data.length}個のスラッシュコマンドを正常に登録しました`);
    
    // 登録されたコマンドの一覧を表示
    console.log('\n📋 登録されたコマンド:');
    data.forEach((command, index) => {
      console.log(`  ${index + 1}. /${command.name} - ${command.description}`);
    });

  } catch (error) {
    console.error('❌ コマンド登録に失敗しました:', error);
    process.exit(1);
  }
}

// 特定ギルドにのみ登録する場合（開発用）
async function deployGuildCommands(guildId: string) {
  try {
    console.log(`🚀 ギルド ${guildId} にスラッシュコマンドを登録します...`);

    await loadCommands();

    const rest = new REST().setToken(env.DISCORD_TOKEN);

    const data = await rest.put(
      Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, guildId),
      { body: commands },
    ) as any[];

    console.log(`✅ ギルド ${guildId} に ${data.length}個のコマンドを登録しました`);

  } catch (error) {
    console.error('❌ ギルドコマンド登録に失敗しました:', error);
    process.exit(1);
  }
}

// コマンドライン引数の処理
const args = process.argv.slice(2);
const guildId = args.find(arg => arg.startsWith('--guild='))?.split('=')[1];

if (guildId) {
  deployGuildCommands(guildId);
} else {
  deployCommands();
}