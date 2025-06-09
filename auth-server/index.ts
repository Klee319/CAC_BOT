import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { env } from '../src/utils/env';
import { logger } from '../src/utils/logger';
import { JwtService } from '../src/services/auth/jwtService';
import { GoogleFormsService } from '../src/services/forms';

const app = express();
const port = env.AUTH_SERVER_PORT;

// セキュリティミドルウェア
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com"],
      fontSrc: ["'self'", "fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "*.google.com"],
      connectSrc: ["'self'", "*.google.com"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));

// レート制限
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分
  max: 10, // 最大10回のアクセス
  message: {
    error: 'Too many authentication attempts, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/auth', authLimiter);

// ミドルウェア
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静的ファイル
app.use(express.static(path.join(__dirname, 'public')));

// View engine setup (簡易HTMLレスポンス用)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// サービスのインスタンス
const jwtService = JwtService.getInstance();
const googleForms = GoogleFormsService.getInstance();

// 認証エンドポイント
app.get('/auth/form/:token', async (req: Request, res: Response) => {
  try {
    const token = req.params.token;
    
    if (!token) {
      return res.status(400).render('error', { 
        title: 'エラー',
        message: 'トークンが提供されていません。',
        description: 'Discord経由で正しいリンクをクリックしてください。'
      });
    }

    // トークンの検証
    const payload = jwtService.verifyFormToken(token);
    if (!payload) {
      return res.status(401).render('error', {
        title: '認証エラー',
        message: '無効または期限切れのトークンです。',
        description: 'Discordから新しいリンクを取得してください。'
      });
    }

    // トークンハッシュを生成
    const tokenHash = jwtService.hashToken(token);

    // 使用済みチェック
    const isUsed = await jwtService.isTokenUsed(tokenHash);
    if (isUsed) {
      return res.status(403).render('error', {
        title: 'アクセス拒否',
        message: '既に使用されたトークンです。',
        description: 'このリンクは一度しか使用できません。'
      });
    }

    // Google Formsのプリフィル用のフィールドマッピング
    // 実際の実装では、各フォームごとにフィールドIDをマッピングする必要があります
    const formUrl = await buildFormUrlWithPrefill(payload);

    // トークンを使用済みとしてマーク
    await jwtService.markTokenAsUsed(payload.formId, payload.discordId, tokenHash);

    // リダイレクト用のHTMLページを表示
    res.render('redirect', {
      title: 'フォームにリダイレクト中...',
      formUrl,
      memberName: payload.memberData.name,
      studentId: payload.memberData.studentId
    });

    logger.info('認証成功 - フォームにリダイレクト', {
      discordId: payload.discordId,
      formId: payload.formId,
      memberName: payload.memberData.name,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

  } catch (error) {
    logger.error('認証エンドポイントエラー', {
      error: error.message,
      token: req.params.token?.substring(0, 10) + '...',
      ip: req.ip
    });

    res.status(500).render('error', {
      title: 'システムエラー',
      message: 'システムエラーが発生しました。',
      description: 'しばらく時間を置いてから再試行してください。'
    });
  }
});

// ヘルスチェック
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// 404ハンドラー
app.use((req: Request, res: Response) => {
  res.status(404).render('error', {
    title: 'ページが見つかりません',
    message: '404 - Page Not Found',
    description: 'お探しのページは存在しません。'
  });
});

// エラーハンドラー
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error', {
    error: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });

  res.status(500).render('error', {
    title: 'システムエラー',
    message: 'システムエラーが発生しました。',
    description: 'しばらく時間を置いてから再試行してください。'
  });
});

// Google FormsのプリフィルURLを構築
async function buildFormUrlWithPrefill(payload: any): Promise<string> {
  try {
    const formId = payload.formId;
    const baseUrl = `https://docs.google.com/forms/d/${formId}/viewform`;
    
    // Google Forms サービスを使用してプリフィルURLを生成
    const prefilledUrl = await googleForms.buildPrefilledUrl(
      formId,
      baseUrl,
      {
        name: payload.memberData.name,
        studentId: payload.memberData.studentId,
        discordUsername: payload.memberData.discordUsername
      }
    );
    
    return prefilledUrl;
  } catch (error) {
    logger.error('フォームURL構築エラー', error);
    // フォールバック: プリフィルなしのURL
    const url = new URL(`https://docs.google.com/forms/d/${payload.formId}/viewform`);
    url.searchParams.append('usp', 'pp_url');
    return url.toString();
  }
}

// サーバー起動
if (require.main === module) {
  app.listen(port, () => {
    logger.info(`認証サーバーが起動しました: http://localhost:${port}`);
    logger.info('認証エンドポイント: /auth/form/:token');
  });
}

export default app;