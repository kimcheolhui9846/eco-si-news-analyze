# Phase 2a — 뉴스·시장 데이터 커넥터 설계

- **작성일**: 2026-09-02
- **상태**: 승인됨
- **범위**: NewsProvider(RSS), MarketChartProvider, `/api/research/collect`, SSRF·외부 호출 방어
- **선행**: Phase 1 (PR #1 병합, `main` d0ba4ae)

---

## 1. 범위 결정

Phase 2를 다시 둘로 나눈다.

| 단계 | 범위 | 근거 |
|---|---|---|
| **Phase 2a** | 뉴스 + 시장 데이터 + 오케스트레이션 + SSRF 방어 | 기존 분석 엔진이 이미 `newsList`·`marketData`를 소비한다. 엔진을 바꾸지 않고 붙일 수 있다 |
| Phase 2b | 재무지표 + 논문 + 실험 | 프롬프트 구획·응답 스키마·출처 타입을 **모두 확장**해야 한다. 별개의 작업이다 |

2a만 끝나도 "검색어를 넣으면 뉴스와 차트를 모아 분석해주는" 완결된 제품이 된다.

### 2a에서 제외하는 것

- 언론사 페이지 크롤링 (§3.3 참조)
- 재무지표·논문·실험 provider
- 프론트엔드
- 분석 엔진·프롬프트 스키마 변경 — `contentKind` 표기를 위한 최소 추가만 예외

---

## 2. 실측으로 확인한 사실

설계 전에 실제 응답을 받아 확인했다. 추정이 아니다.

### 2.1 동작이 확인된 무료 소스

| 소스 | 확인 내용 |
|---|---|
| Google News RSS (한국어) | `HTTP 200`, 112건. 키 불필요 |
| Google News RSS (영어) | `HTTP 200`, 104건 |
| Yahoo Finance chart (미국) | `NVDA` → USD, NMS, 22개 일봉 |
| Yahoo Finance chart (한국) | `005930.KS` → KRW, KSC. 한국 종목도 잡힌다 |
| CoinGecko market_chart | `bitcoin` → 31개 일별 가격 |
| Yahoo Finance headline RSS | `NVDA` → 20건, 리드 112자 |
| 연합뉴스 경제 RSS | 120건, 리드 83자 |
| 전자신문 RSS | 30건, 리드 250자 |

### 2.2 제약으로 확인된 것

| 사실 | 영향 |
|---|---|
| **Google News RSS의 `description`에 본문이 없다** — 제목을 반복하는 앵커 태그와 매체명뿐 | 검색 피드에서는 `content`가 제목뿐이다 |
| **Yahoo 티커 검색이 한글 질의에 `400`을 반환한다** (`NVIDIA`→`NVDA` 성공, `삼성전자`·`엔비디아` 실패) | 한글 회사명 → 티커 자동 해석을 API에 기댈 수 없다 |
| 언론사 RSS는 검색이 안 된다 — 최신 피드만 제공한다 | 키워드 필터링을 클라이언트 쪽에서 해야 한다 |
| 한국경제 RSS는 `description`이 비어 있다 | 피드마다 본문 유무가 다르다. 코드가 이를 전제해야 한다 |
| 매일경제 RSS가 `403` | 피드는 언제든 죽는다. 부분 실패를 정상 경로로 다뤄야 한다 |

### 2.3 Yahoo Finance 비공식 엔드포인트에 대한 주의

`query1.finance.yahoo.com`의 chart·search 엔드포인트는 **공식 문서화된 공개 API가 아니다.** 동작은 확인했으나 예고 없이 바뀌거나 차단될 수 있고, 대량 호출은 약관 문제가 될 수 있다.

**대응**: provider를 교체 가능한 구조로 두고, 실패 시 뉴스만으로 진행한다(§5.4). 개인 리서치 용도의 저빈도 호출을 전제로 하며, 캐시로 호출을 줄인다. 상용 서비스로 전환한다면 정식 시장 데이터 API로 교체해야 한다 — 이를 `docs/architecture.md`에 명시한다.

---

## 3. 뉴스 수집 전략

### 3.1 문제

검색이 되는 소스에는 본문이 없고, 본문이 있는 소스는 검색이 안 된다. 둘 중 하나만 쓰면 커버리지나 분석 깊이 중 하나를 잃는다.

### 3.2 해결 — 하나의 메커니즘, 두 종류의 피드

RSS 기반 provider 하나가 **피드 레지스트리**를 소비한다. 피드는 두 종류다.

```js
{
  id: 'google-news-ko',
  kind: 'search',                 // 검색어를 URL에 넣는다
  urlTemplate: 'https://news.google.com/rss/search?q={query}&hl=ko&gl=KR&ceid=KR:ko',
  lang: 'ko',
  contentKind: 'headline',        // 본문이 없다
}
{
  id: 'yonhap-economy',
  kind: 'topic',                  // 고정 피드를 받아 키워드로 거른다
  url: 'https://www.yna.co.kr/rss/economy.xml',
  lang: 'ko',
  contentKind: 'summary',         // 리드 문단이 있다
}
```

`kind`가 `search`면 검색어를 URL에 치환하고, `topic`이면 피드 전체를 받아 제목·본문에 검색어가 포함된 항목만 남긴다. **코드 경로는 하나**이고 차이는 설정에 있다.

두 결과를 합친 뒤 Phase 1의 중복 제거(정규화 제목 해시 + URL)를 그대로 태운다.

### 3.3 크롤링을 하지 않는 이유

언론사 페이지에서 본문을 긁으면 분석이 깊어진다. 그러나 한 번에 다음이 딸려온다.

- **SSRF 표면** — 임의 호스트로 요청이 나간다. 허용목록이 무의미해진다
- **사이트별 파싱** — 매체마다 DOM이 다르고 개편 때마다 조용히 깨진다
- **약관·저작권** — 매체마다 정책이 다르다

Phase 2a는 하지 않는다. RSS 링크가 가리키는 페이지를 **fetch하지 않는 것**이 지금 SSRF를 막는 실질적 근거다.

### 3.4 한계를 숨기지 않는다

각 자료에 `contentKind`(`headline` | `summary`)를 부여해 프롬프트에 싣는다. 시스템 프롬프트에 한 줄을 추가한다.

> 자료에 `contentKind: headline`이 표시된 것은 제목만 확보된 기사입니다. 본문 내용을 추론하거나 지어내지 말고, 제목이 시사하는 바까지만 다루세요. 더 확인이 필요하면 "확인이 필요한 사항"에 적으세요.

Phase 1이 이미 "자료 부족"을 명시하도록 설계돼 있으므로 그 틀에 얹힌다. **분석 품질의 한계를 사용자와 모델 양쪽에 드러낸다.**

---

## 4. 심볼 해석

한글 회사명 → 티커 자동 해석이 API로 불가능하므로 3단계로 푼다.

1. 요청에 `symbol`이 있으면 그대로 쓴다 — 가장 확실하다
2. 없으면 **내장 별칭 사전**을 본다 (`엔비디아`→`NVDA`, `삼성전자`→`005930.KS`, `비트코인`→`bitcoin` 등 수십 개). 코드 상수이며 확장 가능하다
3. 그래도 없고 질의가 ASCII면 Yahoo search를 시도한다
4. 모두 실패하면 **뉴스만 수집하고** `degraded`에 "심볼을 해석하지 못했습니다"를 남긴다. 오류가 아니다

LLM으로 의도를 파싱하지 않는다. 분석 1회당 LLM 호출이 2회로 늘어 비용이 배가 되기 때문이다 — 사용자의 비용 제약과 정면으로 충돌한다.

---

## 5. Provider 구조

### 5.1 공통 계약

원본 요구사항 §9의 인터페이스를 따르되, 실제로 쓰이는 형태로 좁힌다.

```js
createRssNewsProvider({ feeds, http, cache, breaker, clock })
  → { search({ query, lang, limit }) → Promise<{ items, degraded }> }

createMarketProvider({ http, cache, breaker, clock, aliases })
  → { fetch({ symbol, assetType, range }) → Promise<{ marketData, indicators, degraded }> }
```

`items`는 Phase 1의 `newsList` 스키마를 그대로 만족한다(`title`·`content`·`source`·`url`·`publishedAt`). 여기에 `contentKind`가 추가된다.

### 5.2 `http` 주입

`clock`·`llm`을 주입해 얻은 것과 같은 이유다. 네트워크 없이 provider 전체를 테스트하기 위한 유일한 방법이며, 오늘 받은 실제 응답을 픽스처로 저장해 쓴다.

```js
createHttpClient({ allowlist, timeoutMs, maxBytes, fetchImpl })
  → { get(url, { headers }) → Promise<{ status, text }> }
```

허용목록·타임아웃·크기 상한을 이 한 곳에서 강제한다. provider가 각자 지키게 두면 언젠가 빠뜨린다.

### 5.3 `chartTrend`는 코드가 계산한다

OHLC에서 결정적으로 산출한다.

- 기간 등락률, 최고·최저
- 5일·20일 이동평균과 현재가의 관계
- 일간 수익률 표준편차 기반 변동성
- 거래량 추세

이를 문장으로 조립해 `marketData.chartTrend`에 넣는다. **LLM에게 차트 해석을 맡기지 않는다** — 없는 추세를 지어내기 때문이다. Phase 1이 출처 URL을 후처리로 강제한 것과 같은 원칙이다.

### 5.4 부분 실패는 정상 경로다

뉴스와 시장 데이터를 **병렬로** 수집하고, 하나가 실패해도 나머지로 진행한다.

| 상황 | 처리 |
|---|---|
| 일부 피드 실패 | 나머지 피드 결과로 진행. `degraded`에 실패한 피드 기록 |
| 모든 뉴스 피드 실패 | `502 COLLECTION_FAILED` — 뉴스가 없으면 분석이 성립하지 않는다 |
| 시장 데이터 실패 | `marketData` 없이 진행. Phase 1이 이미 선택 필드로 다룬다 |
| 심볼 해석 실패 | 위와 같음 |

`degraded`는 응답에 그대로 실어 사용자가 무엇이 빠졌는지 알게 한다.

---

## 6. `/api/research/collect`

### 6.1 왜 별도 엔드포인트인가

Phase 1의 비용 통제(견적 → 확인 토큰 → 실행)를 깨지 않아야 한다. 수집은 LLM을 호출하지 않으므로 **무료**이고, 사용자가 수집 결과를 보고 분석 여부를 정할 수 있다.

```
POST /api/research/collect     ← 외부 수집만. LLM 미호출 = 무료
   → { newsList, marketData, collected, estimate, confirmToken }

POST /api/analyze/news         ← Phase 1 엔드포인트 그대로
   Header: X-Confirm-Token
   → 분석 결과
```

수집 응답에 견적과 확인 토큰을 함께 실어 왕복을 2회로 줄인다. 수집 단계가 이미 정규화된 `items`를 갖고 있으므로 `cacheKey`를 계산할 수 있다.

**분석 엔진은 바뀌지 않는다.** 수집은 앞단에 붙을 뿐이다.

### 6.2 요청

```json
{
  "query": "엔비디아 AI 반도체",
  "symbol": "NVDA",
  "assetType": "stock",
  "lang": "ko",
  "range": "1mo",
  "maxNews": 10
}
```

| 필드 | 필수 | 제약 |
|---|---|---|
| `query` | ✅ | 1~200자 |
| `symbol` | ❌ | 1~32자. 없으면 §4의 해석 시도 |
| `assetType` | ❌ | `stock` \| `crypto`. 기본 `stock` |
| `lang` | ❌ | `ko` \| `en`. 기본 `ko` |
| `range` | ❌ | `5d` \| `1mo` \| `3mo` \| `6mo` \| `1y`. 기본 `1mo` |
| `maxNews` | ❌ | 1~`MAX_NEWS_ITEMS`(20). 기본 10 |

`z.strictObject`로 미허용 필드를 거부한다. Phase 1과 같은 원칙이다.

### 6.3 응답

```json
{
  "requestId": "...",
  "newsList": [ /* Phase 1 스키마 + contentKind */ ],
  "marketData": { "assetName", "currentPrice", "priceChange", "chartTrend" },
  "collected": {
    "collectedAt": "...",
    "resolvedSymbol": "NVDA",
    "symbolSource": "explicit | alias | search | unresolved",
    "feedsUsed": ["google-news-ko", "yonhap-economy"],
    "newsCount": 10,
    "duplicatesRemoved": 3,
    "headlineOnlyCount": 6,
    "degraded": [
      { "provider": "market", "reason": "심볼을 해석하지 못했습니다" }
    ]
  },
  "estimate": { "estimatedInputTokens": 3120, "estimatedCostUsd": 0.0154, "budget": { } },
  "confirmToken": "ct_...",
  "confirmTokenExpiresAt": "..."
}
```

`headlineOnlyCount`를 노출해 사용자가 분석 깊이의 한계를 미리 안다.

### 6.4 인증과 방어

Phase 1과 동일하게 `requireAuth` 뒤에 둔다. 외부 API 호출도 비용은 아니지만 트래픽이므로 rate limit을 적용한다. 예산은 차감하지 않는다 — LLM을 부르지 않기 때문이다.

### 6.5 Phase 1 스키마에 필요한 최소 변경

`collect`가 반환한 `newsList`를 그대로 `/api/analyze/news`에 넘길 수 있어야 한다. 그런데 Phase 1의 분석 스키마는 `z.strictObject`라 **미허용 필드를 거부한다.** `contentKind`가 붙은 채로 넘기면 `400 INVALID_REQUEST`가 난다.

**변경**: 기사 스키마에 `contentKind`를 **선택 필드**로 추가한다.

```js
contentKind: z.enum(['headline', 'summary', 'full']).optional()
```

- 선택이므로 Phase 1의 기존 요청은 그대로 통과한다 (하위 호환)
- 열거형이므로 임의 문자열이 프롬프트에 들어가지 못한다
- 없으면 `full`로 간주한다 — 클라이언트가 직접 넣은 자료는 본문이 있다고 보는 것이 기존 동작과 일치한다

이것이 Phase 2a가 분석 엔진에 가하는 **유일한** 변경이다.

### 6.6 확인 토큰이 성립하려면 정규화가 멱등이어야 한다

`collect`는 정규화된 자료로 `cacheKey`를 계산해 확인 토큰을 발급한다. 이후 `/api/analyze/news`가 같은 `newsList`를 받아 **다시 정규화**하고 `cacheKey`를 계산한다. 두 값이 같아야 토큰이 통한다.

즉 `normalizeNewsList(normalizeNewsList(x)) === normalizeNewsList(x)`가 성립해야 한다. 현재 구현은 이를 만족한다.

- `stripControlChars`·`collapseWhitespace` — 이미 정리된 문자열에 다시 적용해도 동일
- 중복 제거 — 이미 중복이 없으면 무연산
- `publishedAt` — ISO 문자열을 다시 `new Date().toISOString()`해도 동일
- 정렬 — 이미 정렬된 배열에 다시 적용해도 동일

**멱등성을 테스트로 고정한다.** 깨지면 확인 토큰이 조용히 실패하고 사용자는 이유를 알 수 없는 `428`을 받게 된다.

반대로, 클라이언트가 `collect` 이후 `newsList`를 손대면 토큰이 맞지 않아 `428`이 난다. 이는 **의도된 동작**이다 — 작은 자료로 견적을 받고 큰 자료로 실행하는 것을 막는다.

---

## 7. SSRF와 외부 호출 방어

Phase 2a에서 처음으로 서버가 외부를 호출한다. 새 보안 축이다.

### 7.1 표면이 좁은 이유

호출 대상 호스트가 **코드 상수**다. 사용자 입력은 쿼리 문자열에만 들어가고 호스트를 결정하지 못한다. 그래도 구조적으로 강제한다.

### 7.2 `createHttpClient`가 강제하는 것

| 방어 | 구현 | 없으면 |
|---|---|---|
| **호스트 허용목록** | 요청 전 `new URL(url).hostname`이 목록에 있는지 확인. 없으면 예외 | 설정 실수 하나로 임의 호스트 호출 |
| **리다이렉트 미추적** | `redirect: 'manual'`. 3xx는 실패로 처리 | 허용목록 호스트가 내부망으로 리다이렉트시키면 우회된다 |
| **응답 크기 상한** | 스트림을 읽으며 `MAX_EXTERNAL_RESPONSE_BYTES` 초과 시 중단 | 거대 응답으로 메모리 고갈 |
| **타임아웃** | `AbortSignal.timeout` | 느린 상류가 요청을 붙잡는다 |
| **프로토콜 제한** | `https:`만 허용 | 평문 통신 |

허용목록 기본값: `news.google.com`, `feeds.finance.yahoo.com`, `query1.finance.yahoo.com`, `api.coingecko.com`, `www.yna.co.kr`, `rss.etnews.com`. 환경변수로 조정 가능하다.

### 7.3 응답을 신뢰하지 않는다

RSS는 외부가 통제하는 데이터다. Phase 1의 방어가 그대로 적용된다.

- `stripControlChars`로 제어문자·ANSI 제거
- `escapeDelimiters`로 프롬프트 구획 위조 차단
- 길이 상한 적용 후 프롬프트에 삽입
- XML 파싱은 `fast-xml-parser`에 맡기되 **외부 엔티티 확장을 끈다** (XXE 방지)

RSS 안에 "이전 지시를 무시하라"가 들어와도 Phase 1의 델리미터 구획이 데이터로 가둔다.

### 7.4 provider별 회로 차단기

Phase 1의 `createCircuitBreaker`를 provider마다 하나씩 만든다. 뉴스 피드가 죽어도 시장 데이터는 살아야 하고, 그 반대도 마찬가지다. LLM용 차단기와도 분리된다.

---

## 8. 캐시

외부 호출을 줄이는 것이 목적이다. Phase 1의 `createTtlCache`를 재사용한다.

| 대상 | 키 | TTL 기본값 | 근거 |
|---|---|---|---|
| 뉴스 피드 응답 | `feedId + query + lang` | 5분 | 뉴스는 분 단위로 바뀐다 |
| 시장 차트 | `symbol + range` | 1분 | 장중 가격 변동을 반영해야 한다 |
| 심볼 검색 | `query` | 24시간 | 티커는 거의 바뀌지 않는다 |

전부 환경변수로 조정 가능하다.

---

## 9. 파일 구조

`server.js`가 이미 1,100줄을 넘었다. Phase 2a에서 provider가 붙으면 관리 한계를 넘는다. **Phase 1 설계 §2.3에서 예고한 분리 시점이다.**

```
server.js              # 진입점 + createApp. 라우터 등록과 조립
lib/
  config.js            # loadConfig
  errors.js            # ApiError
  logger.js            # createLogger
  session.js           # createSessionStore, safeCompare
  budget.js            # createBudgetTracker, estimateCostUsd
  cost-defense.js      # createTtlCache, createSemaphore, createInflightMap,
                       # hashRequest, rate limiter 팩토리
  validation.js        # buildAnalyzeSchema, buildResearchSchema, formatZodError
  normalize.js         # normalizeNewsList, stripControlChars
  prompt.js            # SYSTEM_PROMPT, buildUserPrompt, escapeDelimiters, estimateTokens
  llm.js               # createLlmClient, createMockLlmClient, callWithResilience,
                       # createCircuitBreaker, ANALYSIS_JSON_SCHEMA
  postprocess.js       # stripFabricatedUrls, parseAnalysis, buildSources
  http.js              # createHttpClient (허용목록·타임아웃·크기 상한)   ← 신규
  providers/
    feeds.js           # 피드 레지스트리                                  ← 신규
    aliases.js         # 심볼 별칭 사전                                   ← 신규
    news.js            # createRssNewsProvider                            ← 신규
    market.js          # createMarketProvider, 차트 지표 계산             ← 신규
```

**분리는 순수 이동이다.** 함수 본문을 바꾸지 않고 옮기며, 기존 164개 테스트가 그대로 통과하는 것으로 검증한다. 테스트가 `../server.js`에서 import하던 것을 유지하기 위해 `server.js`가 재export한다.

`server.js`는 실행 가능한 진입점으로 남는다 — 원본 요구사항 §3의 조건이다.

---

## 10. 테스트 전략

`http` 주입으로 네트워크 없이 전부 검증한다. 실제 응답을 `tests/fixtures/`에 저장해 쓴다.

### `tests/http.test.js`
- 허용목록 밖 호스트 차단
- `http:` 스킴 거부
- 3xx 리다이렉트를 따라가지 않음
- 크기 상한 초과 시 중단
- 타임아웃 → 적절한 오류

### `tests/news-provider.test.js`
- Google News RSS 픽스처 파싱 (CDATA, HTML 엔티티)
- 언론사 RSS 픽스처에서 리드 문단 추출
- `topic` 피드의 키워드 필터링
- 두 종류 피드 병합 후 중복 제거
- 빈 피드·깨진 XML·`403` 응답 처리
- 일부 피드 실패 시 나머지로 진행하고 `degraded` 기록
- 모든 피드 실패 시 오류
- XXE 시도가 무력화됨
- `contentKind`가 올바르게 부여됨
- **정규화 멱등성**: 정규화된 결과를 다시 정규화해도 `cacheKey`가 같다

### `tests/market-provider.test.js`
- Yahoo 픽스처(미국·한국) 파싱, 통화 구분
- CoinGecko 픽스처 파싱
- 이동평균·등락률·변동성 계산 정확성 (알려진 입력에 대한 기대값)
- `chartTrend` 문장 생성
- 데이터 부족(포인트 3개 등) 시 이동평균 생략
- 심볼 해석 4단계 각각

### `tests/research.test.js`
- `/api/research/collect`가 LLM을 호출하지 않음
- 인증 없이 호출 시 `403`
- 반환된 `newsList`가 Phase 1 분석 스키마를 통과함
- 발급된 `confirmToken`으로 `/api/analyze/news`가 바로 성공함
- `contentKind`가 붙은 `newsList`를 분석 스키마가 거부하지 않음
- `collect` 이후 `newsList`를 변조하면 `428`로 막힘
- 시장 데이터 실패 시 뉴스만으로 `200`, `degraded`에 기록
- 모든 뉴스 실패 시 `502`
- 캐시 히트 시 외부 호출이 일어나지 않음
- RSS에 심어진 프롬프트 인젝션 문자열이 데이터로 갇힘

기존 164개 테스트는 전부 통과해야 한다.

---

## 11. 환경변수 추가

```env
# 외부 호출
EXTERNAL_TIMEOUT_MS=10000
MAX_EXTERNAL_RESPONSE_BYTES=2000000
EXTERNAL_ALLOWLIST=news.google.com,feeds.finance.yahoo.com,query1.finance.yahoo.com,api.coingecko.com,www.yna.co.kr,rss.etnews.com

# provider 회로 차단기
PROVIDER_BREAKER_THRESHOLD=3
PROVIDER_BREAKER_COOLDOWN_MS=60000

# 수집 캐시
NEWS_CACHE_TTL_MS=300000
MARKET_CACHE_TTL_MS=60000
SYMBOL_CACHE_TTL_MS=86400000

# 수집 rate limit
RESEARCH_RATE_WINDOW_MS=900000
RESEARCH_RATE_MAX=60
```

---

## 12. 알려진 한계 (문서화 대상)

1. **본문이 제목 또는 리드 문단뿐이다** — 전문 분석이 아니다. `contentKind`로 명시하고 시스템 프롬프트가 추론을 금지한다
2. **Yahoo Finance는 비공식 엔드포인트다** — 예고 없이 바뀔 수 있다. 상용 전환 시 정식 API로 교체 필요
3. **한글 티커 자동 해석은 별칭 사전에 의존한다** — 사전에 없는 회사는 `symbol`을 직접 넣어야 한다
4. **언론사 피드는 검색이 아니라 필터링이다** — 최신 피드에 없는 오래된 기사는 잡히지 않는다
5. **피드는 언제든 죽는다** — 매일경제가 이미 `403`이다. 부분 실패를 정상으로 다루지만 커버리지는 그만큼 준다
6. **RSS 링크는 Google 리다이렉트 URL이다** — 검색 피드의 `url`이 언론사 원문이 아닌 `news.google.com/rss/articles/...` 형태다. 사용자가 클릭하면 원문으로 이동하지만 URL만 보고는 매체를 알 수 없다. `source` 필드로 매체명을 별도 표시한다

---

## 13. 완료 기준

- 기존 164개 테스트 + Phase 2a 신규 테스트 전부 통과
- `lib/` 분리 후에도 `npm start`로 서버가 기동
- 실제 네트워크로 `/api/research/collect` 1회 성공 — 뉴스와 차트가 모두 채워지는지 확인
- 수집된 `newsList`를 `/api/analyze/news`에 그대로 넣어 분석 성공
- 허용목록 밖 호스트 요청이 차단되는 것을 테스트로 확인
- `docs/api.md`·`architecture.md`·`security.md`에 Phase 2a 내용 반영
- PR 생성
