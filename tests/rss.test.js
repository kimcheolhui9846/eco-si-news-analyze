import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRssFeed, buildFeedUrl, feedsFor, FEEDS, loadConfig } from '../server.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const googleFeed = {
  id: 'google-news-ko', kind: 'search', lang: 'ko',
  contentKind: 'headline', name: 'Google 뉴스',
  urlTemplate: 'https://news.google.com/rss/search?q={query}&hl=ko&gl=KR&ceid=KR:ko',
};
const yonhapFeed = {
  id: 'yonhap-economy', kind: 'topic', lang: 'ko',
  contentKind: 'summary', name: '연합뉴스',
  url: 'https://www.yna.co.kr/rss/economy.xml',
};

// ─── Google News (검색 피드) ───

test('Google News 항목을 파싱한다', () => {
  const items = parseRssFeed(fixture('google-news-ko.xml'), googleFeed);

  assert.equal(items.length, 4);
  assert.ok(items[0].title.length > 0);
  assert.match(items[0].url, /^https:\/\//);
  assert.match(items[0].publishedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('Google News 제목 끝의 매체명 접미사를 떼어낸다', () => {
  // 원문 제목이 "...(종합) - v.daum.net" 형태다.
  const items = parseRssFeed(fixture('google-news-ko.xml'), googleFeed);
  for (const it of items) {
    assert.ok(!/ - [\w.]+$/.test(it.title), `접미사가 남았다: ${it.title}`);
  }
});

test('Google News의 source 요소에서 매체명을 뽑는다', () => {
  const items = parseRssFeed(fixture('google-news-ko.xml'), googleFeed);
  assert.ok(items[0].source.length > 0);
  assert.notEqual(items[0].source, 'Google 뉴스', 'source 요소 대신 피드 이름을 썼다');
});

test('Google News는 본문이 없으므로 headline으로 표시된다', () => {
  const items = parseRssFeed(fixture('google-news-ko.xml'), googleFeed);
  for (const it of items) {
    assert.equal(it.contentKind, 'headline');
    assert.ok(it.content.length > 0, 'content가 비면 분석 스키마를 통과하지 못한다');
  }
});

test('description의 HTML 앵커가 content로 새어나오지 않는다', () => {
  const items = parseRssFeed(fixture('google-news-ko.xml'), googleFeed);
  for (const it of items) {
    assert.ok(!it.content.includes('<a '), 'HTML 태그가 남았다');
    assert.ok(!it.content.includes('href='), 'HTML 속성이 남았다');
  }
});

// ─── 연합뉴스 (주제 피드) ───

test('연합뉴스 항목에서 CDATA를 벗겨낸다', () => {
  const items = parseRssFeed(fixture('yonhap-economy.xml'), yonhapFeed);

  assert.equal(items.length, 4);
  assert.ok(!items[0].title.includes('CDATA'));
  assert.ok(!items[0].content.includes('CDATA'));
});

test('연합뉴스는 리드 문단이 있으므로 summary로 표시된다', () => {
  const items = parseRssFeed(fixture('yonhap-economy.xml'), yonhapFeed);
  const withBody = items.filter((i) => i.contentKind === 'summary');

  assert.ok(withBody.length > 0, '리드 문단이 있는 항목이 하나도 없다');
  assert.ok(withBody[0].content.length > 30);
});

test('source 요소가 없으면 피드 이름을 쓴다', () => {
  // 연합뉴스 RSS에는 item.source가 없다.
  const items = parseRssFeed(fixture('yonhap-economy.xml'), yonhapFeed);
  assert.equal(items[0].source, '연합뉴스');
});

test('+0900 오프셋 날짜를 ISO로 정규화한다', () => {
  const items = parseRssFeed(fixture('yonhap-economy.xml'), yonhapFeed);
  assert.match(items[0].publishedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

// ─── 견고성 ───

test('item이 하나뿐이어도 배열로 다룬다', () => {
  // fast-xml-parser는 항목이 하나면 배열이 아닌 객체를 준다.
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title>단독 기사</title><link>https://a.com/1</link>
    <description>본문입니다</description><pubDate>Tue, 01 Sep 2026 06:00:00 GMT</pubDate></item>
  </channel></rss>`;

  const items = parseRssFeed(xml, yonhapFeed);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '단독 기사');
});

test('빈 피드는 빈 배열을 반환한다', () => {
  const xml = '<?xml version="1.0"?><rss><channel><title>비어있음</title></channel></rss>';
  assert.deepEqual(parseRssFeed(xml, yonhapFeed), []);
});

test('깨진 XML은 예외 대신 빈 배열을 반환한다', () => {
  // 피드 하나가 깨졌다고 수집 전체가 죽으면 안 된다.
  assert.deepEqual(parseRssFeed('<rss><channel><item>깨짐', yonhapFeed), []);
  assert.deepEqual(parseRssFeed('전혀 XML이 아님', yonhapFeed), []);
  assert.deepEqual(parseRssFeed('', yonhapFeed), []);
});

test('날짜가 없거나 파싱 불가한 항목은 버린다', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title>날짜없음</title><link>https://a.com/1</link></item>
    <item><title>날짜이상</title><link>https://a.com/2</link><pubDate>어제</pubDate></item>
    <item><title>정상</title><link>https://a.com/3</link><pubDate>Tue, 01 Sep 2026 06:00:00 GMT</pubDate></item>
  </channel></rss>`;

  const items = parseRssFeed(xml, yonhapFeed);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '정상');
});

test('링크가 없거나 http/https가 아닌 항목은 버린다', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title>링크없음</title><pubDate>Tue, 01 Sep 2026 06:00:00 GMT</pubDate></item>
    <item><title>위험한스킴</title><link>javascript:alert(1)</link><pubDate>Tue, 01 Sep 2026 06:00:00 GMT</pubDate></item>
    <item><title>정상</title><link>https://a.com/3</link><pubDate>Tue, 01 Sep 2026 06:00:00 GMT</pubDate></item>
  </channel></rss>`;

  const items = parseRssFeed(xml, yonhapFeed);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '정상');
});

test('제목이 없는 항목은 버린다', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><link>https://a.com/1</link><pubDate>Tue, 01 Sep 2026 06:00:00 GMT</pubDate></item>
  </channel></rss>`;
  assert.deepEqual(parseRssFeed(xml, yonhapFeed), []);
});

test('외부 엔티티(XXE)가 확장되지 않는다', () => {
  // fast-xml-parser가 거부하며, parseRssFeed는 이를 빈 배열로 흡수한다.
  const xxe = `<?xml version="1.0"?>
    <!DOCTYPE rss [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
    <rss><channel><item><title>&xxe;</title><link>https://a.com/1</link>
    <pubDate>Tue, 01 Sep 2026 06:00:00 GMT</pubDate></item></channel></rss>`;

  const items = parseRssFeed(xxe, yonhapFeed);
  assert.equal(JSON.stringify(items).includes('root:'), false);
});

test('제어문자를 제거한다', () => {
  const xml = `<?xml version="1.0"?><rss><channel>
    <item><title>\u0007제목</title><link>https://a.com/1</link>
    <description>\u001B[31m본문</description>
    <pubDate>Tue, 01 Sep 2026 06:00:00 GMT</pubDate></item>
  </channel></rss>`;

  const items = parseRssFeed(xml, yonhapFeed);
  assert.equal(items[0].title.includes('\u0007'), false);
  assert.equal(items[0].content.includes('\u001B'), false);
});

// ─── 피드 레지스트리 ───

test('검색 피드 URL에 검색어를 인코딩해 넣는다', () => {
  const url = buildFeedUrl(googleFeed, { query: '삼성전자 실적' });

  assert.ok(url.includes(encodeURIComponent('삼성전자 실적')));
  assert.ok(!url.includes('{query}'));
  assert.ok(!url.includes(' '), '인코딩되지 않은 공백이 남았다');
});

test('주제 피드는 고정 URL을 그대로 쓴다', () => {
  assert.equal(buildFeedUrl(yonhapFeed, { query: '무엇이든' }), yonhapFeed.url);
});

test('검색어의 특수문자가 URL 구조를 깨지 못한다', () => {
  const url = buildFeedUrl(googleFeed, { query: 'a&b=c#d' });
  const parsed = new URL(url);

  assert.equal(parsed.hostname, 'news.google.com');
  assert.equal(parsed.searchParams.get('q'), 'a&b=c#d');
});

test('언어로 피드를 고른다', () => {
  const ko = feedsFor('ko');
  const en = feedsFor('en');

  assert.ok(ko.length > 0 && en.length > 0);
  assert.ok(ko.every((f) => f.lang === 'ko'));
  assert.ok(en.every((f) => f.lang === 'en'));
});

test('레지스트리의 모든 피드가 필수 필드를 갖는다', () => {
  for (const f of FEEDS) {
    assert.ok(f.id && f.name && f.lang, `필드 누락: ${JSON.stringify(f)}`);
    assert.ok(['search', 'topic'].includes(f.kind), `kind 이상: ${f.id}`);
    assert.ok(['headline', 'summary'].includes(f.contentKind), `contentKind 이상: ${f.id}`);
    assert.ok(f.kind === 'search' ? f.urlTemplate : f.url, `URL 누락: ${f.id}`);
  }
});

test('레지스트리의 모든 호스트가 기본 허용목록에 있다', () => {
  const allow = new Set(loadConfig({ MY_SECRET_PASSWORD: 'pw', LLM_MODE: 'mock' }).externalAllowlist);

  for (const f of FEEDS) {
    const host = new URL(f.url ?? f.urlTemplate.replace('{query}', 'x')).hostname;
    assert.ok(allow.has(host), `${f.id}의 호스트 ${host}가 허용목록에 없다`);
  }
});
