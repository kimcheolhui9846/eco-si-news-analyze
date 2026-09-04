import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createExperimentProvider, parseClinicalTrials,
  createTtlCache, createCircuitBreaker,
} from '../server.js';
import { makeClock } from './helpers.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const TRIALS = fixture('clinicaltrials-obesity.json');

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
      throw new Error(`라우트 없음: ${url}`);
    },
  };
};

const provider = (http) => {
  const clock = makeClock();
  return createExperimentProvider({
    http,
    cache: createTtlCache({ ttlMs: 3_600_000, maxEntries: 50, clock }),
    clock,
    makeBreaker: () => createCircuitBreaker({ threshold: 3, cooldownMs: 60_000, clock }),
  });
};

// ─── 파서 ───

test('단계·표본 수·기관·상태를 뽑는다', () => {
  const items = parseClinicalTrials(TRIALS);
  assert.equal(items.length, 2);

  const first = items[0];
  assert.equal(first.nctId, 'NCT00644098');
  assert.equal(first.organization, 'Canadian Center for Functional Medicine');
  assert.equal(first.phase, 'PHASE2');
  assert.equal(first.status, 'COMPLETED');
  assert.equal(first.enrollmentCount, 138);
  assert.equal(first.enrollmentType, 'ACTUAL');
  assert.deepEqual(first.conditions, ['People Who Are Overweight or Obesity']);
  assert.equal(first.startDate, '2008-09');
  assert.equal(first.hasResults, false);
  assert.equal(first.url, 'https://clinicaltrials.gov/study/NCT00644098');
});

test('목표치 표본 수를 ESTIMATED로 보존한다', () => {
  // ESTIMATED는 모집 목표일 뿐 실제 등록 수가 아니다. 구분하지 않으면
  // "138명을 대상으로 한 연구"라는 잘못된 서술이 나온다.
  const body = JSON.parse(TRIALS);
  body.studies[0].protocolSection.designModule.enrollmentInfo = { count: 300, type: 'ESTIMATED' };
  const [item] = parseClinicalTrials(JSON.stringify(body));

  assert.equal(item.enrollmentCount, 300);
  assert.equal(item.enrollmentType, 'ESTIMATED');
});

test('단계나 표본 수가 없는 연구도 처리한다', () => {
  const body = JSON.parse(TRIALS);
  delete body.studies[0].protocolSection.designModule;
  const [item] = parseClinicalTrials(JSON.stringify(body));

  assert.equal(item.phase, null);
  assert.equal(item.enrollmentCount, null);
  assert.equal(item.enrollmentType, null);
  assert.equal(item.nctId, 'NCT00644098');
});

test('NA 단계는 그대로 남긴다', () => {
  // 'NA'는 "단계 구분이 없는 연구"라는 사실이다. null로 지우면 정보가 준다.
  const items = parseClinicalTrials(TRIALS);
  assert.equal(items[1].phase, 'NA');
});

test('깨진 JSON에는 빈 배열을 돌려준다', () => {
  assert.deepEqual(parseClinicalTrials('{{{'), []);
  assert.deepEqual(parseClinicalTrials(''), []);
});

// ─── provider ───

test('영어 질의는 ClinicalTrials.gov를 호출한다', async () => {
  const http = makeHttp({ 'clinicaltrials.gov': TRIALS });
  const result = await provider(http).search({ query: 'obesity drug', limit: 5 });

  assert.equal(result.items.length, 2);
  assert.equal(result.degraded.length, 0);
  assert.ok(http.calls[0].includes('clinicaltrials.gov/api/v2/studies'));
});

test('한국어 질의에는 요청을 보내지 않는다', async () => {
  // ClinicalTrials.gov는 영어 전용이고 국내 대체 소스를 찾지 못했다.
  const http = makeHttp({ 'clinicaltrials.gov': TRIALS });
  const result = await provider(http).search({ query: '비만 치료제', limit: 5 });

  assert.equal(http.calls.length, 0);
  assert.deepEqual(result.items, []);
  assert.equal(result.languageRoute.route, 'ko');
  assert.ok(result.degraded.some((d) => /영어 검색어/.test(d.reason)));
});

test('실패하면 빈 배열과 사유를 남기고 예외를 던지지 않는다', async () => {
  const http = makeHttp({ 'clinicaltrials.gov': new Error('down') });
  const result = await provider(http).search({ query: 'obesity drug', limit: 5 });

  assert.deepEqual(result.items, []);
  assert.equal(result.degraded.length, 1);
});

test('limit을 넘겨 돌려주지 않는다', async () => {
  const http = makeHttp({ 'clinicaltrials.gov': TRIALS });
  const result = await provider(http).search({ query: 'obesity drug', limit: 1 });
  assert.equal(result.items.length, 1);
});
