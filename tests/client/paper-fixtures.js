export const PAPER = {
  id: '2611.00001',
  title: 'Tiny MoE Retrieval',
  authors: ['Ada Lovelace', 'Alan Turing'],
  url: 'https://arxiv.org/abs/2611.00001',
  htmlUrl: 'https://arxiv.org/html/2611.00001',
  sections: [
    { id: 'S0', anchor: 'abstract1', heading: 'Abstract', text: 'We introduce TinyMoE. It reaches 85.3% recall@10.' },
    { id: 'S1', anchor: 'S1', heading: '1 Introduction', text: 'Dense retrievers are costly.' },
    { id: 'S2', anchor: 'S2', heading: '2 Method', text: 'A linear router with 1,024 hidden units.' },
    { id: 'S3', anchor: 'S3', heading: '3 Experiments', text: 'BM25\t71.2\nTinyMoE\t$85.3$\n…(길이 제한으로 이하 생략)' },
  ],
  truncated: [
    { id: 'S3', heading: '3 Experiments', partial: true },
    { id: 'S4', heading: 'Acknowledgements', partial: false },
  ],
};

export const PAPER_COLLECT = {
  requestId: 'r1',
  mode: 'paper',
  paper: PAPER,
  collected: {
    collectedAt: '2026-11-09T00:00:00.000Z',
    outline: [
      { id: 'S0', heading: 'Abstract', tokens: 20, status: 'full' },
      { id: 'S1', heading: '1 Introduction', tokens: 1200, status: 'full' },
      { id: 'S2', heading: '2 Method', tokens: 3400, status: 'full' },
      { id: 'S3', heading: '3 Experiments', tokens: 30000, status: 'partial' },
      { id: 'S4', heading: 'Acknowledgements', tokens: 60, status: 'dropped' },
    ],
    sectionCount: 4,
    truncatedCount: 2,
  },
  estimate: {
    estimatedInputTokens: 26000, assumedOutputTokens: 3000, estimatedCostUsd: 0.095,
    budget: { calls: { used: 1, limit: 20, remaining: 19 }, cost: { usedUsd: 0.02, limitUsd: 5, remainingUsd: 4.98 } },
  },
  confirmToken: 'ct_paper',
};

export const PAPER_REPORT = {
  analysis: {
    summary: 'TinyMoE는 희소 검색기다 [S0].',
    problem: { statement: '밀집 검색은 비싸다.', sourceIds: ['S1'] },
    method: { overview: '선형 라우터', keyIdeas: ['전문가 2개만 쓴다'], sourceIds: ['S2'] },
    experimentalSetup: { datasets: ['BEIR'], baselines: ['BM25'], metrics: ['Recall@10'], sourceIds: ['S3'] },
    keyResults: [{ claim: 'BM25보다 재현율이 높다', numbers: ['85.3', '71.2'], sourceIds: ['S3'] }],
    authorStatedLimitations: [{ point: '영어 데이터만 썼다', sourceIds: ['S3'] }],
    reviewerConcerns: [{ concern: '데이터셋이 하나뿐', why: '일반화 근거 부족', severity: '중요', sourceIds: ['S3'] }],
    reproducibility: { code: '언급 없음', data: '공개', note: 'BEIR는 공개 데이터셋', sourceIds: ['S3'] },
    openQuestions: ['다른 도메인에서도 유지되는가?'],
  },
  sources: PAPER.sections.map((s) => ({
    sourceId: s.id, title: s.heading, source: 'arXiv 2611.00001', url: `${PAPER.htmlUrl}#${s.anchor}`,
    publishedAt: null, collectedAt: '2026-11-09T00:00:00.000Z', type: 'section', relevance: 0,
  })),
  meta: {
    quality: { score: 95, fixed: 0, warnings: 1, issues: [{ check: 'coverage', severity: 'warning', message: '본문 2개 장이 길이 제한으로 분석에서 빠지거나 잘렸습니다.', path: '' }], limited: false },
    degraded: false,
    collectedAt: '2026-11-09T00:00:00.000Z',
    sourceCount: 4,
    paper: { id: '2611.00001', title: 'Tiny MoE Retrieval' },
    truncated: PAPER.truncated,
  },
};
