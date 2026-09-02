import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTtlCache, createSemaphore, createInflightMap, hashRequest } from '../server.js';
import { makeClock, bootstrap, TEST_PASSWORD } from './helpers.js';

// ─── TTL 캐시 ───

test('저장한 값을 다시 꺼낼 수 있다', () => {
  const cache = createTtlCache({ ttlMs: 1000, maxEntries: 10, clock: makeClock() });
  cache.set('k', { report: 'x' });
  assert.deepEqual(cache.get('k'), { report: 'x' });
});

test('TTL이 지나면 값을 반환하지 않는다', () => {
  const clock = makeClock();
  const cache = createTtlCache({ ttlMs: 1000, maxEntries: 10, clock });
  cache.set('k', 'v');

  clock.advance(1001);
  assert.equal(cache.get('k'), undefined);
  assert.equal(cache.size(), 0, '만료된 항목이 남아 있다');
});

test('용량을 넘으면 가장 오래 안 쓴 항목부터 버린다', () => {
  const cache = createTtlCache({ ttlMs: 60_000, maxEntries: 2, clock: makeClock() });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a');        // a를 최근 사용으로 올린다
  cache.set('c', 3);     // 가장 오래된 b가 밀려나야 한다

  assert.equal(cache.get('b'), undefined, 'LRU 순서가 틀렸다');
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('c'), 3);
});

// ─── 세마포어 ───

test('한도까지만 동시 획득을 허용한다', () => {
  const sem = createSemaphore(2);
  const a = sem.tryAcquire();
  const b = sem.tryAcquire();
  const c = sem.tryAcquire();

  assert.ok(a);
  assert.ok(b);
  assert.equal(c, null, '한도를 넘어 획득되었다');
  assert.equal(sem.inUse(), 2);
});

test('반납하면 다시 획득할 수 있다', () => {
  const sem = createSemaphore(1);
  const release = sem.tryAcquire();
  assert.equal(sem.tryAcquire(), null);

  release();
  assert.equal(sem.inUse(), 0);
  assert.ok(sem.tryAcquire());
});

test('중복 반납은 카운터를 망가뜨리지 않는다', () => {
  const sem = createSemaphore(1);
  const release = sem.tryAcquire();
  release();
  release();

  assert.equal(sem.inUse(), 0);
});

// ─── 동시 중복 요청 병합 ───

test('같은 키의 동시 요청은 하나의 실행을 공유한다', async () => {
  const inflight = createInflightMap();
  let runs = 0;
  const slow = async () => {
    runs += 1;
    await new Promise((r) => { setTimeout(r, 10); });
    return 'result';
  };

  const [a, b, c] = await Promise.all([
    inflight.run('same', slow),
    inflight.run('same', slow),
    inflight.run('same', slow),
  ]);

  assert.equal(runs, 1, '동일 요청이 여러 번 실행되었다');
  assert.deepEqual([a, b, c], ['result', 'result', 'result']);
});

test('다른 키는 따로 실행된다', async () => {
  const inflight = createInflightMap();
  let runs = 0;
  const fn = async () => { runs += 1; return runs; };

  await Promise.all([inflight.run('a', fn), inflight.run('b', fn)]);
  assert.equal(runs, 2);
});

test('실행이 끝나면 키를 비워 다음 요청이 새로 돈다', async () => {
  const inflight = createInflightMap();
  let runs = 0;
  const fn = async () => { runs += 1; return runs; };

  await inflight.run('k', fn);
  await inflight.run('k', fn);
  assert.equal(runs, 2);
});

test('실패해도 키를 비운다', async () => {
  const inflight = createInflightMap();
  let runs = 0;
  const failing = async () => { runs += 1; throw new Error('실패'); };

  await assert.rejects(() => inflight.run('k', failing));
  await assert.rejects(() => inflight.run('k', failing));
  assert.equal(runs, 2, '실패 후 키가 남아 재실행이 막혔다');
});

// ─── 요청 해시 ───

test('같은 입력은 같은 해시를 만든다', () => {
  const input = { newsList: [{ title: 'a', url: 'https://x.com/1' }] };
  assert.equal(hashRequest(input), hashRequest(structuredClone(input)));
});

test('다른 입력은 다른 해시를 만든다', () => {
  assert.notEqual(
    hashRequest({ newsList: [{ title: 'a' }] }),
    hashRequest({ newsList: [{ title: 'b' }] }),
  );
});

test('키 순서가 달라도 같은 해시를 만든다', () => {
  assert.equal(hashRequest({ a: 1, b: 2 }), hashRequest({ b: 2, a: 1 }));
});

// ─── rate limit (엔드포인트 수준) ───

test('로그인 rate limit을 넘기면 429를 반환한다', async () => {
  const { app } = bootstrap({ env: { LOGIN_RATE_MAX: '3', LOGIN_RATE_WINDOW_MS: '60000' } });

  for (let i = 0; i < 3; i += 1) {
    const res = await request(app).post('/api/auth/login').send({ password: 'wrong' });
    assert.equal(res.status, 403);
  }

  const limited = await request(app).post('/api/auth/login').send({ password: TEST_PASSWORD });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'RATE_LIMITED');
});

test('rate limit 응답도 고정 에러 형식을 지킨다', async () => {
  const { app } = bootstrap({ env: { LOGIN_RATE_MAX: '1' } });
  await request(app).post('/api/auth/login').send({ password: 'wrong' });
  const res = await request(app).post('/api/auth/login').send({ password: 'wrong' });

  assert.equal(res.status, 429);
  assert.equal(res.body.error.code, 'RATE_LIMITED');
  assert.equal(res.body.error.requestId, res.headers['x-request-id']);
});
