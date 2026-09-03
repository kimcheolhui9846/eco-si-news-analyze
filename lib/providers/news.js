import { parseRssFeed } from './rss.js';
import { buildFeedUrl, feedsFor, tickerFeed } from './feeds.js';

/**
 * 주제 피드 필터. 검색어의 낱말 중 하나라도 맞으면 통과시킨다.
 *
 * 모든 낱말을 요구하면("엔비디아 AI 반도체") 결과가 거의 남지 않는다.
 */
export function matchesQuery(item, query) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;

  const haystack = `${item.title} ${item.content}`.toLowerCase();
  return words.some((w) => haystack.includes(w));
}

export function createRssNewsProvider({ http, cache, clock, makeBreaker }) {
  // 피드마다 독립적인 회로 차단기. 하나가 죽어도 나머지는 계속 시도한다.
  const breakers = new Map();
  const breakerFor = (feedId) => {
    if (!breakers.has(feedId)) breakers.set(feedId, makeBreaker());
    return breakers.get(feedId);
  };

  /** 피드 하나를 가져와 파싱한다. 실패는 예외 대신 degraded로 표현한다. */
  const fetchFeed = async (feed, query) => {
    const breaker = breakerFor(feed.id);
    if (!breaker.canPass()) {
      return { items: [], degraded: { feedId: feed.id, reason: '일시적으로 사용할 수 없습니다.' } };
    }

    const url = buildFeedUrl(feed, { query });
    const cacheKey = `${feed.id}::${feed.kind === 'search' ? query : ''}`;

    const cached = cache.get(cacheKey);
    if (cached) return { items: cached, degraded: null };

    try {
      const { text } = await http.get(url);
      breaker.recordSuccess();

      const parsed = parseRssFeed(text, feed);
      cache.set(cacheKey, parsed);
      return { items: parsed, degraded: null };
    } catch {
      breaker.recordFailure();
      // 상류 원본 메시지에는 내부 경로가 섞일 수 있다. 담지 않는다.
      return { items: [], degraded: { feedId: feed.id, reason: '자료를 가져오지 못했습니다.' } };
    }
  };

  return {
    async search({ query, lang, limit, symbol }) {
      const feeds = [...feedsFor(lang)];
      // 심볼이 해석됐으면 티커별 영문 뉴스도 함께 본다.
      if (symbol) feeds.push(tickerFeed(symbol));

      // 병렬로 가져온다. 하나가 느려도 나머지를 기다리게 하지 않는다.
      const results = await Promise.all(feeds.map(async (feed) => {
        const { items, degraded } = await fetchFeed(feed, query);
        // 검색 피드는 이미 검색 결과다. 주제 피드만 키워드로 거른다.
        const kept = feed.kind === 'topic' ? items.filter((i) => matchesQuery(i, query)) : items;
        return { feed, kept, degraded };
      }));

      const items = [];
      const degraded = [];
      const feedsUsed = [];

      for (const r of results) {
        if (r.degraded) degraded.push(r.degraded);
        if (r.kept.length > 0) feedsUsed.push(r.feed.id);
        items.push(...r.kept);
      }

      // 최신순으로 정렬한 뒤 limit만큼 자른다.
      items.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

      return { items: items.slice(0, limit), degraded, feedsUsed };
    },
  };
}
