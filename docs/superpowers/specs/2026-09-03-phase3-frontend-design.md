# Phase 3 — React 프론트엔드 설계

- **작성일**: 2026-09-03
- **상태**: 승인됨
- **범위**: 로그인·검색·검토·보고서 4화면, 컴포넌트 9종, `marketSeries` 백엔드 추가, XSS 방어
- **선행**: Phase 1 (PR #1), Phase 2a (PR #2, `main` 9229acf)

---

## 1. 범위 결정

### 1.1 만드는 것

원본 요구사항 §16의 12개 컴포넌트 중 **9개**를 만든다.

| 컴포넌트 | 데이터 출처 |
|---|---|
| `SearchForm` | 사용자 입력 |
| `SourceSummary` | `collected.*` |
| `NewsList` | `newsList` |
| `MarketChart` | `marketSeries` (신규) |
| `InsightReport` | `analysis.*` |
| `RiskPanel` | `analysis.risks` |
| `MonitoringIndicators` | `analysis.monitoringIndicators` |
| `SourceCitation` | `sources` |
| `Disclaimer` | `analysis.disclaimer` |

### 1.2 만들지 않는 것과 이유

`FinancialMetrics`·`ResearchList`·`ExperimentStatus`는 **채울 데이터가 없다.** Phase 2b가 미착수이므로 API가 재무지표·논문·실험을 제공하지 않는다. 지금 만들면 빈 카드만 남고 "만들었지만 동작하지 않는" 상태가 된다.

결과 화면도 원본 §16의 11개 섹션 중 해당 3개를 뺀 **8개**로 구성한다. Phase 2b에서 채운다.

---

## 2. 아키텍처

### 2.1 스택과 배포

Vite + React SPA를 빌드해 **Express가 정적 파일로 서빙**한다.

**동일 출처가 되는 것이 핵심이다.**

- CORS 미들웨어가 불필요하다 — 설정 하나가 줄고 오설정 위험이 사라진다
- HttpOnly 쿠키가 그대로 동작한다 — 토큰을 `localStorage`에 둘 이유가 없다
- 배포가 서버 하나로 끝난다

Next.js를 쓰지 않는 이유: 이 앱은 로그인 뒤에 쓰는 비공개 도구라 SEO가 필요 없고, 백엔드가 이미 Express다. SSR은 복잡도만 더한다.

### 2.2 파일 구조

```
client/
  index.html
  vite.config.js            # build.outDir = 'dist', dev 프록시 설정
  package.json              # 프론트 전용 의존성
  src/
    main.jsx
    App.jsx                 # 단계 상태 기계
    api/
      client.js             # fetch 래퍼, 세션 만료 처리
      errors.js             # 에러 코드 → 한글 메시지
    lib/
      chart.js              # 순수 함수: 좌표 계산
      format.js             # 순수 함수: 날짜·통화·비용 표기
    pages/
      LoginPage.jsx
      SearchPage.jsx
      ReviewPage.jsx
      ReportPage.jsx
    components/
      SearchForm.jsx
      SourceSummary.jsx
      NewsList.jsx
      MarketChart.jsx
      InsightReport.jsx
      RiskPanel.jsx
      MonitoringIndicators.jsx
      SourceCitation.jsx
      Disclaimer.jsx
      ProgressIndicator.jsx
      ErrorBanner.jsx
    styles/
      theme.css             # 색·간격 토큰
      app.css
tests/client/               # 프론트 테스트 (기존 tests/와 분리)
```

**순수 함수를 `lib/`로 분리하는 이유**: 좌표 계산과 포맷팅은 DOM 없이 테스트할 수 있다. 컴포넌트 렌더링 테스트보다 빠르고 정확하다.

### 2.3 Express 정적 서빙

`server.js`에 추가한다. **API 라우트보다 뒤, 404 핸들러보다 앞**에 둔다.

```js
// 빌드된 프론트엔드를 서빙한다. API 경로가 먼저 매칭되도록 뒤에 둔다.
// fileURLToPath를 써야 한다. URL.pathname은 Windows에서 '/C:/...'가 되어 fs가 읽지 못한다.
const clientDir = fileURLToPath(new URL('./client/dist/', import.meta.url));
if (existsSync(clientDir)) {
  app.use(express.static(clientDir));
  // SPA 폴백. /api/*는 위에서 이미 처리됐으므로 여기 오지 않는다.
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(join(clientDir, 'index.html')));
}
```

빌드 산출물이 없으면(개발 중) 정적 서빙을 건너뛴다. 서버는 API 전용으로 계속 동작한다.

**경로 처리 주의**: `new URL(...).pathname`은 Windows에서 `/C:/Users/...` 형태를 돌려주어 `existsSync`가 실패한다. 반드시 `fileURLToPath`를 쓴다. 실제로 확인한 동작이다.

---

## 3. 상태 기계

라우터를 쓰지 않는다. 뒤로가기가 필요 없는 선형 흐름이고, 새로고침하면 세션은 남아도 수집 결과는 사라진다.

```
                  ┌──────────────────────────────┐
                  ↓                              │
login → search → (collecting) → review → (analyzing) → report
  ↑                                                      │
  └────────────── 403 (세션 만료·로그아웃) ───────────────┘
```

App이 들고 있는 상태:

```js
{
  step: 'login' | 'search' | 'collecting' | 'review' | 'analyzing' | 'report',
  collected: null | { newsList, marketData, marketSeries, collected, estimate, confirmToken },
  report:    null | { analysis, sources, meta },
  error:     null | { code, message },
}
```

### 3.1 `newsList`를 절대 수정하지 않는다

수집 결과를 분석에 넘길 때 `newsList`·`marketData`를 **그대로** 전달한다. 한 글자라도 바꾸면 서버가 계산하는 `cacheKey`가 달라져 확인 토큰이 무효가 되고 `428`이 난다.

이는 Phase 2a가 의도적으로 만든 방어다 — 작은 자료로 견적을 받고 큰 자료로 실행하는 것을 막는다. 프론트엔드는 이 계약을 지켜야 한다. **정렬·필터는 표시 단계에서만 하고 원본 배열을 건드리지 않는다.**

---

## 4. 백엔드 변경 — `marketSeries` 하나

차트를 그리려면 가격 시계열이 필요하다. 현재 `/api/research/collect`는 `marketData` 4개 필드만 반환하고, provider가 계산한 `indicators`와 원본 OHLC는 버려진다.

### 4.1 응답에 추가

```json
"marketSeries": {
  "symbol": "NVDA",
  "currency": "USD",
  "points": [
    { "t": "2026-08-04T00:00:00.000Z", "c": 206.64, "v": 12345600 }
  ],
  "indicators": {
    "ma5": 218.68, "ma20": 219.03,
    "high": 227.98, "low": 206.64,
    "changePct": 5.23, "volatilityPct": 2.80,
    "points": 22
  }
}
```

`marketSeries`는 시장 데이터를 못 가져왔으면 `undefined`다. `marketData`와 동일한 조건이다.

### 4.2 provider 변경

`fetchStock`·`fetchCrypto`가 `series`를 함께 반환한다. 이미 파싱한 배열을 버리지 않고 담는 것이라 계산이 늘지 않는다.

```js
return {
  indicators,
  marketData: { ... },
  series: { symbol, currency, points },   // 신규
};
```

Yahoo는 `result.timestamp`(초 단위 epoch)와 `quote.close`·`quote.volume`을 인덱스로 맞춘다. `close`가 `null`인 지점은 버린다. CoinGecko는 `prices`·`total_volumes`가 `[ms, value]` 쌍이다.

### 4.3 프롬프트에는 넣지 않는다

`marketSeries`는 **분석 프롬프트에 포함하지 않는다.** 숫자 22쌍을 넣으면 토큰만 늘고, `chartTrend` 문장이 이미 그 내용을 요약하고 있다. LLM은 문장을 읽고 사용자는 그림을 본다.

즉 `cacheKey` 계산에도 영향이 없다 — 확인 토큰 흐름이 그대로 유지된다.

---

## 5. 화면 설계

### 5.1 로그인

비밀번호 입력 하나. 실패 시 `403 INVALID_CREDENTIALS` → "비밀번호가 올바르지 않습니다", `429` → "잠시 후 다시 시도해 주세요".

성공하면 쿠키가 설정되므로 이후 요청에 `credentials: 'same-origin'`만 붙이면 된다. **토큰을 JS에 저장하지 않는다.**

### 5.2 ① 검색

입력 항목은 `/api/research/collect` 스키마 그대로다.

| 필드 | UI |
|---|---|
| `query` | 텍스트 입력 (필수) |
| `symbol` | 텍스트 입력 (선택). 비우면 자동 해석 |
| `assetType` | `주식` / `코인` 토글 |
| `lang` | `한국어` / `English` 토글 |
| `range` | `5일`·`1개월`·`3개월`·`6개월`·`1년` 선택 |
| `maxNews` | 슬라이더 1~20, 기본 10 |

**남은 예산을 이 화면에 표시한다.** `GET /api/budget`으로 조회해 "오늘 47/50회 · 이번 달 $4.69 남음"을 보여준다. 예산이 없으면 검색 버튼을 비활성화하고 이유를 적는다 — 수집까지 한 뒤 막히는 것보다 낫다.

### 5.3 ② 검토 — 승인 지점

자료 카드 목록 + **하단 고정 승인 바**.

각 카드에 제목·출처·작성일·`contentKind` 태그(`요약` / `제목만` / `전문`)를 표시한다. 원본 §16이 요구하는 "제목, 출처, URL, 작성일, 수집일, 자료 유형"이 여기 들어간다.

상단에 수집 요약을 한 줄로 둔다: 자료 수, 중복 제거 수, 해석된 심볼과 그 근거(`symbolSource`), 사용된 피드.

`degraded`가 비어 있지 않으면 무엇이 빠졌는지 표시한다 — "시장 데이터를 가져오지 못했습니다" 같은 사유를 그대로 보여준다.

**하단 고정 바에 반드시 들어가는 것**:

```
예상 비용 $0.023 · 오늘 3/50회 사용            [ 분석 시작 ]
8건 중 5건은 제목만 확보 — 본문 없이 분석합니다
```

두 번째 줄이 중요하다. 제목만으로 만든 분석을 전문 분석으로 오해하면 결론을 과신하게 된다. **승인 전에 보여야 의미가 있다.**

### 5.4 ③ 보고서

위에서 아래로:

1. **차트** (`MarketChart`) — 종가 선 + 5일·20일 이동평균, 현재가·등락률
2. `degraded` 배너 (해당 시) — "구조화 출력이 실패해 서식이 단순합니다"
3. **핵심 요약** (`analysis.summary`)
4. **뉴스 브리핑** (`analysis.newsBriefing`) — 각 항목에 `sourceId` 배지
5. **동향 비교 분석** (`analysis.trendAnalysis`)
6. **시나리오** (`analysis.scenarios`) — 기본/긍정/부정 카드
7. **리스크** (`RiskPanel`) + **모니터링 지표** (`MonitoringIndicators`)
8. **출처 목록** (`SourceCitation`) — `sources` 배열, 기준 시각 포함
9. **면책 문구** (`Disclaimer`)

`meta.fabricatedUrlsRemoved`가 0보다 크면 "출처에 없는 링크 N개를 제거했습니다"를 출처 섹션에 표시한다. 서버가 한 일을 사용자가 알아야 한다.

### 5.5 진행 표시

원본 §16은 7단계를 요구하지만 실제 호출은 `collect` 1회, `analyze` 1회다. **실제와 다른 단계를 흉내 내지 않는다.**

- `collecting`: "자료를 수집하고 있습니다" (불확정 진행 표시)
- `analyzing`: "분석 보고서를 작성하고 있습니다"

수집이 끝나면 **사후에 사실을 표시한다**: 어떤 피드가 응답했는지(`feedsUsed`), 무엇이 실패했는지(`degraded`). 이것이 7단계 가짜 애니메이션보다 정보량이 많다.

---

## 6. 시각 디자인

원본 §16의 방향을 따른다.

| 토큰 | 값 | 용도 |
|---|---|---|
| `--bg` | `#faf9f7` | 따뜻한 오프화이트 배경 |
| `--surface` | `#fdfcfa` | 카드 |
| `--text` | `#2b2724` | 짙은 차콜 본문 |
| `--muted` | `#6b6560` | 보조 텍스트 |
| `--border` | `#d4d0c8` | 테두리 |
| `--accent` | `#d97706` | 절제된 앰버. 승인 버튼·강조에만 |
| `--accent-soft` | `#fef3e2` | 비용·경고 배경 |

- 그라디언트를 쓰지 않는다
- 본문 폭 최대 `72ch`
- 카드와 패널로 정보 계층을 만든다
- 모바일 반응형 — 단일 열로 무너진다
- 다크모드는 `prefers-color-scheme`으로 토큰만 교체한다
- 모든 대화형 요소에 키보드 포커스 표시. 승인 버튼은 `Enter`로 동작

---

## 7. 오류 처리

`api/errors.js`가 백엔드 에러 코드를 한글 메시지로 매핑한다.

| 코드 | 사용자에게 보이는 것 | 화면 동작 |
|---|---|---|
| `FORBIDDEN` | 세션이 만료되었습니다. 다시 로그인해 주세요. | 로그인 화면으로 |
| `INVALID_CREDENTIALS` | 비밀번호가 올바르지 않습니다. | 입력 유지 |
| `RATE_LIMITED` | 요청이 많습니다. 잠시 후 다시 시도해 주세요. | 현재 화면 유지 |
| `BUDGET_EXCEEDED` | (서버 메시지 그대로) | 검색 버튼 비활성화 |
| `CONFIRMATION_REQUIRED` | 수집 결과가 변경되었습니다. 다시 수집해 주세요. | 검색 화면으로 |
| `COLLECTION_FAILED` | 분석할 뉴스를 수집하지 못했습니다. 검색어를 바꿔 보세요. | 검색 화면 유지 |
| `INPUT_TOO_LARGE` | 요청이 너무 큽니다. 기사 수를 줄여 주세요. | 검색 화면 유지 |
| `UPSTREAM_TIMEOUT` / `UPSTREAM_ERROR` / `CIRCUIT_OPEN` | 분석 서버가 응답하지 않습니다. 잠시 후 다시 시도해 주세요. | 검토 화면 유지 (재시도 가능) |
| `PARSE_FAILED` | 분석 결과를 처리하지 못했습니다. 다시 시도해 주세요. | 검토 화면 유지 |
| 그 외 | 오류가 발생했습니다. (requestId 표시) | 현재 화면 유지 |

**`requestId`를 항상 함께 보여준다.** 서버 로그와 대조할 수 있는 유일한 단서다.

**상류 실패 시 검토 화면을 유지하는 이유**: 수집 결과와 확인 토큰이 아직 유효하므로 재시도하면 추가 수집 없이 분석만 다시 할 수 있다. 검색 화면으로 되돌리면 무료인 수집을 다시 하게 된다.

---

## 8. 보안 — Phase 1·2a에서 미룬 것

### 8.1 XSS

**LLM 응답은 신뢰할 수 없는 입력이다.** 외부 RSS가 프롬프트에 들어가므로 응답에 스크립트가 섞일 수 있다.

- `dangerouslySetInnerHTML`을 **쓰지 않는다.** React가 기본으로 이스케이프한다
- Markdown 폴백(`meta.degraded === true`, `analysis.report`)은 `<pre>`로 표시한다. Markdown 렌더러를 붙이지 않는다 — 렌더러는 HTML을 생성하고 그 순간 XSS 표면이 생긴다
- 링크는 `sources` 배열의 URL만 `<a>`로 만든다. 보고서 본문의 URL은 텍스트로 둔다. 서버가 이미 화이트리스트 밖 URL을 제거했지만, 렌더링 단계에서도 링크화하지 않는 것이 두 번째 방어선이다
- 모든 외부 링크에 `rel="noopener noreferrer"` · `target="_blank"`

### 8.2 CORS

동일 출처이므로 CORS 미들웨어를 **붙이지 않는다.** `CORS_ORIGIN` 설정값은 남겨두되 미사용임을 문서에 명시한다. 프론트를 별도 도메인에 배포하게 되면 그때 붙인다.

### 8.3 토큰

HttpOnly 쿠키만 쓴다. JS가 토큰을 읽지 않으므로 XSS가 나더라도 토큰이 탈취되지 않는다. `fetch`에 `credentials: 'same-origin'`을 붙인다.

### 8.4 API 키

프론트 번들에 들어갈 경로가 없다. 모든 외부 호출은 서버가 한다. `client/`에 `.env`를 두지 않는다.

---

## 9. 테스트 전략

`node:test` + `@testing-library/react` + `jsdom`. 프론트 테스트는 `tests/client/`에 둔다.

**실행 방식**: 현재 `npm test`는 `node --test "tests/**/*.test.js"` 글롭이라 `tests/client/`도 자동으로 포함된다. 다만 컴포넌트 테스트는 DOM이 필요하므로 각 파일 상단에서 `global-jsdom/register`를 import한다. 순수 함수 테스트(`chart.js`·`format.js`)는 DOM 없이 돌아가므로 import하지 않는다.

```js
// tests/client/market-chart.test.js
import 'global-jsdom/register';   // DOM이 필요한 파일에만
import { test } from 'node:test';
```

이렇게 하면 백엔드 테스트가 불필요한 jsdom 초기화 비용을 치르지 않는다.

### 순수 함수 (DOM 불필요)

- `chart.js` — 알려진 입력에 대한 좌표 계산. 값이 하나뿐일 때, 전부 같을 때(0으로 나누기), 빈 배열
- `format.js` — 통화·날짜·비용 표기, `null` 입력

### 컴포넌트

- `MarketChart` — `points`가 없으면 "자료 부족" 표시, 있으면 `<polyline>` 생성. 이동평균이 `null`이면 해당 선을 그리지 않음
- `NewsList` — `contentKind` 태그 표시, 외부 링크에 `rel="noopener noreferrer"`
- `InsightReport` — **`<script>alert(1)</script>`가 든 응답을 렌더링해도 스크립트 태그가 DOM에 생기지 않음**
- `InsightReport` — `degraded: true`면 `analysis.report`를 `<pre>`로 표시
- `SourceCitation` — `fabricatedUrlsRemoved > 0`이면 제거 사실 표시
- `ReviewPage` — 자료 수·예상 비용·`제목만` 개수가 모두 보임
- `ProgressIndicator` — 2단계만 표시

### 흐름

- 로그인 실패 → 에러, 성공 → 검색 화면
- 수집 성공 → 검토 화면, `collected` 상태 보존
- 승인 → `X-Confirm-Token` 헤더가 실림, `newsList`가 수정되지 않고 전달됨
- `403` 응답 → 로그인 화면 복귀
- 상류 오류 → 검토 화면 유지 (재시도 가능)

`api/client.js`는 `fetch`를 주입받게 만들어 네트워크 없이 테스트한다. Phase 1의 `clock`·`llm`, Phase 2a의 `http` 주입과 같은 방식이다.

### 백엔드

- `marketSeries`가 응답에 포함됨 (주식·코인 각각)
- 시장 데이터 실패 시 `marketSeries`도 `undefined`
- **`marketSeries`가 프롬프트에 들어가지 않음** — LLM 호출 인자를 검사
- `marketSeries` 추가가 `cacheKey`를 바꾸지 않음 — 확인 토큰이 여전히 통함

---

## 10. 빌드와 실행

```json
// 루트 package.json
"scripts": {
  "build:client": "npm --prefix client run build",
  "dev:client": "npm --prefix client run dev",
  "start": "node server.js"
}
```

개발 시 Vite dev 서버(5173)가 `/api`를 3000으로 프록시한다. 쿠키는 프록시를 통과하므로 동일 출처처럼 동작한다.

배포 시 `npm run build:client`로 `client/dist`를 만들고 `npm start`만 하면 된다.

---

## 11. 알려진 한계

1. **새로고침하면 수집 결과가 사라진다** — App 상태가 메모리에만 있다. 세션은 쿠키로 남아 로그인은 유지되지만 처음부터 다시 검색해야 한다. 수집은 무료이므로 비용 손실은 없다
2. **진행 표시가 2단계뿐** — 원본 §16의 7단계와 다르다. 실제 호출이 2번이므로 그 이상은 거짓이 된다
3. **Markdown 폴백이 서식 없이 표시된다** — `<pre>`로 둔다. 렌더러를 붙이면 XSS 표면이 생긴다
4. **재무·논문·실험 섹션 없음** — Phase 2b 대상
5. **다크모드가 `prefers-color-scheme`만 따른다** — 수동 토글이 없다. 필요하면 나중에 추가한다

---

## 12. 완료 기준

- 기존 289개 테스트 + Phase 3 신규 테스트 전부 통과
- `npm run build:client && npm start`로 브라우저에서 전 과정 동작
- 실제 검색어로 로그인 → 검색 → 수집 → 승인 → 보고서까지 확인
- LLM 응답에 스크립트가 섞여도 실행되지 않음을 테스트로 확인
- `docs/api.md`에 `marketSeries` 반영, `docs/security.md`의 XSS·CORS 항목 갱신
- PR 생성
