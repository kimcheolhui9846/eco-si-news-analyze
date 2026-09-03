import { XMLParser } from 'fast-xml-parser';
import { stripControlChars } from '../normalize.js';

// fast-xml-parser는 CDATA를 자동으로 벗기고, 외부 엔티티(XXE)를 거부한다.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

/** HTML 태그와 엔티티를 걷어낸 순수 텍스트. */
const stripHtml = (raw) =>
  String(raw)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** fast-xml-parser는 항목이 하나면 배열이 아닌 객체를 준다. */
const asArray = (v) => {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
};

/** 텍스트 노드는 문자열이거나 { '#text': ... } 형태다. */
const text = (node) => {
  if (node === undefined || node === null) return '';
  if (typeof node === 'object') return String(node['#text'] ?? '');
  return String(node);
};

/** "제목 - 매체명" 형태의 접미사를 떼어낸다. Google News가 붙인다. */
const stripSourceSuffix = (title) => title.replace(/\s+-\s+[^\s-]+(\.[^\s-]+)+\s*$/, '').trim();

const httpsOnly = (raw) => {
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
};

/**
 * RSS XML을 정규 항목 배열로 바꾼다.
 *
 * 깨진 피드 하나 때문에 수집 전체가 죽으면 안 되므로 예외를 흡수하고
 * 빈 배열을 반환한다. 필수 필드가 없는 항목은 조용히 버린다.
 */
export function parseRssFeed(xml, feed) {
  let doc;
  try {
    doc = parser.parse(xml);
  } catch {
    return [];   // XXE 시도, 깨진 XML 모두 여기로 온다
  }

  const rawItems = asArray(doc?.rss?.channel?.item);
  const out = [];

  for (const raw of rawItems) {
    const title = stripSourceSuffix(stripHtml(stripControlChars(text(raw.title))));
    if (!title) continue;

    const url = httpsOnly(text(raw.link));
    if (!url) continue;

    const parsedDate = Date.parse(text(raw.pubDate));
    if (Number.isNaN(parsedDate)) continue;

    const body = stripHtml(stripControlChars(text(raw.description)));

    // 본문이 없으면 제목으로 채우되 headline으로 강등한다.
    // Phase 1 스키마가 content를 필수로 요구하므로 비워둘 수 없다.
    const hasBody = body.length > 0 && body !== title;

    out.push({
      title,
      content: hasBody ? body : title,
      contentKind: hasBody ? feed.contentKind : 'headline',
      // item.source가 있으면 실제 매체명, 없으면 피드 이름.
      source: stripHtml(text(raw.source)) || feed.name,
      url,
      publishedAt: new Date(parsedDate).toISOString(),
    });
  }

  return out;
}
