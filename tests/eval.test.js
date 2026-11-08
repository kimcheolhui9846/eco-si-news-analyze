import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCases, evaluateCase } from '../eval/run.js';

const cases = loadCases();

test('평가 세트에 케이스가 13개 이상 있다', () => {
  assert.ok(cases.length >= 13, `케이스 ${cases.length}개`);
});

for (const c of cases) {
  test(`eval: ${c.name}`, () => {
    const result = evaluateCase(c);
    assert.deepEqual(result.failures, [], `${c.file}: ${result.failures.join('; ')}`);
  });
}
