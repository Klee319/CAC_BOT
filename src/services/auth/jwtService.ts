import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../../utils/env';
import { logger } from '../../utils/logger';
import { FormTokenPayload } from '../../types/forms';
import { DatabaseService } from '../database';

export class JwtService {
  private static instance: JwtService;
  private secret: string;
  private algorithm: jwt.Algorithm = 'HS256';
  private db: DatabaseService;

  private constructor() {
    this.secret = env.JWT_SECRET;
    
    // データベースを初期化
    this.initializeDatabase();
  }

  private async initializeDatabase(): Promise<void> {
    try {
      this.db = await DatabaseService.getInstance();
      logger.info('JwtService: データベースを初期化しました');
    } catch (error) {
      logger.error('JwtService: データベース初期化エラー', error);
    }
  }

  public static getInstance(): JwtService {
    if (!JwtService.instance) {
      JwtService.instance = new JwtService();
    }
    return JwtService.instance;
  }

  /**
   * フォーム用のJWTトークンを生成
   */
  public generateFormToken(payload: Omit<FormTokenPayload, 'iat' | 'exp'>): string {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = 3600; // 1時間

    const tokenPayload: FormTokenPayload = {
      ...payload,
      iat: now,
      exp: now + expiresIn
    };

    try {
      const token = jwt.sign(tokenPayload, this.secret, {
        algorithm: this.algorithm
      });

      logger.debug('JWTトークンを生成しました', {
        discordId: payload.discordId,
        formId: payload.formId
      });

      return token;
    } catch (error) {
      logger.error('JWTトークンの生成に失敗しました', error);
      throw new Error('トークン生成エラー');
    }
  }

  /**
   * JWTトークンを検証
   */
  public verifyFormToken(token: string): FormTokenPayload | null {
    try {
      const decoded = jwt.verify(token, this.secret, {
        algorithms: [this.algorithm]
      }) as FormTokenPayload;

      // 有効期限チェック
      const now = Math.floor(Date.now() / 1000);
      if (decoded.exp < now) {
        logger.warn('期限切れのトークンが使用されました', {
          discordId: decoded.discordId,
          formId: decoded.formId,
          expiredAt: new Date(decoded.exp * 1000)
        });
        return null;
      }

      return decoded;
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        logger.warn('無効なトークンが使用されました', { error: error.message });
      } else {
        logger.error('トークン検証エラー', error);
      }
      return null;
    }
  }

  /**
   * トークンのハッシュを生成
   */
  public hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * トークンが使用済みかチェック
   */
  public async isTokenUsed(tokenHash: string): Promise<boolean> {
    try {
      return await this.db.isTokenUsed(tokenHash);
    } catch (error) {
      logger.error('トークン使用状況の確認に失敗しました', error);
      return true; // エラー時は安全のため使用済みとして扱う
    }
  }

  /**
   * トークンを使用済みとしてマーク
   */
  public async markTokenAsUsed(
    formId: string,
    discordId: string,
    tokenHash: string
  ): Promise<void> {
    try {
      await this.db.recordFormResponse({ formId, discordId, tokenHash });
      logger.info('トークンを使用済みとしてマークしました', {
        formId,
        discordId,
        tokenHash: tokenHash.substring(0, 8) + '...'
      });
    } catch (error) {
      logger.error('トークンの使用済みマークに失敗しました', error);
      throw error;
    }
  }

  /**
   * 認証URL生成
   */
  public generateAuthUrl(token: string): string {
    const baseUrl = env.AUTH_SERVER_URL;
    return `${baseUrl}/auth/form/${encodeURIComponent(token)}`;
  }

  /**
   * Google FormsのプリフィルURL生成
   */
  public buildPrefilledFormUrl(
    formUrl: string,
    memberData: FormTokenPayload['memberData']
  ): string {
    const url = new URL(formUrl);
    
    // Google FormsのプリフィルパラメータはFormごとに異なるため、
    // 実際の実装では、フォーム作成時にフィールドIDをマッピングする必要があります
    // ここでは例として基本的な実装を示します
    
    // URLパラメータとして追加（実際のGoogle FormsではURLパラメータは異なる形式）
    url.searchParams.append('usp', 'pp_url');
    
    // 実際の実装では、Google Forms APIを使用してフィールドIDを取得し、
    // entry.XXXXX=value の形式でパラメータを追加する必要があります
    
    return url.toString();
  }
}