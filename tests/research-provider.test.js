import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createResearchProvider, parseEuropePmc, parseArxiv, dedupeResearch,
  createTtlCache, createCircuitBreaker,
} from '../server.js';
import { makeClock } from './helpers.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const PMC = fixture('europepmc-battery.json');
const ARXIV = fixture('arxiv-battery.xml');

const makeHttp = (routes) => {
  const calls = [];
  return {
    calls,
    async get(url) {
      calls.push(url);
      for (const [pattern, handler] of Object.entries(routes)) {
        if (url.includes(pattern)) {
          if (handler instanceof Error) throw handler;
          return { status: 200, text: handler, url };
        }
      }
      throw new Error(`라우트 없음: ${url}`);
    },
  };
};

const provider = (http, over = {}) => {
  const clock = makeClock();
  return createResearchProvider({
    http,
    cache: over.cache ?? createTtlCache({ ttlMs: 3_600_000, maxEntries: 50, clock }),
    clock,
    makeBreaker: () => createCircuitBreaker({ threshold: 3, cooldownMs: 60_000, clock }),
    kci: over.kci,
  });
};

// ─── Europe PMC 파서 ───

test('Europe PMC 응답에서 DOI·초록·저널을 뽑는다', () => {
  const items = parseEuropePmc(PMC);
  assert.equal(items.length, 2);

  const journal = items.find((i) => i.doi === '10.1038/s41597-026-07577-6');
  assert.equal(journal.venue, 'Scientific data');
  assert.equal(journal.url, 'https://doi.org/10.1038/s41597-026-07577-6');
  assert.ok(journal.abstract.length > 100);
  assert.equal(journal.sourceName, 'Europe PMC');
  assert.equal(journal.language, 'en');
});

test('Europe PMC의 PPR 항목은 프리프린트로 표시한다', () => {
  const items = parseEuropePmc(PMC);
  const preprint = items.find((i) => i.doi === '10.12688/openreseurope.24002.1');
  assert.equal(preprint.peerReviewed, 'preprint');

  const journal = items.find((i) => i.doi === '10.1038/s41597-026-07577-6');
  assert.equal(journal.peerReviewed, 'peer-reviewed');
});

test('firstPublicationDate가 있으면 정밀도가 day다', () => {
  const items = parseEuropePmc(PMC);
  assert.equal(items[0].publishedAt.slice(0, 10), '2026-08-17');
  assert.equal(items[0].datePrecision, 'day');
});

test('연도만 있으면 1월 1일로 저장하고 정밀도를 year로 남긴다', () => {
  // 정밀도를 남기지 않으면 "2026년 1월 발표"라는 없는 사실이 생긴다.
  const body = JSON.stringify({
    resultList: { result: [{ id: 'X1', source: 'MED', title: '연도만 있는 논문', pubYear: '2019' }] },
  });
  const [item] = parseEuropePmc(body);
  assert.equal(item.publishedAt.slice(0, 10), '2019-01-01');
  assert.equal(item.datePrecision, 'year');
});

test('깨진 JSON에는 빈 배열을 돌려준다', () => {
  assert.deepEqual(parseEuropePmc('{{{'), []);
  assert.deepEqual(parseEuropePmc(''), []);
});

// ─── arXiv 파서 ───

test('arXiv 응답에서 초록·저자·링크를 뽑는다', () => {
  const items = parseArxiv(ARXIV);
  assert.equal(items.length, 3);

  const first = items[0];
  assert.match(first.title, /Powering the Future/);
  assert.ok(first.abstract.includes('electric vehicles'));
  assert.deepEqual(first.authors.slice(0, 2), [
    'Venkata Sai Chandra Prasanth Narisetty',
    'Tejaswi Maddineni',
  ]);
  assert.equal(first.url, 'https://arxiv.org/abs/2412.20687v1');
  assert.equal(first.doi, '10.62441/nano-ntp.vi.3915');
  assert.equal(first.publishedAt.slice(0, 10), '2024-12-30');
  assert.equal(first.datePrecision, 'day');
});

test('arXiv 항목은 모두 프리프린트다', () => {
  // 동료 심사를 거치지 않았다. 이것을 표시하지 않으면 학술지 논문과
  // 같은 무게로 인용된다.
  for (const item of parseArxiv(ARXIV)) {
    assert.equal(item.peerReviewed, 'preprint');
    assert.equal(item.sourceName, 'arXiv');
  }
});

test('arXiv DOI가 없는 항목도 처리한다', () => {
  const items = parseArxiv(ARXIV);
  const noDoi = items.find((i) => i.url.includes('2401.07238'));
  assert.equal(noDoi.doi, null);
});

test('깨진 XML에는 빈 배열을 돌려준다', () => {
  assert.deepEqual(parseArxiv('<not-a-feed>'), []);
  assert.deepEqual(parseArxiv(''), []);
});

// ─── 중복 제거 ───

test('DOI가 같으면 하나만 남기고 동료 심사본을 우선한다', () => {
  const items = dedupeResearch([
    { title: 'A', doi: '10.1/X', peerReviewed: 'peer-reviewed', sourceName: 'Europe PMC', url: 'https://doi.org/10.1/X' },
    { title: 'A', doi: '10.1/x', peerReviewed: 'preprint', sourceName: 'arXiv', url: 'https://arxiv.org/abs/1' },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].sourceName, 'Europe PMC');
});

test('DOI가 없으면 제목으로 중복을 판정한다', () => {
  const items = dedupeResearch([
    { title: '같은  제목입니다.', doi: null, sourceName: 'Europe PMC', url: 'https://a' },
    { title: '같은 제목입니다', doi: null, sourceName: 'arXiv', url: 'https://b' },
  ]);
  assert.equal(items.length, 1);
});

// ─── provider ───

test('영어 질의는 두 소스를 모두 호출한다', async () => {
  const http = makeHttp({ 'ebi.ac.uk': PMC, 'export.arxiv.org': ARXIV });
  const result = await provider(http).search({ query: 'battery recycling', limit: 5 });

  assert.ok(http.calls.some((u) => u.includes('ebi.ac.uk')));
  assert.ok(http.calls.some((u) => u.includes('export.arxiv.org')));
  assert.deepEqual(result.sourcesUsed.sort(), ['Europe PMC', 'arXiv']);
  assert.equal(result.items.length, 5);
  assert.equal(result.languageRoute.route, 'en');
});

test('한 소스가 실패해도 나머지로 진행한다', async () => {
  const http = makeHttp({ 'ebi.ac.uk': new Error('down'), 'export.arxiv.org': ARXIV });
  const result = await provider(http).search({ query: 'battery recycling', limit: 5 });

  assert.ok(result.items.length > 0);
  assert.deepEqual(result.sourcesUsed, ['arXiv']);
  assert.ok(result.degraded.some((d) => d.source === 'Europe PMC'));
});

test('모든 소스가 실패하면 빈 배열과 사유가 남는다', async () => {
  const http = makeHttp({ 'ebi.ac.uk': new Error('down'), 'export.arxiv.org': new Error('down') });
  const result = await provider(http).search({ query: 'battery recycling', limit: 5 });

  assert.deepEqual(result.items, []);
  assert.equal(result.degraded.length, 2);
});

test('limit을 넘겨 돌려주지 않는다', async () => {
  const http = makeHttp({ 'ebi.ac.uk': PMC, 'export.arxiv.org': ARXIV });
  const result = await provider(http).search({ query: 'battery recycling', limit: 2 });
  assert.equal(result.items.length, 2);
});

test('한국어 질의에는 영어 소스로 요청을 보내지 않는다', async () => {
  // 스펙 §1.5. 호출한 뒤 거르는 것이 아니라 요청 자체를 만들지 않는다.
  const http = makeHttp({ 'ebi.ac.uk': PMC, 'export.arxiv.org': ARXIV });
  const result = await provider(http).search({ query: '배터리 재활용', limit: 5 });

  assert.equal(http.calls.length, 0, '영어 소스로 나간 요청이 있으면 안 된다');
  assert.deepEqual(result.items, []);
  assert.equal(result.languageRoute.route, 'ko');
});

test('한글이 섞인 질의도 영어 소스를 막는다', async () => {
  const http = makeHttp({ 'ebi.ac.uk': PMC, 'export.arxiv.org': ARXIV });
  await provider(http).search({ query: '삼성 battery', limit: 5 });
  assert.equal(http.calls.length, 0);
});

test('KCI provider가 없으면 한국어 질의에 사유를 남긴다', async () => {
  const http = makeHttp({});
  const result = await provider(http).search({ query: '배터리 재활용', limit: 5 });
  assert.ok(result.degraded.some((d) => d.source === 'KCI'));
});

test('같은 질의를 두 번 부르면 두 번째는 캐시에서 온다', async () => {
  const http = makeHttp({ 'ebi.ac.uk': PMC, 'export.arxiv.org': ARXIV });
  const p = provider(http);
  await p.search({ query: 'battery recycling', limit: 5 });
  const before = http.calls.length;
  await p.search({ query: 'battery recycling', limit: 5 });
  assert.equal(http.calls.length, before, '캐시 히트면 추가 호출이 없다');
});

// ─── provider 출력은 항상 스키마를 통과해야 한다 ───
//
// 실측에서 arXiv의 NVIDIA 협업 논문에 저자가 217명이었다. 그대로 실었더니
// 분석 스키마가 자기 provider의 출력을 400으로 거부했다.
// provider는 자기 검증기가 받아들이는 범위 안에서만 자료를 만든다.

const arxivWithAuthors = (count) => [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<feed xmlns="http://www.w3.org/2005/Atom"><entry>',
  '<id>http://arxiv.org/abs/1234.5678v1</id>',
  '<title>많은 저자 논문</title>',
  '<summary>초록</summary>',
  '<published>2026-01-02T00:00:00Z</published>',
  '<link href="https://arxiv.org/abs/1234.5678v1" rel="alternate" type="text/html"/>',
  Array.from({ length: count }, (_, i) => `<author><name>저자 ${i + 1}</name></author>`).join(''),
  '</entry></feed>',
].join('');

test('저자가 아주 많아도 상한까지만 싣고 총 인원을 남긴다', () => {
  const [item] = parseArxiv(arxivWithAuthors(217));
  assert.equal(item.authors.length, 10);
  assert.equal(item.authorCount, 217, '총 인원을 잃으면 몇 명 연구인지 알 수 없다');
});

test('아주 긴 제목과 초록을 스키마 상한까지 자른다', () => {
  const body = JSON.stringify({
    resultList: {
      result: [{
        id: 'X1',
        source: 'MED',
        pubYear: '2026',
        title: 'ㄱ'.repeat(900),
        abstractText: 'ㄴ'.repeat(9000),
        journalInfo: { journal: { title: 'ㄷ'.repeat(500) } },
      }],
    },
  });
  const [item] = parseEuropePmc(body);
  assert.equal(item.title.length, 500);
  assert.equal(item.abstract.length, 5000);
  assert.equal(item.venue.length, 300);
});

test('저자가 상한 이하면 authorCount가 실제 인원과 같다', () => {
  const items = parseEuropePmc(PMC);
  assert.equal(items[0].authorCount, items[0].authors.length);
});
