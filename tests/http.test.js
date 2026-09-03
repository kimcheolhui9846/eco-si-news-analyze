import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpClient, ApiError } from '../server.js';

const ALLOW = ['example.com', 'api.example.org'];

/** 응답을 흉내내는 최소 fetch. body는 문자열. */
const fakeFetch = (spec) => async (url, opts) => {
  spec.calls?.push({ url, opts });
  if (spec.throws) throw spec.throws;
  return {
    status: spec.status ?? 200,
    headers: new Map(Object.entries(spec.headers ?? {})),
    text: async () => spec.body ?? '',
  };
};

const client = (spec, over = {}) => createHttpClient({
  allowlist: ALLOW,
  timeoutMs: 5000,
  maxBytes: 1000,
  fetchImpl: fakeFetch(spec),
  ...over,
});

test('허용목록에 있는 호스트는 통과한다', async () => {
  const res = await client({ body: 'ok' }).get('https://example.com/feed');
  assert.equal(res.status, 200);
  assert.equal(res.text, 'ok');
});

test('허용목록에 없는 호스트를 차단한다', async () => {
  const calls = [];
  await assert.rejects(
    () => client({ calls, body: 'ok' }).get('https://evil.com/x'),
    (err) => err instanceof ApiError && err.status === 502,
  );
  assert.equal(calls.length, 0, '차단해야 하는데 실제로 요청이 나갔다');
});

test('서브도메인을 허용목록 항목으로 착각하지 않는다', async () => {
  // 'example.com.evil.com'이 'example.com'으로 끝난다고 통과시키면 안 된다.
  const calls = [];
  await assert.rejects(() => client({ calls }).get('https://example.com.evil.com/x'));
  await assert.rejects(() => client({ calls }).get('https://notexample.com/x'));
  assert.equal(calls.length, 0);
});

test('http 스킴을 거부한다', async () => {
  const calls = [];
  await assert.rejects(() => client({ calls }).get('http://example.com/x'));
  assert.equal(calls.length, 0);
});

test('URL 형식이 아니면 거부한다', async () => {
  await assert.rejects(() => client({}).get('그냥문자열'));
});

test('3xx 리다이렉트를 따라가지 않고 실패로 처리한다', async () => {
  // 따라가면 허용목록이 무의미해진다.
  await assert.rejects(
    () => client({ status: 302, headers: { location: 'https://evil.com/' } }).get('https://example.com/x'),
    (err) => err instanceof ApiError && err.status === 502,
  );
});

test('fetch에 redirect: manual을 넘긴다', async () => {
  const calls = [];
  await client({ calls, body: 'ok' }).get('https://example.com/x');
  assert.equal(calls[0].opts.redirect, 'manual');
});

test('4xx·5xx 응답을 오류로 만든다', async () => {
  await assert.rejects(() => client({ status: 403 }).get('https://example.com/x'));
  await assert.rejects(() => client({ status: 500 }).get('https://example.com/x'));
});

test('크기 상한을 넘는 응답을 거부한다', async () => {
  await assert.rejects(
    () => client({ body: 'x'.repeat(1001) }).get('https://example.com/x'),
    (err) => err instanceof ApiError,
  );
});

test('Content-Length가 상한을 넘으면 본문을 읽기 전에 거부한다', async () => {
  let bodyRead = false;
  const c = createHttpClient({
    allowlist: ALLOW,
    timeoutMs: 5000,
    maxBytes: 1000,
    fetchImpl: async () => ({
      status: 200,
      headers: new Map([['content-length', '999999']]),
      text: async () => { bodyRead = true; return 'x'; },
    }),
  });

  await assert.rejects(() => c.get('https://example.com/x'));
  assert.equal(bodyRead, false, '거대 응답의 본문을 읽었다');
});

test('타임아웃은 UPSTREAM_TIMEOUT으로 변환된다', async () => {
  const err = new Error('시간 초과');
  err.name = 'AbortError';
  await assert.rejects(
    () => client({ throws: err }).get('https://example.com/x'),
    (e) => e instanceof ApiError && e.code === 'UPSTREAM_TIMEOUT' && e.status === 504,
  );
});

test('상류 오류 메시지를 사용자에게 전달하지 않는다', async () => {
  await assert.rejects(
    () => client({ throws: new Error('내부 경로 C:\\secrets\\key.pem') }).get('https://example.com/x'),
    (e) => e instanceof ApiError && !e.message.includes('secrets'),
  );
});

test('User-Agent를 붙인다', async () => {
  const calls = [];
  await client({ calls, body: 'ok' }).get('https://example.com/x');
  assert.ok(calls[0].opts.headers['User-Agent'], 'User-Agent가 없으면 일부 피드가 403을 준다');
});
