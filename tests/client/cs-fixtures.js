// CS 화면 테스트 공용 자료. 테스트 파일끼리 import하면 테스트가 두 번 돈다. 여기 둔다.

export const BUDGET = {
  calls: { used: 0, limit: 50, remaining: 50, resetsAt: '2026-11-10T00:00:00.000Z' },
  cost: { usedUsd: 0, limitUsd: 5, remainingUsd: 5, resetsAt: '2026-12-01T00:00:00.000Z' },
};

export const CS_COLLECT = {
  mode: 'cs',
  papers: [{
    title: 'Sparse MoE for retrieval', abstract: 'We study retrieval.', authors: ['A. Kim'], authorCount: 3,
    venue: 'arXiv (cs.CL)', doi: null, url: 'https://arxiv.org/abs/2611.00001',
    publishedAt: '2026-11-02T00:00:00.000Z', datePrecision: 'day', peerReviewed: 'preprint',
    sourceName: 'arXiv', language: 'en', category: 'cs.CL',
  }],
  community: [{
    site: 'hackernews',
    title: 'Show HN: tiny RAG', url: 'https://github.com/example/tiny-rag',
    discussionUrl: 'https://news.ycombinator.com/item?id=1', points: 312, numComments: 87,
    publishedAt: '2026-11-05T08:00:00.000Z', text: '',
  }, {
    site: 'lobsters', title: 'Retrieval for code search', url: 'https://example.com/code-search',
    discussionUrl: 'https://lobste.rs/s/def456/retrieval', points: 40, numComments: 12,
    publishedAt: '2026-11-01T14:00:00.000Z', text: '',
  }],
  questions: [{
    title: 'RAG retriever returns irrelevant chunks',
    url: 'https://stackoverflow.com/questions/79923286/rag-retriever',
    author: 'devops', tags: ['python', 'rag'], score: 7, answerCount: 0,
    isAnswered: false, hasAcceptedAnswer: false, viewCount: 605,
    publishedAt: '2026-10-20T00:00:00.000Z', text: 'My retriever returns unrelated chunks.',
  }],
  newsList: [],
  blogs: [{
    title: 'Hybrid search for better RAG', url: 'https://toss.tech/article/hybrid-rag',
    blog: '토스 기술 블로그', summary: 'BM25 and dense.', publishedAt: '2026-10-27T07:05:00.000Z',
  }],
  repos: [],
  collected: {
    collectedAt: '2026-11-09T00:00:00.000Z',
    included: ['papers', 'community', 'questions', 'news', 'blogs', 'repos'],
    degraded: [{ provider: 'repos', source: 'GitHub', reason: 'GitHub 검색 한도를 넘었습니다.' }],
    counts: { papers: 1, community: 2, questions: 1, news: 0, blogs: 1, repos: 0 }, total: 3, duplicatesRemoved: 0,
  },
  estimate: { estimatedInputTokens: 900, estimatedCostUsd: 0.0123, budget: BUDGET },
  confirmToken: 'ct_cs',
};
