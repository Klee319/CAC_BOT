import { Events, Client } from 'discord.js';
import { logger } from '../../utils/logger';
import { syncService } from '../../services/sync';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client: Client) {
    if (!client.user) return;
    
    logger.info(`BOTが正常にログインしました: ${client.user.tag}`);
    logger.info(`サーバー数: ${client.guilds.cache.size}`);
    
    try {
      await client.user.setActivity('部活動管理中...', { type: 'WATCHING' as any });
      logger.info('BOTのアクティビティを設定しました');
    } catch (error) {
      logger.error('アクティビティの設定に失敗しました', { error: error.message });
    }

    // 起動時の自動同期を実行
    try {
      logger.info('起動時の自動同期を開始します');
      await syncService.performInitialSync();
      
      // 定期同期を開始
      syncService.startPeriodicSync();
      logger.info('定期同期スケジュールを開始しました');
    } catch (error) {
      logger.error('自動同期の初期化に失敗しました', { error: error.message });
    }
  },
};