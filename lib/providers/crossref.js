import { normalizeAuthors, RESEARCH_LIMITS } from './papers.js';

const clamp = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const asArray = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
const stripMarkup = (value) => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function dateParts(work) {
  const parts = work?.published?.['date-parts']?.[0] ?? work?.issued?.['date-parts']?.[0] ?? [];
  const [year, month, day] = parts.map(Number);
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return { publishedAt: null, datePrecision: 'unknown' };
  if (!Number.isInteger(month)) return { publishedAt: `${year}-01-01T00:00:00.000Z`, datePrecision: 'year' };
  if (!Number.isInteger(day)) return { publishedAt: `${year}-${String(month).padStart(2, '0')}-01T00:00:00.000Z`, datePrecision: 'month' };
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return { publishedAt: null, datePrecision: 'unknown' };
  return { publishedAt: date.toISOString(), datePrecision: 'day' };
}

export function parseCrossref(text) {
  let body;
  try { body = JSON.parse(text); } catch { return []; }
  return asArray(body?.message?.items).map((work) => {
    const title = clamp(work?.title?.[0] ?? work?.title, RESEARCH_LIMITS.title);
    const authors = asArray(work?.author).map((author) => [author?.given, author?.family].filter(Boolean).join(' ')).filter(Boolean);
    const doi = work?.DOI ? String(work.DOI).slice(0, RESEARCH_LIMITS.doi) : null;
    const rawUrl = work?.URL || (doi ? `https://doi.org/${doi}` : null);
    return {
      title,
      abstract: clamp(stripMarkup(work?.abstract), RESEARCH_LIMITS.abstract),
      ...normalizeAuthors(authors),
      venue: clamp(work?.['container-title']?.[0] ?? 'Crossref', RESEARCH_LIMITS.venue),
      doi,
      url: rawUrl ? String(rawUrl).replace(/^http:\/\//, 'https://') : null,
      ...dateParts(work),
      peerReviewed: work?.type === 'journal-article' ? 'peer-reviewed' : 'unknown',
      sourceName: 'Crossref',
      language: /[\uAC00-\uD7AF]/u.test(title) ? 'ko' : 'en',
    };
  }).filter((item) => item.title);
}

export function buildCrossrefUrl({ query, limit, contactEmail }) {
  const params = new URLSearchParams({ 'query.title': query, rows: String(Math.min(25, Math.max(1, Number(limit) || 5))) });
  if (contactEmail) params.set('mailto', contactEmail);
  return `https://api.crossref.org/works?${params}`;
}
