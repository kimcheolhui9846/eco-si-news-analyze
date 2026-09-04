import { XMLParser } from 'fast-xml-parser';
import { RESEARCH_LIMITS } from './papers.js';

// ─── KCI (한국연구재단 한국학술지인용색인) ───
//
// RISS는 공개 API가 없고(/openapi/ → 404) DBpia는 구독 기반이라 초록조차
// 로그인을 요구한다. 두 곳 모두 HTML 스크래핑은 이용약관 위반이다.
// 국내 논문의 정당한 경로는 KCI OpenAPI 하나뿐이다.

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

const asArray = (v) => {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
};

const collapse = (raw) => String(raw ?? '').replace(/\s+/g, ' ').trim();

/** KCI가 보정하는 범위. 미리 맞춰야 요청과 결과 개수가 어긋나지 않는다. */
const DISPLAY_MIN = 10;
const DISPLAY_MAX = 100;

export function buildKciUrl({ apiKey, query, limit, page = 1 }) {
  const displayCount = Math.min(DISPLAY_MAX, Math.max(DISPLAY_MIN, Number(limit) || DISPLAY_MIN));
  const params = new URLSearchParams({
    apiCode: 'articleSearch',
    key: apiKey,
    // abstract는 허용 파라미터가 아니다. 제목으로만 검색한다.
    title: query,
    displayCount: String(displayCount),
    page: String(page),
  });
  return `https://open.kci.go.kr/po/openapi/openApiSearch.kci?${params.toString()}`;
}

/**
 * 정상 응답의 요소 이름은 아직 확정되지 않았다.
 *
 * 키가 없어 성공 응답을 받아본 적이 없다. 실제 응답을 받으면 이 표만
 * 고치면 되고 나머지 코드는 그대로 둘 수 있다.
 */
export const KCI_FIELD_NAMES = {
  record: ['record', 'item', 'article'],
  title: ['article-title', 'articleTitle', 'title'],
  abstract: ['abstract', 'abstractText'],
  authors: ['author-name', 'authorName', 'author'],
  journal: ['journal-name', 'journalName', 'journal'],
  year: ['pub-year', 'pubYear', 'year'],
  url: ['url', 'article-url', 'link'],
  doi: ['doi'],
};

/** 이름이 맞는 첫 값을 깊이 우선으로 찾는다. 요소 경로가 확정되지 않았기 때문이다. */
function findFirst(node, names) {
  if (node === null || node === undefined) return undefined;
  if (typeof node !== 'object') return undefined;

  for (const name of names) {
    if (node[name] !== undefined) return node[name];
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = findFirst(entry, names);
        if (found !== undefined) return found;
      }
    } else if (value && typeof value === 'object') {
      const found = findFirst(value, names);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** 이름이 맞는 노드를 모두 모은다. */
function findAll(node, names, out = []) {
  if (!node || typeof node !== 'object') return out;
  for (const name of names) {
    if (node[name] !== undefined) out.push(...asArray(node[name]));
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((entry) => findAll(entry, names, out));
    else if (value && typeof value === 'object') findAll(value, names, out);
  }
  return out;
}

export function parseKciResponse(text) {
  let root;
  try {
    root = parser.parse(text);
  } catch {
    return { messages: ['응답을 해석하지 못했습니다.'], records: [] };
  }

  const meta = root?.MetaData ?? root ?? {};
  // resultMsg는 하나가 아니라 누적되어 여러 개로 온다.
  const messages = asArray(meta?.outputData?.result?.resultMsg)
    .map((m) => collapse(m))
    .filter(Boolean);

  const records = findAll(meta?.outputData ?? {}, KCI_FIELD_NAMES.record);
  return { messages, records };
}

/** IP 허용목록 거부인지. 일반 오류와 섞으면 원인을 짚을 수 없다. */
export function isIpRejection(messages) {
  return messages.some((m) => /\bip\b/i.test(String(m)));
}

/** 로그나 오류 문자열에 키가 섞여 나가지 않게 가린다. */
export function redactKey(text, apiKey) {
  if (!apiKey) return String(text);
  return String(text).split(apiKey).join('[REDACTED]');
}

function toResearchItem(record) {
  const year = findFirst(record, KCI_FIELD_NAMES.year);
  const doi = findFirst(record, KCI_FIELD_NAMES.doi);
  const url = findFirst(record, KCI_FIELD_NAMES.url);
  const isYear = /^\d{4}$/.test(String(year ?? ''));

  // papers.js와 같은 상한을 쓴다. 상한이 갈라지면 한쪽 소스만 400이 난다.
  const clamp = (text, max) => String(text ?? '').slice(0, max);
  const allAuthors = findAll(record, KCI_FIELD_NAMES.authors)
    .map((a) => collapse(a)).filter(Boolean);

  return {
    title: clamp(collapse(findFirst(record, KCI_FIELD_NAMES.title)), RESEARCH_LIMITS.title),
    abstract: clamp(collapse(findFirst(record, KCI_FIELD_NAMES.abstract)), RESEARCH_LIMITS.abstract),
    authors: allAuthors.slice(0, RESEARCH_LIMITS.authors)
      .map((a) => clamp(a, RESEARCH_LIMITS.authorName)),
    authorCount: allAuthors.length,
    venue: clamp(collapse(findFirst(record, KCI_FIELD_NAMES.journal)) || 'KCI 등재지', RESEARCH_LIMITS.venue),
    doi: doi ? clamp(collapse(doi), RESEARCH_LIMITS.doi) : null,
    url: url ? collapse(url) : null,
    publishedAt: isYear ? new Date(`${year}-01-01T00:00:00Z`).toISOString() : null,
    // KCI는 발표 연도만 준다. 월·일을 아는 것처럼 표시하지 않는다.
    datePrecision: isYear ? 'year' : 'unknown',
    // KCI 등재지는 심사를 거친 학술지다.
    peerReviewed: 'peer-reviewed',
    sourceName: 'KCI',
    language: 'ko',
  };
}

export function createKciProvider({ http, cache, clock, makeBreaker, apiKey }) {
  const breaker = makeBreaker();

  return {
    async search({ query, limit }) {
      // 키가 없으면 호출하지 않는다. 서버는 이 상태로도 정상 동작한다.
      if (!apiKey) {
        return {
          items: [],
          degraded: {
            source: 'KCI',
            kind: 'no-key',
            reason: '국내 논문 검색에는 KCI API 키가 필요합니다. open.kci.go.kr에서 무료로 발급할 수 있습니다.',
          },
        };
      }

      const cacheKey = `${limit}:${query}`;
      const cached = cache.get(cacheKey);
      if (cached) return cached;

      if (!breaker.canPass()) {
        return {
          items: [],
          degraded: { source: 'KCI', kind: 'unavailable', reason: '일시적으로 사용할 수 없습니다.' },
        };
      }

      let text;
      try {
        ({ text } = await http.get(buildKciUrl({ apiKey, query, limit })));
        breaker.recordSuccess();
      } catch {
        breaker.recordFailure();
        // 원본 오류에는 키가 든 URL이 섞일 수 있다. 담지 않는다.
        return {
          items: [],
          degraded: { source: 'KCI', kind: 'fetch-failed', reason: '국내 논문 자료를 가져오지 못했습니다.' },
        };
      }

      const { messages, records } = parseKciResponse(text);

      // HTTP 상태코드가 아니라 본문으로 판정한다.
      if (messages.length > 0) {
        const ip = isIpRejection(messages);
        return {
          items: [],
          degraded: {
            source: 'KCI',
            kind: ip ? 'ip-mismatch' : 'rejected',
            reason: ip
              ? '등록된 IP와 현재 IP가 다릅니다. open.kci.go.kr에서 현재 IP를 다시 등록해 주세요.'
              : '국내 논문 검색이 거부되었습니다. KCI API 키와 등록 상태를 확인해 주세요.',
          },
        };
      }

      const payload = {
        items: records.map(toResearchItem).filter((i) => i.title).slice(0, limit),
        degraded: null,
      };
      cache.set(cacheKey, payload);
      return payload;
    },
  };
}
