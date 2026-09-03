# Phase 2b — 재무·논문·실험 커넥터 설계

- **작성일**: 2026-09-03
- **상태**: 승인됨
- **범위**: FinancialDataProvider, ResearchPaperProvider, ExperimentDataProvider, 수집 범위 선택, 프롬프트·스키마·출처 타입 확장, 프론트엔드 컴포넌트 3종
- **선행**: Phase 1 (PR #1), Phase 2a (PR #2), Phase 3 (PR #3, `main` 7e70be2)

---

## 1. 실측으로 확정된 소스

설계 전에 후보를 모두 실제 호출해 확인했다. 추정이 아니다.

### 1.1 채택

| 자료 | 소스 | 확인 내용 |
|---|---|---|
| 재무 | `data.sec.gov/api/xbrl/companyconcept` | `HTTP 200`, 지표당 ~42KB. **키·연락처 불필요** (기존 UA로 통과). NVDA 2027 Q2 매출 $96,221,000,000 확인 |
| 논문 | Europe PMC `ebi.ac.uk/europepmc/webservices/rest/search` | `HTTP 200`, 키 불필요. DOI·연도 제공, 초록은 자료에 따라 있고 없음 |
| 논문 | arXiv `export.arxiv.org/api/query` | `HTTP 200` (**https 필수**, http는 301). 초록이 항상 있고 날짜가 깨끗함. STEM 프리프린트 |
| 실험 | ClinicalTrials.gov v2 `clinicaltrials.gov/api/v2/studies` | `HTTP 200`, 키 불필요. 구조화가 가장 좋다 |
| 논문(국내) | KCI `open.kci.go.kr/po/openapi/openApiSearch.kci` | API 활성 확인. **키 필요**(무료). 파라미터 계약은 에코로 확정, 한국어 동작은 §2.2.2에서 검증 |

위 네 소스는 키가 필요 없다. KCI만 키를 쓰며, 없어도 서버는 정상 기동한다.

### 1.2 탈락과 이유

| 소스 | 이유 |
|---|---|
| Yahoo `quoteSummary` | `401 Invalid Crumb` — 쿠키+crumb 인증이 필요하다. 키 불필요 원칙과 맞지 않는다 |
| Crossref | 초록이 5건 중 0건. 날짜 정밀도가 제각각(`[2015]`, `[2009,7]`, `[2021,11,29]`)이고 `[null]`인 경우도 있다. 검색 관련도도 낮았다(`obesity drug trial` → 백과사전 항목, 주간지) |
| Semantic Scholar | 키 없이 `429 Too Many Requests`. 신뢰할 수 없다 |
| RISS | 공개 API 없음 (`/openapi/` → `404`). 검색 페이지는 HTML뿐이고 스크래핑은 이용약관 위반이다 |
| DBpia | 공개 API 없음. 구독 결제 기반이라 로그인 없이는 초록도 나오지 않는다 |
| KISTI ScienceON | API는 살아 있으나(`E4002`) KCI와 역할이 겹친다. 국내 논문 소스를 둘 둘 이유가 없어 KCI 하나로 간다 |
| DART (한국 재무) | 이번 범위에서 제외한다. 아래 주석 참고 |

**DART에 대한 기록.** 처음에는 "키 발급이 필요하다"는 이유로 탈락시켰다. 이제 KCI 키를 쓰기로 했으므로 그 이유는 더 이상 유효하지 않다. 그럼에도 이번 범위에서 빼는 이유는 다르다 — DART는 한계 1번(한국 기업 재무 부재)을 푸는 별개의 작업이고, 재무제표 XBRL 파싱은 논문 커넥터와 성격이 다르다. **Phase 2c 후보로 남긴다.** 이번 Phase의 범위를 지키기 위한 결정이지 기술적 탈락이 아니다.

### 1.3 SEC 관련 두 가지 발견

**`companyfacts`가 아니라 `companyconcept`를 쓴다.** `companyfacts`는 한 회사 전체를 주는데 NVDA가 **4,092,966바이트**로 우리 응답 상한(`MAX_EXTERNAL_RESPONSE_BYTES` 2MB)을 넘는다. `companyconcept`는 지표당 42KB다.

**티커→CIK 매핑 파일을 fetch하지 않는다.** `www.sec.gov/files/company_tickers.json`은 일반 UA에 `403`을 반환하고 연락처가 든 User-Agent를 요구한다. 그 경로를 쓰면 외부에 연락처를 보내게 되므로, CIK를 별칭 사전에 직접 넣는다. `data.sec.gov/api/xbrl/*`는 기존 UA로 `200`이다.

### 1.4 ClinicalTrials.gov가 요구사항과 맞는 지점

원본 요구사항 §9.4가 요구하는 항목이 대부분 구조화되어 있다.

| 요구 항목 | 응답 경로 | 실측값 |
|---|---|---|
| 실험명 | `identificationModule.briefTitle` | "Effect of a Soluble Fibre Blend…" |
| 수행기관 | `identificationModule.organization.fullName` | "Canadian Center for Functional Medicine" |
| 연구 단계 | `designModule.phases` | `["PHASE2"]` |
| 표본 수 | `designModule.enrollmentInfo` | `{ count: 138, type: "ACTUAL" }` |
| 연구 대상 | `conditionsModule.conditions` | `["People Who Are Overweight or Obesity"]` |
| 발표일 | `statusModule.startDateStruct.date` | `"2008-09"` |
| 상태 | `statusModule.overallStatus` | `"COMPLETED"` |

---

### 1.5 한국어 질의는 조용히 오염된다 — 설계를 바꾼 발견

영어 소스에 한국어 검색어를 넣으면 0건이 나올 것으로 예상했다. 실측 결과는 달랐다.

| 질의 | hitCount | 1위 결과 |
|---|---|---|
| `비만 치료제` | 106 | Some novel concepts of interval-valued q-rung orthopair fuzzy sets |
| `배터리 재활용` | 4 | The Activity of Plant Crude Extracts against *Schistosoma* |
| `obesity drug` (대조) | 449,475 | Shifting the goalposts in obesity drug development. |

한글 토큰이 무시되고 **무관한 실존 논문**이 돌아온다. arXiv와 ClinicalTrials.gov는 0건이라 오히려 안전하다.

이것이 위험한 이유는 기존 방어를 전부 통과하기 때문이다.

- URL이 실제 존재하므로 `stripFabricatedUrls`에 걸리지 않는다
- 논문이 실존하므로 `available: '자료 부족'`이 붙지 않는다
- 결과적으로 LLM은 "비만 치료제 관련 연구"라며 퍼지집합 논문을 근거로 제시한다

**환각 없이 환각과 같은 결과가 나온다.** 원본 요구사항 §12가 금지하는 상태다.

따라서 **언어 가드를 필수로 넣는다.** 선택 사항이 아니라 정확성 결함의 수정이다.

---

## 2. Provider 구조

Phase 2a의 패턴을 그대로 따른다. `http` 주입, provider별 회로 차단기, TTL 캐시, 부분 실패 허용.

```js
createFinancialProvider({ http, cache, clock, makeBreaker })
  → fetch({ symbol }) → Promise<FinancialResult | null>

createResearchProvider({ http, cache, clock, makeBreaker })
  → search({ query, limit }) → Promise<{ items, degraded, sourcesUsed }>

createExperimentProvider({ http, cache, clock, makeBreaker })
  → search({ query, limit }) → Promise<{ items, degraded }>
```

### 2.1 재무 — 심볼 기반

```
FinancialResult = {
  symbol, cik, entityName,
  metrics: [{ concept, label, value, unit, periodStart, periodEnd, fiscalYear, fiscalPeriod, form, filed }],
  degraded: [{ concept, reason }],
}
```

수집할 개념은 코드 상수로 고정한다. 원본 요구사항 §9.2의 항목에 대응한다.

| 요구 항목 | XBRL 개념 |
|---|---|
| 매출 | `Revenues`, 없으면 `RevenueFromContractWithCustomerExcludingAssessedTax` |
| 영업이익 | `OperatingIncomeLoss` |
| 순이익 | `NetIncomeLoss` |
| EPS | `EarningsPerShareDiluted` |
| 자산 | `Assets` |
| 부채 | `Liabilities` |

**부채비율·성장률은 코드가 계산한다.** 부채비율 = 부채/자산, 성장률 = 최근 분기 대비 전년 동기. LLM에게 산수를 맡기지 않는다 — Phase 2a에서 차트 추세를 코드로 계산한 것과 같은 원칙이다.

각 지표는 **최근 값 하나**만 싣는다. 280개 전체를 넣으면 프롬프트가 터진다. `fiscalYear`·`fiscalPeriod`·`form`을 함께 실어 **기준 기간을 명시**한다(원본 §12의 12번 원칙).

개념이 없으면(회사마다 쓰는 태그가 다르다) `degraded`에 기록하고 그 지표만 뺀다.

### 2.2 논문 — 검색어 기반, 소스 레지스트리

뉴스 피드와 같은 구조다. 소스마다 응답 형식이 다르므로 각자 파서를 두되 반환 형태를 통일한다.

```
ResearchItem = {
  title, abstract, authors, venue, doi, url,
  publishedAt,          // ISO 8601. 연도만 있으면 YYYY-01-01
  datePrecision,        // 'day' | 'month' | 'year' — 연도만 있는 것을 일자처럼 쓰지 않기 위함
  peerReviewed,         // 'peer-reviewed' | 'preprint' | 'unknown'
  sourceName,           // 'Europe PMC' | 'arXiv' | 'KCI'
  language,             // 'ko' | 'en' — 표시와 필터 양쪽에 쓴다
}
```

`peerReviewed`가 중요하다. **arXiv는 프리프린트라 동료 심사를 거치지 않았다.** 원본 요구사항 §12의 11번 원칙이 "전문가 검증 여부"를 구분하라고 요구한다.

`datePrecision`도 중요하다. Europe PMC는 `pubYear`만 주는 경우가 많은데, 이를 `2026-01-01`로 저장하고 정밀도를 표시하지 않으면 "1월 발표"로 오독된다.

#### 2.2.1 언어 가드

검색어에 한글이 있으면 영어 전용 소스를 **호출하지 않는다**. 호출한 뒤 걸러내는 것이 아니라 요청 자체를 보내지 않는다. 돌아온 결과가 무관한지 판별할 신뢰할 만한 기준이 없기 때문이다.

```
hasHangul(query) = /[가-힣]/.test(query)

hasHangul  → KCI만 호출
!hasHangul → Europe PMC + arXiv + ClinicalTrials.gov 호출
```

판정 근거를 `collected.languageRoute`로 내려보내 화면에 이유를 적는다. 결과가 비었을 때 사용자가 이유를 알아야 한다.

실험(ClinicalTrials.gov)도 같은 규칙을 적용한다. 한국어 질의에는 국내 대체 소스를 찾지 못했으므로 `available: '자료 부족'`으로 나가고 사유를 함께 싣는다.

#### 2.2.2 KCI — 국내 등재 학술지

RISS는 공개 API가 없고(`/openapi/` → 404), DBpia는 구독 기반이라 초록조차 로그인을 요구한다. 두 곳 모두 HTML 스크래핑은 이용약관 위반이며 얻을 것도 없다. 국내 논문의 정당한 경로는 한국연구재단 KCI OpenAPI다.

```
GET https://open.kci.go.kr/po/openapi/openApiSearch.kci
  ?apiCode=articleSearch&key=<KCI_API_KEY>&title=<질의>&displayCount=10&page=1
```

키 없이 파라미터 에코로 확정한 계약이다.

| 항목 | 확정된 값 |
|---|---|
| 허용 파라미터 | `apiCode` `key` `title` `author` `journal` `keyword` `year` `page` `displayCount` |
| **미지원** | `abstract` — 에코에서 탈락한다. **초록 검색 불가**, 제목·키워드로만 검색한다 |
| `displayCount` | 하한 10, 상한 100 (5→10, 200→100으로 보정됨) |
| 응답 형식 | XML. 기존 `fast-xml-parser`를 그대로 쓴다 |
| 오류 표현 | `<resultMsg>`가 **여러 개** 누적된다. 배열로 받아야 한다 |

**오류 판정은 HTTP 상태코드가 아니라 본문으로 한다.** 같은 계열인 KISTI ScienceON은 `HTTP 200`에 본문 `statusCode 400`을 실어 보낸다. 상태코드만 보면 오류를 성공으로 처리한다.

##### 키 발급 후 최초로 검증할 것

`key=test`로 받은 에코에서 `title=배터리`가 `U+FFFD` 연속으로 깨져 돌아왔다. UTF-8로 보내든 EUC-KR로 보내든 **바이트 단위로 동일하게 깨졌다**. 서로 다른 입력이 같은 결과를 냈으므로 이는 인코딩 단서가 아니라 에코 필드 자체의 결함이다. 키가 없어 실제 검색이 실행되지 않으니 여기서는 판별할 수 없다.

**따라서 한국어 질의가 KCI에서 동작한다고 가정하지 않는다.** 키 발급 직후 다음 순서로 확인하고 결과에 맞춰 구현을 확정한다.

1. `title=battery` (ASCII)로 결과가 오는지 — API 자체의 동작 확인
2. `title=배터리`를 UTF-8 퍼센트 인코딩으로 — 결과가 오면 그대로 간다
3. 0건이면 EUC-KR 퍼센트 인코딩(`%B9%E8%C5%CD%B8%AE`)으로 재시도
4. 둘 다 실패하면 한계로 문서화하고 언어 가드에서 KCI도 제외한다

이 검증은 구현 계획의 첫 태스크다. 결과에 따라 이후 태스크의 내용이 달라진다.

##### KCI는 IP 허용목록을 쓴다

키 신청서가 **신청 IP**를 요구한다. 등록된 공인 IP에서 온 요청만 받는다. 이는 실패 모드를 하나 늘린다.

| 상태 | 처리 |
|---|---|
| 키 없음 | 호출하지 않는다. "국내 논문 검색에는 KCI API 키가 필요합니다" |
| 키 있음 + IP 일치 | 정상 |
| **키 있음 + IP 불일치** | 호출은 나가고 거부당한다. **전용 문구가 필요하다** |

**세 번째를 일반 오류로 뭉뚱그리면 안 된다.** 가정용 인터넷은 대개 유동 IP라 공유기 재부팅이나 임대 갱신만으로 바뀐다. 그날 사용자는 키도 코드도 건드리지 않았는데 국내 논문만 조용히 사라진 상황을 맞는다. 원인을 짚어주지 않으면 찾을 방법이 없다.

KCI 응답에서 IP 거부를 식별해 다음을 표시한다.

> 등록된 IP와 현재 IP가 다릅니다. open.kci.go.kr에서 현재 IP를 다시 등록해 주세요.

현재 IP를 함께 보여준다. 사용자가 재등록 화면에 그대로 옮겨 적을 수 있어야 한다. 조회는 서버가 아는 값이 없으므로 실패 응답 본문에 KCI가 실어 보내는 값이 있으면 쓰고, 없으면 문구만 표시한다. **IP 확인을 위해 외부 서비스를 호출하지 않는다** — 허용목록 원칙을 깨고 얻는 것이 적다.

거부 응답의 정확한 형태는 키가 없어 확인하지 못했다. §2.2.2 검증 단계에서 함께 확인한다.

배포 시에도 같은 문제가 생긴다. 서버 IP를 별도로 등록해야 한다.

##### 키가 없을 때

`KCI_API_KEY`가 비어 있으면 KCI를 호출하지 않는다. 한국어 질의의 논문 결과는 `available: '자료 부족'`이 되고 사유로 "국내 논문 검색에는 KCI API 키가 필요합니다"를 싣는다. **키 없이도 서버는 정상 기동하고 뉴스·차트·재무는 그대로 동작한다.**

### 2.3 실험 — 검색어 기반

```
ExperimentItem = {
  nctId, title, organization, url,
  phase,                // 'PHASE2' 등. 없으면 null
  status,               // 'COMPLETED' 등
  enrollmentCount,      // 숫자. 없으면 null
  enrollmentType,       // 'ACTUAL' | 'ESTIMATED' — 실제 등록 수인지 목표치인지
  conditions,           // 문자열 배열
  startDate,            // 'YYYY-MM' 형태도 온다
  hasResults,           // 결과가 등록됐는지
}
```

`enrollmentType`을 반드시 싣는다. `ESTIMATED`는 아직 모집 목표일 뿐 실제 표본 수가 아니다. 이를 구분하지 않으면 "138명을 대상으로 한 연구"라는 잘못된 서술이 나온다.

---

## 3. 수집 범위 선택

### 3.1 요청 필드

`/api/research/collect`에 `include` 배열을 추가한다.

```json
{
  "query": "비만 치료제",
  "symbol": "LLY",
  "include": ["news", "market", "research", "experiments"]
}
```

| 값 | 의미 |
|---|---|
| `news` | 뉴스 수집 (Phase 2a) |
| `market` | 시장 차트 (Phase 2a) |
| `financial` | SEC 재무지표 |
| `research` | 논문 |
| `experiments` | 임상·실험 |

**기본값은 `["news", "market"]`이다.** `include`를 보내지 않으면 Phase 2a와 완전히 동일하게 동작하고 비용도 그대로다. 하위 호환이 유지된다.

`news`는 항상 포함된다 — 빼면 분석이 성립하지 않는다. 요청에 없어도 강제로 넣는다.

### 3.2 병렬 수집

선택된 provider만 호출한다. Phase 2a처럼 `Promise.all`로 병렬 실행하고, 하나가 실패해도 나머지로 진행한다.

```js
const [news, market, financial, research, experiments] = await Promise.all([
  wanted('news')        ? newsProvider.search(...)       : null,
  wanted('market')      ? marketProvider.fetch(...)      : null,
  wanted('financial')   ? financialProvider.fetch(...)   : null,
  wanted('research')    ? researchProvider.search(...)   : null,
  wanted('experiments') ? experimentProvider.search(...) : null,
]);
```

### 3.3 응답

기존 응답에 세 필드가 추가된다. 요청하지 않았거나 실패했으면 `undefined`다.

```json
{
  "newsList": [ ],
  "marketData": { },
  "marketSeries": { },
  "financial": { "symbol", "entityName", "metrics", "derived" },
  "research": [ ],
  "experiments": [ ],
  "collected": {
    "included": ["news", "market", "research"],
    "researchCount": 5,
    "experimentCount": 3,
    "financialMetricCount": 6,
    "degraded": [ ]
  }
}
```

---

## 4. 프롬프트·스키마 확장

여기가 Phase 2b의 핵심 변경이다. Phase 2a·3은 분석 엔진을 거의 건드리지 않았지만 이번엔 불가피하다.

### 4.1 프롬프트 — 비어 있던 구획을 채운다

`lib/prompt.js`에 이미 세 구획이 있고 지금은 고정 문구가 들어 있다.

```
[기업 재무지표]
자료 부족 — 이번 요청에 재무지표가 포함되지 않았습니다.
```

자료가 있으면 그 자리를 채우고, 없으면 지금 문구를 유지한다.

**재무 서술 형식** — 기준 기간을 값과 붙여 쓴다.

```
- 매출 (Revenues): 96,221,000,000 USD [FY2027 Q2, 10-Q, 2026-08-26 제출]
- 부채비율 (계산값): 41.2% = 부채 / 자산
```

**논문 서술 형식** — 검증 상태와 날짜 정밀도를 명시한다.

```
논문 1
- 제목: ...
- 출처: Europe PMC · Nature Medicine
- 발표: 2026 (연도만 확인됨)
- 검증: 동료 심사 완료
- DOI: 10.1038/...
- 초록: ...
```

**실험 서술 형식** — 표본 수의 성격을 함께 적는다.

```
실험 1
- 실험명: ...
- 수행기관: Canadian Center for Functional Medicine
- 연구 단계: PHASE2
- 표본 수: 138명 (실제 등록)
- 대상: People Who Are Overweight or Obesity
- 상태: COMPLETED · 결과 등록 안 됨
```

### 4.2 시스템 프롬프트에 한 줄 추가

`[자료 범위 규칙]` 블록에 넣는다.

> 논문 자료에는 초록만 제공됩니다. 초록에 명시되지 않은 표본 수, 연구 단계, 연구 한계, 통계적 유의성을 추정하거나 지어내지 마세요. 그런 항목이 필요하면 "자료 부족"이라고 적으세요.
> 임상시험 자료의 표본 수가 "목표치"로 표시된 경우, 이미 그만큼 모집된 것처럼 서술하지 마세요.

이것이 Phase 2b에서 가장 중요한 방어다. **논문 메타데이터에는 표본 수·연구 단계가 없다.** 초록에서 추론하게 두면 모델이 숫자를 만들어낸다.

### 4.3 응답 스키마 — 3개 필드 추가

```js
financialSummary: strObj({
  available: { type: 'string', enum: ['자료 있음', '자료 부족'] },
  periodBasis: { type: 'string' },   // "FY2027 Q2 기준" 또는 "자료 부족"
  notes: { type: 'string' },
}),
researchSummary: strObj({
  available: { type: 'string', enum: ['자료 있음', '자료 부족'] },
  maturity: { type: 'string' },      // 동료 심사 여부, 연구 성숙도
  notes: { type: 'string' },
}),
experimentSummary: strObj({
  available: { type: 'string', enum: ['자료 있음', '자료 부족'] },
  evidenceLevel: { type: 'string' }, // 연구 단계와 표본 수에 근거한 서술
  notes: { type: 'string' },
}),
```

**`available`을 열거형으로 두는 것이 핵심이다.** 자료를 주지 않았는데 모델이 서술하면 `자료 부족`을 골라야 하고, 스키마가 그 선택을 강제한다. 자유 문자열이면 "재무지표가 양호합니다" 같은 근거 없는 서술이 나온다.

`strict: true` 규칙상 모든 속성이 `required`에 있어야 하므로 세 필드 모두 필수다. 자료가 없으면 `available: '자료 부족'`으로 채워진다.

### 4.4 출처 타입

`buildSources`가 `type: 'news'`로 고정되어 있다. 항목이 자기 타입을 갖도록 바꾼다.

```js
export function buildSources(items, collectedAt) {
  return items.map((item) => ({
    sourceId: item.sourceId,
    title: item.title,
    source: item.source,
    url: item.url,
    publishedAt: item.publishedAt,
    collectedAt,
    type: item.type ?? 'news',   // 'news' | 'financial' | 'research' | 'experiment'
    relevance: item.relevance,
  }));
}
```

**출처 ID 부여 범위**: 뉴스만 `S1..Sn`을 받는다. 논문·실험은 `P1..Pn`·`T1..Tn`을 받아 LLM이 인용할 때 종류가 드러나게 한다. 재무는 SEC 제출서류 하나로 묶어 `F1`을 준다.

URL 화이트리스트에는 **모든 종류의 URL**이 들어간다. `stripFabricatedUrls`가 논문 DOI 링크나 ClinicalTrials 링크를 위조로 오판하면 안 된다.

### 4.5 분석 요청 스키마와 확인 토큰 — 놓치면 방어가 뚫린다

`/api/analyze/news`가 새 자료를 받아야 하므로 `buildAnalyzeSchema`를 확장한다.

```js
return z.strictObject({
  newsList: z.array(article).min(1).max(config.maxNewsItems),
  marketData: marketData.optional(),
  analysisPeriod: z.string().max(200).optional(),
  // Phase 2b
  financial: financialSchema.optional(),
  research: z.array(researchSchema).max(config.maxResearchItems).optional(),
  experiments: z.array(experimentSchema).max(config.maxExperimentItems).optional(),
});
```

**여기서 `cacheKey`를 함께 고치지 않으면 Phase 2a의 방어가 뚫린다.**

현재 `cacheKey`는 양쪽에서 이렇게 계산된다.

```js
hashRequest({ items, marketData, analysisPeriod, model: config.openaiModel })
```

논문·실험·재무를 넣지 않으면 다음 우회가 성립한다.

1. `include: ["news"]`로 수집 → 뉴스만으로 견적을 받고 확인 토큰 발급
2. 그 토큰을 그대로 쓰면서 `research` 20건, `experiments` 20건을 본문에 실어 `/api/analyze/news` 호출
3. `cacheKey`가 뉴스·시장 데이터만 보므로 **일치한다** → 승인이 통과된다
4. 승인받은 것보다 훨씬 큰 프롬프트로 LLM이 호출된다

작은 자료로 견적을 받고 큰 자료로 실행하는 것 — Phase 2a가 확인 토큰으로 막으려던 바로 그 공격이다.

**수정**: 양쪽 모두 새 자료를 키에 포함한다.

```js
hashRequest({
  items, marketData, analysisPeriod,
  financial, research, experiments,
  model: config.openaiModel,
})
```

`collect`와 `analyze`가 **똑같은 객체를 똑같은 순서로** 넘겨야 한다. `hashRequest`가 키를 정렬해 직렬화하므로 순서 자체는 문제되지 않지만, 한쪽에만 필드가 있으면 해시가 달라진다.

또한 정규화 멱등성이 새 자료에도 성립해야 한다. 논문·실험은 정규화하지 않고 provider가 준 형태를 그대로 쓰므로 자연히 멱등이다. **재무의 계산값(부채비율·성장률)은 `collect`에서 한 번만 계산해 실어 보내고 `analyze`는 다시 계산하지 않는다** — 부동소수점 재계산이 미세하게 달라지면 해시가 어긋난다.

이를 테스트로 고정한다.

- 뉴스만으로 견적 → 논문을 추가해 실행하면 `428`
- 논문 포함으로 견적 → 그대로 실행하면 `200`
- 재무 계산값을 클라이언트가 바꾸면 `428`

---

## 5. 심볼 별칭에 CIK 추가

`SYMBOL_ALIASES`의 미국 주식 항목에 `cik`를 넣는다.

```js
엔비디아: { symbol: 'NVDA', assetType: 'stock', name: '엔비디아', cik: '0001045810' },
삼성전자: { symbol: '005930.KS', assetType: 'stock', name: '삼성전자' },   // cik 없음
```

`cik`가 없으면 재무 provider가 `null`을 반환하고 `degraded`에 사유를 남긴다. 한국 종목과 사전에 없는 회사가 여기 해당한다.

요청에 `symbol`을 직접 넣은 경우에도 CIK를 모르면 재무를 가져올 수 없다. 이는 문서화되는 한계다.

---

## 6. 프론트엔드

### 6.1 컴포넌트 3종 추가

| 컴포넌트 | 표시 내용 |
|---|---|
| `FinancialMetrics` | 지표 표. 각 값에 **기준 기간과 제출 서류**를 함께. 계산값(부채비율·성장률)은 "계산값"으로 표시 |
| `ResearchList` | 논문 카드. **동료 심사 / 프리프린트 배지**, 날짜 정밀도가 연도뿐이면 "2026년" 형태로 |
| `ExperimentStatus` | 임상시험 카드. 단계·상태·표본 수. **표본 수가 목표치면 "목표"로 표시** |

이로써 원본 요구사항 §16의 12개 컴포넌트가 완성된다.

### 6.2 검색 화면 — 범위 체크박스

체크박스 5개를 둔다. `news`는 항상 켜져 있고 끌 수 없다(비활성 체크박스).

각 항목 옆에 한 줄 설명을 둔다.

- 재무지표 — 미국 상장사만
- 논문 — 초록까지. 표본 수·연구 단계는 제공되지 않음
- 실험·임상 — ClinicalTrials.gov

**선택이 비용에 미치는 영향을 알린다.** 체크를 늘리면 검토 화면의 예상 비용이 올라가고, 그것이 승인 전에 보인다.

### 6.3 결과 화면

검토·보고서 양쪽에 세 섹션을 추가한다. 원본 §16의 11개 섹션이 완성된다.

**비어 있을 때 이유를 반드시 적는다.** 자료가 없는 것과 못 가져온 것은 사용자에게 완전히 다른 정보다. `languageRoute`와 `degraded`를 근거로 다음을 구분해 표시한다.

| 상황 | 화면 문구 |
|---|---|
| 한국어 질의 + KCI 키 없음 | 국내 논문 검색에는 KCI API 키가 필요합니다 |
| 한국어 질의 + 실험 | 임상시험 자료는 영어 검색어에서만 제공됩니다 |
| 한국어 질의 + 영어 소스 생략 | 해외 논문 DB는 영어 검색어에서만 동작합니다 |
| 검색은 됐으나 0건 | 검색 결과가 없습니다 |
| 호출 실패 | 일시적으로 가져오지 못했습니다 |

빈 섹션을 근거 없이 감추지 않는다. 감추면 사용자는 그 자료가 존재하지 않는다고 오해한다.

---

## 7. 오류 처리

기존 표에 추가한다.

| 상황 | 처리 |
|---|---|
| 재무: CIK 없음 | `financial` 없이 진행. `degraded`에 "미국 상장사가 아니거나 사전에 없는 종목입니다" |
| 재무: 일부 개념 없음 | 있는 지표만. 없는 것은 `financial.degraded`에 개념명 기록 |
| 논문: 한 소스 실패 | 나머지 소스로 진행 |
| 논문: 모든 소스 실패 | `research` 없이 진행. 뉴스가 있으면 분석은 계속된다 |
| 실험: 실패 | `experiments` 없이 진행 |
| 뉴스: 전부 실패 | `502 COLLECTION_FAILED` (기존) |

**뉴스를 제외한 모든 provider의 실패는 치명적이지 않다.** 자료가 줄 뿐 분석은 성립한다.

---

## 8. 테스트 전략

`http` 주입 + `tests/fixtures/`의 실제 응답. 네트워크 없이 검증한다.

### 픽스처 (실제 응답에서 축약해 저장 완료)

- `sec-concept-revenues.json` — SEC companyconcept (최근 8개 항목만)
- `europepmc-battery.json` — Europe PMC 검색 결과
- `arxiv-battery.xml` — arXiv Atom 응답
- `clinicaltrials-obesity.json` — ClinicalTrials.gov v2 (2건)
- `kci-error-nokey.xml` — KCI 오류 응답. `<resultMsg>` 다중 누적 (저장 완료)
- `kci-articles.xml` — KCI 정상 검색 결과. **키 발급 후 저장한다.** 그전까지 이 픽스처를 쓰는 테스트는 `skip`

### 재무 provider

- SEC 응답에서 최근 값 하나를 뽑는다
- `fiscalYear`·`fiscalPeriod`·`form`이 함께 실린다
- 부채비율·성장률 계산이 알려진 입력에 정확하다
- 개념이 없으면 그 지표만 빠지고 `degraded`에 기록된다
- CIK가 없으면 호출하지 않고 `null`
- 응답이 깨져도 예외를 던지지 않는다

### 논문 provider

- Europe PMC 픽스처 파싱 — DOI·연도·초록
- arXiv 픽스처 파싱 — 초록·저자·링크
- **arXiv 항목은 `peerReviewed: 'preprint'`**
- **연도만 있으면 `datePrecision: 'year'`**
- 두 소스 병합 후 중복 제거(DOI 기준)
- 한 소스 실패 시 나머지로 진행

### 언어 가드 (§2.2.1)

fetch 스텁으로 **나간 요청 URL을 기록해** 검증한다. 결과를 거르는 게 아니라 호출 자체를 막는 설계이므로, 호출 여부가 곧 테스트 대상이다.

- `'배터리 재활용'` → `ebi.ac.uk`·`arxiv.org`·`clinicaltrials.gov`로 요청이 **0건**
- `'battery recycling'` → 세 호스트로 요청이 나간다
- `'삼성 battery'` (혼합) → 한글이 있으므로 영어 소스를 막는다
- `collected.languageRoute`가 판정 근거를 담는다
- 한국어 질의에서 실험이 `available: '자료 부족'`이고 사유 문자열이 붙는다

### KCI provider (§2.2.2)

- 오류 픽스처에서 `<resultMsg>` **여러 개를 배열로** 읽는다
- `resultMsg`에 오류가 있으면 **HTTP 200이어도 실패로 판정한다**
- `KCI_API_KEY`가 비면 호출하지 않고 사유가 담긴 `자료 부족`을 돌려준다
- 키가 비어도 `loadConfig`가 통과하고 서버가 기동한다
- `displayCount`를 10~100으로 강제한다
- API 키가 로그에 남지 않는다 (`redact` 확인)

### 실험 provider

- ClinicalTrials 픽스처 파싱 — 단계·표본 수·기관·상태
- **`enrollmentType: 'ESTIMATED'`가 보존된다**
- 단계나 표본 수가 없는 연구도 처리된다

### 프롬프트·스키마

- 자료가 있으면 프롬프트 구획이 채워진다
- 자료가 없으면 "자료 부족" 문구가 유지된다
- **시스템 프롬프트에 추정 금지 규칙이 있다**
- 스키마의 `available`이 열거형이다
- 논문 초록에 없는 숫자를 프롬프트가 요구하지 않는다

### 수집 엔드포인트

- `include`를 보내지 않으면 뉴스+시장만 수집된다 (하위 호환)
- 선택하지 않은 provider는 **호출되지 않는다** (http 호출 카운터로 확인)
- `news`는 요청에서 빼도 강제로 포함된다
- 자료가 늘면 `estimatedCostUsd`가 올라간다
- **확인 토큰이 여전히 통한다** — 자료가 늘어도 `cacheKey` 계산이 일관되다
- **견적 후 자료를 추가하면 `428`** — §4.5의 우회가 막힌다
- 재무 계산값을 변조하면 `428`
- 출처 배열에 `research`·`experiment` 타입이 섞여 나온다
- URL 화이트리스트가 논문·실험 링크를 위조로 판정하지 않는다

### 프론트엔드

- `FinancialMetrics`가 기준 기간을 표시한다
- `ResearchList`가 프리프린트 배지를 표시한다
- `ExperimentStatus`가 목표치 표본 수를 "목표"로 표시한다
- 범위 체크박스가 요청의 `include`에 반영된다
- `news` 체크박스는 끌 수 없다

기존 379개 테스트는 전부 통과해야 한다.

---

## 9. 환경변수 추가

```env
# 수집 캐시 (Phase 2b)
FINANCIAL_CACHE_TTL_MS=86400000
RESEARCH_CACHE_TTL_MS=3600000
EXPERIMENT_CACHE_TTL_MS=3600000

# 수집 개수 상한
MAX_RESEARCH_ITEMS=5
MAX_EXPERIMENT_ITEMS=5

# 국내 논문 (선택). 비우면 한국어 질의의 논문이 '자료 부족'으로 나간다
KCI_API_KEY=
```

재무 캐시가 24시간인 이유: 분기 실적은 하루에 여러 번 바뀌지 않는다. 논문·실험은 1시간.

허용목록에 호스트 3개를 추가한다.

```
data.sec.gov, www.ebi.ac.uk, export.arxiv.org, clinicaltrials.gov, open.kci.go.kr
```

---

## 10. 알려진 한계

1. **한국 기업 재무지표를 제공하지 않는다.** SEC EDGAR는 미국 상장사만 다룬다. 삼성전자가 SEC 티커 목록에 없음을 확인했다. 뉴스·차트는 한국 종목도 그대로 동작한다. DART를 쓰려면 키 발급이 필요하다
2. **논문의 연구 단계·표본 수·한계가 자료 부족으로 나간다.** Europe PMC·arXiv 메타데이터에 없다. 초록에서 추론하면 없는 숫자가 생기므로 하지 않는다. 임상시험은 구조화돼 있어 실제 값을 쓴다
3. **CIK를 별칭 사전에 수동으로 넣는다.** 사전에 없는 미국 기업은 재무가 나오지 않는다. 티커 매핑 파일은 연락처 UA를 요구해 쓰지 않는다
4. **arXiv는 프리프린트다.** 동료 심사를 거치지 않았다. `peerReviewed` 필드로 구분하지만 자료 자체의 성격은 바뀌지 않는다
5. **Europe PMC 초록이 일관되지 않다.** 뉴스성 기사(Nature·BMJ 논평 등)는 초록이 없다
6. **KCI는 초록으로 검색할 수 없다.** 허용 파라미터에 `abstract`가 없다. 제목·키워드에 검색어가 없는 논문은 찾지 못한다
7. **한국어 질의에는 임상시험 자료가 없다.** ClinicalTrials.gov는 영어 전용이고 국내 대체 소스를 찾지 못했다. 언어 가드가 호출을 막고 사유를 표시한다
8. **KCI는 IP 허용목록을 쓴다.** 등록한 공인 IP에서만 호출된다. 가정용 유동 IP는 예고 없이 바뀌므로 국내 논문이 갑자기 끊길 수 있다. 전용 오류 문구로 원인을 알린다
9. **KCI 키가 없으면 한국어 질의의 논문이 비어 나간다.** 키는 사용자가 open.kci.go.kr에서 직접 발급한다. 서버 기동과 다른 기능에는 영향이 없다
10. **자료를 늘리면 비용이 오른다.** 체크박스로 고르게 했고 예상 비용이 승인 전에 보이지만, 전부 켜면 프롬프트가 기존의 두세 배가 된다

---

## 11. 완료 기준

- 기존 379개 테스트 + Phase 2b 신규 테스트 전부 통과
- 실제 네트워크로 `include`에 5종을 모두 넣어 수집 1회 성공
- 수집 결과로 분석까지 진행되고 확인 토큰이 통한다
- 브라우저에서 세 섹션이 표시되고 배지·기준 기간이 보인다
- **`include`를 보내지 않으면 Phase 2a와 동일하게 동작한다**
- **뉴스만으로 견적받고 논문을 추가해 실행하면 `428`로 막힌다** (§4.5)
- **한국어 검색어로 수집하면 Europe PMC·arXiv·ClinicalTrials로 요청이 나가지 않는다** (§2.2.1)
- **`KCI_API_KEY`가 비어도 서버가 기동하고 뉴스·차트·재무가 동작한다**
- KCI 키로 한국어 질의 1회 성공, 또는 §2.2.2의 검증 4단계 결과를 한계로 문서화
- **IP 불일치가 일반 오류가 아닌 전용 문구로 표시된다**
- `docs/api.md`·`architecture.md`·`security.md`·`README.md` 갱신
- PR 생성
