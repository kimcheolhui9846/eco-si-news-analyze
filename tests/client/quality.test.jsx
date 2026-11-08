import 'global-jsdom/register';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup } from '@testing-library/react';
import QualityBadge from '../../client/src/components/QualityBadge.jsx';
import InstrumentInsight from '../../client/src/components/InstrumentInsight.jsx';

afterEach(cleanup);

test('이슈가 없으면 자동 검증 통과만 보인다', () => {
  render(<QualityBadge quality={{ score: 100, fixed: 0, warnings: 0, issues: [], limited: false }} />);
  assert.ok(screen.getByText('자동 검증 통과'));
});

test('이슈가 있으면 점수·건수와 항목별 표시를 보인다', () => {
  render(<QualityBadge quality={{
    score: 85, fixed: 1, warnings: 1, limited: false,
    issues: [
      { check: 'citations', severity: 'fixed', message: '브리핑 S1의 작성일을(를) 원본 출처 값으로 바로잡았습니다.', path: 'newsBriefing[0]' },
      { check: 'scenarios', severity: 'warning', message: '시나리오에 무효화 조건이 없습니다.', path: 'scenarios[0]' },
    ],
  }} />);
  assert.ok(screen.getByText('검증 85점 · 교정 1건 · 경고 1건'));
  assert.ok(screen.getByText('교정됨'));
  assert.ok(screen.getByText('확인 필요'));
  assert.ok(screen.getByText('시나리오에 무효화 조건이 없습니다.'));
});

test('검증이 제한되면 그 사실을 표시한다', () => {
  render(<QualityBadge quality={{
    score: 95, fixed: 0, warnings: 1, limited: true,
    issues: [{ check: 'structure', severity: 'warning', message: '구조화 응답이 아니어서 검증이 제한되었습니다.', path: '' }],
  }} />);
  assert.ok(screen.getByText('(검증 제한)'));
});

test('quality가 없으면 아무것도 그리지 않는다', () => {
  const { container } = render(<QualityBadge quality={undefined} />);
  assert.equal(container.innerHTML, '');
});

test('종목별 비교 분석을 그리고 빈 배열이면 그리지 않는다', () => {
  render(<InstrumentInsight items={[
    { symbol: 'NVDA', name: 'NVIDIA', positioning: 'AI 가속기 설계', keyDifference: '재무 자료가 가장 많다' },
  ]} />);
  assert.ok(screen.getByText('종목별 비교 분석'));
  assert.ok(screen.getByText('AI 가속기 설계'));
  assert.ok(screen.getByText('핵심 차이: 재무 자료가 가장 많다'));
  cleanup();
  const { container } = render(<InstrumentInsight items={[]} />);
  assert.equal(container.innerHTML, '');
});
