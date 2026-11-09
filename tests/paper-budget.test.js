import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitSections, PARTIAL_MARK, PAPER_BODY_TOKENS } from '../lib/modes/paper-budget.js';

// estimateTokens는 글자 수 / 4(올림)다. 4,000자 = 1,000토큰.
const sec = (id, tokens) => ({ id, anchor: id, heading: `${id} heading`, text: 'a'.repeat(tokens * 4) });

test('기본 예산은 25,000토큰이다', () => {
  assert.equal(PAPER_BODY_TOKENS, 25_000);
});

test('예산 안이면 그대로 둔다', () => {
  const input = [sec('S0', 100), sec('S1', 1000), sec('S2', 1000)];
  const r = fitSections(input, { maxTokens: 5000 });
  assert.deepEqual(r.sections, input);
  assert.deepEqual(r.truncated, []);
  assert.deepEqual(r.outline.map((o) => [o.id, o.tokens, o.status]), [['S0', 100, 'full'], ['S1', 1000, 'full'], ['S2', 1000, 'full']]);
});

test('남은 예산이 2,000토큰 이상이면 넘치는 장의 앞부분만 담고 뒤 장은 뺀다', () => {
  const r = fitSections([sec('S0', 100), sec('S1', 1000), sec('S2', 5000), sec('S3', 500)], { maxTokens: 4000 });
  assert.deepEqual(r.sections.map((s) => s.id), ['S0', 'S1', 'S2']);
  const partial = r.sections[2];
  assert.ok(partial.text.endsWith(PARTIAL_MARK));
  assert.equal(partial.text.length, (4000 - 1100) * 4);
  assert.deepEqual(r.truncated, [
    { id: 'S2', heading: 'S2 heading', partial: true },
    { id: 'S3', heading: 'S3 heading', partial: false },
  ]);
  assert.deepEqual(r.outline.map((o) => o.status), ['full', 'full', 'partial', 'dropped']);
});

test('남은 예산이 2,000토큰 미만이면 넘치는 장부터 모두 뺀다', () => {
  const r = fitSections([sec('S0', 100), sec('S1', 3000), sec('S2', 3000), sec('S3', 10)], { maxTokens: 4000 });
  assert.deepEqual(r.sections.map((s) => s.id), ['S0', 'S1']);
  assert.deepEqual(r.truncated.map((t) => [t.id, t.partial]), [['S2', false], ['S3', false]]);
});

test('초록(S0)은 예산과 무관하게 담는다', () => {
  const r = fitSections([sec('S0', 3000), sec('S1', 3000)], { maxTokens: 2500 });
  assert.deepEqual(r.sections.map((s) => s.id), ['S0']);
  assert.deepEqual(r.truncated.map((t) => t.id), ['S1']);
});

test('입력 배열과 장 객체를 바꾸지 않는다', () => {
  const input = [sec('S0', 100), sec('S1', 5000)];
  const before = JSON.stringify(input);
  fitSections(input, { maxTokens: 3000 });
  assert.equal(JSON.stringify(input), before);
});
