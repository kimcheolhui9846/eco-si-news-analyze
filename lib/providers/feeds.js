/**
 * 피드 레지스트리.
 *
 * kind가 다르면 수집 방식이 다르다.
 * - search: 검색어를 URL에 넣는다. 커버리지가 넓지만 본문이 없다
 * - topic:  고정 피드를 받아 키워드로 거른다. 리드 문단이 있지만 최신 기사만 잡힌다
 *
 * 이 차이를 설정으로 표현하므로 코드 경로는 하나다.
 */
export const FEEDS = [
  {
    id: 'google-news-ko',
    name: 'Google 뉴스',
    kind: 'search',
    lang: 'ko',
    contentKind: 'headline',
    urlTemplate: 'https://news.google.com/rss/search?q={query}&hl=ko&gl=KR&ceid=KR:ko',
  },
  {
    id: 'google-news-en',
    name: 'Google News',
    kind: 'search',
    lang: 'en',
    contentKind: 'headline',
    urlTemplate: 'https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en',
  },
  {
    id: 'yonhap-economy',
    name: '연합뉴스',
    kind: 'topic',
    lang: 'ko',
    contentKind: 'summary',
    url: 'https://www.yna.co.kr/rss/economy.xml',
  },
  {
    id: 'etnews',
    name: '전자신문',
    kind: 'topic',
    lang: 'ko',
    contentKind: 'summary',
    url: 'https://rss.etnews.com/Section901.xml',
  },
];

/** 티커별 영문 뉴스 피드. 심볼이 해석된 경우에만 쓴다. */
export const tickerFeed = (symbol) => ({
  id: `yahoo-headline-${symbol}`,
  name: 'Yahoo Finance',
  kind: 'search',
  lang: 'en',
  contentKind: 'summary',
  urlTemplate: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`,
});

export function buildFeedUrl(feed, { query }) {
  if (feed.kind === 'topic') return feed.url;
  return feed.urlTemplate.replace('{query}', encodeURIComponent(query));
}

export function feedsFor(lang) {
  return FEEDS.filter((f) => f.lang === lang);
}
