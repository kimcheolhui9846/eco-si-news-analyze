import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpClient } from '../lib/http.js';

const stubFetch = ({ status = 200, body = 'ok' } = {}) => {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return { status, headers: { get: () => null }, text: async () => body };
  };
  fn.calls = calls;
  return fn;
};
const client = (fetchImpl) =>
  createHttpClient({ allowlist: ['example.com'], timeoutMs: 1000, maxBytes: 10_000, fetchImpl });

test('추가 헤더를 기본 헤더 위에 얹는다', async () => {
  const f = stubFetch();
  await client(f).get('https://example.com/x', {
    headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer t' },
  });
  const h = f.calls[0].opts.headers;
  assert.equal(h.Accept, 'application/vnd.github+json');
  assert.equal(h.Authorization, 'Bearer t');
  assert.ok(h['User-Agent']);
});

test('옵션이 없으면 기존 헤더 그대로다', async () => {
  const f = stubFetch();
  await client(f).get('https://example.com/x');
  assert.ok(f.calls[0].opts.headers.Accept.startsWith('application/rss+xml'));
  assert.equal(f.calls[0].opts.headers.Authorization, undefined);
});

test('3xx 이상 실패에 상태 코드를 남기고 메시지는 바꾸지 않는다', async () => {
  await assert.rejects(
    () => client(stubFetch({ status: 403 })).get('https://example.com/x'),
    (e) => e.code === 'UPSTREAM_ERROR' && e.upstreamStatus === 403
      && e.message === '외부 자료를 가져오지 못했습니다.',
  );
});
