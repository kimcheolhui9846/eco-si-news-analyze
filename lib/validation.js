import { z } from 'zod';
import { SECTOR_BASKETS } from './providers/sectors.js';
import { MAX_INSTRUMENTS } from './resolve.js';
import { CS_LIMITS, CS_MAX } from './providers/cs-common.js';
import { parseArxivId, SECTION_ANCHOR, PAPER_LIMITS } from './providers/arxiv-html.js';

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
  source: z.enum(['sec', 'dart']),
  symbol: nullableString(32),
  cik: nullableString(16),
  corpCode: nullableString(8),
  entityName: nullableString(200),
  filingUrl: httpUrl.nullable(),
  metrics: z.array(financialMetric).max(20),
  derived: z.array(financialDerived).max(10),
  degraded: z.array(z.strictObject({
    concept: z.string().max(120),
    reason: z.string().max(300),
  })).max(20),
});

const researchItemShape = {
  title: z.string().max(500),
  // 초록이 없는 논문이 실제로 있다. 빈 문자열을 막으면 정상 자료가 400이 된다.
  abstract: z.string().max(5000),
  // provider가 상한까지 자르고 총 인원은 authorCount로 남긴다.
  // 실측에서 저자 217명짜리 arXiv 논문이 있었다.
  authors: z.array(z.string().max(200)).max(10),
  authorCount: z.number().int().min(0),
  venue: z.string().max(300),
  doi: nullableString(200),
  url: httpUrl.nullable(),
  publishedAt: nullableString(64),
  datePrecision: z.enum(['day', 'month', 'year', 'unknown']),
  peerReviewed: z.enum(['peer-reviewed', 'preprint', 'unknown']),
  // 열거형이라 지어낸 DB 이름이 프롬프트로 들어가지 못한다.
  sourceName: z.enum(['Europe PMC', 'arXiv', 'KCI', 'OpenAlex', 'Crossref']),
  language: z.enum(['ko', 'en']),
};
const researchItemSchema = z.strictObject(researchItemShape);

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

/** 뉴스 기사 한 건. 투자·CS 분석이 같은 형태를 쓴다. */
function buildArticleSchema(config) {
  return z.strictObject({
    title: trimmedString(config.maxTitleChars),
    content: trimmedString(config.maxContentChars),
    source: trimmedString(200),
    url: httpUrl,
    publishedAt: parsableDate,
    // Phase 2a: 자료가 전문인지 요약인지 제목뿐인지. 없으면 full로 간주한다.
    // 열거형이라 임의 문자열이 프롬프트에 들어가지 못한다.
    contentKind: z.enum(['headline', 'summary', 'full']).optional(),
  });
}

export function buildAnalyzeSchema(config) {
  const article = buildArticleSchema(config);

  const marketData = z.strictObject({
    assetName: trimmedString(200),
    // 가격·변동률은 "182.50", "+2.3%", 182.5 어느 쪽으로도 올 수 있다.
    currentPrice: z.union([z.string().max(64), z.number()]),
    priceChange: z.union([z.string().max(64), z.number()]),
    chartTrend: trimmedString(config.maxTrendChars),
  });

  const instrument = z.strictObject({
    symbol: z.string().min(1).max(32),
    name: trimmedString(200),
    assetType: z.enum(['stock', 'crypto']),
    market: z.enum(['US', 'KR', 'CRYPTO']),
    marketData: marketData.optional(),
    financial: financialSchema.optional(),
  });

  return z.strictObject({
    newsList: z.array(article).min(1).max(config.maxNewsItems),
    // 시세·재무 종목 묶음. 이 필드와 sector는 cacheKey에도 들어간다.
    instruments: z.array(instrument).min(1).max(MAX_INSTRUMENTS).optional(),
    // 열거형이라 임의 문자열이 프롬프트의 분야 묶음 줄에 들어가지 못한다.
    sector: z.enum(Object.keys(SECTOR_BASKETS)).optional(),
    analysisPeriod: z.string().max(200).optional(),
    // 이 필드들은 cacheKey에도 들어간다 — 넣지 않으면
    // 작은 자료로 견적받고 큰 자료로 실행하는 우회가 성립한다.
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

// ─── CS 기술 동향 ───

/** CS 수집 범위. 클라이언트 ScopePicker의 CS_SCOPES와 순서·값이 같아야 한다. */
export const CS_SCOPES = ['papers', 'community', 'questions', 'news', 'blogs', 'repos'];

/** 비어 있으면 전부. 순서는 CS_SCOPES에 맞춰 고정한다. */
export function normalizeCsInclude(include) {
  if (!Array.isArray(include) || include.length === 0) return [...CS_SCOPES];
  const wanted = new Set(include);
  return CS_SCOPES.filter((s) => wanted.has(s));
}

export function buildCsResearchSchema() {
  return z.strictObject({
    query: trimmedString(200),
    lang: z.enum(['ko', 'en']).optional(),
    include: z.array(z.enum(CS_SCOPES)).max(CS_SCOPES.length).optional(),
  });
}

// 수집기 출력을 그대로 받는다. trim 변환을 두지 않는다 — 변환이 있으면
// 수집 때와 분석 때 자료가 달라져 cacheKey가 어긋난다.
const csPaperSchema = z.strictObject({
  ...researchItemShape,
  category: nullableString(CS_LIMITS.category),
});

const communitySchema = z.strictObject({
  site: z.enum(['hackernews', 'lobsters']),
  title: z.string().min(1).max(CS_LIMITS.title),
  url: httpUrl,
  discussionUrl: httpUrl,
  points: z.number().int().min(0),
  numComments: z.number().int().min(0),
  publishedAt: parsableDate,
  text: z.string().max(CS_LIMITS.text),
});

const blogSchema = z.strictObject({
  title: z.string().min(1).max(CS_LIMITS.title),
  url: httpUrl,
  blog: z.string().min(1).max(CS_LIMITS.blog),
  summary: z.string().max(CS_LIMITS.summary),
  publishedAt: parsableDate,
});

const repoSchema = z.strictObject({
  fullName: z.string().min(1).max(CS_LIMITS.fullName),
  url: httpUrl,
  description: z.string().max(CS_LIMITS.description),
  stars: z.number().int().min(0),
  language: nullableString(CS_LIMITS.language),
  license: nullableString(CS_LIMITS.license),
  pushedAt: nullableString(64),
  createdAt: nullableString(64),
});

const questionSchema = z.strictObject({
  title: z.string().min(1).max(CS_LIMITS.title),
  url: httpUrl,
  author: z.string().max(CS_LIMITS.author),
  tags: z.array(z.string().min(1).max(CS_LIMITS.tag)).max(CS_LIMITS.tags),
  score: z.number().int(),
  answerCount: z.number().int().min(0),
  isAnswered: z.boolean(),
  hasAcceptedAnswer: z.boolean(),
  viewCount: z.number().int().min(0),
  publishedAt: parsableDate,
  text: z.string().max(CS_LIMITS.text),
});

/** CS 분석 요청. 모든 배열이 선택이고, 합계 3건 미만은 프로필이 422로 거부한다. */
export function buildCsAnalyzeSchema(config) {
  return z.strictObject({
    newsList: z.array(buildArticleSchema(config)).max(config.maxNewsItems).optional(),
    papers: z.array(csPaperSchema).max(CS_MAX.papers).optional(),
    community: z.array(communitySchema).max(CS_MAX.community).optional(),
    questions: z.array(questionSchema).max(CS_MAX.questions).optional(),
    blogs: z.array(blogSchema).max(CS_MAX.blogs).optional(),
    repos: z.array(repoSchema).max(CS_MAX.repos).optional(),
  });
}

// ─── 논문 전문 분석 ───

export function buildPaperResearchSchema() {
  return z.strictObject({ arxiv: z.string().trim().min(1).max(300) });
}

const SECTION_ID = /^S\d{1,3}$/;
// 출처 링크는 arXiv로만 간다. 화면과 URL 화이트리스트가 이 값을 쓴다.
const ARXIV_URL = /^https:\/\/arxiv\.org\/(abs|html)\/[A-Za-z0-9./-]{1,60}$/;

// 수집기 출력을 그대로 받는다. trim 변환을 두지 않는다 — 변환이 있으면 cacheKey가 어긋난다.
export function buildPaperAnalyzeSchema(config) {
  const section = z.strictObject({
    id: z.string().regex(SECTION_ID),
    anchor: z.string().regex(SECTION_ANCHOR),
    heading: z.string().max(PAPER_LIMITS.heading),
    text: z.string().max(config.maxPromptChars),
  });
  const truncated = z.strictObject({
    id: z.string().regex(SECTION_ID),
    heading: z.string().max(PAPER_LIMITS.heading),
    partial: z.boolean(),
  });
  return z.strictObject({
    paper: z.strictObject({
      id: z.string().min(1).max(60).refine((v) => parseArxivId(v) === v),
      title: z.string().min(1).max(PAPER_LIMITS.title),
      authors: z.array(z.string().max(PAPER_LIMITS.author)).max(PAPER_LIMITS.authors),
      url: z.string().regex(ARXIV_URL),
      htmlUrl: z.string().regex(ARXIV_URL),
      sections: z.array(section).min(1).max(200)
        .refine((list) => new Set(list.map((s) => s.id)).size === list.length),
      truncated: z.array(truncated).max(200),
    }),
  });
}

/** Zod 오류를 사용자에게 안전한 한 줄로 요약한다. 내부 값은 노출하지 않는다. */
export function formatZodError(error) {
  const first = error.issues[0];
  if (!first) return '요청 데이터가 올바르지 않습니다.';
  const path = first.path.length ? first.path.join('.') : '요청 본문';
  return `요청 데이터가 올바르지 않습니다: ${path}`;
}
