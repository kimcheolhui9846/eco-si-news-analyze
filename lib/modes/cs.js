import { ApiError } from '../errors.js';
import { normalizeNewsList } from '../normalize.js';
import { buildCsAnalyzeSchema } from '../validation.js';
import { buildSources } from '../postprocess.js';
import { CS_CHECKS, buildCsQualityContext } from '../quality/cs.js';
import { CS_SYSTEM_PROMPT, buildCsUserPrompt } from './cs-prompt.js';
import { CS_JSON_SCHEMA, CS_MOCK_REPORT } from './cs-schema.js';

// ─── CS 기술 동향 프로필 ───

export const MIN_CS_ITEMS = 3;

const SITE_NAME = Object.freeze({ hackernews: 'Hacker News', lobsters: 'Lobsters' });

/** 출처 ID는 종류별로 받은 순서대로 붙인다. 수집과 분석이 같은 배열을 보므로 같은 ID가 나온다. */
const withIds = (prefix, list = []) => list.map((item, i) => ({ sourceId: `${prefix}${i + 1}`, ...item }));

const sourceOf = (list, type, collectedAt, map) =>
  list.map((item) => ({ sourceId: item.sourceId, ...map(item), collectedAt, type, relevance: 0 }));

export const csProfile = Object.freeze({
  mode: 'cs',
  buildAnalyzeSchema: buildCsAnalyzeSchema,
  systemPrompt: CS_SYSTEM_PROMPT,
  jsonSchema: CS_JSON_SCHEMA,
  checks: CS_CHECKS,
  mockReport: CS_MOCK_REPORT,

  normalize(data) {
    const news = data.newsList?.length
      ? normalizeNewsList(data.newsList)
      : { items: [], duplicatesRemoved: 0 };
    const n = {
      papers: withIds('P', data.papers),
      community: withIds('H', data.community),
      questions: withIds('Q', data.questions),
      news: news.items,
      blogs: withIds('B', data.blogs),
      repos: withIds('G', data.repos),
      duplicatesRemoved: news.duplicatesRemoved,
    };
    n.total = n.papers.length + n.community.length + n.questions.length + n.news.length + n.blogs.length + n.repos.length;

    if (n.total < MIN_CS_ITEMS) {
      throw new ApiError(422, 'INSUFFICIENT_DATA', 'CS 동향 분석에는 자료가 3건 이상 필요합니다.');
    }
    return n;
  },

  buildUserPrompt: (n, { collectedAt }) => buildCsUserPrompt(n, { collectedAt }),

  // 모드가 다르면 같은 자료라도 다른 보고서다. 확인 토큰이 모드를 넘나들지 못한다.
  hashInput: (n) => ({
    mode: 'cs', papers: n.papers, community: n.community, questions: n.questions, news: n.news, blogs: n.blogs, repos: n.repos,
  }),

  buildSources(n, collectedAt) {
    return [
      ...sourceOf(n.papers, 'paper', collectedAt, (p) => ({
        title: p.title, source: p.category ? `arXiv (${p.category})` : 'arXiv', url: p.url, publishedAt: p.publishedAt,
      })),
      // 커뮤니티 출처는 토론 페이지로 연결한다. 원문 링크는 글 자체가 가리킨다.
      ...sourceOf(n.community, 'community', collectedAt, (h) => ({
        title: h.title, source: SITE_NAME[h.site], url: h.discussionUrl, publishedAt: h.publishedAt,
      })),
      // Stack Overflow 글은 CC BY-SA다. 출처 이름에 작성자와 라이선스를 싣는다.
      ...sourceOf(n.questions, 'question', collectedAt, (q) => ({
        title: q.title,
        source: `Stack Overflow · ${q.author || '작성자 미상'} · CC BY-SA`,
        url: q.url,
        publishedAt: q.publishedAt,
      })),
      ...buildSources(n.news, collectedAt),
      ...sourceOf(n.blogs, 'blog', collectedAt, (b) => ({
        title: b.title, source: b.blog, url: b.url, publishedAt: b.publishedAt,
      })),
      ...sourceOf(n.repos, 'repo', collectedAt, (g) => ({
        title: g.fullName, source: 'GitHub', url: g.url, publishedAt: g.pushedAt,
      })),
    ];
  },

  urlWhitelist(n) {
    const urls = new Set();
    for (const list of [n.papers, n.questions, n.news, n.blogs, n.repos]) {
      for (const item of list) if (item.url) urls.add(item.url);
    }
    for (const h of n.community) {
      urls.add(h.url);
      urls.add(h.discussionUrl);
    }
    return urls;
  },

  qualityContext: (n, sources) => buildCsQualityContext(sources),

  baseMeta: (n) => ({
    sourceCount: n.total,
    duplicatesRemoved: n.duplicatesRemoved,
    counts: {
      papers: n.papers.length,
      community: n.community.length,
      questions: n.questions.length,
      news: n.news.length,
      blogs: n.blogs.length,
      repos: n.repos.length,
    },
  }),
});
