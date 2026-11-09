# 분야 묶음·회사 자동 해석·OpenDART 재무 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "반도체", "AI" 같은 분야 검색에 대표 종목 묶음의 시세·재무를 보여 주고, 회사명·티커를 SEC·OpenDART 공식 목록으로 해석하며, 한국 상장사 재무를 OpenDART로 가져온다.

**Architecture:** 검색어 → `resolveInstruments`(직접 티커 → 회사 → 분야 → 없음) → 종목 배열 `instruments`(최대 4) → 종목마다 시세(기존 market provider)와 재무(SEC 또는 DART)를 병렬 수집한다. 수집 응답·분석 요청·프롬프트·캐시 키·화면의 단수 필드(`marketData`, `marketSeries`, `financial`)를 `instruments` 배열 하나로 바꾼다.

**Tech Stack:** Node 22+ ESM, Express, Zod, node:test + tsx, supertest, React 19 + @testing-library/react(global-jsdom). 새 devDependency: `adm-zip`(스냅샷 갱신 스크립트 전용).

**Spec:** `docs/superpowers/specs/2026-11-08-sector-baskets-opendart-design.md`

## Global Constraints

- 묶음 종목은 최대 4개(`MAX_INSTRUMENTS = 4`).
- 회사명과 분야가 함께 있으면 회사가 우선한다.
- 일치 규칙: 단어가 키와 같거나 "키 + 조사(은, 는, 이, 가, 의, 을, 를, 에, 와, 과, 도, 로, 으로, 에서)"일 때만 일치한다.
- 미국 티커 대조는 대문자로 입력된 단어에만 하고, 분야 키워드와 같은 단어는 티커로 보지 않는다.
- `OPENDART_API_KEY`는 선택 항목이다. 비어 있어도 기동한다. 키 값은 로그·응답 어디에도 남기지 않는다.
- 모든 외부 호출은 `lib/http.js` 단일 통로를 거친다. 허용 목록에 `opendart.fss.or.kr`를 추가한다.
- DART 결과 캐시 TTL 기본 6시간(`DART_CACHE_TTL_MS=21600000`).
- 차트 시계열(`series`)은 프롬프트와 cacheKey에 넣지 않는다.
- 빈 자료는 필드를 아예 싣지 않는다(`[]`가 아니라 생략). 서버와 클라이언트가 같은 규칙을 써야 cacheKey가 일치한다.
- 통화는 환산하지 않는다. 각 종목의 원래 단위(USD/KRW)로 표시한다.
- 테스트는 네트워크·LLM 비용 없이 돈다. 전체 실행: `npm test`. 파일 하나: `node --import tsx --test tests/<파일>`.
- 커밋 메시지에 AI 공동저자 트레일러를 넣지 않는다.

## 파일 구조

| 파일 | 상태 | 책임 |
|---|---|---|
| `lib/providers/match.js` | 생성 | 토큰화와 키 일치 규칙(`createMatcher`) |
| `lib/providers/aliases.js` | 수정 | 한글명 별칭. 새 일치 규칙 사용, CIK 제거 |
| `lib/providers/sectors.js` | 생성 | 분야 사전과 `lookupSector` |
| `lib/providers/directory.js` | 생성 | SEC·KRX 디렉터리 조회, 스냅샷 로드 |
| `data/us-tickers.json` | 생성 | SEC 티커 스냅샷(커밋) |
| `data/kr-listed.json` | 키 발급 후 생성 | OpenDART 상장사 스냅샷(커밋) |
| `scripts/refresh-directory.js` | 생성 | 스냅샷 갱신 스크립트 |
| `lib/resolve.js` | 생성 | `createResolver` → `resolveInstruments` |
| `lib/providers/dart-financial.js` | 생성 | OpenDART 주요계정 provider |
| `lib/providers/financial.js` | 수정 | 결과에 `source: 'sec'`, `corpCode: null` 추가 |
| `lib/instruments.js` | 생성 | 종목별 시세·재무 수집과 분석 입력 변환 |
| `lib/validation.js` | 수정 | 재무 스키마 확장, 분석 스키마 `instruments`/`sector` |
| `lib/sections.js` | 수정 | `financialEntries`, 다종목 재무 구획 |
| `lib/prompt.js` | 수정 | 다종목 시장 구획, 분야 묶음 안내 |
| `lib/postprocess.js` | 수정 | 종목별 재무 출처, URL 허용 목록 |
| `lib/providers/market.js` | 수정 | `resolveSymbol`·Yahoo 검색 제거 |
| `lib/config.js` | 수정 | `opendartApiKey`, `dartCacheTtlMs`, 허용 목록 |
| `server.js` | 수정 | 배선, 수집·분석 경로 전환 |
| `client/src/components/InstrumentComparison.jsx` | 생성 | 묶음 비교표 |
| `client/src/...` | 수정 | api, App, ReviewPage, ReportPage, SourceSummary, FinancialMetrics, ScopePicker |
| `render.yaml`, `scripts/verify-research.sh`, `docs/api.md`, `docs/SESSION-HANDOFF.md` | 수정 | 배포·검증·문서 |

---

### Task 1: 일치 규칙과 별칭 오탐 수정

"메타버스"가 META로 잡히는 버그를 고친다. 다른 모듈(분야·디렉터리)도 이 일치 규칙을 쓴다.

**Files:**
- Create: `lib/providers/match.js`
- Modify: `lib/providers/aliases.js`
- Test: `tests/match.test.js`

**Interfaces:**
- Produces: `tokenize(text): string[]`, `createMatcher(keys: string[]): (query: string) => string | null` (반환값은 소문자·trim한 키), `PARTICLES: string[]`
- `lookupAlias(query)`의 반환 형태는 그대로다(`{ symbol, assetType, name, cik? }` 또는 null).

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/match.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, createMatcher } from '../lib/providers/match.js';
import { lookupAlias } from '../lib/providers/aliases.js';

test('tokenize는 소문자로 바꾸고 공백·문장부호로 나눈다', () => {
  assert.deepEqual(tokenize('엔비디아, AI 반도체! (실적)'), ['엔비디아', 'ai', '반도체', '실적']);
});

test('단어가 키와 같으면 일치한다', () => {
  assert.equal(createMatcher(['메타'])('메타 실적'), '메타');
});

test('키 뒤에 조사가 붙어도 일치한다', () => {
  const find = createMatcher(['삼성전자', '엔비디아']);
  assert.equal(find('삼성전자의 반도체'), '삼성전자');
  assert.equal(find('엔비디아가 발표한'), '엔비디아');
  assert.equal(find('반도체에서 삼성전자로'), '삼성전자');
});

test('키가 더 긴 단어의 일부일 뿐이면 일치하지 않는다', () => {
  const find = createMatcher(['메타', 'ai']);
  assert.equal(find('메타버스 시장'), null);
  assert.equal(find('openai 투자'), null);
});

test('여러 단어로 된 키는 연속된 단어열과 대조한다', () => {
  const find = createMatcher(['general motors']);
  assert.equal(find('General Motors 실적'), 'general motors');
  assert.equal(find('general 이야기 motors'), null);
});

test('긴 키를 먼저 본다', () => {
  assert.equal(createMatcher(['ai', '반도체'])('ai 반도체 전망'), '반도체');
});

test('lookupAlias: 메타버스는 META가 아니다 (회귀)', () => {
  assert.equal(lookupAlias('메타버스 시장'), null);
});

test('lookupAlias: 조사가 붙은 회사명도 찾는다', () => {
  assert.equal(lookupAlias('삼성전자의 반도체')?.symbol, '005930.KS');
  assert.equal(lookupAlias('엔비디아 AI 반도체')?.symbol, 'NVDA');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test tests/match.test.js`
Expected: FAIL — `Cannot find module '../lib/providers/match.js'`

- [ ] **Step 3: `lib/providers/match.js` 구현**

```js
// ─── 검색어 일치 규칙 ───
//
// 부분 문자열로 비교하면 "메타버스"가 "메타"(META)로 잡힌다.
// 단어 단위로 비교하고, 한국어 조사만 꼬리로 허용한다.

export const PARTICLES = ['으로', '에서', '은', '는', '이', '가', '의', '을', '를', '에', '와', '과', '도', '로'];

const SEPARATORS = /[\s,.;:!?()[\]{}"'“”‘’/\\|·~]+/u;

export function tokenize(text) {
  return String(text ?? '').toLowerCase().split(SEPARATORS).filter(Boolean);
}

const tokenMatches = (token, key) =>
  token === key || (token.startsWith(key) && PARTICLES.includes(token.slice(key.length)));

/**
 * 키 목록으로 일치 함수를 만든다. 키 정렬은 한 번만 한다.
 * 반환하는 키는 소문자·trim한 형태다. 호출부의 사전도 같은 형태로 키를 둬야 한다.
 */
export function createMatcher(keys) {
  const entries = [...new Set(keys.map((k) => String(k).toLowerCase().trim()).filter(Boolean))]
    .map((key) => ({ key, parts: tokenize(key) }))
    .filter((e) => e.parts.length > 0)
    .sort((a, b) => b.key.length - a.key.length);

  return (query) => {
    const tokens = tokenize(query);
    for (const { key, parts } of entries) {
      for (let i = 0; i + parts.length <= tokens.length; i += 1) {
        const head = parts.slice(0, -1).every((p, j) => tokens[i + j] === p);
        if (head && tokenMatches(tokens[i + parts.length - 1], parts.at(-1))) return key;
      }
    }
    return null;
  };
}
```

- [ ] **Step 4: `aliases.js`의 `lookupAlias`를 새 규칙으로 교체**

`lib/providers/aliases.js`에서 `KEYS_BY_LENGTH`와 기존 `lookupAlias`를 지우고 다음으로 바꾼다. 파일 맨 위에 import를 추가한다.

```js
import { createMatcher } from './match.js';
```

```js
const findAliasKey = createMatcher(Object.keys(SYMBOL_ALIASES));

/**
 * 검색어에서 알려진 회사명을 찾는다.
 * 단어 단위로 보며 조사만 꼬리로 허용한다("삼성전자의"는 일치, "메타버스"는 불일치).
 */
export function lookupAlias(query) {
  const key = findAliasKey(query);
  return key ? SYMBOL_ALIASES[key] : null;
}
```

`SYMBOL_ALIASES`의 키는 이미 소문자다(`sk하이닉스`, `posco홀딩스` 등). 그대로 둔다. CIK 제거는 Task 3에서 한다.

- [ ] **Step 5: 통과 확인**

Run: `node --import tsx --test tests/match.test.js tests/market-provider.test.js`
Expected: PASS. `market-provider.test.js`의 별칭 테스트가 부분 일치에 의존해 실패하면, 그 테스트의 검색어가 단어 단위로 회사명을 포함하도록 고친다(예: `'엔비디아실적'` → `'엔비디아 실적'`). 기대값은 바꾸지 않는다.

- [ ] **Step 6: 커밋**

```bash
git add lib/providers/match.js lib/providers/aliases.js tests/match.test.js tests/market-provider.test.js
git commit -m "fix: match aliases by word with Korean particles"
```

---

### Task 2: 분야 사전

**Files:**
- Create: `lib/providers/sectors.js`
- Test: `tests/sectors.test.js`

**Interfaces:**
- Consumes: `createMatcher` (Task 1)
- Produces:
  - `SECTOR_BASKETS: Record<string, { keywords: string[], members: Instrument[] }>`
  - `SECTOR_KEYWORDS: string[]` (모든 키워드, 소문자)
  - `lookupSector(query): { sector: string, members: Instrument[] } | null`
  - `Instrument = { symbol: string, name: string, assetType: 'stock'|'crypto', market: 'US'|'KR'|'CRYPTO' }`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/sectors.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupSector, SECTOR_BASKETS, SECTOR_KEYWORDS } from '../lib/providers/sectors.js';

test('분야 키워드로 묶음을 찾는다', () => {
  const hit = lookupSector('반도체 업황');
  assert.equal(hit.sector, '반도체');
  assert.deepEqual(hit.members.map((m) => m.symbol), ['NVDA', 'TSM', '005930.KS', '000660.KS']);
});

test('영문 키워드와 조사도 인식한다', () => {
  assert.equal(lookupSector('AI 전망')?.sector, 'AI');
  assert.equal(lookupSector('배터리의 미래')?.sector, '2차전지');
  assert.equal(lookupSector('EV 판매')?.sector, '자동차');
  assert.equal(lookupSector('crypto market')?.sector, '코인');
});

test('키워드가 다른 단어의 일부면 분야로 보지 않는다', () => {
  assert.equal(lookupSector('openai 투자'), null);
  assert.equal(lookupSector('반도체소재주'), null);
});

test('두 분야 키워드가 있으면 긴 키워드가 이긴다', () => {
  assert.equal(lookupSector('ai 반도체 전망')?.sector, '반도체');
});

test('모든 묶음은 4개 이하이고 형태가 올바르다', () => {
  for (const [name, basket] of Object.entries(SECTOR_BASKETS)) {
    assert.ok(basket.members.length >= 1 && basket.members.length <= 4, name);
    for (const m of basket.members) {
      assert.ok(m.symbol && m.name, name);
      assert.ok(['stock', 'crypto'].includes(m.assetType), name);
      assert.ok(['US', 'KR', 'CRYPTO'].includes(m.market), name);
    }
  }
});

test('SECTOR_KEYWORDS는 소문자 키워드 전체다', () => {
  assert.ok(SECTOR_KEYWORDS.includes('ai'));
  assert.ok(SECTOR_KEYWORDS.includes('반도체'));
  assert.ok(SECTOR_KEYWORDS.every((k) => k === k.toLowerCase()));
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test tests/sectors.test.js`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: `lib/providers/sectors.js` 구현**

```js
import { createMatcher } from './match.js';

// ─── 분야 → 대표 종목 묶음 ───
//
// 분야 구성은 자동으로 정하지 않는다. 비공식 업종 API는 깨지기 쉽고,
// LLM에 티커를 물으면 존재하지 않는 티커를 지어낼 수 있다.
// cik·corpCode는 여기 적지 않는다. resolve 단계에서 디렉터리로 보강한다.

const us = (symbol, name) => ({ symbol, name, assetType: 'stock', market: 'US' });
const kr = (symbol, name) => ({ symbol, name, assetType: 'stock', market: 'KR' });
const coin = (symbol, name) => ({ symbol, name, assetType: 'crypto', market: 'CRYPTO' });

export const SECTOR_BASKETS = {
  반도체: {
    keywords: ['반도체', 'semiconductor', 'semiconductors', '칩'],
    members: [us('NVDA', 'NVIDIA'), us('TSM', 'TSMC'), kr('005930.KS', '삼성전자'), kr('000660.KS', 'SK하이닉스')],
  },
  AI: {
    keywords: ['ai', '인공지능', '생성형'],
    members: [us('NVDA', 'NVIDIA'), us('MSFT', 'Microsoft'), us('GOOGL', 'Alphabet'), kr('035420.KS', 'NAVER')],
  },
  '2차전지': {
    keywords: ['2차전지', '이차전지', '배터리'],
    members: [kr('373220.KS', 'LG에너지솔루션'), us('TSLA', 'Tesla'), kr('006400.KS', '삼성SDI'), kr('247540.KQ', '에코프로비엠')],
  },
  자동차: {
    keywords: ['자동차', '전기차', 'ev'],
    members: [us('TSLA', 'Tesla'), kr('005380.KS', '현대자동차'), kr('000270.KS', '기아'), us('GM', 'General Motors')],
  },
  바이오: {
    keywords: ['바이오', '제약'],
    members: [kr('068270.KS', '셀트리온'), kr('207940.KS', '삼성바이오로직스'), us('LLY', 'Eli Lilly'), us('AMGN', 'Amgen')],
  },
  '빅테크·플랫폼': {
    keywords: ['빅테크', '플랫폼'],
    members: [us('AAPL', 'Apple'), us('AMZN', 'Amazon'), us('META', 'Meta'), kr('035720.KS', '카카오')],
  },
  코인: {
    keywords: ['코인', '암호화폐', 'crypto'],
    members: [coin('bitcoin', '비트코인'), coin('ethereum', '이더리움'), coin('solana', '솔라나'), coin('ripple', '리플')],
  },
};

const SECTOR_BY_KEYWORD = new Map(
  Object.entries(SECTOR_BASKETS).flatMap(([sector, b]) => b.keywords.map((k) => [k.toLowerCase(), sector])),
);

export const SECTOR_KEYWORDS = [...SECTOR_BY_KEYWORD.keys()];

const findKeyword = createMatcher(SECTOR_KEYWORDS);

export function lookupSector(query) {
  const keyword = findKeyword(query);
  if (!keyword) return null;
  const sector = SECTOR_BY_KEYWORD.get(keyword);
  return { sector, members: SECTOR_BASKETS[sector].members.map((m) => ({ ...m })) };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --test tests/sectors.test.js`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/providers/sectors.js tests/sectors.test.js
git commit -m "feat: add sector basket dictionary"
```

---

### Task 3: 회사 디렉터리와 스냅샷

**Files:**
- Create: `lib/providers/directory.js`, `scripts/refresh-directory.js`, `data/us-tickers.json`
- Create: `tests/fixtures/directory-us.json`, `tests/fixtures/directory-kr.json`
- Modify: `lib/providers/aliases.js` (CIK 제거, `cikForSymbol` 제거는 Task 7에서)
- Modify: `package.json` (devDependency `adm-zip`)
- Test: `tests/directory.test.js`

**Interfaces:**
- Consumes: `createMatcher` (Task 1)
- Produces:
  - `createDirectory({ us?: UsRow[], kr?: KrRow[] })` → `{ size: { us, kr }, bySymbol(symbol), findInQuery(query, { reserved?: Set<string> }) }`
  - `UsRow = [ticker, cik10, title]`, `KrRow = [name, stockCode6, corpCode8]`
  - 조회 결과: `{ symbol, name, assetType: 'stock', market: 'US', cik }` 또는 `{ symbol: '005930', name, assetType: 'stock', market: 'KR', corpCode }` 또는 null
  - `loadDirectory({ dataDir?: string, log? })` → `createDirectory(...)` 결과. 파일이 없거나 형식이 틀리면 경고 후 빈 목록.
  - 스냅샷 파일 형식: `{ "source": string, "fetchedAt": ISO string, "rows": Row[] }`

- [ ] **Step 1: 픽스처 작성**

`tests/fixtures/directory-us.json`:

```json
{
  "source": "fixture",
  "fetchedAt": "2026-11-08T00:00:00.000Z",
  "rows": [
    ["NVDA", "0001045810", "NVIDIA CORP"],
    ["AAPL", "0000320193", "Apple Inc."],
    ["GM", "0001467858", "General Motors Co"],
    ["PLTR", "0001321655", "Palantir Technologies Inc."],
    ["AI", "0001577526", "C3.ai, Inc."],
    ["TSM", "0001046179", "TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD"]
  ]
}
```

`tests/fixtures/directory-kr.json`:

```json
{
  "source": "fixture",
  "fetchedAt": "2026-11-08T00:00:00.000Z",
  "rows": [
    ["삼성전자", "005930", "00126380"],
    ["SK하이닉스", "000660", "00164779"],
    ["한화에어로스페이스", "012450", "00126566"],
    ["대상", "001680", "00117212"],
    ["에코프로비엠", "247540", "01160363"]
  ]
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/directory.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDirectory, loadDirectory, normalizeUsName } from '../lib/providers/directory.js';

const rows = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')).rows;
const dir = () => createDirectory({ us: rows('directory-us.json'), kr: rows('directory-kr.json') });

test('bySymbol: 미국 티커로 CIK를 찾는다', () => {
  assert.deepEqual(dir().bySymbol('nvda'), {
    symbol: 'NVDA', name: 'NVIDIA CORP', assetType: 'stock', market: 'US', cik: '0001045810',
  });
});

test('bySymbol: 한국 종목코드는 접미사가 있든 없든 찾는다', () => {
  assert.equal(dir().bySymbol('005930.KS').corpCode, '00126380');
  assert.equal(dir().bySymbol('005930').corpCode, '00126380');
  assert.equal(dir().bySymbol('247540.KQ').name, '에코프로비엠');
});

test('bySymbol: 없으면 null', () => {
  assert.equal(dir().bySymbol('ZZZZ'), null);
  assert.equal(dir().bySymbol('999999.KS'), null);
});

test('findInQuery: 한국 회사명(3자 이상)을 찾는다', () => {
  assert.equal(dir().findInQuery('한화에어로스페이스 수주')?.corpCode, '00126566');
});

test('findInQuery: 2자 한국 회사명은 오탐 위험 때문에 보지 않는다', () => {
  assert.equal(dir().findInQuery('투자 대상 기업'), null);
});

test('findInQuery: 대문자 단어만 미국 티커로 본다', () => {
  assert.equal(dir().findInQuery('PLTR 실적')?.symbol, 'PLTR');
  assert.equal(dir().findInQuery('pltr 실적'), null);
});

test('findInQuery: 예약어(분야 키워드)는 티커로 보지 않는다', () => {
  assert.equal(dir().findInQuery('AI 전망', { reserved: new Set(['ai']) }), null);
});

test('findInQuery: 미국 영문 회사명으로 찾는다', () => {
  assert.equal(dir().findInQuery('palantir technologies 계약')?.symbol, 'PLTR');
  assert.equal(dir().findInQuery('General Motors 판매')?.symbol, 'GM');
});

test('normalizeUsName은 법인 접미사를 뗀다', () => {
  assert.equal(normalizeUsName('NVIDIA CORP'), 'nvidia');
  assert.equal(normalizeUsName('Apple Inc.'), 'apple');
  assert.equal(normalizeUsName('General Motors Co'), 'general motors');
});

test('loadDirectory: 파일이 없으면 경고하고 빈 디렉터리', () => {
  const warnings = [];
  const d = loadDirectory({ dataDir: mkdtempSync(join(tmpdir(), 'dir-')), log: { warn: (...a) => warnings.push(a) } });
  assert.deepEqual(d.size, { us: 0, kr: 0 });
  assert.equal(warnings.length, 2);
});

test('loadDirectory: 형식이 틀리면 경고하고 그 목록만 비운다', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dir-'));
  writeFileSync(join(dataDir, 'us-tickers.json'), JSON.stringify({ rows: [['NVDA', '0001045810', 'NVIDIA CORP']] }));
  writeFileSync(join(dataDir, 'kr-listed.json'), '{"rows": "깨짐"}');
  const warnings = [];
  const d = loadDirectory({ dataDir, log: { warn: (...a) => warnings.push(a) } });
  assert.deepEqual(d.size, { us: 1, kr: 0 });
  assert.equal(warnings.length, 1);
});
```

- [ ] **Step 3: 실패 확인**

Run: `node --import tsx --test tests/directory.test.js`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: `lib/providers/directory.js` 구현**

```js
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMatcher } from './match.js';

// ─── 회사 디렉터리 ───
//
// SEC company_tickers.json과 OpenDART corpCode.xml의 스냅샷을 쓴다.
// 서버는 실행 중에 회사 목록을 내려받지 않는다(OpenDART 목록은 압축 해제 시 약 25MB).
// 갱신은 scripts/refresh-directory.js로 한다.

const DEFAULT_DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');

const US_SUFFIXES = new Set([
  'inc', 'corp', 'corporation', 'co', 'company', 'ltd', 'plc', 'holdings', 'holding',
  'group', 'class', 'a', 'b', 'c', 'sa', 'nv', 'ag', 'se', 'lp', 'llc', '/de/', '/new/',
]);

/** "NVIDIA CORP" → "nvidia". 영문명 대조용이다. */
export function normalizeUsName(title) {
  const words = String(title).toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
  while (words.length > 1 && US_SUFFIXES.has(words.at(-1))) words.pop();
  if (words.length > 1 && words[0] === 'the') words.shift();
  return words.join(' ');
}

// 짧은 이름은 일반 단어와 겹친다("대상", "ai"). 일정 길이 미만은 이름 대조에서 뺀다.
// 그런 회사는 별칭 사전이나 티커로 찾는다.
const MIN_KR_NAME = 3;
const MIN_US_NAME = 4;

export function createDirectory({ us = [], kr = [] } = {}) {
  const usByTicker = new Map(us.map(([ticker, cik, title]) => [String(ticker).toUpperCase(), { cik, title }]));
  const usByName = new Map();
  for (const [ticker, , title] of us) {
    const n = normalizeUsName(title);
    if (n.length >= MIN_US_NAME && !usByName.has(n)) usByName.set(n, String(ticker).toUpperCase());
  }

  const krByCode = new Map(kr.map(([name, stockCode, corpCode]) => [stockCode, { name, corpCode }]));
  const krByName = new Map();
  for (const [name, stockCode] of kr) {
    const k = String(name).toLowerCase().trim();
    if (k.length >= MIN_KR_NAME && !krByName.has(k)) krByName.set(k, stockCode);
  }

  const findKr = createMatcher([...krByName.keys()]);
  const findUs = createMatcher([...usByName.keys()]);

  const usInstrument = (ticker) => {
    const e = usByTicker.get(ticker);
    return e ? { symbol: ticker, name: e.title, assetType: 'stock', market: 'US', cik: e.cik } : null;
  };
  const krInstrument = (code) => {
    const e = krByCode.get(code);
    return e ? { symbol: code, name: e.name, assetType: 'stock', market: 'KR', corpCode: e.corpCode } : null;
  };

  return {
    size: { us: usByTicker.size, kr: krByCode.size },

    bySymbol(symbol) {
      const s = String(symbol ?? '').toUpperCase();
      const kr6 = s.match(/^(\d{6})(?:\.(KS|KQ))?$/)?.[1];
      if (kr6) return krInstrument(kr6);
      return usInstrument(s);
    },

    findInQuery(query, { reserved = new Set() } = {}) {
      const krKey = findKr(query);
      if (krKey && !reserved.has(krKey)) return krInstrument(krByName.get(krKey));

      // 티커는 대문자로 입력한 단어만 본다. "apple"을 티커로 보면 안 된다.
      for (const word of String(query).split(/[\s,.;:!?()]+/)) {
        if (/^[A-Z]{1,5}$/.test(word) && !reserved.has(word.toLowerCase()) && usByTicker.has(word)) {
          return usInstrument(word);
        }
      }

      const usKey = findUs(query);
      if (usKey && !reserved.has(usKey)) return usInstrument(usByName.get(usKey));
      return null;
    },
  };
}

const isRow = (row, length) => Array.isArray(row) && row.length === length && row.every((v) => typeof v === 'string');

function readRows(path, length, log) {
  try {
    const body = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(body?.rows) || !body.rows.every((r) => isRow(r, length))) {
      log?.warn?.({ path }, '디렉터리 스냅샷 형식이 올바르지 않다. 이 목록 없이 동작한다');
      return [];
    }
    return body.rows;
  } catch (error) {
    log?.warn?.({ path, err: error.message }, '디렉터리 스냅샷을 읽지 못했다. 이 목록 없이 동작한다');
    return [];
  }
}

export function loadDirectory({ dataDir = DEFAULT_DATA_DIR, log } = {}) {
  return createDirectory({
    us: readRows(join(dataDir, 'us-tickers.json'), 3, log),
    kr: readRows(join(dataDir, 'kr-listed.json'), 3, log),
  });
}
```

- [ ] **Step 5: 통과 확인**

Run: `node --import tsx --test tests/directory.test.js`
Expected: PASS

- [ ] **Step 6: 갱신 스크립트 작성**

Run: `npm install --save-dev adm-zip`

`scripts/refresh-directory.js`:

```js
#!/usr/bin/env node
// 회사 디렉터리 스냅샷을 갱신한다. 사람이 가끔 실행한다.
// 사용법: node scripts/refresh-directory.js [us|kr|all]
//   us: SEC company_tickers.json (키 불필요, RESEARCH_CONTACT_EMAIL 권장)
//   kr: OpenDART corpCode.xml (OPENDART_API_KEY 필요)
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const target = process.argv[2] ?? 'all';

const write = (file, source, rows) => {
  writeFileSync(join(DATA_DIR, file), `${JSON.stringify({ source, fetchedAt: new Date().toISOString(), rows })}\n`, 'utf8');
  console.log(`${file}: ${rows.length}개`);
};

async function refreshUs() {
  const source = 'https://www.sec.gov/files/company_tickers.json';
  const contact = process.env.RESEARCH_CONTACT_EMAIL || 'contact-not-set';
  // SEC는 연락처가 담긴 User-Agent를 요구한다.
  const res = await fetch(source, { headers: { 'User-Agent': `eco-si-news-analyze/1.0 (${contact})` } });
  if (!res.ok) throw new Error(`SEC HTTP ${res.status}`);
  const body = await res.json();
  const rows = Object.values(body).map((e) => [String(e.ticker), String(e.cik_str).padStart(10, '0'), String(e.title)]);
  write('us-tickers.json', source, rows);
}

const tag = (xml, name) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]?.trim() ?? '';

async function refreshKr() {
  const key = process.env.OPENDART_API_KEY;
  if (!key) {
    console.log('kr: OPENDART_API_KEY가 없어 건너뜀');
    return;
  }
  const res = await fetch(`https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`OpenDART HTTP ${res.status}`);
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  const entry = zip.getEntries().find((e) => e.entryName.toUpperCase().endsWith('.XML'));
  if (!entry) throw new Error('OpenDART 응답에 XML이 없다(키 오류면 ZIP 대신 오류 XML이 온다)');
  const xml = entry.getData().toString('utf8');
  const rows = [];
  for (const [, block] of xml.matchAll(/<list>([\s\S]*?)<\/list>/g)) {
    const stockCode = tag(block, 'stock_code');
    if (!/^\d{6}$/.test(stockCode)) continue;   // 비상장사 제외
    rows.push([tag(block, 'corp_name'), stockCode, tag(block, 'corp_code')]);
  }
  write('kr-listed.json', 'https://opendart.fss.or.kr/api/corpCode.xml', rows);
}

if (target === 'us' || target === 'all') await refreshUs();
if (target === 'kr' || target === 'all') await refreshKr();
```

- [ ] **Step 7: 미국 스냅샷 생성 (실네트워크, 키 불필요)**

Run: `mkdir -p data && node scripts/refresh-directory.js us`
Expected: `us-tickers.json: 10000개 안팎` 출력. `data/us-tickers.json` 크기가 1MB 미만인지 확인한다(`ls -l data/us-tickers.json`).

Run: `node -e "const d=require('./data/us-tickers.json'); console.log(d.rows.find(r=>r[0]==='NVDA'))"`
Expected: `[ 'NVDA', '0001045810', 'NVIDIA CORP' ]`

- [ ] **Step 8: `aliases.js`에서 CIK 제거**

`SYMBOL_ALIASES`의 모든 항목에서 `cik: '...'` 속성을 지운다. CIK는 이제 디렉터리가 준다. `cikForSymbol`은 서버가 아직 쓰므로 Task 7에서 지운다. 지금은 `cikForSymbol`이 항상 null을 돌려주게 되지만 Task 7 전까지 서버의 재무 테스트가 깨지지 않도록, 이 단계에서는 **`cikForSymbol` 본문을 디렉터리 기반으로 바꾸지 말고** 다음 임시 구현으로 둔다.

```js
import { loadDirectory } from './directory.js';

let directory;
/** Task 7에서 제거한다. 그 전까지 서버의 기존 재무 경로를 유지하는 다리다. */
export function cikForSymbol(symbol) {
  if (!symbol) return null;
  directory ??= loadDirectory();
  return directory.bySymbol(symbol)?.cik ?? null;
}
```

Run: `npm test`
Expected: 전체 PASS. `lookupAlias(...).cik`를 기대하는 테스트가 있으면 그 단언을 `cikForSymbol(symbol)`로 바꾼다.

- [ ] **Step 9: 커밋**

```bash
git add lib/providers/directory.js lib/providers/aliases.js scripts/refresh-directory.js data/us-tickers.json tests/directory.test.js tests/fixtures/directory-us.json tests/fixtures/directory-kr.json package.json package-lock.json
git commit -m "feat: add SEC/OpenDART company directory snapshots"
```

---

### Task 4: 종목 해석기

**Files:**
- Create: `lib/resolve.js`
- Test: `tests/resolve.test.js`

**Interfaces:**
- Consumes: `lookupAlias` (Task 1), `lookupSector`, `SECTOR_KEYWORDS` (Task 2), `createDirectory` 결과 (Task 3)
- Produces:
  - `MAX_INSTRUMENTS = 4`
  - `createResolver({ directory })` → `resolveInstruments({ query, symbol?, assetType? })`
  - 반환: `{ kind: 'explicit'|'company'|'sector'|'unresolved', sector?: string, instruments: ResolvedInstrument[] }`
  - `ResolvedInstrument = { symbol, name, assetType, market, cik?, corpCode? }`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/resolve.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDirectory } from '../lib/providers/directory.js';
import { createResolver, MAX_INSTRUMENTS } from '../lib/resolve.js';

const rows = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')).rows;
const resolve = createResolver({
  directory: createDirectory({ us: rows('directory-us.json'), kr: rows('directory-kr.json') }),
});

test('직접 넣은 티커가 가장 우선이고 디렉터리로 보강된다', () => {
  const r = resolve({ query: '반도체', symbol: 'NVDA' });
  assert.equal(r.kind, 'explicit');
  assert.deepEqual(r.instruments, [{
    symbol: 'NVDA', name: 'NVIDIA CORP', assetType: 'stock', market: 'US', cik: '0001045810',
  }]);
});

test('회사명이 분야보다 우선한다', () => {
  const r = resolve({ query: '삼성전자 반도체' });
  assert.equal(r.kind, 'company');
  assert.equal(r.instruments.length, 1);
  assert.equal(r.instruments[0].symbol, '005930.KS');
  assert.equal(r.instruments[0].market, 'KR');
  assert.equal(r.instruments[0].corpCode, '00126380');
});

test('별칭에 없는 회사도 디렉터리로 찾는다', () => {
  const r = resolve({ query: '한화에어로스페이스 수주' });
  assert.equal(r.kind, 'company');
  assert.equal(r.instruments[0].symbol, '012450');
  assert.equal(r.instruments[0].corpCode, '00126566');
});

test('분야만 있으면 묶음이고 각 종목이 보강된다', () => {
  const r = resolve({ query: '반도체 업황' });
  assert.equal(r.kind, 'sector');
  assert.equal(r.sector, '반도체');
  assert.deepEqual(r.instruments.map((i) => i.symbol), ['NVDA', 'TSM', '005930.KS', '000660.KS']);
  assert.equal(r.instruments[0].cik, '0001045810');
  assert.equal(r.instruments[2].corpCode, '00126380');
  assert.ok(r.instruments.length <= MAX_INSTRUMENTS);
});

test('"AI"는 C3.ai 티커가 아니라 AI 분야다', () => {
  const r = resolve({ query: 'AI' });
  assert.equal(r.kind, 'sector');
  assert.equal(r.sector, 'AI');
});

test('메타버스는 META가 아니다', () => {
  assert.equal(resolve({ query: '메타버스 시장' }).kind, 'unresolved');
});

test('코인 묶음은 market이 CRYPTO이고 디렉터리 보강이 없다', () => {
  const r = resolve({ query: '암호화폐 시장' });
  assert.equal(r.kind, 'sector');
  assert.ok(r.instruments.every((i) => i.market === 'CRYPTO' && !i.cik && !i.corpCode));
});

test('아무것도 없으면 unresolved와 빈 배열', () => {
  assert.deepEqual(resolve({ query: '오늘의 경제' }), { kind: 'unresolved', instruments: [] });
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test tests/resolve.test.js`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: `lib/resolve.js` 구현**

```js
import { lookupAlias } from './providers/aliases.js';
import { lookupSector, SECTOR_KEYWORDS } from './providers/sectors.js';

export const MAX_INSTRUMENTS = 4;

/**
 * 검색어 → 종목 배열.
 * 우선순위: 직접 입력한 티커 → 회사(별칭 → 디렉터리) → 분야 묶음 → 없음.
 */
export function createResolver({ directory }) {
  const reserved = new Set(SECTOR_KEYWORDS);

  const enrich = (inst) => {
    if (inst.assetType === 'crypto') {
      return { symbol: inst.symbol, name: inst.name, assetType: 'crypto', market: 'CRYPTO' };
    }
    const found = directory.bySymbol(inst.symbol);
    const market = inst.market ?? found?.market ?? (/^\d{6}/.test(inst.symbol) ? 'KR' : 'US');
    return {
      symbol: inst.symbol,
      name: inst.name,
      assetType: 'stock',
      market,
      ...(found?.cik ? { cik: found.cik } : {}),
      ...(found?.corpCode ? { corpCode: found.corpCode } : {}),
    };
  };

  return function resolveInstruments({ query, symbol, assetType }) {
    if (symbol) {
      const name = directory.bySymbol(symbol)?.name ?? symbol;
      return { kind: 'explicit', instruments: [enrich({ symbol, name, assetType: assetType ?? 'stock' })] };
    }

    const alias = lookupAlias(query);
    if (alias) {
      return { kind: 'company', instruments: [enrich({ symbol: alias.symbol, name: alias.name, assetType: alias.assetType })] };
    }

    const found = directory.findInQuery(query, { reserved });
    if (found) return { kind: 'company', instruments: [enrich(found)] };

    const sector = lookupSector(query);
    if (sector) {
      return { kind: 'sector', sector: sector.sector, instruments: sector.members.slice(0, MAX_INSTRUMENTS).map(enrich) };
    }

    return { kind: 'unresolved', instruments: [] };
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --test tests/resolve.test.js`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/resolve.js tests/resolve.test.js
git commit -m "feat: resolve queries into instrument lists"
```

---

### Task 5: OpenDART 재무 provider와 설정·스키마

**Files:**
- Create: `lib/providers/dart-financial.js`
- Create: `tests/fixtures/dart-samsung-q3.json`
- Modify: `lib/providers/financial.js` (반환에 `source`, `corpCode`)
- Modify: `lib/validation.js` (재무 스키마)
- Modify: `lib/config.js`
- Test: `tests/dart-financial.test.js`, 기존 `tests/config.test.js`, `tests/financial-provider.test.js`, `tests/validation.test.js`, `tests/prompt.test.js`, `tests/postprocess.test.js`, `tests/collect-scope.test.js`

**Interfaces:**
- Produces:
  - `reportCandidates(nowMs, limit = 4): { year, code, period, form, end }[]`
  - `parseDartAccounts(body, { report, year }): { metrics, derived, degraded, rceptNo } | null`
  - `createDartFinancialProvider({ http, cache, clock, makeBreaker, apiKey, log? })` → `{ configured: boolean, fetch({ corpCode, symbol, name }): Promise<{ financial: Financial | null, reason: string | null }> }`
  - `Financial = { source: 'sec'|'dart', symbol, cik: string|null, corpCode: string|null, entityName, filingUrl, metrics, derived, degraded }`
  - config: `opendartApiKey: string`, `dartCacheTtlMs: number`

- [ ] **Step 1: 응답 픽스처 작성**

`tests/fixtures/dart-samsung-q3.json` (OpenDART `fnlttSinglAcnt.json` 응답 형태. 금액은 쉼표 포함 문자열):

```json
{
  "status": "000",
  "message": "정상",
  "list": [
    { "rcept_no": "20261114000123", "bsns_year": "2026", "corp_code": "00126380", "stock_code": "005930", "reprt_code": "11014", "account_nm": "매출액", "fs_div": "CFS", "fs_nm": "연결재무제표", "sj_div": "IS", "sj_nm": "손익계산서", "thstrm_nm": "제 58 기 3분기", "thstrm_dt": "2026.07.01 ~ 2026.09.30", "thstrm_amount": "80,000,000,000,000", "frmtrm_nm": "제 57 기 3분기", "frmtrm_dt": "2025.07.01 ~ 2025.09.30", "frmtrm_amount": "72,000,000,000,000", "currency": "KRW" },
    { "rcept_no": "20261114000123", "bsns_year": "2026", "corp_code": "00126380", "stock_code": "005930", "reprt_code": "11014", "account_nm": "영업이익", "fs_div": "CFS", "fs_nm": "연결재무제표", "sj_div": "IS", "sj_nm": "손익계산서", "thstrm_dt": "2026.07.01 ~ 2026.09.30", "thstrm_amount": "10,000,000,000,000", "frmtrm_dt": "2025.07.01 ~ 2025.09.30", "frmtrm_amount": "9,000,000,000,000", "currency": "KRW" },
    { "rcept_no": "20261114000123", "bsns_year": "2026", "corp_code": "00126380", "stock_code": "005930", "reprt_code": "11014", "account_nm": "당기순이익", "fs_div": "CFS", "fs_nm": "연결재무제표", "sj_div": "IS", "sj_nm": "손익계산서", "thstrm_dt": "2026.07.01 ~ 2026.09.30", "thstrm_amount": "8,000,000,000,000", "frmtrm_dt": "2025.07.01 ~ 2025.09.30", "frmtrm_amount": "7,000,000,000,000", "currency": "KRW" },
    { "rcept_no": "20261114000123", "bsns_year": "2026", "corp_code": "00126380", "stock_code": "005930", "reprt_code": "11014", "account_nm": "자산총계", "fs_div": "CFS", "fs_nm": "연결재무제표", "sj_div": "BS", "sj_nm": "재무상태표", "thstrm_dt": "2026.09.30 현재", "thstrm_amount": "500,000,000,000,000", "frmtrm_dt": "2025.12.31 현재", "frmtrm_amount": "480,000,000,000,000", "currency": "KRW" },
    { "rcept_no": "20261114000123", "bsns_year": "2026", "corp_code": "00126380", "stock_code": "005930", "reprt_code": "11014", "account_nm": "부채총계", "fs_div": "CFS", "fs_nm": "연결재무제표", "sj_div": "BS", "sj_nm": "재무상태표", "thstrm_dt": "2026.09.30 현재", "thstrm_amount": "100,000,000,000,000", "frmtrm_dt": "2025.12.31 현재", "frmtrm_amount": "95,000,000,000,000", "currency": "KRW" },
    { "rcept_no": "20261114000123", "bsns_year": "2026", "corp_code": "00126380", "stock_code": "005930", "reprt_code": "11014", "account_nm": "매출액", "fs_div": "OFS", "fs_nm": "재무제표", "sj_div": "IS", "sj_nm": "손익계산서", "thstrm_dt": "2026.07.01 ~ 2026.09.30", "thstrm_amount": "60,000,000,000,000", "frmtrm_dt": "2025.07.01 ~ 2025.09.30", "frmtrm_amount": "55,000,000,000,000", "currency": "KRW" }
  ]
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`tests/dart-financial.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createDartFinancialProvider, reportCandidates, parseDartAccounts,
} from '../lib/providers/dart-financial.js';
import { createTtlCache, createCircuitBreaker, buildAnalyzeSchema, loadConfig } from '../server.js';
import { makeClock, BASE_ENV } from './helpers.js';

const FIXTURE = readFileSync(new URL('./fixtures/dart-samsung-q3.json', import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-20T00:00:00Z');
const KEY = 'secret-dart-key-123';

const makeHttp = (responder) => {
  const calls = [];
  return {
    calls,
    async get(url) {
      calls.push(url);
      const out = responder(url, calls.length);
      if (out instanceof Error) throw out;
      return { status: 200, text: typeof out === 'string' ? out : JSON.stringify(out), url };
    },
  };
};

const provider = (http, over = {}) => {
  const clock = makeClock(NOW);
  return createDartFinancialProvider({
    http,
    cache: createTtlCache({ ttlMs: 21_600_000, maxEntries: 50, clock }),
    clock,
    makeBreaker: () => createCircuitBreaker({ threshold: 3, cooldownMs: 60_000, clock }),
    apiKey: over.apiKey ?? KEY,
    log: over.log,
  });
};

test('reportCandidates: 기간이 끝난 보고서를 최신순으로 최대 4개', () => {
  assert.deepEqual(
    reportCandidates(Date.parse('2026-11-08T00:00:00Z')).map((c) => `${c.year}:${c.code}`),
    ['2026:11014', '2026:11012', '2026:11013', '2025:11011'],
  );
  assert.deepEqual(
    reportCandidates(Date.parse('2027-01-10T00:00:00Z')).map((c) => `${c.year}:${c.code}`),
    ['2026:11011', '2026:11014', '2026:11012', '2026:11013'],
  );
});

test('parseDartAccounts: 연결재무제표를 우선하고 SEC와 같은 형태로 만든다', () => {
  const [q3] = reportCandidates(NOW);
  const parsed = parseDartAccounts(JSON.parse(FIXTURE), { report: q3, year: 2026 });
  assert.equal(parsed.rceptNo, '20261114000123');
  assert.deepEqual(parsed.metrics.map((m) => m.label), ['매출', '영업이익', '순이익', '자산', '부채']);
  const revenue = parsed.metrics[0];
  assert.equal(revenue.value, 80_000_000_000_000);
  assert.equal(revenue.unit, 'KRW');
  assert.equal(revenue.concept, '매출액 (연결)');
  assert.equal(revenue.periodStart, '2026-07-01');
  assert.equal(revenue.periodEnd, '2026-09-30');
  assert.equal(revenue.fiscalYear, 2026);
  assert.equal(revenue.fiscalPeriod, 'Q3');
  assert.equal(revenue.form, '3분기보고서');
  assert.equal(revenue.filed, '2026-11-14');
  assert.equal(parsed.metrics[3].periodStart, null);
  assert.equal(parsed.metrics[3].periodEnd, '2026-09-30');
});

test('parseDartAccounts: 부채비율과 전년 동기 대비 매출 성장률을 계산한다', () => {
  const [q3] = reportCandidates(NOW);
  const { derived } = parseDartAccounts(JSON.parse(FIXTURE), { report: q3, year: 2026 });
  assert.deepEqual(derived.map((d) => [d.label, d.value]), [
    ['부채비율', 20],
    ['매출 성장률(전년 동기 대비)', 11.11],
  ]);
});

test('parseDartAccounts: 연결이 없으면 개별을 쓴다', () => {
  const body = JSON.parse(FIXTURE);
  body.list = body.list.filter((r) => r.fs_div === 'OFS');
  const parsed = parseDartAccounts(body, { report: reportCandidates(NOW)[0], year: 2026 });
  assert.equal(parsed.metrics[0].concept, '매출액 (개별)');
  assert.equal(parsed.metrics[0].value, 60_000_000_000_000);
  assert.equal(parsed.degraded.length, 4);
});

test('fetch: 정상 응답이면 재무와 공시 링크를 돌려주고 캐시한다', async () => {
  const http = makeHttp(() => FIXTURE);
  const p = provider(http);
  const first = await p.fetch({ corpCode: '00126380', symbol: '005930.KS', name: '삼성전자' });
  assert.equal(first.reason, null);
  assert.equal(first.financial.source, 'dart');
  assert.equal(first.financial.cik, null);
  assert.equal(first.financial.corpCode, '00126380');
  assert.equal(first.financial.entityName, '삼성전자');
  assert.equal(first.financial.filingUrl, 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20261114000123');
  await p.fetch({ corpCode: '00126380', symbol: '005930.KS', name: '삼성전자' });
  assert.equal(http.calls.length, 1);
  assert.ok(http.calls[0].startsWith('https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?'));
  assert.ok(http.calls[0].includes('reprt_code=11014'));
});

test('fetch: 결과가 분석 스키마를 통과한다', async () => {
  const { financial } = await provider(makeHttp(() => FIXTURE)).fetch({ corpCode: '00126380', symbol: '005930.KS', name: '삼성전자' });
  const schema = buildAnalyzeSchema(loadConfig(BASE_ENV));
  const parsed = schema.safeParse({
    newsList: [{ title: 't', content: 'c', source: 's', url: 'https://a.example/1', publishedAt: '2026-11-01T00:00:00Z' }],
    instruments: [{ symbol: '005930.KS', name: '삼성전자', assetType: 'stock', market: 'KR', financial }],
  });
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
});

test('fetch: 013(데이터 없음)이면 다음 보고서로 넘어간다', async () => {
  const http = makeHttp((url) => (url.includes('reprt_code=11014') ? { status: '013', message: '조회된 데이타가 없습니다.' } : FIXTURE));
  const r = await provider(http).fetch({ corpCode: '00126380', symbol: '005930.KS', name: '삼성전자' });
  assert.ok(r.financial);
  assert.equal(http.calls.length, 2);
  assert.ok(http.calls[1].includes('reprt_code=11012'));
});

test('fetch: 모든 후보가 013이면 사유와 함께 null', async () => {
  const http = makeHttp(() => ({ status: '013', message: '없음' }));
  const r = await provider(http).fetch({ corpCode: '00126380' });
  assert.equal(r.financial, null);
  assert.match(r.reason, /최근 보고서/);
  assert.equal(http.calls.length, 4);
});

test('fetch: 키 오류·한도 초과는 사유로 바꾼다', async () => {
  for (const [status, pattern] of [['010', /키/], ['011', /키/], ['020', /한도/], ['800', /오류\(800\)/]]) {
    const r = await provider(makeHttp(() => ({ status, message: 'x' }))).fetch({ corpCode: '00126380' });
    assert.equal(r.financial, null);
    assert.match(r.reason, pattern, status);
  }
});

test('fetch: 키가 없으면 호출하지 않고 사유를 준다', async () => {
  const http = makeHttp(() => FIXTURE);
  const p = provider(http, { apiKey: '' });
  assert.equal(p.configured, false);
  const r = await p.fetch({ corpCode: '00126380' });
  assert.equal(r.financial, null);
  assert.match(r.reason, /OPENDART_API_KEY/);
  assert.equal(http.calls.length, 0);
});

test('fetch: 네트워크 오류 로그에 키가 남지 않는다', async () => {
  const logs = [];
  const http = makeHttp((url) => new Error(`요청 실패: ${url}`));
  const r = await provider(http, { log: { warn: (obj, msg) => logs.push(JSON.stringify(obj) + msg) } })
    .fetch({ corpCode: '00126380' });
  assert.equal(r.financial, null);
  assert.ok(logs.length > 0);
  assert.ok(logs.every((l) => !l.includes(KEY)));
});
```

- [ ] **Step 3: 실패 확인**

Run: `node --import tsx --test tests/dart-financial.test.js`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: `lib/providers/dart-financial.js` 구현**

```js
import { redactKey } from './kci.js';

// ─── OpenDART 단일회사 주요계정 ───
//
// 결과는 SEC provider와 같은 형태다. 화면·프롬프트가 출처를 가리지 않고 다룬다.

const DART_ACCOUNTS = [
  { account: '매출액', label: '매출' },
  { account: '영업이익', label: '영업이익' },
  { account: '당기순이익', label: '순이익' },
  { account: '자산총계', label: '자산' },
  { account: '부채총계', label: '부채' },
];

// 기간 끝이 늦은 순서. reportCandidates가 이 순서로 훑는다.
const REPORTS = [
  { code: '11011', period: 'FY', form: '사업보고서', endMonthDay: '12-31' },
  { code: '11014', period: 'Q3', form: '3분기보고서', endMonthDay: '09-30' },
  { code: '11012', period: 'H1', form: '반기보고서', endMonthDay: '06-30' },
  { code: '11013', period: 'Q1', form: '1분기보고서', endMonthDay: '03-31' },
];

const STATUS_REASON = {
  '010': '한국 재무: OpenDART 키가 등록되지 않았습니다.',
  '011': '한국 재무: OpenDART 키 사용이 중지됐습니다.',
  '012': '한국 재무: OpenDART 키에 허용되지 않은 IP입니다.',
  '020': '한국 재무: OpenDART 호출 한도를 초과했습니다.',
};
const KEY_ERRORS = new Set(['010', '011', '012', '901']);

const dartReason = (status) => STATUS_REASON[status] ?? `한국 재무: OpenDART 오류(${status}).`;

/** 기간이 이미 끝난 보고서 후보를 최신순으로. 아직 안 끝난 기간은 공시가 있을 수 없다. */
export function reportCandidates(nowMs, limit = 4) {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  const out = [];
  for (const y of [year, year - 1, year - 2]) {
    for (const r of REPORTS) {
      const end = `${y}-${r.endMonthDay}`;
      if (end < today) out.push({ year: y, code: r.code, period: r.period, form: r.form, end });
    }
  }
  return out.slice(0, limit);
}

const parseAmount = (raw) => {
  const s = String(raw ?? '').replaceAll(',', '').trim();
  return /^-?\d+$/.test(s) ? Number(s) : null;
};

const iso = (y, m, d) => `${y}-${m}-${d}`;

/** "2026.07.01 ~ 2026.09.30" 또는 "2026.09.30 현재" */
function parsePeriod(dt) {
  const s = String(dt ?? '');
  const range = s.match(/(\d{4})\.(\d{2})\.(\d{2})\s*~\s*(\d{4})\.(\d{2})\.(\d{2})/);
  if (range) return { start: iso(range[1], range[2], range[3]), end: iso(range[4], range[5], range[6]) };
  const point = s.match(/(\d{4})\.(\d{2})\.(\d{2})/);
  return { start: null, end: point ? iso(point[1], point[2], point[3]) : null };
}

const filedFromRcept = (rceptNo) => {
  const m = String(rceptNo ?? '').match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? iso(m[1], m[2], m[3]) : null;
};

const round2 = (n) => Math.round(n * 100) / 100;
const DAY = 86_400_000;

export function parseDartAccounts(body, { report, year }) {
  const list = Array.isArray(body?.list) ? body.list : [];
  const cfs = list.filter((r) => r.fs_div === 'CFS');
  const rows = cfs.length ? cfs : list.filter((r) => r.fs_div === 'OFS');
  if (rows.length === 0) return null;
  const basis = cfs.length ? '연결' : '개별';

  const metrics = [];
  const degraded = [];
  const byLabel = new Map();
  let rceptNo = null;

  for (const spec of DART_ACCOUNTS) {
    const row = rows.find((r) => r.account_nm === spec.account);
    const value = parseAmount(row?.thstrm_amount);
    if (!row || value === null) {
      degraded.push({ concept: spec.account, reason: '이 보고서에 해당 계정이 없습니다.' });
      continue;
    }
    rceptNo ??= row.rcept_no ?? null;
    const period = parsePeriod(row.thstrm_dt);
    metrics.push({
      concept: `${spec.account} (${basis})`,
      label: spec.label,
      value,
      unit: row.currency || 'KRW',
      periodStart: period.start,
      periodEnd: period.end ?? report.end,
      fiscalYear: year,
      fiscalPeriod: report.period,
      form: report.form,
      filed: filedFromRcept(row.rcept_no),
    });
    byLabel.set(spec.label, row);
  }

  if (metrics.length === 0) return null;

  // 부채비율·성장률은 코드가 계산한다. LLM에게 산수를 맡기지 않는다.
  const derived = [];
  const assets = parseAmount(byLabel.get('자산')?.thstrm_amount);
  const liabilities = parseAmount(byLabel.get('부채')?.thstrm_amount);
  if (assets && liabilities !== null) {
    derived.push({
      label: '부채비율',
      value: round2((liabilities / assets) * 100),
      unit: '%',
      basis: `${parsePeriod(byLabel.get('자산').thstrm_dt).end ?? report.end} 기준`,
      formula: '부채 / 자산',
    });
  }

  // 전기 기간이 정확히 1년 전 같은 길이일 때만 성장률을 낸다(SEC findYearAgoFact와 같은 기준).
  const revenueRow = byLabel.get('매출');
  if (revenueRow) {
    const cur = parsePeriod(revenueRow.thstrm_dt);
    const prev = parsePeriod(revenueRow.frmtrm_dt);
    const now = parseAmount(revenueRow.thstrm_amount);
    const before = parseAmount(revenueRow.frmtrm_amount);
    const sameShape = cur.start && cur.end && prev.start && prev.end
      && Math.abs(Date.parse(cur.end) - Date.parse(prev.end) - 365 * DAY) <= 45 * DAY
      && Math.abs((Date.parse(cur.end) - Date.parse(cur.start)) - (Date.parse(prev.end) - Date.parse(prev.start))) <= 20 * DAY;
    if (sameShape && now !== null && before) {
      derived.push({
        label: '매출 성장률(전년 동기 대비)',
        value: round2(((now - before) / Math.abs(before)) * 100),
        unit: '%',
        basis: `${year} ${report.period} 대 ${prev.end} 종료 기간`,
        formula: '(당기 - 전년 동기) / 전년 동기',
      });
    }
  }

  return { metrics, derived, degraded, rceptNo };
}

export function createDartFinancialProvider({ http, cache, clock, makeBreaker, apiKey, log }) {
  const breaker = makeBreaker();
  const configured = Boolean(apiKey);

  return {
    configured,

    async fetch({ corpCode, symbol, name }) {
      if (!configured) return { financial: null, reason: '한국 재무: OPENDART_API_KEY가 설정되지 않았습니다.' };
      if (!/^\d{8}$/.test(String(corpCode ?? ''))) {
        return { financial: null, reason: '한국 재무: 고유번호(corp_code)가 올바르지 않습니다.' };
      }

      const cached = cache.get(corpCode);
      if (cached !== undefined) return cached;

      for (const cand of reportCandidates(clock.now())) {
        if (!breaker.canPass()) {
          return { financial: null, reason: '한국 재무: OpenDART 연속 실패로 잠시 호출을 멈췄습니다.' };
        }
        const url = `https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?crtfc_key=${encodeURIComponent(apiKey)}`
          + `&corp_code=${corpCode}&bsns_year=${cand.year}&reprt_code=${cand.code}`;

        let body;
        try {
          body = JSON.parse((await http.get(url)).text);
        } catch (error) {
          breaker.recordFailure();
          // 오류 메시지에 URL이 섞일 수 있다. URL에는 키가 있다.
          log?.warn?.({ err: redactKey(error?.message ?? error, apiKey) }, 'OpenDART 호출 실패');
          return { financial: null, reason: '한국 재무: OpenDART 응답을 받지 못했습니다.' };
        }

        const status = String(body?.status ?? '');
        if (status === '013') {
          breaker.recordSuccess();
          continue;
        }
        if (status !== '000') {
          if (KEY_ERRORS.has(status)) log?.warn?.({ status }, 'OpenDART 키 오류');
          else breaker.recordFailure();
          return { financial: null, reason: dartReason(status) };   // 오류는 캐시하지 않는다
        }

        breaker.recordSuccess();
        const parsed = parseDartAccounts(body, { report: cand, year: cand.year });
        if (!parsed) continue;

        const result = {
          financial: {
            source: 'dart',
            symbol: symbol ?? null,
            cik: null,
            corpCode,
            entityName: name ?? null,
            filingUrl: parsed.rceptNo ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${parsed.rceptNo}` : null,
            metrics: parsed.metrics,
            derived: parsed.derived,
            degraded: parsed.degraded,
          },
          reason: null,
        };
        cache.set(corpCode, result);
        return result;
      }

      const none = { financial: null, reason: '한국 재무: 최근 보고서에서 주요 계정을 찾지 못했습니다.' };
      cache.set(corpCode, none);
      return none;
    },
  };
}
```

- [ ] **Step 5: 재무 스키마와 SEC provider 확장**

`lib/validation.js`의 `financialSchema`를 다음으로 바꾼다.

```js
const financialSchema = z.strictObject({
  source: z.enum(['sec', 'dart']),
  symbol: nullableString(32),
  cik: nullableString(16),
  corpCode: nullableString(8),
  entityName: nullableString(200),
  filingUrl: httpUrl.nullable(),
  metrics: z.array(financialMetric).max(20),
  derived: z.array(financialDerived).max(10),
  degraded: z.array(z.strictObject({
    concept: z.string().max(120),
    reason: z.string().max(300),
  })).max(20),
});
```

`lib/providers/financial.js`의 반환 객체 맨 앞에 두 필드를 넣는다.

```js
      return {
        source: 'sec',
        symbol: symbol ?? null,
        cik,
        corpCode: null,
        entityName,
        // ...이하 그대로
```

- [ ] **Step 6: 설정 추가**

`lib/config.js`:
- `externalAllowlist` 기본 문자열 끝에 `,opendart.fss.or.kr`를 붙인다.
- `kciApiKey` 아래에 추가한다.

```js
    // 한국 상장사 재무(OpenDART)는 선택 사항이다. 비어 있으면 한국 재무만 사유와 함께 빠진다.
    opendartApiKey: e.OPENDART_API_KEY ?? '',
    dartCacheTtlMs: num(e.DART_CACHE_TTL_MS, 21_600_000),
```

`tests/config.test.js`에 추가한다.

```js
test('OpenDART 키는 선택이고 허용 목록에 OpenDART 도메인이 있다', () => {
  const config = loadConfig(BASE_ENV);
  assert.equal(config.opendartApiKey, '');
  assert.equal(config.dartCacheTtlMs, 21_600_000);
  assert.ok(config.externalAllowlist.includes('opendart.fss.or.kr'));
  assert.equal(loadConfig({ ...BASE_ENV, OPENDART_API_KEY: 'k' }).opendartApiKey, 'k');
});
```

(`loadConfig`, `BASE_ENV` import가 파일에 없으면 `../server.js`, `./helpers.js`에서 가져온다.)

- [ ] **Step 7: 통과 확인과 기존 테스트 이주**

Run: `node --import tsx --test tests/dart-financial.test.js`
Expected: `fetch: 결과가 분석 스키마를 통과한다`만 FAIL(분석 스키마의 `instruments`는 Task 7에서 생긴다). 나머지 PASS. 이 한 테스트는 Task 7에서 통과한다. 지금은 `test.todo`가 아니라 그대로 두고 Task 7 Step 6에서 통과를 확인한다.

Run: `npm test`
Expected: 손으로 만든 재무 객체에 `source`/`corpCode`가 없어 실패하는 테스트가 나온다(`validation`, `prompt`, `postprocess`, `collect-scope`, `financial-provider`, `provider-schema-contract`). 각 픽스처 객체에 `source: 'sec', corpCode: null`을 추가해 통과시킨다. 기대값은 바꾸지 않는다. `dart-financial`의 위 한 건 외에는 전부 PASS여야 한다.

- [ ] **Step 8: 커밋**

```bash
git add lib/providers/dart-financial.js lib/providers/financial.js lib/validation.js lib/config.js tests/
git commit -m "feat: add OpenDART financial provider"
```

---

### Task 6: 종목별 수집 모듈

**Files:**
- Create: `lib/instruments.js`
- Test: `tests/instruments.test.js`

**Interfaces:**
- Consumes: `ResolvedInstrument` (Task 4), market provider `fetch({ symbol, assetType, range }) → { marketData, series, indicators } | null`, SEC provider `fetch({ cik, symbol }) → Financial | null`, DART provider (Task 5)
- Produces:
  - `UNRESOLVED_REASON: string`
  - `collectInstruments({ instruments, wantMarket, wantFinancial, range, market, sec, dart })` → `Promise<{ instruments: CollectedInstrument[], degraded: Degraded[] }>`
  - `CollectedInstrument = { symbol, name, assetType, market, marketData?, series?, financial? }` (cik·corpCode는 싣지 않음. `series`에는 `indicators`가 들어 있다)
  - `Degraded = { provider: 'market'|'financial', symbol?: string, reason: string }`
  - `toAnalysisInstruments(collected) → AnalysisInstrument[]` — 시세·재무가 모두 없는 종목을 빼고 `series`를 제거
  - `relevanceName(analysisInstruments) → string | undefined` — 종목이 하나일 때만 그 `marketData.assetName`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/instruments.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectInstruments, toAnalysisInstruments, relevanceName, UNRESOLVED_REASON,
} from '../lib/instruments.js';

const marketResult = (symbol) => ({
  marketData: { assetName: symbol, currentPrice: '100 USD', priceChange: '1.00%', chartTrend: '상승' },
  series: { symbol, currency: 'USD', points: [{ t: '2026-11-01T00:00:00.000Z', c: 100, v: 1 }] },
  indicators: { changePct: 1 },
});
const secFinancial = (symbol) => ({ source: 'sec', symbol, cik: '1', corpCode: null, entityName: symbol, filingUrl: null, metrics: [{ label: '매출' }], derived: [], degraded: [] });

const deps = (over = {}) => ({
  market: { fetch: async ({ symbol }) => (symbol === 'FAIL' ? null : marketResult(symbol)) },
  sec: { fetch: async ({ symbol }) => secFinancial(symbol) },
  dart: { configured: true, fetch: async ({ symbol }) => ({ financial: { ...secFinancial(symbol), source: 'dart' }, reason: null }) },
  ...over,
});

const NVDA = { symbol: 'NVDA', name: 'NVIDIA', assetType: 'stock', market: 'US', cik: '0001045810' };
const SAMSUNG = { symbol: '005930.KS', name: '삼성전자', assetType: 'stock', market: 'KR', corpCode: '00126380' };
const BTC = { symbol: 'bitcoin', name: '비트코인', assetType: 'crypto', market: 'CRYPTO' };

test('종목마다 시세와 재무를 모으고 내부 식별자는 싣지 않는다', async () => {
  const { instruments, degraded } = await collectInstruments({
    instruments: [NVDA, SAMSUNG], wantMarket: true, wantFinancial: true, range: '1mo', ...deps(),
  });
  assert.deepEqual(degraded, []);
  assert.equal(instruments[0].financial.source, 'sec');
  assert.equal(instruments[1].financial.source, 'dart');
  assert.equal(instruments[0].series.indicators.changePct, 1);
  assert.equal('cik' in instruments[0], false);
  assert.equal('corpCode' in instruments[1], false);
});

test('선택하지 않은 범위는 부르지 않는다', async () => {
  let secCalls = 0;
  const { instruments } = await collectInstruments({
    instruments: [NVDA], wantMarket: true, wantFinancial: false, range: '1mo',
    ...deps({ sec: { fetch: async () => { secCalls += 1; return null; } } }),
  });
  assert.equal(secCalls, 0);
  assert.equal(instruments[0].financial, undefined);
});

test('종목 하나가 실패해도 나머지는 진행하고 사유에 종목을 단다', async () => {
  const { instruments, degraded } = await collectInstruments({
    instruments: [{ ...NVDA, symbol: 'FAIL' }, NVDA], wantMarket: true, wantFinancial: false, range: '1mo', ...deps(),
  });
  assert.equal(instruments[0].marketData, undefined);
  assert.ok(instruments[1].marketData);
  assert.deepEqual(degraded, [{ provider: 'market', symbol: 'FAIL', reason: '시장 데이터를 가져오지 못했습니다.' }]);
});

test('코인은 재무 대상이 아니므로 degraded가 아니다', async () => {
  const { degraded } = await collectInstruments({
    instruments: [BTC], wantMarket: false, wantFinancial: true, range: '1mo', ...deps(),
  });
  assert.deepEqual(degraded, []);
});

test('DART 키가 없으면 한국 종목에 키 사유를 단다', async () => {
  const { degraded } = await collectInstruments({
    instruments: [{ ...SAMSUNG, corpCode: undefined }], wantMarket: false, wantFinancial: true, range: '1mo',
    ...deps({ dart: { configured: false, fetch: async () => assert.fail('부르면 안 된다') } }),
  });
  assert.equal(degraded.length, 1);
  assert.match(degraded[0].reason, /OPENDART_API_KEY/);
});

test('디렉터리에 없는 종목은 출처별 사유를 단다', async () => {
  const { degraded } = await collectInstruments({
    instruments: [{ ...NVDA, cik: undefined }, { ...SAMSUNG, corpCode: undefined }],
    wantMarket: false, wantFinancial: true, range: '1mo', ...deps(),
  });
  assert.match(degraded[0].reason, /SEC/);
  assert.match(degraded[1].reason, /스냅샷/);
});

test('SEC가 null이면 사유를 단다', async () => {
  const { degraded } = await collectInstruments({
    instruments: [NVDA], wantMarket: false, wantFinancial: true, range: '1mo',
    ...deps({ sec: { fetch: async () => null } }),
  });
  assert.deepEqual(degraded, [{ provider: 'financial', symbol: 'NVDA', reason: 'SEC 제출 서류에서 재무지표를 찾지 못했습니다.' }]);
});

test('toAnalysisInstruments: series를 빼고 자료 없는 종목을 뺀다', () => {
  const out = toAnalysisInstruments([
    { symbol: 'A', name: 'A', assetType: 'stock', market: 'US', marketData: { assetName: 'A' }, series: { points: [] } },
    { symbol: 'B', name: 'B', assetType: 'stock', market: 'US' },
  ]);
  assert.deepEqual(out, [{ symbol: 'A', name: 'A', assetType: 'stock', market: 'US', marketData: { assetName: 'A' } }]);
});

test('relevanceName: 종목이 하나일 때만 자산명을 준다', () => {
  assert.equal(relevanceName([{ marketData: { assetName: 'NVDA' } }]), 'NVDA');
  assert.equal(relevanceName([{ marketData: { assetName: 'A' } }, { marketData: { assetName: 'B' } }]), undefined);
  assert.equal(relevanceName([]), undefined);
});

test('UNRESOLVED_REASON은 입력 예시를 담는다', () => {
  assert.match(UNRESOLVED_REASON, /반도체/);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test tests/instruments.test.js`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: `lib/instruments.js` 구현**

```js
// ─── 종목별 시세·재무 수집 ───
//
// 종목 하나가 실패해도 나머지로 진행한다. 실패 사유는 종목 단위로 남긴다.

export const UNRESOLVED_REASON = '종목을 찾지 못했습니다. 회사명이나 분야(예: 반도체, AI)를 함께 입력해 주세요.';

const MARKET_FAILED = '시장 데이터를 가져오지 못했습니다.';
const SEC_EMPTY = 'SEC 제출 서류에서 재무지표를 찾지 못했습니다.';
const SEC_UNKNOWN = 'SEC 디렉터리에 없는 종목입니다. SEC EDGAR는 미국 상장사만 다룹니다.';
const KR_KEY_MISSING = '한국 재무: OPENDART_API_KEY가 설정되지 않았습니다.';
const KR_UNKNOWN = '한국 재무: 종목 디렉터리에 없습니다. 스냅샷 갱신이 필요합니다.';

async function financialFor(inst, { sec, dart }) {
  if (inst.assetType === 'crypto') return { financial: null, reason: null };
  if (inst.market === 'KR') {
    if (!dart.configured) return { financial: null, reason: KR_KEY_MISSING };
    if (!inst.corpCode) return { financial: null, reason: KR_UNKNOWN };
    return dart.fetch({ corpCode: inst.corpCode, symbol: inst.symbol, name: inst.name });
  }
  if (!inst.cik) return { financial: null, reason: SEC_UNKNOWN };
  const financial = await sec.fetch({ cik: inst.cik, symbol: inst.symbol });
  return financial ? { financial, reason: null } : { financial: null, reason: SEC_EMPTY };
}

export async function collectInstruments({
  instruments, wantMarket, wantFinancial, range, market, sec, dart,
}) {
  const results = await Promise.all(instruments.map(async (inst) => {
    const [m, f] = await Promise.all([
      wantMarket ? market.fetch({ symbol: inst.symbol, assetType: inst.assetType, range }) : null,
      wantFinancial ? financialFor(inst, { sec, dart }) : { financial: null, reason: null },
    ]);

    const degraded = [];
    if (wantMarket && !m) degraded.push({ provider: 'market', symbol: inst.symbol, reason: MARKET_FAILED });
    if (f.reason) degraded.push({ provider: 'financial', symbol: inst.symbol, reason: f.reason });

    const out = { symbol: inst.symbol, name: inst.name, assetType: inst.assetType, market: inst.market };
    if (m) {
      out.marketData = m.marketData;
      // 차트용. 프롬프트·cacheKey에는 넣지 않는다.
      out.series = { ...m.series, indicators: m.indicators };
    }
    if (f.financial) out.financial = f.financial;
    return { out, degraded };
  }));

  return {
    instruments: results.map((r) => r.out),
    degraded: results.flatMap((r) => r.degraded),
  };
}

/**
 * 분석 입력 형태. 클라이언트(client/src/api/client.js)가 같은 규칙으로 되돌려 보낸다.
 * 규칙이 어긋나면 cacheKey가 달라져 확인 토큰이 428로 거부된다.
 */
export function toAnalysisInstruments(collected) {
  return collected
    .filter((i) => i.marketData || i.financial)
    .map(({ series, ...rest }) => rest);
}

/** 뉴스 관련도 점수용 이름. 종목이 여럿이면 특정 종목에 치우치지 않게 쓰지 않는다. */
export function relevanceName(analysisInstruments) {
  return analysisInstruments?.length === 1 ? analysisInstruments[0].marketData?.assetName : undefined;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --test tests/instruments.test.js`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/instruments.js tests/instruments.test.js
git commit -m "feat: collect market and financial data per instrument"
```

---

### Task 7: 수집·분석 경로를 종목 배열로 전환

이 작업이 끝나면 서버 API가 새 형태가 된다. 단수 필드를 쓰는 서버 테스트를 함께 옮긴다.

**Files:**
- Modify: `lib/validation.js`, `lib/sections.js`, `lib/prompt.js`, `lib/postprocess.js`, `lib/providers/market.js`, `lib/providers/aliases.js`, `server.js`
- Test: `tests/prompt.test.js`, `tests/postprocess.test.js`, `tests/validation.test.js`, `tests/research.test.js`, `tests/collect-scope.test.js`, `tests/market-provider.test.js`, `tests/provider-schema-contract.test.js`, 새 `tests/sector-collect.test.js`

**Interfaces:**
- Consumes: Task 3~6 전부
- Produces:
  - 분석 스키마: `{ newsList, instruments?: AnalysisInstrument[1..4], sector?: string(≤40), analysisPeriod?, research?, experiments? }` (`marketData`, `financial` 최상위 필드 없음)
  - `financialEntries(instruments) → { sourceId: 'F1'.., instrument, financial }[]` (sections.js)
  - `formatFinancialSection(entries, esc)`, `buildUserPrompt({ items, instruments, sector, collectedAt, analysisPeriod, research, experiments })`
  - `buildExtraSources({ research, experiments, instruments, collectedAt })`, `collectUrlWhitelist({ items, research, experiments, instruments })`
  - 수집 응답: `instruments: CollectedInstrument[]`(빈 배열 가능), `collected.resolution: { kind, sector?, symbols }`, `collected.financialMetricCount`(합계). `marketData`, `marketSeries`, `financial`, `collected.resolvedSymbol`, `collected.symbolSource` 제거.
  - `createApp({ ..., directory })` 주입 가능. 없으면 `loadDirectory({ log: logger })`.
  - 제거: `market.resolveSymbol`, `cikForSymbol`, `FINANCIAL_SOURCE_ID`

- [ ] **Step 1: 분석 스키마를 instruments로 바꾸는 테스트 작성**

`tests/validation.test.js`에 추가한다(기존 `marketData`/`financial` 최상위 필드 테스트는 Step 7에서 이주).

```js
const NEWS_ONE = [{ title: 't', content: 'c', source: 's', url: 'https://a.example/1', publishedAt: '2026-11-01T00:00:00Z' }];
const MD = { assetName: 'NVDA', currentPrice: '100 USD', priceChange: '1%', chartTrend: '상승' };

test('분석 스키마는 instruments 1~4개와 sector를 받는다', () => {
  const schema = buildAnalyzeSchema(loadConfig(BASE_ENV));
  const inst = (symbol) => ({ symbol, name: symbol, assetType: 'stock', market: 'US', marketData: MD });
  assert.equal(schema.safeParse({ newsList: NEWS_ONE, instruments: [inst('A')], sector: '반도체' }).success, true);
  assert.equal(schema.safeParse({ newsList: NEWS_ONE, instruments: ['A', 'B', 'C', 'D', 'E'].map(inst) }).success, false);
  assert.equal(schema.safeParse({ newsList: NEWS_ONE, instruments: [] }).success, false);
});

test('분석 스키마는 series와 최상위 marketData를 거부한다', () => {
  const schema = buildAnalyzeSchema(loadConfig(BASE_ENV));
  const withSeries = { symbol: 'A', name: 'A', assetType: 'stock', market: 'US', marketData: MD, series: { points: [] } };
  assert.equal(schema.safeParse({ newsList: NEWS_ONE, instruments: [withSeries] }).success, false);
  assert.equal(schema.safeParse({ newsList: NEWS_ONE, marketData: MD }).success, false);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test tests/validation.test.js`
Expected: 새 테스트 2개 FAIL

- [ ] **Step 3: 분석 스키마 변경**

`lib/validation.js`의 `buildAnalyzeSchema` 안에서 `marketData` 정의 아래에 종목 스키마를 추가하고 반환 객체를 바꾼다.

```js
  const instrument = z.strictObject({
    symbol: z.string().min(1).max(32),
    name: trimmedString(200),
    assetType: z.enum(['stock', 'crypto']),
    market: z.enum(['US', 'KR', 'CRYPTO']),
    marketData: marketData.optional(),
    financial: financialSchema.optional(),
  });

  return z.strictObject({
    newsList: z.array(article).min(1).max(config.maxNewsItems),
    // 시세·재무 종목 묶음. 이 필드와 sector는 cacheKey에도 들어간다.
    instruments: z.array(instrument).min(1).max(4).optional(),
    sector: z.string().max(40).optional(),
    analysisPeriod: z.string().max(200).optional(),
    research: z.array(researchItemSchema).max(config.maxResearchItems).optional(),
    experiments: z.array(experimentItemSchema).max(config.maxExperimentItems).optional(),
  });
```

- [ ] **Step 4: 프롬프트·출처 테스트 작성**

`tests/prompt.test.js`에 추가한다. import가 없으면 넣는다: `buildUserPrompt`, `DATA_END`는 `../server.js`에서, `financialEntries`는 `../lib/sections.js`에서.

```js
const fin = (name, source) => ({
  source, symbol: name, cik: source === 'sec' ? '1' : null, corpCode: source === 'dart' ? '00126380' : null,
  entityName: name, filingUrl: source === 'dart' ? 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=1' : null,
  metrics: [{ concept: '매출액 (연결)', label: '매출', value: 1, unit: 'KRW', periodStart: null, periodEnd: '2026-09-30', fiscalYear: 2026, fiscalPeriod: 'Q3', form: '3분기보고서', filed: '2026-11-14' }],
  derived: [], degraded: [],
});
const ITEMS = [{ sourceId: 'S1', title: 't', source: 's', publishedAt: '2026-11-01', url: 'https://a.example/1', content: 'c' }];
const MD2 = (n) => ({ assetName: n, currentPrice: '1 USD', priceChange: '1%', chartTrend: `${n} 추세` });

test('financialEntries: 재무가 있는 종목에만 F1부터 순서대로', () => {
  const entries = financialEntries([
    { symbol: 'A', name: 'A', financial: fin('A', 'sec') },
    { symbol: 'B', name: 'B' },
    { symbol: 'C', name: 'C', financial: fin('C', 'dart') },
  ]);
  assert.deepEqual(entries.map((e) => [e.sourceId, e.instrument.symbol]), [['F1', 'A'], ['F2', 'C']]);
});

test('buildUserPrompt: 종목마다 시장 한 줄, 재무 블록에 출처 ID와 출처명', () => {
  const user = buildUserPrompt({
    items: ITEMS, collectedAt: '2026-11-08T00:00:00Z',
    instruments: [
      { symbol: 'NVDA', name: 'NVIDIA', assetType: 'stock', market: 'US', marketData: MD2('NVDA'), financial: fin('NVIDIA', 'sec') },
      { symbol: '005930.KS', name: '삼성전자', assetType: 'stock', market: 'KR', marketData: MD2('005930.KS'), financial: fin('삼성전자', 'dart') },
    ],
  });
  assert.ok(user.includes('- NVIDIA (NVDA) | 1 USD | 1% | NVDA 추세'));
  assert.ok(user.includes('- 삼성전자 (005930.KS) | 1 USD | 1% | 005930.KS 추세'));
  assert.ok(user.includes('(SEC EDGAR, 출처 ID: F1)'));
  assert.ok(user.includes('(OpenDART, 출처 ID: F2)'));
});

test('buildUserPrompt: 분야 묶음 안내는 데이터 구획 밖에 둔다', () => {
  const user = buildUserPrompt({
    items: ITEMS, collectedAt: '2026-11-08T00:00:00Z', sector: '반도체',
    instruments: [{ symbol: 'A', name: 'A', assetType: 'stock', market: 'US', marketData: MD2('A') }],
  });
  const afterData = user.slice(user.indexOf(DATA_END));
  assert.ok(afterData.includes("'반도체' 분야 대표 종목 1개"));
  assert.ok(afterData.includes('종목 간 비교'));
});

test('buildUserPrompt: 종목이 없으면 시장·재무가 자료 부족', () => {
  const user = buildUserPrompt({ items: ITEMS, collectedAt: '2026-11-08T00:00:00Z' });
  assert.ok(user.includes('자료 부족 — 시장 데이터가 제공되지 않았습니다'));
  assert.ok(user.includes('자료 부족 — 이번 요청에 재무지표가 포함되지 않았습니다'));
});
```

`tests/postprocess.test.js`에 추가한다.

```js
test('buildExtraSources: 종목별 재무 출처를 F1..Fn으로 만든다', () => {
  const finOf = (name, source, url) => ({ source, symbol: name, cik: null, corpCode: null, entityName: name, filingUrl: url, metrics: [{ filed: '2026-11-14' }], derived: [], degraded: [] });
  const sources = buildExtraSources({
    collectedAt: '2026-11-08T00:00:00Z',
    instruments: [
      { symbol: 'NVDA', name: 'NVIDIA', financial: finOf('NVIDIA', 'sec', 'https://www.sec.gov/x') },
      { symbol: '005930.KS', name: '삼성전자', financial: finOf('삼성전자', 'dart', 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=1') },
    ],
  });
  assert.deepEqual(sources.map((s) => [s.sourceId, s.source, s.title]), [
    ['F1', 'SEC EDGAR', 'NVIDIA SEC 제출 서류'],
    ['F2', 'OpenDART', '삼성전자 DART 공시'],
  ]);
});

test('collectUrlWhitelist: DART 공시 링크를 포함한다', () => {
  const url = 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=1';
  const urls = collectUrlWhitelist({ instruments: [{ financial: { filingUrl: url, metrics: [{}] } }] });
  assert.ok(urls.has(url));
});
```

- [ ] **Step 5: sections·prompt·postprocess 구현**

`lib/sections.js`: `FINANCIAL_SOURCE_ID` export를 지우고 다음을 추가, `formatFinancialSection`을 교체한다.

```js
const FINANCIAL_SOURCE_LABEL = { sec: 'SEC EDGAR', dart: 'OpenDART' };

/** 재무가 있는 종목에 F1부터 출처 ID를 붙인다. 프롬프트와 출처 목록이 같은 함수를 쓴다. */
export function financialEntries(instruments) {
  let n = 0;
  return (instruments ?? [])
    .filter((inst) => inst.financial?.metrics?.length > 0)
    .map((inst) => ({ sourceId: `F${++n}`, instrument: inst, financial: inst.financial }));
}

export const financialSourceLabel = (financial) => FINANCIAL_SOURCE_LABEL[financial.source] ?? 'SEC EDGAR';

function formatOneFinancial({ sourceId, instrument, financial }, esc) {
  const lines = [
    `- 대상: ${esc(instrument.name ?? financial.entityName ?? financial.symbol ?? '미상')} (${financialSourceLabel(financial)}, 출처 ID: ${sourceId})`,
  ];
  for (const m of financial.metrics) {
    // 기준 기간을 값과 붙여 쓴다. 떼어 놓으면 어느 분기 숫자인지 잃어버린다.
    const basis = [
      m.fiscalYear ? `FY${m.fiscalYear}${m.fiscalPeriod ? ` ${m.fiscalPeriod}` : ''}` : null,
      m.form,
      m.filed ? `${m.filed} 제출` : null,
    ].filter(Boolean).join(', ');
    lines.push(`- ${esc(m.label)} (${esc(m.concept)}): ${Number(m.value).toLocaleString('en-US')} ${esc(m.unit)} [${basis}]`);
  }
  for (const d of financial.derived) {
    lines.push(`- ${esc(d.label)} (계산값): ${d.value}${esc(d.unit)} = ${esc(d.formula)} [${esc(d.basis)}]`);
  }
  for (const d of financial.degraded) {
    lines.push(`- ${esc(d.concept)}: 자료 부족 — ${esc(d.reason)}`);
  }
  if (financial.filingUrl) lines.push(`- 제출 서류: ${esc(financial.filingUrl)}`);
  return lines.join('\n');
}

export function formatFinancialSection(entries, esc) {
  if (!entries || entries.length === 0) return EMPTY_FINANCIAL;
  return entries.map((e) => formatOneFinancial(e, esc)).join('\n\n');
}
```

`lib/prompt.js`:
- import에 `financialEntries`를 추가한다.
- `buildUserPrompt` 시그니처를 `{ items, instruments, sector, collectedAt, analysisPeriod, research, experiments }`로 바꾼다.
- 시장 구획과 재무 구획을 교체한다.

```js
  const withMarket = (instruments ?? []).filter((i) => i.marketData);
  const market = withMarket.length > 0
    ? withMarket.map((i) => [
        `- ${esc(i.name)} (${esc(i.symbol)})`,
        esc(i.marketData.currentPrice),
        esc(i.marketData.priceChange),
        esc(i.marketData.chartTrend),
      ].join(' | ')).join('\n')
    : '자료 부족 — 시장 데이터가 제공되지 않았습니다. 차트 관련 분석은 자료 부족으로 표시하세요.';

  const financialSection = formatFinancialSection(financialEntries(instruments), esc);
```

- `[데이터 수집 기준]` 목록 끝(`- 실험 자료 수: ...` 다음 줄)에 분야 안내를 붙인다. 데이터 구획 밖이므로 지시로 읽힌다.

```js
- 실험 자료 수: ${experiments?.length ?? 0}${sector
    ? `\n- 분야 묶음: '${esc(sector)}' 분야 대표 종목 ${instruments?.length ?? 0}개입니다. 보고서에 종목 간 비교를 포함하세요.`
    : ''}`;
```

`lib/postprocess.js`: import `financialEntries`, `financialSourceLabel` from `./sections.js`. `buildExtraSources`의 시그니처를 `{ research = [], experiments = [], instruments = [], collectedAt }`로 바꾸고 재무 블록을 교체한다.

```js
  for (const { sourceId, instrument, financial } of financialEntries(instruments)) {
    const isDart = financial.source === 'dart';
    sources.push({
      sourceId,
      title: `${instrument.name ?? financial.entityName ?? financial.symbol ?? '기업'} ${isDart ? 'DART 공시' : 'SEC 제출 서류'}`,
      source: financialSourceLabel(financial),
      url: financial.filingUrl,
      publishedAt: financial.metrics[0]?.filed ?? null,
      collectedAt,
      type: 'financial',
      relevance: 0,
    });
  }
```

`collectUrlWhitelist`의 시그니처를 `{ items = [], research = [], experiments = [], instruments = [] }`로 바꾸고 마지막 줄을 교체한다.

```js
  for (const inst of instruments) if (inst?.financial?.filingUrl) urls.add(inst.financial.filingUrl);
```

`lib/postprocess.js`가 `./sections.js`를 import해도 순환이 생기지 않는다(sections.js는 아무것도 import하지 않는다).

- [ ] **Step 6: 서버 배선 교체**

`lib/providers/market.js`: `searchSymbol`, `isAscii`, `resolveSymbol`, `lookupAlias`/`SYMBOL_ALIASES` import와 맨 아래 re-export를 지운다. `fetch`만 남긴다.

`lib/providers/aliases.js`: Task 3의 임시 `cikForSymbol`과 `loadDirectory` import를 지운다.

`server.js`:
- import 교체: `cikForSymbol` 제거. 추가:

```js
import { loadDirectory } from './lib/providers/directory.js';
import { createResolver } from './lib/resolve.js';
import { createDartFinancialProvider } from './lib/providers/dart-financial.js';
import {
  collectInstruments, toAnalysisInstruments, relevanceName, UNRESOLVED_REASON,
} from './lib/instruments.js';
```

- re-export 교체: `SYMBOL_ALIASES, lookupAlias, cikForSymbol` → `SYMBOL_ALIASES, lookupAlias`. sections re-export의 `FINANCIAL_SOURCE_ID` → `financialEntries`. 다음을 추가한다.

```js
export { createDirectory, loadDirectory } from './lib/providers/directory.js';
export { createResolver, MAX_INSTRUMENTS } from './lib/resolve.js';
export { createDartFinancialProvider, reportCandidates, parseDartAccounts } from './lib/providers/dart-financial.js';
export { lookupSector, SECTOR_BASKETS } from './lib/providers/sectors.js';
```

- `createApp({ env = {}, clock, llm, http, extraRoutes, directory } = {})`로 받는다.
- `financialProvider` 생성 바로 아래에 추가한다.

```js
  const dartProvider = createDartFinancialProvider({
    http: httpClient,
    cache: createTtlCache({ ttlMs: config.dartCacheTtlMs, maxEntries: 200, clock: now }),
    clock: now,
    makeBreaker: makeProviderBreaker,
    apiKey: config.opendartApiKey,
    log: logger,
  });
  const resolveInstruments = createResolver({ directory: directory ?? loadDirectory({ log: logger }) });
```

- 수집 핸들러(`const resolved = await marketProvider.resolveSymbol(...)`부터 시장·재무 degraded 처리까지)를 교체한다.

```js
      const resolution = resolveInstruments({ query, symbol, assetType });
      const single = resolution.kind === 'explicit' || resolution.kind === 'company';
      const wantMarket = wanted('market');
      const wantFinancial = wanted('financial');

      // 선택된 provider만 호출한다. 하나가 느리거나 실패해도 나머지로 진행한다.
      const [news, collectedInstruments, researchResult, experimentResult] = await Promise.all([
        newsProvider.search({ query, lang, limit: maxNews, symbol: single ? resolution.instruments[0].symbol : undefined }),
        collectInstruments({
          instruments: resolution.instruments,
          wantMarket, wantFinancial, range,
          market: marketProvider, sec: financialProvider, dart: dartProvider,
        }),
        wanted('research')
          ? researchProvider.search({ query, limit: config.maxResearchItems })
          : null,
        wanted('experiments')
          ? experimentProvider.search({ query, limit: config.maxExperimentItems })
          : null,
      ]);
```

뉴스 0건 처리 블록의 로그 객체에서 `symbol: resolved.symbol`을 `resolution: resolution.kind`로 바꾼다.

```js
      const degraded = news.degraded.map((d) => ({ provider: 'news', ...d }));
      if (resolution.kind === 'unresolved') {
        if (wantMarket) degraded.push({ provider: 'market', reason: UNRESOLVED_REASON });
        if (wantFinancial) degraded.push({ provider: 'financial', reason: UNRESOLVED_REASON });
      }
      degraded.push(...collectedInstruments.degraded);
      for (const inst of collectedInstruments.instruments) {
        for (const d of inst.financial?.degraded ?? []) {
          degraded.push({ provider: 'financial', symbol: inst.symbol, reason: `${d.concept}: ${d.reason}` });
        }
      }
```

기존의 `for (const d of financialResult?.degraded ?? [])` 루프는 위 루프로 대체되므로 지운다. research·experiments 루프는 그대로 둔다.

`const financial = ...`, `marketData`, `marketSeries` 계산을 지우고 다음으로 바꾼다.

```js
      const analysisInstruments = toAnalysisInstruments(collectedInstruments.instruments);
      const instruments = analysisInstruments.length > 0 ? analysisInstruments : undefined;
      const sector = resolution.kind === 'sector' ? resolution.sector : undefined;
```

정규화·프롬프트·cacheKey를 바꾼다.

```js
      const { items, duplicatesRemoved } =
        normalizeNewsList(newsList, { assetName: relevanceName(analysisInstruments) });
      const collectedAt = new Date(now.now()).toISOString();
      const userPrompt = buildUserPrompt({
        items, instruments, sector, collectedAt,
        research: assignResearchIds(research ?? []),
        experiments: assignExperimentIds(experiments ?? []),
      });
      // ...견적 계산 그대로...
      const cacheKey = hashRequest({
        items, instruments, sector, analysisPeriod: undefined,
        research, experiments,
        model: config.openaiModel,
      });
```

`res.json`의 필드를 바꾼다: `marketData`, `marketSeries`, `financial`을 지우고 `instruments: collectedInstruments.instruments`를 넣는다. `collected`에서 `resolvedSymbol`, `symbolSource`를 지우고 다음을 넣는다.

```js
          resolution: {
            kind: resolution.kind,
            ...(resolution.sector ? { sector: resolution.sector } : {}),
            symbols: resolution.instruments.map((i) => i.symbol),
          },
          financialMetricCount: collectedInstruments.instruments
            .reduce((n, i) => n + (i.financial?.metrics.length ?? 0), 0),
```

- 분석 `prepare`를 바꾼다.

```js
    const { newsList, instruments, sector, analysisPeriod, research, experiments } = parsed.data;
    const { items, duplicatesRemoved } =
      normalizeNewsList(newsList, { assetName: relevanceName(instruments) });
    // ...
    const urlWhitelist = collectUrlWhitelist({
      items, research: researchItems, experiments: experimentItems, instruments,
    });
    const userPrompt = buildUserPrompt({
      items, instruments, sector, collectedAt, analysisPeriod,
      research: researchItems, experiments: experimentItems,
    });
    // 반환 객체의 marketData, financial을 instruments로 바꾼다.
      cacheKey: hashRequest({
        items, instruments, sector, analysisPeriod,
        research, experiments,
        model: config.openaiModel,
      }),
```

분석 핸들러의 구조 분해에서 `financial`을 `instruments`로 바꾸고 `buildExtraSources({ research: researchItems, experiments: experimentItems, instruments, collectedAt })`로 호출한다.

- [ ] **Step 7: 기존 서버 테스트 이주**

Run: `npm test`
Expected: 단수 필드를 쓰는 테스트가 실패한다. 다음 규칙으로 옮긴다. 기대 의미는 바꾸지 않는다.

| 이전 | 이후 |
|---|---|
| `res.body.marketData` | `res.body.instruments[0].marketData` |
| `res.body.marketSeries` | `res.body.instruments[0].series` |
| `res.body.financial` | `res.body.instruments[0].financial` |
| `collected.resolvedSymbol === 'X'` | `collected.resolution.symbols[0] === 'X'` |
| `symbolSource: 'explicit'` | `resolution.kind === 'explicit'` |
| `symbolSource: 'alias'` | `resolution.kind === 'company'` |
| `symbolSource: 'unresolved'` / `marketData === undefined` | `resolution.kind === 'unresolved'`, `instruments`가 `[]` |
| 분석 요청 `.send({ newsList, marketData })` | `.send(analysisBody(c.body))` |
| `resolveSymbol` 단위 테스트(`market-provider.test.js`) | 지운다. 같은 의미는 `tests/resolve.test.js`가 다룬다 |
| Yahoo 검색 경로 테스트 | 지운다(기능 제거) |
| `buildUserPrompt({ marketData, financial })` | `buildUserPrompt({ instruments: [{ symbol, name, assetType: 'stock', market: 'US', marketData, financial }] })` |
| `buildExtraSources({ financial })`, `collectUrlWhitelist({ financial })` | `{ instruments: [{ symbol, name, financial }] }` |
| `FINANCIAL_SOURCE_ID` | `'F1'` 리터럴 |
| 계약 테스트 `accept({ financial })` | `accept({ instruments: [{ symbol: 'NVDA', name: 'NVIDIA', assetType: 'stock', market: 'US', financial }] })` |

`tests/research.test.js`와 `tests/collect-scope.test.js` 맨 위에 공통 헬퍼를 둔다. 클라이언트와 같은 규칙이다.

```js
const analysisBody = (c) => {
  const body = { newsList: c.newsList };
  const instruments = (c.instruments ?? [])
    .filter((i) => i.marketData || i.financial)
    .map(({ series, ...rest }) => rest);
  if (instruments.length) body.instruments = instruments;
  if (c.collected?.resolution?.sector) body.sector = c.collected.resolution.sector;
  if (c.research?.length) body.research = c.research;
  if (c.experiments?.length) body.experiments = c.experiments;
  return body;
};
```

이 두 파일의 서버 부트스트랩에는 디렉터리를 주입한다(실제 `data/`에 의존하지 않게).

```js
import { createDirectory } from '../server.js';
const DIRECTORY = createDirectory({
  us: [['NVDA', '0001045810', 'NVIDIA CORP']],
  kr: [['삼성전자', '005930', '00126380']],
});
```

`bootstrap`/`createApp` 호출에 `directory: DIRECTORY`를 넘긴다(`tests/helpers.js`의 `bootstrap`이 `directory`를 `createApp`으로 전달하도록 시그니처를 `{ env, clock, llm, http, extraRoutes, directory }`로 넓힌다).

Run: `npm test`
Expected: 전체 PASS. Task 5에서 남겨 둔 `dart-financial`의 스키마 통과 테스트도 이제 PASS.

- [ ] **Step 8: 분야 수집 통합 테스트 작성**

`tests/sector-collect.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { createDirectory } from '../server.js';
import { bootstrap, makeClock, makeMockLlm, TEST_PASSWORD } from './helpers.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const DART = fixture('dart-samsung-q3.json');
const meta = (code, exchange, nation, currency) => JSON.stringify({
  itemCode: code, symbolCode: code, reutersCode: code,
  currencyType: { code: currency }, stockExchangeType: { code: exchange, name: exchange === 'KS' ? 'KOSPI' : 'NASDAQ', nationCode: nation },
  marketStatus: 'CLOSE', closePrice: '100',
});
const CHART = JSON.stringify([
  { localDate: '20261105', closePrice: 100, accumulatedTradingVolume: 1 },
  { localDate: '20261106', closePrice: 101, accumulatedTradingVolume: 1 },
]);

const makeHttp = () => {
  const calls = [];
  return {
    calls,
    async get(url) {
      calls.push(url);
      if (url.includes('news.google.com') || url.includes('yna.co.kr') || url.includes('etnews.com')) {
        return { status: 200, text: fixture('google-news-ko.xml'), url };
      }
      if (url.includes('opendart.fss.or.kr')) return { status: 200, text: DART, url };
      if (url.includes('/chart/')) return { status: 200, text: CHART, url };
      if (url.includes('m.stock.naver.com/api/stock/005930')) return { status: 200, text: meta('005930', 'KS', 'KOR', 'KRW'), url };
      // 나머지 종목의 네이버 메타데이터는 "지원 안 함"으로 중립 응답한다.
      // 예외를 던지면 공유 회로차단기가 열려 삼성전자 시세까지 막힐 수 있다.
      if (url.includes('stock.naver.com/')) return { status: 200, text: '{}', url };
      throw new Error(`라우트 없음: ${url}`);
    },
  };
};

const DIRECTORY = createDirectory({
  us: [['NVDA', '0001045810', 'NVIDIA CORP']],
  kr: [['삼성전자', '005930', '00126380'], ['SK하이닉스', '000660', '00164779']],
});

const login = async (app) => {
  const res = await request(app).post('/api/auth/login').send({ password: TEST_PASSWORD });
  return res.body.token;
};

test('분야 검색은 묶음 종목 배열과 resolution을 돌려준다', async () => {
  const { app } = bootstrap({
    clock: makeClock(Date.parse('2026-11-20T03:00:00Z')),
    llm: makeMockLlm(() => ({ content: '{}', model: 'mock' })),
    http: makeHttp(),
    directory: DIRECTORY,
    env: { OPENDART_API_KEY: 'k' },
  });
  const token = await login(app);
  const res = await request(app).post('/api/research/collect')
    .set('Authorization', `Bearer ${token}`)
    .send({ query: '반도체 업황', include: ['news', 'market', 'financial'] });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.collected.resolution, {
    kind: 'sector', sector: '반도체', symbols: ['NVDA', 'TSM', '005930.KS', '000660.KS'],
  });
  assert.equal(res.body.instruments.length, 4);
  const samsung = res.body.instruments.find((i) => i.symbol === '005930.KS');
  assert.equal(samsung.financial.source, 'dart');
  assert.ok(samsung.marketData);
  // TSM은 디렉터리에 없다 → 재무 사유가 종목 단위로 남는다.
  assert.ok(res.body.collected.degraded.some((d) => d.provider === 'financial' && d.symbol === 'TSM'));
  assert.equal(res.body.marketData, undefined);
  assert.equal(res.body.financial, undefined);
});

test('분석 요청에 같은 규칙으로 되돌려 보내면 확인 토큰이 통한다', async () => {
  const llm = makeMockLlm(() => ({ content: JSON.stringify({ summary: '요약', newsBriefing: [], trendAnalysis: '', scenarios: [], risks: [], monitoringIndicators: [], disclaimer: '면책' }), model: 'mock' }));
  const { app } = bootstrap({
    clock: makeClock(Date.parse('2026-11-20T03:00:00Z')), llm, http: makeHttp(), directory: DIRECTORY,
    env: { OPENDART_API_KEY: 'k' },
  });
  const token = await login(app);
  const c = await request(app).post('/api/research/collect')
    .set('Authorization', `Bearer ${token}`)
    .send({ query: '반도체 업황', include: ['news', 'market', 'financial'] });

  const instruments = c.body.instruments.filter((i) => i.marketData || i.financial).map(({ series, ...rest }) => rest);
  const res = await request(app).post('/api/analyze/news')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Confirm-Token', c.body.confirmToken)
    .send({ newsList: c.body.newsList, instruments, sector: '반도체' });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(llm.calls[0].user.includes("'반도체' 분야 대표 종목"));
  assert.ok(res.body.sources.some((s) => s.source === 'OpenDART'));
});

test('종목을 못 찾으면 instruments가 비고 안내 사유가 붙는다', async () => {
  const { app } = bootstrap({
    clock: makeClock(Date.parse('2026-11-20T03:00:00Z')),
    llm: makeMockLlm(() => ({ content: '{}', model: 'mock' })),
    http: makeHttp(), directory: DIRECTORY,
  });
  const token = await login(app);
  const res = await request(app).post('/api/research/collect')
    .set('Authorization', `Bearer ${token}`)
    .send({ query: '메타버스 시장', include: ['news', 'market', 'financial'] });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.instruments, []);
  assert.equal(res.body.collected.resolution.kind, 'unresolved');
  assert.ok(res.body.collected.degraded.some((d) => d.provider === 'market' && /반도체, AI/.test(d.reason)));
});
```

Run: `node --import tsx --test tests/sector-collect.test.js`
Expected: PASS. 네이버 메타데이터 응답 필드 검증(`validMetadata`)에 픽스처가 맞지 않아 시세가 null이면, 시세 단언은 `samsung.marketData` 대신 `degraded`에 `provider: 'market', symbol: '005930.KS'`가 **없는지**로 바꾸지 말고, `tests/research.test.js` 상단의 `NAVER_META` 형식을 참고해 픽스처를 고쳐서 통과시킨다.

- [ ] **Step 9: 전체 통과 확인과 커밋**

Run: `npm test`
Expected: 전체 PASS

```bash
git add lib/ server.js tests/
git commit -m "feat: switch collect and analyze to instrument lists"
```

---

### Task 8: 화면 전환과 비교표

**Files:**
- Create: `client/src/components/InstrumentComparison.jsx`
- Modify: `client/src/api/client.js`, `client/src/App.jsx`, `client/src/pages/ReviewPage.jsx`, `client/src/pages/ReportPage.jsx`, `client/src/components/SourceSummary.jsx`, `client/src/components/FinancialMetrics.jsx`, `client/src/components/ScopePicker.jsx`, `client/src/styles/app.css`
- Test: `tests/client/instrument-comparison.test.jsx`, 기존 `tests/client/*.test.*`

**Interfaces:**
- Consumes: 수집 응답 `instruments`, `collected.resolution`, `collected.degraded[].symbol` (Task 7)
- Produces:
  - `api.analyze({ newsList, instruments, sector, research, experiments, confirmToken })`
  - `<InstrumentComparison instruments resolution degraded />`
  - `ReportPage` props: `{ report, instruments, research, experiments, collectedMeta, onNewSearch }`

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/client/instrument-comparison.test.jsx`:

```jsx
import 'global-jsdom/register';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, cleanup } from '@testing-library/react';
import InstrumentComparison, { compactNumber } from '../../client/src/components/InstrumentComparison.jsx';
import { createApiClient } from '../../client/src/api/client.js';

afterEach(cleanup);

const md = (price, change) => ({ assetName: 'x', currentPrice: price, priceChange: change, chartTrend: 't' });
const fin = (unit) => ({
  source: unit === 'KRW' ? 'dart' : 'sec', symbol: 'x', cik: null, corpCode: null, entityName: 'x', filingUrl: null,
  metrics: [
    { concept: 'a', label: '매출', value: 80_000_000_000_000, unit, periodStart: null, periodEnd: null, fiscalYear: 2026, fiscalPeriod: 'Q3', form: null, filed: null },
    { concept: 'b', label: '영업이익', value: 10_000_000_000_000, unit, periodStart: null, periodEnd: null, fiscalYear: 2026, fiscalPeriod: 'Q3', form: null, filed: null },
  ],
  derived: [], degraded: [],
});

const INSTRUMENTS = [
  { symbol: 'NVDA', name: 'NVIDIA', assetType: 'stock', market: 'US', marketData: md('182.5 USD', '2.30%'), financial: fin('USD') },
  { symbol: '005930.KS', name: '삼성전자', assetType: 'stock', market: 'KR', marketData: md('70,000 KRW', '-1.00%'), financial: fin('KRW') },
  { symbol: 'TSM', name: 'TSMC', assetType: 'stock', market: 'US' },
  { symbol: 'bitcoin', name: '비트코인', assetType: 'crypto', market: 'CRYPTO', marketData: md('90,000 USD', '0.50%') },
];

test('compactNumber는 조·억 단위로 줄인다', () => {
  assert.equal(compactNumber(80_000_000_000_000), '80.0조');
  assert.equal(compactNumber(130_000_000_000), '1,300억');
  assert.equal(compactNumber(1234), '1,234');
});

test('분야 안내와 종목별 행을 그린다', () => {
  render(<InstrumentComparison instruments={INSTRUMENTS} resolution={{ kind: 'sector', sector: '반도체', symbols: [] }}
    degraded={[{ provider: 'financial', symbol: 'TSM', reason: 'SEC 디렉터리에 없는 종목입니다.' }]} />);
  assert.ok(screen.getByText('반도체 분야 대표 종목 4개'));
  assert.ok(screen.getByText('NVIDIA'));
  assert.ok(screen.getByText('80.0조 KRW'));
  assert.ok(screen.getByText('SEC 디렉터리에 없는 종목입니다.'));
  assert.ok(screen.getByText('재무 해당 없음'));
});

test('통화를 섞어 환산하지 않는다', () => {
  render(<InstrumentComparison instruments={INSTRUMENTS} resolution={{ kind: 'sector', sector: '반도체', symbols: [] }} degraded={[]} />);
  assert.ok(screen.getByText('80.0조 USD'));
  assert.ok(screen.getByText('80.0조 KRW'));
});

test('api.analyze는 series와 자료 없는 종목을 빼고 sector를 싣는다', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({}), headers: { get: () => null } }; };
  await createApiClient({ fetchImpl }).analyze({
    newsList: [{ title: 'a' }],
    instruments: [
      { symbol: 'A', name: 'A', assetType: 'stock', market: 'US', marketData: md('1', '1%'), series: { points: [] } },
      { symbol: 'B', name: 'B', assetType: 'stock', market: 'US' },
    ],
    sector: '반도체',
    confirmToken: 'ct',
  });
  const body = JSON.parse(calls[0].opts.body);
  assert.deepEqual(body.instruments, [{ symbol: 'A', name: 'A', assetType: 'stock', market: 'US', marketData: md('1', '1%') }]);
  assert.equal(body.sector, '반도체');
});

test('api.analyze는 종목이 없으면 instruments 필드를 뺀다', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, json: async () => ({}), headers: { get: () => null } }; };
  await createApiClient({ fetchImpl }).analyze({ newsList: [{ title: 'a' }], instruments: [], confirmToken: 'ct' });
  const body = JSON.parse(calls[0].opts.body);
  assert.equal('instruments' in body, false);
  assert.equal('sector' in body, false);
});
```

(`fetchImpl` 응답 형태가 `tests/client/api-client.test.js`의 가짜 응답과 다르면 그 파일의 헬퍼를 그대로 복사해 쓴다.)

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test tests/client/instrument-comparison.test.jsx`
Expected: FAIL — 컴포넌트 없음

- [ ] **Step 3: `InstrumentComparison.jsx` 구현**

```jsx
const LABELS = ['매출', '영업이익', '순이익'];

/** 큰 금액을 조·억으로 줄인다. 통화는 바꾸지 않는다. */
export function compactNumber(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(1)}조`;
  if (a >= 1e8) return `${Math.round(v / 1e8).toLocaleString('ko-KR')}억`;
  return v.toLocaleString('ko-KR');
}

const metricCell = (financial, label) => {
  const m = financial?.metrics.find((x) => x.label === label);
  return m ? `${compactNumber(m.value)} ${m.unit}` : '—';
};

export default function InstrumentComparison({ instruments, resolution, degraded = [] }) {
  if (!instruments?.length) return null;
  const reasonsFor = (symbol) => degraded.filter((d) => d.symbol === symbol).map((d) => d.reason);

  return (
    <section className="card">
      <h2 className="card-title">
        {resolution?.sector ? `${resolution.sector} 분야 대표 종목 ${instruments.length}개` : `종목 ${instruments.length}개`}
      </h2>
      <p className="muted small">통화는 종목별 원래 단위입니다. 환산하지 않았습니다.</p>
      <div className="table-scroll">
        <table className="metrics comparison">
          <thead>
            <tr>
              <th scope="col">종목</th>
              <th scope="col">현재가</th>
              <th scope="col">변동률</th>
              {LABELS.map((l) => <th scope="col" key={l}>{l}</th>)}
              <th scope="col">비고</th>
            </tr>
          </thead>
          <tbody>
            {instruments.map((inst) => (
              <tr key={inst.symbol}>
                <th scope="row"><span>{inst.name}</span> <span className="muted small">{inst.symbol}</span></th>
                <td>{inst.marketData?.currentPrice ?? '—'}</td>
                <td>{inst.marketData?.priceChange ?? '—'}</td>
                {LABELS.map((l) => <td key={l}>{metricCell(inst.financial, l)}</td>)}
                <td className="muted small">
                  {inst.assetType === 'crypto' && <span>재무 해당 없음</span>}
                  {reasonsFor(inst.symbol).map((r) => <span key={r}>{r}</span>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

`client/src/styles/app.css` 끝에 추가한다.

```css
.table-scroll { overflow-x: auto; }
.comparison td span + span { display: block; }
.chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
```

- [ ] **Step 4: api 클라이언트 변경**

`client/src/api/client.js`의 `analyze`를 교체한다.

```js
    analyze: ({ newsList, instruments, sector, research, experiments, confirmToken }) => {
      // 받은 자료를 그대로 되돌려 보낸다. 서버 lib/instruments.js의 toAnalysisInstruments와
      // 같은 규칙이어야 cacheKey가 일치한다: 시세·재무가 모두 없는 종목은 빼고 series는 지운다.
      // 빈 자료는 필드를 아예 넣지 않는다.
      const body = { newsList };
      const analysisInstruments = (instruments ?? [])
        .filter((i) => i.marketData || i.financial)
        .map(({ series, ...rest }) => rest);
      if (analysisInstruments.length) body.instruments = analysisInstruments;
      if (sector) body.sector = sector;
      if (research?.length) body.research = research;
      if (experiments?.length) body.experiments = experiments;
      return call('/api/analyze/news', {
        method: 'POST',
        body,
        headers: { 'X-Confirm-Token': confirmToken },
      });
    },
```

- [ ] **Step 5: 페이지·컴포넌트 변경**

`client/src/App.jsx`:
- `approve`의 인자와 `api.analyze` 호출에서 `marketData, financial`을 `instruments, sector`로 바꾼다.
- `ReportPage`에 `series`, `marketData`, `financial` 대신 `instruments={collected?.instruments}`를 넘긴다.

`client/src/pages/ReviewPage.jsx`:

```jsx
import InstrumentComparison from '../components/InstrumentComparison.jsx';
// ...
  const {
    newsList, instruments = [], research, experiments,
    collected: meta, estimate, confirmToken,
  } = collected;
  const sector = meta?.resolution?.sector;
  const single = instruments.length === 1 ? instruments[0] : null;
```

시장 카드를 다음으로 바꾼다.

```jsx
      {instruments.length > 1 && (
        <InstrumentComparison instruments={instruments} resolution={meta?.resolution} degraded={meta?.degraded} />
      )}
      {single?.marketData && (
        <section className="card">
          <h2 className="card-title">시장 데이터</h2>
          <p>
            <strong>{single.name}</strong> {single.marketData.currentPrice}
            {' '}<span className="change">{single.marketData.priceChange}</span>
          </p>
          <p className="muted small">{single.marketData.chartTrend}</p>
        </section>
      )}
```

재무 카드는 종목이 하나이거나 없을 때만 그린다(묶음은 비교표가 대신한다).

```jsx
      {meta?.included?.includes('financial') && instruments.length <= 1 && (
        <FinancialMetrics financial={single?.financial} collected={meta} />
      )}
```

승인 버튼의 `onApprove` 인자를 `{ newsList, instruments, sector, research, experiments, confirmToken }`로 바꾼다.

`client/src/pages/ReportPage.jsx`:

```jsx
import InstrumentComparison from '../components/InstrumentComparison.jsx';
import { emptySectionMessage } from '../lib/dataSection.js';

export default function ReportPage({
  report, instruments = [], research, experiments, collectedMeta, onNewSearch,
}) {
  if (!report) return null;
  const { analysis, sources, meta } = report;
  const single = instruments.length === 1 ? instruments[0] : null;

  return (
    <main className="page">
      {/* 차트가 맨 위. 뉴스와 차트를 대조하는 것이 이 보고서의 핵심이다. */}
      {instruments.length > 1 ? (
        <>
          <InstrumentComparison instruments={instruments} resolution={collectedMeta?.resolution} degraded={collectedMeta?.degraded} />
          <div className="chart-grid">
            {instruments.map((inst) => (
              <MarketChart key={inst.symbol} series={inst.series} marketData={inst.marketData} />
            ))}
          </div>
        </>
      ) : collectedMeta?.resolution?.kind === 'unresolved' ? (
        // 종목을 못 찾았을 때 "가격 데이터가 없습니다"만 보이면 왜 비었는지 모른다.
        <section className="card">
          <h2 className="card-title">시장 데이터</h2>
          <p className="muted small">{emptySectionMessage('market', collectedMeta)}</p>
        </section>
      ) : (
        <MarketChart series={single?.series} marketData={single?.marketData} />
      )}

      <InsightReport analysis={analysis} degraded={Boolean(meta?.degraded)} />

      {collectedMeta?.included?.includes('financial') && instruments.length <= 1 && (
        <FinancialMetrics financial={single?.financial} collected={collectedMeta} />
      )}
      {/* 이하 research, experiments, SourceCitation, Disclaimer, 버튼은 그대로 */}
```

`client/src/components/SourceSummary.jsx`:

```jsx
const RESOLUTION_LABEL = {
  explicit: '직접 입력', company: '회사', sector: '분야 묶음', unresolved: '해석 실패',
};
// ...
        <div>
          <strong>
            {collected.resolution?.kind === 'sector'
              ? `${collected.resolution.sector} ${collected.resolution.symbols.length}종목`
              : collected.resolution?.symbols?.[0] ?? '—'}
          </strong>
          <span>종목 ({RESOLUTION_LABEL[collected.resolution?.kind] ?? '—'})</span>
        </div>
```

degraded 목록 항목을 종목 표시가 붙도록 바꾼다.

```jsx
              {PROVIDER_LABEL[d.provider] ?? d.provider}{d.symbol ? ` (${d.symbol})` : ''}: {d.reason}
```

`SOURCE_LABEL` 상수는 지운다.

`client/src/components/FinancialMetrics.jsx`: 출처 표기를 바꾼다.

```jsx
            {financial.entityName ?? financial.symbol} · {financial.source === 'dart' ? 'OpenDART' : 'SEC EDGAR'}
```

링크 문구를 `{financial.source === 'dart' ? '공시 원문 보기' : '제출 서류 보기'}`로 바꾼다.

`client/src/components/ScopePicker.jsx`: 재무 힌트를 `'미국(SEC)·한국(OpenDART) 상장사'`로 바꾼다.

`client/src/lib/dataSection.js`: 주석 "재무는 언어와 무관하게 미국 상장사 여부로만 갈린다"를 "재무는 언어와 무관하게 종목 해석 결과로만 갈린다"로 바꾼다. 코드는 그대로다.

- [ ] **Step 6: 기존 화면 테스트 이주와 통과 확인**

Run: `npm test`
Expected: `tests/client/`의 단수 필드 테스트가 실패한다. Task 7 Step 7의 표와 같은 규칙으로 옮긴다. 추가 규칙:

| 이전 | 이후 |
|---|---|
| 픽스처 `COLLECTED.marketData`, `marketSeries`, `financial` | `instruments: [{ symbol: 'NVDA', name: 'NVIDIA', assetType: 'stock', market: 'US', marketData, series, financial }]` |
| `collected.resolvedSymbol/symbolSource` | `collected.resolution: { kind: 'explicit', symbols: ['NVDA'] }` |
| `<ReportPage series marketData financial>` | `<ReportPage instruments={[...]}>` |
| `onApprove` 인자 `got.marketData` | `got.instruments` |
| api-client `marketData` 생략 테스트 | `instruments`가 비면 생략되는지로 바꾼다 |

Run: `npm test && npm run build:client`
Expected: 전체 PASS, 빌드 성공

- [ ] **Step 7: 커밋**

```bash
git add client/ tests/client/
git commit -m "feat: show sector baskets with comparison table"
```

---

### Task 9: 배포 설정·검증 스크립트·문서

**Files:**
- Modify: `render.yaml`, `scripts/verify-research.sh`, `docs/api.md`, `docs/SESSION-HANDOFF.md`, `.env.example`(있으면)
- Test: `tests/deployment.test.js`

**Interfaces:**
- Consumes: Task 7의 응답 형태

- [ ] **Step 1: 배포 설정**

`render.yaml`의 `OPENAI_API_KEY` 항목 아래에 추가한다.

```yaml
      # 한국 상장사 재무(OpenDART). 비어 있으면 한국 재무만 사유와 함께 빠진다.
      # Render 대시보드에서 입력한다. 저장소에 넣지 않는다.
      - key: OPENDART_API_KEY
        sync: false
```

`.env.example`이 있으면 `OPENDART_API_KEY=`를 추가한다.

Run: `node --import tsx --test tests/deployment.test.js`
Expected: PASS. 환경변수 목록을 고정 비교하는 테스트가 있으면 기대 목록에 `OPENDART_API_KEY`를 추가한다.

- [ ] **Step 2: `verify-research.sh` 갱신**

2단계의 필드 추출을 새 형태로 바꾼다.

```bash
HAS_MARKET=$(field 'v.instruments && v.instruments[0] && v.instruments[0].marketData ? 1 : 0' < "$TMP/collect.json")
TREND=$(field 'v.instruments && v.instruments[0] && v.instruments[0].marketData ? v.instruments[0].marketData.chartTrend.slice(0,70) : "(없음)"' < "$TMP/collect.json")
FIN=$(field 'v.instruments ? v.instruments.reduce((n,i)=>n+(i.financial?i.financial.metrics.length:0),0) : 0' < "$TMP/collect.json")
```

3단계 분석 본문 생성을 클라이언트와 같은 규칙으로 바꾼다.

```bash
node -e "
  const c = require(process.argv[1]);
  const body = { newsList: c.newsList };
  const inst = (c.instruments || []).filter(i => i.marketData || i.financial).map(({ series, ...rest }) => rest);
  if (inst.length) body.instruments = inst;
  if (c.collected && c.collected.resolution && c.collected.resolution.sector) body.sector = c.collected.resolution.sector;
  if (c.research && c.research.length) body.research = c.research;
  if (c.experiments && c.experiments.length) body.experiments = c.experiments;
  require('fs').writeFileSync(process.argv[2], JSON.stringify(body), 'utf8');
" "$TMP/collect.json" "$TMP/analyze-body.json"
```

스크립트 끝(최종 집계 출력 바로 앞)에 분야·해석 검증 단계를 추가한다. 단계 번호는 기존 마지막 번호 다음으로 매긴다. 이 단계는 수집만 하므로 LLM 비용이 없다.

```bash
collect_query() {
  node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({ query: process.argv[2], lang: 'ko', maxNews: 5, include: ['news','market','financial'] }), 'utf8');" "$TMP/q.json" "$1"
  curl -sS -o "$TMP/q-out.json" -w '%{http_code}' -X POST "$BASE/api/research/collect" \
    -H 'Content-Type: application/json; charset=utf-8' -H "Authorization: Bearer $TOKEN" \
    --data-binary @"$TMP/q.json"
}

echo "N. 분야 묶음과 회사 해석 (수집만, LLM 비용 없음)"
collect_query '반도체 업황' > /dev/null
check "반도체 → 분야 묶음" "sector" "$(field 'v.collected.resolution.kind' < "$TMP/q-out.json")"
check "반도체 → 종목 4개" "4" "$(field 'v.instruments.length' < "$TMP/q-out.json")"
check "반도체 → 시세 확보 종목 수" "4" "$(field 'v.instruments.filter(i => i.marketData).length' < "$TMP/q-out.json")"

collect_query '엔비디아 실적' > /dev/null
check "엔비디아 → SEC 재무" "sec" "$(field 'v.instruments[0].financial ? v.instruments[0].financial.source : \"\"' < "$TMP/q-out.json")"

collect_query '메타버스 시장' > /dev/null
check "메타버스 → META 아님" "unresolved" "$(field 'v.collected.resolution.kind' < "$TMP/q-out.json")"

collect_query '삼성전자 실적' > /dev/null
DART_SRC=$(field 'v.instruments[0].financial ? v.instruments[0].financial.source : ""' < "$TMP/q-out.json")
if [ -n "${OPENDART_EXPECTED:-}" ]; then
  check "삼성전자 → DART 재무" "dart" "$DART_SRC"
else
  echo "  (참고) 삼성전자 재무 출처: ${DART_SRC:-없음} — OPENDART_EXPECTED=1이면 dart를 요구한다"
fi
```

(`field`의 eval 문자열 안 따옴표가 셸과 충돌하면 해당 식을 작은따옴표로 감싸고 내부 문자열 리터럴은 큰따옴표 대신 백틱을 쓴다.)

- [ ] **Step 3: 문서 갱신**

`docs/api.md`의 수집 응답·분석 요청 절에서 `marketData`, `marketSeries`, `financial`, `resolvedSymbol`, `symbolSource` 설명을 `instruments`, `collected.resolution`, 분석 요청의 `instruments`/`sector` 설명으로 바꾼다. 형태는 설계 문서 §5의 코드 블록을 그대로 옮긴다.

`docs/SESSION-HANDOFF.md` 맨 위 상태 절에 이번 작업 요약을 추가한다: 브랜치 `feature/sector-baskets-opendart`, 설계·계획 문서 경로, 완료한 Task 번호, 남은 일(Task 10: OpenDART 키 발급 후 `kr-listed.json` 생성과 실검증), 최신 `npm test` 결과 수치. 기존의 작업 디렉터리 경로 수정(미커밋 변경)도 함께 커밋한다.

- [ ] **Step 4: 로컬 실네트워크 검증 (LLM 비용 없음)**

Run (터미널 1): `MY_SECRET_PASSWORD=test-pw LLM_MODE=mock npm start`
Run (터미널 2): `MY_SECRET_PASSWORD=test-pw ./scripts/verify-research.sh`
Expected: 새 단계의 "반도체 → 분야 묶음", "종목 4개", "엔비디아 → SEC 재무", "메타버스 → META 아님" OK. "시세 확보 종목 수"가 4가 아니면 실패한 종목과 `degraded` 사유를 HANDOFF에 기록한다(TSM의 네이버 시세 지원 여부 등). 결과 수치를 HANDOFF에 적는다.

- [ ] **Step 5: 커밋**

```bash
git add render.yaml scripts/verify-research.sh docs/api.md docs/SESSION-HANDOFF.md
git commit -m "docs: document instrument lists and OpenDART setup"
```

---

### Task 10: (OpenDART 키 발급 후) 한국 스냅샷과 실검증

키가 나오기 전에는 실행하지 않는다. 사용자에게 키를 받은 뒤 진행한다.

**Files:**
- Create: `data/kr-listed.json`
- Modify: `docs/SESSION-HANDOFF.md`

- [ ] **Step 1: 로컬 `.env`에 키 추가**

사용자가 `.env`에 `OPENDART_API_KEY=<키>`를 넣는다. 키 값을 출력하거나 커밋하지 않는다.

- [ ] **Step 2: 한국 스냅샷 생성**

Run: `node scripts/refresh-directory.js kr`
Expected: `kr-listed.json: 3500~4000개 안팎`

Run: `node -e "const d=require('./data/kr-listed.json'); console.log(d.rows.find(r=>r[1]==='005930'))"`
Expected: `[ '삼성전자', '005930', '00126380' ]`

- [ ] **Step 3: 전체 테스트**

Run: `npm test`
Expected: 전체 PASS(테스트는 주입한 디렉터리를 쓰므로 스냅샷 추가로 바뀌지 않아야 한다)

- [ ] **Step 4: 실검증**

Run (터미널 1): `MY_SECRET_PASSWORD=test-pw LLM_MODE=mock npm start`
Run (터미널 2): `MY_SECRET_PASSWORD=test-pw OPENDART_EXPECTED=1 ./scripts/verify-research.sh`
Expected: "삼성전자 → DART 재무" OK

- [ ] **Step 5: 커밋**

```bash
git add data/kr-listed.json docs/SESSION-HANDOFF.md
git commit -m "chore: add OpenDART listed company snapshot"
```

- [ ] **Step 6: 배포 후 검증 (사용자 승인 필요)**

PR 병합과 Render 환경변수 `OPENDART_API_KEY` 입력은 사용자가 승인·수행한다. 배포가 Live가 되면:

Run: `MY_SECRET_PASSWORD=<운영 비밀번호> OPENDART_EXPECTED=1 ./scripts/verify-research.sh https://<Render URL>`
Expected: 새 단계 전부 OK. 유료 분석 1회(약 $0.01~0.03)가 포함된다. 결과와 비용을 HANDOFF에 기록한다.
