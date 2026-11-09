import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, createMatcher } from '../lib/providers/match.js';
import { lookupAlias } from '../lib/providers/aliases.js';

test('tokenize는 소문자로 바꾸고 공백·문장부호로 나눈다', () => {
  assert.deepEqual(tokenize('엔비디아, AI 반도체! (실적)'), ['엔비디아', 'ai', '반도체', '실적']);
});

test('단어가 키와 같으면 일치한다', () => {
  assert.equal(createMatcher(['메타'])('메타 실적'), '메타');
});

test('키 뒤에 조사가 붙어도 일치한다', () => {
  const find = createMatcher(['삼성전자', '엔비디아']);
  assert.equal(find('삼성전자의 반도체'), '삼성전자');
  assert.equal(find('엔비디아가 발표한'), '엔비디아');
  assert.equal(find('반도체에서 삼성전자로'), '삼성전자');
});

test('키가 더 긴 단어의 일부일 뿐이면 일치하지 않는다', () => {
  const find = createMatcher(['메타', 'ai']);
  assert.equal(find('메타버스 시장'), null);
  assert.equal(find('openai 투자'), null);
});

test('여러 단어로 된 키는 연속된 단어열과 대조한다', () => {
  const find = createMatcher(['general motors']);
  assert.equal(find('General Motors 실적'), 'general motors');
  assert.equal(find('general 이야기 motors'), null);
});

test('긴 키를 먼저 본다', () => {
  assert.equal(createMatcher(['ai', '반도체'])('ai 반도체 전망'), '반도체');
});

test('lookupAlias: 메타버스는 META가 아니다 (회귀)', () => {
  assert.equal(lookupAlias('메타버스 시장'), null);
});

test('lookupAlias: 조사가 붙은 회사명도 찾는다', () => {
  assert.equal(lookupAlias('삼성전자의 반도체')?.symbol, '005930.KS');
  assert.equal(lookupAlias('엔비디아 AI 반도체')?.symbol, 'NVDA');
});
