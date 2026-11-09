// CS 모드 테스트 자료. 분석 스키마를 만족하는 최소 항목들이다.

export const paper = (i = 1, over = {}) => ({
  title: `Paper ${i} on retrieval`,
  abstract: `Abstract ${i}. We study retrieval.`,
  authors: ['A. Kim'],
  authorCount: 1,
  venue: 'arXiv (cs.CL)',
  doi: null,
  url: `https://arxiv.org/abs/2611.0000${i}`,
  publishedAt: `2026-11-0${i}T00:00:00.000Z`,
  datePrecision: 'day',
  peerReviewed: 'preprint',
  sourceName: 'arXiv',
  language: 'en',
  category: 'cs.CL',
  ...over,
});

export const hn = (over = {}) => ({
  site: 'hackernews',
  title: 'Show HN: A tiny RAG server',
  url: 'https://github.com/example/tiny-rag',
  discussionUrl: 'https://news.ycombinator.com/item?id=45810001',
  points: 312,
  numComments: 87,
  publishedAt: '2026-11-05T08:00:00.000Z',
  text: '',
  ...over,
});

export const lobsters = (over = {}) => ({
  site: 'lobsters',
  title: 'Retrieval for code search',
  url: 'https://example.com/code-search',
  discussionUrl: 'https://lobste.rs/s/def456/retrieval_for_code_search',
  points: 40,
  numComments: 12,
  publishedAt: '2026-11-01T14:00:00.000Z',
  text: '',
  ...over,
});

export const question = (over = {}) => ({
  title: 'RAG retriever returns irrelevant chunks',
  url: 'https://stackoverflow.com/questions/79923286/rag-retriever-returns-irrelevant-chunks',
  author: 'devops',
  tags: ['python', 'rag'],
  score: 7,
  answerCount: 2,
  isAnswered: true,
  hasAcceptedAnswer: true,
  viewCount: 605,
  publishedAt: '2026-10-20T00:00:00.000Z',
  text: 'My retriever returns unrelated chunks.',
  ...over,
});

export const newsItem = (over = {}) => ({
  title: 'RAG 도입 기업 늘어',
  content: '기업들이 검색 증강 생성을 도입하고 있다.',
  source: '전자신문',
  url: 'https://example.com/news/1',
  publishedAt: '2026-11-04T01:00:00.000Z',
  ...over,
});

export const blog = (over = {}) => ({
  title: 'Hybrid search for better RAG',
  url: 'https://toss.tech/article/hybrid-rag',
  blog: '토스 기술 블로그',
  summary: 'BM25 and dense retrieval.',
  publishedAt: '2026-10-27T07:05:00.000Z',
  ...over,
});

export const repo = (over = {}) => ({
  fullName: 'example/tiny-rag',
  url: 'https://github.com/example/tiny-rag',
  description: 'A tiny RAG server',
  stars: 1520,
  language: 'Python',
  license: 'MIT',
  pushedAt: '2026-11-06T00:00:00.000Z',
  createdAt: '2026-10-20T00:00:00.000Z',
  ...over,
});

/** 출처 6건: P1, P2, H1, S1, B1, G1. mode는 넣지 않는다(라우트 테스트가 붙인다). */
export const csData = (over = {}) => ({
  papers: [paper(1), paper(2)],
  community: [hn()],
  newsList: [newsItem()],
  blogs: [blog()],
  repos: [repo()],
  ...over,
});
