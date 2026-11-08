import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDisclaimer } from '../lib/quality/disclaimer.js';
import { DISCLAIMER, SYSTEM_PROMPT } from '../lib/prompt.js';

test('시스템 프롬프트는 DISCLAIMER 상수로 끝난다', () => {
  assert.ok(SYSTEM_PROMPT.endsWith(DISCLAIMER));
  assert.ok(DISCLAIMER.includes('투자 권유가 아닙니다'));
});

test('표준 문구면 그대로 둔다', () => {
  const input = { disclaimer: DISCLAIMER };
  const { analysis, issues } = checkDisclaimer(input);
  assert.equal(analysis, input);
  assert.deepEqual(issues, []);
});

test('다른 문구나 누락은 표준 문구로 교정한다', () => {
  for (const input of [{ disclaimer: '투자 판단은 본인 책임' }, {}]) {
    const { analysis, issues } = checkDisclaimer(input);
    assert.equal(analysis.disclaimer, DISCLAIMER);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].check, 'disclaimer');
    assert.equal(issues[0].severity, 'fixed');
  }
});
