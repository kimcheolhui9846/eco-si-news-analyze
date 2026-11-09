import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseArxivId, parseArxivHtml, createArxivHtmlProvider, PAPER_MAX_BYTES } from '../lib/providers/arxiv-html.js';
import { createTtlCache } from '../lib/cost-defense.js';
import { MalformedUpstream } from '../lib/providers/cs-common.js';

const SHORT = readFileSync(new URL('./fixtures/arxiv-html-short.html', import.meta.url), 'utf8');

test('parseArxivId: 받는 형태를 ID로 정규화한다', () => {
  const ok = [
    ['2401.04088', '2401.04088'],
    [' 2401.04088v2 ', '2401.04088v2'],
    ['arXiv:2401.04088', '2401.04088'],
    ['0704.0001', '0704.0001'],
    ['https://arxiv.org/abs/2401.04088', '2401.04088'],
    ['https://arxiv.org/pdf/2401.04088v2.pdf', '2401.04088v2'],
    ['https://arxiv.org/pdf/2401.04088v2', '2401.04088v2'],
    ['https://arxiv.org/html/2401.04088v1/', '2401.04088v1'],
    ['http://www.arxiv.org/abs/2401.04088', '2401.04088'],
    ['hep-th/9901001', 'hep-th/9901001'],
    ['https://arxiv.org/abs/hep-th/9901001v1', 'hep-th/9901001v1'],
    ['math.GT/0309136', 'math.GT/0309136'],
  ];
  for (const [input, want] of ok) assert.equal(parseArxivId(input), want, input);
});

test('parseArxivId: 다른 입력은 null', () => {
  const bad = [
    '', '   ', '2401.040', 'abc', '2401.04088/../x', 12345, null, undefined, 'x'.repeat(400),
    'https://evil.com/abs/2401.04088', 'https://arxiv.org.evil.com/abs/2401.04088',
    'https://arxiv.org/abs/../../etc', 'https://arxiv.org/list/cs.AI',
    'ftp://arxiv.org/abs/2401.04088', 'javascript:alert(1)',
  ];
  for (const input of bad) assert.equal(parseArxivId(input), null, String(input));
});

test('parseArxivHtml: 제목·저자·주소를 읽는다', () => {
  const p = parseArxivHtml(SHORT, { id: '2611.00001' });
  assert.equal(p.id, '2611.00001');
  assert.equal(p.title, 'Tiny MoE Retrieval');
  assert.deepEqual(p.authors, ['Ada Lovelace', 'Alan Turing']);
  assert.equal(p.url, 'https://arxiv.org/abs/2611.00001');
  assert.equal(p.htmlUrl, 'https://arxiv.org/html/2611.00001');
});

test('parseArxivHtml: 초록은 S0, 최상위 장은 문서 순서대로 S1부터', () => {
  const p = parseArxivHtml(SHORT, { id: '2611.00001' });
  assert.deepEqual(p.sections.map((s) => [s.id, s.anchor, s.heading]), [
    ['S0', 'abstract1', 'Abstract'],
    ['S1', 'S1', '1 Introduction'],
    ['S2', 'S2', '2 Method'],
    ['S3', 'S3', '3 Experiments'],
    ['S4', 'Sx1', 'Acknowledgements'],
  ]);
  assert.equal(p.sections[0].text,
    'We introduce TinyMoE, a sparse retriever for long documents. It reaches 85.3% recall@10 on BEIR while routing each query to a small set of experts.');
});

test('parseArxivHtml: 수식은 $TeX$, 각주는 버리고, 소절 제목은 ## 줄로 남긴다', () => {
  const p = parseArxivHtml(SHORT, { id: '2611.00001' });
  assert.equal(p.sections[1].text,
    'Dense retrievers are costly to run on long documents [1]. We route each query to $k=2$ experts and keep the rest idle.');
  assert.equal(p.sections[2].text, [
    'A router selects experts for every query and the selected experts score candidate passages.',
    '## 2.1 Router',
    'The router is a linear layer with 1,024 hidden units trained with a load balancing loss.',
  ].join('\n'));
});

test('parseArxivHtml: 표는 행마다 탭으로, 그림은 캡션만', () => {
  const p = parseArxivHtml(SHORT, { id: '2611.00001' });
  assert.equal(p.sections[3].text, [
    'Model\tRecall@10',
    'BM25\t71.2',
    'TinyMoE\t$85.3$',
    '[Table 1: Recall on BEIR.]',
    'TinyMoE improves recall by 14.1 points over BM25 while using 3.2× less compute.',
    '[Figure 1: Latency per query.]',
  ].join('\n'));
});

test('parseArxivHtml: 참고문헌·부록·script·nav는 본문에 없다', () => {
  const all = parseArxivHtml(SHORT, { id: '2611.00001' }).sections.map((s) => s.text).join('\n');
  for (const absent of ['Robertson', '99.9', 'leaked', 'Footnote text', 'Somewhere Lab', 'color:red']) {
    assert.ok(!all.includes(absent), absent);
  }
});

test('parseArxivHtml: 제목이나 장이 없거나 본문이 너무 짧으면 MalformedUpstream', () => {
  const cases = [
    '<html><body><p>No HTML is available for this paper.</p></body></html>',
    '<html><body><h1 class="ltx_title ltx_title_document">T</h1></body></html>',
    '<html><body><h1 class="ltx_title ltx_title_document">T</h1><section id="S1" class="ltx_section"><h2 class="ltx_title ltx_title_section">1 Intro</h2><p>short</p></section></body></html>',
    '',
  ];
  for (const html of cases) {
    assert.throws(() => parseArxivHtml(html, { id: '2611.00001' }), MalformedUpstream);
  }
});

test('parseArxivHtml: 문단과 표 셀의 NBSP(&nbsp;)는 일반 공백으로 접힌다', () => {
  const filler = 'Filler words keep the body above the minimum length threshold for parsing. '.repeat(5);
  const html = '<html><body><h1 class="ltx_title ltx_title_document">T</h1>'
    + '<section id="S1" class="ltx_section"><h2 class="ltx_title ltx_title_section">1 Intro</h2>'
    + `<div class="ltx_para"><p class="ltx_p">alpha&nbsp;beta ${filler}</p></div>`
    + '<table><tr><td>gamma&nbsp;delta</td><td>eps</td></tr></table>'
    + '</section></body></html>';
  const text = parseArxivHtml(html, { id: '2611.00001' }).sections[0].text;
  assert.ok(text.includes('alpha beta Filler'), text.slice(0, 80));
  assert.ok(text.includes('gamma delta\teps'), text);
  assert.ok(!text.includes(' '));
});

const breaker = () => {
  const state = { failures: 0, successes: 0, open: false };
  return Object.assign(state, {
    canPass: () => !state.open,
    recordSuccess: () => { state.successes += 1; },
    recordFailure: () => { state.failures += 1; },
  });
};
const makeProvider = (get) => {
  const calls = [];
  const b = breaker();
  const http = { get: async (url, opts) => { calls.push({ url, opts }); return get(url, opts); } };
  const cache = createTtlCache({ ttlMs: 60_000, maxEntries: 10, clock: { now: () => 0 } });
  return { provider: createArxivHtmlProvider({ http, cache, makeBreaker: () => b }), calls, b };
};
const httpError = (status) => Object.assign(new Error('x'), { upstreamStatus: status });

test('fetchPaper: arxiv.org/html을 8MB 상한으로 부르고 결과를 캐시한다', async () => {
  const { provider, calls } = makeProvider(async () => ({ status: 200, text: SHORT }));
  const a = await provider.fetchPaper('2611.00001');
  const b = await provider.fetchPaper('2611.00001');
  assert.equal(a.title, 'Tiny MoE Retrieval');
  assert.deepEqual(b, a);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://arxiv.org/html/2611.00001');
  assert.equal(calls[0].opts.maxBytes, PAPER_MAX_BYTES);
});

test('fetchPaper: 404는 422 FULLTEXT_UNAVAILABLE, 캐시하지 않는다', async () => {
  const { provider, calls, b } = makeProvider(async () => { throw httpError(404); });
  for (let i = 0; i < 2; i += 1) {
    await assert.rejects(() => provider.fetchPaper('2401.99999'), (e) => e.status === 422
      && e.code === 'FULLTEXT_UNAVAILABLE'
      && e.message === '이 논문은 arXiv HTML 판이 없어 전문 분석을 할 수 없습니다.');
  }
  assert.equal(calls.length, 2);
  assert.equal(b.failures, 0);
});

test('fetchPaper: 본문 없는 200 응답도 422이고 캐시하지 않는다', async () => {
  const { provider, calls } = makeProvider(async () => ({ status: 200, text: '<html><body>No HTML</body></html>' }));
  await assert.rejects(() => provider.fetchPaper('hep-th/9901001'), (e) => e.code === 'FULLTEXT_UNAVAILABLE');
  await assert.rejects(() => provider.fetchPaper('hep-th/9901001'), (e) => e.code === 'FULLTEXT_UNAVAILABLE');
  assert.equal(calls.length, 2);
});

test('fetchPaper: 그 밖의 실패는 502 COLLECTION_FAILED, 차단기에 실패를 센다', async () => {
  for (const err of [httpError(500), httpError(429), new Error('network')]) {
    const { provider, b } = makeProvider(async () => { throw err; });
    await assert.rejects(() => provider.fetchPaper('2611.00001'), (e) => e.status === 502
      && e.code === 'COLLECTION_FAILED'
      && e.message === 'arXiv에서 논문 본문을 가져오지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
    assert.equal(b.failures, 1);
  }
});

test('fetchPaper: 차단기가 열려 있으면 부르지 않고 502', async () => {
  const { provider, calls, b } = makeProvider(async () => ({ status: 200, text: SHORT }));
  b.open = true;
  await assert.rejects(() => provider.fetchPaper('2611.00001'), (e) => e.code === 'COLLECTION_FAILED');
  assert.equal(calls.length, 0);
});

test('parseArxivHtml: 분석 스키마 한도를 넘는 저자·제목·장 제목·앵커는 잘라 맞춘다', () => {
  const names = Array.from({ length: 101 }, (_, i) => `<span class="ltx_creator"><span class="ltx_personname">${i === 0 ? 'A'.repeat(250) : `Author ${i}`}</span></span>`).join('');
  const html = SHORT
    .replace('<h1 class="ltx_title ltx_title_document">Tiny MoE Retrieval</h1>', `<h1 class="ltx_title ltx_title_document">${'T'.repeat(600)}</h1>`)
    .replace(/<div class="ltx_authors">[\s\S]*?<\/div>\n<div id="abstract1"/, `<div class="ltx_authors">${names}</div>\n<div id="abstract1"`)
    .replace('</span>Method</h2>', `</span>${'M'.repeat(301)}</h2>`)
    .replace('<section id="S2" class="ltx_section">', '<section id="S2_bad-anchor!" class="ltx_section">');
  const p = parseArxivHtml(html, { id: '2611.00001' });
  assert.equal(p.title.length, 500);
  assert.equal(p.authors.length, 100);
  assert.equal(p.authors[0].length, 200);
  const s2 = p.sections.find((s) => s.id === 'S2');
  assert.equal(s2.heading.length, 300);
  assert.equal(s2.anchor, 'S2');
  assert.equal(p.sections.find((s) => s.id === 'S1').anchor, 'S1');
});
