import { z } from 'zod';

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

/** 수집 범위. 'news'는 항상 포함된다 — 빼면 분석이 성립하지 않는다. */
export const COLLECT_SCOPES = ['news', 'market', 'financial', 'research', 'experiments'];

export function normalizeInclude(include) {
  if (!Array.isArray(include) || include.length === 0) return ['news', 'market'];
  const wanted = new Set(include.filter((v) => COLLECT_SCOPES.includes(v)));
  wanted.add('news');
  // 순서를 COLLECT_SCOPES에 맞춰 고정한다. 응답이 요청 순서에 흔들리지 않는다.
  return COLLECT_SCOPES.filter((s) => wanted.has(s));
}

/** provider가 null을 싣는 자리. nullable을 optional로 쓰면 해시가 어긋난다. */
const nullableString = (max) => z.string().max(max).nullable();

const financialMetric = z.strictObject({
  concept: z.string().max(120),
  label: z.string().max(60),
  value: z.number(),
  unit: z.string().max(40),
  periodStart: nullableString(32),
  periodEnd: nullableString(32),
  fiscalYear: z.number().int().nullable(),
  fiscalPeriod: nullableString(8),
  form: nullableString(16),
  filed: nullableString(32),
});

const financialDerived = z.strictObject({
  label: z.string().max(60),
  value: z.number(),
  unit: z.string().max(8),
  basis: z.string().max(120),
  formula: z.string().max(120),
});

const financialSchema = z.strictObject({
  symbol: nullableString(32),
  cik: z.string().max(16),
  entityName: nullableString(200),
  filingUrl: httpUrl.nullable(),
  metrics: z.array(financialMetric).max(20),
  derived: z.array(financialDerived).max(10),
  degraded: z.array(z.strictObject({
    concept: z.string().max(120),
    reason: z.string().max(300),
  })).max(20),
});

const researchItemSchema = z.strictObject({
  title: z.string().max(500),
  // 초록이 없는 논문이 실제로 있다. 빈 문자열을 막으면 정상 자료가 400이 된다.
  abstract: z.string().max(5000),
  authors: z.array(z.string().max(200)).max(50),
  venue: z.string().max(300),
  doi: nullableString(200),
  url: httpUrl.nullable(),
  publishedAt: nullableString(64),
  datePrecision: z.enum(['day', 'month', 'year', 'unknown']),
  peerReviewed: z.enum(['peer-reviewed', 'preprint', 'unknown']),
  // 열거형이라 지어낸 DB 이름이 프롬프트로 들어가지 못한다.
  sourceName: z.enum(['Europe PMC', 'arXiv', 'KCI']),
  language: z.enum(['ko', 'en']),
});

const experimentItemSchema = z.strictObject({
  nctId: z.string().max(32),
  title: z.string().max(500),
  organization: nullableString(300),
  url: httpUrl.nullable(),
  phase: nullableString(32),
  status: nullableString(64),
  enrollmentCount: z.number().int().nullable(),
  enrollmentType: z.enum(['ACTUAL', 'ESTIMATED']).nullable(),
  conditions: z.array(z.string().max(300)).max(30),
  startDate: nullableString(32),
  hasResults: z.boolean(),
});

export function buildAnalyzeSchema(config) {
  const article = z.strictObject({
    title: trimmedString(config.maxTitleChars),
    content: trimmedString(config.maxContentChars),
    source: trimmedString(200),
    url: httpUrl,
    publishedAt: parsableDate,
    // Phase 2a: 자료가 전문인지 요약인지 제목뿐인지. 없으면 full로 간주한다.
    // 열거형이라 임의 문자열이 프롬프트에 들어가지 못한다.
    contentKind: z.enum(['headline', 'summary', 'full']).optional(),
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
    // Phase 2b. 이 세 필드는 cacheKey에도 들어간다 — 넣지 않으면
    // 작은 자료로 견적받고 큰 자료로 실행하는 우회가 성립한다.
    financial: financialSchema.optional(),
    research: z.array(researchItemSchema).max(config.maxResearchItems).optional(),
    experiments: z.array(experimentItemSchema).max(config.maxExperimentItems).optional(),
  });
}

export function buildResearchSchema(config) {
  return z.strictObject({
    query: trimmedString(200),
    symbol: z.string().min(1).max(32).optional(),
    assetType: z.enum(['stock', 'crypto']).optional(),
    lang: z.enum(['ko', 'en']).optional(),
    range: z.enum(['5d', '1mo', '3mo', '6mo', '1y']).optional(),
    maxNews: z.number().int().min(1).max(config.maxNewsItems).optional(),
    include: z.array(z.enum(COLLECT_SCOPES)).max(COLLECT_SCOPES.length).optional(),
  });
}

/** Zod 오류를 사용자에게 안전한 한 줄로 요약한다. 내부 값은 노출하지 않는다. */
export function formatZodError(error) {
  const first = error.issues[0];
  if (!first) return '요청 데이터가 올바르지 않습니다.';
  const path = first.path.length ? first.path.join('.') : '요청 본문';
  return `요청 데이터가 올바르지 않습니다: ${path}`;
}
