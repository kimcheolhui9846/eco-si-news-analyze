import 'global-jsdom/register';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup } from '@testing-library/react';
import InstrumentComparison, { compactNumber } from '../../client/src/components/InstrumentComparison.jsx';
import { createApiClient } from '../../client/src/api/client.js';

afterEach(cleanup);

const md = (price, change) => ({ assetName: 'x', currentPrice: price, priceChange: change, chartTrend: 't' });
const fin = (unit) => ({
  source: unit === 'KRW' ? 'dart' : 'sec', symbol: 'x', cik: null, corpCode: null, entityName: 'x', filingUrl: null,
  metrics: [
    { concept: 'a', label: '매출', value: 80_000_000_000_000, unit, periodStart: null, periodEnd: null, fiscalYear: 2026, fiscalPeriod: 'Q3', form: null, filed: null },
    { concept: 'b', label: '영업이익', value: 10_000_000_000_000, unit, periodStart: null, periodEnd: null, fiscalYear: 2026, fiscalPeriod: 'Q3', form: null, filed: null },
  ],
  derived: [], degraded: [],
});

const INSTRUMENTS = [
  { symbol: 'NVDA', name: 'NVIDIA', assetType: 'stock', market: 'US', marketData: md('182.5 USD', '2.30%'), financial: fin('USD') },
  { symbol: '005930.KS', name: '삼성전자', assetType: 'stock', market: 'KR', marketData: md('70,000 KRW', '-1.00%'), financial: fin('KRW') },
  { symbol: 'TSM', name: 'TSMC', assetType: 'stock', market: 'US' },
  { symbol: 'bitcoin', name: '비트코인', assetType: 'crypto', market: 'CRYPTO', marketData: md('90,000 USD', '0.50%') },
];

test('compactNumber는 조·억 단위로 줄인다', () => {
  assert.equal(compactNumber(80_000_000_000_000), '80.0조');
  assert.equal(compactNumber(130_000_000_000), '1,300억');
  assert.equal(compactNumber(1234), '1,234');
});

test('분야 안내와 종목별 행을 그린다', () => {
  render(<InstrumentComparison instruments={INSTRUMENTS} resolution={{ kind: 'sector', sector: '반도체', symbols: [] }}
    degraded={[{ provider: 'financial', symbol: 'TSM', reason: 'SEC 디렉터리에 없는 종목입니다.' }]} />);
  assert.ok(screen.getByText('반도체 분야 대표 종목 4개'));
  assert.ok(screen.getByText('NVIDIA'));
  assert.ok(screen.getByText('80.0조 KRW'));
  assert.ok(screen.getByText('SEC 디렉터리에 없는 종목입니다.'));
  assert.ok(screen.getByText('재무 해당 없음'));
});

test('통화를 섞어 환산하지 않는다', () => {
  render(<InstrumentComparison instruments={INSTRUMENTS} resolution={{ kind: 'sector', sector: '반도체', symbols: [] }} degraded={[]} />);
  assert.ok(screen.getByText('80.0조 USD'));
  assert.ok(screen.getByText('80.0조 KRW'));
});

test('api.analyze는 series와 자료 없는 종목을 빼고 sector를 싣는다', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({}), headers: { get: () => null } }; };
  await createApiClient({ fetchImpl }).analyze({
    newsList: [{ title: 'a' }],
    instruments: [
      { symbol: 'A', name: 'A', assetType: 'stock', market: 'US', marketData: md('1', '1%'), series: { points: [] } },
      { symbol: 'B', name: 'B', assetType: 'stock', market: 'US' },
    ],
    sector: '반도체',
    confirmToken: 'ct',
  });
  const body = JSON.parse(calls[0].opts.body);
  assert.deepEqual(body.instruments, [{ symbol: 'A', name: 'A', assetType: 'stock', market: 'US', marketData: md('1', '1%') }]);
  assert.equal(body.sector, '반도체');
});

test('api.analyze는 종목이 없으면 instruments 필드를 뺀다', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({}), headers: { get: () => null } }; };
  await createApiClient({ fetchImpl }).analyze({ newsList: [{ title: 'a' }], instruments: [], confirmToken: 'ct' });
  const body = JSON.parse(calls[0].opts.body);
  assert.equal('instruments' in body, false);
  assert.equal('sector' in body, false);
});
