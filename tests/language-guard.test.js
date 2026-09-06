import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasHangul, routeForQuery } from '../server.js';

test('한글이 있으면 참이다', () => {
  assert.equal(hasHangul('배터리 재활용'), true);
  assert.equal(hasHangul('비만 치료제'), true);
});

test('한글이 없으면 거짓이다', () => {
  assert.equal(hasHangul('battery recycling'), false);
  assert.equal(hasHangul('NVDA 2026 Q2'), false);
  assert.equal(hasHangul(''), false);
  assert.equal(hasHangul(undefined), false);
});

test('한글이 하나라도 섞이면 참이다', () => {
  // "삼성 battery"처럼 섞인 질의도 영어 소스에서는 오염된다.
  assert.equal(hasHangul('삼성 battery'), true);
});

test('한국어 질의는 영어 소스를 끄고 KCI만 켠다', () => {
  const route = routeForQuery('배터리 재활용');
  assert.equal(route.route, 'ko');
  assert.equal(route.useEnglishPapers, false);
  assert.equal(route.useTrials, false);
  assert.equal(route.useKci, true);
  assert.match(route.reason, /한국어/);
});

test('영어 질의는 영어 소스를 켜고 KCI를 끈다', () => {
  const route = routeForQuery('battery recycling');
  assert.equal(route.route, 'en');
  assert.equal(route.useEnglishPapers, true);
  assert.equal(route.useTrials, true);
  assert.equal(route.useKci, false);
});

test('사유 문구가 비어 있지 않다', () => {
  // 결과가 비었을 때 사용자가 이유를 알아야 한다.
  assert.ok(routeForQuery('배터리').reason.length > 0);
  assert.ok(routeForQuery('battery').reason.length > 0);
});
