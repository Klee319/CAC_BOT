import { Events, Interaction, ChatInputCommandInteraction } from 'discord.js';
import { logger } from '../../utils/logger';
import { configManager } from '../../config';
import fs from 'fs';
import path from 'path';

const commands = new Map();

async function loadCommands() {
  const commandsPath = path.join(__dirname, '..', 'commands');
  
  if (!fs.existsSync(commandsPath)) {
    logger.warn('コマンドディレクトリが見つかりません');
    return;
  }

  const commandFiles = fs.readdirSync(commandsPath).filter(file => 
    (file.endsWith('.js') || file.endsWith('.ts')) && !file.endsWith('.d.ts')
  );

  for (const file of commandFiles) {
    try {
      const commandModule = await import(path.join(commandsPath, file));
      const command = commandModule.default || commandModule;
      
      if (command && command.data && command.execute) {
        commands.set(command.data.name, command);
        logger.debug(`コマンドを読み込みました: ${command.data.name}`);
      }
    } catch (error) {
      logger.error(`コマンドファイルの読み込みに失敗しました: ${file}`, { error: error.message });
    }
  }
}

loadCommands();

const modals = new Map();

async function loadModals() {
  const modalsPath = path.join(__dirname, '..', 'modals');
  
  if (!fs.existsSync(modalsPath)) {
    logger.warn('モーダルディレクトリが見つかりません');
    return;
  }

  const modalFiles = fs.readdirSync(modalsPath).filter(file => 
    (file.endsWith('.js') || file.endsWith('.ts')) && !file.endsWith('.d.ts')
  );

  for (const file of modalFiles) {
    try {
      const modalModule = await import(path.join(modalsPath, file));
      const modal = modalModule.default || modalModule;
      
      if (modal && modal.customId && modal.execute) {
        modals.set(modal.customId, modal);
        logger.debug(`モーダルを読み込みました: ${modal.customId}`);
      }
    } catch (error) {
      logger.error(`モーダルファイルの読み込みに失敗しました: ${file}`, { error: error.message });
    }
  }
}

loadModals();

export default {
  name: Events.InteractionCreate,
  async execute(interaction: Interaction) {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
    } else if (interaction.isModalSubmit()) {
      await handleModal(interaction);
    }
  },
};

async function handleCommand(interaction: ChatInputCommandInteraction) {
  const command = commands.get(interaction.commandName);
  if (!command) {
    logger.warn(`不明なコマンド: ${interaction.commandName}`);
    return;
  }

  try {
    const config = configManager.getConfig();
    const member = interaction.member;
    
    if (!member) {
      await interaction.reply({
        content: 'このコマンドはサーバー内でのみ使用できます。',
        ephemeral: true,
      });
      return;
    }

    const userRoles = Array.isArray(member.roles) 
      ? member.roles 
      : member.roles.cache.map(role => role.id);

    const isAdmin = configManager.isAdmin(userRoles);
    const isMember = configManager.isMember(userRoles);
    const isAllowedChannel = configManager.isAllowedChannel(interaction.channelId);

    if (!isAllowedChannel) {
      await interaction.reply({
        content: 'このチャンネルではコマンドを使用できません。',
        ephemeral: true,
      });
      return;
    }

    if (command.adminOnly && !isAdmin) {
      await interaction.reply({
        content: 'このコマンドは管理者のみが使用できます。',
        ephemeral: true,
      });
      return;
    }

    if (command.memberOnly && !isMember && !isAdmin) {
      await interaction.reply({
        content: 'このコマンドは部員のみが使用できます。',
        ephemeral: true,
      });
      return;
    }

    logger.info(`コマンド実行: ${interaction.commandName}`, {
      userId: interaction.user.id,
      userName: interaction.user.username,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
    });

    await command.execute(interaction);
    
  } catch (error) {
    logger.error(`コマンド実行エラー: ${interaction.commandName}`, {
      error: error.message,
      userId: interaction.user.id,
      userName: interaction.user.username,
    });

    const errorMessage = 'コマンドの実行中にエラーが発生しました。';
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: errorMessage,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: errorMessage,
        ephemeral: true,
      });
    }
  }
}

async function handleModal(interaction: any) {
  const modal = modals.get(interaction.customId);
  if (!modal) {
    logger.warn(`不明なモーダル: ${interaction.customId}`);
    return;
  }

  try {
    logger.info(`モーダル実行: ${interaction.customId}`, {
      userId: interaction.user.id,
      userName: interaction.user.username,
      guildId: interaction.guildId,
    });

    await modal.execute(interaction);
    
  } catch (error) {
    logger.error(`モーダル実行エラー: ${interaction.customId}`, {
      error: error.message,
      userId: interaction.user.id,
      userName: interaction.user.username,
    });

    const errorMessage = 'モーダルの処理中にエラーが発生しました。';
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: errorMessage,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: errorMessage,
        ephemeral: true,
      });
    }
  }
}