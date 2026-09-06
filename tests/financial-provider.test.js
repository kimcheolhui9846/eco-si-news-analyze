import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createFinancialProvider, pickLatestFact, findYearAgoFact,
  createTtlCache, createCircuitBreaker, lookupAlias, cikForSymbol,
} from '../server.js';
import { makeClock } from './helpers.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const REVENUES = fixture('sec-concept-revenues.json');
const FACTS = JSON.parse(REVENUES).units.USD;

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
      // 없는 개념에는 SEC가 404를 준다. http 클라이언트가 이를 예외로 만든다.
      throw new Error(`라우트 없음: ${url}`);
    },
  };
};

const provider = (http) => {
  const clock = makeClock();
  return createFinancialProvider({
    http,
    cache: createTtlCache({ ttlMs: 86_400_000, maxEntries: 50, clock }),
    clock,
    // 개념이 없는 것은 흔한 일이다. 차단기가 열려 다른 개념까지 막으면 안 되므로
    // 테스트에서는 임계값을 높게 둔다.
    makeBreaker: () => createCircuitBreaker({ threshold: 99, cooldownMs: 60_000, clock }),
  });
};

// ─── 값 선택 규칙 ───

test('같은 종료일이면 기간이 짧은 쪽(분기)을 고른다', () => {
  // 누적 6개월(177,837)과 해당 분기 3개월(96,221)이 같은 end를 갖는다.
  // 누적치를 분기 매출로 소개하면 숫자가 두 배로 부풀려진다.
  const chosen = pickLatestFact(FACTS);
  assert.equal(chosen.val, 96_221_000_000);
  assert.equal(chosen.fy, 2027);
  assert.equal(chosen.fp, 'Q2');
  assert.equal(chosen.form, '10-Q');
});

test('전년 동기는 회계연도가 아니라 달력 기준으로 찾는다', () => {
  // fy:2027 fp:Q2 인데 end가 2025-07-27인 전년 비교치가 섞여 있다.
  const chosen = pickLatestFact(FACTS);
  const prior = findYearAgoFact(FACTS, chosen);
  assert.equal(prior.val, 46_743_000_000);
  assert.equal(prior.end, '2025-07-27');
});

test('빈 입력에서는 null을 돌려준다', () => {
  assert.equal(pickLatestFact([]), null);
  assert.equal(pickLatestFact(undefined), null);
  assert.equal(findYearAgoFact([], null), null);
});

// ─── provider ───

test('CIK가 없으면 호출하지 않고 null을 돌려준다', async () => {
  const http = makeHttp({});
  const result = await provider(http).fetch({ cik: null, symbol: '005930.KS' });
  assert.equal(result, null);
  assert.equal(http.calls.length, 0, '한국 종목에 SEC를 부르면 안 된다');
});

test('SEC 응답에서 최근 값 하나와 기준 기간을 싣는다', async () => {
  const http = makeHttp({ '/Revenues.json': REVENUES });
  const result = await provider(http).fetch({ cik: '0001045810', symbol: 'NVDA' });

  const revenue = result.metrics.find((m) => m.concept === 'Revenues');
  assert.equal(revenue.value, 96_221_000_000);
  assert.equal(revenue.unit, 'USD');
  assert.equal(revenue.fiscalYear, 2027);
  assert.equal(revenue.fiscalPeriod, 'Q2');
  assert.equal(revenue.form, '10-Q');
  assert.equal(revenue.filed, '2026-08-26');
  assert.equal(revenue.periodEnd, '2026-07-26');
  assert.equal(result.entityName, 'NVIDIA CORP');
});

test('없는 개념은 degraded에 남고 그 지표만 빠진다', async () => {
  const http = makeHttp({ '/Revenues.json': REVENUES });
  const result = await provider(http).fetch({ cik: '0001045810', symbol: 'NVDA' });

  assert.equal(result.metrics.length, 1, '픽스처에 있는 개념은 매출뿐이다');
  assert.ok(result.degraded.some((d) => d.concept === 'NetIncomeLoss'));
});

test('성장률을 코드가 계산한다', async () => {
  const http = makeHttp({ '/Revenues.json': REVENUES });
  const result = await provider(http).fetch({ cik: '0001045810', symbol: 'NVDA' });

  const growth = result.derived.find((d) => d.label === '매출 성장률(전년 동기 대비)');
  // (96,221 - 46,743) / 46,743 = 105.85%
  assert.equal(growth.value, 105.85);
  assert.equal(growth.unit, '%');
});

test('부채비율은 자산과 부채가 모두 있을 때만 계산한다', async () => {
  const concept = (tag, val) => JSON.stringify({
    cik: 1045810,
    tag,
    entityName: 'NVIDIA CORP',
    units: {
      USD: [{
        end: '2026-07-26', val, fy: 2027, fp: 'Q2',
        form: '10-Q', filed: '2026-08-26', accn: '0001045810-26-000075',
      }],
    },
  });
  const http = makeHttp({
    '/Assets.json': concept('Assets', 200_000_000_000),
    '/Liabilities.json': concept('Liabilities', 82_400_000_000),
  });
  const result = await provider(http).fetch({ cik: '0001045810', symbol: 'NVDA' });

  const ratio = result.derived.find((d) => d.label === '부채비율');
  assert.equal(ratio.value, 41.2);
  assert.equal(ratio.unit, '%');
});

test('자산만 있으면 부채비율을 만들지 않는다', async () => {
  const assets = JSON.stringify({
    cik: 1045810,
    tag: 'Assets',
    entityName: 'NVIDIA CORP',
    units: {
      USD: [{
        end: '2026-07-26', val: 200_000_000_000, fy: 2027, fp: 'Q2',
        form: '10-Q', filed: '2026-08-26', accn: '0001045810-26-000075',
      }],
    },
  });
  const http = makeHttp({ '/Assets.json': assets });
  const result = await provider(http).fetch({ cik: '0001045810', symbol: 'NVDA' });
  assert.equal(result.derived.find((d) => d.label === '부채비율'), undefined);
});

test('EDGAR 제출 서류 링크를 만든다', async () => {
  const http = makeHttp({ '/Revenues.json': REVENUES });
  const result = await provider(http).fetch({ cik: '0001045810', symbol: 'NVDA' });
  assert.equal(
    result.filingUrl,
    'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000075/0001045810-26-000075-index.htm',
  );
});

test('응답이 깨져도 예외를 던지지 않는다', async () => {
  const http = makeHttp({ 'data.sec.gov': '{{{ not json' });
  const result = await provider(http).fetch({ cik: '0001045810', symbol: 'NVDA' });
  assert.equal(result, null, '모든 개념이 실패하면 null이다');
});

test('회사 티커 목록 파일을 fetch하지 않는다', async () => {
  // www.sec.gov/files/company_tickers.json은 연락처가 든 UA를 요구한다.
  // 그 경로를 쓰면 사용자 이메일이 외부로 나간다.
  const http = makeHttp({ '/Revenues.json': REVENUES });
  await provider(http).fetch({ cik: '0001045810', symbol: 'NVDA' });
  assert.ok(http.calls.every((u) => !u.includes('company_tickers')));
  assert.ok(http.calls.every((u) => u.startsWith('https://data.sec.gov/')));
});

// ─── CIK 별칭 ───

test('미국 종목 별칭에 CIK가 있다', () => {
  assert.equal(lookupAlias('엔비디아').cik, '0001045810');
  assert.equal(lookupAlias('애플').cik, '0000320193');
});

test('한국 종목 별칭에는 CIK가 없다', () => {
  // SEC EDGAR는 미국 상장사만 다룬다. 없는 것을 있는 척하지 않는다.
  assert.equal(lookupAlias('삼성전자').cik, undefined);
});

test('티커로도 CIK를 찾는다', () => {
  // 사용자가 symbol을 직접 넣으면 별칭 조회를 거치지 않는다.
  // 그때도 재무를 가져오려면 티커 → CIK 경로가 있어야 한다.
  assert.equal(cikForSymbol('NVDA'), '0001045810');
  assert.equal(cikForSymbol('nvda'), '0001045810');
  assert.equal(cikForSymbol('005930.KS'), null);
  assert.equal(cikForSymbol(null), null);
});
