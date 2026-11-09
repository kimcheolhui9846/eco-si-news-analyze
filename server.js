import 'dotenv/config';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { z } from 'zod';

import { ApiError } from './lib/errors.js';
import { loadConfig } from './lib/config.js';
import { createLogger } from './lib/logger.js';
import { createSessionStore, safeCompare } from './lib/session.js';
import {
  buildResearchSchema, formatZodError, normalizeInclude,
} from './lib/validation.js';
import {
  createLlmClient, createMockLlmClient, createCircuitBreaker,
} from './lib/llm.js';
import {
  createTtlCache, createSemaphore, createInflightMap,
  makeLoginLimiter, makeAnalyzeLimiter, makeSessionLimiter, makeResearchLimiter,
} from './lib/cost-defense.js';
import { createBudgetTracker } from './lib/budget.js';
import { createHttpClient } from './lib/http.js';
import { createRssNewsProvider } from './lib/providers/news.js';
import { createMarketProvider } from './lib/providers/market.js';
import { createFinancialProvider } from './lib/providers/financial.js';
import { createResearchProvider } from './lib/providers/papers.js';
import { createKciProvider } from './lib/providers/kci.js';
import { createExperimentProvider } from './lib/providers/experiments.js';
import { loadDirectory } from './lib/providers/directory.js';
import { createResolver } from './lib/resolve.js';
import { createDartFinancialProvider } from './lib/providers/dart-financial.js';
import {
  collectInstruments, toAnalysisInstruments, UNRESOLVED_REASON,
} from './lib/instruments.js';
import { createAnalysisRunner } from './lib/analysis-runner.js';
import { getProfile, splitMode } from './lib/modes/index.js';
import { investProfile } from './lib/modes/invest.js';

// 기존 테스트가 '../server.js'에서 import하던 심볼을 그대로 유지한다.
export { ApiError } from './lib/errors.js';
export { loadConfig } from './lib/config.js';
export { createLogger } from './lib/logger.js';
export { createSessionStore } from './lib/session.js';
export {
  buildAnalyzeSchema, buildResearchSchema, formatZodError, COLLECT_SCOPES, normalizeInclude,
} from './lib/validation.js';
export { normalizeNewsList, stripControlChars } from './lib/normalize.js';
export {
  SYSTEM_PROMPT, buildUserPrompt, escapeDelimiters, estimateTokens,
  DATA_BEGIN, DATA_END, CONTENT_KIND_LABEL,
} from './lib/prompt.js';
export {
  createLlmClient, createMockLlmClient, callWithResilience,
  createCircuitBreaker, ANALYSIS_JSON_SCHEMA,
} from './lib/llm.js';
export {
  stripFabricatedUrls, parseAnalysis, buildSources, buildExtraSources, collectUrlWhitelist,
} from './lib/postprocess.js';
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
export {
  createFinancialProvider, pickLatestFact, findYearAgoFact, FINANCIAL_CONCEPTS,
} from './lib/providers/financial.js';
export { hasHangul, routeForQuery } from './lib/providers/language.js';
export {
  createResearchProvider, parseEuropePmc, parseArxiv, parseOpenAlex, parseCrossref, dedupeResearch,
} from './lib/providers/papers.js';
export { buildOpenAlexUrl } from './lib/providers/openalex.js';
export { buildCrossrefUrl } from './lib/providers/crossref.js';
export {
  createKciProvider, buildKciUrl, parseKciResponse, isIpRejection, redactKey, KCI_FIELD_NAMES,
} from './lib/providers/kci.js';
export {
  createExperimentProvider, parseClinicalTrials,
} from './lib/providers/experiments.js';
export {
  assignResearchIds, assignExperimentIds, financialEntries,
  formatFinancialSection, formatResearchSection, formatExperimentSection,
} from './lib/sections.js';
export { createDirectory, loadDirectory } from './lib/providers/directory.js';
export { createResolver, MAX_INSTRUMENTS } from './lib/resolve.js';
export { createDartFinancialProvider, reportCandidates, parseDartAccounts } from './lib/providers/dart-financial.js';
export { lookupSector, SECTOR_BASKETS } from './lib/providers/sectors.js';

// ─── 앱 팩토리 ───

export function createApp({ env = {}, clock, llm, http, extraRoutes, directory } = {}) {
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

  // 견적·분석 실행부. 수집 라우트도 견적과 확인 토큰을 여기서 받는다.
  const runner = createAnalysisRunner({
    config, now, llmClient, breaker, analysisCache, analysisSemaphore, inflight,
    budget, confirmTokens, sessions,
  });

  app.get('/api/budget', requireAuth, (req, res) => {
    res.json(budget.snapshot());
  });


  // ─── 데이터 커넥터 ───

  const httpClient = http ?? createHttpClient({
    allowlist: config.externalAllowlist,
    timeoutMs: config.externalTimeoutMs,
    maxBytes: config.maxExternalResponseBytes,
  });

  const makeProviderBreaker = () => createCircuitBreaker({
    threshold: config.providerBreakerThreshold,
    cooldownMs: config.providerBreakerCooldownMs,
    clock: now,
  });

  const newsProvider = createRssNewsProvider({
    http: httpClient,
    cache: createTtlCache({ ttlMs: config.newsCacheTtlMs, maxEntries: 100, clock: now }),
    clock: now,
    makeBreaker: makeProviderBreaker,
  });

  const marketProvider = createMarketProvider({
    http: httpClient,
    cache: createTtlCache({ ttlMs: config.marketCacheTtlMs, maxEntries: 100, clock: now }),
    clock: now,
    makeBreaker: makeProviderBreaker,
  });

  const financialProvider = createFinancialProvider({
    http: httpClient,
    cache: createTtlCache({ ttlMs: config.financialCacheTtlMs, maxEntries: 100, clock: now }),
    clock: now,
    makeBreaker: makeProviderBreaker,
  });

  const dartProvider = createDartFinancialProvider({
    http: httpClient,
    cache: createTtlCache({ ttlMs: config.dartCacheTtlMs, maxEntries: 200, clock: now }),
    clock: now,
    makeBreaker: makeProviderBreaker,
    apiKey: config.opendartApiKey,
    log: logger,
  });
  const resolveInstruments = createResolver({ directory: directory ?? loadDirectory({ log: logger }) });

  // 키가 없으면 이 provider가 호출하지 않고 사유만 돌려준다.
  const kciProvider = createKciProvider({
    http: httpClient,
    cache: createTtlCache({ ttlMs: config.researchCacheTtlMs, maxEntries: 100, clock: now }),
    clock: now,
    makeBreaker: makeProviderBreaker,
    apiKey: config.kciApiKey,
  });

  const researchProvider = createResearchProvider({
    http: httpClient,
    cache: createTtlCache({ ttlMs: config.researchCacheTtlMs, maxEntries: 100, clock: now }),
    clock: now,
    makeBreaker: makeProviderBreaker,
    kci: config.kciApiKey ? kciProvider : null,
    contactEmail: config.researchContactEmail,
  });

  const experimentProvider = createExperimentProvider({
    http: httpClient,
    cache: createTtlCache({ ttlMs: config.experimentCacheTtlMs, maxEntries: 100, clock: now }),
    clock: now,
    makeBreaker: makeProviderBreaker,
  });

  // ─── 수집 엔드포인트 ───

  const researchSchema = buildResearchSchema(config);

  app.post(
    '/api/research/collect',
    makeResearchLimiter(config),
    jsonBody,
    requireAuth,
    async (req, res) => {
      const { mode, body } = splitMode(req.body);
      // 모르는 모드는 여기서 400. CS 수집은 Task 7에서 이 자리에 분기한다.
      getProfile(mode);
      const parsed = researchSchema.safeParse(body);
      if (!parsed.success) {
        throw new ApiError(400, 'INVALID_REQUEST', formatZodError(parsed.error));
      }

      const { query, symbol, assetType, lang = 'ko', range = '1mo', maxNews = 10 } = parsed.data;
      const included = normalizeInclude(parsed.data.include);
      const wanted = (scope) => included.includes(scope);

      const resolution = resolveInstruments({ query, symbol, assetType });
      const single = resolution.kind === 'explicit' || resolution.kind === 'company';
      const wantMarket = wanted('market');
      const wantFinancial = wanted('financial');

      // 선택된 provider만 호출한다. 하나가 느리거나 실패해도 나머지로 진행한다.
      const [news, collectedInstruments, researchResult, experimentResult] = await Promise.all([
        newsProvider.search({ query, lang, limit: maxNews, symbol: single ? resolution.instruments[0].symbol : undefined }),
        collectInstruments({
          instruments: resolution.instruments,
          wantMarket, wantFinancial, range,
          market: marketProvider, sec: financialProvider, dart: dartProvider,
        }),
        wanted('research')
          ? researchProvider.search({ query, limit: config.maxResearchItems })
          : null,
        wanted('experiments')
          ? experimentProvider.search({ query, limit: config.maxExperimentItems })
          : null,
      ]);

      // 뉴스가 없으면 분석이 성립하지 않는다.
      if (news.items.length === 0) {
        // 실패 원인을 로그에 남긴다. 남기지 않으면 왜 비었는지 알 수 없다.
        req.log.warn(
          { degraded: news.degraded, feedsUsed: news.feedsUsed, lang, resolution: resolution.kind },
          '뉴스 수집 결과가 비었다',
        );
        throw new ApiError(502, 'COLLECTION_FAILED', '분석할 뉴스를 수집하지 못했습니다. 검색어를 바꿔 다시 시도해 주세요.');
      }

      const degraded = news.degraded.map((d) => ({ provider: 'news', ...d }));
      if (resolution.kind === 'unresolved') {
        if (wantMarket) degraded.push({ provider: 'market', reason: UNRESOLVED_REASON });
        if (wantFinancial) degraded.push({ provider: 'financial', reason: UNRESOLVED_REASON });
      }
      degraded.push(...collectedInstruments.degraded);
      for (const inst of collectedInstruments.instruments) {
        for (const d of inst.financial?.degraded ?? []) {
          degraded.push({ provider: 'financial', symbol: inst.symbol, reason: `${d.concept}: ${d.reason}` });
        }
      }
      for (const d of researchResult?.degraded ?? []) {
        degraded.push({ provider: 'research', ...d });
      }
      for (const d of experimentResult?.degraded ?? []) {
        degraded.push({ provider: 'experiments', ...d });
      }

      // 분석 엔진에 넘길 형태로 맞춘다. sourceId는 분석 단계에서 부여된다.
      const newsList = news.items.map((i) => ({
        title: i.title,
        content: i.content,
        source: i.source,
        url: i.url,
        publishedAt: i.publishedAt,
        contentKind: i.contentKind,
      }));

      // 자료가 비면 필드를 아예 싣지 않는다. JSON.stringify가 undefined는
      // 버리고 []는 남기므로, 규칙을 하나로 고정해야 cacheKey가 일치한다.
      const research = researchResult?.items.length ? researchResult.items : undefined;
      const experiments = experimentResult?.items.length ? experimentResult.items : undefined;

      // 언어 판정 근거. 결과가 비었을 때 사용자가 이유를 알아야 한다.
      const languageRoute = researchResult?.languageRoute
        ?? experimentResult?.languageRoute
        ?? null;

      const analysisInstruments = toAnalysisInstruments(collectedInstruments.instruments);
      const instruments = analysisInstruments.length > 0 ? analysisInstruments : undefined;
      const sector = resolution.kind === 'sector' ? resolution.sector : undefined;

      // 견적은 분석과 같은 프로필 함수로 만든다. cacheKey가 일치해야 확인 토큰이 통한다.
      const normalized = investProfile.normalize({ newsList, instruments, sector, research, experiments });
      const { items, duplicatesRemoved } = normalized;
      const { collectedAt, estimatedInputTokens, estimatedCostUsd, cacheKey } =
        runner.quote(investProfile, normalized);
      const { confirmToken, confirmTokenExpiresAt } =
        runner.issueConfirmToken(cacheKey, req.session.token);

      res.json({
        requestId: req.requestId,
        newsList,
        instruments: collectedInstruments.instruments,
        research,
        experiments,
        collected: {
          collectedAt,
          included,
          languageRoute,
          resolution: {
            kind: resolution.kind,
            ...(resolution.sector ? { sector: resolution.sector } : {}),
            symbols: resolution.instruments.map((i) => i.symbol),
          },
          feedsUsed: news.feedsUsed,
          newsCount: items.length,
          researchCount: research?.length ?? 0,
          experimentCount: experiments?.length ?? 0,
          financialMetricCount: collectedInstruments.instruments
            .reduce((n, i) => n + (i.financial?.metrics.length ?? 0), 0),
          duplicatesRemoved,
          headlineOnlyCount: items.filter((i) => i.contentKind === 'headline').length,
          degraded,
        },
        estimate: {
          estimatedInputTokens,
          assumedOutputTokens: config.assumedOutputTokens,
          estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
          budget: budget.snapshot(),
        },
        confirmToken,
        confirmTokenExpiresAt,
      });
    },
  );

  // ─── 분석 엔드포인트 ───

  /**
   * 견적. LLM을 호출하지 않으므로 비용이 들지 않는다.
   * 예산이 부족하면 여기서 막아 사용자가 확인 단계로 넘어가지 못하게 한다.
   */
  app.post('/api/analyze/estimate', makeAnalyzeLimiter(config), jsonBody, requireAuth, (req, res) => {
    const { mode, body } = splitMode(req.body);
    res.json(runner.estimate(getProfile(mode), body, req));
  });

  app.post(
    '/api/analyze/news',
    makeAnalyzeLimiter(config),   // [1] IP 한도 — 인증 검사보다 싸다
    jsonBody,                     // [2] 본문 크기 제한
    requireAuth,                  // [3] 인증 — 여기를 통과해야만 LLM 경로에 진입한다
    makeSessionLimiter(config),   // [4] 세션 한도 — req.session이 필요하므로 인증 뒤
    async (req, res) => {
      const { mode, body } = splitMode(req.body);
      res.json(await runner.run(getProfile(mode), body, req));
    },
  );

  // 테스트가 라우트를 꽂을 수 있는 지점. 반드시 404 핸들러보다 앞이어야 한다.
  if (extraRoutes) extraRoutes(app, { requireAuth, jsonBody });

  // ─── 빌드된 프론트엔드 서빙 ───
  // API 라우트가 모두 등록된 뒤에 둔다. fileURLToPath를 써야 한다 —
  // URL.pathname은 Windows에서 '/C:/...'가 되어 existsSync가 실패한다.
  const clientDir = fileURLToPath(new URL('./client/dist/', import.meta.url));
  if (existsSync(join(clientDir, 'index.html'))) {
    app.use(express.static(clientDir));
    // SPA 폴백. /api/* 는 위에서 이미 처리됐으므로 여기 오면 안 된다.
    app.get(/^(?!\/api\/).*/, (req, res) => {
      res.sendFile(join(clientDir, 'index.html'));
    });
  }

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
