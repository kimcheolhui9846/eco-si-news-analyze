import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, ApiCallError } from '../../client/src/api/client.js';

/** 응답을 흉내내는 fetch. calls로 요청을 관찰한다. */
const makeFetch = (spec) => {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    if (spec.throws) throw spec.throws;
    return {
      ok: (spec.status ?? 200) < 400,
      status: spec.status ?? 200,
      json: async () => spec.body ?? {},
    };
  };
  fn.calls = calls;
  return fn;
};

test('로그인은 비밀번호를 본문에 담아 보낸다', async () => {
  const f = makeFetch({ body: { token: 'tk', expiresAt: 'x' } });
  const api = createApiClient({ fetchImpl: f });

  const r = await api.login('secret');

  assert.equal(r.token, 'tk');
  assert.equal(f.calls[0].url, '/api/auth/login');
  assert.equal(JSON.parse(f.calls[0].opts.body).password, 'secret');
});

test('모든 요청에 same-origin 자격증명을 붙인다', async () => {
  // HttpOnly 쿠키가 실려야 인증이 유지된다.
  const f = makeFetch({ body: {} });
  await createApiClient({ fetchImpl: f }).budget();

  assert.equal(f.calls[0].opts.credentials, 'same-origin');
});

test('토큰을 저장하거나 헤더에 넣지 않는다', async () => {
  // 쿠키만 쓴다. JS가 토큰을 만지면 XSS 시 탈취된다.
  const f = makeFetch({ body: { token: 'tk' } });
  const api = createApiClient({ fetchImpl: f });

  await api.login('pw');
  await api.budget();

  assert.equal(f.calls[1].opts.headers?.Authorization, undefined);
});

test('수집은 파라미터를 그대로 보낸다', async () => {
  const f = makeFetch({ body: { newsList: [] } });
  await createApiClient({ fetchImpl: f }).collect({
    query: '엔비디아', symbol: 'NVDA', lang: 'ko', range: '1mo', maxNews: 8,
  });

  const sent = JSON.parse(f.calls[0].opts.body);
  assert.equal(sent.query, '엔비디아');
  assert.equal(sent.maxNews, 8);
});

test('빈 symbol은 보내지 않는다', async () => {
  // 빈 문자열을 보내면 zod가 min(1)에서 400을 준다.
  const f = makeFetch({ body: {} });
  await createApiClient({ fetchImpl: f }).collect({ query: '테스트', symbol: '' });

  assert.equal('symbol' in JSON.parse(f.calls[0].opts.body), false);
});

test('분석은 확인 토큰을 헤더에 싣는다', async () => {
  const f = makeFetch({ body: { analysis: {} } });
  await createApiClient({ fetchImpl: f }).analyze({
    newsList: [{ title: 'a' }], marketData: { assetName: 'X' }, confirmToken: 'ct_abc',
  });

  assert.equal(f.calls[0].opts.headers['X-Confirm-Token'], 'ct_abc');
});

test('분석 본문에 newsList가 수정 없이 실린다', async () => {
  // 한 글자만 바뀌어도 cacheKey가 달라져 확인 토큰이 428로 거부된다.
  const newsList = [{
    title: '기사', content: '본문', source: '출처',
    url: 'https://a.com/1', publishedAt: '2026-09-01T00:00:00.000Z', contentKind: 'summary',
  }];
  const f = makeFetch({ body: {} });

  await createApiClient({ fetchImpl: f }).analyze({ newsList, marketData: undefined, confirmToken: 'ct' });

  assert.deepEqual(JSON.parse(f.calls[0].opts.body).newsList, newsList);
});

test('marketData가 없으면 본문에서 뺀다', async () => {
  const f = makeFetch({ body: {} });
  await createApiClient({ fetchImpl: f }).analyze({
    newsList: [{ title: 'a' }], marketData: undefined, confirmToken: 'ct',
  });

  assert.equal('marketData' in JSON.parse(f.calls[0].opts.body), false);
});

test('에러 응답을 ApiCallError로 바꾼다', async () => {
  const f = makeFetch({
    status: 403,
    body: { error: { code: 'FORBIDDEN', message: '만료됨', requestId: 'rq-1' } },
  });

  await assert.rejects(
    () => createApiClient({ fetchImpl: f }).budget(),
    (e) => e instanceof ApiCallError && e.code === 'FORBIDDEN'
      && e.requestId === 'rq-1' && e.status === 403,
  );
});

test('네트워크 실패도 ApiCallError로 바꾼다', async () => {
  const f = makeFetch({ throws: new TypeError('Failed to fetch') });

  await assert.rejects(
    () => createApiClient({ fetchImpl: f }).budget(),
    (e) => e instanceof ApiCallError && e.code === 'NETWORK_ERROR',
  );
});

test('JSON이 아닌 응답도 ApiCallError로 바꾼다', async () => {
  const f = async () => ({
    ok: false,
    status: 502,
    json: async () => { throw new Error('not json'); },
  });

  await assert.rejects(
    () => createApiClient({ fetchImpl: f }).budget(),
    (e) => e instanceof ApiCallError && e.status === 502,
  );
});

// ─── Phase 2b ───

test('include를 본문에 싣는다', async () => {
  const f = makeFetch({ body: {} });
  await createApiClient({ fetchImpl: f }).collect({ query: '엔비디아', include: ['news', 'research'] });
  assert.deepEqual(JSON.parse(f.calls[0].opts.body).include, ['news', 'research']);
});

test('include가 없으면 본문에 넣지 않는다', async () => {
  const f = makeFetch({ body: {} });
  await createApiClient({ fetchImpl: f }).collect({ query: '엔비디아' });
  assert.equal('include' in JSON.parse(f.calls[0].opts.body), false);
});

test('분석 요청에 재무·논문·실험을 그대로 넘긴다', async () => {
  // 한 글자만 바뀌어도 cacheKey가 달라져 확인 토큰이 428로 거부된다.
  const f = makeFetch({ body: {} });
  const research = [{ title: '논문' }];
  await createApiClient({ fetchImpl: f }).analyze({
    newsList: [{ title: 'a' }], research, confirmToken: 'ct_x',
  });

  const body = JSON.parse(f.calls[0].opts.body);
  assert.deepEqual(body.research, research);
  assert.equal('experiments' in body, false, '빈 자료는 필드를 아예 넣지 않는다');
});
