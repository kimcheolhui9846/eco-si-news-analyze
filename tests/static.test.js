import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bootstrap } from './helpers.js';

const built = existsSync(fileURLToPath(new URL('../client/dist/index.html', import.meta.url)));

test('API 경로는 정적 서빙에 가로채이지 않는다', async () => {
  const { app } = bootstrap();
  const res = await request(app).get('/api/health');

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('없는 API 경로는 여전히 JSON 404를 준다', async () => {
  // SPA 폴백이 /api/*를 삼키면 클라이언트가 HTML을 JSON으로 파싱하려다 죽는다.
  const { app } = bootstrap();
  const res = await request(app).get('/api/nope');

  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('빌드가 있으면 루트가 HTML을 준다', { skip: !built }, async () => {
  const { app } = bootstrap();
  const res = await request(app).get('/');

  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /html/);
});

test('빌드가 있으면 임의 경로도 SPA로 폴백한다', { skip: !built }, async () => {
  const { app } = bootstrap();
  const res = await request(app).get('/some/deep/route');

  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /html/);
});
