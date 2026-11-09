import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { assessQuality, CHECKS } from '../lib/quality/index.js';
import { CS_CHECKS } from '../lib/quality/cs.js';

// ─── 오프라인 품질 평가 ───
//
// LLM을 부르지 않는다. 고정된 응답 샘플에 품질 게이트를 돌려 기대와 대조한다.

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const NO_DATA = { financial: false, research: false, experiments: false };

export function loadCases(dir = join(ROOT, 'cases')) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({ file, ...readJson(join(dir, file)) }));
}

export function resolveCase(c) {
  const baseContext = typeof c.context === 'string'
    ? readJson(join(ROOT, 'contexts', `${c.context}.json`))
    : (c.context ?? {});
  const ctx = { ...baseContext, ...(c.contextOverride ?? {}) };
  const baseResponse = c.base ? readJson(join(ROOT, 'responses', `${c.base}.json`)) : c.response;
  const sources = new Map(Object.entries(ctx.sources ?? {}));
  const cs = c.mode === 'cs';
  return {
    // CS 검사는 출처와 수집 합계만 본다.
    context: cs
      ? { sources, total: ctx.total ?? sources.size }
      : {
          sources,
          instruments: ctx.instruments ?? [],
          sector: ctx.sector,
          has: { ...NO_DATA, ...(ctx.has ?? {}) },
        },
    response: { ...baseResponse, ...(c.override ?? {}) },
    degraded: Boolean(c.degraded),
    checks: cs ? CS_CHECKS : CHECKS,
  };
}

export function evaluateCase(c) {
  const { context, response, degraded, checks } = resolveCase(c);
  const { quality } = assessQuality(response, context, { degraded, checks });
  const expect = c.expect ?? {};
  const hit = (check, severity) =>
    quality.issues.some((i) => i.check === check && (!severity || i.severity === severity));

  const failures = [];
  if (expect.minScore !== undefined && quality.score < expect.minScore) {
    failures.push(`점수 ${quality.score}가 최소 ${expect.minScore}보다 낮다`);
  }
  if (expect.maxScore !== undefined && quality.score > expect.maxScore) {
    failures.push(`점수 ${quality.score}가 최대 ${expect.maxScore}보다 높다`);
  }
  for (const check of expect.mustFix ?? []) if (!hit(check, 'fixed')) failures.push(`${check} 교정이 없다`);
  for (const check of expect.mustWarn ?? []) if (!hit(check, 'warning')) failures.push(`${check} 경고가 없다`);
  for (const check of expect.mustNotFlag ?? []) if (hit(check)) failures.push(`${check}가 걸리면 안 된다`);

  return { name: c.name, file: c.file, quality, failures, pass: failures.length === 0 };
}

function main() {
  const results = loadCases().map(evaluateCase);
  const byCheck = new Map();
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${String(r.quality.score).padStart(3)}  ${r.name}`);
    for (const f of r.failures) console.log(`        - ${f}`);
    for (const i of r.quality.issues) {
      const row = byCheck.get(i.check) ?? { fixed: 0, warning: 0 };
      row[i.severity] += 1;
      byCheck.set(i.check, row);
    }
  }
  console.log('\n검사기별 적중');
  for (const [check, row] of [...byCheck].sort()) {
    console.log(`  ${check.padEnd(18)} 교정 ${row.fixed}  경고 ${row.warning}`);
  }
  const avg = results.reduce((s, r) => s + r.quality.score, 0) / (results.length || 1);
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n케이스 ${results.length}개 · 실패 ${failed}개 · 평균 점수 ${avg.toFixed(1)}`);
  if (failed > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
