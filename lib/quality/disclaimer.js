import { DISCLAIMER } from '../prompt.js';
import { issue } from './walk.js';

/** 면책 문구는 모델이 쓴 문장을 믿지 않고 고정 문구로 둔다. */
export function checkDisclaimer(analysis) {
  if (analysis.disclaimer === DISCLAIMER) return { analysis, issues: [] };
  return {
    analysis: { ...analysis, disclaimer: DISCLAIMER },
    issues: [issue('disclaimer', 'fixed', '면책 문구를 표준 문구로 바로잡았습니다.', 'disclaimer')],
  };
}
