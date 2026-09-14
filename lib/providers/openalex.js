import { normalizeAuthors, RESEARCH_LIMITS } from './papers.js';

const clamp = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const asArray = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
const hasHangul = (value) => /[\uAC00-\uD7AF]/u.test(String(value ?? ''));

function abstractFromInverted(index) {
  if (!index || typeof index !== 'object') return '';
  const words = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of asArray(positions)) {
      if (Number.isInteger(position)) words[position] = word;
    }
  }
  return words.filter(Boolean).join(' ');
}

function dateParts(work) {
  const date = String(work?.publication_date ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return { publishedAt: `${date}T00:00:00.000Z`, datePrecision: 'day' };
  if (/^\d{4}-\d{2}$/.test(date)) return { publishedAt: `${date}-01T00:00:00.000Z`, datePrecision: 'month' };
  if (/^\d{4}$/.test(date)) return { publishedAt: `${date}-01-01T00:00:00.000Z`, datePrecision: 'year' };
  return { publishedAt: null, datePrecision: 'unknown' };
}

export function parseOpenAlex(text) {
  let body;
  try { body = JSON.parse(text); } catch { return []; }
  return asArray(body?.results).map((work) => {
    const title = clamp(work?.title, RESEARCH_LIMITS.title);
    const authors = asArray(work?.authorships).map((entry) => entry?.author?.display_name).filter(Boolean);
    const source = work?.primary_location?.source?.display_name;
    const doi = work?.doi ? String(work.doi).replace(/^https?:\/\/doi\.org\//i, '').slice(0, RESEARCH_LIMITS.doi) : null;
    const url = work?.primary_location?.landing_page_url || work?.doi || work?.id || null;
    return {
      title,
      abstract: clamp(work?.abstract_inverted_index ? abstractFromInverted(work.abstract_inverted_index) : work?.abstract, RESEARCH_LIMITS.abstract),
      ...normalizeAuthors(authors),
      venue: clamp(source || 'OpenAlex', RESEARCH_LIMITS.venue),
      doi,
      url: url ? String(url).replace(/^http:\/\//, 'https://') : null,
      ...dateParts(work),
      peerReviewed: work?.type === 'article' ? 'peer-reviewed' : 'unknown',
      sourceName: 'OpenAlex',
      language: work?.language?.code === 'ko' || hasHangul(title) ? 'ko' : 'en',
    };
  }).filter((item) => item.title);
}

export function buildOpenAlexUrl({ query, limit }) {
  const params = new URLSearchParams({ search: query, 'per-page': String(Math.min(25, Math.max(1, Number(limit) || 5))) });
  return `https://api.openalex.org/works?${params}`;
}
