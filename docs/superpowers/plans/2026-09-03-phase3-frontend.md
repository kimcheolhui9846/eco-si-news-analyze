# Phase 3 프론트엔드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로그인부터 보고서까지 브라우저에서 전 과정이 동작하는 React 프론트엔드를 만든다.

**Architecture:** Vite + React SPA를 빌드해 Express가 정적 서빙한다. 동일 출처라 CORS가 불필요하고 HttpOnly 쿠키가 그대로 동작한다. 화면은 로그인 → 검색 → 검토 → 보고서 4단계 마법사이며, 검토 화면이 비용 승인 지점이다. 차트를 그리기 위해 `collect` 응답에 `marketSeries`를 추가하되 분석 프롬프트에는 넣지 않는다.

**Tech Stack:** React 19, Vite 8, `node:test` + `tsx` 로더 + `global-jsdom` + `@testing-library/react`

## Global Constraints

- **패키지 버전** (전부 실제 설치·실행으로 확인함):
  - 루트 devDeps: `tsx`, `global-jsdom@^29.0.0`, `jsdom@^29.0.0`, `@testing-library/react@^16.3.3`
  - `client/` deps: `react@^19.2.8`, `react-dom@^19.2.8`
  - `client/` devDeps: `vite@^8.2.2`, `@vitejs/plugin-react@^6.1.1`
- **`jsdom`은 반드시 `^29`다.** `global-jsdom@29`의 peer가 `jsdom >=29 <30`이라 `jsdom@30`을 설치하면 `ERESOLVE`로 실패한다. 실제로 겪었다
- **JSX 테스트에는 `tsx` 로더가 필요하다.** Node는 `.jsx`를 파싱하지 못해 `ERR_UNKNOWN_FILE_EXTENSION`이 난다. `node --import tsx --test`로 실행하고, 루트 `tsconfig.json`에 `"jsx": "react-jsx"`를 둔다. 없으면 `ReferenceError: React is not defined`가 난다
- **기존 289개 테스트는 전부 통과해야 한다**
- **`dangerouslySetInnerHTML`을 절대 쓰지 않는다.** LLM 응답은 외부 RSS를 거친 신뢰할 수 없는 입력이다
- **토큰을 JS에 저장하지 않는다.** HttpOnly 쿠키만 쓰고 모든 요청에 `credentials: 'same-origin'`
- **`newsList`·`marketData`를 수정하지 않고 분석에 넘긴다.** 한 글자만 바뀌어도 `cacheKey`가 달라져 확인 토큰이 `428`로 거부된다
- **`marketSeries`를 분석 프롬프트에 넣지 않는다.** 토큰만 늘고 `cacheKey`가 바뀌면 확인 토큰 흐름이 깨진다
- **에러 응답에 `requestId`를 항상 함께 표시한다**
- **커밋**: Conventional Commits, AI 귀속 트레일러 금지. 브랜치 `feature/frontend-ui`
- **세션 핸드오프 갱신 (모든 태스크 공통)**: 각 태스크의 마지막 커밋에 `docs/SESSION-HANDOFF.md` 갱신을 포함시킨다

## 실측으로 확인된 사실 (구현 중 바꾸지 말 것)

계획 작성 중 실제로 설치·빌드·실행해 확인했다.

- `React 19 + node:test + global-jsdom` 조합이 동작한다. XSS 검증(`container.querySelectorAll('script').length === 0`)도 동작한다
- `tsx` 로더 + `tsconfig.json`의 `"jsx": "react-jsx"` 조합으로 `.jsx` import가 된다. tsconfig가 없으면 classic 런타임으로 변환되어 `React is not defined`
- Vite 8 + plugin-react 6 + React 19 빌드가 된다 (190KB / gzip 60KB, 73ms)
- `new URL(...).pathname`은 Windows에서 `/C:/Users/...`를 준다. 정적 서빙 경로에는 반드시 `fileURLToPath`를 쓴다

---

## File Structure

| 파일 | 책임 |
|---|---|
| `tsconfig.json` | tsx 로더용 JSX 설정 **(신규, 루트)** |
| `client/package.json` · `vite.config.js` · `index.html` | 프론트 빌드 설정 |
| `client/src/main.jsx` | 진입점 |
| `client/src/App.jsx` | 단계 상태 기계 |
| `client/src/api/errors.js` | 에러 코드 → 한글 메시지 (순수 함수) |
| `client/src/api/client.js` | fetch 래퍼. `fetch` 주입 가능 |
| `client/src/lib/format.js` | 날짜·통화·비용 표기 (순수 함수) |
| `client/src/lib/chart.js` | 좌표 계산 (순수 함수) |
| `client/src/pages/{Login,Search,Review,Report}Page.jsx` | 4화면 |
| `client/src/components/*.jsx` | 컴포넌트 11개 |
| `client/src/styles/{theme,app}.css` | 디자인 토큰과 레이아웃 |
| `lib/providers/market.js` | `series` 반환 추가 |
| `server.js` | `marketSeries` 응답 추가 + 정적 서빙 |
| `tests/client/*.test.js` | 프론트 테스트 |

---

## Task 1: 툴체인 구성과 순수 함수

**Files:**
- Create: `tsconfig.json`, `client/package.json`, `client/vite.config.js`, `client/index.html`, `client/src/main.jsx`, `client/src/api/errors.js`, `client/src/lib/format.js`, `tests/client/errors.test.js`, `tests/client/format.test.js`
- Modify: `package.json`, `.gitignore`

**Interfaces:**
- Produces:
  - `messageForError(error) -> { message, nextStep }` — `nextStep`은 `'login'|'search'|'review'|null`
  - `formatUsd(n) -> string` · `formatDateTime(iso) -> string` · `formatCount(n, unit) -> string`

- [ ] **Step 1: 루트 의존성과 스크립트**

```bash
npm install -D tsx global-jsdom@^29.0.0 jsdom@^29.0.0 @testing-library/react@^16.3.3
npm pkg set scripts.test="node --import tsx --test \"tests/**/*.test.js\""
npm pkg set scripts.build:client="npm --prefix client run build"
npm pkg set scripts.dev:client="npm --prefix client run dev"
```

**`jsdom@^29`를 지켜야 한다.** `^30`을 넣으면 `global-jsdom`의 peer(`>=29 <30`)와 충돌해 `ERESOLVE`로 설치가 실패한다.

- [ ] **Step 2: `tsconfig.json` 생성 (루트)**

tsx가 JSX를 automatic 런타임으로 변환하게 하는 설정이다. 없으면 `React is not defined`.

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "allowJs": true,
    "noEmit": true
  },
  "include": ["client/src", "tests"]
}
```

- [ ] **Step 3: tsx 로더가 기존 테스트를 깨지 않는지 확인**

Run: `npm test`
Expected: `tests 289 / pass 289 / fail 0`

깨지면 여기서 멈춘다. 로더가 백엔드 테스트에 영향을 주면 안 된다.

- [ ] **Step 4: client 프로젝트 초기화**

```bash
mkdir -p client/src/{api,lib,pages,components,styles}
cd client && npm init -y && npm pkg set type=module
npm pkg set scripts.dev="vite" scripts.build="vite build" scripts.preview="vite preview"
npm install react@^19.2.8 react-dom@^19.2.8
npm install -D vite@^8.2.2 @vitejs/plugin-react@^6.1.1
cd ..
```

`.gitignore`에 추가한다.

```
client/dist/
client/node_modules/
```

- [ ] **Step 5: `client/vite.config.js`**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    // 개발 중 API를 백엔드로 넘긴다. 쿠키가 프록시를 통과하므로 동일 출처처럼 동작한다.
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } },
  },
});
```

- [ ] **Step 6: `client/index.html`**

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>통합 분석 플랫폼</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 7: 실패하는 테스트 — `tests/client/errors.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageForError } from '../../client/src/api/errors.js';

test('세션 만료는 로그인 화면으로 보낸다', () => {
  const r = messageForError({ code: 'FORBIDDEN', message: '유효하지 않거나 만료된 세션입니다.' });
  assert.equal(r.nextStep, 'login');
  assert.match(r.message, /다시 로그인/);
});

test('비밀번호 오류는 화면을 옮기지 않는다', () => {
  const r = messageForError({ code: 'INVALID_CREDENTIALS' });
  assert.equal(r.nextStep, null);
  assert.match(r.message, /비밀번호/);
});

test('예산 초과는 서버 메시지를 그대로 쓴다', () => {
  const r = messageForError({ code: 'BUDGET_EXCEEDED', message: '오늘 사용할 수 있는 분석 횟수를 모두 썼습니다.' });
  assert.equal(r.message, '오늘 사용할 수 있는 분석 횟수를 모두 썼습니다.');
  assert.equal(r.nextStep, 'search');
});

test('상류 오류는 검토 화면을 유지해 재시도할 수 있게 한다', () => {
  // 수집 결과와 확인 토큰이 아직 유효하므로 분석만 다시 하면 된다.
  for (const code of ['UPSTREAM_TIMEOUT', 'UPSTREAM_ERROR', 'CIRCUIT_OPEN', 'PARSE_FAILED']) {
    assert.equal(messageForError({ code }).nextStep, 'review', `${code}가 검토 화면을 벗어났다`);
  }
});

test('확인 토큰 불일치는 검색 화면으로 되돌린다', () => {
  const r = messageForError({ code: 'CONFIRMATION_REQUIRED' });
  assert.equal(r.nextStep, 'search');
  assert.match(r.message, /다시 수집/);
});

test('수집 실패는 검색 화면을 유지한다', () => {
  const r = messageForError({ code: 'COLLECTION_FAILED', message: '분석할 뉴스를 수집하지 못했습니다.' });
  assert.equal(r.nextStep, 'search');
});

test('모르는 코드도 메시지를 준다', () => {
  const r = messageForError({ code: 'WEIRD_NEW_CODE' });
  assert.ok(r.message.length > 0);
  assert.equal(r.nextStep, null);
});

test('error가 없어도 죽지 않는다', () => {
  assert.ok(messageForError(null).message.length > 0);
  assert.ok(messageForError(undefined).message.length > 0);
});
```

- [ ] **Step 8: 실패하는 테스트 — `tests/client/format.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatUsd, formatDateTime, formatCount } from '../../client/src/lib/format.js';

test('비용은 소수점 아래를 살려 표기한다', () => {
  // 0.02를 "$0.02"로 반올림하면 0.004와 0.024가 같아 보인다.
  assert.equal(formatUsd(0.023456), '$0.0235');
  assert.equal(formatUsd(0), '$0');
  assert.equal(formatUsd(5), '$5.0000');
});

test('비용이 숫자가 아니면 물음표를 준다', () => {
  assert.equal(formatUsd(null), '$?');
  assert.equal(formatUsd(undefined), '$?');
  assert.equal(formatUsd(NaN), '$?');
});

test('ISO 시각을 사람이 읽는 형태로 바꾼다', () => {
  const s = formatDateTime('2026-09-03T01:20:00.000Z');
  assert.match(s, /2026/);
  assert.match(s, /09|9/);
});

test('날짜가 이상하면 원본을 그대로 돌려준다', () => {
  assert.equal(formatDateTime('어제'), '어제');
  assert.equal(formatDateTime(''), '');
  assert.equal(formatDateTime(null), '');
});

test('개수에 단위를 붙인다', () => {
  assert.equal(formatCount(8, '건'), '8건');
  assert.equal(formatCount(0, '건'), '0건');
  assert.equal(formatCount(null, '건'), '-');
});
```

- [ ] **Step 9: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../client/src/api/errors.js'`

- [ ] **Step 10: `client/src/api/errors.js` 구현**

```js
/**
 * 백엔드 에러 코드를 사용자 메시지와 다음 화면으로 옮긴다.
 *
 * nextStep이 null이면 현재 화면을 유지한다.
 * 상류 오류에 'review'를 주는 이유: 수집 결과와 확인 토큰이 아직 유효하므로
 * 무료인 수집을 다시 하지 않고 분석만 재시도할 수 있다.
 */
const TABLE = {
  FORBIDDEN: { message: '세션이 만료되었습니다. 다시 로그인해 주세요.', nextStep: 'login' },
  INVALID_CREDENTIALS: { message: '비밀번호가 올바르지 않습니다.', nextStep: null },
  RATE_LIMITED: { message: '요청이 많습니다. 잠시 후 다시 시도해 주세요.', nextStep: null },
  BUDGET_EXCEEDED: { message: null, nextStep: 'search' },   // 서버 메시지를 그대로 쓴다
  CONFIRMATION_REQUIRED: { message: '수집 결과가 변경되었습니다. 다시 수집해 주세요.', nextStep: 'search' },
  COLLECTION_FAILED: { message: null, nextStep: 'search' },
  INPUT_TOO_LARGE: { message: '요청이 너무 큽니다. 기사 수를 줄여 주세요.', nextStep: 'search' },
  PAYLOAD_TOO_LARGE: { message: '요청이 너무 큽니다.', nextStep: 'search' },
  INVALID_REQUEST: { message: null, nextStep: null },
  INSUFFICIENT_DATA: { message: '분석할 자료가 부족합니다.', nextStep: 'search' },
  TOO_MANY_CONCURRENT: { message: '동시 요청이 많습니다. 잠시 후 다시 시도해 주세요.', nextStep: null },
  UPSTREAM_TIMEOUT: { message: '분석 서버 응답이 지연되었습니다. 다시 시도해 주세요.', nextStep: 'review' },
  UPSTREAM_ERROR: { message: '분석 서버 호출에 실패했습니다. 다시 시도해 주세요.', nextStep: 'review' },
  CIRCUIT_OPEN: { message: '분석 서비스가 일시적으로 중단되었습니다. 잠시 후 다시 시도해 주세요.', nextStep: 'review' },
  PARSE_FAILED: { message: '분석 결과를 처리하지 못했습니다. 다시 시도해 주세요.', nextStep: 'review' },
};

const FALLBACK = '오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';

export function messageForError(error) {
  if (!error) return { message: FALLBACK, nextStep: null, requestId: undefined };

  const entry = TABLE[error.code];
  if (!entry) return { message: error.message || FALLBACK, nextStep: null, requestId: error.requestId };

  return {
    // message가 null인 항목은 서버 문구가 더 구체적이므로 그것을 쓴다.
    message: entry.message ?? (error.message || FALLBACK),
    nextStep: entry.nextStep,
    requestId: error.requestId,
  };
}
```

- [ ] **Step 11: `client/src/lib/format.js` 구현**

```js
/**
 * 비용은 소수점 4자리까지 살린다.
 * $0.02로 반올림하면 0.004와 0.024가 같아 보여 예산 감각이 무너진다.
 */
export function formatUsd(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '$?';
  if (n === 0) return '$0';
  return `$${n.toFixed(4)}`;
}

/** ISO 문자열을 한국 표기로. 파싱할 수 없으면 원본을 그대로 돌려준다. */
export function formatDateTime(iso) {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return String(iso);

  const d = new Date(ms);
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatCount(n, unit) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
  return `${n}${unit}`;
}
```

- [ ] **Step 12: `client/src/main.jsx` (최소 골격)**

```jsx
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/theme.css';
import './styles/app.css';

createRoot(document.getElementById('root')).render(<App />);
```

`App.jsx`는 Task 5에서 완성한다. 지금은 빌드가 되도록 최소 형태만 둔다.

```jsx
export default function App() {
  return <main><h1>통합 분석 플랫폼</h1></main>;
}
```

`styles/theme.css`와 `styles/app.css`는 Task 6에서 채운다. 지금은 빈 파일로 만든다.

- [ ] **Step 13: 테스트와 빌드 확인**

```bash
npm test
npm run build:client
```

Expected: 테스트 289 + 13 = 302개 통과. `client/dist/index.html`과 `client/dist/assets/*.js` 생성.

- [ ] **Step 14: 커밋 (핸드오프 갱신 포함)**

`docs/SESSION-HANDOFF.md` §1에 `| Phase 3 (프론트엔드) | 🔄 구현 중 (Task 1/8 완료) |` 행을 추가한다.

```bash
git add -A
git commit -m "feat: set up vite client and pure helper functions

Vite + React 19 프로젝트를 client/에 만들고, 에러 코드 매핑과
포맷팅을 순수 함수로 분리해 DOM 없이 테스트한다.

JSX 테스트에는 tsx 로더가 필요하다. Node는 .jsx를 파싱하지 못하고,
tsconfig의 jsx: react-jsx가 없으면 classic 런타임으로 변환되어
React is not defined가 난다.

jsdom은 29로 고정한다. global-jsdom@29의 peer가 >=29 <30이라
jsdom@30을 넣으면 ERESOLVE로 설치가 실패한다.

상류 오류는 검토 화면을 유지하도록 매핑했다. 수집 결과와 확인 토큰이
아직 유효하므로 무료인 수집을 다시 하지 않고 분석만 재시도할 수 있다.

비용은 소수점 4자리까지 표기한다. $0.02로 반올림하면 0.004와 0.024가
같아 보여 예산 감각이 무너진다."
```

---

## Task 2: 백엔드 — `marketSeries` 추가

**Files:**
- Modify: `lib/providers/market.js`, `server.js`
- Test: `tests/market-provider.test.js`, `tests/research.test.js`

**Interfaces:**
- Consumes: `computeIndicators` (Phase 2a)
- Produces:
  - provider `fetch()`가 `{ indicators, marketData, series }`를 반환
  - `series = { symbol, currency, points: [{ t, c, v }] }`
  - `collect` 응답에 `marketSeries = { ...series, indicators }`

- [ ] **Step 1: 실패하는 테스트를 `tests/market-provider.test.js`에 추가**

```js
// ─── 가격 시계열 (Phase 3) ───

test('주식 조회가 시계열을 함께 반환한다', async () => {
  const r = await provider(makeHttp(YAHOO)).fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });

  assert.ok(r.series, 'series가 없다');
  assert.equal(r.series.symbol, 'NVDA');
  assert.equal(r.series.currency, 'USD');
  assert.ok(r.series.points.length > 1);
});

test('시계열 각 점이 시각·종가·거래량을 갖는다', async () => {
  const r = await provider(makeHttp(YAHOO)).fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });
  const p = r.series.points[0];

  assert.match(p.t, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof p.c, 'number');
  assert.ok(Number.isFinite(p.c));
});

test('시계열 점 수가 지표의 점 수와 같다', async () => {
  // 둘이 다르면 차트와 이동평균이 어긋난다.
  const r = await provider(makeHttp(YAHOO)).fetch({ symbol: 'NVDA', assetType: 'stock', range: '1mo' });
  assert.equal(r.series.points.length, r.indicators.points);
});

test('종가가 null인 지점은 시계열에서 빠진다', async () => {
  const withGaps = JSON.stringify({
    chart: { result: [{
      meta: { symbol: 'X', currency: 'USD', regularMarketPrice: 110 },
      timestamp: [1756000000, 1756086400, 1756172800],
      indicators: { quote: [{ close: [100, null, 110], volume: [10, null, 20] }] },
    }] },
  });
  const r = await provider(makeHttp({ 'query1.finance.yahoo.com/v8': withGaps }))
    .fetch({ symbol: 'X', assetType: 'stock', range: '1mo' });

  assert.equal(r.series.points.length, 2);
  assert.deepEqual(r.series.points.map((p) => p.c), [100, 110]);
});

test('코인 조회도 시계열을 반환한다', async () => {
  const r = await provider(makeHttp(CRYPTO)).fetch({ symbol: 'bitcoin', assetType: 'crypto', range: '1mo' });

  assert.equal(r.series.symbol, 'bitcoin');
  assert.equal(r.series.currency, 'USD');
  assert.ok(r.series.points.length > 1);
});
```

- [ ] **Step 2: 실패하는 테스트를 `tests/research.test.js`에 추가**

```js
// ─── marketSeries (Phase 3) ───

test('collect 응답에 marketSeries가 포함된다', async () => {
  const { app } = setup();
  const token = await login(app);
  const res = await collect(app, token);

  assert.ok(res.body.marketSeries, 'marketSeries가 없다');
  assert.ok(res.body.marketSeries.points.length > 1);
  assert.equal(typeof res.body.marketSeries.indicators.changePct, 'number');
});

test('시장 데이터를 못 가져오면 marketSeries도 없다', async () => {
  const { 'query1.finance.yahoo.com/v8': _removed, ...rest } = ROUTES;
  const http = makeHttp({ ...rest, 'query1.finance.yahoo.com': new Error('다운') });
  const { app } = setup({ http });
  const token = await login(app);
  const res = await collect(app, token);

  assert.equal(res.status, 200);
  assert.equal(res.body.marketSeries, undefined);
});

test('marketSeries가 분석 프롬프트에 들어가지 않는다', async () => {
  // 숫자 22쌍을 넣으면 토큰만 늘고, chartTrend 문장이 이미 요약하고 있다.
  const { app, llm } = setup();
  const token = await login(app);
  const c = await collect(app, token);

  await request(app).post('/api/analyze/news')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Confirm-Token', c.body.confirmToken)
    .send({ newsList: c.body.newsList, marketData: c.body.marketData });

  const firstPoint = c.body.marketSeries.points[0];
  assert.equal(llm.calls[0].user.includes(String(firstPoint.c)), false,
    '시계열 값이 프롬프트에 들어갔다');
});

test('marketSeries 추가가 확인 토큰을 깨지 않는다', async () => {
  // cacheKey에 영향을 주면 collect가 발급한 토큰이 analyze에서 거부된다.
  const { app } = setup();
  const token = await login(app);
  const c = await collect(app, token);

  const res = await request(app).post('/api/analyze/news')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Confirm-Token', c.body.confirmToken)
    .send({ newsList: c.body.newsList, marketData: c.body.marketData });

  assert.equal(res.status, 200, JSON.stringify(res.body.error));
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `r.series`가 `undefined`, `res.body.marketSeries`가 `undefined`

- [ ] **Step 4: `lib/providers/market.js` 수정**

`fetchStock`을 고친다. `result.timestamp`(초 단위 epoch)와 종가·거래량을 인덱스로 맞추고, 종가가 없는 지점은 버린다.

```js
  const fetchStock = async (symbol, range) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
    const { text } = await http.get(url);
    const result = JSON.parse(text)?.chart?.result?.[0];
    if (!result) return null;

    const quote = result.indicators?.quote?.[0] ?? {};
    const indicators = computeIndicators(quote.close ?? [], quote.volume ?? []);
    if (!indicators) return null;

    const currency = result.meta?.currency ?? '';
    const price = result.meta?.regularMarketPrice ?? indicators.last;

    // 차트용 시계열. 종가가 없는 지점은 버린다 — computeIndicators와 같은 기준이라
    // 점 수가 indicators.points와 일치한다.
    const stamps = result.timestamp ?? [];
    const points = [];
    for (let i = 0; i < stamps.length; i += 1) {
      const c = quote.close?.[i];
      if (typeof c !== 'number' || !Number.isFinite(c)) continue;
      points.push({
        t: new Date(stamps[i] * 1000).toISOString(),
        c,
        v: typeof quote.volume?.[i] === 'number' ? quote.volume[i] : null,
      });
    }

    return {
      indicators,
      series: { symbol: result.meta?.symbol ?? symbol, currency, points },
      marketData: {
        assetName: result.meta?.symbol ?? symbol,
        currentPrice: `${Number(price).toLocaleString()} ${currency}`.trim(),
        priceChange: `${indicators.changePct.toFixed(2)}%`,
        chartTrend: buildChartTrend(indicators, { currency, livePrice: Number(price) }),
      },
    };
  };
```

`fetchCrypto`도 같은 형태로 고친다. CoinGecko는 `[ms, value]` 쌍이다.

```js
  const fetchCrypto = async (symbol, range) => {
    const days = RANGE_DAYS[range] ?? 30;
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(symbol)}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
    const { text } = await http.get(url);
    const body = JSON.parse(text);

    const rawPrices = body?.prices ?? [];
    const rawVolumes = body?.total_volumes ?? [];
    const closes = rawPrices.map(([, p]) => p);
    const volumes = rawVolumes.map(([, v]) => v);

    const indicators = computeIndicators(closes, volumes);
    if (!indicators) return null;

    const points = [];
    for (let i = 0; i < rawPrices.length; i += 1) {
      const c = rawPrices[i]?.[1];
      if (typeof c !== 'number' || !Number.isFinite(c)) continue;
      points.push({
        t: new Date(rawPrices[i][0]).toISOString(),
        c,
        v: typeof rawVolumes[i]?.[1] === 'number' ? rawVolumes[i][1] : null,
      });
    }

    return {
      indicators,
      series: { symbol, currency: 'USD', points },
      marketData: {
        assetName: symbol,
        currentPrice: `${indicators.last.toLocaleString()} USD`,
        priceChange: `${indicators.changePct.toFixed(2)}%`,
        chartTrend: buildChartTrend(indicators, { currency: 'USD' }),
      },
    };
  };
```

- [ ] **Step 5: `server.js`의 collect 응답에 추가**

`const marketData = market?.marketData;` 아래에 한 줄을 넣는다.

```js
      const marketData = market?.marketData;
      // 차트용 시계열. 분석 프롬프트에는 넣지 않는다 — 토큰만 늘고
      // cacheKey가 바뀌면 확인 토큰 흐름이 깨진다.
      const marketSeries = market
        ? { ...market.series, indicators: market.indicators }
        : undefined;
```

응답 객체에 `marketSeries`를 추가한다. `marketData` 바로 아래에 둔다.

```js
      res.json({
        requestId: req.requestId,
        newsList,
        marketData,
        marketSeries,
        collected: { ... },
```

**`cacheKey` 계산과 `buildUserPrompt` 호출은 건드리지 않는다.** 둘 다 `marketData`만 받는다.

- [ ] **Step 6: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 302 + 9 = 311개

- [ ] **Step 7: 커밋 (핸드오프 갱신 포함)**

```bash
git add lib/ server.js tests/ docs/SESSION-HANDOFF.md
git commit -m "feat: expose market price series for charting

provider가 이미 파싱하는 시계열을 버리지 않고 collect 응답에 싣는다.
차트를 그리려면 가격 배열이 필요한데 지금까지는 indicators만 계산하고
원본을 버렸다.

종가가 없는 지점은 시계열에서도 뺀다. computeIndicators와 같은
기준이라 점 수가 indicators.points와 일치하고, 차트와 이동평균이
어긋나지 않는다.

분석 프롬프트에는 넣지 않는다. 숫자 22쌍은 토큰만 늘리고 chartTrend
문장이 이미 그 내용을 요약한다. cacheKey에도 영향이 없어 확인 토큰
흐름이 그대로 유지된다 — 테스트로 고정했다."
```

---

## Task 3: API 클라이언트

**Files:**
- Create: `client/src/api/client.js`, `tests/client/api-client.test.js`

**Interfaces:**
- Consumes: `messageForError` (Task 1)
- Produces:
  - `createApiClient({ fetchImpl }) -> Api`
  - `Api.login(password) -> Promise<{ token, expiresAt }>`
  - `Api.logout() -> Promise<void>`
  - `Api.budget() -> Promise<Budget>`
  - `Api.collect(params) -> Promise<CollectResult>`
  - `Api.analyze({ newsList, marketData, confirmToken }) -> Promise<Report>`
  - 실패 시 `ApiCallError`를 던진다 — `{ code, message, requestId, status }`

- [ ] **Step 1: 실패하는 테스트 — `tests/client/api-client.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, ApiCallError } from '../../client/src/api/client.js';

/** 응답을 흉내내는 fetch. calls로 요청을 관찰한다. */
const makeFetch = (spec) => {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    if (spec.throws) throw spec.throws;
    return {
      ok: (spec.status ?? 200) < 400,
      status: spec.status ?? 200,
      json: async () => spec.body ?? {},
    };
  };
  fn.calls = calls;
  return fn;
};

test('로그인은 비밀번호를 본문에 담아 보낸다', async () => {
  const f = makeFetch({ body: { token: 'tk', expiresAt: 'x' } });
  const api = createApiClient({ fetchImpl: f });

  const r = await api.login('secret');

  assert.equal(r.token, 'tk');
  assert.equal(f.calls[0].url, '/api/auth/login');
  assert.equal(JSON.parse(f.calls[0].opts.body).password, 'secret');
});

test('모든 요청에 same-origin 자격증명을 붙인다', async () => {
  // HttpOnly 쿠키가 실려야 인증이 유지된다.
  const f = makeFetch({ body: {} });
  await createApiClient({ fetchImpl: f }).budget();

  assert.equal(f.calls[0].opts.credentials, 'same-origin');
});

test('토큰을 저장하거나 헤더에 넣지 않는다', async () => {
  // 쿠키만 쓴다. JS가 토큰을 만지면 XSS 시 탈취된다.
  const f = makeFetch({ body: { token: 'tk' } });
  const api = createApiClient({ fetchImpl: f });

  await api.login('pw');
  await api.budget();

  assert.equal(f.calls[1].opts.headers?.Authorization, undefined);
});

test('수집은 파라미터를 그대로 보낸다', async () => {
  const f = makeFetch({ body: { newsList: [] } });
  await createApiClient({ fetchImpl: f }).collect({
    query: '엔비디아', symbol: 'NVDA', lang: 'ko', range: '1mo', maxNews: 8,
  });

  const sent = JSON.parse(f.calls[0].opts.body);
  assert.equal(sent.query, '엔비디아');
  assert.equal(sent.maxNews, 8);
});

test('빈 symbol은 보내지 않는다', async () => {
  // 빈 문자열을 보내면 zod가 min(1)에서 400을 준다.
  const f = makeFetch({ body: {} });
  await createApiClient({ fetchImpl: f }).collect({ query: '테스트', symbol: '' });

  assert.equal('symbol' in JSON.parse(f.calls[0].opts.body), false);
});

test('분석은 확인 토큰을 헤더에 싣는다', async () => {
  const f = makeFetch({ body: { analysis: {} } });
  await createApiClient({ fetchImpl: f }).analyze({
    newsList: [{ title: 'a' }], marketData: { assetName: 'X' }, confirmToken: 'ct_abc',
  });

  assert.equal(f.calls[0].opts.headers['X-Confirm-Token'], 'ct_abc');
});

test('분석 본문에 newsList가 수정 없이 실린다', async () => {
  // 한 글자만 바뀌어도 cacheKey가 달라져 확인 토큰이 428로 거부된다.
  const newsList = [{ title: '기사', content: '본문', source: '출처',
    url: 'https://a.com/1', publishedAt: '2026-09-01T00:00:00.000Z', contentKind: 'summary' }];
  const f = makeFetch({ body: {} });

  await createApiClient({ fetchImpl: f }).analyze({ newsList, marketData: undefined, confirmToken: 'ct' });

  assert.deepEqual(JSON.parse(f.calls[0].opts.body).newsList, newsList);
});

test('marketData가 없으면 본문에서 뺀다', async () => {
  const f = makeFetch({ body: {} });
  await createApiClient({ fetchImpl: f }).analyze({
    newsList: [{ title: 'a' }], marketData: undefined, confirmToken: 'ct',
  });

  assert.equal('marketData' in JSON.parse(f.calls[0].opts.body), false);
});

test('에러 응답을 ApiCallError로 바꾼다', async () => {
  const f = makeFetch({
    status: 403,
    body: { error: { code: 'FORBIDDEN', message: '만료됨', requestId: 'rq-1' } },
  });

  await assert.rejects(
    () => createApiClient({ fetchImpl: f }).budget(),
    (e) => e instanceof ApiCallError && e.code === 'FORBIDDEN'
      && e.requestId === 'rq-1' && e.status === 403,
  );
});

test('네트워크 실패도 ApiCallError로 바꾼다', async () => {
  const f = makeFetch({ throws: new TypeError('Failed to fetch') });

  await assert.rejects(
    () => createApiClient({ fetchImpl: f }).budget(),
    (e) => e instanceof ApiCallError && e.code === 'NETWORK_ERROR',
  );
});

test('JSON이 아닌 응답도 ApiCallError로 바꾼다', async () => {
  const f = async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json'); } });

  await assert.rejects(
    () => createApiClient({ fetchImpl: f }).budget(),
    (e) => e instanceof ApiCallError && e.status === 502,
  );
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `createApiClient is not a function`

- [ ] **Step 3: `client/src/api/client.js` 구현**

```js
export class ApiCallError extends Error {
  constructor({ code, message, requestId, status }) {
    super(message);
    this.name = 'ApiCallError';
    this.code = code;
    this.requestId = requestId;
    this.status = status;
  }
}

/**
 * 백엔드 호출을 감싼다.
 *
 * fetch를 주입받는 이유는 네트워크 없이 테스트하기 위해서다.
 * Phase 1의 clock·llm, Phase 2a의 http 주입과 같은 방식이다.
 */
export function createApiClient({ fetchImpl = fetch } = {}) {
  const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
    let res;
    try {
      res = await fetchImpl(path, {
        method,
        // HttpOnly 쿠키가 실려야 인증이 유지된다. 토큰을 헤더에 넣지 않는다.
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiCallError({
        code: 'NETWORK_ERROR',
        message: '서버에 연결하지 못했습니다.',
        status: 0,
      });
    }

    let payload;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if (!res.ok) {
      const e = payload?.error ?? {};
      throw new ApiCallError({
        code: e.code ?? 'INTERNAL',
        message: e.message ?? '오류가 발생했습니다.',
        requestId: e.requestId,
        status: res.status,
      });
    }

    return payload;
  };

  return {
    login: (password) => call('/api/auth/login', { method: 'POST', body: { password } }),
    logout: () => call('/api/auth/logout', { method: 'POST' }),
    session: () => call('/api/auth/session'),
    budget: () => call('/api/budget'),

    collect: ({ query, symbol, assetType, lang, range, maxNews }) => {
      // 빈 문자열을 보내면 zod의 min(1)에서 400이 난다. 아예 뺀다.
      const body = { query };
      if (symbol) body.symbol = symbol;
      if (assetType) body.assetType = assetType;
      if (lang) body.lang = lang;
      if (range) body.range = range;
      if (typeof maxNews === 'number') body.maxNews = maxNews;
      return call('/api/research/collect', { method: 'POST', body });
    },

    analyze: ({ newsList, marketData, confirmToken }) => {
      // newsList를 그대로 넘긴다. 한 글자만 바뀌어도 cacheKey가 달라져
      // 확인 토큰이 428로 거부된다.
      const body = { newsList };
      if (marketData) body.marketData = marketData;
      return call('/api/analyze/news', {
        method: 'POST',
        body,
        headers: { 'X-Confirm-Token': confirmToken },
      });
    },
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 311 + 11 = 322개

- [ ] **Step 5: 커밋 (핸드오프 갱신 포함)**

```bash
git add client/ tests/ docs/SESSION-HANDOFF.md
git commit -m "feat: add api client with injectable fetch

fetch를 주입받아 네트워크 없이 테스트한다. Phase 1의 clock·llm,
Phase 2a의 http 주입과 같은 방식이다.

토큰을 저장하거나 헤더에 넣지 않는다. HttpOnly 쿠키만 쓰므로
XSS가 나더라도 토큰이 탈취되지 않는다.

빈 symbol은 본문에서 뺀다. 빈 문자열을 보내면 zod의 min(1)에서
400이 난다.

analyze는 newsList를 수정 없이 그대로 넘긴다. 한 글자만 바뀌어도
cacheKey가 달라져 확인 토큰이 428로 거부된다."
```

---

## Task 4: 차트 좌표 계산 (순수 함수)

**Files:**
- Create: `client/src/lib/chart.js`, `tests/client/chart.test.js`

**Interfaces:**
- Consumes: 없음 (순수 함수)
- Produces:
  - `buildChartGeometry(points, { width, height, padding }) -> Geometry | null`
    ```
    Geometry = {
      line: string,              // SVG polyline points 속성값
      min, max,                  // y축 범위
      first, last,               // 첫·마지막 종가
      xy: [{ x, y, c, t }],      // 각 점의 좌표와 원본 값
    }
    ```
    - 점이 2개 미만이면 `null`
  - `movingAverageLine(points, window, geometry) -> string | null`
    - 점이 `window`보다 적으면 `null`

DOM이 필요 없다. 좌표 계산을 컴포넌트에서 분리하면 알려진 입력에 대한 정확한 검증이 가능하다.

- [ ] **Step 1: 실패하는 테스트 — `tests/client/chart.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChartGeometry, movingAverageLine } from '../../client/src/lib/chart.js';

/** 100에서 10씩 오르는 점 n개. 좌표 검증이 쉽도록 값을 고정한다. */
const rising = (n) => Array.from({ length: n }, (_, i) => ({
  t: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
  c: 100 + i * 10,
  v: 1000,
}));

const BOX = { width: 600, height: 200, padding: 10 };

test('첫 점은 왼쪽 끝, 마지막 점은 오른쪽 끝에 놓인다', () => {
  const g = buildChartGeometry(rising(3), BOX);

  assert.equal(g.xy[0].x, 10);
  assert.equal(g.xy[2].x, 590);
});

test('최저값이 아래, 최고값이 위에 놓인다', () => {
  // SVG는 y가 아래로 증가하므로 최고값의 y가 더 작아야 한다.
  const g = buildChartGeometry(rising(3), BOX);

  assert.equal(g.xy[0].y, 190, '최저값이 바닥에 붙지 않았다');
  assert.equal(g.xy[2].y, 10, '최고값이 천장에 붙지 않았다');
});

test('중간값이 정확히 가운데 놓인다', () => {
  const g = buildChartGeometry(rising(3), BOX);
  assert.equal(g.xy[1].y, 100);
});

test('polyline 문자열을 만든다', () => {
  const g = buildChartGeometry(rising(3), BOX);

  assert.equal(g.line, '10,190 300,100 590,10');
});

test('min·max·first·last를 함께 준다', () => {
  const g = buildChartGeometry(rising(5), BOX);

  assert.equal(g.min, 100);
  assert.equal(g.max, 140);
  assert.equal(g.first, 100);
  assert.equal(g.last, 140);
});

test('모든 값이 같으면 0으로 나누지 않고 가운데 선을 그린다', () => {
  const flat = [{ t: 'a', c: 50 }, { t: 'b', c: 50 }, { t: 'c', c: 50 }];
  const g = buildChartGeometry(flat, BOX);

  assert.ok(Number.isFinite(g.xy[0].y), 'y가 NaN이다');
  assert.equal(g.xy[0].y, g.xy[2].y);
  assert.equal(g.xy[0].y, 100, '평평한 선은 세로 가운데에 놓여야 한다');
});

test('점이 2개 미만이면 null이다', () => {
  assert.equal(buildChartGeometry([{ t: 'a', c: 1 }], BOX), null);
  assert.equal(buildChartGeometry([], BOX), null);
  assert.equal(buildChartGeometry(null, BOX), null);
  assert.equal(buildChartGeometry(undefined, BOX), null);
});

test('원본 값을 좌표에 함께 남긴다', () => {
  // 툴팁에 실제 가격과 날짜를 보여줘야 한다.
  const g = buildChartGeometry(rising(3), BOX);

  assert.equal(g.xy[1].c, 110);
  assert.equal(g.xy[1].t, '2026-09-02T00:00:00.000Z');
});

// ─── 이동평균 ───

test('이동평균 선을 만든다', () => {
  const g = buildChartGeometry(rising(5), BOX);
  const line = movingAverageLine(rising(5), 3, g);

  // 점 5개에 창 3이면 3개 구간(인덱스 2,3,4)이 나온다.
  assert.equal(line.split(' ').length, 3);
});

test('점이 창보다 적으면 null이다', () => {
  const g = buildChartGeometry(rising(3), BOX);

  assert.equal(movingAverageLine(rising(3), 5, g), null);
  assert.equal(movingAverageLine(rising(3), 20, g), null);
});

test('이동평균은 원본 선과 같은 y 축척을 쓴다', () => {
  // 축척이 다르면 두 선이 어긋나 보인다.
  const pts = rising(5);
  const g = buildChartGeometry(pts, BOX);
  const line = movingAverageLine(pts, 5, g);

  // 5개 평균 = (100+110+120+130+140)/5 = 120, 범위 100~140의 정확히 가운데
  const [, y] = line.split(' ')[0].split(',').map(Number);
  assert.equal(y, 100);
});

test('geometry가 없으면 null이다', () => {
  assert.equal(movingAverageLine(rising(5), 3, null), null);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `buildChartGeometry is not a function`

- [ ] **Step 3: `client/src/lib/chart.js` 구현**

`toX`·`toY`를 geometry에 담아 이동평균이 같은 변환을 재사용하게 한다. 따로 계산하면 두 선의 축척이 어긋난다.

```js
/**
 * 가격 시계열을 SVG 좌표로 바꾼다.
 *
 * 컴포넌트에서 분리하는 이유는 좌표 계산이 순수 함수라 DOM 없이
 * 정확히 검증할 수 있기 때문이다.
 */
export function buildChartGeometry(points, { width, height, padding }) {
  if (!Array.isArray(points) || points.length < 2) return null;

  const values = points.map((p) => p.c);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  // 모든 값이 같으면 범위가 0이라 나눗셈이 NaN이 된다. 가운데 가로선으로 그린다.
  const toY = (c) => (span === 0
    ? padding + innerH / 2
    : padding + innerH - ((c - min) / span) * innerH);
  const toX = (i) => padding + (i / (points.length - 1)) * innerW;

  const xy = points.map((p, i) => ({ x: toX(i), y: toY(p.c), c: p.c, t: p.t }));

  return {
    xy,
    toX,
    toY,
    line: xy.map((p) => `${p.x},${p.y}`).join(' '),
    min,
    max,
    first: values[0],
    last: values[values.length - 1],
  };
}

/**
 * 이동평균 선. geometry의 toX·toY를 재사용하므로 원본 선과 축척이 같다.
 * 점이 창보다 적으면 계산하지 않는다 — 없는 지표를 그리면 안 된다.
 */
export function movingAverageLine(points, window, geometry) {
  if (!geometry || !Array.isArray(points) || points.length < window) return null;

  const out = [];
  for (let i = window - 1; i < points.length; i += 1) {
    let sum = 0;
    for (let k = i - window + 1; k <= i; k += 1) sum += points[k].c;
    out.push(`${geometry.toX(i)},${geometry.toY(sum / window)}`);
  }
  return out.join(' ');
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 322 + 12 = 334개

- [ ] **Step 5: 커밋 (핸드오프 갱신 포함)**

```bash
git add client/ tests/ docs/SESSION-HANDOFF.md
git commit -m "feat: compute chart geometry as a pure function

좌표 계산을 컴포넌트에서 분리해 DOM 없이 검증한다. 알려진 입력에
대한 정확한 좌표를 테스트로 고정했다.

geometry가 toX·toY를 함께 반환해 이동평균이 같은 변환을 재사용한다.
따로 계산하면 두 선의 축척이 어긋난다.

모든 값이 같으면 범위가 0이라 나눗셈이 NaN이 된다. 이 경우 가운데
가로선으로 그린다.

점이 창보다 적으면 이동평균을 만들지 않는다. 데이터가 10개뿐인데
20일선을 그리면 없는 것을 있는 것처럼 보여주게 된다."
```

---

## Task 5: 표시 컴포넌트

**Files:**
- Create: `client/src/components/{MarketChart,NewsList,SourceSummary,InsightReport,RiskPanel,MonitoringIndicators,SourceCitation,Disclaimer,ProgressIndicator,ErrorBanner}.jsx`
- Create: `tests/client/components.test.js`

**Interfaces:**
- Consumes: `buildChartGeometry`·`movingAverageLine` (Task 4), `formatUsd`·`formatDateTime`·`formatCount` (Task 1)
- Produces: 각 컴포넌트가 아래 props를 받는다
  - `MarketChart({ series, marketData })`
  - `NewsList({ items })` — `items`는 `newsList` 형태
  - `SourceSummary({ collected })`
  - `InsightReport({ analysis, degraded })`
  - `RiskPanel({ risks })` · `MonitoringIndicators({ indicators })`
  - `SourceCitation({ sources, meta })`
  - `Disclaimer({ text })`
  - `ProgressIndicator({ stage })` — `'collecting' | 'analyzing'`
  - `ErrorBanner({ error, onDismiss })`

- [ ] **Step 1: 실패하는 테스트 — `tests/client/components.test.js`**

```js
import 'global-jsdom/register';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen } from '@testing-library/react';

import MarketChart from '../../client/src/components/MarketChart.jsx';
import NewsList from '../../client/src/components/NewsList.jsx';
import SourceSummary from '../../client/src/components/SourceSummary.jsx';
import InsightReport from '../../client/src/components/InsightReport.jsx';
import SourceCitation from '../../client/src/components/SourceCitation.jsx';
import ProgressIndicator from '../../client/src/components/ProgressIndicator.jsx';
import ErrorBanner from '../../client/src/components/ErrorBanner.jsx';

const series = {
  symbol: 'NVDA',
  currency: 'USD',
  points: Array.from({ length: 22 }, (_, i) => ({
    t: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
    c: 200 + i,
    v: 1000,
  })),
  indicators: { ma5: 218.68, ma20: 219.03, high: 227.98, low: 206.64, changePct: 5.23, volatilityPct: 2.8, points: 22 },
};

const marketData = {
  assetName: 'NVDA', currentPrice: '224.41 USD',
  priceChange: '5.23%', chartTrend: '해당 기간 종가는 5.23% 상승했습니다.',
};

// ─── MarketChart ───

test('시계열이 있으면 polyline을 그린다', () => {
  const { container } = render(<MarketChart series={series} marketData={marketData} />);
  assert.ok(container.querySelector('polyline'), '차트 선이 없다');
});

test('점이 20개 이상이면 이동평균 선을 두 개 더 그린다', () => {
  const { container } = render(<MarketChart series={series} marketData={marketData} />);
  assert.equal(container.querySelectorAll('polyline').length, 3);
});

test('점이 적으면 20일선을 그리지 않는다', () => {
  const few = { ...series, points: series.points.slice(0, 6) };
  const { container } = render(<MarketChart series={few} marketData={marketData} />);

  // 종가선 + 5일선만
  assert.equal(container.querySelectorAll('polyline').length, 2);
});

test('시계열이 없으면 자료 부족을 표시하고 죽지 않는다', () => {
  render(<MarketChart series={undefined} marketData={undefined} />);
  assert.ok(screen.getByText(/자료 부족|시장 데이터/));
});

test('현재가와 등락률을 표시한다', () => {
  render(<MarketChart series={series} marketData={marketData} />);
  assert.ok(screen.getByText(/224\.41/));
  assert.ok(screen.getByText(/5\.23%/));
});

// ─── NewsList ───

test('자료 범위 태그를 표시한다', () => {
  render(<NewsList items={[
    { title: '요약 기사', source: '연합뉴스', url: 'https://a.com/1',
      publishedAt: '2026-09-01T00:00:00.000Z', contentKind: 'summary', content: '본문' },
    { title: '제목만 기사', source: 'IT조선', url: 'https://b.com/2',
      publishedAt: '2026-09-02T00:00:00.000Z', contentKind: 'headline', content: '제목만 기사' },
  ]} />);

  assert.ok(screen.getByText('요약'));
  assert.ok(screen.getByText('제목만'));
});

test('외부 링크에 noopener noreferrer를 붙인다', () => {
  const { container } = render(<NewsList items={[
    { title: 'a', source: 's', url: 'https://a.com/1',
      publishedAt: '2026-09-01T00:00:00.000Z', contentKind: 'summary', content: 'x' },
  ]} />);

  const a = container.querySelector('a[href="https://a.com/1"]');
  assert.ok(a);
  assert.match(a.getAttribute('rel'), /noopener/);
  assert.match(a.getAttribute('rel'), /noreferrer/);
});

test('빈 목록에도 죽지 않는다', () => {
  render(<NewsList items={[]} />);
  assert.ok(screen.getByText(/자료가 없습니다/));
});

// ─── SourceSummary ───

test('수집 요약에 제목만 개수를 드러낸다', () => {
  render(<SourceSummary collected={{
    collectedAt: '2026-09-03T01:00:00.000Z', resolvedSymbol: 'NVDA', symbolSource: 'alias',
    feedsUsed: ['google-news-ko'], newsCount: 8, duplicatesRemoved: 1,
    headlineOnlyCount: 5, degraded: [],
  }} />);

  assert.ok(screen.getByText(/5/), '제목만 개수가 없다');
  assert.ok(screen.getByText(/NVDA/));
});

test('degraded가 있으면 무엇이 빠졌는지 보여준다', () => {
  render(<SourceSummary collected={{
    collectedAt: '2026-09-03T01:00:00.000Z', resolvedSymbol: null, symbolSource: 'unresolved',
    feedsUsed: [], newsCount: 3, duplicatesRemoved: 0, headlineOnlyCount: 0,
    degraded: [{ provider: 'market', reason: '심볼을 해석하지 못했습니다.' }],
  }} />);

  assert.ok(screen.getByText(/심볼을 해석하지 못했습니다/));
});

// ─── InsightReport (XSS) ───

test('LLM 응답에 script가 들어와도 DOM에 태그가 생기지 않는다', () => {
  // LLM 응답은 외부 RSS를 거친 신뢰할 수 없는 입력이다.
  const { container } = render(<InsightReport analysis={{
    summary: '<script>window.__pwned = 1</script>요약입니다',
    newsBriefing: [], trendAnalysis: '', scenarios: [], risks: [],
    monitoringIndicators: [], disclaimer: '면책',
  }} degraded={false} />);

  assert.equal(container.querySelectorAll('script').length, 0, '스크립트 태그가 생성됐다');
  assert.equal(globalThis.__pwned, undefined, '스크립트가 실행됐다');
  assert.ok(container.textContent.includes('요약입니다'));
});

test('img onerror도 실행되지 않는다', () => {
  const { container } = render(<InsightReport analysis={{
    summary: '<img src=x onerror="globalThis.__xss=1">본문',
    newsBriefing: [], trendAnalysis: '', scenarios: [], risks: [],
    monitoringIndicators: [], disclaimer: '면책',
  }} degraded={false} />);

  assert.equal(container.querySelectorAll('img').length, 0);
  assert.equal(globalThis.__xss, undefined);
});

test('degraded면 Markdown 폴백을 pre로 표시한다', () => {
  // 렌더러를 붙이면 HTML을 만들고 그 순간 XSS 표면이 생긴다.
  const { container } = render(
    <InsightReport analysis={{ report: '# 제목\n\n본문입니다' }} degraded />,
  );

  assert.ok(container.querySelector('pre'), 'pre로 표시되지 않았다');
  assert.ok(container.textContent.includes('# 제목'));
});

test('degraded면 배너로 알린다', () => {
  render(<InsightReport analysis={{ report: '본문' }} degraded />);
  assert.ok(screen.getByText(/서식이 단순|구조화/));
});

test('시나리오를 카드로 나열한다', () => {
  render(<InsightReport analysis={{
    summary: '요약', newsBriefing: [], trendAnalysis: '동향',
    scenarios: [
      { type: '기본 시나리오', premise: '전제', indicatorsToWatch: '지표',
        possibleDirection: '방향', invalidationCondition: '무효화', cautions: '주의' },
    ],
    risks: [], monitoringIndicators: [], disclaimer: '면책',
  }} degraded={false} />);

  assert.ok(screen.getByText('기본 시나리오'));
  assert.ok(screen.getByText(/무효화/));
});

// ─── SourceCitation ───

test('제거된 위조 URL 수를 알린다', () => {
  render(<SourceCitation
    sources={[{ sourceId: 'S1', title: '기사', source: '연합뉴스',
      url: 'https://a.com/1', publishedAt: '2026-09-01T00:00:00.000Z',
      collectedAt: '2026-09-03T01:00:00.000Z', type: 'news', relevance: 3 }]}
    meta={{ fabricatedUrlsRemoved: 2, collectedAt: '2026-09-03T01:00:00.000Z' }} />);

  assert.ok(screen.getByText(/2/), '제거 건수가 표시되지 않았다');
  assert.ok(screen.getByText(/출처에 없는/));
});

test('제거된 URL이 없으면 그 문구를 띄우지 않는다', () => {
  render(<SourceCitation
    sources={[{ sourceId: 'S1', title: '기사', source: '연합뉴스',
      url: 'https://a.com/1', publishedAt: '2026-09-01T00:00:00.000Z',
      collectedAt: '2026-09-03T01:00:00.000Z', type: 'news', relevance: 0 }]}
    meta={{ fabricatedUrlsRemoved: 0, collectedAt: '2026-09-03T01:00:00.000Z' }} />);

  assert.equal(screen.queryByText(/출처에 없는/), null);
});

// ─── ProgressIndicator ───

test('진행 표시는 두 단계만 쓴다', () => {
  // 원본 요구사항은 7단계지만 실제 호출은 2번이다.
  render(<ProgressIndicator stage="collecting" />);
  assert.ok(screen.getByText(/수집/));

  render(<ProgressIndicator stage="analyzing" />);
  assert.ok(screen.getByText(/분석|보고서/));
});

// ─── ErrorBanner ───

test('오류에 requestId를 함께 보여준다', () => {
  // 서버 로그와 대조할 수 있는 유일한 단서다.
  render(<ErrorBanner error={{ message: '문제가 생겼습니다', requestId: 'rq-abc123' }} />);

  assert.ok(screen.getByText(/문제가 생겼습니다/));
  assert.ok(screen.getByText(/rq-abc123/));
});

test('requestId가 없어도 죽지 않는다', () => {
  render(<ErrorBanner error={{ message: '오류' }} />);
  assert.ok(screen.getByText(/오류/));
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../MarketChart.jsx'`

- [ ] **Step 3: `MarketChart.jsx` 구현**

```jsx
import { buildChartGeometry, movingAverageLine } from '../lib/chart.js';

const BOX = { width: 640, height: 200, padding: 12 };

export default function MarketChart({ series, marketData }) {
  const points = series?.points;
  const geometry = buildChartGeometry(points, BOX);

  if (!geometry) {
    return (
      <section className="card">
        <h2 className="card-title">시장 데이터</h2>
        <p className="muted">자료 부족 — 차트를 그릴 가격 데이터가 없습니다.</p>
      </section>
    );
  }

  // 데이터가 모자라면 해당 이동평균을 그리지 않는다.
  const ma5 = movingAverageLine(points, 5, geometry);
  const ma20 = movingAverageLine(points, 20, geometry);

  return (
    <section className="card">
      <div className="chart-head">
        <h2 className="card-title">{series.symbol}</h2>
        <div>
          <strong className="price">{marketData?.currentPrice}</strong>
          <span className="change">{marketData?.priceChange}</span>
        </div>
      </div>

      <svg
        className="chart"
        viewBox={`0 0 ${BOX.width} ${BOX.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${series.symbol} 가격 추이 차트`}
      >
        <polyline className="chart-line" points={geometry.line} fill="none" />
        {ma5 && <polyline className="chart-ma5" points={ma5} fill="none" />}
        {ma20 && <polyline className="chart-ma20" points={ma20} fill="none" />}
      </svg>

      <div className="chart-legend">
        <span className="legend-line" /> 종가
        {ma5 && <><span className="legend-ma5" /> 5일</>}
        {ma20 && <><span className="legend-ma20" /> 20일</>}
        <span className="muted">
          최고 {geometry.max.toLocaleString()} · 최저 {geometry.min.toLocaleString()} {series.currency}
        </span>
      </div>

      {marketData?.chartTrend && <p className="trend">{marketData.chartTrend}</p>}
    </section>
  );
}
```

- [ ] **Step 4: 나머지 컴포넌트 구현**

`NewsList.jsx`:

```jsx
import { formatDateTime } from '../lib/format.js';

const KIND_LABEL = { headline: '제목만', summary: '요약', full: '전문' };

export default function NewsList({ items }) {
  if (!items?.length) return <p className="muted">자료가 없습니다.</p>;

  return (
    <ul className="news-list">
      {items.map((item) => (
        <li key={item.url} className="news-item">
          <div className="news-head">
            <span className="news-title">{item.title}</span>
            <span className={`kind kind-${item.contentKind ?? 'full'}`}>
              {KIND_LABEL[item.contentKind] ?? KIND_LABEL.full}
            </span>
          </div>
          <div className="news-meta">
            {item.source} · {formatDateTime(item.publishedAt)} ·{' '}
            <a href={item.url} target="_blank" rel="noopener noreferrer">원문</a>
          </div>
          {item.contentKind !== 'headline' && <p className="news-body">{item.content}</p>}
        </li>
      ))}
    </ul>
  );
}
```

`SourceSummary.jsx`:

```jsx
import { formatDateTime, formatCount } from '../lib/format.js';

const SOURCE_LABEL = {
  explicit: '직접 입력', alias: '별칭 사전', search: '검색', unresolved: '해석 실패',
};

export default function SourceSummary({ collected }) {
  if (!collected) return null;

  return (
    <section className="card">
      <div className="summary-grid">
        <div><strong>{formatCount(collected.newsCount, '건')}</strong><span>수집 자료</span></div>
        <div><strong className="warn">{formatCount(collected.headlineOnlyCount, '건')}</strong><span>제목만</span></div>
        <div><strong>{formatCount(collected.duplicatesRemoved, '건')}</strong><span>중복 제거</span></div>
        <div>
          <strong>{collected.resolvedSymbol ?? '—'}</strong>
          <span>종목 ({SOURCE_LABEL[collected.symbolSource] ?? collected.symbolSource})</span>
        </div>
      </div>

      <p className="muted small">
        기준 시각 {formatDateTime(collected.collectedAt)}
        {collected.feedsUsed?.length > 0 && <> · 사용 피드 {collected.feedsUsed.join(', ')}</>}
      </p>

      {collected.degraded?.length > 0 && (
        <ul className="degraded">
          {collected.degraded.map((d, i) => (
            <li key={`${d.provider}-${i}`}>{d.provider === 'market' ? '시장 데이터' : '뉴스'}: {d.reason}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

`InsightReport.jsx`:

```jsx
import RiskPanel from './RiskPanel.jsx';
import MonitoringIndicators from './MonitoringIndicators.jsx';

export default function InsightReport({ analysis, degraded }) {
  if (!analysis) return null;

  // 구조화 출력이 실패하면 Markdown 문자열 하나만 온다.
  // 렌더러를 붙이지 않고 pre로 표시한다 — 렌더러는 HTML을 만들고
  // 그 순간 XSS 표면이 생긴다.
  if (degraded) {
    return (
      <>
        <div className="banner warn-banner">
          구조화 출력이 실패해 서식이 단순합니다. 내용은 그대로입니다.
        </div>
        <section className="card">
          <pre className="fallback-report">{analysis.report}</pre>
        </section>
      </>
    );
  }

  return (
    <>
      <section className="card">
        <h2 className="card-title">핵심 요약</h2>
        <p>{analysis.summary}</p>
      </section>

      {analysis.newsBriefing?.length > 0 && (
        <section className="card">
          <h2 className="card-title">뉴스 브리핑</h2>
          {analysis.newsBriefing.map((b) => (
            <article key={b.sourceId} className="briefing">
              <div className="briefing-head">
                <span className="cite">{b.sourceId}</span>
                <strong>{b.title}</strong>
              </div>
              <div className="muted small">{b.source} · {b.publishedAt}</div>
              <p>{b.keyPoints}</p>
              <p className="muted">시장·기술적 의미: {b.marketImplication}</p>
              <p className="muted">확인 필요: {b.needsVerification}</p>
            </article>
          ))}
        </section>
      )}

      {analysis.trendAnalysis && (
        <section className="card">
          <h2 className="card-title">차트와 뉴스의 동향 비교</h2>
          <p>{analysis.trendAnalysis}</p>
        </section>
      )}

      {analysis.scenarios?.length > 0 && (
        <section className="card">
          <h2 className="card-title">투자 시나리오</h2>
          <div className="scenarios">
            {analysis.scenarios.map((s) => (
              <article key={s.type} className="scenario">
                <h3>{s.type}</h3>
                <dl>
                  <dt>전제</dt><dd>{s.premise}</dd>
                  <dt>확인할 지표</dt><dd>{s.indicatorsToWatch}</dd>
                  <dt>가능한 방향</dt><dd>{s.possibleDirection}</dd>
                  <dt>무효화 조건</dt><dd>{s.invalidationCondition}</dd>
                  <dt>주의할 점</dt><dd>{s.cautions}</dd>
                </dl>
              </article>
            ))}
          </div>
        </section>
      )}

      <RiskPanel risks={analysis.risks} />
      <MonitoringIndicators indicators={analysis.monitoringIndicators} />
    </>
  );
}
```

`RiskPanel.jsx`와 `MonitoringIndicators.jsx`:

```jsx
export default function RiskPanel({ risks }) {
  if (!risks?.length) return null;
  return (
    <section className="card">
      <h2 className="card-title">주의 사항</h2>
      <ul className="bullet">{risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
    </section>
  );
}
```

```jsx
export default function MonitoringIndicators({ indicators }) {
  if (!indicators?.length) return null;
  return (
    <section className="card">
      <h2 className="card-title">모니터링 지표</h2>
      <ul className="bullet">{indicators.map((s, i) => <li key={i}>{s}</li>)}</ul>
    </section>
  );
}
```

`SourceCitation.jsx`:

```jsx
import { formatDateTime } from '../lib/format.js';

export default function SourceCitation({ sources, meta }) {
  if (!sources?.length) return null;

  return (
    <section className="card">
      <h2 className="card-title">출처 ({sources.length}건)</h2>

      {meta?.fabricatedUrlsRemoved > 0 && (
        <p className="warn small">
          출처에 없는 링크 {meta.fabricatedUrlsRemoved}개를 보고서에서 제거했습니다.
        </p>
      )}

      <ol className="sources">
        {sources.map((s) => (
          <li key={s.sourceId}>
            <span className="cite">{s.sourceId}</span>
            <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a>
            <span className="muted small">
              {' '}· {s.source} · 작성 {formatDateTime(s.publishedAt)} · 수집 {formatDateTime(s.collectedAt)}
            </span>
          </li>
        ))}
      </ol>

      {meta?.collectedAt && (
        <p className="muted small">데이터 기준 시각: {formatDateTime(meta.collectedAt)}</p>
      )}
    </section>
  );
}
```

`Disclaimer.jsx`:

```jsx
const DEFAULT = '본 분석은 제공된 자료를 기반으로 한 정보 제공 목적의 분석이며, '
  + '특정 금융상품의 매수·매도 또는 투자 수익을 보장하는 투자 권유가 아닙니다.';

export default function Disclaimer({ text }) {
  return <footer className="disclaimer">{text || DEFAULT}</footer>;
}
```

`ProgressIndicator.jsx`:

```jsx
// 실제 호출은 collect 1회, analyze 1회다. 없는 단계를 흉내 내지 않는다.
const LABEL = {
  collecting: '자료를 수집하고 있습니다',
  analyzing: '분석 보고서를 작성하고 있습니다',
};

export default function ProgressIndicator({ stage }) {
  return (
    <div className="progress" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{LABEL[stage] ?? '처리 중입니다'}</span>
    </div>
  );
}
```

`ErrorBanner.jsx`:

```jsx
export default function ErrorBanner({ error, onDismiss }) {
  if (!error) return null;

  return (
    <div className="banner error-banner" role="alert">
      <span>{error.message}</span>
      {/* requestId는 서버 로그와 대조할 수 있는 유일한 단서다. */}
      {error.requestId && <code className="request-id">{error.requestId}</code>}
      {onDismiss && (
        <button type="button" className="link" onClick={onDismiss}>닫기</button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 334 + 18 = 352개

XSS 테스트 둘이 통과하는지 특히 확인한다. `globalThis.__pwned`와 `globalThis.__xss`가 `undefined`여야 한다.

- [ ] **Step 6: 커밋 (핸드오프 갱신 포함)**

```bash
git add client/ tests/ docs/SESSION-HANDOFF.md
git commit -m "feat: add display components with xss-safe rendering

LLM 응답을 React 기본 이스케이프로만 렌더링한다.
dangerouslySetInnerHTML을 쓰지 않으므로 응답에 script나 img onerror가
섞여 있어도 태그가 생성되지 않고 실행되지 않는다. 테스트로 고정했다.

Markdown 폴백은 pre로 표시한다. 렌더러를 붙이면 HTML을 만들고 그
순간 XSS 표면이 생긴다.

데이터가 모자라면 해당 이동평균 선을 그리지 않는다. 6개 점으로
20일선을 그리면 없는 것을 있는 것처럼 보여주게 된다.

수집 요약에서 제목만 확보된 개수를 강조한다. 제목뿐인 자료로 만든
분석을 전문 분석으로 오해하면 결론을 과신하게 된다.

오류에는 requestId를 함께 보여준다. 서버 로그와 대조할 수 있는
유일한 단서다."
```

---

## Task 6: 4개 화면과 상태 기계

**Files:**
- Create: `client/src/pages/{LoginPage,SearchPage,ReviewPage,ReportPage}.jsx`, `client/src/components/SearchForm.jsx`
- Modify: `client/src/App.jsx`
- Create: `tests/client/pages.test.js`, `tests/client/app-flow.test.js`

**Interfaces:**
- Consumes: `createApiClient` (Task 3), 표시 컴포넌트 전부 (Task 5), `messageForError` (Task 1)
- Produces:
  - `LoginPage({ api, onSuccess })`
  - `SearchPage({ api, budget, onCollected, onError })`
  - `ReviewPage({ collected, onApprove, onBack, busy })`
  - `ReportPage({ report, series, onNewSearch })`
  - `App({ api })` — `api`를 주입받아 테스트 가능하게 한다

- [ ] **Step 1: 실패하는 테스트 — `tests/client/pages.test.js`**

```js
import 'global-jsdom/register';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import LoginPage from '../../client/src/pages/LoginPage.jsx';
import ReviewPage from '../../client/src/pages/ReviewPage.jsx';
import ReportPage from '../../client/src/pages/ReportPage.jsx';

const COLLECTED = {
  newsList: [
    { title: '엔비디아 실적', content: '본문입니다', source: '연합뉴스',
      url: 'https://a.com/1', publishedAt: '2026-09-01T00:00:00.000Z', contentKind: 'summary' },
    { title: '제목만 기사', content: '제목만 기사', source: 'IT조선',
      url: 'https://b.com/2', publishedAt: '2026-09-02T00:00:00.000Z', contentKind: 'headline' },
  ],
  marketData: { assetName: 'NVDA', currentPrice: '224.41 USD', priceChange: '5.23%', chartTrend: '상승했습니다.' },
  marketSeries: {
    symbol: 'NVDA', currency: 'USD',
    points: Array.from({ length: 22 }, (_, i) => ({ t: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, c: 200 + i, v: 1 })),
    indicators: { ma5: 218, ma20: 219, high: 221, low: 200, changePct: 5.23, volatilityPct: 2.8, points: 22 },
  },
  collected: {
    collectedAt: '2026-09-03T01:00:00.000Z', resolvedSymbol: 'NVDA', symbolSource: 'explicit',
    feedsUsed: ['google-news-ko'], newsCount: 2, duplicatesRemoved: 0, headlineOnlyCount: 1, degraded: [],
  },
  estimate: {
    estimatedInputTokens: 1292, assumedOutputTokens: 2000, estimatedCostUsd: 0.02323,
    budget: { calls: { used: 3, limit: 50, remaining: 47 }, cost: { usedUsd: 0.31, limitUsd: 5, remainingUsd: 4.69 } },
  },
  confirmToken: 'ct_abc',
};

// ─── LoginPage ───

test('비밀번호를 입력해 로그인하면 성공 콜백이 불린다', async () => {
  let called = null;
  const api = { login: async (pw) => { called = pw; return { token: 't' }; } };
  render(<LoginPage api={api} onSuccess={() => {}} />);

  fireEvent.change(screen.getByLabelText(/비밀번호/), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: /로그인/ }));

  await waitFor(() => assert.equal(called, 'secret'));
});

test('로그인 실패 시 메시지를 보여주고 화면을 옮기지 않는다', async () => {
  const api = { login: async () => { throw { code: 'INVALID_CREDENTIALS' }; } };
  let moved = false;
  render(<LoginPage api={api} onSuccess={() => { moved = true; }} />);

  fireEvent.change(screen.getByLabelText(/비밀번호/), { target: { value: 'wrong' } });
  fireEvent.click(screen.getByRole('button', { name: /로그인/ }));

  await waitFor(() => assert.ok(screen.getByText(/비밀번호가 올바르지 않습니다/)));
  assert.equal(moved, false);
});

// ─── ReviewPage — 승인 지점 ───

test('검토 화면이 예상 비용과 남은 예산을 보여준다', () => {
  render(<ReviewPage collected={COLLECTED} onApprove={() => {}} onBack={() => {}} busy={false} />);

  assert.ok(screen.getByText(/0\.0232/), '예상 비용이 없다');
  assert.ok(screen.getByText(/47/), '남은 횟수가 없다');
});

test('검토 화면이 제목만 확보된 개수를 경고로 보여준다', () => {
  // 승인 전에 보여야 의미가 있다. 제목뿐인 자료로 만든 분석을
  // 전문 분석으로 오해하면 결론을 과신하게 된다.
  render(<ReviewPage collected={COLLECTED} onApprove={() => {}} onBack={() => {}} busy={false} />);

  const warn = screen.getByText(/제목만/);
  assert.ok(warn);
  assert.ok(warn.textContent.includes('1'), '제목만 개수가 없다');
});

test('승인 버튼을 누르면 확인 토큰과 함께 콜백이 불린다', () => {
  let got = null;
  render(<ReviewPage collected={COLLECTED} onApprove={(v) => { got = v; }} onBack={() => {}} busy={false} />);

  fireEvent.click(screen.getByRole('button', { name: /분석 시작/ }));

  assert.equal(got.confirmToken, 'ct_abc');
  assert.deepEqual(got.newsList, COLLECTED.newsList, 'newsList가 변형됐다');
  assert.deepEqual(got.marketData, COLLECTED.marketData);
});

test('처리 중이면 승인 버튼이 비활성화된다', () => {
  render(<ReviewPage collected={COLLECTED} onApprove={() => {}} onBack={() => {}} busy />);
  assert.equal(screen.getByRole('button', { name: /분석 시작/ }).disabled, true);
});

test('수집된 자료 목록을 보여준다', () => {
  render(<ReviewPage collected={COLLECTED} onApprove={() => {}} onBack={() => {}} busy={false} />);

  assert.ok(screen.getByText('엔비디아 실적'));
  assert.ok(screen.getByText('제목만 기사'));
});

// ─── ReportPage ───

test('보고서 화면이 차트를 맨 위에 둔다', () => {
  const { container } = render(<ReportPage
    report={{ analysis: { summary: '요약', newsBriefing: [], trendAnalysis: '', scenarios: [], risks: [], monitoringIndicators: [], disclaimer: '면책' },
      sources: [], meta: { degraded: false, fabricatedUrlsRemoved: 0, collectedAt: '2026-09-03T01:00:00.000Z' } }}
    series={COLLECTED.marketSeries}
    onNewSearch={() => {}} />);

  const sections = [...container.querySelectorAll('section, .card')];
  const chartIndex = sections.findIndex((s) => s.querySelector('svg.chart'));
  assert.equal(chartIndex, 0, '차트가 맨 위가 아니다');
});

test('보고서 화면에 면책 문구가 있다', () => {
  render(<ReportPage
    report={{ analysis: { summary: '요약', newsBriefing: [], trendAnalysis: '', scenarios: [], risks: [], monitoringIndicators: [], disclaimer: '투자 권유가 아닙니다.' },
      sources: [], meta: { degraded: false, fabricatedUrlsRemoved: 0 } }}
    series={undefined} onNewSearch={() => {}} />);

  assert.ok(screen.getByText(/투자 권유가 아닙니다/));
});

test('새 검색 버튼이 콜백을 부른다', () => {
  let clicked = false;
  render(<ReportPage
    report={{ analysis: { summary: '요약', newsBriefing: [], trendAnalysis: '', scenarios: [], risks: [], monitoringIndicators: [], disclaimer: '면책' },
      sources: [], meta: {} }}
    series={undefined} onNewSearch={() => { clicked = true; }} />);

  fireEvent.click(screen.getByRole('button', { name: /새 검색/ }));
  assert.equal(clicked, true);
});
```

- [ ] **Step 2: 실패하는 테스트 — `tests/client/app-flow.test.js`**

```js
import 'global-jsdom/register';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from '../../client/src/App.jsx';

const BUDGET = {
  calls: { used: 0, limit: 50, remaining: 50, resetsAt: '2026-09-04T00:00:00.000Z' },
  cost: { usedUsd: 0, limitUsd: 5, remainingUsd: 5, resetsAt: '2026-10-01T00:00:00.000Z' },
};

const COLLECT_RESULT = {
  newsList: [{ title: '기사', content: '본문', source: '연합뉴스',
    url: 'https://a.com/1', publishedAt: '2026-09-01T00:00:00.000Z', contentKind: 'summary' }],
  marketData: { assetName: 'NVDA', currentPrice: '224.41 USD', priceChange: '5.23%', chartTrend: '상승' },
  marketSeries: { symbol: 'NVDA', currency: 'USD', points: [{ t: 'a', c: 1 }, { t: 'b', c: 2 }], indicators: {} },
  collected: { collectedAt: '2026-09-03T01:00:00.000Z', resolvedSymbol: 'NVDA', symbolSource: 'explicit',
    feedsUsed: ['google-news-ko'], newsCount: 1, duplicatesRemoved: 0, headlineOnlyCount: 0, degraded: [] },
  estimate: { estimatedInputTokens: 100, estimatedCostUsd: 0.001, budget: BUDGET },
  confirmToken: 'ct_xyz',
};

const REPORT = {
  analysis: { summary: '분석 요약입니다', newsBriefing: [], trendAnalysis: '',
    scenarios: [], risks: [], monitoringIndicators: [], disclaimer: '면책' },
  sources: [], meta: { degraded: false, fabricatedUrlsRemoved: 0, collectedAt: '2026-09-03T01:00:00.000Z' },
};

const makeApi = (over = {}) => ({
  login: async () => ({ token: 't', expiresAt: 'x' }),
  budget: async () => BUDGET,
  collect: async () => COLLECT_RESULT,
  analyze: async () => REPORT,
  logout: async () => {},
  ...over,
});

const login = async () => {
  fireEvent.change(screen.getByLabelText(/비밀번호/), { target: { value: 'pw' } });
  fireEvent.click(screen.getByRole('button', { name: /로그인/ }));
  await waitFor(() => screen.getByLabelText(/검색어/));
};

test('로그인하면 검색 화면으로 넘어간다', async () => {
  render(<App api={makeApi()} />);
  await login();
  assert.ok(screen.getByLabelText(/검색어/));
});

test('검색하면 검토 화면으로 넘어간다', async () => {
  render(<App api={makeApi()} />);
  await login();

  fireEvent.change(screen.getByLabelText(/검색어/), { target: { value: '엔비디아' } });
  fireEvent.click(screen.getByRole('button', { name: /자료 수집/ }));

  await waitFor(() => assert.ok(screen.getByRole('button', { name: /분석 시작/ })));
});

test('승인하면 보고서 화면으로 넘어간다', async () => {
  render(<App api={makeApi()} />);
  await login();

  fireEvent.change(screen.getByLabelText(/검색어/), { target: { value: '엔비디아' } });
  fireEvent.click(screen.getByRole('button', { name: /자료 수집/ }));
  await waitFor(() => screen.getByRole('button', { name: /분석 시작/ }));

  fireEvent.click(screen.getByRole('button', { name: /분석 시작/ }));
  await waitFor(() => assert.ok(screen.getByText('분석 요약입니다')));
});

test('분석에 확인 토큰과 원본 newsList가 그대로 전달된다', async () => {
  // 한 글자만 바뀌어도 cacheKey가 달라져 428이 난다.
  let sent = null;
  render(<App api={makeApi({ analyze: async (a) => { sent = a; return REPORT; } })} />);
  await login();

  fireEvent.change(screen.getByLabelText(/검색어/), { target: { value: '엔비디아' } });
  fireEvent.click(screen.getByRole('button', { name: /자료 수집/ }));
  await waitFor(() => screen.getByRole('button', { name: /분석 시작/ }));
  fireEvent.click(screen.getByRole('button', { name: /분석 시작/ }));

  await waitFor(() => assert.ok(sent));
  assert.equal(sent.confirmToken, 'ct_xyz');
  assert.deepEqual(sent.newsList, COLLECT_RESULT.newsList);
});

test('세션 만료(403)는 로그인 화면으로 되돌린다', async () => {
  render(<App api={makeApi({ collect: async () => { throw { code: 'FORBIDDEN' }; } })} />);
  await login();

  fireEvent.change(screen.getByLabelText(/검색어/), { target: { value: '엔비디아' } });
  fireEvent.click(screen.getByRole('button', { name: /자료 수집/ }));

  await waitFor(() => assert.ok(screen.getByLabelText(/비밀번호/)));
  assert.ok(screen.getByText(/다시 로그인/));
});

test('상류 오류는 검토 화면을 유지해 재시도할 수 있게 한다', async () => {
  // 수집 결과와 확인 토큰이 아직 유효하므로 무료인 수집을 다시 할 이유가 없다.
  render(<App api={makeApi({ analyze: async () => { throw { code: 'UPSTREAM_TIMEOUT' }; } })} />);
  await login();

  fireEvent.change(screen.getByLabelText(/검색어/), { target: { value: '엔비디아' } });
  fireEvent.click(screen.getByRole('button', { name: /자료 수집/ }));
  await waitFor(() => screen.getByRole('button', { name: /분석 시작/ }));
  fireEvent.click(screen.getByRole('button', { name: /분석 시작/ }));

  await waitFor(() => assert.ok(screen.getByText(/지연되었습니다/)));
  assert.ok(screen.getByRole('button', { name: /분석 시작/ }), '검토 화면을 벗어났다');
});

test('수집 실패는 검색 화면을 유지한다', async () => {
  render(<App api={makeApi({
    collect: async () => { throw { code: 'COLLECTION_FAILED', message: '분석할 뉴스를 수집하지 못했습니다.' }; },
  })} />);
  await login();

  fireEvent.change(screen.getByLabelText(/검색어/), { target: { value: '없는주제' } });
  fireEvent.click(screen.getByRole('button', { name: /자료 수집/ }));

  await waitFor(() => assert.ok(screen.getByText(/수집하지 못했습니다/)));
  assert.ok(screen.getByLabelText(/검색어/), '검색 화면을 벗어났다');
});

test('수집 중에는 진행 표시가 나온다', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  render(<App api={makeApi({ collect: async () => { await gate; return COLLECT_RESULT; } })} />);
  await login();

  fireEvent.change(screen.getByLabelText(/검색어/), { target: { value: '엔비디아' } });
  fireEvent.click(screen.getByRole('button', { name: /자료 수집/ }));

  await waitFor(() => assert.ok(screen.getByText(/수집하고 있습니다/)));
  release();
});

test('새 검색을 누르면 검색 화면으로 돌아간다', async () => {
  render(<App api={makeApi()} />);
  await login();

  fireEvent.change(screen.getByLabelText(/검색어/), { target: { value: '엔비디아' } });
  fireEvent.click(screen.getByRole('button', { name: /자료 수집/ }));
  await waitFor(() => screen.getByRole('button', { name: /분석 시작/ }));
  fireEvent.click(screen.getByRole('button', { name: /분석 시작/ }));
  await waitFor(() => screen.getByText('분석 요약입니다'));

  fireEvent.click(screen.getByRole('button', { name: /새 검색/ }));
  await waitFor(() => assert.ok(screen.getByLabelText(/검색어/)));
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../LoginPage.jsx'`

- [ ] **Step 4: `LoginPage.jsx` 구현**

```jsx
import { useState } from 'react';
import { messageForError } from '../api/errors.js';
import ErrorBanner from '../components/ErrorBanner.jsx';

export default function LoginPage({ api, onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError({ ...messageForError(err), requestId: err.requestId });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="centered">
      <form className="card login" onSubmit={submit}>
        <h1>통합 분석 플랫폼</h1>
        <p className="muted">뉴스와 시장 데이터를 모아 분석합니다.</p>

        <ErrorBanner error={error} />

        <label htmlFor="password">비밀번호</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        <button type="submit" className="primary" disabled={busy || !password}>
          {busy ? '확인 중…' : '로그인'}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: `SearchForm.jsx`와 `SearchPage.jsx` 구현**

```jsx
import { useState } from 'react';

const RANGES = [
  ['5d', '5일'], ['1mo', '1개월'], ['3mo', '3개월'], ['6mo', '6개월'], ['1y', '1년'],
];

export default function SearchForm({ onSubmit, disabled }) {
  const [form, setForm] = useState({
    query: '', symbol: '', assetType: 'stock', lang: 'ko', range: '1mo', maxNews: 10,
  });

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <form
      className="card search-form"
      onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}
    >
      <label htmlFor="query">검색어</label>
      <input id="query" value={form.query} onChange={set('query')} required
        placeholder="예: 엔비디아 AI 반도체" />

      <label htmlFor="symbol">종목 코드 <span className="muted">(선택)</span></label>
      <input id="symbol" value={form.symbol} onChange={set('symbol')}
        placeholder="비우면 자동으로 찾습니다 (예: NVDA, 005930.KS)" />

      <fieldset>
        <legend>자산 종류</legend>
        {[['stock', '주식'], ['crypto', '코인']].map(([v, label]) => (
          <label key={v} className="radio">
            <input type="radio" name="assetType" value={v}
              checked={form.assetType === v} onChange={set('assetType')} />
            {label}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>뉴스 언어</legend>
        {[['ko', '한국어'], ['en', 'English']].map(([v, label]) => (
          <label key={v} className="radio">
            <input type="radio" name="lang" value={v}
              checked={form.lang === v} onChange={set('lang')} />
            {label}
          </label>
        ))}
      </fieldset>

      <label htmlFor="range">분석 기간</label>
      <select id="range" value={form.range} onChange={set('range')}>
        {RANGES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>

      <label htmlFor="maxNews">최대 기사 수: {form.maxNews}</label>
      <input id="maxNews" type="range" min="1" max="20" value={form.maxNews}
        onChange={(e) => setForm({ ...form, maxNews: Number(e.target.value) })} />

      <button type="submit" className="primary" disabled={disabled || !form.query}>
        자료 수집
      </button>
    </form>
  );
}
```

```jsx
import SearchForm from '../components/SearchForm.jsx';
import { formatUsd } from '../lib/format.js';

export default function SearchPage({ budget, onSearch, busy }) {
  // 예산이 없으면 수집까지 한 뒤 막히는 것보다 여기서 막는 편이 낫다.
  const callsLeft = budget?.calls?.remaining ?? null;
  const costLeft = budget?.cost?.remainingUsd ?? null;
  const exhausted = callsLeft === 0 || costLeft === 0;

  return (
    <main className="page">
      <header className="page-head">
        <h1>무엇을 분석할까요?</h1>
        {budget && (
          <p className="muted">
            오늘 {callsLeft}/{budget.calls.limit}회 남음 · 이번 달 {formatUsd(costLeft)} 남음
          </p>
        )}
      </header>

      {exhausted && (
        <div className="banner warn-banner">
          예산을 모두 사용했습니다. 한도가 초기화된 뒤 다시 시도해 주세요.
        </div>
      )}

      <SearchForm onSubmit={onSearch} disabled={busy || exhausted} />
    </main>
  );
}
```

- [ ] **Step 6: `ReviewPage.jsx` 구현**

```jsx
import SourceSummary from '../components/SourceSummary.jsx';
import NewsList from '../components/NewsList.jsx';
import { formatUsd } from '../lib/format.js';

export default function ReviewPage({ collected, onApprove, onBack, busy }) {
  if (!collected) return null;

  const { newsList, marketData, collected: meta, estimate, confirmToken } = collected;
  const headlineOnly = meta?.headlineOnlyCount ?? 0;

  return (
    <main className="page has-sticky">
      <header className="page-head">
        <h1>수집한 자료를 확인해 주세요</h1>
        <button type="button" className="link" onClick={onBack}>검색으로</button>
      </header>

      <SourceSummary collected={meta} />

      {marketData && (
        <section className="card">
          <h2 className="card-title">시장 데이터</h2>
          <p>
            <strong>{marketData.assetName}</strong> {marketData.currentPrice}
            {' '}<span className="change">{marketData.priceChange}</span>
          </p>
          <p className="muted small">{marketData.chartTrend}</p>
        </section>
      )}

      <section className="card">
        <h2 className="card-title">수집된 뉴스</h2>
        <NewsList items={newsList} />
      </section>

      {/* 승인 바. 스크롤해도 화면 아래 붙어 있다. */}
      <div className="sticky-bar">
        <div className="sticky-info">
          <span>
            예상 비용 <strong>{formatUsd(estimate?.estimatedCostUsd)}</strong>
            {estimate?.budget && (
              <> · 오늘 {estimate.budget.calls.used}/{estimate.budget.calls.limit}회 사용</>
            )}
          </span>
          {/* 승인 전에 보여야 의미가 있다. 제목뿐인 자료로 만든 분석을
              전문 분석으로 오해하면 결론을 과신하게 된다. */}
          {headlineOnly > 0 && (
            <span className="warn small">
              {newsList.length}건 중 {headlineOnly}건은 제목만 확보 — 본문 없이 분석합니다
            </span>
          )}
        </div>
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => onApprove({ newsList, marketData, confirmToken })}
        >
          {busy ? '분석 중…' : '분석 시작'}
        </button>
      </div>
    </main>
  );
}
```

**주의**: `onApprove`에 `newsList`·`marketData`를 **그대로** 넘긴다. 복사하거나 정렬하지 않는다.

- [ ] **Step 7: `ReportPage.jsx` 구현**

```jsx
import MarketChart from '../components/MarketChart.jsx';
import InsightReport from '../components/InsightReport.jsx';
import SourceCitation from '../components/SourceCitation.jsx';
import Disclaimer from '../components/Disclaimer.jsx';

export default function ReportPage({ report, series, onNewSearch }) {
  if (!report) return null;
  const { analysis, sources, meta } = report;

  return (
    <main className="page">
      {/* 차트가 맨 위. 뉴스와 차트를 대조하는 것이 이 보고서의 핵심이다. */}
      <MarketChart series={series} marketData={undefined} />

      <InsightReport analysis={analysis} degraded={Boolean(meta?.degraded)} />

      <SourceCitation sources={sources} meta={meta} />

      <Disclaimer text={analysis?.disclaimer} />

      <div className="page-actions">
        <button type="button" className="primary" onClick={onNewSearch}>새 검색</button>
      </div>
    </main>
  );
}
```

**주의**: `MarketChart`에 `marketData`를 넘기지 않으면 현재가가 표시되지 않는다. `ReportPage`가 `marketData`도 받도록 props를 확장한다.

```jsx
export default function ReportPage({ report, series, marketData, onNewSearch }) {
  // ...
  <MarketChart series={series} marketData={marketData} />
```

- [ ] **Step 8: `App.jsx` 구현**

```jsx
import { useState, useEffect } from 'react';
import { createApiClient } from './api/client.js';
import { messageForError } from './api/errors.js';

import LoginPage from './pages/LoginPage.jsx';
import SearchPage from './pages/SearchPage.jsx';
import ReviewPage from './pages/ReviewPage.jsx';
import ReportPage from './pages/ReportPage.jsx';
import ProgressIndicator from './components/ProgressIndicator.jsx';
import ErrorBanner from './components/ErrorBanner.jsx';

const defaultApi = createApiClient();

export default function App({ api = defaultApi }) {
  const [step, setStep] = useState('login');
  const [collected, setCollected] = useState(null);
  const [report, setReport] = useState(null);
  const [budget, setBudget] = useState(null);
  const [error, setError] = useState(null);

  // 검색 화면에 들어올 때마다 남은 예산을 새로 읽는다.
  useEffect(() => {
    if (step !== 'search') return;
    api.budget().then(setBudget).catch(() => setBudget(null));
  }, [step, api]);

  /** 오류를 메시지로 바꾸고 지정된 화면으로 옮긴다. */
  const handleError = (err) => {
    const mapped = messageForError(err);
    setError({ message: mapped.message, requestId: err?.requestId });
    if (mapped.nextStep) setStep(mapped.nextStep);
  };

  const search = async (form) => {
    setStep('collecting');
    setError(null);
    try {
      const result = await api.collect(form);
      setCollected(result);
      setStep('review');
    } catch (err) {
      // nextStep이 없으면 검색 화면으로 되돌린다. 수집 중 화면에 머물면 안 된다.
      const mapped = messageForError(err);
      setError({ message: mapped.message, requestId: err?.requestId });
      setStep(mapped.nextStep ?? 'search');
    }
  };

  const approve = async ({ newsList, marketData, confirmToken }) => {
    setStep('analyzing');
    setError(null);
    try {
      // newsList를 그대로 넘긴다. 한 글자만 바뀌어도 확인 토큰이 428로 거부된다.
      const result = await api.analyze({ newsList, marketData, confirmToken });
      setReport(result);
      setStep('report');
    } catch (err) {
      const mapped = messageForError(err);
      setError({ message: mapped.message, requestId: err?.requestId });
      // 상류 오류는 검토 화면으로 돌아가 재시도할 수 있게 한다.
      setStep(mapped.nextStep ?? 'review');
    }
  };

  const newSearch = () => {
    setCollected(null);
    setReport(null);
    setError(null);
    setStep('search');
  };

  if (step === 'login') {
    return <LoginPage api={api} onSuccess={() => { setError(null); setStep('search'); }} />;
  }

  return (
    <>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {step === 'collecting' && <ProgressIndicator stage="collecting" />}
      {step === 'analyzing' && <ProgressIndicator stage="analyzing" />}

      {step === 'search' && <SearchPage budget={budget} onSearch={search} busy={false} />}

      {(step === 'review' || step === 'analyzing') && (
        <ReviewPage
          collected={collected}
          onApprove={approve}
          onBack={newSearch}
          busy={step === 'analyzing'}
        />
      )}

      {step === 'report' && (
        <ReportPage
          report={report}
          series={collected?.marketSeries}
          marketData={collected?.marketData}
          onNewSearch={newSearch}
        />
      )}
    </>
  );
}
```

**설계 메모**: `analyzing`일 때도 `ReviewPage`를 계속 렌더링한다. 분석이 실패하면 그 자리에서 재시도할 수 있고, 화면이 깜빡이지 않는다.

- [ ] **Step 9: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 352 + 19 = 371개

- [ ] **Step 10: 커밋 (핸드오프 갱신 포함)**

```bash
git add client/ tests/ docs/SESSION-HANDOFF.md
git commit -m "feat: add four screens and step state machine

로그인 → 검색 → 검토 → 보고서 마법사를 단계 상태 하나로 관리한다.
라우터를 쓰지 않는 이유는 뒤로가기가 필요 없는 선형 흐름이고
새로고침하면 수집 결과가 어차피 사라지기 때문이다.

검토 화면 하단 고정 바에 예상 비용과 남은 예산에 더해 제목만 확보된
개수를 함께 보여준다. 승인 전에 보이지 않으면 제목뿐인 자료로 만든
분석을 전문 분석으로 오해하게 된다.

승인 시 newsList와 marketData를 복사하거나 정렬하지 않고 그대로
넘긴다. 한 글자만 바뀌어도 서버의 cacheKey가 달라져 확인 토큰이
428로 거부된다.

상류 오류는 검토 화면을 유지한다. 수집 결과와 확인 토큰이 아직
유효하므로 무료인 수집을 다시 할 이유가 없다. analyzing 중에도
ReviewPage를 계속 렌더링해 실패 시 그 자리에서 재시도한다.

검색 화면 진입 시마다 예산을 새로 읽어 소진됐으면 수집 전에 막는다."
```

---

## Task 7: 스타일

**Files:**
- Create: `client/src/styles/theme.css`, `client/src/styles/app.css` (Task 1에서 만든 빈 파일을 채운다)

**Interfaces:**
- Consumes: Task 5·6이 사용한 클래스 이름
- Produces: 시각 스타일. 테스트가 없다 — CSS는 렌더링 결과를 눈으로 확인한다

스펙 §6의 토큰을 그대로 쓴다.

- [ ] **Step 1: `theme.css`**

```css
:root {
  --bg: #faf9f7;
  --surface: #fdfcfa;
  --text: #2b2724;
  --muted: #6b6560;
  --border: #d4d0c8;
  --accent: #d97706;
  --accent-soft: #fef3e2;
  --accent-border: #f0c88a;
  --warn-text: #92500a;

  --radius: 10px;
  --gap: 12px;
  --measure: 72ch;

  --font: system-ui, -apple-system, 'Segoe UI', 'Noto Sans KR', sans-serif;
  --mono: ui-monospace, 'Cascadia Code', Consolas, monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1c1a18;
    --surface: #24211e;
    --text: #ece8e2;
    --muted: #9c948b;
    --border: #3a352f;
    --accent: #f59e0b;
    --accent-soft: #3a2a12;
    --accent-border: #6b4a15;
    --warn-text: #f0c88a;
  }
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  line-height: 1.65;
}

/* 키보드 접근성. 포커스가 어디 있는지 항상 보여야 한다. */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

- [ ] **Step 2: `app.css`**

```css
.page {
  max-width: var(--measure);
  margin: 0 auto;
  padding: 24px 16px 32px;
}
.page.has-sticky { padding-bottom: 120px; }   /* 고정 바에 가려지지 않게 */

.centered {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 16px;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px 18px;
  margin-bottom: var(--gap);
}
.card-title { font-size: 15px; margin: 0 0 10px; }

.muted { color: var(--muted); }
.small { font-size: 12.5px; }
.warn { color: var(--warn-text); }

button.primary {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 11px 20px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
button.primary:disabled { opacity: .5; cursor: not-allowed; }

button.link {
  background: none;
  border: none;
  color: var(--muted);
  cursor: pointer;
  text-decoration: underline;
  padding: 4px;
}

/* ─── 폼 ─── */
.search-form label { display: block; margin-top: 14px; font-size: 13px; font-weight: 600; }
.search-form input[type='text'],
.search-form input:not([type]),
.search-form input[type='password'],
.search-form select {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  margin-top: 4px;
}
.search-form fieldset {
  border: none; padding: 0; margin: 14px 0 0;
}
.search-form legend { font-size: 13px; font-weight: 600; padding: 0; }
.radio { display: inline-flex; align-items: center; gap: 5px; margin-right: 14px; font-weight: 400; }
.search-form button.primary { margin-top: 20px; width: 100%; }

.login { width: min(420px, 100%); }
.login label { display: block; margin-top: 14px; font-size: 13px; font-weight: 600; }
.login input { width: 100%; padding: 9px 11px; border: 1px solid var(--border);
  border-radius: 8px; background: var(--bg); color: var(--text); margin-top: 4px; }
.login button { margin-top: 18px; width: 100%; }

/* ─── 배너 ─── */
.banner {
  border-radius: 8px;
  padding: 10px 14px;
  margin: 0 auto var(--gap);
  max-width: var(--measure);
  font-size: 13.5px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.error-banner { background: var(--accent-soft); border: 1px solid var(--accent-border); color: var(--warn-text); }
.warn-banner { background: var(--accent-soft); border: 1px solid var(--accent-border); color: var(--warn-text); }
.request-id { font-family: var(--mono); font-size: 11px; opacity: .75; }

/* ─── 진행 표시 ─── */
.progress {
  display: flex; align-items: center; gap: 10px;
  max-width: var(--measure); margin: 16px auto; padding: 0 16px;
  color: var(--muted); font-size: 14px;
}
.spinner {
  width: 15px; height: 15px; border-radius: 50%;
  border: 2px solid var(--border); border-top-color: var(--accent);
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ─── 수집 요약 ─── */
.summary-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; text-align: center;
}
.summary-grid strong { display: block; font-size: 20px; }
.summary-grid span { font-size: 11.5px; color: var(--muted); }
.degraded { margin: 10px 0 0; padding-left: 18px; font-size: 12.5px; color: var(--warn-text); }

/* ─── 뉴스 ─── */
.news-list { list-style: none; margin: 0; padding: 0; }
.news-item { padding: 11px 0; border-bottom: 1px solid var(--border); }
.news-item:last-child { border-bottom: none; }
.news-head { display: flex; justify-content: space-between; gap: 10px; align-items: start; }
.news-title { font-weight: 600; font-size: 14px; }
.news-meta { font-size: 12px; color: var(--muted); margin-top: 3px; }
.news-body { font-size: 13px; margin: 6px 0 0; }

.kind {
  flex: none; font-size: 10.5px; padding: 2px 8px; border-radius: 99px;
  border: 1px solid var(--border); color: var(--muted);
}
.kind-headline { background: var(--accent-soft); border-color: var(--accent-border); color: var(--warn-text); }

/* ─── 승인 바 ─── */
.sticky-bar {
  position: fixed; left: 0; right: 0; bottom: 0;
  background: var(--surface); border-top: 1px solid var(--accent-border);
  padding: 12px 16px;
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
}
.sticky-info { display: flex; flex-direction: column; gap: 2px; font-size: 13px; }

/* ─── 차트 ─── */
.chart-head { display: flex; justify-content: space-between; align-items: baseline; }
.price { font-size: 17px; }
.change { color: var(--accent); margin-left: 6px; font-size: 13px; }
.chart { width: 100%; height: 200px; display: block; }
.chart-line { stroke: var(--accent); stroke-width: 2; }
.chart-ma5 { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 4 3; }
.chart-ma20 { stroke: var(--border); stroke-width: 1; }
.chart-legend { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--muted); flex-wrap: wrap; }
.legend-line, .legend-ma5, .legend-ma20 { display: inline-block; width: 14px; height: 2px; }
.legend-line { background: var(--accent); }
.legend-ma5 { background: var(--muted); }
.legend-ma20 { background: var(--border); }
.trend { font-size: 13px; color: var(--muted); margin: 10px 0 0; }

/* ─── 보고서 ─── */
.cite {
  font-family: var(--mono); font-size: 11px; padding: 1px 6px; border-radius: 4px;
  background: var(--accent-soft); border: 1px solid var(--accent-border);
  color: var(--warn-text); margin-right: 6px;
}
.briefing { padding: 11px 0; border-bottom: 1px solid var(--border); }
.briefing:last-child { border-bottom: none; }
.briefing-head { display: flex; align-items: center; gap: 4px; }
.scenarios { display: grid; gap: 10px; }
.scenario { border: 1px solid var(--border); border-radius: 8px; padding: 11px 13px; }
.scenario h3 { margin: 0 0 8px; font-size: 14px; }
.scenario dl { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; font-size: 13px; }
.scenario dt { color: var(--muted); }
.scenario dd { margin: 0; }
.bullet { margin: 0; padding-left: 18px; font-size: 13.5px; }
.sources { font-size: 13px; padding-left: 20px; }
.fallback-report { white-space: pre-wrap; font-family: var(--mono); font-size: 12.5px; margin: 0; }
.disclaimer {
  max-width: var(--measure); margin: 20px auto 0; padding: 12px 16px;
  font-size: 12px; color: var(--muted); border-top: 1px solid var(--border);
}
.page-actions { margin-top: 20px; text-align: center; }
.page-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; }
.page-head h1 { font-size: 19px; margin: 0; }

a { color: var(--accent); }

/* ─── 모바일 ─── */
@media (max-width: 640px) {
  .summary-grid { grid-template-columns: repeat(2, 1fr); }
  .sticky-bar { flex-direction: column; align-items: stretch; }
  .sticky-bar button { width: 100%; }
  .scenario dl { grid-template-columns: 1fr; }
  .page.has-sticky { padding-bottom: 160px; }
}
```

- [ ] **Step 3: 빌드와 테스트 확인**

```bash
npm run build:client
npm test
```

Expected: 빌드 성공, 371개 통과.

- [ ] **Step 4: 커밋 (핸드오프 갱신 포함)**

```bash
git add client/ docs/SESSION-HANDOFF.md
git commit -m "style: add calm off-white theme with amber accent

원본 요구사항의 방향을 따른다. 따뜻한 오프화이트 배경, 짙은 차콜
텍스트, 절제된 앰버 포인트. 그라디언트를 쓰지 않고 카드와 패널로
정보 계층을 만든다.

본문 폭을 72ch로 제한하고 모바일에서 단일 열로 무너진다.
다크모드는 prefers-color-scheme으로 토큰만 교체한다.

포커스 표시를 명시적으로 둔다. 키보드로 조작할 때 지금 어디에
있는지 보여야 한다."
```

---

## Task 8: Express 정적 서빙, 문서, 실제 확인, PR

**Files:**
- Modify: `server.js`, `README.md`, `docs/api.md`, `docs/security.md`, `docs/architecture.md`, `docs/implementation-plan.md`, `docs/SESSION-HANDOFF.md`
- Test: `tests/static.test.js`

**Interfaces:**
- Consumes: `client/dist` 빌드 산출물
- Produces: 단일 서버가 API와 프론트를 모두 서빙

- [ ] **Step 1: 실패하는 테스트 — `tests/static.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bootstrap } from './helpers.js';

const built = existsSync(fileURLToPath(new URL('../client/dist/index.html', import.meta.url)));

test('API 경로는 정적 서빙에 가로채이지 않는다', async () => {
  const { app } = bootstrap();
  const res = await request(app).get('/api/health');

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('없는 API 경로는 여전히 JSON 404를 준다', async () => {
  // SPA 폴백이 /api/*를 삼키면 클라이언트가 HTML을 JSON으로 파싱하려다 죽는다.
  const { app } = bootstrap();
  const res = await request(app).get('/api/nope');

  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('빌드가 있으면 루트가 HTML을 준다', { skip: !built }, async () => {
  const { app } = bootstrap();
  const res = await request(app).get('/');

  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /html/);
});

test('빌드가 있으면 임의 경로도 SPA로 폴백한다', { skip: !built }, async () => {
  const { app } = bootstrap();
  const res = await request(app).get('/some/deep/route');

  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /html/);
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npm run build:client && npm test
```

Expected: FAIL — 루트가 `404 NOT_FOUND` JSON을 준다

- [ ] **Step 3: `server.js`에 정적 서빙 추가**

import에 추가한다.

```js
import { existsSync } from 'node:fs';
import { join } from 'node:path';
```

`fileURLToPath`는 `pathToFileURL`과 같은 모듈이므로 기존 import를 확장한다.

```js
import { pathToFileURL, fileURLToPath } from 'node:url';
```

`extraRoutes` 호출 **뒤**, 404 핸들러 **앞**에 넣는다.

```js
  // ─── 빌드된 프론트엔드 서빙 ───
  // API 라우트가 모두 등록된 뒤에 둔다. fileURLToPath를 써야 한다 —
  // URL.pathname은 Windows에서 '/C:/...'가 되어 existsSync가 실패한다.
  const clientDir = fileURLToPath(new URL('./client/dist/', import.meta.url));
  if (existsSync(join(clientDir, 'index.html'))) {
    app.use(express.static(clientDir));
    // SPA 폴백. /api/* 는 위에서 이미 처리됐으므로 여기 오면 안 된다.
    app.get(/^(?!\/api\/).*/, (req, res) => {
      res.sendFile(join(clientDir, 'index.html'));
    });
  }
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test`
Expected: PASS — 371 + 4 = 375개

- [ ] **Step 5: 실제 브라우저 확인**

```bash
npm run build:client
MY_SECRET_PASSWORD=local-pw LLM_MODE=mock PORT=3000 npm start
```

브라우저에서 `http://localhost:3000`을 열고 확인한다.

1. 로그인 화면이 뜨고 `local-pw`로 로그인된다
2. 검색 화면에 남은 예산이 표시된다
3. "엔비디아 AI 반도체", 종목 `NVDA`로 수집한다
4. 검토 화면에 자료 목록·예상 비용·**제목만 N건**이 보인다
5. 승인하면 보고서가 나오고 **차트가 맨 위에 그려진다**
6. 출처 목록의 링크가 새 탭으로 열린다
7. 브라우저 창을 좁혀 모바일 레이아웃이 무너지지 않는지 본다

**실패하면 여기서 멈춘다.** 특히 차트가 안 그려지면 `marketSeries`가 응답에 없는 것이다.

- [ ] **Step 6: 문서 갱신**

`docs/api.md`:
- `collect` 응답 예시에 `marketSeries` 추가하고 필드 설명
- `marketSeries`가 분석 프롬프트에 포함되지 않는다는 점 명시

`docs/security.md`:
- `## 8. 이 단계 범위 밖`의 XSS·CORS 행을 옮겨 새 절 `## 10. 프론트엔드 (Phase 3)`를 만든다

```markdown
| 점검 항목 | 상태 | 구현 위치 | 검증 |
|---|---|---|---|
| LLM 응답을 HTML로 렌더링할 때 XSS를 방지하는가 | ✅ | `dangerouslySetInnerHTML`을 쓰지 않는다. React 기본 이스케이프에 의존 | `components.test.js` — "LLM 응답에 script가 들어와도 DOM에 태그가 생기지 않는다", "img onerror도 실행되지 않는다" |
| Markdown 폴백이 XSS 표면을 만들지 않는가 | ✅ | 렌더러 없이 `<pre>`로 표시 | `components.test.js` — "degraded면 Markdown 폴백을 pre로 표시한다" |
| CORS가 제한되어 있는가 | ✅ | 동일 출처라 CORS 미들웨어가 불필요하다. Express가 프론트를 서빙한다 | `static.test.js` |
| 토큰이 JS에서 접근 가능한가 | ✅ 아니다 | HttpOnly 쿠키만 쓴다. `localStorage`·헤더를 쓰지 않는다 | `api-client.test.js` — "토큰을 저장하거나 헤더에 넣지 않는다" |
| 외부 링크가 opener를 노출하는가 | ✅ 아니다 | 모든 외부 링크에 `rel="noopener noreferrer"` | `components.test.js` — "외부 링크에 noopener noreferrer를 붙인다" |
| API 경로가 SPA 폴백에 삼켜지는가 | ✅ 아니다 | 정적 서빙을 API 라우트 뒤에 등록하고 폴백에서 `/api/`를 제외 | `static.test.js` — "없는 API 경로는 여전히 JSON 404를 준다" |
```

`docs/architecture.md`에 프론트엔드 절을 추가한다 — 단계 상태 기계, 라우터를 쓰지 않는 이유, 새로고침 시 수집 결과가 사라지는 한계.

`docs/implementation-plan.md`에 Phase 3 설계 판단을 추가한다 — 진행 표시를 2단계로 한 이유, Markdown 렌더러를 붙이지 않은 이유, `marketSeries`를 프롬프트에서 뺀 이유.

`README.md`:
- 진행 상태표에서 Phase 3를 완료로
- 실행 방법에 `npm run build:client` 추가
- 화면 흐름 설명 추가
- 환경변수표에 `CORS_ORIGIN`이 현재 미사용임을 명시

- [ ] **Step 7: 최종 검증**

```bash
npm test
npm run build:client
MY_SECRET_PASSWORD=verify-pw LLM_MODE=mock PORT=3216 npm start &
sleep 3
MY_SECRET_PASSWORD=verify-pw ./scripts/verify.sh http://localhost:3216
MY_SECRET_PASSWORD=verify-pw ./scripts/verify-research.sh http://localhost:3216
curl -sS -o /dev/null -w '루트 HTML: %{http_code}\n' http://localhost:3216/
kill %1
```

Expected: 375개 통과, 두 스크립트 실패 0, 루트 200.

- [ ] **Step 8: 민감정보 스캔**

```bash
git ls-files | grep -E '^\.env$' && echo "🚨 .env 추적됨" || echo "✅ .env 미추적"
git ls-files | grep -E 'client/dist|client/node_modules' && echo "🚨 빌드 산출물 추적됨" || echo "✅ 빌드 산출물 미추적"
git grep -nE 'sk-[A-Za-z0-9_-]{20,}' -- ':!*.example' ':!docs/*' || echo "✅ 키 패턴 없음"
```

- [ ] **Step 9: 커밋과 PR**

```bash
git add -A
git commit -m "feat: serve built frontend from express and document phase 3

API 라우트가 모두 등록된 뒤에 정적 서빙을 붙이고, SPA 폴백에서
/api/를 제외한다. 폴백이 API를 삼키면 클라이언트가 HTML을 JSON으로
파싱하려다 죽는다.

경로는 fileURLToPath로 만든다. URL.pathname은 Windows에서
'/C:/Users/...'를 돌려주어 existsSync가 실패한다.

빌드 산출물이 없으면 정적 서빙을 건너뛴다. 서버는 API 전용으로
계속 동작한다.

원본 요구사항 §19의 XSS·CORS 항목을 Phase 3에서 구현했으므로
보안 문서의 '범위 밖' 표에서 옮겨 검증 테스트와 함께 기록한다."

git push -u origin feature/frontend-ui
```

PR 본문에 다음을 담는다.

- 구현 내용 (4화면, 컴포넌트 11개, `marketSeries`, 정적 서빙)
- 변경 파일
- 테스트 결과 (실제 숫자)
- 보안 고려사항 (XSS 방어와 그 검증, CORS 불필요 이유, 토큰 미저장)
- 알려진 제한사항 (새로고침 시 수집 결과 소실, 진행 2단계, Markdown 무서식, 재무·논문·실험 없음)
- 후속 작업 (Phase 2b)

AI 귀속 트레일러를 넣지 않는다.

---

## Self-Review 결과

### 1. Spec 커버리지

| Spec 절 | 담당 태스크 |
|---|---|
| §1.1 컴포넌트 9종 | Task 5·6 |
| §1.2 3종 제외 | 계획 전체에서 제외 |
| §2.1 스택·배포 | Task 1·8 |
| §2.2 파일 구조 | Task 1 |
| §2.3 정적 서빙 | Task 8 |
| §3 상태 기계 | Task 6 |
| §3.1 newsList 불변 | Task 3(클라이언트)·Task 6(승인)에서 각각 테스트 |
| §4 marketSeries | Task 2 |
| §4.3 프롬프트 제외 | Task 2 테스트 |
| §5.1 로그인 | Task 6 |
| §5.2 검색 + 예산 표시 | Task 6 |
| §5.3 검토 + 제목만 경고 | Task 6 |
| §5.4 보고서 순서 | Task 6 |
| §5.5 진행 2단계 | Task 5 |
| §6 시각 디자인 | Task 7 |
| §7 오류 처리표 | Task 1 |
| §8.1 XSS | Task 5 |
| §8.2 CORS | Task 8 |
| §8.3 토큰 | Task 3 |
| §9 테스트 전략 | Task 1~8 각 테스트 단계 |
| §10 빌드·실행 | Task 1·8 |
| §11 알려진 한계 | Task 8 문서화 |
| §12 완료 기준 | Task 8 Step 5·7 |

누락 없음.

### 2. 플레이스홀더 스캔

자체 검토에서 Task 4 Step 3에 잘못된 첫 구현안이 남아 있는 것을 발견해 제거했다. 구현안은 하나만 남아 있다. 그 외 "TBD"·"적절히" 없음.

### 3. 타입 일관성

- `messageForError(error) -> { message, nextStep, requestId }` — Task 1 정의, Task 6 사용. 일치
- `createApiClient({ fetchImpl })` 반환 메서드 `login`·`logout`·`session`·`budget`·`collect`·`analyze` — Task 3 정의, Task 6 사용. 일치
- `buildChartGeometry(points, { width, height, padding })` → `{ xy, toX, toY, line, min, max, first, last }` — Task 4 정의, Task 5 `MarketChart`가 `line`·`min`·`max` 사용. 일치
- `movingAverageLine(points, window, geometry)` — Task 4 정의, Task 5 사용. 일치
- `ReportPage({ report, series, marketData, onNewSearch })` — Task 6 Step 7에서 `marketData` 추가를 명시했고 Step 8의 `App`이 넘긴다. 일치
- `collected` 객체 형태 `{ newsList, marketData, marketSeries, collected, estimate, confirmToken }` — Task 2가 서버에서 생성, Task 6이 소비. 일치
- CSS 클래스: Task 5·6이 쓰는 이름(`card`·`sticky-bar`·`chart`·`cite`·`kind-headline` 등)이 Task 7에 모두 정의됨. 일치

### 4. 테스트 수 누적

| 태스크 | 추가 | 누적 |
|---|---|---|
| (Phase 2a) | — | 289 |
| 1 (툴체인·순수함수) | 13 | 302 |
| 2 (marketSeries) | 9 | 311 |
| 3 (API 클라이언트) | 11 | 322 |
| 4 (차트 좌표) | 12 | 334 |
| 5 (컴포넌트) | 18 | 352 |
| 6 (화면·상태기계) | 19 | 371 |
| 7 (스타일) | 0 | 371 |
| 8 (정적 서빙) | 4 | 375 |

각 태스크의 회귀 확인 단계에 적힌 누적 수와 일치한다.
