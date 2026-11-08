import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createDartFinancialProvider, reportCandidates, parseDartAccounts,
} from '../lib/providers/dart-financial.js';
import { createTtlCache, createCircuitBreaker, buildAnalyzeSchema, loadConfig } from '../server.js';
import { makeClock, BASE_ENV } from './helpers.js';

const FIXTURE = readFileSync(new URL('./fixtures/dart-samsung-q3.json', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-20T00:00:00Z');
const KEY = 'secret-dart-key-123';

const makeHttp = (responder) => {
  const calls = [];
  return {
    calls,
    async get(url) {
      calls.push(url);
      const out = responder(url, calls.length);
      if (out instanceof Error) throw out;
      return { status: 200, text: typeof out === 'string' ? out : JSON.stringify(out), url };
    },
  };
};

const provider = (http, over = {}) => {
  const clock = makeClock(NOW);
  return createDartFinancialProvider({
    http,
    cache: createTtlCache({ ttlMs: 21_600_000, maxEntries: 50, clock }),
    clock,
    makeBreaker: () => createCircuitBreaker({ threshold: 3, cooldownMs: 60_000, clock }),
    apiKey: over.apiKey ?? KEY,
    log: over.log,
  });
};

test('reportCandidates: 기간이 끝난 보고서를 최신순으로 최대 4개', () => {
  assert.deepEqual(
    reportCandidates(Date.parse('2026-11-08T00:00:00Z')).map((c) => `${c.year}:${c.code}`),
    ['2026:11014', '2026:11012', '2026:11013', '2025:11011'],
  );
  assert.deepEqual(
    reportCandidates(Date.parse('2027-01-10T00:00:00Z')).map((c) => `${c.year}:${c.code}`),
    ['2026:11011', '2026:11014', '2026:11012', '2026:11013'],
  );
});

test('parseDartAccounts: 연결재무제표를 우선하고 SEC와 같은 형태로 만든다', () => {
  const [q3] = reportCandidates(NOW);
  const parsed = parseDartAccounts(JSON.parse(FIXTURE), { report: q3, year: 2026 });
  assert.equal(parsed.rceptNo, '20261114000123');
  assert.deepEqual(parsed.metrics.map((m) => m.label), ['매출', '영업이익', '순이익', '자산', '부채']);
  const revenue = parsed.metrics[0];
  assert.equal(revenue.value, 80_000_000_000_000);
  assert.equal(revenue.unit, 'KRW');
  assert.equal(revenue.concept, '매출액 (연결)');
  assert.equal(revenue.periodStart, '2026-07-01');
  assert.equal(revenue.periodEnd, '2026-09-30');
  assert.equal(revenue.fiscalYear, 2026);
  assert.equal(revenue.fiscalPeriod, 'Q3');
  assert.equal(revenue.form, '3분기보고서');
  assert.equal(revenue.filed, '2026-11-14');
  assert.equal(parsed.metrics[3].periodStart, null);
  assert.equal(parsed.metrics[3].periodEnd, '2026-09-30');
});

test('parseDartAccounts: 부채비율과 전년 동기 대비 매출 성장률을 계산한다', () => {
  const [q3] = reportCandidates(NOW);
  const { derived } = parseDartAccounts(JSON.parse(FIXTURE), { report: q3, year: 2026 });
  assert.deepEqual(derived.map((d) => [d.label, d.value]), [
    ['부채비율', 20],
    ['매출 성장률(전년 동기 대비)', 11.11],
  ]);
});

test('parseDartAccounts: 연결이 없으면 개별을 쓴다', () => {
  const body = JSON.parse(FIXTURE);
  body.list = body.list.filter((r) => r.fs_div === 'OFS');
  const parsed = parseDartAccounts(body, { report: reportCandidates(NOW)[0], year: 2026 });
  assert.equal(parsed.metrics[0].concept, '매출액 (개별)');
  assert.equal(parsed.metrics[0].value, 60_000_000_000_000);
  assert.equal(parsed.degraded.length, 4);
});

test('fetch: 정상 응답이면 재무와 공시 링크를 돌려주고 캐시한다', async () => {
  const http = makeHttp(() => FIXTURE);
  const p = provider(http);
  const first = await p.fetch({ corpCode: '00126380', symbol: '005930.KS', name: '삼성전자' });
  assert.equal(first.reason, null);
  assert.equal(first.financial.source, 'dart');
  assert.equal(first.financial.cik, null);
  assert.equal(first.financial.corpCode, '00126380');
  assert.equal(first.financial.entityName, '삼성전자');
  assert.equal(first.financial.filingUrl, 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261114000123');
  await p.fetch({ corpCode: '00126380', symbol: '005930.KS', name: '삼성전자' });
  assert.equal(http.calls.length, 1);
  assert.ok(http.calls[0].startsWith('https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?'));
  assert.ok(http.calls[0].includes('reprt_code=11014'));
});

test('fetch: 결과가 분석 스키마를 통과한다', { skip: 'Task 7에서 분석 스키마에 instruments가 생기면 활성화' }, async () => {
  const { financial } = await provider(makeHttp(() => FIXTURE)).fetch({ corpCode: '00126380', symbol: '005930.KS', name: '삼성전자' });
  const schema = buildAnalyzeSchema(loadConfig(BASE_ENV));
  const parsed = schema.safeParse({
    newsList: [{ title: 't', content: 'c', source: 's', url: 'https://a.example/1', publishedAt: '2026-11-01T00:00:00Z' }],
    instruments: [{ symbol: '005930.KS', name: '삼성전자', assetType: 'stock', market: 'KR', financial }],
  });
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
});

test('fetch: 013(데이터 없음)이면 다음 보고서로 넘어간다', async () => {
  const http = makeHttp((url) => (url.includes('reprt_code=11014') ? { status: '013', message: '조회된 데이타가 없습니다.' } : FIXTURE));
  const r = await provider(http).fetch({ corpCode: '00126380', symbol: '005930.KS', name: '삼성전자' });
  assert.ok(r.financial);
  assert.equal(http.calls.length, 2);
  assert.ok(http.calls[1].includes('reprt_code=11012'));
});

test('fetch: 모든 후보가 013이면 사유와 함께 null', async () => {
  const http = makeHttp(() => ({ status: '013', message: '없음' }));
  const r = await provider(http).fetch({ corpCode: '00126380' });
  assert.equal(r.financial, null);
  assert.match(r.reason, /최근 보고서/);
  assert.equal(http.calls.length, 4);
});

test('fetch: 키 오류·한도 초과는 사유로 바꾼다', async () => {
  for (const [status, pattern] of [['010', /키/], ['011', /키/], ['020', /한도/], ['800', /오류\(800\)/]]) {
    const r = await provider(makeHttp(() => ({ status, message: 'x' }))).fetch({ corpCode: '00126380' });
    assert.equal(r.financial, null);
    assert.match(r.reason, pattern, status);
  }
});

test('fetch: 키가 없으면 호출하지 않고 사유를 준다', async () => {
  const http = makeHttp(() => FIXTURE);
  const p = provider(http, { apiKey: '' });
  assert.equal(p.configured, false);
  const r = await p.fetch({ corpCode: '00126380' });
  assert.equal(r.financial, null);
  assert.match(r.reason, /OPENDART_API_KEY/);
  assert.equal(http.calls.length, 0);
});

test('fetch: 네트워크 오류 로그에 키가 남지 않는다', async () => {
  const logs = [];
  const http = makeHttp((url) => new Error(`요청 실패: ${url}`));
  const r = await provider(http, { log: { warn: (obj, msg) => logs.push(JSON.stringify(obj) + msg) } })
    .fetch({ corpCode: '00126380' });
  assert.equal(r.financial, null);
  assert.ok(logs.length > 0);
  assert.ok(logs.every((l) => !l.includes(KEY)));
});
