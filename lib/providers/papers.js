import { XMLParser } from 'fast-xml-parser';
import { routeForQuery } from './language.js';
import { buildOpenAlexUrl, parseOpenAlex } from './openalex.js';
import { buildCrossrefUrl, parseCrossref } from './crossref.js';

export { parseOpenAlex, parseCrossref };

// ─── 논문 커넥터 ───
//
// 소스마다 응답 형식이 다르므로 파서를 따로 두되 반환 형태를 하나로 맞춘다.
// 뉴스 피드와 같은 구조다.

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

/** fast-xml-parser는 항목이 하나면 배열이 아닌 객체를 준다. */
const asArray = (v) => {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
};

const collapse = (raw) => String(raw ?? '').replace(/\s+/g, ' ').trim();

/**
 * 자료 상한. lib/validation.js의 스키마와 **같은 값이어야 한다.**
 *
 * 실측에서 arXiv 논문 하나에 저자가 217명이었다. 그대로 실으면 분석 스키마가
 * 자기 provider의 출력을 400으로 거부한다. provider는 자기 검증기가 받아들이는
 * 범위 안에서만 자료를 만든다.
 */
export const RESEARCH_LIMITS = {
  title: 500,
  abstract: 5000,
  venue: 300,
  doi: 200,
  authors: 10,
  authorName: 200,
};

const clamp = (text, max) => String(text ?? '').slice(0, max);

/**
 * arXiv 협업 논문은 <name>NVIDIA</name><name>:</name>처럼 구분 기호를 저자로 보낸다.
 * 글자도 숫자도 없는 이름은 사람이 아니다.
 */
const isRealAuthor = (name) => /[\p{L}\p{N}]/u.test(name);

/** 저자를 상한까지 자르되 총 인원은 남긴다. 자르고 침묵하면 연구 규모를 잃는다. */
export function normalizeAuthors(names) {
  const real = names.filter(isRealAuthor);
  return {
    authors: real.slice(0, RESEARCH_LIMITS.authors)
      .map((a) => clamp(a, RESEARCH_LIMITS.authorName)),
    authorCount: real.length,
  };
}


/** 연도만 아는 것을 1월 1일로 저장하되 정밀도를 함께 남긴다. */
function datePartsFrom(fullDate, year) {
  if (fullDate && /^\d{4}-\d{2}-\d{2}/.test(fullDate)) {
    return {
      publishedAt: new Date(`${String(fullDate).slice(0, 10)}T00:00:00Z`).toISOString(),
      datePrecision: 'day',
    };
  }
  if (fullDate && /^\d{4}-\d{2}$/.test(fullDate)) {
    return { publishedAt: new Date(`${fullDate}-01T00:00:00Z`).toISOString(), datePrecision: 'month' };
  }
  if (year && /^\d{4}$/.test(String(year))) {
    return { publishedAt: new Date(`${year}-01-01T00:00:00Z`).toISOString(), datePrecision: 'year' };
  }
  return { publishedAt: null, datePrecision: 'unknown' };
}

export function parseEuropePmc(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return [];
  }

  return asArray(body?.resultList?.result).map((r) => {
    const doi = r.doi ? clamp(String(r.doi), RESEARCH_LIMITS.doi) : null;
    const pubTypes = asArray(r.pubTypeList?.pubType).map((t) => String(t).toLowerCase());
    const isPreprint = r.source === 'PPR' || pubTypes.includes('preprint');

    const listed = asArray(r.authorList?.author)
      .map((a) => collapse(a.fullName))
      .filter(Boolean);
    const allAuthors = listed.length > 0
      ? listed
      : collapse(r.authorString).split(',').map((a) => a.trim()).filter(Boolean);

    return {
      title: clamp(collapse(r.title), RESEARCH_LIMITS.title),
      abstract: clamp(collapse(r.abstractText), RESEARCH_LIMITS.abstract),
      ...normalizeAuthors(allAuthors),
      venue: clamp(collapse(r.journalInfo?.journal?.title) || 'Europe PMC', RESEARCH_LIMITS.venue),
      doi,
      url: doi
        ? `https://doi.org/${doi}`
        : `https://europepmc.org/abstract/${r.source}/${r.id}`,
      ...datePartsFrom(r.firstPublicationDate, r.pubYear),
      peerReviewed: isPreprint ? 'preprint' : 'peer-reviewed',
      sourceName: 'Europe PMC',
      language: 'en',
    };
  }).filter((i) => i.title);
}

export function parseArxiv(text) {
  let feed;
  try {
    feed = parser.parse(text)?.feed;
  } catch {
    return [];
  }
  if (!feed) return [];

  return asArray(feed.entry).map((e) => {
    const links = asArray(e.link);
    const alternate = links.find((l) => l['@_rel'] === 'alternate')?.['@_href'];
    const doi = e['arxiv:doi'] ? clamp(String(e['arxiv:doi']), RESEARCH_LIMITS.doi) : null;

    return {
      title: clamp(collapse(e.title), RESEARCH_LIMITS.title),
      abstract: clamp(collapse(e.summary), RESEARCH_LIMITS.abstract),
      ...normalizeAuthors(asArray(e.author).map((a) => collapse(a.name)).filter(Boolean)),
      venue: clamp(`arXiv (${e['arxiv:primary_category']?.['@_term'] ?? '분류 미상'})`, RESEARCH_LIMITS.venue),
      doi,
      url: alternate ?? String(e.id ?? '').replace('http://', 'https://'),
      ...datePartsFrom(e.published, null),
      // arXiv는 프리프린트 서버다. 예외가 없다.
      peerReviewed: 'preprint',
      sourceName: 'arXiv',
      language: 'en',
    };
  }).filter((i) => i.title);
}

/** 중복 판정용 제목 키. 공백·구두점·대소문자 차이를 무시한다. */
const titleKey = (title) => String(title ?? '').toLowerCase().replace(/[\s\p{P}]/gu, '');

/**
 * DOI가 같으면 하나만 남긴다. 앞에 온 것을 남기므로 호출부가
 * 동료 심사본을 먼저 넣어야 한다.
 */
export function dedupeResearch(items) {
  const seenDoi = new Set();
  const seenTitle = new Set();
  const kept = [];

  for (const item of items) {
    const doi = item.doi ? item.doi.toLowerCase() : null;
    const tkey = titleKey(item.title);
    if ((doi && seenDoi.has(doi)) || seenTitle.has(tkey)) continue;
    if (doi) seenDoi.add(doi);
    seenTitle.add(tkey);
    kept.push(item);
  }
  return kept;
}

/** 두 목록을 번갈아 합친다. 한쪽이 길어도 다른 쪽이 밀려나지 않는다. */
function interleave(...lists) {
  const merged = [];
  for (let i = 0; i < Math.max(0, ...lists.map((list) => list.length)); i += 1) {
    for (const list of lists) if (list[i]) merged.push(list[i]);
  }
  return merged;
}

export function createResearchProvider({ http, cache, clock, makeBreaker, kci, contactEmail = '' }) {
  const breakers = new Map();
  const breakerFor = (id) => {
    if (!breakers.has(id)) breakers.set(id, makeBreaker());
    return breakers.get(id);
  };

  /** 소스 하나를 가져와 파싱한다. 실패는 예외 대신 degraded로 표현한다. */
  const fetchSource = async ({ id, url, parse }) => {
    const breaker = breakerFor(id);
    if (!breaker.canPass()) {
      return { items: [], degraded: { source: id, reason: '일시적으로 사용할 수 없습니다.' } };
    }
    try {
      const { text } = await http.get(url);
      breaker.recordSuccess();
      return { items: parse(text), degraded: null };
    } catch {
      breaker.recordFailure();
      return { items: [], degraded: { source: id, reason: '자료를 가져오지 못했습니다.' } };
    }
  };

  return {
    async search({ query, limit }) {
      const languageRoute = routeForQuery(query);
      const cacheKey = `${languageRoute.route}:${limit}:${query}`;

      const cached = cache.get(cacheKey);
      if (cached) return { ...cached, languageRoute };

      const degraded = [];
      const sourcesUsed = [];
      let items = [];

      const openAlex = await fetchSource({
        id: 'OpenAlex',
        url: buildOpenAlexUrl({ query, limit }),
        parse: parseOpenAlex,
      });
      if (openAlex.degraded) degraded.push(openAlex.degraded);
      if (openAlex.items.length > 0) sourcesUsed.push('OpenAlex');
      items = openAlex.items;

      if (languageRoute.useEnglishPapers) {
        const q = encodeURIComponent(query);
        const [pmc, arxiv] = await Promise.all([
          fetchSource({
            id: 'Europe PMC',
            url: `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${q}&resultType=core&pageSize=${limit}&format=json`,
            parse: parseEuropePmc,
          }),
          fetchSource({
            id: 'arXiv',
            // http는 301을 준다. https만 쓴다.
            url: `https://export.arxiv.org/api/query?search_query=all:${q}&start=0&max_results=${limit}`,
            parse: parseArxiv,
          }),
        ]);

        for (const r of [pmc, arxiv]) if (r.degraded) degraded.push(r.degraded);
        if (pmc.items.length > 0) sourcesUsed.push('Europe PMC');
        if (arxiv.items.length > 0) sourcesUsed.push('arXiv');

        // 동료 심사본을 앞에 둔다. dedupe가 앞의 것을 남기기 때문이다.
        items = interleave(openAlex.items, pmc.items, arxiv.items);
      }

      if (languageRoute.useKci && kci) {
        const result = await kci.search({ query, limit });
        if (result.degraded) degraded.push(result.degraded);
        if (result.items.length > 0) sourcesUsed.push('KCI');
        items = interleave(items, result.items);
      }

      if (dedupeResearch(items).length < limit) {
        const crossref = await fetchSource({
          id: 'Crossref',
          url: buildCrossrefUrl({ query, limit, contactEmail }),
          parse: parseCrossref,
        });
        if (crossref.degraded) degraded.push(crossref.degraded);
        if (crossref.items.length > 0) sourcesUsed.push('Crossref');
        items = interleave(items, crossref.items);
      }

      const payload = {
        items: dedupeResearch(items).slice(0, limit),
        degraded,
        sourcesUsed,
      };
      cache.set(cacheKey, payload);
      return { ...payload, languageRoute };
    },
  };
}
