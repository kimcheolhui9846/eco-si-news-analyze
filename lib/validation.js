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
  });
}

/** Zod 오류를 사용자에게 안전한 한 줄로 요약한다. 내부 값은 노출하지 않는다. */
export function formatZodError(error) {
  const first = error.issues[0];
  if (!first) return '요청 데이터가 올바르지 않습니다.';
  const path = first.path.length ? first.path.join('.') : '요청 본문';
  return `요청 데이터가 올바르지 않습니다: ${path}`;
}
