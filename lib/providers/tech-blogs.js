import { XMLParser } from 'fast-xml-parser';
import { parseRssFeed } from './rss.js';
import {
  CS_LIMITS, DAY_MS, clamp, cleanText, httpUrlOrNull, isoOrNull, createCachedSource,
} from './cs-common.js';

// ─── 기업·연구소 기술 블로그 ───
//
// 2026-11-09 실측(HTTP 200). NVIDIA만 Atom이고 나머지는 RSS 2.0이다.
// 기업 블로그는 공식 발표라 홍보 성격이 있다. 프롬프트가 그 점을 알린다.

export const TECH_BLOGS = Object.freeze([
  { id: 'google-research', name: 'Google Research', url: 'https://research.google/blog/rss/' },
  { id: 'deepmind', name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml' },
  { id: 'openai', name: 'OpenAI', url: 'https://openai.com/news/rss.xml' },
  { id: 'huggingface', name: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml' },
  { id: 'msr', name: 'Microsoft Research', url: 'https://www.microsoft.com/en-us/research/feed/' },
  { id: 'nvidia', name: 'NVIDIA Developer', url: 'https://developer.nvidia.com/blog/feed/' },
  { id: 'aws-ml', name: 'AWS Machine Learning', url: 'https://aws.amazon.com/blogs/machine-learning/feed/' },
  { id: 'meta-eng', name: 'Meta Engineering', url: 'https://engineering.fb.com/feed/' },
  { id: 'bair', name: 'BAIR', url: 'https://bair.berkeley.edu/blog/feed.xml' },
  { id: 'toss', name: '토스 기술 블로그', url: 'https://toss.tech/rss.xml' },
]);

export const BLOG_WINDOW_DAYS = 60;

const atomParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });

const asArray = (v) => {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
};
const text = (node) => {
  if (node === undefined || node === null) return '';
  if (typeof node === 'object') return String(node['#text'] ?? '');
  return String(node);
};

function parseAtom(xml) {
  let doc;
  try {
    doc = atomParser.parse(xml);
  } catch {
    return [];
  }
  return asArray(doc?.feed?.entry).map((e) => {
    const links = asArray(e.link);
    const link = links.find((l) => l?.['@_rel'] === 'alternate')
      ?? links.find((l) => l && !l['@_rel'])
      ?? links[0];
    return {
      title: cleanText(text(e.title)),
      url: httpUrlOrNull(link?.['@_href']),
      summary: cleanText(text(e.summary) || text(e.content)),
      publishedAt: isoOrNull(text(e.published) || text(e.updated)),
    };
  });
}

/** RSS를 먼저 읽고, 항목이 없으면 Atom으로 읽는다. */
export function parseBlogFeed(xml, blog) {
  const rss = parseRssFeed(xml, { name: blog.name, contentKind: 'summary' });
  const entries = rss.length > 0
    ? rss.map((i) => ({
        title: i.title,
        url: i.url,
        // 본문이 없으면 parseRssFeed가 제목을 본문 자리에 넣고 headline으로 표시한다.
        summary: i.contentKind === 'headline' ? '' : i.content,
        publishedAt: i.publishedAt,
      }))
    : parseAtom(xml);

  return entries
    .filter((e) => e.title && e.url && e.publishedAt)
    .map((e) => ({
      title: clamp(e.title, CS_LIMITS.title),
      url: e.url,
      blog: clamp(blog.name, CS_LIMITS.blog),
      summary: clamp(e.summary, CS_LIMITS.summary),
      publishedAt: e.publishedAt,
    }));
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 검색어 낱말. 한 글자 낱말("a")은 다른 낱말이 있으면 버린다. 거의 모든 글에 맞기 때문이다. */
export function queryTokens(query) {
  const all = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  const long = all.filter((w) => w.length >= 2);
  return long.length > 0 ? long : all;
}

/**
 * 영어 낱말은 낱말 시작에서만 맞춘다. 부분 일치로 두면 "rag"가 "storage"에 맞는다.
 * 한글은 조사가 붙으므로 부분 일치로 맞춘다.
 */
export function matchesTokens(item, tokens) {
  if (tokens.length === 0) return true;
  const haystack = `${item.title} ${item.summary}`.toLowerCase();
  return tokens.some((t) => (/^[\x20-\x7e]+$/.test(t)
    ? new RegExp(`\\b${escapeRegExp(t)}`).test(haystack)
    : haystack.includes(t)));
}

export function createTechBlogProvider({ http, cache, clock, makeBreaker, blogs = TECH_BLOGS }) {
  // 블로그마다 차단기를 따로 둔다. 하나가 죽어도 나머지는 계속 시도한다.
  const fetchers = new Map(blogs.map((b) => [b.id, createCachedSource({ http, cache, makeBreaker, source: b.name })]));

  return {
    async search({ query, limit }) {
      // 피드 내용은 검색어와 무관하다. 피드 단위로 캐시하고 거르기는 매번 한다.
      const results = await Promise.all(blogs.map((blog) => fetchers.get(blog.id)({
        key: `blog:${blog.id}`,
        url: blog.url,
        parse: (xml) => parseBlogFeed(xml, blog),
      })));

      const since = clock.now() - BLOG_WINDOW_DAYS * DAY_MS;
      const tokens = queryTokens(query);
      const items = results.flatMap((r) => r.items)
        .filter((i) => Date.parse(i.publishedAt) >= since && matchesTokens(i, tokens))
        .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
        .slice(0, limit);

      return { items, degraded: results.flatMap((r) => r.degraded) };
    },
  };
}
