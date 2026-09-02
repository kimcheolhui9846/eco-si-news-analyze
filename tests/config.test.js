import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { loadConfig } from '../server.js';
import { bootstrap, makeClock } from './helpers.js';

test('숫자 환경변수를 숫자로 변환한다', () => {
  const cfg = loadConfig({
    MY_SECRET_PASSWORD: 'pw', LLM_MODE: 'mock', SESSION_TTL_MINUTES: '15',
  });
  assert.equal(cfg.sessionTtlMs, 15 * 60 * 1000);
  assert.equal(typeof cfg.maxNewsItems, 'number');
});

test('MY_SECRET_PASSWORD가 없으면 부팅을 거부한다', () => {
  assert.throws(
    () => loadConfig({ LLM_MODE: 'mock', MY_SECRET_PASSWORD: '' }),
    /MY_SECRET_PASSWORD/,
  );
});

test('LLM_MODE=live일 때 OPENAI_API_KEY를 요구한다', () => {
  assert.throws(
    () => loadConfig({ MY_SECRET_PASSWORD: 'pw', LLM_MODE: 'live', OPENAI_API_KEY: '' }),
    /OPENAI_API_KEY/,
  );
});

test('LLM_MODE=mock일 때는 OPENAI_API_KEY가 없어도 된다', () => {
  const cfg = loadConfig({ MY_SECRET_PASSWORD: 'pw', LLM_MODE: 'mock', OPENAI_API_KEY: '' });
  assert.equal(cfg.llmMode, 'mock');
});

test('설정 객체는 동결되어 있다', () => {
  const cfg = loadConfig({ MY_SECRET_PASSWORD: 'pw', LLM_MODE: 'mock' });
  assert.equal(Object.isFrozen(cfg), true);
});

test('GET /api/health가 주입된 시계를 사용한다', async () => {
  const clock = makeClock(1_700_000_000_000);
  const { app } = bootstrap({ clock });
  const res = await request(app).get('/api/health');

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.time, new Date(1_700_000_000_000).toISOString());
});
