import { parse } from 'node-html-parser';
import { MalformedUpstream } from './cs-common.js';
import { ApiError } from '../errors.js';

// ─── arXiv HTML 판(LaTeXML) 본문 ───
//
// 논문 한 편 전문 분석(mode: 'paper')의 본문 출처다. PDF를 파싱하지 않는다.
// 실측(2026-11-09): 제목 h1.ltx_title_document, 저자 .ltx_personname, 초록 .ltx_abstract,
// 장 section.ltx_section(id S1… 또는 번호 없는 Sx1), 참고문헌 .ltx_bibliography, 부록 .ltx_appendix.

// 2007년 이후 ID는 YYMM.NNNN(2014년까지) 또는 YYMM.NNNNN, 그 전은 archive(.SC)/YYMMNNN.
const NEW_ID = /^\d{4}\.\d{4,5}(v\d{1,3})?$/;
const OLD_ID = /^[a-z][a-z-]*(\.[A-Z]{2})?\/\d{7}(v\d{1,3})?$/;
const ARXIV_HOSTS = new Set(['arxiv.org', 'www.arxiv.org', 'export.arxiv.org']);
const isId = (s) => NEW_ID.test(s) || OLD_ID.test(s);

/** 사용자 입력(ID·abs·pdf·html 링크)을 arXiv ID로. 모르는 형태는 null이다. 경로 조작 문자는 정규식이 막는다. */
export function parseArxivId(input) {
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

// 분석 요청 스키마(buildPaperAnalyzeSchema)가 같은 값을 쓴다. 수집 결과가 스키마를 넘지 않도록 파서가 여기에 맞춘다.
export const SECTION_ANCHOR = /^[A-Za-z0-9.]{1,40}$/;
export const PAPER_LIMITS = Object.freeze({ title: 500, authors: 100, author: 200, heading: 300 });

/** 장 본문 합계가 이보다 짧으면 본문 없는 안내 페이지로 본다. 실제 논문은 수만 자다. */
export const MIN_BODY_CHARS = 300;

// 각주는 본문 흐름을 끊는다. 표시(ltx_note_mark)와 내용 모두 버린다.
const SKIP_CLASSES = ['ltx_note', 'ltx_tag_note'];
const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'FIGURE', 'TABLE', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'THEAD', 'TBODY']);
const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IMG', 'SVG', 'svg', 'NAV', 'BUTTON']);

const collapse = (s) => s.replace(/[ \t\u00a0\r\n]+/g, ' ').trim();
const hasClass = (el, c) => Boolean(el.classList?.contains(c));
const innerText = (node) => {
  const out = [];
  node.childNodes.forEach((c) => toText(c, out));
  return collapse(out.join(''));
};

function toText(node, out) {
  if (node.nodeType === 3) {
    out.push(node.text);
    return;
  }
  if (node.nodeType !== 1) return;
  const tag = node.tagName;
  if (DROP_TAGS.has(tag) || SKIP_CLASSES.some((c) => hasClass(node, c))) return;
  // 수식은 LaTeXML이 남긴 TeX 원문을 쓴다. 표 안의 수치도 math로 들어 있다.
  if (tag === 'MATH') {
    out.push(` $${collapse(node.getAttribute('alttext') ?? '')}$ `);
    return;
  }
  // 표는 결과 수치 대조에 꼭 필요하다. 행마다 한 줄, 셀은 탭으로 잇는다.
  if (tag === 'TR') {
    const cells = node.childNodes.filter((c) => c.nodeType === 1 && (c.tagName === 'TD' || c.tagName === 'TH'));
    out.push('\n', cells.map(innerText).join('\t'), '\n');
    return;
  }
  if (/^H[1-6]$/.test(tag)) {
    out.push(`\n## ${innerText(node)}\n`);
    return;
  }
  if (tag === 'FIGCAPTION') {
    out.push(`\n[${innerText(node)}]\n`);
    return;
  }
  const block = BLOCK_TAGS.has(tag);
  if (block) out.push('\n');
  node.childNodes.forEach((c) => toText(c, out));
  if (block) out.push('\n');
}

// 줄마다 공백을 접고 빈 줄을 버린다. 표의 탭은 남긴다.
const tidy = (s) => s.split('\n')
  .map((line) => line.split('\t').map((cell) => cell.replace(/[ \u00a0]+/g, ' ').trim()).join('\t').trim())
  .filter(Boolean)
  .join('\n');

function blockText(el, isOwnHeading) {
  const out = [];
  el.childNodes.forEach((c) => {
    if (c.nodeType === 1 && isOwnHeading(c)) return;
    toText(c, out);
  });
  return tidy(out.join(''));
}

// 앵커가 스키마 패턴에 맞지 않으면 장 자신의 ID로 대신한다.
const safeAnchor = (anchor, fallback) => (SECTION_ANCHOR.test(anchor ?? '') ? anchor : fallback);

/**
 * LaTeXML HTML → 장 목록. 초록은 S0, 최상위 장은 문서 순서대로 S1부터 다시 번호 매긴다.
 * 소절은 장 본문 안에 '## 소제목' 줄로 남는다. 참고문헌·부록은 뺀다.
 * 제목이나 장이 없거나 본문이 너무 짧으면 MalformedUpstream을 던진다(호출부가 캐시하지 않는다).
 */
export function parseArxivHtml(html, { id }) {
  const root = parse(String(html ?? ''), { blockTextElements: { script: false, style: false } });
  const title = collapse(root.querySelector('h1.ltx_title_document')?.text ?? '');
  if (!title) throw new MalformedUpstream('no title');

  // 소속·각주는 ltx_personname 밖이나 하위 요소에 있다. 이름은 직속 텍스트만 읽는다.
  const authors = root.querySelectorAll('.ltx_authors .ltx_personname')
    .map((p) => collapse(p.childNodes.filter((c) => c.nodeType === 3).map((c) => c.text).join(' ')))
    .filter(Boolean)
    .slice(0, PAPER_LIMITS.authors)
    .map((a) => a.slice(0, PAPER_LIMITS.author));

  const sections = [];
  const abstract = root.querySelector('.ltx_abstract');
  if (abstract) {
    const text = blockText(abstract, (c) => hasClass(c, 'ltx_title_abstract'));
    if (text) sections.push({ id: 'S0', anchor: safeAnchor(abstract.id, 'S0'), heading: 'Abstract', text });
  }

  const top = root.querySelectorAll('section.ltx_section')
    .filter((s) => !s.closest('.ltx_appendix') && !s.closest('.ltx_bibliography'));
  top.forEach((s, i) => {
    const heading = collapse(s.querySelector('.ltx_title_section')?.text ?? '') || `Section ${i + 1}`;
    const text = blockText(s, (c) => hasClass(c, 'ltx_title_section'));
    sections.push({
      id: `S${i + 1}`,
      anchor: safeAnchor(s.id, `S${i + 1}`),
      heading: heading.slice(0, PAPER_LIMITS.heading),
      text,
    });
  });

  const bodyChars = sections.filter((s) => s.id !== 'S0').reduce((n, s) => n + s.text.length, 0);
  if (top.length === 0 || bodyChars < MIN_BODY_CHARS) throw new MalformedUpstream('no body');

  return {
    id,
    title: title.slice(0, PAPER_LIMITS.title),
    authors,
    url: `https://arxiv.org/abs/${id}`,
    htmlUrl: `https://arxiv.org/html/${id}`,
    sections,
  };
}

export const PAPER_MAX_BYTES = 8_000_000;
export const FULLTEXT_UNAVAILABLE_MESSAGE = '이 논문은 arXiv HTML 판이 없어 전문 분석을 할 수 없습니다.';
export const PAPER_FETCH_FAILED_MESSAGE = 'arXiv에서 논문 본문을 가져오지 못했습니다. 잠시 뒤 다시 시도해 주세요.';

const unavailable = () => new ApiError(422, 'FULLTEXT_UNAVAILABLE', FULLTEXT_UNAVAILABLE_MESSAGE);
const fetchFailed = () => new ApiError(502, 'COLLECTION_FAILED', PAPER_FETCH_FAILED_MESSAGE);

/**
 * 논문 한 편의 HTML 판을 가져와 파싱한다. CS 출처와 달리 실패를 degraded로 돌리지 않는다.
 * 본문이 없으면 분석할 것이 없으므로 사용자에게 바로 알린다.
 * 404와 본문 없는 페이지는 arXiv가 정상 응답한 것이라 차단기에 실패로 세지 않는다.
 */
export function createArxivHtmlProvider({ http, cache, makeBreaker }) {
  const breaker = makeBreaker();

  return {
    async fetchPaper(id) {
      const key = `arxiv-html:${id}`;
      const cached = cache.get(key);
      if (cached) return cached;
      if (!breaker.canPass()) throw fetchFailed();

      let text;
      try {
        ({ text } = await http.get(`https://arxiv.org/html/${id}`, {
          maxBytes: PAPER_MAX_BYTES,
          headers: { Accept: 'text/html' },
        }));
      } catch (err) {
        if (err?.upstreamStatus === 404) {
          breaker.recordSuccess();
          throw unavailable();
        }
        breaker.recordFailure();
        throw fetchFailed();
      }

      let paper;
      try {
        paper = parseArxivHtml(text, { id });
      } catch (err) {
        if (err instanceof MalformedUpstream) {
          breaker.recordSuccess();
          throw unavailable();
        }
        throw err;
      }
      breaker.recordSuccess();
      cache.set(key, paper);
      return paper;
    },
  };
}
