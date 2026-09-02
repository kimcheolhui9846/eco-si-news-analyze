import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripFabricatedUrls, parseAnalysis, buildSources, normalizeNewsList } from '../server.js';

const whitelist = new Set(['https://real.com/a', 'https://real.com/b']);

test('화이트리스트에 있는 URL은 그대로 둔다', () => {
  const { value, removed } = stripFabricatedUrls('출처는 https://real.com/a 입니다', whitelist);
  assert.equal(value, '출처는 https://real.com/a 입니다');
  assert.equal(removed, 0);
});

test('화이트리스트에 없는 URL을 치환한다', () => {
  const { value, removed } = stripFabricatedUrls('출처는 https://fake.com/made-up 입니다', whitelist);

  assert.equal(value.includes('fake.com'), false, '지어낸 URL이 남았다');
  assert.ok(value.includes('[출처 미확인]'));
  assert.equal(removed, 1);
});

test('중첩된 객체와 배열을 재귀적으로 훑는다', () => {
  const report = {
    summary: 'https://fake.com/1 참고',
    newsBriefing: [
      { title: '진짜', keyPoints: 'https://real.com/a 참고' },
      { title: '가짜', keyPoints: 'https://fake.com/2 참고' },
    ],
    risks: ['https://fake.com/3 위험'],
    nested: { deep: { deeper: 'https://fake.com/4' } },
  };

  const { value, removed } = stripFabricatedUrls(report, whitelist);

  assert.equal(removed, 4);
  assert.equal(JSON.stringify(value).includes('fake.com'), false);
  assert.ok(value.newsBriefing[0].keyPoints.includes('https://real.com/a'), '진짜 URL이 지워졌다');
});

test('한 문자열 안의 여러 URL을 각각 판정한다', () => {
  const { value, removed } = stripFabricatedUrls(
    'https://real.com/a 와 https://fake.com/x 와 https://real.com/b',
    whitelist,
  );

  assert.equal(removed, 1);
  assert.ok(value.includes('https://real.com/a'));
  assert.ok(value.includes('https://real.com/b'));
  assert.equal(value.includes('fake.com'), false);
});

test('URL 뒤의 문장부호를 URL로 오인하지 않는다', () => {
  const { value, removed } = stripFabricatedUrls('출처(https://real.com/a)를 보라.', whitelist);

  assert.equal(removed, 0, '괄호가 URL에 붙어 화이트리스트 대조에 실패했다');
  assert.ok(value.includes('https://real.com/a'));
});

test('마침표로 끝나는 URL도 올바르게 대조한다', () => {
  const { removed } = stripFabricatedUrls('출처는 https://real.com/a. 끝.', whitelist);
  assert.equal(removed, 0);
});

test('URL이 없으면 아무것도 바꾸지 않는다', () => {
  const { value, removed } = stripFabricatedUrls({ summary: 'URL 없는 요약' }, whitelist);

  assert.equal(removed, 0);
  assert.equal(value.summary, 'URL 없는 요약');
});

test('숫자와 불리언과 null은 그대로 통과시킨다', () => {
  const { value } = stripFabricatedUrls({ count: 3, ok: true, missing: null }, whitelist);
  assert.deepEqual(value, { count: 3, ok: true, missing: null });
});

// ─── JSON 파싱 ───

test('유효한 JSON을 파싱한다', () => {
  assert.deepEqual(parseAnalysis('{"summary":"요약"}'), { summary: '요약' });
});

test('깨진 JSON은 null을 반환한다', () => {
  assert.equal(parseAnalysis('{"summary": '), null);
  assert.equal(parseAnalysis(''), null);
  assert.equal(parseAnalysis(undefined), null);
});

test('코드펜스로 감싸인 JSON도 파싱한다', () => {
  const fenced = '```json\n{"summary":"요약"}\n```';
  assert.deepEqual(parseAnalysis(fenced), { summary: '요약' });
});

test('JSON이 아닌 최상위 값은 null로 취급한다', () => {
  assert.equal(parseAnalysis('"문자열"'), null);
  assert.equal(parseAnalysis('42'), null);
  assert.equal(parseAnalysis('[1,2,3]'), null);
  assert.equal(parseAnalysis('null'), null);
});

// ─── 출처 목록 ───

test('출처 목록은 입력 자료에서 서버가 만든다', () => {
  const { items } = normalizeNewsList([{
    title: '엔비디아 실적', content: '내용', source: '연합뉴스',
    url: 'https://real.com/a', publishedAt: '2026-08-30T09:00:00Z',
  }], {});

  const sources = buildSources(items, '2026-09-02T00:00:00.000Z');

  assert.equal(sources.length, 1);
  assert.deepEqual(sources[0], {
    sourceId: 'S1',
    title: '엔비디아 실적',
    source: '연합뉴스',
    url: 'https://real.com/a',
    publishedAt: '2026-08-30T09:00:00.000Z',
    collectedAt: '2026-09-02T00:00:00.000Z',
    type: 'news',
    relevance: 0,
  });
});
