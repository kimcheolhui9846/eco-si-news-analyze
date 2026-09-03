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

    // 비용 예산. rate limit과 달리 총량을 막는다.
    budgetFile: e.BUDGET_FILE ?? '.budget.json',
    dailyAnalysisLimit: num(e.DAILY_ANALYSIS_LIMIT, 50),
    monthlyCostLimitUsd: num(e.MONTHLY_COST_LIMIT_USD, 5),
    // 모델 가격은 바뀐다. 코드에 박지 않고 환경변수로 둔다.
    priceInputPer1M: num(e.PRICE_INPUT_PER_1M, 2.5),
    priceOutputPer1M: num(e.PRICE_OUTPUT_PER_1M, 10),
    // 출력 토큰은 호출 전에 알 수 없다. 견적에서 이 값으로 가정한다.
    assumedOutputTokens: num(e.ASSUMED_OUTPUT_TOKENS, 2_000),
    confirmTokenTtlMs: num(e.CONFIRM_TOKEN_TTL_MS, 300_000),
  });
}
