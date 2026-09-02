import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pino from 'pino';
import { z } from 'zod';

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

// ─── 세션 저장소 ───

export function createSessionStore({ clock, ttlMs }) {
  const sessions = new Map();
  const isExpired = (s) => clock.now() >= s.expiresAt;

  return {
    create() {
      const now = clock.now();
      const session = {
        // 256비트. base64url이라 쿠키·헤더에 그대로 실을 수 있다.
        token: randomBytes(32).toString('base64url'),
        authenticated: true,
        createdAt: now,
        expiresAt: now + ttlMs,
        lastActivityAt: now,
      };
      sessions.set(session.token, session);
      return session;
    },

    get(token) {
      if (!token) return undefined;
      const session = sessions.get(token);
      if (!session) return undefined;
      // 만료된 세션은 조회 시점에 즉시 제거한다.
      if (isExpired(session)) {
        sessions.delete(token);
        return undefined;
      }
      return session;
    },

    destroy(token) {
      return token ? sessions.delete(token) : false;
    },

    touch(session) {
      const now = clock.now();
      session.expiresAt = now + ttlMs;
      session.lastActivityAt = now;
    },

    sweep() {
      let removed = 0;
      for (const [token, session] of sessions) {
        if (isExpired(session)) { sessions.delete(token); removed += 1; }
      }
      return removed;
    },

    size: () => sessions.size,
  };
}

/**
 * 길이가 달라도 예외를 던지지 않는 상수시간 비교.
 * timingSafeEqual은 버퍼 길이가 다르면 throw하므로, 양쪽을 SHA-256으로 32바이트에 고정한다.
 */
function safeCompare(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

// ─── 입력 검증 스키마 ───

/** 앞뒤 공백만 있는 문자열을 빈 값으로 취급하는 문자열 스키마. */
const trimmedString = (max) =>
  z.string().max(max).transform((s) => s.trim()).refine((s) => s.length > 0, {
    message: '빈 문자열은 허용되지 않습니다.',
  });

/** http/https만 허용한다. javascript:·file: 같은 스킴을 막기 위함이다. */
const httpUrl = z.string().max(2048).refine((raw) => {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}, { message: 'http 또는 https URL이어야 합니다.' });

/** ISO 8601로 파싱 가능한 날짜 문자열. */
const parsableDate = z.string().max(64).refine(
  (raw) => !Number.isNaN(Date.parse(raw)),
  { message: '파싱 가능한 날짜여야 합니다.' },
);

export function buildAnalyzeSchema(config) {
  const article = z.strictObject({
    title: trimmedString(config.maxTitleChars),
    content: trimmedString(config.maxContentChars),
    source: trimmedString(200),
    url: httpUrl,
    publishedAt: parsableDate,
  });

  const marketData = z.strictObject({
    assetName: trimmedString(200),
    // 가격·변동률은 "182.50", "+2.3%", 182.5 어느 쪽으로도 올 수 있다.
    currentPrice: z.union([z.string().max(64), z.number()]),
    priceChange: z.union([z.string().max(64), z.number()]),
    chartTrend: trimmedString(config.maxTrendChars),
  });

  return z.strictObject({
    newsList: z.array(article).min(1).max(config.maxNewsItems),
    marketData: marketData.optional(),
    analysisPeriod: z.string().max(200).optional(),
  });
}

/** Zod 오류를 사용자에게 안전한 한 줄로 요약한다. 내부 값은 노출하지 않는다. */
export function formatZodError(error) {
  const first = error.issues[0];
  if (!first) return '요청 데이터가 올바르지 않습니다.';
  const path = first.path.length ? first.path.join('.') : '요청 본문';
  return `요청 데이터가 올바르지 않습니다: ${path}`;
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

  // ─── 세션과 인증 ───

  const sessions = createSessionStore({ clock: now, ttlMs: config.sessionTtlMs });

  // 만료 세션 주기 청소. unref()가 없으면 프로세스가 종료되지 않아 테스트가 멈춘다.
  const sweeper = setInterval(() => sessions.sweep(), 60_000);
  sweeper.unref();

  const jsonBody = express.json({ limit: config.maxRequestBodyBytes });
  const loginSchema = z.strictObject({ password: z.string().min(1).max(200) });

  const setSessionCookie = (res, session) => {
    res.cookie('session', session.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.isProd,   // 로컬 HTTP에서 Secure를 붙이면 쿠키가 전송되지 않는다
      path: '/',
      maxAge: config.sessionTtlMs,
    });
  };

  app.post('/api/auth/login', jsonBody, (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, 'INVALID_REQUEST', '요청 데이터가 올바르지 않습니다.');
    }

    if (!safeCompare(parsed.data.password, config.secretPassword)) {
      req.log.warn('로그인 실패');   // 비밀번호 값은 어떤 형태로도 남기지 않는다
      throw new ApiError(403, 'INVALID_CREDENTIALS', '인증에 실패했습니다.');
    }

    const session = sessions.create();
    setSessionCookie(res, session);
    req.log.info('로그인 성공');     // 토큰은 로그에 남기지 않는다
    res.json({ token: session.token, expiresAt: new Date(session.expiresAt).toISOString() });
  });

  // ─── 인증 미들웨어 ───

  /** Authorization: Bearer 우선, 없으면 HttpOnly 쿠키. */
  const extractToken = (req) => {
    const header = req.get('authorization');
    if (header) {
      const [scheme, value] = header.split(' ');
      // Bearer 접두어가 없는 헤더는 받지 않는다. 형식을 느슨하게 하면 오탐이 생긴다.
      if (scheme?.toLowerCase() === 'bearer' && value) return value;
      return undefined;
    }
    return req.cookies?.session;
  };

  /**
   * 인증 실패 시 여기서 요청을 끝낸다.
   * 이 미들웨어를 라우트 핸들러보다 먼저 등록하므로, 인증되지 않은 요청은
   * OpenAI 호출 코드에 구조적으로 도달할 수 없다.
   */
  const requireAuth = (req, res, next) => {
    const token = extractToken(req);
    const session = sessions.get(token);   // 만료되었으면 내부에서 삭제하고 undefined를 준다

    if (!session || session.authenticated !== true) {
      throw new ApiError(403, 'FORBIDDEN', '유효하지 않거나 만료된 세션입니다.');
    }

    // 여기서 touch하지 않는다. 세션 연장은 분석 성공 응답 직전 한 곳에서만 일어난다.
    req.session = session;
    next();
  };

  // ─── 로그아웃 ───

  app.post('/api/auth/logout', (req, res) => {
    // 멱등적이다. 세션이 없어도 성공으로 응답한다.
    sessions.destroy(extractToken(req));
    res.clearCookie('session', {
      httpOnly: true, sameSite: 'strict', secure: config.isProd, path: '/',
    });
    res.json({ success: true, message: '로그아웃되었습니다.' });
  });

  // 테스트가 라우트를 꽂을 수 있는 지점. 반드시 404 핸들러보다 앞이어야 한다.
  if (extraRoutes) extraRoutes(app, { requireAuth, jsonBody });

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

  return { app, config, clock: now, llm, sessions, logger };
}

// ─── 직접 실행될 때만 포트를 연다 ───

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { app, config } = createApp();
  app.listen(config.port, () => {
    console.log(`서버 기동: http://localhost:${config.port} (LLM_MODE=${config.llmMode})`);
  });
}
