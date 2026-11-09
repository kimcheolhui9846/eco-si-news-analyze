import { estimateTokens } from '../prompt.js';

// ─── 논문 본문 예산 ───
//
// 한 번 호출로 분석한다. 앞 장부터 담고, 넘치면 뒤쪽을 자른다.
// 잘린 장은 보고서에 표시하고, 빠진 장의 ID는 프롬프트에 없으므로 인용하면 품질 검사가 지운다.

export const PAPER_BODY_TOKENS = 25_000;
export const MIN_PARTIAL_TOKENS = 2_000;
export const PARTIAL_MARK = '\n…(길이 제한으로 이하 생략)';

export function fitSections(sections, { maxTokens = PAPER_BODY_TOKENS } = {}) {
  const kept = [];
  const truncated = [];
  const outline = [];
  let used = 0;
  let stopped = false;

  for (const s of sections) {
    const tokens = estimateTokens(s.text);
    const row = { id: s.id, heading: s.heading, tokens };

    // 초록은 논문의 주장 요약이다. 항상 담는다.
    if (s.id === 'S0' || (!stopped && used + tokens <= maxTokens)) {
      kept.push(s);
      used += tokens;
      outline.push({ ...row, status: 'full' });
      continue;
    }

    const room = maxTokens - used;
    if (!stopped && room >= MIN_PARTIAL_TOKENS) {
      const chars = room * 4 - PARTIAL_MARK.length;
      kept.push({ ...s, text: s.text.slice(0, chars) + PARTIAL_MARK });
      used = maxTokens;
      truncated.push({ id: s.id, heading: s.heading, partial: true });
      outline.push({ ...row, status: 'partial' });
    } else {
      truncated.push({ id: s.id, heading: s.heading, partial: false });
      outline.push({ ...row, status: 'dropped' });
    }
    // 한 번 넘치면 뒤 장은 모두 뺀다. 중간 장만 빠진 본문은 읽기 어렵다.
    stopped = true;
  }

  return { sections: kept, truncated, outline };
}
