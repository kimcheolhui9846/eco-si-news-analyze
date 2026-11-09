import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectInstruments, toAnalysisInstruments, relevanceName, UNRESOLVED_REASON,
} from '../lib/instruments.js';

const marketResult = (symbol) => ({
  marketData: { assetName: symbol, currentPrice: '100 USD', priceChange: '1.00%', chartTrend: '상승' },
  series: { symbol, currency: 'USD', points: [{ t: '2026-11-01T00:00:00.000Z', c: 100, v: 1 }] },
  indicators: { changePct: 1 },
});
const secFinancial = (symbol) => ({ source: 'sec', symbol, cik: '1', corpCode: null, entityName: symbol, filingUrl: null, metrics: [{ label: '매출' }], derived: [], degraded: [] });

const deps = (over = {}) => ({
  market: { fetch: async ({ symbol }) => (symbol === 'FAIL' ? null : marketResult(symbol)) },
  sec: { fetch: async ({ symbol }) => secFinancial(symbol) },
  dart: { configured: true, fetch: async ({ symbol }) => ({ financial: { ...secFinancial(symbol), source: 'dart' }, reason: null }) },
  ...over,
});

const NVDA = { symbol: 'NVDA', name: 'NVIDIA', assetType: 'stock', market: 'US', cik: '0001045810' };
const SAMSUNG = { symbol: '005930.KS', name: '삼성전자', assetType: 'stock', market: 'KR', corpCode: '00126380' };
const BTC = { symbol: 'bitcoin', name: '비트코인', assetType: 'crypto', market: 'CRYPTO' };

test('종목마다 시세와 재무를 모으고 내부 식별자는 싣지 않는다', async () => {
  const { instruments, degraded } = await collectInstruments({
    instruments: [NVDA, SAMSUNG], wantMarket: true, wantFinancial: true, range: '1mo', ...deps(),
  });
  assert.deepEqual(degraded, []);
  assert.equal(instruments[0].financial.source, 'sec');
  assert.equal(instruments[1].financial.source, 'dart');
  assert.equal(instruments[0].series.indicators.changePct, 1);
  assert.equal('cik' in instruments[0], false);
  assert.equal('corpCode' in instruments[1], false);
});

test('선택하지 않은 범위는 부르지 않는다', async () => {
  let secCalls = 0;
  const { instruments } = await collectInstruments({
    instruments: [NVDA], wantMarket: true, wantFinancial: false, range: '1mo',
    ...deps({ sec: { fetch: async () => { secCalls += 1; return null; } } }),
  });
  assert.equal(secCalls, 0);
  assert.equal(instruments[0].financial, undefined);
});

test('종목 하나가 실패해도 나머지는 진행하고 사유에 종목을 단다', async () => {
  const { instruments, degraded } = await collectInstruments({
    instruments: [{ ...NVDA, symbol: 'FAIL' }, NVDA], wantMarket: true, wantFinancial: false, range: '1mo', ...deps(),
  });
  assert.equal(instruments[0].marketData, undefined);
  assert.ok(instruments[1].marketData);
  assert.deepEqual(degraded, [{ provider: 'market', symbol: 'FAIL', reason: '시장 데이터를 가져오지 못했습니다.' }]);
});

test('코인은 재무 대상이 아니므로 degraded가 아니다', async () => {
  const { degraded } = await collectInstruments({
    instruments: [BTC], wantMarket: false, wantFinancial: true, range: '1mo', ...deps(),
  });
  assert.deepEqual(degraded, []);
});

test('DART 키가 없으면 한국 종목에 키 사유를 단다', async () => {
  const { degraded } = await collectInstruments({
    instruments: [{ ...SAMSUNG, corpCode: undefined }], wantMarket: false, wantFinancial: true, range: '1mo',
    ...deps({ dart: { configured: false, fetch: async () => assert.fail('부르면 안 된다') } }),
  });
  assert.equal(degraded.length, 1);
  assert.match(degraded[0].reason, /OPENDART_API_KEY/);
});

test('디렉터리에 없는 종목은 출처별 사유를 단다', async () => {
  const { degraded } = await collectInstruments({
    instruments: [{ ...NVDA, cik: undefined }, { ...SAMSUNG, corpCode: undefined }],
    wantMarket: false, wantFinancial: true, range: '1mo', ...deps(),
  });
  assert.match(degraded[0].reason, /SEC/);
  assert.match(degraded[1].reason, /스냅샷/);
});

test('SEC가 null이면 사유를 단다', async () => {
  const { degraded } = await collectInstruments({
    instruments: [NVDA], wantMarket: false, wantFinancial: true, range: '1mo',
    ...deps({ sec: { fetch: async () => null } }),
  });
  assert.deepEqual(degraded, [{ provider: 'financial', symbol: 'NVDA', reason: 'SEC 제출 서류에서 재무지표를 찾지 못했습니다.' }]);
});

test('toAnalysisInstruments: series를 빼고 자료 없는 종목을 뺀다', () => {
  const out = toAnalysisInstruments([
    { symbol: 'A', name: 'A', assetType: 'stock', market: 'US', marketData: { assetName: 'A' }, series: { points: [] } },
    { symbol: 'B', name: 'B', assetType: 'stock', market: 'US' },
  ]);
  assert.deepEqual(out, [{ symbol: 'A', name: 'A', assetType: 'stock', market: 'US', marketData: { assetName: 'A' } }]);
});

test('relevanceName: 종목이 하나일 때만 자산명을 준다', () => {
  assert.equal(relevanceName([{ marketData: { assetName: 'NVDA' } }]), 'NVDA');
  assert.equal(relevanceName([{ marketData: { assetName: 'A' } }, { marketData: { assetName: 'B' } }]), undefined);
  assert.equal(relevanceName([]), undefined);
});

test('UNRESOLVED_REASON은 입력 예시를 담는다', () => {
  assert.match(UNRESOLVED_REASON, /반도체/);
});

test('한 종목에서 예외가 나도 다른 종목은 진행하고 그 종목은 빈 결과와 사유를 남긴다', async () => {
  const { instruments, degraded } = await collectInstruments({
    instruments: [{ ...NVDA, symbol: 'BOOM' }, SAMSUNG], wantMarket: true, wantFinancial: true, range: '1mo',
    ...deps({
      market: {
        fetch: async ({ symbol }) => {
          if (symbol === 'BOOM') throw new Error('https://example.test/?apikey=secret');
          return marketResult(symbol);
        },
      },
    }),
  });
  assert.deepEqual(instruments[0], { symbol: 'BOOM', name: 'NVIDIA', assetType: 'stock', market: 'US' });
  assert.ok(instruments[1].marketData);
  assert.equal(instruments[1].financial.source, 'dart');
  assert.deepEqual(degraded, [
    { provider: 'market', symbol: 'BOOM', reason: '시장 데이터를 가져오지 못했습니다.' },
    { provider: 'financial', symbol: 'BOOM', reason: '재무 자료를 처리하지 못했습니다.' },
  ]);
  assert.ok(!JSON.stringify(degraded).includes('secret'));
});
