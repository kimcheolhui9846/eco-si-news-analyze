import { parseArxivCs } from './papers.js';
import { XMLParser } from 'fast-xml-parser';
import { createCachedSource, MalformedUpstream } from './cs-common.js';

const feedParser = new XMLParser({ ignoreAttributes: true });

/** Atom feed 루트가 없으면 arXiv 응답이 아니다. */
function assertAtomFeed(text) {
  let doc;
  try {
    doc = feedParser.parse(text);
  } catch {
    throw new MalformedUpstream('not xml');
  }
  if (doc?.feed === undefined) throw new MalformedUpstream('no feed');
}

// ─── arXiv CS 분야 최신 논문 ───
//
// 투자 모드의 논문 검색과 캐시·차단기를 나누려고 따로 둔다.

/** 낱말마다 all:로 묶어 AND한다. 공백 그대로 넘기면 arXiv가 OR처럼 넓게 읽는다. */
export function buildArxivCsUrl({ query, limit }) {
  const terms = String(query).trim().split(/\s+/).filter(Boolean).slice(0, 6)
    .map((t) => `all:${encodeURIComponent(t)}`);
  const searchQuery = [...terms, 'cat:cs.*'].join('+AND+');
  return `https://export.arxiv.org/api/query?search_query=${searchQuery}&sortBy=submittedDate&sortOrder=descending&max_results=${limit}`;
}

export function createArxivCsProvider({ http, cache, makeBreaker }) {
  const fetchSource = createCachedSource({ http, cache, makeBreaker, source: 'arXiv' });

  return {
    search({ query, limit }) {
      return fetchSource({
        key: `arxiv-cs:${limit}:${query}`,
        url: buildArxivCsUrl({ query, limit }),
        parse: (text) => {
          assertAtomFeed(text);
          return parseArxivCs(text).slice(0, limit);
        },
      });
    },
  };
}
