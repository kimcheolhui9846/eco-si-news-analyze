import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { z } from 'zod';

import { ApiError } from './lib/errors.js';
import { loadConfig } from './lib/config.js';
import { createLogger } from './lib/logger.js';
import { createSessionStore, safeCompare } from './lib/session.js';
import { buildAnalyzeSchema, formatZodError } from './lib/validation.js';
import { normalizeNewsList } from './lib/normalize.js';
import { SYSTEM_PROMPT, buildUserPrompt, estimateTokens } from './lib/prompt.js';
import {
  createLlmClient, createMockLlmClient, callWithResilience, createCircuitBreaker,
} from './lib/llm.js';
import { stripFabricatedUrls, parseAnalysis, buildSources } from './lib/postprocess.js';
import {
  createTtlCache, createSemaphore, createInflightMap, hashRequest,
  makeLoginLimiter, makeAnalyzeLimiter, makeSessionLimiter,
} from './lib/cost-defense.js';
import { createBudgetTracker, estimateCostUsd } from './lib/budget.js';

// 기존 테스트가 '../server.js'에서 import하던 심볼을 그대로 유지한다.
export { ApiError } from './lib/errors.js';
export { loadConfig } from './lib/config.js';
export { createLogger } from './lib/logger.js';
export { createSessionStore } from './lib/session.js';
export { buildAnalyzeSchema, formatZodError } from './lib/validation.js';
export { normalizeNewsList, stripControlChars } from './lib/normalize.js';
export {
  SYSTEM_PROMPT, buildUserPrompt, escapeDelimiters, estimateTokens,
  DATA_BEGIN, DATA_END, CONTENT_KIND_LABEL,
} from './lib/prompt.js';
export {
  createLlmClient, createMockLlmClient, callWithResilience,
  createCircuitBreaker, ANALYSIS_JSON_SCHEMA,
} from './lib/llm.js';
export { stripFabricatedUrls, parseAnalysis, buildSources } from './lib/postprocess.js';
export {
  createTtlCache, createSemaphore, createInflightMap, hashRequest,
} from './lib/cost-defense.js';
export { createBudgetTracker, estimateCostUsd } from './lib/budget.js';
export { createHttpClient } from './lib/http.js';
export { parseRssFeed } from './lib/providers/rss.js';
export { FEEDS, tickerFeed, buildFeedUrl, feedsFor } from './lib/providers/feeds.js';
export { createRssNewsProvider, matchesQuery } from './lib/providers/news.js';
export { computeIndicators, buildChartTrend } from './lib/providers/indicators.js';
export { SYMBOL_ALIASES, lookupAlias } from './lib/providers/aliases.js';
export { createMarketProvider } from './lib/providers/market.js';

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

  // 주입된 llm이 있으면 그것을 쓴다. 없으면 모드에 따라 실제/mock 클라이언트를 만든다.
  const llmClient = llm ?? (config.llmMode === 'mock' ? createMockLlmClient() : createLlmClient(config));
  const breaker = createCircuitBreaker({
    threshold: config.breakerThreshold,
    cooldownMs: config.breakerCooldownMs,
    clock: now,
  });

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

  // ─── 비용 방어 자원 ───

  const analysisCache = createTtlCache({
    ttlMs: config.cacheTtlMs, maxEntries: config.cacheMaxEntries, clock: now,
  });
  const analysisSemaphore = createSemaphore(config.maxConcurrentAnalyses);
  const inflight = createInflightMap();

  // rate limit은 본문 검증보다 앞에 둔다. 검증 비용조차 아끼기 위함이다.
  app.post('/api/auth/login', makeLoginLimiter(config), jsonBody, (req, res) => {
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

  // 세션 상태 조회. 연장하지 않는다 — 읽기만 한다.
  app.get('/api/auth/session', requireAuth, (req, res) => {
    res.json({
      authenticated: true,
      expiresAt: new Date(req.session.expiresAt).toISOString(),
      lastActivityAt: new Date(req.session.lastActivityAt).toISOString(),
    });
  });

  // ─── 예산과 호출 확인 ───

  const budget = createBudgetTracker({
    clock: now,
    filePath: config.budgetFile,
    dailyCallLimit: config.dailyAnalysisLimit,
    monthlyCostLimitUsd: config.monthlyCostLimitUsd,
    logger,
  });

  // 확인 토큰: 견적을 본 사용자가 명시적으로 승인했음을 증명한다.
  // 세션과 요청 내용에 묶여 있고 일회용이다.
  const confirmTokens = createTtlCache({
    ttlMs: config.confirmTokenTtlMs, maxEntries: 200, clock: now,
  });

  app.get('/api/budget', requireAuth, (req, res) => {
    res.json(budget.snapshot());
  });

  // ─── 분석 엔드포인트 ───

  const analyzeSchema = buildAnalyzeSchema(config);

  /**
   * 검증부터 프롬프트 조립·비용 추정까지, 견적과 실행이 똑같이 밟는 단계.
   * 두 경로가 같은 계산을 하므로 견적과 실제 요청이 어긋날 수 없다.
   */
  const prepare = (req) => {
    const parsed = analyzeSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ApiError(400, 'INVALID_REQUEST', formatZodError(parsed.error));
    }

    const { newsList, marketData, analysisPeriod } = parsed.data;
    const { items, duplicatesRemoved, urlWhitelist } =
      normalizeNewsList(newsList, { assetName: marketData?.assetName });

    if (items.length === 0) {
      throw new ApiError(422, 'INSUFFICIENT_DATA', '중복 제거 후 분석할 자료가 남지 않았습니다.');
    }

    const collectedAt = new Date(now.now()).toISOString();
    const userPrompt = buildUserPrompt({ items, marketData, collectedAt, analysisPeriod });

    // 프롬프트 길이와 토큰 예산을 LLM 호출 전에 확인한다.
    const estimatedInputTokens = estimateTokens(SYSTEM_PROMPT) + estimateTokens(userPrompt);
    if (userPrompt.length > config.maxPromptChars || estimatedInputTokens > config.maxInputTokens) {
      throw new ApiError(413, 'INPUT_TOO_LARGE', '분석 요청이 너무 큽니다. 기사 수나 본문 길이를 줄여 주세요.');
    }

    const estimatedCostUsd = estimateCostUsd(
      { inputTokens: estimatedInputTokens, outputTokens: config.assumedOutputTokens },
      { inputPer1M: config.priceInputPer1M, outputPer1M: config.priceOutputPer1M },
    );

    return {
      items, marketData, analysisPeriod, duplicatesRemoved, urlWhitelist,
      collectedAt, userPrompt, estimatedInputTokens, estimatedCostUsd,
      // 캐시 키는 정규화된 자료 기준이다. 순서만 다른 요청도 같은 키가 된다.
      cacheKey: hashRequest({ items, marketData, analysisPeriod, model: config.openaiModel }),
    };
  };

  /**
   * 견적. LLM을 호출하지 않으므로 비용이 들지 않는다.
   * 예산이 부족하면 여기서 막아 사용자가 확인 단계로 넘어가지 못하게 한다.
   */
  app.post('/api/analyze/estimate', makeAnalyzeLimiter(config), jsonBody, requireAuth, (req, res) => {
    const prepared = prepare(req);
    const cached = Boolean(analysisCache.get(prepared.cacheKey));

    // 캐시 히트는 LLM을 부르지 않으므로 예산을 쓰지 않는다.
    if (!cached) {
      const verdict = budget.canSpend(prepared.estimatedCostUsd);
      if (!verdict.ok) {
        req.log.warn({ reason: verdict.reason }, '예산 한도로 분석을 거부했다');
        throw new ApiError(429, 'BUDGET_EXCEEDED',
          verdict.reason === 'DAILY_CALL_LIMIT'
            ? '오늘 사용할 수 있는 분석 횟수를 모두 썼습니다.'
            : '이번 달 비용 한도에 도달했습니다.');
      }
    }

    const confirmToken = `ct_${randomBytes(24).toString('base64url')}`;
    confirmTokens.set(confirmToken, {
      cacheKey: prepared.cacheKey,
      sessionToken: req.session.token,
    });

    res.json({
      estimatedInputTokens: prepared.estimatedInputTokens,
      assumedOutputTokens: config.assumedOutputTokens,
      estimatedCostUsd: Number(prepared.estimatedCostUsd.toFixed(6)),
      sourceCount: prepared.items.length,
      duplicatesRemoved: prepared.duplicatesRemoved,
      cached,
      budget: budget.snapshot(),
      confirmToken,
      confirmTokenExpiresAt: new Date(now.now() + config.confirmTokenTtlMs).toISOString(),
      model: config.openaiModel,
      note: cached
        ? '이 요청은 캐시된 결과가 있어 추가 비용이 발생하지 않습니다.'
        : '실제 비용은 응답 길이에 따라 추정치와 달라질 수 있습니다.',
    });
  });

  app.post(
    '/api/analyze/news',
    makeAnalyzeLimiter(config),   // [1] IP 한도 — 인증 검사보다 싸다
    jsonBody,                     // [2] 본문 크기 제한
    requireAuth,                  // [3] 인증 — 여기를 통과해야만 LLM 경로에 진입한다
    makeSessionLimiter(config),   // [4] 세션 한도 — req.session이 필요하므로 인증 뒤
    async (req, res) => {
      const {
        items, duplicatesRemoved, urlWhitelist, collectedAt,
        userPrompt, estimatedInputTokens, estimatedCostUsd, cacheKey,
      } = prepare(req);

      const sources = buildSources(items, collectedAt);
      const baseMeta = { collectedAt, sourceCount: items.length, duplicatesRemoved, estimatedInputTokens };

      // 캐시 히트는 LLM을 부르지 않는다. 비용이 0이므로 확인도 예산 차감도 필요 없다.
      const cached = analysisCache.get(cacheKey);
      if (cached) {
        sessions.touch(req.session);
        return res.json({
          requestId: req.requestId,
          analysis: cached.analysis,
          sources,
          meta: { ...baseMeta, ...cached.meta, cached: true, actualCostUsd: 0, budget: budget.snapshot() },
        });
      }

      // 여기부터는 실제 비용이 발생한다. 사용자의 명시적 승인을 요구한다.
      const confirmToken = req.get('x-confirm-token');
      const grant = confirmToken ? confirmTokens.get(confirmToken) : undefined;

      // 토큰은 이 세션의 것이어야 하고, 견적을 낸 그 요청 내용이어야 한다.
      // 그렇지 않으면 작은 요청으로 견적을 받고 큰 요청을 실행할 수 있다.
      if (!grant || grant.sessionToken !== req.session.token || grant.cacheKey !== cacheKey) {
        throw new ApiError(428, 'CONFIRMATION_REQUIRED',
          '먼저 /api/analyze/estimate로 예상 비용을 확인한 뒤, 발급된 확인 토큰을 X-Confirm-Token 헤더에 담아 다시 요청해 주세요.');
      }
      confirmTokens.delete(confirmToken);   // 일회용

      const verdict = budget.canSpend(estimatedCostUsd);
      if (!verdict.ok) {
        req.log.warn({ reason: verdict.reason }, '예산 한도로 분석을 거부했다');
        throw new ApiError(429, 'BUDGET_EXCEEDED',
          verdict.reason === 'DAILY_CALL_LIMIT'
            ? '오늘 사용할 수 있는 분석 횟수를 모두 썼습니다.'
            : '이번 달 비용 한도에 도달했습니다.');
      }

      const release = analysisSemaphore.tryAcquire();
      if (!release) {
        throw new ApiError(429, 'TOO_MANY_CONCURRENT', '동시 분석 요청이 많습니다. 잠시 후 다시 시도해 주세요.');
      }

      let produced;
      try {
        // 같은 키로 동시에 들어온 요청은 하나의 LLM 호출을 공유한다.
        produced = await inflight.run(cacheKey, async () => {
          const call = (useJsonSchema) => callWithResilience(
            llmClient,
            { system: SYSTEM_PROMPT, user: userPrompt, useJsonSchema },
            { config, breaker, clock: now, log: req.log },
          );

          let outputTokens = 0;
          // 구조화 출력 2회 시도 → Markdown 폴백 1회.
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const result = await call(true);
            outputTokens += estimateTokens(result.content);
            const analysis = parseAnalysis(result.content);
            if (analysis) return { analysis, model: result.model, degraded: false, outputTokens };
            req.log.warn({ attempt: attempt + 1 }, '구조화 응답 파싱 실패');
          }

          const fallback = await call(false);
          outputTokens += estimateTokens(fallback.content);
          if (!fallback.content?.trim()) {
            throw new ApiError(502, 'PARSE_FAILED', '분석 결과를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
          }
          return {
            analysis: { report: fallback.content },
            model: fallback.model, degraded: true, outputTokens,
          };
        });
      } finally {
        release();
      }

      // 실제 응답 길이로 비용을 다시 계산해 기록한다. 견적은 가정치일 뿐이다.
      const actualCostUsd = estimateCostUsd(
        { inputTokens: estimatedInputTokens, outputTokens: produced.outputTokens },
        { inputPer1M: config.priceInputPer1M, outputPer1M: config.priceOutputPer1M },
      );
      budget.record({ costUsd: actualCostUsd });

      // LLM이 지어낸 URL을 제거한다. 프롬프트 지시만으로는 보장되지 않는다.
      const { value: analysis, removed: fabricatedUrlsRemoved } =
        stripFabricatedUrls(produced.analysis, urlWhitelist);

      if (fabricatedUrlsRemoved > 0) {
        req.log.warn({ fabricatedUrlsRemoved }, '출처에 없는 URL을 제거했다');
      }

      analysisCache.set(cacheKey, {
        analysis,
        meta: { fabricatedUrlsRemoved, degraded: produced.degraded, model: produced.model },
      });

      // 여기가 세션을 연장하는 유일한 지점이다.
      // 위의 어떤 실패 경로도 여기에 도달하지 못한다.
      sessions.touch(req.session);

      return res.json({
        requestId: req.requestId,
        analysis,
        sources,
        meta: {
          ...baseMeta,
          fabricatedUrlsRemoved,
          cached: false,
          degraded: produced.degraded,
          model: produced.model,
          actualCostUsd: Number(actualCostUsd.toFixed(6)),
          budget: budget.snapshot(),
        },
      });
    },
  );

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
    // body-parser의 크기 초과 오류를 우리 형식으로 변환한다.
    if (err?.type === 'entity.too.large') {
      err = new ApiError(413, 'PAYLOAD_TOO_LARGE', '요청 본문이 너무 큽니다.');
    }

    const isApiError = err instanceof ApiError;
    const status = isApiError ? err.status : 500;
    const code = isApiError ? err.code : 'INTERNAL';
    // 사용자에게는 안전한 메시지만 내보낸다. 원본은 서버 로그에만 남긴다.
    const message = isApiError ? err.message : '서버 내부 오류가 발생했습니다.';

    req.log?.error({ errName: err.name, code, status }, '요청 처리 실패');

    if (res.headersSent) return next(err);
    res.status(status).json({ error: { code, message, requestId: req.requestId } });
  });

  return {
    app, config, clock: now, llm: llmClient, sessions, breaker, logger,
    caches: { analysis: analysisCache }, semaphore: analysisSemaphore, inflight,
  };
}

// ─── 직접 실행될 때만 포트를 연다 ───

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { app, config } = createApp();
  app.listen(config.port, () => {
    console.log(`서버 기동: http://localhost:${config.port} (LLM_MODE=${config.llmMode})`);
  });
}
