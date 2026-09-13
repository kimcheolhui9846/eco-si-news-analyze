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

test('market source hosts are present in the default external allowlist', () => {
  const config = loadConfig({ MY_SECRET_PASSWORD: 'x', LLM_MODE: 'mock' });
  for (const host of ['api.stock.naver.com', 'm.stock.naver.com', 'api.exchange.coinbase.com']) assert.ok(config.externalAllowlist.includes(host), host);
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

test('Phase 2b 환경변수의 기본값을 채운다', () => {
  const config = loadConfig({ MY_SECRET_PASSWORD: 'x', LLM_MODE: 'mock' });
  assert.equal(config.financialCacheTtlMs, 86_400_000);
  assert.equal(config.researchCacheTtlMs, 3_600_000);
  assert.equal(config.experimentCacheTtlMs, 3_600_000);
  assert.equal(config.maxResearchItems, 5);
  assert.equal(config.maxExperimentItems, 5);
});

test('KCI_API_KEY가 없어도 설정 로드가 통과한다', () => {
  // 키는 선택 사항이다. 없으면 국내 논문만 빠지고 서버는 정상 기동한다.
  const config = loadConfig({ MY_SECRET_PASSWORD: 'x', LLM_MODE: 'mock' });
  assert.equal(config.kciApiKey, '');
});

test('KCI_API_KEY가 있으면 그대로 싣는다', () => {
  const config = loadConfig({ MY_SECRET_PASSWORD: 'x', LLM_MODE: 'mock', KCI_API_KEY: 'abc123' });
  assert.equal(config.kciApiKey, 'abc123');
});

test('허용목록 기본값에 Phase 2b 호스트가 들어 있다', () => {
  const config = loadConfig({ MY_SECRET_PASSWORD: 'x', LLM_MODE: 'mock' });
  const hosts = ['data.sec.gov', 'www.ebi.ac.uk', 'export.arxiv.org', 'clinicaltrials.gov', 'open.kci.go.kr'];
  for (const host of hosts) {
    assert.ok(config.externalAllowlist.includes(host), `${host}이(가) 허용목록에 없다`);
  }
});
