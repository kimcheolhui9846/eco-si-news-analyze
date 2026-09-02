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

// ─── 인증 미들웨어 ───

/** requireAuth를 통과했는지 확인하기 위한 보호된 테스트 라우트. */
const withProtectedRoute = (opts = {}) => bootstrap({
  ...opts,
  extraRoutes: (a, { requireAuth }) => {
    a.get('/api/protected', requireAuth, (req, res) => {
      res.json({ ok: true, expiresAt: req.session.expiresAt });
    });
  },
});

const login = async (app) => {
  const res = await request(app).post('/api/auth/login').send({ password: TEST_PASSWORD });
  return res.body.token;
};

test('Bearer 토큰으로 보호된 라우트에 접근할 수 있다', async () => {
  const { app } = withProtectedRoute();
  const token = await login(app);

  const res = await request(app).get('/api/protected').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('쿠키만으로도 보호된 라우트에 접근할 수 있다', async () => {
  const { app } = withProtectedRoute();
  const loginRes = await request(app).post('/api/auth/login').send({ password: TEST_PASSWORD });
  const cookie = loginRes.headers['set-cookie'];

  const res = await request(app).get('/api/protected').set('Cookie', cookie);
  assert.equal(res.status, 200);
});

test('토큰이 없으면 403을 반환한다', async () => {
  const { app } = withProtectedRoute();
  const res = await request(app).get('/api/protected');

  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('위조된 토큰은 403을 반환한다', async () => {
  const { app } = withProtectedRoute();
  const res = await request(app).get('/api/protected').set('Authorization', 'Bearer forged-token-not-issued');

  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('Bearer 접두어가 없는 Authorization 헤더는 거부한다', async () => {
  const { app } = withProtectedRoute();
  const token = await login(app);

  const res = await request(app).get('/api/protected').set('Authorization', token);
  assert.equal(res.status, 403);
});

test('만료된 세션은 403을 반환하고 메모리에서 삭제된다', async () => {
  const clock = makeClock();
  const { app, sessions } = withProtectedRoute({ clock });
  const token = await login(app);

  assert.equal(sessions.size(), 1);
  clock.advance(15 * 60 * 1000 + 1);   // TTL 15분 경과

  const res = await request(app).get('/api/protected').set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
  assert.equal(sessions.size(), 0, '만료된 세션이 메모리에 남아 있다');
});

test('미들웨어 통과만으로는 세션이 연장되지 않는다', async () => {
  const clock = makeClock();
  const { app } = withProtectedRoute({ clock });
  const token = await login(app);

  const first = await request(app).get('/api/protected').set('Authorization', `Bearer ${token}`);
  clock.advance(60_000);
  const second = await request(app).get('/api/protected').set('Authorization', `Bearer ${token}`);

  assert.equal(second.body.expiresAt, first.body.expiresAt,
    '보호된 라우트 접근만으로 만료 시각이 바뀌었다');
});

// ─── 로그아웃 ───

test('로그아웃 후 같은 토큰으로 접근하면 403이다', async () => {
  const { app } = withProtectedRoute();
  const token = await login(app);

  const before = await request(app).get('/api/protected').set('Authorization', `Bearer ${token}`);
  assert.equal(before.status, 200);

  const out = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
  assert.equal(out.status, 200);
  assert.equal(out.body.success, true);

  const after = await request(app).get('/api/protected').set('Authorization', `Bearer ${token}`);
  assert.equal(after.status, 403, '로그아웃된 토큰이 여전히 통한다');
});

test('로그아웃은 세션을 메모리에서 즉시 삭제한다', async () => {
  const { app, sessions } = withProtectedRoute();
  const token = await login(app);
  assert.equal(sessions.size(), 1);

  await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
  assert.equal(sessions.size(), 0);
});

test('로그아웃은 멱등적이다', async () => {
  const { app } = withProtectedRoute();
  const token = await login(app);

  const first = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
  const second = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
  const noToken = await request(app).post('/api/auth/logout');

  for (const res of [first, second, noToken]) {
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
  }
});

test('로그아웃은 쿠키도 제거한다', async () => {
  const { app } = withProtectedRoute();
  const token = await login(app);

  const res = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
  const cookie = (res.headers['set-cookie'] ?? []).join(';');
  assert.match(cookie, /session=;|Max-Age=0|Expires=Thu, 01 Jan 1970/i);
});
