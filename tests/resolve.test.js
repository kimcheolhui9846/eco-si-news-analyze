import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDirectory } from '../lib/providers/directory.js';
import { createResolver, MAX_INSTRUMENTS } from '../lib/resolve.js';

const rows = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')).rows;
const resolve = createResolver({
  directory: createDirectory({ us: rows('directory-us.json'), kr: rows('directory-kr.json') }),
});

test('직접 넣은 티커가 가장 우선이고 디렉터리로 보강된다', () => {
  const r = resolve({ query: '반도체', symbol: 'NVDA' });
  assert.equal(r.kind, 'explicit');
  assert.deepEqual(r.instruments, [{
    symbol: 'NVDA', name: 'NVIDIA CORP', assetType: 'stock', market: 'US', cik: '0001045810',
  }]);
});

test('회사명이 분야보다 우선한다', () => {
  const r = resolve({ query: '삼성전자 반도체' });
  assert.equal(r.kind, 'company');
  assert.equal(r.instruments.length, 1);
  assert.equal(r.instruments[0].symbol, '005930.KS');
  assert.equal(r.instruments[0].market, 'KR');
  assert.equal(r.instruments[0].corpCode, '00126380');
});

test('별칭에 없는 회사도 디렉터리로 찾는다', () => {
  const r = resolve({ query: '한화에어로스페이스 수주' });
  assert.equal(r.kind, 'company');
  assert.equal(r.instruments[0].symbol, '012450');
  assert.equal(r.instruments[0].corpCode, '00126566');
});

test('분야만 있으면 묶음이고 각 종목이 보강된다', () => {
  const r = resolve({ query: '반도체 업황' });
  assert.equal(r.kind, 'sector');
  assert.equal(r.sector, '반도체');
  assert.deepEqual(r.instruments.map((i) => i.symbol), ['NVDA', 'TSM', '005930.KS', '000660.KS']);
  assert.equal(r.instruments[0].cik, '0001045810');
  assert.equal(r.instruments[2].corpCode, '00126380');
  assert.ok(r.instruments.length <= MAX_INSTRUMENTS);
});

test('"AI"는 C3.ai 티커가 아니라 AI 분야다', () => {
  const r = resolve({ query: 'AI' });
  assert.equal(r.kind, 'sector');
  assert.equal(r.sector, 'AI');
});

test('메타버스는 META가 아니다', () => {
  assert.equal(resolve({ query: '메타버스 시장' }).kind, 'unresolved');
});

test('코인 묶음은 market이 CRYPTO이고 디렉터리 보강이 없다', () => {
  const r = resolve({ query: '암호화폐 시장' });
  assert.equal(r.kind, 'sector');
  assert.ok(r.instruments.every((i) => i.market === 'CRYPTO' && !i.cik && !i.corpCode));
});

test('아무것도 없으면 unresolved와 빈 배열', () => {
  assert.deepEqual(resolve({ query: '오늘의 경제' }), { kind: 'unresolved', instruments: [] });
});
