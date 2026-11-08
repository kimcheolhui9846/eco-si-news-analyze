import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDirectory } from '../lib/providers/directory.js';
import { createResolver } from '../lib/resolve.js';

// 실제 스냅샷(data/us-tickers.json)으로 본다. 픽스처로는 "News Corp"·"Target" 같은
// 흔한 단어 회사명이 분야·미해결 질의를 가로채는 문제가 드러나지 않았다.
const resolve = createResolver({ directory: loadDirectory({ log: { warn() {} } }) });

const NOT_COMPANY = [
  'semiconductor news', '반도체 news', 'AI news', '2차전지 target', 'quantum computing',
  'lithium 가격', 'IT 업계 전망', 'EU 규제', '메타버스 시장', '오늘의 경제 뉴스',
];

for (const query of NOT_COMPANY) {
  test(`실제 스냅샷: '${query}'는 회사로 해석하지 않는다`, () => {
    assert.notEqual(resolve({ query }).kind, 'company');
  });
}

test("실제 스냅샷: '반도체 news'는 반도체 분야 묶음이다", () => {
  const r = resolve({ query: '반도체 news' });
  assert.equal(r.kind, 'sector');
  assert.equal(r.sector, '반도체');
});

test('실제 스냅샷: 티커와 대문자 회사명은 회사로 해석한다', () => {
  assert.equal(resolve({ query: 'NVDA 실적' }).kind, 'company');
  assert.equal(resolve({ query: 'Palantir 계약' }).kind, 'company');
});
