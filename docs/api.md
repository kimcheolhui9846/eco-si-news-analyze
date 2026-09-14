# API 명세

Phase 1 기준. 모든 응답은 `application/json`이며, 모든 응답에 `X-Request-Id` 헤더가 붙는다.

베이스 URL은 기본적으로 `http://localhost:3000`이다.

---

## 공통 에러 형식

모든 오류는 동일한 형태로 반환된다.

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "요청 데이터가 올바르지 않습니다.",
    "requestId": "0f8b2c1a-..."
  }
}
```

`requestId`는 서버가 발급하며 응답 헤더 `X-Request-Id`와 같은 값이다. 문의 시 이 값을 전달하면 서버 로그에서 해당 요청을 찾을 수 있다. 클라이언트가 보낸 `X-Request-Id` 헤더는 무시된다.

### 에러 코드표

| 코드 | HTTP | 상황 |
|---|---|---|
| `INVALID_REQUEST` | 400 | 검증 실패, 형식 오류, 허용되지 않은 필드 |
| `INVALID_CREDENTIALS` | 403 | 로그인 비밀번호 불일치 |
| `FORBIDDEN` | 403 | 토큰 없음·무효·만료·로그아웃됨 |
| `NOT_FOUND` | 404 | 존재하지 않는 경로 |
| `PAYLOAD_TOO_LARGE` | 413 | 요청 본문이 `MAX_REQUEST_BODY_BYTES` 초과 |
| `INPUT_TOO_LARGE` | 413 | 조립된 프롬프트 길이 또는 토큰 예산 초과 |
| `RATE_LIMITED` | 429 | rate limit 초과 (시간 창 기준) |
| `BUDGET_EXCEEDED` | 429 | 일일 호출 수 또는 월 비용 한도 소진 |
| `CONFIRMATION_REQUIRED` | 428 | 확인 토큰 없이 비용이 드는 분석을 요청함 |
| `COLLECTION_FAILED` | 502 | 모든 뉴스 피드에서 자료를 수집하지 못함 |
| `TOO_MANY_CONCURRENT` | 429 | 동시 분석 한도 초과 |
| `INSUFFICIENT_DATA` | 422 | 중복 제거 후 유효 자료 0건 |
| `UPSTREAM_TIMEOUT` | 504 | LLM 응답 지연 |
| `UPSTREAM_ERROR` | 502 | LLM 호출 실패 |
| `CIRCUIT_OPEN` | 503 | 연속 실패로 회로 차단기가 열림 |
| `PARSE_FAILED` | 502 | 구조화 출력과 Markdown 폴백이 모두 실패 |
| `INTERNAL` | 500 | 그 외 |

에러 응답에는 스택 트레이스, 상류 API의 원본 메시지, 프롬프트 전문, 세션 토큰, API 키가 포함되지 않는다.

---

## `GET /api/health`

인증이 필요 없다. 서버 기동 확인용이다.

```bash
curl http://localhost:3000/api/health
```

```json
{ "status": "ok", "llmMode": "mock", "time": "2026-09-02T07:52:07.748Z" }
```

---

## `POST /api/auth/login`

### 요청

```json
{ "password": "설정한 비밀번호" }
```

`password` 외의 필드를 보내면 `400 INVALID_REQUEST`로 거부된다.

### 응답 `200`

```json
{
  "token": "kX3f...43자 이상의 base64url",
  "expiresAt": "2026-09-02T08:07:07.748Z"
}
```

토큰은 응답 본문과 `session` 쿠키로 **동시에** 제공된다. 쿠키 속성은 `HttpOnly; SameSite=Strict; Path=/`이며, `Secure`는 `NODE_ENV=production`일 때만 붙는다.

### 오류

| 상황 | 응답 |
|---|---|
| 비밀번호 불일치 | `403 INVALID_CREDENTIALS` |
| `password` 누락 또는 미허용 필드 | `400 INVALID_REQUEST` |
| 로그인 시도 과다 | `429 RATE_LIMITED` |

rate limit은 검증보다 먼저 적용된다.

### 예시

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"your-password"}'
```

---

## `POST /api/auth/logout`

인증 토큰을 `Authorization: Bearer` 헤더나 `session` 쿠키로 보낸다.

**멱등적이다.** 세션이 없거나 토큰을 보내지 않아도 항상 `200`을 반환한다.

```json
{ "success": true, "message": "로그아웃되었습니다." }
```

로그아웃 후 같은 토큰으로 보호된 엔드포인트를 호출하면 반드시 `403 FORBIDDEN`이 반환된다.

```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Authorization: Bearer $TOKEN"
```

---

## `GET /api/auth/session`

현재 세션 상태를 조회한다. **이 호출은 세션을 연장하지 않는다.** 읽기 전용이다.

### 응답 `200`

```json
{
  "authenticated": true,
  "expiresAt": "2026-09-02T08:07:07.748Z",
  "lastActivityAt": "2026-09-02T07:52:07.748Z"
}
```

인증 실패 시 `403 FORBIDDEN`.

---

## `POST /api/research/collect`

인증이 필요하다. 검색어로 뉴스와 시장 데이터를 수집해 **분석 엔진이 그대로 받을 수 있는 형태**로 반환한다.

**이 엔드포인트는 LLM을 호출하지 않는다.** 비용이 들지 않고 예산을 차감하지 않는다.

### 요청

```json
{
  "query": "엔비디아 AI 반도체",
  "symbol": "NVDA",
  "assetType": "stock",
  "lang": "ko",
  "range": "1mo",
  "maxNews": 8,
  "include": ["news", "market", "financial", "research", "experiments"]
}
```

| 필드 | 필수 | 제약 |
|---|---|---|
| `query` | ✅ | 1~200자. 뉴스 검색어이자 심볼 해석의 근거 |
| `symbol` | ❌ | 1~32자. 없으면 자동 해석을 시도한다 |
| `assetType` | ❌ | `stock` \| `crypto`. 기본 `stock` |
| `lang` | ❌ | `ko` \| `en`. 기본 `ko`. 어느 피드를 쓸지 결정한다 |
| `range` | ❌ | `5d` \| `1mo` \| `3mo` \| `6mo` \| `1y`. 기본 `1mo` |
| `maxNews` | ❌ | 1~`MAX_NEWS_ITEMS`(20). 기본 10 |
| `include` | ❌ | 수집 범위. `news` `market` `financial` `research` `experiments` 중 부분집합 |

**`include`를 생략하면 `["news", "market"]`이고 Phase 2a와 완전히 같이 동작한다.** 비용도 그대로다.
`news`는 빼도 강제로 포함된다 — 뉴스가 없으면 분석이 성립하지 않는다.
알려지지 않은 값이 하나라도 들어 있으면 `400 INVALID_REQUEST`다.

| 값 | 소스 |
|---|---|
| `news` | Google 뉴스·연합뉴스·전자신문·Yahoo Finance |
| `market` | Naver 주식 일봉 / Coinbase Exchange BTC·ETH·SOL·XRP 일봉. 미매핑 심볼은 기존 Yahoo Finance / CoinGecko 경로 |
| `financial` | SEC EDGAR XBRL companyconcept. **미국 상장사만** |
| `research` | Europe PMC + arXiv (영문 질의) / KCI (한국어 질의) |
| `experiments` | ClinicalTrials.gov v2. **영문 질의에서만** |

목록에 없는 필드는 `400 INVALID_REQUEST`로 거부된다.

### 심볼 해석 4단계

1. `symbol`이 있으면 그대로 쓴다 (`symbolSource: "explicit"`)
2. 없으면 내장 별칭 사전을 본다 (`"alias"`) — **한글 회사명은 이 경로로만 해석된다**
3. 별칭에 없고 질의가 ASCII면 Yahoo 검색을 시도한다 (`"search"`)
4. 모두 실패하면 뉴스만 수집한다 (`"unresolved"`) — 오류가 아니다

### 응답 `200`

```json
{
  "requestId": "...",
  "newsList": [
    {
      "title": "엔비디아, 미디어텍에 35억달러 투자",
      "content": "...",
      "source": "IT조선",
      "url": "https://news.google.com/rss/articles/...",
      "publishedAt": "2026-09-03T01:02:03.000Z",
      "contentKind": "headline"
    }
  ],
  "marketData": {
    "assetName": "NVDA",
    "currentPrice": "224.41 USD",
    "priceChange": "5.23%",
    "chartTrend": "해당 기간(22개 거래일) 종가는 5.23% 상승했습니다. ..."
  },
  "marketSeries": {
    "symbol": "NVDA",
    "currency": "USD",
    "points": [
      { "t": "2026-08-04T13:30:00.000Z", "c": 206.64, "v": 12345600 }
    ],
    "indicators": {
      "ma5": 218.68, "ma20": 219.03, "high": 227.98, "low": 206.64,
      "changePct": 5.23, "volatilityPct": 2.80, "points": 22
    }
  },
  "collected": {
    "collectedAt": "2026-09-03T01:20:00.000Z",
    "resolvedSymbol": "NVDA",
    "symbolSource": "explicit",
    "feedsUsed": ["google-news-ko", "yonhap-economy", "etnews", "yahoo-headline-NVDA"],
    "newsCount": 8,
    "duplicatesRemoved": 0,
    "headlineOnlyCount": 1,
    "degraded": []
  },
  "estimate": {
    "estimatedInputTokens": 1292,
    "assumedOutputTokens": 2000,
    "estimatedCostUsd": 0.02323,
    "budget": { "calls": {}, "cost": {} }
  },
  "confirmToken": "ct_...",
  "confirmTokenExpiresAt": "..."
}
```

### `collected` 필드의 의미

| 필드 | 의미 |
|---|---|
| `resolvedSymbol` | 실제로 쓰인 티커. 해석 실패 시 `null` |
| `symbolSource` | `explicit` \| `alias` \| `search` \| `unresolved` |
| `feedsUsed` | 자료를 **하나 이상 준** 피드의 id |
| `newsCount` | 중복 제거 후 실제 자료 수 |
| `headlineOnlyCount` | **제목만 확보된 자료 수.** 분석 깊이의 한계를 나타낸다 |
| `included` | 실제로 수집한 범위. 요청의 `include`를 정규화한 값 |
| `languageRoute` | 어떤 소스를 왜 불렀는지. `{ route, useEnglishPapers, useKci, useTrials, reason }` |
| `researchCount` | 논문 수 |
| `experimentCount` | 임상시험 수 |
| `financialMetricCount` | 확보한 재무지표 개수 |
| `degraded` | 실패했거나 빠진 provider와 사유 |

### `financial` · `research` · `experiments`

요청하지 않았거나 자료가 없으면 **필드 자체가 없다**(`null`이 아니다).
이 규칙은 협상 대상이 아니다 — `cacheKey`가 `JSON.stringify`로 계산되는데
`undefined` 키는 버려지고 `[]`는 남으므로, 규칙이 갈라지면 확인 토큰이 `428`로 거부된다.

```json
{
  "financial": {
    "symbol": "NVDA", "cik": "0001045810", "entityName": "NVIDIA CORP",
    "filingUrl": "https://www.sec.gov/Archives/edgar/data/1045810/.../...-index.htm",
    "metrics": [{ "concept": "Revenues", "label": "매출", "value": 96221000000,
      "unit": "USD", "fiscalYear": 2027, "fiscalPeriod": "Q2",
      "form": "10-Q", "filed": "2026-08-26" }],
    "derived": [{ "label": "부채비율", "value": 41.2, "unit": "%",
      "basis": "2026-07-26 기준", "formula": "부채 / 자산" }],
    "degraded": [{ "concept": "NetIncomeLoss", "reason": "..." }]
  },
  "research": [{ "title": "...", "abstract": "...", "authors": ["..."],
    "venue": "Nature Energy", "doi": "10.1/abc", "url": "https://doi.org/10.1/abc",
    "publishedAt": "2026-01-01T00:00:00.000Z", "datePrecision": "year",
    "peerReviewed": "peer-reviewed", "sourceName": "Europe PMC", "language": "en" }],
  "experiments": [{ "nctId": "NCT00644098", "title": "...",
    "organization": "...", "phase": "PHASE2", "status": "COMPLETED",
    "enrollmentCount": 138, "enrollmentType": "ACTUAL",
    "conditions": ["..."], "startDate": "2008-09", "hasResults": false }]
}
```

**`datePrecision`이 `year`이면 발표 월·일은 확인되지 않은 것이다.** `publishedAt`의 `01-01`은
저장 형식일 뿐 사실이 아니다.

**`enrollmentType`이 `ESTIMATED`이면 모집 목표치다.** 이미 그만큼 등록됐다는 뜻이 아니다.

### 언어에 따라 부르는 소스가 달라진다

검색어에 한글이 하나라도 있으면 Europe PMC·arXiv·ClinicalTrials.gov로 **요청을 보내지 않는다.**
걸러내는 것이 아니라 호출하지 않는다. 한국어 질의에 이 소스들이 0건이 아니라
**무관한 실존 논문**을 돌려주기 때문이다(설계 문서 §1.5).

| 검색어 | 논문 | 임상시험 |
|---|---|---|
| 한글 포함 | KCI만 (`KCI_API_KEY` 필요) | 호출하지 않음 |
| 영문만 | Europe PMC + arXiv | ClinicalTrials.gov |

사유는 `collected.languageRoute.reason`과 `collected.degraded`에 실려 나간다.

### `marketSeries` — 차트용 시계열

Task 6의 Naver/Coinbase 경로는 완료된 일봉을 반환한다. `marketData.currentPrice`는
마지막 완료 봉의 종가이며 `chartTrend`에 출처와 일봉 기준을 표시한다.
Naver `5d`는 최근 완료 거래일 최대 5개, 나머지 범위는 거래소 현지 날짜에서
1·3·6·12개월을 뺀 날부터다(월말 보정). Coinbase 범위는 완료된 UTC 일봉
5·30·90·180·365일이며 현재 진행 중인 UTC 날짜는 제외한다.
미매핑 심볼의 기존 경로는 기존 제공자의 시간·가격 기준을 유지한다.

Naver의 `points[].t`는 현지 거래일을 UTC 자정으로 표현한 날짜 라벨이다.
실제 거래 체결 시각이 아니다. Coinbase의 값은 UTC 일봉 시작 시각이다.

프론트엔드가 차트를 그리는 데 쓴다. 시장 데이터를 못 가져왔으면 `marketData`와 함께 `undefined`다.

| 필드 | 의미 |
|---|---|
| `points[].t` | ISO 8601 시각 |
| `points[].c` | 종가. 값이 없는 거래일은 배열에서 빠진다 |
| `points[].v` | 거래량. 없으면 `null` |
| `indicators` | 이동평균·최고·최저·등락률·변동성. 계산 불가한 값은 `null` |

`points.length`는 `indicators.points`와 항상 같다 — 차트와 이동평균이 어긋나지 않게 하기 위함이다.

**`marketSeries`는 분석 프롬프트에 포함되지 않는다.** 숫자 수십 쌍은 토큰만 늘리고 `chartTrend` 문장이 이미 그 내용을 요약한다. `cacheKey`에도 영향을 주지 않으므로 확인 토큰 흐름이 그대로 유지된다.

### 부분 실패

| 상황 | 처리 |
|---|---|
| 일부 피드 실패 | 나머지로 진행. `degraded`에 기록 |
| **모든 뉴스 피드 실패** | `502 COLLECTION_FAILED` — 뉴스가 없으면 분석이 성립하지 않는다 |
| 시장 데이터 실패 | `marketData` 없이 `200`. `degraded`에 기록 |
| 심볼 해석 실패 | 위와 같음 |
| 재무: CIK 없음 | `financial` 없이 `200`. 미국 상장사가 아니거나 사전에 없는 종목 |
| 재무: 일부 개념 없음 | 있는 지표만. 없는 것은 `financial.degraded`에 개념명 |
| 논문: 한 소스 실패 | 나머지 소스로 진행 |
| 논문·실험 전부 실패 | 해당 필드 없이 `200`. 뉴스가 있으면 분석은 계속된다 |

**뉴스를 제외한 모든 provider의 실패는 치명적이지 않다.** 자료가 줄 뿐 분석은 성립한다.

### 수집한 자료로 분석하기

`confirmToken`을 `X-Confirm-Token` 헤더에 담아 `/api/analyze/news`를 호출한다. 별도의 `estimate` 호출이 필요 없다.

```bash
curl -X POST http://localhost:3000/api/analyze/news   -H 'Content-Type: application/json'   -H "Authorization: Bearer $TOKEN"   -H "X-Confirm-Token: $CONFIRM"   -d '{"newsList": [...], "marketData": {...}}'
```

**수집 응답의 자료를 하나라도 고치면 확인 토큰이 통하지 않는다** (`428`).
`newsList`·`marketData`뿐 아니라 `financial`·`research`·`experiments`도 `cacheKey`에 들어간다.
작은 자료로 견적을 받고 큰 자료로 실행하는 것을 막기 위한 의도된 동작이다.

특히 **빈 배열을 넣지 말 것.** 수집 응답에 `research`가 없었다면 분석 요청에도 넣지 않아야 한다.
`{"research": []}`를 보내면 해시가 달라져 `428`이 난다.

전체 시나리오는 `scripts/verify-research.sh`가 자동 검증한다.

---

## 비용이 드는 호출은 2단계다

`/api/analyze/news`는 실제 LLM을 호출하므로 돈이 든다. 그래서 **견적 → 승인 → 실행** 순서를 강제한다.

```
경로 A — 검색으로 시작할 때
1) POST /api/research/collect   ← 외부 수집만. LLM 미호출. 견적·확인 토큰 포함
2) POST /api/analyze/news       ← X-Confirm-Token 헤더 필수

경로 B — 자료를 직접 넣을 때
1) POST /api/analyze/estimate   ← LLM 미호출. 예상 비용·남은 예산·확인 토큰 반환
2) POST /api/analyze/news       ← X-Confirm-Token 헤더 필수. 실제 호출 + 예산 차감
```

확인 토큰 없이 2번을 호출하면 `428 CONFIRMATION_REQUIRED`가 반환되고 LLM은 호출되지 않는다.

**예외**: 캐시된 결과가 있으면 LLM을 부르지 않으므로 확인 토큰 없이 통과하고 예산도 차감하지 않는다.

---

## `POST /api/analyze/estimate`

인증이 필요하다. 요청 본문은 `/api/analyze/news`와 **완전히 동일**하다. 두 엔드포인트가 같은 검증·정규화·프롬프트 조립 코드를 공유하므로 견적과 실제 요청이 어긋날 수 없다.

**이 엔드포인트는 LLM을 호출하지 않는다.** 비용이 들지 않는다.

### 응답 `200`

```json
{
  "estimatedInputTokens": 492,
  "assumedOutputTokens": 2000,
  "estimatedCostUsd": 0.02127,
  "sourceCount": 1,
  "duplicatesRemoved": 0,
  "cached": false,
  "budget": {
    "calls": { "used": 0, "limit": 50, "remaining": 50, "resetsAt": "2026-09-03T00:00:00.000Z" },
    "cost":  { "usedUsd": 0, "limitUsd": 5, "remainingUsd": 5, "resetsAt": "2026-10-01T00:00:00.000Z" }
  },
  "confirmToken": "ct_...",
  "confirmTokenExpiresAt": "2026-09-02T08:02:07.748Z",
  "model": "gpt-4o",
  "note": "실제 비용은 응답 길이에 따라 추정치와 달라질 수 있습니다."
}
```

`estimatedCostUsd`는 **추정치**다. 출력 토큰 수는 호출 전에 알 수 없어 `ASSUMED_OUTPUT_TOKENS`로 가정한다. 실제 비용은 응답 후 다시 계산되어 `meta.actualCostUsd`로 반환되며, 예산에는 실제 비용이 기록된다.

### 확인 토큰의 성질

| 성질 | 이유 |
|---|---|
| **일회용** | 한 번 승인은 한 번 호출이다. 소비 후 즉시 폐기된다 |
| **세션에 묶임** | 다른 사용자가 남의 승인을 쓸 수 없다 |
| **요청 내용에 묶임** | 기사 1개로 견적을 받고 20개로 실행하는 것을 막는다 |
| **TTL 있음** | `CONFIRM_TOKEN_TTL_MS`(기본 5분) 후 만료된다 |

셋 중 하나라도 어긋나면 `428 CONFIRMATION_REQUIRED`다.

### 오류

| 상황 | 응답 |
|---|---|
| 예산 소진 | `429 BUDGET_EXCEEDED` |
| 검증 실패 | `400 INVALID_REQUEST` |
| 인증 실패 | `403 FORBIDDEN` |

예산이 소진되면 견적 단계에서 막히므로 확인 토큰 자체가 발급되지 않는다.

---

## `GET /api/budget`

인증이 필요하다. 현재 예산 사용량을 조회한다.

```json
{
  "calls": { "used": 3, "limit": 50, "remaining": 47, "resetsAt": "2026-09-03T00:00:00.000Z" },
  "cost":  { "usedUsd": 0.0104, "limitUsd": 5, "remainingUsd": 4.9896, "resetsAt": "2026-10-01T00:00:00.000Z" }
}
```

호출 수는 UTC 자정에, 비용은 UTC 기준 매월 1일에 초기화된다. **사용량은 파일에 기록되므로 서버를 재시작해도 유지된다.**

---

## `POST /api/analyze/news`

인증과 **확인 토큰**이 필요하다. Phase 1에서 이 엔드포인트는 **클라이언트가 제공한 자료를 분석하는 순수 엔진**이다. 서버가 외부에서 뉴스를 수집하지 않는다. 수집은 Phase 2에서 추가된다.

### 요청

```json
{
  "newsList": [
    {
      "title": "엔비디아 3분기 실적 발표",
      "content": "데이터센터 부문 매출이 전년 대비 증가했다고 발표했다.",
      "source": "연합뉴스",
      "url": "https://example.com/article/1",
      "publishedAt": "2026-08-30T09:00:00Z"
    }
  ],
  "marketData": {
    "assetName": "엔비디아",
    "currentPrice": "182.50",
    "priceChange": "+2.3%",
    "chartTrend": "20일 이동평균 상회"
  },
  "analysisPeriod": "최근 3개월"
}
```

### 필드별 제약

| 필드 | 필수 | 타입 | 제약 (기본값) |
|---|---|---|---|
| `newsList` | ✅ | 배열 | 1개 이상 `MAX_NEWS_ITEMS`(20) 이하 |
| `newsList[].title` | ✅ | 문자열 | 1~`MAX_TITLE_CHARS`(300)자, 공백만은 불가 |
| `newsList[].content` | ✅ | 문자열 | 1~`MAX_CONTENT_CHARS`(8000)자 |
| `newsList[].source` | ✅ | 문자열 | 1~200자 |
| `newsList[].url` | ✅ | 문자열 | **`http`/`https`만 허용**, 2048자 이하 |
| `newsList[].publishedAt` | ✅ | 문자열 | `Date.parse` 가능한 날짜 |
| `marketData` | ❌ | 객체 | 있으면 아래 4개 필드 모두 필요 |
| `marketData.assetName` | 조건부 | 문자열 | 1~200자 |
| `marketData.currentPrice` | 조건부 | 문자열 \| 숫자 | 문자열이면 64자 이하 |
| `marketData.priceChange` | 조건부 | 문자열 \| 숫자 | 문자열이면 64자 이하 |
| `marketData.chartTrend` | 조건부 | 문자열 | 1~`MAX_TREND_CHARS`(1000)자 |
| `newsList[].contentKind` | ❌ | 문자열 | `headline` \| `summary` \| `full`. 없으면 `full`로 간주 |
| `analysisPeriod` | ❌ | 문자열 | 200자 이하 |
| `financial` | ❌ | 객체 | `/api/research/collect`가 준 값 **그대로** |
| `research` | ❌ | 배열 | `MAX_RESEARCH_ITEMS`(5) 이하. 수집 응답 그대로 |
| `experiments` | ❌ | 배열 | `MAX_EXPERIMENT_ITEMS`(5) 이하. 수집 응답 그대로 |

`research[].sourceName`은 `Europe PMC` \| `arXiv` \| `KCI`만 허용하는 **열거형**이다.
`peerReviewed`(`peer-reviewed`\|`preprint`\|`unknown`), `datePrecision`(`day`\|`month`\|`year`\|`unknown`),
`experiments[].enrollmentType`(`ACTUAL`\|`ESTIMATED`\|`null`)도 마찬가지다.
자유 문자열이면 지어낸 DB 이름이 프롬프트에 그대로 실린다.

`research[].abstract`는 **빈 문자열을 허용한다.** 초록이 없는 논문이 실제로 있고,
막으면 정상 자료가 `400`이 된다.

**위 목록에 없는 필드는 거부된다.** `systemPrompt`, `messages`, `model`, `temperature` 같은 필드를 보내면 `400 INVALID_REQUEST`가 반환된다. 사용자가 LLM 호출 파라미터를 조작할 수 있는 경로는 없다.

`javascript:`, `file:`, `ftp:` 스킴의 URL도 거부된다.

### 응답 `200`

```json
{
  "requestId": "0f8b2c1a-...",
  "analysis": {
    "summary": "...",
    "newsBriefing": [
      {
        "sourceId": "S1",
        "title": "...",
        "source": "...",
        "publishedAt": "2026-08-30T09:00:00.000Z",
        "keyPoints": "...",
        "marketImplication": "...",
        "needsVerification": "..."
      }
    ],
    "trendAnalysis": "...",
    "scenarios": [
      {
        "type": "기본 시나리오",
        "premise": "...",
        "indicatorsToWatch": "...",
        "possibleDirection": "...",
        "invalidationCondition": "...",
        "cautions": "..."
      }
    ],
    "risks": ["..."],
    "monitoringIndicators": ["..."],
    "disclaimer": "본 분석은 ... 투자 권유가 아닙니다."
  },
  "sources": [
    {
      "sourceId": "S1",
      "title": "엔비디아 3분기 실적 발표",
      "source": "연합뉴스",
      "url": "https://example.com/article/1",
      "publishedAt": "2026-08-30T09:00:00.000Z",
      "collectedAt": "2026-09-02T07:52:07.748Z",
      "type": "news",
      "relevance": 3
    }
  ],
  "meta": {
    "collectedAt": "2026-09-02T07:52:07.748Z",
    "sourceCount": 1,
    "duplicatesRemoved": 0,
    "estimatedInputTokens": 842,
    "fabricatedUrlsRemoved": 0,
    "cached": false,
    "degraded": false,
    "model": "gpt-4o"
  }
}
```

### `meta` 필드의 의미

| 필드 | 의미 |
|---|---|
| `collectedAt` | 서버가 이 요청을 처리한 기준 시각 |
| `sourceCount` | 중복 제거 **후** 실제 분석에 쓰인 자료 수 |
| `duplicatesRemoved` | 제목 또는 URL 중복으로 제외된 기사 수 |
| `estimatedInputTokens` | 문자수 기반 **근사치**. 정확한 토큰 수가 아니다 |
| `fabricatedUrlsRemoved` | LLM이 만들어낸, 입력에 없던 URL을 제거한 건수 |
| `cached` | `true`면 이전 동일 요청의 결과를 재사용한 것 (LLM 미호출) |
| `degraded` | `true`면 구조화 출력이 실패해 Markdown 폴백으로 응답한 것 |
| `model` | 실제 사용된 모델명 |
| `actualCostUsd` | 실제 응답 길이로 다시 계산한 비용. 캐시 히트면 `0` |
| `budget` | 이 호출 반영 후의 예산 상태 (`GET /api/budget`과 같은 형태) |

### `degraded: true`일 때의 응답 형태

구조화 출력이 두 번 실패하면 `analysis`의 모양이 바뀐다.

```json
{
  "analysis": { "report": "# 분석 보고서\n\n..." },
  "meta": { "degraded": true, "...": "..." }
}
```

클라이언트는 `meta.degraded`를 확인해 두 형태를 모두 처리해야 한다.

### 출처 타입

`sources[].type`은 `news` \| `financial` \| `research` \| `experiment` 중 하나다.
`sourceId` 접두어가 종류를 드러낸다 — 뉴스 `S1..Sn`, 논문 `P1..Pn`, 실험 `T1..Tn`, 재무 `F1`.
LLM이 `[P2]`를 인용하면 그것이 논문이라는 사실이 인용 자체에 드러난다.

### 출처 무결성 보장

- `sources` 배열은 **서버가 입력 자료에서 직접 생성한다.** LLM 응답 스키마에 `sources`가 없으므로 모델이 출처를 지어낼 경로가 없다.
- 보고서 본문에서 입력에 없던 URL은 `[출처 미확인]`으로 치환되고 `meta.fabricatedUrlsRemoved`에 집계된다.
- LLM에게는 URL 대신 `[S1]` 형식의 출처 ID로만 인용하도록 지시한다.

### 세션 연장

이 엔드포인트가 `200`을 반환할 때만 세션이 `SESSION_TTL_MINUTES`만큼 연장된다. 캐시 히트도 정상적인 사용자 활동으로 보아 연장한다.

**연장되지 않는 경우**: 인증 미들웨어 통과만 한 경우, 검증 실패, rate limit 초과, 토큰 예산 초과, LLM 실패·타임아웃, 파싱 실패.

### 오류

| 상황 | 응답 |
|---|---|
| 인증 실패·만료·로그아웃 | `403 FORBIDDEN` (LLM 미호출) |
| 검증 실패 | `400 INVALID_REQUEST` |
| 본문 크기 초과 | `413 PAYLOAD_TOO_LARGE` |
| 프롬프트·토큰 예산 초과 | `413 INPUT_TOO_LARGE` (LLM 미호출) |
| 확인 토큰 없음·불일치·만료 | `428 CONFIRMATION_REQUIRED` (LLM 미호출) |
| 예산 소진 | `429 BUDGET_EXCEEDED` (LLM 미호출) |
| 요청 과다 | `429 RATE_LIMITED` |
| 동시 분석 과다 | `429 TOO_MANY_CONCURRENT` |
| 중복 제거 후 자료 0건 | `422 INSUFFICIENT_DATA` |
| LLM 타임아웃 | `504 UPSTREAM_TIMEOUT` |
| LLM 오류 | `502 UPSTREAM_ERROR` |
| 회로 차단기 열림 | `503 CIRCUIT_OPEN` |
| 구조화·폴백 모두 실패 | `502 PARSE_FAILED` |

### 예시

```bash
# 1) 로그인
TOKEN=$(curl -sS -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"your-password"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

curl -X POST http://localhost:3000/api/analyze/news \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "newsList": [{
      "title": "엔비디아 3분기 실적 발표",
      "content": "데이터센터 부문 매출이 전년 대비 증가했다고 발표했다.",
      "source": "연합뉴스",
      "url": "https://example.com/article/1",
      "publishedAt": "2026-08-30T09:00:00Z"
    }],
    "marketData": {
      "assetName": "엔비디아",
      "currentPrice": "182.50",
      "priceChange": "+2.3%",
      "chartTrend": "20일 이동평균 상회"
    }
}
```

</details>

전체 시나리오는 `scripts/verify.sh`가 자동으로 검증한다.

---

## 예산은 2차 방어선이다

이 API의 예산 한도는 **이 애플리케이션의 호출만** 막는다. OpenAI 계정의 자동 충전 자체를 막으려면 OpenAI 대시보드에서 직접 설정해야 한다.

- Billing → auto-recharge 해제
- Limits → monthly budget 설정

계정 설정이 1차 방어선이고, 이 API의 예산은 2차 방어선이다.

---

## 면책

이 API가 생성하는 분석은 제공된 자료를 기반으로 한 정보 제공 목적의 분석이며, 특정 금융상품의 매수·매도 또는 투자 수익을 보장하는 투자 권유가 아니다.
