import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseEuropePmc, parseArxiv, parseClinicalTrials, createFinancialProvider,
  buildAnalyzeSchema, loadConfig, createTtlCache, createCircuitBreaker,
} from '../server.js';
import { makeClock, BASE_ENV } from './helpers.js';

// ─── provider 출력은 언제나 분석 스키마를 통과해야 한다 ───
//
// 이 계약이 깨지면 서버가 자기 provider의 출력을 400으로 거부한다.
// 실측에서 저자 217명짜리 arXiv 논문에 이 일이 실제로 벌어졌고,
// 손으로 쓴 픽스처만 검증하던 테스트는 그것을 놓쳤다.

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const schema = buildAnalyzeSchema(loadConfig(BASE_ENV));

const NEWS = [{
  title: '제목', content: '본문', source: '연합뉴스',
  url: 'https://a.example/1', publishedAt: '2026-08-30T09:00:00Z',
}];

const accept = (payload) => {
  const parsed = schema.safeParse({ newsList: NEWS, ...payload });
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
};

test('Europe PMC 파서 출력이 분석 스키마를 통과한다', () => {
  accept({ research: parseEuropePmc(fixture('europepmc-battery.json')) });
});

test('arXiv 파서 출력이 분석 스키마를 통과한다', () => {
  accept({ research: parseArxiv(fixture('arxiv-battery.xml')) });
});

test('저자가 상한을 훌쩍 넘는 논문도 스키마를 통과한다', () => {
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom"><entry>',
    '<id>http://arxiv.org/abs/1234.5678v1</id>',
    '<title>협업 논문</title><summary>초록</summary>',
    '<published>2026-01-02T00:00:00Z</published>',
    '<link href="https://arxiv.org/abs/1234.5678v1" rel="alternate" type="text/html"/>',
    Array.from({ length: 300 }, (_, i) => `<author><name>저자 ${i + 1}</name></author>`).join(''),
    '</entry></feed>',
  ].join('');
  accept({ research: parseArxiv(xml) });
});

test('아주 긴 제목·초록·저널명도 스키마를 통과한다', () => {
  const body = JSON.stringify({
    resultList: {
      result: [{
        id: 'X1', source: 'MED', pubYear: '2026',
        title: 'ㄱ'.repeat(2000),
        abstractText: 'ㄴ'.repeat(20000),
        journalInfo: { journal: { title: 'ㄷ'.repeat(1000) } },
        authorString: Array.from({ length: 200 }, (_, i) => `저자${i}`).join(', '),
      }],
    },
  });
  accept({ research: parseEuropePmc(body) });
});

test('ClinicalTrials 파서 출력이 분석 스키마를 통과한다', () => {
  accept({ experiments: parseClinicalTrials(fixture('clinicaltrials-obesity.json')) });
});

test('대상 질환이 아주 많은 연구도 스키마를 통과한다', () => {
  const body = JSON.parse(fixture('clinicaltrials-obesity.json'));
  body.studies[0].protocolSection.conditionsModule.conditions =
    Array.from({ length: 120 }, (_, i) => `질환 ${i}`);
  accept({ experiments: parseClinicalTrials(JSON.stringify(body)) });
});

test('재무 provider 출력이 분석 스키마를 통과한다', async () => {
  const clock = makeClock();
  const provider = createFinancialProvider({
    http: {
      async get(url) {
        if (url.includes('/Revenues.json')) {
          return { status: 200, text: fixture('sec-concept-revenues.json'), url };
        }
        throw new Error('없는 개념');
      },
    },
    cache: createTtlCache({ ttlMs: 1000, maxEntries: 10, clock }),
    clock,
    makeBreaker: () => createCircuitBreaker({ threshold: 99, cooldownMs: 1000, clock }),
  });

  const financial = await provider.fetch({ cik: '0001045810', symbol: 'NVDA' });
  accept({ financial });
});
