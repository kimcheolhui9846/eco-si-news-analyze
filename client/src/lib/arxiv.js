// 서버 lib/providers/arxiv-html.js의 parseArxivId와 같은 규칙이다. 화면에서 미리 거르는 용도이고 최종 판단은 서버가 한다.
const NEW_ID = /^\d{4}\.\d{4,5}(v\d{1,3})?$/;
const OLD_ID = /^[a-z][a-z-]*(\.[A-Z]{2})?\/\d{7}(v\d{1,3})?$/;
const ARXIV_HOSTS = new Set(['arxiv.org', 'www.arxiv.org', 'export.arxiv.org']);
const isId = (s) => NEW_ID.test(s) || OLD_ID.test(s);

export function arxivIdFrom(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || raw.length > 300) return null;
  const bare = raw.replace(/^arxiv:/i, '');
  if (isId(bare)) return bare;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (!ARXIV_HOSTS.has(url.hostname.toLowerCase())) return null;
  const m = url.pathname.match(/^\/(?:abs|pdf|html)\/(.+?)(?:\.pdf)?\/?$/);
  return m && isId(m[1]) ? m[1] : null;
}
