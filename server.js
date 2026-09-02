import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pino from 'pino';

// ─── 에러 타입 ───

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// ─── 로거 ───

export function createLogger(config) {
  return pino({
    level: config.nodeEnv === 'test' ? 'silent' : 'info',
    // 비밀번호·토큰·API 키·기사 본문은 어떤 경로로도 로그에 남지 않는다
    redact: {
      paths: [
        'password', '*.password',
        'token', '*.token',
        'apiKey', '*.apiKey',
        'req.headers.authorization',
        'req.headers.cookie',
        'newsList', '*.newsList',
      ],
      censor: '[REDACTED]',
    },
  });
}

// ─── 환경변수 로드 및 검증 ───

const num = (raw, fallback) => {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`숫자가 아닌 환경변수 값: ${raw}`);
  return n;
};

const bool = (raw, fallback) => {
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
};

export function loadConfig(overrides = {}) {
  const e = { ...process.env, ...overrides };

  const llmMode = e.LLM_MODE ?? 'live';
  if (!['live', 'mock'].includes(llmMode)) {
    throw new Error(`LLM_MODE는 live 또는 mock이어야 합니다: ${llmMode}`);
  }
  if (!e.MY_SECRET_PASSWORD) {
    throw new Error('필수 환경변수 MY_SECRET_PASSWORD가 설정되지 않았습니다.');
  }
  if (llmMode === 'live' && !e.OPENAI_API_KEY) {
    throw new Error('LLM_MODE=live에는 OPENAI_API_KEY가 필요합니다.');
  }

  return Object.freeze({
    port: num(e.PORT, 3000),
    nodeEnv: e.NODE_ENV ?? 'development',
    isProd: (e.NODE_ENV ?? 'development') === 'production',
    trustProxy: bool(e.TRUST_PROXY, false),

    secretPassword: e.MY_SECRET_PASSWORD,
    sessionTtlMs: num(e.SESSION_TTL_MINUTES, 15) * 60 * 1000,

    llmMode,
    openaiApiKey: e.OPENAI_API_KEY,
    openaiModel: e.OPENAI_MODEL ?? 'gpt-4o',
    openaiTimeoutMs: num(e.OPENAI_TIMEOUT_MS, 60_000),
    openaiMaxRetries: num(e.OPENAI_MAX_RETRIES, 2),

    maxRequestBodyBytes: num(e.MAX_REQUEST_BODY_BYTES, 200_000),
    maxNewsItems: num(e.MAX_NEWS_ITEMS, 20),
    maxTitleChars: num(e.MAX_TITLE_CHARS, 300),
    maxContentChars: num(e.MAX_CONTENT_CHARS, 8_000),
    maxTrendChars: num(e.MAX_TREND_CHARS, 1_000),
    maxPromptChars: num(e.MAX_PROMPT_CHARS, 120_000),
    maxInputTokens: num(e.MAX_INPUT_TOKENS, 30_000),

    loginRateWindowMs: num(e.LOGIN_RATE_WINDOW_MS, 900_000),
    loginRateMax: num(e.LOGIN_RATE_MAX, 10),
    analyzeRateWindowMs: num(e.ANALYZE_RATE_WINDOW_MS, 900_000),
    analyzeRateMax: num(e.ANALYZE_RATE_MAX, 30),
    sessionRateWindowMs: num(e.SESSION_RATE_WINDOW_MS, 900_000),
    sessionRateMax: num(e.SESSION_RATE_MAX, 20),
    maxConcurrentAnalyses: num(e.MAX_CONCURRENT_ANALYSES, 3),

    cacheTtlMs: num(e.CACHE_TTL_MS, 600_000),
    cacheMaxEntries: num(e.CACHE_MAX_ENTRIES, 100),

    breakerThreshold: num(e.BREAKER_THRESHOLD, 5),
    breakerCooldownMs: num(e.BREAKER_COOLDOWN_MS, 60_000),

    corsOrigin: e.CORS_ORIGIN ?? 'http://localhost:3000',
  });
}

// ─── 앱 팩토리 ───

export function createApp({ env = {}, clock, llm, extraRoutes } = {}) {
  const config = loadConfig(env);
  const now = clock ?? { now: () => Date.now() };

  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());

  const logger = createLogger(config);

  // 요청 ID는 항상 서버가 발급한다. 클라이언트 헤더를 신뢰하면 로그 위조가 가능하다.
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    req.log = logger.child({ requestId: req.requestId });
    res.setHeader('X-Request-Id', req.requestId);
    next();
  });

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      llmMode: config.llmMode,
      time: new Date(now.now()).toISOString(),
    });
  });

  // 테스트가 라우트를 꽂을 수 있는 지점. 반드시 404 핸들러보다 앞이어야 한다.
  if (extraRoutes) extraRoutes(app, {});

  // ─── 에러 핸들러 (반드시 모든 라우터 뒤) ───

  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: '요청한 경로를 찾을 수 없습니다.',
        requestId: req.requestId,
      },
    });
  });

  app.use((err, req, res, next) => {
    const isApiError = err instanceof ApiError;
    const status = isApiError ? err.status : 500;
    const code = isApiError ? err.code : 'INTERNAL';
    // 사용자에게는 안전한 메시지만 내보낸다. 원본은 서버 로그에만 남긴다.
    const message = isApiError ? err.message : '서버 내부 오류가 발생했습니다.';

    req.log?.error({ errName: err.name, code, status }, '요청 처리 실패');

    if (res.headersSent) return next(err);
    res.status(status).json({ error: { code, message, requestId: req.requestId } });
  });

  return { app, config, clock: now, llm, logger };
}

// ─── 직접 실행될 때만 포트를 연다 ───

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { app, config } = createApp();
  app.listen(config.port, () => {
    console.log(`서버 기동: http://localhost:${config.port} (LLM_MODE=${config.llmMode})`);
  });
}
