import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { bootstrap } from './helpers.js';
import { ApiError } from '../server.js';

test('모든 응답에 X-Request-Id 헤더가 붙는다', async () => {
  const { app } = bootstrap();
  const res = await request(app).get('/api/health');
  assert.match(res.headers['x-request-id'], /^[0-9a-f-]{36}$/);
});

test('클라이언트가 보낸 X-Request-Id를 신뢰하지 않고 새로 발급한다', async () => {
  const { app } = bootstrap();
  const res = await request(app).get('/api/health').set('X-Request-Id', 'attacker-supplied');
  assert.notEqual(res.headers['x-request-id'], 'attacker-supplied');
});

test('알 수 없는 경로는 고정 에러 형식으로 404를 반환한다', async () => {
  const { app } = bootstrap();
  const res = await request(app).get('/api/nope');

  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
  assert.equal(res.body.error.requestId, res.headers['x-request-id']);
});

test('예상치 못한 예외는 내부 정보를 노출하지 않는다', async () => {
  const { app } = bootstrap({
    extraRoutes: (a) => {
      a.get('/api/boom', () => { throw new Error('데이터베이스 비밀번호는 hunter2입니다'); });
    },
  });
  const res = await request(app).get('/api/boom');

  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, 'INTERNAL');
  const body = JSON.stringify(res.body);
  assert.ok(!body.includes('hunter2'), '내부 오류 메시지가 새어나갔다');
  assert.ok(!body.includes('at '), '스택 트레이스가 새어나갔다');
});

test('ApiError는 지정한 상태코드와 코드를 그대로 쓴다', async () => {
  const { app } = bootstrap({
    extraRoutes: (a) => {
      a.get('/api/limited', () => { throw new ApiError(429, 'RATE_LIMITED', '요청이 너무 많습니다.'); });
    },
  });
  const res = await request(app).get('/api/limited');

  assert.equal(res.status, 429);
  assert.equal(res.body.error.code, 'RATE_LIMITED');
  assert.equal(res.body.error.message, '요청이 너무 많습니다.');
});

test('async 핸들러의 rejection도 에러 핸들러가 잡는다', async () => {
  const { app } = bootstrap({
    extraRoutes: (a) => {
      a.get('/api/async-boom', async () => { throw new ApiError(502, 'UPSTREAM_ERROR', '상류 오류'); });
    },
  });
  const res = await request(app).get('/api/async-boom');

  assert.equal(res.status, 502);
  assert.equal(res.body.error.code, 'UPSTREAM_ERROR');
});
