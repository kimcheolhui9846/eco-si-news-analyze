import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { bootstrap, makeClock, TEST_PASSWORD } from './helpers.js';
import { createSessionStore } from '../server.js';

// ─── 세션 저장소 단위 테스트 ───

test('세션 저장소는 TTL이 지나면 조회 시 삭제한다', () => {
  const clock = makeClock();
  const store = createSessionStore({ clock, ttlMs: 1000 });
  const s = store.create();

  assert.equal(store.get(s.token)?.token, s.token);
  clock.advance(1001);
  assert.equal(store.get(s.token), undefined, '만료된 세션이 반환되었다');
  assert.equal(store.size(), 0, '만료된 세션이 메모리에 남아 있다');
});

test('touch는 만료 시각을 현재 기준으로 다시 잡는다', () => {
  const clock = makeClock();
  const store = createSessionStore({ clock, ttlMs: 1000 });
  const s = store.create();
  const before = s.expiresAt;

  clock.advance(600);
  store.touch(s);

  assert.equal(s.expiresAt, clock.now() + 1000);
  assert.ok(s.expiresAt > before);
  assert.equal(s.lastActivityAt, clock.now());
});

test('sweep은 만료 세션만 제거한다', () => {
  const clock = makeClock();
  const store = createSessionStore({ clock, ttlMs: 1000 });
  store.create();          // 이 세션은 1100ms 뒤 만료된다
  clock.advance(900);
  const fresh = store.create();
  clock.advance(200);

  assert.equal(store.sweep(), 1);
  assert.equal(store.size(), 1);
  assert.equal(store.get(fresh.token)?.token, fresh.token);
});

test('destroy는 없는 토큰에도 예외를 던지지 않는다', () => {
  const store = createSessionStore({ clock: makeClock(), ttlMs: 1000 });
  assert.equal(store.destroy('없는-토큰'), false);
  assert.equal(store.destroy(undefined), false);
});

// ─── 로그인 API ───

test('올바른 비밀번호로 로그인하면 토큰과 만료 시각을 받는다', async () => {
  const clock = makeClock();
  const { app } = bootstrap({ clock });
  const res = await request(app).post('/api/auth/login').send({ password: TEST_PASSWORD });

  assert.equal(res.status, 200);
  assert.equal(typeof res.body.token, 'string');
  assert.equal(res.body.expiresAt, new Date(clock.now() + 15 * 60 * 1000).toISOString());
});

test('로그인 시 HttpOnly 쿠키를 함께 내려준다', async () => {
  const { app } = bootstrap();
  const res = await request(app).post('/api/auth/login').send({ password: TEST_PASSWORD });
  const cookie = res.headers['set-cookie'].join(';');

  assert.match(cookie, /session=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.ok(!/Secure/i.test(cookie), '개발 환경에서 Secure가 붙으면 HTTP로 쿠키가 전송되지 않는다');
});

test('운영 환경에서는 Secure 쿠키를 쓴다', async () => {
  const { app } = bootstrap({ env: { NODE_ENV: 'production' } });
  const res = await request(app).post('/api/auth/login').send({ password: TEST_PASSWORD });
  assert.match(res.headers['set-cookie'].join(';'), /Secure/i);
});

test('잘못된 비밀번호는 403을 반환하고 토큰을 주지 않는다', async () => {
  const { app } = bootstrap();
  const res = await request(app).post('/api/auth/login').send({ password: 'wrong-password' });

  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
  assert.equal(res.body.token, undefined);
  assert.equal(res.headers['set-cookie'], undefined);
});

test('비밀번호 길이가 달라도 예외 없이 403을 반환한다', async () => {
  // crypto.timingSafeEqual은 길이가 다르면 throw한다. 해시 후 비교로 회피해야 한다.
  const { app } = bootstrap();
  const res = await request(app).post('/api/auth/login').send({ password: 'x' });

  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
});

test('password 필드가 없으면 400을 반환한다', async () => {
  const { app } = bootstrap();
  const res = await request(app).post('/api/auth/login').send({});

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_REQUEST');
});

test('허용되지 않은 필드를 보내면 400을 반환한다', async () => {
  const { app } = bootstrap();
  const res = await request(app)
    .post('/api/auth/login')
    .send({ password: TEST_PASSWORD, role: 'admin' });

  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'INVALID_REQUEST');
});

test('발급되는 토큰은 매번 다르고 충분히 길다', async () => {
  const { app } = bootstrap();
  const seen = new Set();

  for (let i = 0; i < 5; i += 1) {
    const res = await request(app).post('/api/auth/login').send({ password: TEST_PASSWORD });
    assert.ok(res.body.token.length >= 43, '256비트 base64url은 43자 이상이어야 한다');
    seen.add(res.body.token);
  }

  assert.equal(seen.size, 5, '토큰이 중복 발급되었다');
});
