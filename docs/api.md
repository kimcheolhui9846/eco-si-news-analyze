# API 명세

Phase 1 기준. 모든 응답은 `application/json`이며, 모든 응답에 `X-Request-Id` 헤더가 붙는다.

베이스 URL은 기본적으로 `http://localhost:3000`이다.

---

## 분석 모드

수집(`/api/research/collect`)·견적(`/api/analyze/estimate`)·분석(`/api/analyze/news`) 세 엔드포인트는 요청 본문의 `mode`로 동작을 고른다.

| `mode` | 설명 |
|---|---|
| `'invest'` (기본) | 투자 뉴스 분석. `mode`를 생략하면 이 모드이므로 기존 클라이언트는 그대로 동작한다. |
| `'cs'` | CS 기술 동향 브리핑. 아래 "CS 기술 동향 브리핑" 절을 본다. |
| `'paper'` | arXiv 논문 한 편 전문 비판적 읽기. 본문은 arXiv HTML 판, 참고문헌·부록 제외, 약 25,000토큰 예산. 아래 "논문 전문 분석" 절을 본다. |

- 모르는 값은 `400 INVALID_REQUEST` `"지원하지 않는 분석 모드입니다."`로 거부한다.
- 확인 토큰은 **모드에 묶인다.** 견적 때 모드가 요청 해시에 들어가므로 투자 견적의 토큰으로 CS 분석을 실행하면 `428 CONFIRMATION_REQUIRED`다. 반대도 같다.
- `mode`를 뺀 나머지 본문은 모드별 스키마가 검사한다(모르는 필드는 거부).

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
| `COLLECTION_FAILED` | 502 | 모든 뉴스 피드에서 자료를 수집하지 못함 (논문 모드: arXiv 본문을 가져오지 못함) |
| `TOO_MANY_CONCURRENT` | 429 | 동시 분석 한도 초과 |
| `INSUFFICIENT_DATA` | 422 | 중복 제거 후 유효 자료 0건 (논문 모드: 본문 장 없음) |
| `FULLTEXT_UNAVAILABLE` | 422 | arXiv HTML 판이 없는 논문(404 또는 본문 없는 페이지) |
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
| `symbol` | ❌ | 1~32자. 있으면 그 티커 하나만 쓴다. 없으면 `query`에서 회사·분야를 해석한다 |
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
| `market` | 종목마다 Naver 주식 일봉 / Coinbase Exchange BTC·ETH·SOL·XRP 일봉. 미매핑 심볼은 기존 Yahoo Finance / CoinGecko 경로 |
| `financial` | 종목마다 SEC EDGAR XBRL(미국 상장사) 또는 OpenDART 주요계정(한국 상장사, `OPENDART_API_KEY` 필요) |
| `research` | Europe PMC + arXiv (영문 질의) / KCI (한국어 질의) |
| `experiments` | ClinicalTrials.gov v2. **영문 질의에서만** |

목록에 없는 필드는 `400 INVALID_REQUEST`로 거부된다.

### 종목 해석

`resolveInstruments`가 `query`에서 최대 4개(`MAX_INSTRUMENTS`)의 종목을 고른다. 결과는 `collected.resolution.kind`에 실린다.

1. `symbol`이 있으면 그 티커 하나 (`explicit`)
2. 질의에 회사명·티커가 있으면 그 회사 (`company`). 회사명과 분야가 함께 있으면 회사가 우선한다
3. 질의에 분야 키워드가 있으면 그 분야의 대표 종목 묶음 (`sector`)
4. 모두 실패하면 뉴스·논문만 수집한다 (`unresolved`) — 오류가 아니다. `instruments`는 `[]`

일치 규칙: 단어가 키와 같거나 "키 + 조사"일 때만 일치한다("메타버스"는 META가 아니다).
미국 티커 대조는 대문자로 입력된 단어에만 하고, 분야 키워드와 같은 단어("AI" 등)는 티커로 보지 않는다.

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
  "instruments": [
    {
      "symbol": "NVDA", "name": "NVIDIA", "assetType": "stock", "market": "US",
      "marketData": {
        "assetName": "NVDA",
        "currentPrice": "224.41 USD",
        "priceChange": "5.23%",
        "chartTrend": "해당 기간(22개 거래일) 종가는 5.23% 상승했습니다. ..."
      },
      "series": {
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
      "financial": { "source": "sec", "...": "아래 financial 참고" }
    }
  ],
  "collected": {
    "collectedAt": "2026-09-03T01:20:00.000Z",
    "resolution": {
      "kind": "explicit",
      "symbols": ["NVDA"]
    },
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
| `resolution.kind` | `explicit` \| `company` \| `sector` \| `unresolved` |
| `resolution.sector` | `kind`가 `sector`일 때만. 분야명(예: `반도체`) |
| `resolution.symbols` | 해석된 종목 티커 목록(최대 4개). `unresolved`면 `[]` |
| `feedsUsed` | 자료를 **하나 이상 준** 피드의 id |
| `newsCount` | 중복 제거 후 실제 자료 수 |
| `headlineOnlyCount` | **제목만 확보된 자료 수.** 분석 깊이의 한계를 나타낸다 |
| `included` | 실제로 수집한 범위. 요청의 `include`를 정규화한 값 |
| `languageRoute` | 어떤 소스를 왜 불렀는지. `{ route, useEnglishPapers, useKci, useTrials, reason }` |
| `researchCount` | 논문 수 |
| `experimentCount` | 임상시험 수 |
| `financialMetricCount` | 전 종목 합계 재무지표 개수 |
| `degraded` | 실패했거나 빠진 provider와 사유. 종목 단위 항목에는 `symbol`이 붙는다 |

### `instruments[]`

종목 하나의 시세·차트·재무를 묶은 배열이다. `marketData`, `marketSeries`, `financial` 단수 필드는 없다.

| 필드 | 의미 |
|---|---|
| `symbol` `name` `assetType` `market` | 종목 식별. `market`은 `US` 등 |
| `marketData` | 시세 요약. 못 가져왔으면 필드 없음 |
| `series` | 화면 차트용 시계열(아래 참고). 분석 요청에는 보내지 않는다 |
| `financial` | 재무. `source`가 `sec` 또는 `dart`. 없으면 필드 없음 |

종목 하나가 실패해도 나머지로 진행하며, 사유는 `collected.degraded`에 `{ provider, symbol, reason }`로 실린다.
`OPENDART_API_KEY`가 없으면 DART를 부르지 않고 한국 종목에 "API 키 미설정" 사유만 남는다.

### `financial` · `research` · `experiments`

요청하지 않았거나 자료가 없으면 **필드 자체가 없다**(`null`이 아니다).
이 규칙은 협상 대상이 아니다 — `cacheKey`가 `JSON.stringify`로 계산되는데
`undefined` 키는 버려지고 `[]`는 남으므로, 규칙이 갈라지면 확인 토큰이 `428`로 거부된다.

```json
{
  "financial": {
    "source": "sec", "corpCode": null,
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

### `instruments[].series` — 차트용 시계열

Task 6의 Naver/Coinbase 경로는 완료된 일봉을 반환한다. `marketData.currentPrice`는
마지막 완료 봉의 종가이며 `chartTrend`에 출처와 일봉 기준을 표시한다.
Naver `5d`는 최근 완료 거래일 최대 5개, 나머지 범위는 거래소 현지 날짜에서
1·3·6·12개월을 뺀 날부터다(월말 보정). Coinbase 범위는 완료된 UTC 일봉
5·30·90·180·365일이며 현재 진행 중인 UTC 날짜는 제외한다.
미매핑 심볼의 기존 경로는 기존 제공자의 시간·가격 기준을 유지한다.

Naver의 `points[].t`는 현지 거래일을 UTC 자정으로 표현한 날짜 라벨이다.
실제 거래 체결 시각이 아니다. Coinbase의 값은 UTC 일봉 시작 시각이다.

프론트엔드가 차트를 그리는 데 쓴다. 시장 데이터를 못 가져왔으면 `marketData`와 함께 필드가 없다.

| 필드 | 의미 |
|---|---|
| `points[].t` | ISO 8601 시각 |
| `points[].c` | 종가. 값이 없는 거래일은 배열에서 빠진다 |
| `points[].v` | 거래량. 없으면 `null` |
| `indicators` | 이동평균·최고·최저·등락률·변동성. 계산 불가한 값은 `null` |

`points.length`는 `indicators.points`와 항상 같다 — 차트와 이동평균이 어긋나지 않게 하기 위함이다.

**`series`는 분석 프롬프트에 포함되지 않는다.** 숫자 수십 쌍은 토큰만 늘리고 `chartTrend` 문장이 이미 그 내용을 요약한다. `cacheKey`에도 영향을 주지 않으므로 확인 토큰 흐름이 그대로 유지된다.

### 부분 실패

| 상황 | 처리 |
|---|---|
| 일부 피드 실패 | 나머지로 진행. `degraded`에 기록 |
| **모든 뉴스 피드 실패** | `502 COLLECTION_FAILED` — 뉴스가 없으면 분석이 성립하지 않는다 |
| 일부 종목 시세 실패 | 그 종목만 `marketData` 없이 `200`. `degraded`에 `symbol`과 사유 기록 |
| 종목 해석 실패 | `instruments: []`, `resolution.kind: "unresolved"`. 뉴스·논문 분석은 계속된다 |
| 재무: 대상 아님 | `financial` 없이 `200`. 코인이거나 SEC·DART에 없는 종목 |
| 재무: DART 키 없음·오류 | 한국 종목 `financial` 없이 `200`. 사유는 `degraded`. 키 값은 응답·로그에 남지 않는다 |
| 재무: 일부 개념 없음 | 있는 지표만. 없는 것은 `financial.degraded`에 개념명 |
| 논문: 한 소스 실패 | 나머지 소스로 진행 |
| 논문·실험 전부 실패 | 해당 필드 없이 `200`. 뉴스가 있으면 분석은 계속된다 |

**뉴스를 제외한 모든 provider의 실패는 치명적이지 않다.** 자료가 줄 뿐 분석은 성립한다.

### 수집한 자료로 분석하기

`confirmToken`을 `X-Confirm-Token` 헤더에 담아 `/api/analyze/news`를 호출한다. 별도의 `estimate` 호출이 필요 없다.

```bash
curl -X POST http://localhost:3000/api/analyze/news   -H 'Content-Type: application/json'   -H "Authorization: Bearer $TOKEN"   -H "X-Confirm-Token: $CONFIRM"   -d '{"newsList": [...], "instruments": [...]}'
```

**수집 응답의 자료를 하나라도 고치면 확인 토큰이 통하지 않는다** (`428`).
`newsList`·`instruments`·`sector`·`research`·`experiments`가 `cacheKey`에 들어간다.
작은 자료로 견적을 받고 큰 자료로 실행하는 것을 막기 위한 의도된 동작이다.

특히 **빈 배열을 넣지 말 것.** 수집 응답에 `research`가 없었거나 `instruments`에 시세·재무가 모두 없다면 분석 요청에도 넣지 않아야 한다.
`{"research": []}`나 `{"instruments": []}`를 보내면 해시가 달라져 `428`이 난다.

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
  "instruments": [
    {
      "symbol": "NVDA", "name": "NVIDIA", "assetType": "stock", "market": "US",
      "marketData": {
        "assetName": "엔비디아",
        "currentPrice": "182.50",
        "priceChange": "+2.3%",
        "chartTrend": "20일 이동평균 상회"
      }
    }
  ],
  "sector": "반도체",
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
| `instruments` | ❌ | 배열 | 1~4개. 시세·재무가 모두 없는 종목은 빼고, 남는 종목이 없으면 필드를 싣지 않는다 |
| `instruments[].symbol` `name` `assetType` `market` | 조건부 | 문자열 | 종목 식별. 수집 응답 그대로 |
| `instruments[].marketData` | ❌ | 객체 | 있으면 `assetName`(1~200자), `currentPrice`·`priceChange`(문자열이면 64자 이하), `chartTrend`(1~`MAX_TREND_CHARS`(1000)자) 모두 필요 |
| `instruments[].financial` | ❌ | 객체 | 수집 응답 그대로. `source`는 `sec` \| `dart` |
| `instruments[]`의 `series` | — | — | **받지 않는다.** 보내면 `400` |
| `sector` | ❌ | 문자열 | 40자 이하. `collected.resolution.sector`를 그대로 넣는다. 있으면 프롬프트에 분야 묶음 안내가 붙는다 |
| `newsList[].contentKind` | ❌ | 문자열 | `headline` \| `summary` \| `full`. 없으면 `full`로 간주 |
| `analysisPeriod` | ❌ | 문자열 | 200자 이하 |
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
    "instrumentComparison": [{ "symbol": "NVDA", "name": "NVIDIA", "positioning": "...", "keyDifference": "..." }],
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
    "quality": { "score": 100, "fixed": 0, "warnings": 0, "limited": false, "issues": [] },
    "cached": false,
    "degraded": false,
    "model": "gpt-4o"
  }
}
```

`instrumentComparison`은 분석 종목이 2개 이상일 때만 채워진다. 하나 이하면 빈 배열이다.

### `meta` 필드의 의미

| 필드 | 의미 |
|---|---|
| `collectedAt` | 서버가 이 요청을 처리한 기준 시각 |
| `sourceCount` | 중복 제거 **후** 실제 분석에 쓰인 자료 수 |
| `duplicatesRemoved` | 제목 또는 URL 중복으로 제외된 기사 수 |
| `estimatedInputTokens` | 문자수 기반 **근사치**. 정확한 토큰 수가 아니다 |
| `fabricatedUrlsRemoved` | LLM이 만들어낸, 입력에 없던 URL을 제거한 건수 |
| `quality` | 결정적 품질 검사 결과. 아래 "품질 검사" 참고. |
| `cached` | `true`면 이전 동일 요청의 결과를 재사용한 것 (LLM 미호출) |
| `degraded` | `true`면 구조화 출력이 실패해 Markdown 폴백으로 응답한 것 |
| `model` | 실제 사용된 모델명 |
| `actualCostUsd` | 실제 응답 길이로 다시 계산한 비용. 캐시 히트면 `0` |
| `budget` | 이 호출 반영 후의 예산 상태 (`GET /api/budget`과 같은 형태) |

### 품질 검사 (`meta.quality`)

서버는 LLM 응답을 받은 뒤 LLM을 다시 부르지 않고 다음을 검사한다. 교정할 수 있는 것은 교정하고(`fixed`), 교정할 수 없는 것은 경고한다(`warning`).

| check | 내용 |
|---|---|
| `citations` | `newsBriefing`의 출처 ID가 실제 출처인지, 제목·출처·작성일은 원본 값으로 조용히 맞춘다(교정 건수에 넣지 않음). 없는/중복 출처만 교정으로 센다. 본문 `[S9]`처럼 없는 출처 ID는 `출처 미확인`으로 바꾼다. |
| `availability` | 재무·논문·실험 요약의 `available`이 실제 입력 자료와 맞는지. |
| `disclaimer` | 면책 문구를 표준 문구로 고정한다. |
| `scenarios` | 무효화 조건 누락, 단정적 가격·방향 예측이나 매매 권유 표현(경고만). |
| `comparison` | `instrumentComparison`이 입력 종목과 맞는지. |
| `structure` | Markdown 폴백이라 검증이 제한됨(`limited: true`). |

```json
"quality": {
  "score": 85,
  "fixed": 1,
  "warnings": 1,
  "limited": false,
  "issues": [
    { "check": "citations", "severity": "fixed", "message": "제공되지 않은 출처 ID 인용을 \"출처 미확인\"으로 바꿨습니다.", "path": "summary" },
    { "check": "scenarios", "severity": "warning", "message": "시나리오에 무효화 조건이 없습니다. ...", "path": "scenarios[1].invalidationCondition" }
  ]
}
```

`score = max(0, 100 - 10·fixed - 5·warnings)`. 캐시 히트도 같은 값을 돌려준다.

CS 모드(`mode: 'cs'`)는 검사 항목이 다르다. [CS 품질 검사](#cs-품질-검사-metaquality)를 본다.

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
    "instruments": [{
      "symbol": "NVDA", "name": "NVIDIA", "assetType": "stock", "market": "US",
      "marketData": {
        "assetName": "엔비디아",
        "currentPrice": "182.50",
        "priceChange": "+2.3%",
        "chartTrend": "20일 이동평균 상회"
      }
    }]
}
```

</details>

전체 시나리오는 `scripts/verify.sh`가 자동으로 검증한다.

---

## CS 기술 동향 브리핑

본문에 `"mode": "cs"`를 넣으면 같은 세 엔드포인트가 CS 기술 동향 브리핑으로 동작한다. 흐름은 투자 모드와 같다(수집 → 확인 토큰 → 분석). 수집은 LLM을 호출하지 않고, 분석에서만 비용이 든다. 투자 분석 필드(시세·재무·종목 등)는 쓰지 않는다.

### CS 수집 — `POST /api/research/collect`

인증이 필요하다. LLM을 호출하지 않는다.

#### 요청

```json
{ "mode": "cs", "query": "retrieval augmented generation", "lang": "en", "include": ["papers", "community", "repos"] }
```

| 필드 | 필수 | 설명 |
|---|---|---|
| `mode` | 예 | `"cs"` |
| `query` | 예 | 검색어. 1~200자. **영어를 권장한다**(arXiv·Hacker News·Lobsters·Stack Overflow·GitHub가 영어 중심이다). |
| `lang` | 아니오 | `ko`(기본) \| `en`. 뉴스 검색에만 쓴다. |
| `include` | 아니오 | `papers` \| `community` \| `questions` \| `news` \| `blogs` \| `repos` (이 순서). 비우거나 생략하면 전부. 중복은 합치고 응답에서는 이 순서로 정렬한다. |

모르는 필드나 `include` 값은 `400 INVALID_REQUEST`다.

#### 출처별 상한과 기간

| `include` | 출처 | 상한 | 기간 |
|---|---|---|---|
| `papers` | arXiv `cs.*` 분야, 제출일 최신순 | 8 | 제한 없음(최신순) |
| `community` | Hacker News (hn.algolia.com) + Lobsters (lobste.rs). Hacker News 6 : Lobsters 4로 나누고 한쪽이 모자라면 다른 쪽으로 채운다. Lobsters는 검색 JSON이 없어 질의를 태그 피드로 바꿔 읽고, 맞는 태그가 없으면 최신 글에서 거른다 | 10 | 최근 30일 |
| `questions` | Stack Overflow (Stack Exchange API), 투표 순. 선택 환경변수 `STACKEXCHANGE_KEY`가 있으면 하루 10,000회, 없으면 IP당 하루 300회 | 8 | 최근 90일 |
| `news` | `lang`이 `ko`(기본)면 Google 뉴스(ko)·연합뉴스·전자신문, `en`이면 Google News(en). 투자 모드와 같은 뉴스 수집기를 쓴다(티커 피드는 쓰지 않는다) | 8 | 뉴스 수집 기본 동작 |
| `blogs` | 기업·연구 블로그 RSS 10곳(Google Research, Google DeepMind, OpenAI, Hugging Face, Microsoft Research, NVIDIA Developer, AWS Machine Learning, Meta Engineering, BAIR, 토스 기술 블로그) | 8 | 최근 60일 |
| `repos` | GitHub 저장소 검색 | 8 | 최근 30일 |

기업 블로그는 공식 발표라 홍보 성격이 있다. 분석 프롬프트가 이 점을 알린다.

#### 응답 `200`

```json
{
  "requestId": "0f8b2c1a-...",
  "mode": "cs",
  "papers": [ { "...": "..." } ],
  "community": [ { "...": "..." } ],
  "questions": [ { "...": "..." } ],
  "newsList": [ { "title": "...", "content": "...", "source": "...", "url": "...", "publishedAt": "...", "contentKind": "..." } ],
  "blogs": [ { "...": "..." } ],
  "repos": [ { "...": "..." } ],
  "collected": {
    "collectedAt": "2026-11-09T01:00:00.000Z",
    "included": ["papers", "community", "questions", "news", "blogs", "repos"],
    "degraded": [
      { "provider": "repos", "source": "GitHub", "reason": "GitHub 검색 한도를 넘었습니다." },
      { "provider": "news", "feedId": "google-news-ko", "reason": "자료를 가져오지 못했습니다." }
    ],
    "counts": { "papers": 8, "community": 10, "questions": 8, "news": 8, "blogs": 3, "repos": 0 },
    "total": 37,
    "duplicatesRemoved": 0
  },
  "estimate": {
    "estimatedInputTokens": 5200,
    "assumedOutputTokens": 2000,
    "estimatedCostUsd": 0.033,
    "budget": { "calls": { "...": "..." }, "cost": { "...": "..." } }
  },
  "confirmToken": "ct_...",
  "confirmTokenExpiresAt": "2026-11-09T01:05:00.000Z"
}
```

- 상류가 `200`을 주더라도 본문 구조가 틀리면(HN·GitHub·Stack Overflow는 JSON의 `hits`/`items` 배열 없음, Lobsters는 JSON 배열이 아님, arXiv는 Atom `feed` 루트 없음, 블로그는 RSS·Atom이 아니거나 글이 하나도 없음) 실패로 보고 `degraded`에 올리며 캐시하지 않는다. 구조가 맞는 빈 검색 결과는 실패가 아니고 역시 캐시하지 않는다.
- 자료 배열의 키 이름(`papers`·`community`·`questions`·`newsList`·`blogs`·`repos`)은 **분석 요청과 같다.** 클라이언트는 비어 있지 않은 배열만 분석 요청에 되돌려 보낸다(빈 배열은 보내지 않는다. 그래야 견적과 분석의 `cacheKey`가 일치해 확인 토큰이 통한다).
- `collected.counts`는 뉴스 중복 제거 뒤의 개수이고 `total`은 그 합계다.
- `degraded[]`의 `provider`는 `papers`·`community`·`questions`·`news`·`blogs`·`repos` 중 하나다. Hacker News와 Lobsters의 실패는 둘 다 `provider: 'community'`이고 `source`가 `Hacker News` 또는 `Lobsters`로 갈린다. 나머지 필드는 출처마다 다르다. `papers`·`community`·`questions`·`blogs`·`repos`는 `{ provider, source, reason }`, `news`는 피드 단위라 `{ provider: 'news', feedId, reason }`이다. 일부 출처가 실패해도 나머지로 진행한다. 실패 사유는 `자료를 가져오지 못했습니다.` 또는 `일시적으로 사용할 수 없습니다.`(회로 차단기)이고, GitHub이 403·429로 답하면 `GitHub 검색 한도를 넘었습니다.`, Stack Overflow가 한도를 알리면 `Stack Overflow 호출 한도를 초과했습니다. 잠시 뒤 다시 시도해 주세요.`다. Stack Exchange는 잘못되거나 폐기된 `STACKEXCHANGE_KEY`에도 같은 400으로 답하므로, 키를 설정했는데 이 사유가 계속되면 키를 확인한다. 상류의 원본 오류 메시지는 담지 않는다.

#### 오류

| 상태 | 코드 | 상황 |
|---|---|---|
| 400 | `INVALID_REQUEST` | 스키마 위반, 모르는 `mode` |
| 502 | `COLLECTION_FAILED` | 수집한 자료 합계가 3건 미만이거나, 뉴스 중복을 제거한 뒤 3건 미만 |

두 경우 모두 메시지는 `"CS 동향 분석에 필요한 자료를 3건 이상 모으지 못했습니다. 검색어를 영어로 바꾸거나 범위를 넓혀 다시 시도해 주세요."`다. 중복 제거 뒤 부족한 경우에도 분석 단계의 422가 아니라 수집 단계의 502로 통일한다.

### CS 견적·분석 — `POST /api/analyze/estimate`, `POST /api/analyze/news`

두 엔드포인트의 본문은 같다. 견적은 LLM을 호출하지 않고, 분석은 `X-Confirm-Token` 헤더가 필요하다(캐시 히트는 예외). 응답 형태는 투자 모드와 같되 `analysis`, `sources`, `meta.counts`가 CS용이다.

#### 요청

```json
{
  "mode": "cs",
  "newsList": [ ],
  "papers": [ ],
  "community": [ ],
  "questions": [ ],
  "blogs": [ ],
  "repos": [ ]
}
```

여섯 배열은 모두 선택이다. 수집 응답의 배열을 그대로 넣는다. 모르는 필드는 거부한다.

| 필드 | 상한 | 항목 필드 |
|---|---|---|
| `newsList` | `MAX_NEWS_ITEMS` | 투자 모드 `newsList`와 같다 |
| `papers` | 8 | 투자 모드 논문 항목 필드 + `category`(문자열 또는 `null`, 40자) |
| `community` | 10 | `site`(필수, `'hackernews'` \| `'lobsters'`), `title`(1~300자), `url`, `discussionUrl`, `points`(0 이상 정수), `numComments`(0 이상 정수), `publishedAt`, `text`(1500자 이하) |
| `questions` | 8 | `title`(1~300자), `url`, `author`, `tags`(5개 이하, 각 35자 이하), `score`(정수, 음수 가능), `answerCount`(0 이상 정수), `isAnswered`, `hasAcceptedAnswer`(불리언), `viewCount`(0 이상 정수), `publishedAt`, `text`(1500자 이하) |
| `blogs` | 8 | `title`(1~300자), `url`, `blog`(1~100자), `summary`(1500자 이하), `publishedAt` |
| `repos` | 8 | `fullName`(1~200자), `url`, `description`(500자 이하), `stars`(0 이상 정수), `language`(60자 또는 `null`), `license`(60자 또는 `null`), `pushedAt`, `createdAt`(64자 이하 또는 `null`) |

`url`·`discussionUrl`은 `http(s)`만 받는다(2048자 이하). 항목 값에는 trim 같은 변환을 하지 않는다. 변환이 있으면 수집 때와 분석 때 자료가 달라져 확인 토큰이 어긋난다.

자료 합계(뉴스 중복 제거 뒤)가 3건 미만이면 `422 INSUFFICIENT_DATA` `"CS 동향 분석에는 자료가 3건 이상 필요합니다."`다.

#### 출처 ID와 타입

서버가 종류별로 받은 순서대로 붙인다. 수집과 분석이 같은 배열을 보므로 같은 ID가 나온다.

| 접두사 | `sources[].type` | 자료 | `sources[].source` |
|---|---|---|---|
| `P` | `paper` | arXiv 논문 | `arXiv (cs.CL)`처럼 분야를 붙인다(분야가 없으면 `arXiv`) |
| `H` | `community` | Hacker News · Lobsters | `Hacker News` 또는 `Lobsters`(항목의 `site`로 정한다). `url`은 원문이 아니라 **토론 페이지**(`discussionUrl`)다 |
| `Q` | `question` | Stack Overflow 질문 | `Stack Overflow · <author 또는 작성자 미상> · CC BY-SA` (CC BY-SA 표기 의무 때문에 작성자와 라이선스를 싣는다) |
| `S` | `news` | 뉴스 | 기사의 출처명 |
| `B` | `blog` | 기업·연구 블로그 | 블로그 이름 |
| `G` | `repo` | GitHub 저장소 | `GitHub` (제목은 `owner/name`) |

보고서 본문의 URL이 위 자료의 URL(HN·Lobsters는 원문과 토론 두 가지) 밖이면 `[출처 미확인]`으로 치환된다.

#### 응답 `analysis` (`cs_trend_briefing`)

| 필드 | 형식 | 설명 |
|---|---|---|
| `summary` | 문자열 | 전체 요약 |
| `keyDevelopments[]` | 객체 배열 | `title`, `whatIsNew`, `whyItMatters`, `evidenceLevel`, `sourceIds[]` |
| `paperHighlights[]` | 객체 배열 | `sourceId`, `contribution`, `method`, `limitations` |
| `communityPulse` | 문자열 | 커뮤니티 반응 |
| `developerPainPoints[]` | 객체 배열 | 최대 5개. `title`, `detail`, `sourceIds[]`(`Q` 출처만) |
| `openSourceSignals[]` | 객체 배열 | `sourceId`, `signal` |
| `openQuestions` | 문자열 배열 | 미해결 질문 |
| `whatToWatch` | 문자열 배열 | 지켜볼 것 |
| `sourceCoverage` | 객체 | `level`(`충분` \| `부분적` \| `부족`), `note` |

`evidenceLevel`은 `동료 심사 논문` \| `프리프린트` \| `공식 발표·블로그` \| `코드 공개` \| `커뮤니티 화제` \| `언론 보도` 중 하나다.

`meta`는 투자 모드와 같은 공통 필드에 더해 종류별 개수를 싣는다. `sourceCount`는 합계다.

```json
"meta": {
  "sourceCount": 37,
  "duplicatesRemoved": 0,
  "counts": { "papers": 8, "community": 10, "questions": 8, "news": 8, "blogs": 3, "repos": 0 }
}
```

#### CS 품질 검사 (`meta.quality`)

형태와 점수 계산은 [품질 검사](#품질-검사-metaquality)와 같고, 검사 항목이 다음 다섯 가지다. 이 순서로 돈다.

| check | 동작 |
|---|---|
| `citations` | 본문에 인용된 없는 출처 ID(`[P9]` 등)를 `출처 미확인`으로 바꾼다(투자 모드와 같은 검사). 인정하는 접두사는 CS 모드에서 `P H S B G Q`이고 투자 모드는 종전대로 `S P T F M`이다. 그 밖의 `[T1]` 같은 글자는 건드리지 않는다. |
| `sourceRefs` | `keyDevelopments[].sourceIds`에서 제공되지 않은 ID를 빼고(교정 `주요 동향에서 제공되지 않은 출처 ID N개를 뺐습니다.`), 중복은 조용히 합친다. 남은 ID가 없으면 경고 `근거 출처가 없는 동향입니다. 직접 확인해 주세요.` `paperHighlights`·`openSourceSignals`의 `sourceId`가 제공된 출처에 없으면 그 항목을 제거한다(교정 `논문 하이라이트 항목의 출처 ID(P9)가 제공된 출처에 없어 항목을 제거했습니다.`, 오픈소스 신호는 `오픈소스 신호 항목의 ...`). `developerPainPoints[].sourceIds`는 `Q`로 시작하고 제공된 출처만 남기고(교정 `막히는 지점에서 개발자 질문이 아니거나 제공되지 않은 출처 ID N개를 뺐습니다.`), 남는 ID가 없는 항목은 제거하며(교정 `개발자 질문 근거가 없는 막히는 지점 항목을 제거했습니다.`), 개발자 질문을 수집했는데 섹션이 비면 경고 `개발자 질문 자료가 있는데 막히는 지점을 정리하지 않았습니다.`를 낸다. 출처가 있어도 종류가 맞지 않으면(논문 하이라이트가 `P`가 아닌 출처, 오픈소스 신호가 `G`가 아닌 출처) 항목을 제거한다(교정 `... 출처 ID(G1)는 종류가 맞지 않아 항목을 제거했습니다.`). |
| `evidence` | 근거가 전부 `P`(arXiv)인데 `동료 심사 논문`이면 `프리프린트`로 교정한다(`근거가 arXiv 프리프린트뿐이라 근거 수준을 '프리프린트'로 바로잡았습니다.`). `코드 공개`인데 근거에 `G`가 없으면 경고(`'코드 공개'로 표시됐지만 근거에 GitHub 저장소가 없습니다.`). |
| `coverage` | `sourceCoverage.level`이 `충분`인데 수집 자료가 5건 미만이면 `부족`으로 교정한다(`수집 자료가 N건뿐이라 자료 충분도를 '부족'으로 바로잡았습니다.`). |
| `investmentLanguage` | `매수`·`매도`·`주가`·`목표 주가`·`투자 권유` 같은 투자 표현이 있으면 경고만 한다(`CS 브리핑에 투자 관련 표현이 있습니다.`). 앞에 한글이 붙은 `외주가` 같은 낱말은 거르지 않는다. |

투자 모드의 `availability`·`disclaimer`·`scenarios`·`comparison`은 CS에서 돌지 않는다.

---

## 논문 전문 분석

본문에 `"mode": "paper"`를 넣으면 같은 세 엔드포인트가 arXiv 논문 한 편의 전문 비판적 읽기로 동작한다. 흐름은 같다(수집 → 확인 토큰 → 분석). 수집은 LLM을 호출하지 않고 arXiv HTML 판을 가져와 장 단위로 나눈다. 분석에서만 비용이 든다(논문 한 편 약 $0.07~0.10).

### 논문 수집 — `POST /api/research/collect`

인증이 필요하다. LLM을 호출하지 않는다.

#### 요청

```json
{ "mode": "paper", "arxiv": "2401.04088" }
```

`arxiv`는 arXiv ID(`2401.04088`, 버전 `2401.04088v2`, 옛 형식 `hep-th/9901001`), `arXiv:` 접두(`arXiv:2401.04088`), 또는 `arxiv.org`의 abs·pdf·html 링크(`https://arxiv.org/abs/2401.04088`)다. 모르는 필드는 `400 INVALID_REQUEST`다.

#### 응답 `200`

```json
{
  "requestId": "0f8b2c1a-...",
  "mode": "paper",
  "paper": {
    "id": "2401.04088",
    "title": "Mixtral of Experts",
    "authors": ["Albert Q. Jiang", "..."],
    "url": "https://arxiv.org/abs/2401.04088",
    "htmlUrl": "https://arxiv.org/html/2401.04088",
    "sections": [
      { "id": "S0", "anchor": "abstract1", "heading": "Abstract", "text": "..." },
      { "id": "S1", "anchor": "S1", "heading": "1 Introduction", "text": "..." }
    ],
    "truncated": [
      { "id": "S6", "heading": "6 Results", "partial": true },
      { "id": "S7", "heading": "7 Conclusion", "partial": false }
    ]
  },
  "collected": {
    "collectedAt": "2026-11-09T01:00:00.000Z",
    "outline": [
      { "id": "S0", "heading": "Abstract", "tokens": 240, "status": "full" },
      { "id": "S1", "heading": "1 Introduction", "tokens": 610, "status": "full" },
      { "id": "S6", "heading": "6 Results", "tokens": 9800, "status": "partial" },
      { "id": "S7", "heading": "7 Conclusion", "tokens": 400, "status": "dropped" }
    ],
    "sectionCount": 6,
    "truncatedCount": 2
  },
  "estimate": {
    "estimatedInputTokens": 26000,
    "assumedOutputTokens": 2000,
    "estimatedCostUsd": 0.085,
    "budget": { "calls": { "...": "..." }, "cost": { "...": "..." } }
  },
  "confirmToken": "ct_...",
  "confirmTokenExpiresAt": "2026-11-09T01:05:00.000Z"
}
```

- `paper.sections`는 예산 안에 든 장이다. `S0`은 초록, `S1…`은 본문 장(번호 없는 장 포함, 문서 순서). 참고문헌과 부록은 뺀다. 소절은 장 본문 안에 `## 소제목` 줄로 남는다. 수식은 `$…$`, 표는 행마다 탭으로 이은 줄, 그림은 캡션만 남는다.
- 본문은 약 25,000토큰까지 앞 장부터 담는다. 초록은 항상 담는다.
- `collected.outline`은 화면용 목차다(분석 요청에는 싣지 않는다). `status`는 다음 중 하나다.

| `status` | 의미 |
|---|---|
| `full` | 장 전체가 분석에 들어간다 |
| `partial` | 예산이 남아 있어 장의 앞부분만 들어간다(남은 예산이 2,000토큰 이상일 때). 이후 장은 모두 빠진다 |
| `dropped` | 예산을 넘어 장이 분석에서 빠진다. 이 장의 ID를 인용하면 품질 검사가 지운다 |

- `paper.truncated`는 `partial`·`dropped`인 장의 `{ id, heading, partial }` 목록이고, `truncatedCount`는 그 개수다.
- `paper`는 **분석 요청에 그대로 되돌려 보낸다.** 고치면 확인 토큰이 통하지 않는다(`428`).

#### 오류

| 상태 | 코드 | 상황 |
|---|---|---|
| 400 | `INVALID_REQUEST` | 스키마 위반, arXiv ID·링크 형식 오류 |
| 422 | `INSUFFICIENT_DATA` | 본문 장이 초록(`S0`)뿐이라 분석할 내용이 없음. 메시지 `"본문 장이 없어 전문 분석을 할 수 없습니다."` |
| 422 | `FULLTEXT_UNAVAILABLE` | arXiv HTML 판이 없는 논문(404 또는 본문 없는 페이지). 메시지 `"이 논문은 arXiv HTML 판이 없어 전문 분석을 할 수 없습니다."` |
| 502 | `COLLECTION_FAILED` | arXiv 네트워크 오류·5xx·429, 일시 차단. 파싱한 결과가 분석 요청 스키마에 맞지 않을 때도 같은 코드·메시지로 막는다(승인 뒤 400이 나지 않도록). 메시지 `"arXiv에서 논문 본문을 가져오지 못했습니다. 잠시 뒤 다시 시도해 주세요."` |

### 논문 견적·분석 — `POST /api/analyze/estimate`, `POST /api/analyze/news`

두 엔드포인트의 본문은 같다. 견적은 LLM을 호출하지 않고, 분석은 `X-Confirm-Token` 헤더가 필요하다(캐시 히트는 예외).

#### 요청

수집 응답의 `paper`를 그대로 넣는다. 모르는 필드는 거부한다.

```json
{ "mode": "paper", "paper": { "id": "2401.04088", "title": "...", "authors": [], "url": "...", "htmlUrl": "...", "sections": [ { "id": "S1", "anchor": "S1", "heading": "1 Introduction", "text": "..." } ], "truncated": [] } }
```

장 ID는 `S` + 숫자(1~3자리), 장은 200개 이하다. Zod는 장마다 `text` 길이만 프롬프트 길이 상한으로 막고, 본문 합계는 프롬프트 크기 검사(`413 INPUT_TOO_LARGE`)가 막는다. 본문 장이 `S0`뿐이면 `422 INSUFFICIENT_DATA` `"본문 장이 없어 전문 분석을 할 수 없습니다."`다. 확인 토큰은 모드에 묶이므로 투자·CS 토큰으로는 분석할 수 없다.

#### 출처 ID와 타입

장마다 출처 한 건이다. `sourceId`는 장 ID(`S0`, `S1`…)이고 `type`은 `section`, `source`는 `arXiv <id>`, `url`은 HTML 판의 장 앵커(`https://arxiv.org/html/2401.04088#S3`)다. 보고서 본문의 URL이 논문 abs·html 링크와 장 앵커 밖이면 `[출처 미확인]`으로 치환된다.

#### 응답 `analysis` (`paper_critical_reading`)

| 필드 | 형식 | 설명 |
|---|---|---|
| `summary` | 문자열 | 전체 요약 |
| `problem` | 객체 | `statement`, `sourceIds[]` |
| `method` | 객체 | `overview`, `keyIdeas[]`, `sourceIds[]` |
| `experimentalSetup` | 객체 | `datasets[]`, `baselines[]`, `metrics[]`, `sourceIds[]` |
| `keyResults[]` | 객체 배열 | 최대 6개. `claim`, `numbers[]`(본문 표기 그대로), `sourceIds[]` |
| `authorStatedLimitations[]` | 객체 배열 | 저자가 밝힌 한계. `point`, `sourceIds[]` |
| `reviewerConcerns[]` | 객체 배열 | 최대 5개. `concern`, `why`, `severity`(`경미` \| `중요` \| `치명`), `sourceIds[]` |
| `reproducibility` | 객체 | `code`·`data`(`공개` \| `미공개` \| `언급 없음`), `note`, `sourceIds[]` |
| `openQuestions` | 문자열 배열 | 남은 질문 |

`meta`는 공통 필드에 더해 다음을 싣는다. `sourceCount`는 분석에 들어간 장 수다.

```json
"meta": {
  "sourceCount": 6,
  "duplicatesRemoved": 0,
  "paper": { "id": "2401.04088", "title": "Mixtral of Experts" },
  "truncated": [ { "id": "S7", "heading": "7 Conclusion", "partial": false } ]
}
```

#### 논문 품질 검사 (`meta.quality`)

형태와 점수 계산은 [품질 검사](#품질-검사-metaquality)와 같고, 검사 항목이 다음 순서로 돈다. 인용 접두사는 `S`다.

| check | 동작 |
|---|---|
| `citations` | 제공되지 않은 장 ID 인용(`[S9]` 등)을 `출처 미확인`으로 바꾼다. |
| `sectionRefs` | `sourceIds`에서 제공되지 않은 장 ID(분석에서 빠진 장 포함)를 정리한다(교정). 목록 항목(`keyResults`·`authorStatedLimitations`·`reviewerConcerns`)은 근거 장이 하나도 남지 않으면 항목을 제거한다(교정). 객체 섹션(`problem`·`method`·`experimentalSetup`·`reproducibility`)은 근거가 비면 경고만 남긴다. |
| `numbers` | `keyResults[].numbers`의 각 값을 인용한 장 본문과 대조한다. 정규화는 쉼표 천 단위 제거, 유니코드 마이너스를 `-`로, 끝의 `%`·`x`·`×` 분리이고, 순수한 수치는 숫자 경계로 찾는다(`85.3`이 `185.3`에 걸리지 않는다). 본문에 없는 값은 지우고(교정), 값이 모두 지워지면 항목을 제거한다(교정). `numbers`가 원래 빈 정성 결과는 그대로 둔다. 한 자리 같은 작은 정수는 본문 어디에나 있어 쉽게 일치하므로 이런 값에는 검사가 약하다. |
| `coverage` | 경고만 한다: 잘리거나 빠진 장이 있을 때, 장 제목에 `experiment`·`evaluation`·`result`·`benchmark`가 있는데 `keyResults`가 비었을 때, `reviewerConcerns`가 비었을 때. |
| `investmentLanguage` | `매수`·`매도`·`주가` 같은 투자 표현이 있으면 경고만 한다(CS 모드와 같은 검사). |

---

## 예산은 2차 방어선이다

이 API의 예산 한도는 **이 애플리케이션의 호출만** 막는다. OpenAI 계정의 자동 충전 자체를 막으려면 OpenAI 대시보드에서 직접 설정해야 한다.

- Billing → auto-recharge 해제
- Limits → monthly budget 설정

계정 설정이 1차 방어선이고, 이 API의 예산은 2차 방어선이다.

---

## 면책

이 API가 생성하는 분석은 제공된 자료를 기반으로 한 정보 제공 목적의 분석이며, 특정 금융상품의 매수·매도 또는 투자 수익을 보장하는 투자 권유가 아니다.
