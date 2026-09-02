import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';

// ─── 에러 타입 ───

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
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

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      llmMode: config.llmMode,
      time: new Date(now.now()).toISOString(),
    });
  });

  if (extraRoutes) extraRoutes(app, {});

  return { app, config, clock: now, llm };
}

// ─── 직접 실행될 때만 포트를 연다 ───

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { app, config } = createApp();
  app.listen(config.port, () => {
    console.log(`서버 기동: http://localhost:${config.port} (LLM_MODE=${config.llmMode})`);
  });
}
