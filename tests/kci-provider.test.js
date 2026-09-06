import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createKciProvider, buildKciUrl, parseKciResponse, isIpRejection, redactKey,
  createTtlCache, createCircuitBreaker,
} from '../server.js';
import { makeClock } from './helpers.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const ERROR_XML = fixture('kci-error-nokey.xml');

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

const provider = (http, apiKey) => {
  const clock = makeClock();
  return createKciProvider({
    http,
    cache: createTtlCache({ ttlMs: 3_600_000, maxEntries: 50, clock }),
    clock,
    makeBreaker: () => createCircuitBreaker({ threshold: 3, cooldownMs: 60_000, clock }),
    apiKey,
  });
};

// ─── URL 조립 ───

test('displayCount를 10~100으로 강제한다', () => {
  // 5를 보내면 KCI가 10으로 올리고 200을 보내면 100으로 내린다.
  // 서버가 미리 맞춰야 요청과 결과 개수가 어긋나지 않는다.
  assert.match(buildKciUrl({ apiKey: 'k', query: '배터리', limit: 5 }), /displayCount=10/);
  assert.match(buildKciUrl({ apiKey: 'k', query: '배터리', limit: 200 }), /displayCount=100/);
  assert.match(buildKciUrl({ apiKey: 'k', query: '배터리', limit: 50 }), /displayCount=50/);
});

test('한글 검색어를 퍼센트 인코딩한다', () => {
  const url = buildKciUrl({ apiKey: 'k', query: '배터리', limit: 10 });
  assert.match(url, /title=%EB%B0%B0%ED%84%B0%EB%A6%AC/);
  assert.ok(url.startsWith('https://open.kci.go.kr/po/openapi/openApiSearch.kci?'));
  assert.match(url, /apiCode=articleSearch/);
});

test('지원하지 않는 abstract 파라미터를 보내지 않는다', () => {
  // 에코에서 탈락한 파라미터다. 보내면 무시되고 오해만 남는다.
  assert.ok(!buildKciUrl({ apiKey: 'k', query: '배터리', limit: 10 }).includes('abstract='));
});

// ─── 오류 판정 ───

test('resultMsg 여러 개를 배열로 읽는다', () => {
  const { messages } = parseKciResponse(ERROR_XML);
  assert.equal(messages.length, 3);
  assert.ok(messages.includes('등록되지 않은 key 입니다.'));
  assert.ok(messages.includes('검색 조건이 없습니다.'));
});

test('HTTP 200이어도 resultMsg가 있으면 실패로 본다', async () => {
  // 상태코드만 보면 오류를 성공으로 처리한다. 같은 계열의 KISTI ScienceON은
  // HTTP 200에 본문 statusCode 400을 실어 보낸다.
  const http = makeHttp({ 'open.kci.go.kr': ERROR_XML });
  const result = await provider(http, 'testkey').search({ query: '배터리', limit: 10 });

  assert.deepEqual(result.items, []);
  assert.equal(result.degraded.source, 'KCI');
  assert.ok(result.degraded.reason.length > 0);
});

test('IP 거부를 일반 오류와 구분한다', () => {
  // 가정용 유동 IP는 예고 없이 바뀐다. 일반 오류로 뭉뚱그리면
  // 사용자는 국내 논문이 왜 사라졌는지 알 방법이 없다.
  assert.equal(isIpRejection(['등록되지 않은 IP 입니다.']), true);
  assert.equal(isIpRejection(['허용되지 않은 ip 주소']), true);
  assert.equal(isIpRejection(['등록되지 않은 key 입니다.']), false);
  assert.equal(isIpRejection([]), false);
});

test('IP 거부에는 재등록 안내 문구를 낸다', async () => {
  const ipError = ERROR_XML.replace('등록되지 않은 key 입니다.', '등록되지 않은 IP 입니다.');
  const http = makeHttp({ 'open.kci.go.kr': ipError });
  const result = await provider(http, 'testkey').search({ query: '배터리', limit: 10 });

  assert.match(result.degraded.reason, /IP/);
  assert.match(result.degraded.reason, /open\.kci\.go\.kr/);
  assert.equal(result.degraded.kind, 'ip-mismatch');
});

// ─── 키가 없을 때 ───

test('API 키가 비면 호출하지 않는다', async () => {
  const http = makeHttp({ 'open.kci.go.kr': ERROR_XML });
  const result = await provider(http, '').search({ query: '배터리', limit: 10 });

  assert.equal(http.calls.length, 0, '키 없이 KCI를 부르면 안 된다');
  assert.deepEqual(result.items, []);
  assert.match(result.degraded.reason, /KCI API 키/);
  assert.equal(result.degraded.kind, 'no-key');
});

// ─── 키 노출 ───

test('API 키를 문자열에서 가린다', () => {
  const url = buildKciUrl({ apiKey: 'SECRET123', query: '배터리', limit: 10 });
  assert.ok(url.includes('SECRET123'));
  assert.ok(!redactKey(url, 'SECRET123').includes('SECRET123'));
  assert.match(redactKey(url, 'SECRET123'), /\[REDACTED\]/);
});

test('실패 사유에 API 키가 섞이지 않는다', async () => {
  const http = makeHttp({ 'open.kci.go.kr': new Error('boom') });
  const result = await provider(http, 'SECRET123').search({ query: '배터리', limit: 10 });
  assert.ok(!JSON.stringify(result).includes('SECRET123'));
});

// ─── 정상 응답 (키 발급 후) ───

test(
  '정상 응답에서 논문 항목을 만든다',
  { skip: 'KCI 키 발급 후 tests/fixtures/kci-articles.xml을 저장하면 해제한다 (Task 14)' },
  () => {
    const { records } = parseKciResponse(fixture('kci-articles.xml'));
    assert.ok(records.length > 0);
  },
);
