import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupSector, SECTOR_BASKETS, SECTOR_KEYWORDS } from '../lib/providers/sectors.js';

test('분야 키워드로 묶음을 찾는다', () => {
  const hit = lookupSector('반도체 업황');
  assert.equal(hit.sector, '반도체');
  assert.deepEqual(hit.members.map((m) => m.symbol), ['NVDA', 'TSM', '005930.KS', '000660.KS']);
});

test('영문 키워드와 조사도 인식한다', () => {
  assert.equal(lookupSector('AI 전망')?.sector, 'AI');
  assert.equal(lookupSector('배터리의 미래')?.sector, '2차전지');
  assert.equal(lookupSector('EV 판매')?.sector, '자동차');
  assert.equal(lookupSector('crypto market')?.sector, '코인');
});

test('키워드가 다른 단어의 일부면 분야로 보지 않는다', () => {
  assert.equal(lookupSector('openai 투자'), null);
  assert.equal(lookupSector('반도체소재주'), null);
});

test('두 분야 키워드가 있으면 긴 키워드가 이긴다', () => {
  assert.equal(lookupSector('ai 반도체 전망')?.sector, '반도체');
});

test('모든 묶음은 4개 이하이고 형태가 올바르다', () => {
  for (const [name, basket] of Object.entries(SECTOR_BASKETS)) {
    assert.ok(basket.members.length >= 1 && basket.members.length <= 4, name);
    for (const m of basket.members) {
      assert.ok(m.symbol && m.name, name);
      assert.ok(['stock', 'crypto'].includes(m.assetType), name);
      assert.ok(['US', 'KR', 'CRYPTO'].includes(m.market), name);
    }
  }
});

test('SECTOR_KEYWORDS는 소문자 키워드 전체다', () => {
  assert.ok(SECTOR_KEYWORDS.includes('ai'));
  assert.ok(SECTOR_KEYWORDS.includes('반도체'));
  assert.ok(SECTOR_KEYWORDS.every((k) => k === k.toLowerCase()));
});
