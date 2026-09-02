import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createBudgetTracker, estimateCostUsd } from '../server.js';
import { makeClock, makeMockLlm, bootstrap, TEST_PASSWORD } from './helpers.js';

const withTempFile = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'budget-'));
  try {
    return fn(join(dir, 'budget.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const tracker = (file, over = {}) => createBudgetTracker({
  clock: over.clock ?? makeClock(Date.UTC(2026, 8, 2, 10, 0, 0)),
  filePath: file,
  dailyCallLimit: over.dailyCallLimit ?? 50,
  monthlyCostLimitUsd: over.monthlyCostLimitUsd ?? 10,
});

// ─── 비용 추정 ───

test('토큰과 단가로 비용을 계산한다', () => {
  const cost = estimateCostUsd(
    { inputTokens: 1_000_000, outputTokens: 0 },
    { inputPer1M: 2.5, outputPer1M: 10 },
  );
  assert.equal(cost, 2.5);
});

test('입력과 출력 단가를 따로 적용한다', () => {
  const cost = estimateCostUsd(
    { inputTokens: 1_000_000, outputTokens: 1_000_000 },
    { inputPer1M: 2.5, outputPer1M: 10 },
  );
  assert.equal(cost, 12.5);
});

// ─── 예산 추적 ───

test('처음에는 사용량이 0이다', () => withTempFile((f) => {
  const b = tracker(f);
  const snap = b.snapshot();

  assert.equal(snap.calls.used, 0);
  assert.equal(snap.calls.limit, 50);
  assert.equal(snap.cost.usedUsd, 0);
  assert.equal(snap.cost.limitUsd, 10);
}));

test('기록하면 호출 수와 비용이 함께 누적된다', () => withTempFile((f) => {
  const b = tracker(f);
  b.record({ costUsd: 0.25 });
  b.record({ costUsd: 0.25 });

  const snap = b.snapshot();
  assert.equal(snap.calls.used, 2);
  assert.equal(snap.cost.usedUsd, 0.5);
  assert.equal(snap.cost.remainingUsd, 9.5);
}));

test('일일 호출 한도에 도달하면 거부한다', () => withTempFile((f) => {
  const b = tracker(f, { dailyCallLimit: 2 });
  b.record({ costUsd: 0.01 });
  b.record({ costUsd: 0.01 });

  const verdict = b.canSpend(0.01);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'DAILY_CALL_LIMIT');
}));

test('비용 상한을 넘길 요청은 호출 전에 거부한다', () => withTempFile((f) => {
  const b = tracker(f, { monthlyCostLimitUsd: 1 });
  b.record({ costUsd: 0.9 });

  // 추정 비용을 더하면 상한을 넘는다. 넘긴 뒤가 아니라 넘기기 전에 막아야 한다.
  const verdict = b.canSpend(0.2);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'COST_LIMIT');

  assert.equal(b.canSpend(0.05).ok, true, '상한 안쪽 요청까지 막으면 안 된다');
}));

test('날짜가 바뀌면 호출 수만 초기화되고 비용은 유지된다', () => withTempFile((f) => {
  const clock = makeClock(Date.UTC(2026, 8, 2, 23, 0, 0));
  const b = tracker(f, { clock, dailyCallLimit: 2 });
  b.record({ costUsd: 0.5 });
  b.record({ costUsd: 0.5 });
  assert.equal(b.canSpend(0.1).ok, false);

  clock.advance(2 * 60 * 60 * 1000);   // 다음 날로 넘어간다

  const snap = b.snapshot();
  assert.equal(snap.calls.used, 0, '일일 호출 수가 초기화되지 않았다');
  assert.equal(snap.cost.usedUsd, 1, '월 비용이 날짜 변경으로 초기화되었다');
  assert.equal(b.canSpend(0.1).ok, true);
}));

test('달이 바뀌면 비용도 초기화된다', () => withTempFile((f) => {
  const clock = makeClock(Date.UTC(2026, 8, 30, 12, 0, 0));
  const b = tracker(f, { clock, monthlyCostLimitUsd: 1 });
  b.record({ costUsd: 0.95 });
  assert.equal(b.canSpend(0.1).ok, false);

  clock.advance(3 * 24 * 60 * 60 * 1000);   // 10월로 넘어간다

  assert.equal(b.snapshot().cost.usedUsd, 0);
  assert.equal(b.canSpend(0.1).ok, true);
}));

test('예산 상태가 파일에 저장되어 재시작 후에도 유지된다', () => withTempFile((f) => {
  // 메모리에만 두면 재시작이 곧 예산 리셋이 되어 상한이 무의미해진다.
  const clock = makeClock(Date.UTC(2026, 8, 2, 10, 0, 0));
  const first = tracker(f, { clock });
  first.record({ costUsd: 3.5 });

  const restarted = tracker(f, { clock });
  const snap = restarted.snapshot();

  assert.equal(snap.cost.usedUsd, 3.5, '재시작 후 비용이 초기화되었다');
  assert.equal(snap.calls.used, 1);
}));

test('저장 파일이 깨져 있으면 0에서 시작하되 예외를 던지지 않는다', () => withTempFile((f) => {
  writeFileSync(f, '깨진 JSON {', 'utf8');

  const b = tracker(f);
  assert.equal(b.snapshot().cost.usedUsd, 0);
}));

test('한도를 0으로 두면 모든 호출을 막는다', () => withTempFile((f) => {
  const b = tracker(f, { monthlyCostLimitUsd: 0 });
  assert.equal(b.canSpend(0.0001).ok, false);
}));

// ─── 엔드포인트 통합 ───

const article = (over = {}) => ({
  title: '엔비디아 3분기 실적 발표',
  content: '데이터센터 부문 매출이 전년 대비 크게 증가했다고 발표했다.',
  source: '연합뉴스',
  url: 'https://example.com/article/1',
  publishedAt: '2026-08-30T09:00:00Z',
  ...over,
});

const body = (over = {}) => ({ newsList: [article()], ...over });

const validReport = () => JSON.stringify({
  summary: '요약',
  newsBriefing: [{
    sourceId: 'S1', title: '제목', source: '연합뉴스',
    publishedAt: '2026-08-30T09:00:00.000Z', keyPoints: '핵심',
    marketImplication: '의미', needsVerification: '확인 필요',
  }],
  trendAnalysis: '동향 분석',
  scenarios: [{
    type: '기본 시나리오', premise: '전제', indicatorsToWatch: '지표',
    possibleDirection: '방향', invalidationCondition: '무효화 조건', cautions: '주의',
  }],
  risks: ['리스크'],
  monitoringIndicators: ['지표'],
  disclaimer: '투자 권유가 아닙니다.',
});

const setupApp = (over = {}) => withTempFileSync((budgetFile) => {
  const llm = over.llm ?? makeMockLlm(() => ({ content: validReport(), model: 'mock' }));
  const ctx = bootstrap({
    clock: over.clock ?? makeClock(),
    llm,
    env: { BUDGET_FILE: budgetFile, ...over.env },
  });
  return { ...ctx, llm, budgetFile };
});

// 엔드포인트 테스트는 파일을 테스트 종료까지 유지해야 해서 별도 헬퍼를 쓴다.
const tempDirs = [];
function withTempFileSync(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'budget-app-'));
  tempDirs.push(dir);
  return fn(join(dir, 'budget.json'));
}
process.on('exit', () => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

const login = async (app) => {
  const res = await request(app).post('/api/auth/login').send({ password: TEST_PASSWORD });
  return res.body.token;
};

test('estimate는 예상 비용과 남은 예산, 확인 토큰을 돌려준다', async () => {
  const { app } = setupApp();
  const token = await login(app);

  const res = await request(app).post('/api/analyze/estimate')
    .set('Authorization', `Bearer ${token}`).send(body());

  assert.equal(res.status, 200);
  assert.ok(res.body.estimatedInputTokens > 0);
  assert.equal(typeof res.body.estimatedCostUsd, 'number');
  assert.equal(res.body.cached, false);
  assert.equal(res.body.budget.calls.used, 0);
  assert.ok(res.body.confirmToken, '확인 토큰이 없다');
});

test('estimate는 LLM을 호출하지 않는다', async () => {
  const { app, llm } = setupApp();
  const token = await login(app);

  await request(app).post('/api/analyze/estimate')
    .set('Authorization', `Bearer ${token}`).send(body());

  assert.equal(llm.calls.length, 0, '견적 단계에서 비용이 발생했다');
});

test('확인 토큰 없이 분석하면 428을 반환하고 LLM을 호출하지 않는다', async () => {
  const { app, llm } = setupApp();
  const token = await login(app);

  const res = await request(app).post('/api/analyze/news')
    .set('Authorization', `Bearer ${token}`).send(body());

  assert.equal(res.status, 428);
  assert.equal(res.body.error.code, 'CONFIRMATION_REQUIRED');
  assert.equal(llm.calls.length, 0);
});

test('확인 토큰을 붙이면 분석이 실행되고 예산이 차감된다', async () => {
  const { app, llm } = setupApp();
  const token = await login(app);

  const est = await request(app).post('/api/analyze/estimate')
    .set('Authorization', `Bearer ${token}`).send(body());

  const res = await request(app).post('/api/analyze/news')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Confirm-Token', est.body.confirmToken)
    .send(body());

  assert.equal(res.status, 200);
  assert.equal(llm.calls.length, 1);
  assert.equal(res.body.meta.budget.calls.used, 1);
  assert.ok(res.body.meta.actualCostUsd >= 0);
});

test('확인 토큰은 한 번만 쓸 수 있다', async () => {
  const { app } = setupApp();
  const token = await login(app);

  const est = await request(app).post('/api/analyze/estimate')
    .set('Authorization', `Bearer ${token}`).send(body());
  const confirm = est.body.confirmToken;

  const first = await request(app).post('/api/analyze/news')
    .set('Authorization', `Bearer ${token}`).set('X-Confirm-Token', confirm).send(body());
  assert.equal(first.status, 200);

  // 두 번째는 캐시 히트라 통과할 수 있으니, 캐시를 피하려 다른 본문으로 재사용을 시도한다.
  const reuse = await request(app).post('/api/analyze/news')
    .set('Authorization', `Bearer ${token}`).set('X-Confirm-Token', confirm)
    .send(body({ newsList: [article({ title: '다른 기사' })] }));

  assert.equal(reuse.status, 428, '소비된 토큰이 재사용되었다');
});

test('다른 요청 내용으로는 확인 토큰을 쓸 수 없다', async () => {
  const { app, llm } = setupApp();
  const token = await login(app);

  const est = await request(app).post('/api/analyze/estimate')
    .set('Authorization', `Bearer ${token}`).send(body());

  // 견적은 기사 1개로 받고, 실제로는 훨씬 큰 요청을 보내는 시도.
  const res = await request(app).post('/api/analyze/news')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Confirm-Token', est.body.confirmToken)
    .send(body({
      newsList: Array.from({ length: 10 }, (_, i) =>
        article({ title: `기사 ${i}`, url: `https://example.com/a/${i}` })),
    }));

  assert.equal(res.status, 428, '견적과 다른 요청이 통과했다');
  assert.equal(llm.calls.length, 0);
});

test('다른 세션의 확인 토큰은 쓸 수 없다', async () => {
  const { app } = setupApp();
  const tokenA = await login(app);
  const tokenB = await login(app);

  const est = await request(app).post('/api/analyze/estimate')
    .set('Authorization', `Bearer ${tokenA}`).send(body());

  const res = await request(app).post('/api/analyze/news')
    .set('Authorization', `Bearer ${tokenB}`)
    .set('X-Confirm-Token', est.body.confirmToken)
    .send(body());

  assert.equal(res.status, 428);
});

test('캐시 히트는 확인 토큰 없이도 통과하고 예산을 쓰지 않는다', async () => {
  const { app, llm } = setupApp();
  const token = await login(app);

  const est = await request(app).post('/api/analyze/estimate')
    .set('Authorization', `Bearer ${token}`).send(body());
  const first = await request(app).post('/api/analyze/news')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Confirm-Token', est.body.confirmToken).send(body());
  assert.equal(first.status, 200);

  // 캐시된 결과는 LLM을 부르지 않으므로 비용이 0이다. 확인을 요구할 이유가 없다.
  const cached = await request(app).post('/api/analyze/news')
    .set('Authorization', `Bearer ${token}`).send(body());

  assert.equal(cached.status, 200);
  assert.equal(cached.body.meta.cached, true);
  assert.equal(llm.calls.length, 1);
  assert.equal(cached.body.meta.budget.calls.used, 1, '캐시 히트가 예산을 차감했다');
});

test('일일 호출 한도를 넘기면 estimate 단계에서 막는다', async () => {
  const { app, llm } = setupApp({ env: { DAILY_ANALYSIS_LIMIT: '1' } });
  const token = await login(app);

  const est1 = await request(app).post('/api/analyze/estimate')
    .set('Authorization', `Bearer ${token}`).send(body());
  await request(app).post('/api/analyze/news')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Confirm-Token', est1.body.confirmToken).send(body());

  const est2 = await request(app).post('/api/analyze/estimate')
    .set('Authorization', `Bearer ${token}`)
    .send(body({ newsList: [article({ title: '두 번째' })] }));

  assert.equal(est2.status, 429);
  assert.equal(est2.body.error.code, 'BUDGET_EXCEEDED');
  assert.equal(llm.calls.length, 1, '한도를 넘겼는데 LLM이 호출되었다');
});

test('비용 상한을 넘기면 막는다', async () => {
  const { app, llm } = setupApp({ env: { MONTHLY_COST_LIMIT_USD: '0' } });
  const token = await login(app);

  const res = await request(app).post('/api/analyze/estimate')
    .set('Authorization', `Bearer ${token}`).send(body());

  assert.equal(res.status, 429);
  assert.equal(res.body.error.code, 'BUDGET_EXCEEDED');
  assert.equal(llm.calls.length, 0);
});

test('예산 상태를 조회할 수 있다', async () => {
  const { app } = setupApp();
  const token = await login(app);

  const res = await request(app).get('/api/budget').set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.calls.used, 0);
  assert.equal(typeof res.body.cost.limitUsd, 'number');
  assert.ok(res.body.calls.resetsAt);
});

test('예산 조회에도 인증이 필요하다', async () => {
  const { app } = setupApp();
  const res = await request(app).get('/api/budget');
  assert.equal(res.status, 403);
});

test('예산 사용량이 파일에 기록된다', async () => {
  const { app, budgetFile } = setupApp();
  const token = await login(app);

  const est = await request(app).post('/api/analyze/estimate')
    .set('Authorization', `Bearer ${token}`).send(body());
  await request(app).post('/api/analyze/news')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Confirm-Token', est.body.confirmToken).send(body());

  const saved = JSON.parse(readFileSync(budgetFile, 'utf8'));
  assert.equal(saved.dailyCalls, 1);
  assert.ok(saved.monthlyCostUsd >= 0);
});
