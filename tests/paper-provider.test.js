import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseArxivId, parseArxivHtml } from '../lib/providers/arxiv-html.js';
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
