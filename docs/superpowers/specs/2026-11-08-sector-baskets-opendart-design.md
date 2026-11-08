# 분야 묶음·회사 자동 해석·OpenDART 재무 설계

- 작성일: 2026-11-08
- 브랜치: `feature/sector-baskets-opendart`
- 상태: 설계 승인됨, 구현 계획 전

## 1. 배경

Render 운영 사이트에서 "반도체", "AI"로 검색하면 시장·재무 영역이 "데이터 없음"으로 나온다.
서버 오류가 아니라 설계상의 한계다. 원인은 세 가지다.

1. 검색어를 종목으로 바꾸는 방법이 `lib/providers/aliases.js`의 회사명 사전(약 40개)뿐이다.
   분야 검색어는 어떤 종목으로도 해석되지 않는다. 영문 검색어는 Yahoo 검색으로 넘어가지만
   Render에서 Yahoo는 막혀 있다.
2. 재무 출처가 SEC EDGAR뿐이어서 한국 회사는 종목을 찾아도 재무가 없다.
3. `lookupAlias`가 부분 문자열로 일치를 본다. 그래서 "메타버스 시장"이 META로 해석된다.

로컬 재현 결과(`lookupAlias`):

| 검색어 | 결과 |
|---|---|
| 반도체 / AI / ai 반도체 전망 / 반도체 업황 | null |
| 엔비디아 AI 반도체 | NVDA, CIK 있음 |
| 삼성전자 반도체 | 005930.KS, CIK 없음 |
| 메타버스 시장 | META (오탐) |

## 2. 목표와 범위

**목표**

- 분야 검색어에 대해 그 분야 대표 종목 묶음(최대 4개)의 시세와 재무를 보여 주고, 묶음 전체를 비교하는 분석을 만든다.
- 회사명·티커 해석을 SEC·OpenDART의 공식 목록으로 자동화해, 사전에 없는 상장사도 시세와 재무가 나오게 한다.
- 한국 상장사 재무를 OpenDART로 가져온다.
- "메타버스"→META 같은 부분 일치 오탐을 없앤다.

**범위 밖 (이번에 하지 않음. 후속 후보로만 기록)**

- 사전에 없는 분야의 자동 인식(LLM 사용 시 비용과 티커 위조 위험이 있다)
- 묶음 종목 수 4개 초과
- 분야 사전 편집 화면
- 시장 데이터 출처 ID(`M1…`)

## 3. 분야 사전

검색어에 회사명과 분야가 함께 있으면 **회사가 우선**한다. "삼성전자 반도체"는 삼성전자 하나다.
분야 키워드만 있을 때 묶음을 쓴다.

| 분야 | 인식 키워드 | 대표 종목 |
|---|---|---|
| 반도체 | 반도체, semiconductor, 칩 | NVDA, TSM, 005930.KS(삼성전자), 000660.KS(SK하이닉스) |
| AI | ai, 인공지능, 생성형 | NVDA, MSFT, GOOGL, 035420.KS(NAVER) |
| 2차전지 | 2차전지, 이차전지, 배터리 | 373220.KS(LG에너지솔루션), TSLA, 006400.KS(삼성SDI), 247540.KQ(에코프로비엠) |
| 자동차 | 자동차, 전기차, ev | TSLA, 005380.KS(현대차), 000270.KS(기아), GM |
| 바이오 | 바이오, 제약 | 068270.KS(셀트리온), 207940.KS(삼성바이오로직스), LLY, AMGN |
| 빅테크·플랫폼 | 빅테크, 플랫폼 | AAPL, AMZN, META, 035720.KS(카카오) |
| 코인 | 코인, 암호화폐, crypto | bitcoin, ethereum, solana, ripple |

자동차의 GM, 바이오의 LLY·AMGN은 승인 당시 "(미국 n종)"으로 비워 둔 자리를 채운 값이다.

## 4. 구성 요소

### 새 모듈

| 모듈 | 책임 |
|---|---|
| `lib/providers/sectors.js` | `SECTOR_BASKETS`와 `lookupSector(query)`. 검색어를 단어로 나눠 키워드와 대조한다(일치 규칙은 §4.3). |
| `lib/providers/directory.js` | 회사명·티커 → `{ symbol, name, assetType, market: 'US'\|'KR', cik?, corpCode? }`. 아래 스냅샷 두 개를 기동 시 한 번 읽는다. |
| `data/us-tickers.json` | SEC `company_tickers.json` 스냅샷(티커, 영문명, CIK). 저장소에 커밋한다. |
| `data/kr-listed.json` | OpenDART `corpCode.xml`에서 상장사(`stock_code`가 있는 항목)만 거른 스냅샷(회사명, 종목코드, corp_code, 시장 구분). 저장소에 커밋한다. |
| `scripts/refresh-directory.js` | 두 스냅샷을 다시 받는다. 사람이 수동으로 실행한다. OpenDART 목록은 ZIP이므로 압축 해제 라이브러리를 **devDependency**로만 쓴다. |
| `lib/providers/dart-financial.js` | OpenDART 단일회사 주요계정(`fnlttSinglAcnt.json`)에서 매출액·영업이익·당기순이익·자산총계·부채총계를 가져와 SEC 재무와 같은 형태로 돌려준다. |
| `lib/resolve.js` | `resolveInstruments({ query, symbol, assetType })` → `{ kind, sector?, instruments }`. |

**스냅샷을 쓰는 이유**: OpenDART 회사 목록은 압축 해제 시 약 25MB다. `http.js` 응답 상한(2MB)을 넘고
런타임에 ZIP 해제가 필요하다. 상장사만 걸러 수백 KB로 저장하면 서버는 실행 중에 회사 목록을 받지 않고,
테스트도 결정적이다. 대가로 신규 상장사는 스냅샷 갱신 전까지 해석되지 않는다.

### 고치는 모듈

- `aliases.js`: 손으로 적은 CIK를 없애고 **한글명 → 티커 별칭**만 남긴다(예: 엔비디아 → NVDA).
  SEC 목록에 한글명이 없으므로 미국 회사의 한글 검색에는 이 사전이 계속 필요하다.
  한국 회사는 `kr-listed.json`의 한글 회사명으로 찾으므로 별칭에서 뺄 수 있다.
- `market.js`: `resolveSymbol`을 `resolve.js`로 옮기고 시세 조회(`fetch`)만 남긴다.
- `financial.js`(SEC): 변경 없음.
- `config.js`: `OPENDART_API_KEY`(선택, 기본 빈 문자열)를 추가하고 허용 목록에 `opendart.fss.or.kr`를 추가한다.
- `render.yaml`: `OPENDART_API_KEY`를 `sync: false`로 추가한다.

### 4.3 일치 규칙

검색어를 공백과 문장부호로 나눈 단어를 기준으로 본다. 단어가 다음 중 하나일 때 키와 일치한다.

- 단어가 키와 같다(대소문자 무시).
- 단어가 키 + 조사다. 조사 목록: 은, 는, 이, 가, 의, 을, 를, 에, 와, 과, 도, 로, 으로, 에서.

여러 단어로 된 키(예: 영문 회사명 "Advanced Micro Devices")는 연속된 단어열로 대조한다.
결과적으로 "메타버스"는 "메타"와 일치하지 않고, "삼성전자의"는 "삼성전자"와 일치한다.

### 4.4 해석 우선순위

1. `symbol`을 직접 넣었으면 `explicit`. 디렉터리에서 cik/corpCode를 보강한다.
2. 검색어에 회사명·티커가 있으면 `company`. 조회 순서는 별칭 → `kr-listed` 회사명 → `us-tickers` 티커·영문명이다. 처음 찾은 회사 하나만 쓴다.
3. 분야 키워드가 있으면 `sector`. 묶음의 각 종목을 디렉터리로 보강한다.
4. 아무것도 없으면 `unresolved`, `instruments: []`.

2단계의 `us-tickers` 티커 대조에는 두 가지 제한을 둔다. 영문 일반 단어가 티커로 오인되는 것을 막기 위해서다.

- 검색어에 **대문자로 입력된 단어**만 티커로 본다. "apple"은 티커 대조 대상이 아니고 영문명 대조로만 찾는다.
- 분야 키워드와 같은 단어(예: "AI", "EV")는 티커로 보지 않는다. 그래서 "AI"는 C3.ai(티커 AI)가 아니라 AI 분야 묶음이 된다.

## 5. 데이터 흐름

### 수집 (`POST /api/research`)

```
query ─► resolveInstruments ─► instruments[0..4]
                                  │ (종목마다 병렬)
                                  ├─ market.fetch(symbol)                  → marketData, series
                                  └─ cik ? SEC : corpCode ? DART : 건너뜀   → financial
뉴스·논문·임상시험 수집은 지금처럼 병렬
```

외부 호출은 최대 8개이며 기존 캐시·회로차단기·세마포어를 거친다.

### 응답 형태

`marketData`, `marketSeries`, `financial` 단수 필드를 없애고 다음으로 대체한다.

```js
instruments: [{
  symbol: 'NVDA', name: 'NVIDIA', assetType: 'stock', market: 'US',
  marketData?: { assetName, currentPrice, priceChange, chartTrend },
  series?:     { ...기존 marketSeries },          // 화면 차트용, 프롬프트 제외
  financial?:  { ...기존 형태, source: 'sec' | 'dart' },
}],
collected.resolution: {
  kind: 'explicit' | 'company' | 'sector' | 'unresolved',
  sector?: '반도체',
  symbols: ['NVDA', 'TSM', '005930.KS', '000660.KS'],
}
```

`collected.resolvedSymbol`, `collected.symbolSource`는 `resolution`으로 대체한다.
`collected.financialMetricCount`는 전 종목 합계로 바꾼다.

재무 스키마 변경: `cik`를 `nullable`로 바꾸고 `corpCode`(nullable), `source`(`'sec' | 'dart'`)를 추가한다.

### 분석 요청 (`POST /api/analyze`)

- 스키마: `instruments: array(max 4)`. 원소는 `{ symbol, name, marketData?, financial? }`이며 `series`는 받지 않는다.
- `cacheKey`에 `instruments`를 넣는다. 견적 자료와 실행 자료가 다르면 확인 토큰이 막는 기존 보호를 유지한다.

### 프롬프트와 출처

- 시장 구획: 종목마다 한 줄. 예: `NVIDIA | 182.5 USD | +2.3% | 상승 추세`.
- 재무 구획: 종목마다 블록 하나, 출처 ID `F1…Fn`. 예: `F2: 삼성전자 (OpenDART)`.
- `resolution.kind === 'sector'`이면 "다음은 ○○ 분야 대표 종목이며, 종목 간 비교를 포함하라"를 한 줄 추가한다.
  `resolution`은 분석 요청 스키마에 `sector?: string(max 40)`으로 받아 cacheKey에 포함한다.
- `postprocess.js`: 재무 출처를 종목마다 `F1…Fn`으로 생성한다. DART 공시 URL(`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=…`)을 URL 허용 목록에 넣는다.
- LLM 응답 스키마의 `financialSummary`는 하나로 유지하고 `notes`에 종목 비교를 쓰게 한다.

### OpenDART 보고서 선택

`fnlttSinglAcnt.json`은 `corp_code`, `bsns_year`, `reprt_code`가 필요하다. 최신 보고서를 다음 순서로 찾는다.
올해 3분기(11014) → 반기(11012) → 1분기(11013) → 작년 사업보고서(11011) → 작년 3분기 순이다.
`status === '013'`(데이터 없음)이면 다음 후보로 넘어가고, 최대 4회 시도한다.
연결재무제표(`fs_div === 'CFS'`)를 우선하고 없으면 개별(`OFS`)을 쓴다.
`thstrm_amount`(당기)와 `frmtrm_amount`(전기)로 전년 대비를 계산한다.

### 화면

- **회사 하나**: 지금 화면과 같다(차트 1개, 재무 카드 1개).
- **분야 묶음**: 상단에 "반도체 분야 대표 종목 4개" 안내, 새 컴포넌트 `InstrumentComparison`이 그리는 비교표
  (종목 | 현재가 | 변동률 | 매출 | 영업이익 | 순이익), 그 아래 종목별 작은 차트. 통화는 종목의 원래 단위로 표시하고
  USD와 KRW를 섞어 환산하지 않는다.
- **없음**: 시장·재무 영역에 "회사명이나 분야(예: 반도체, AI)를 함께 입력해 주세요".
- `MarketChart`, `FinancialMetrics`는 종목 단위로 재사용한다.

## 6. 오류 처리

종목 하나가 실패해도 나머지로 진행하고, 사유는 종목 단위로 보인다.
`degraded` 항목에 `symbol` 필드를 추가한다.

| 상황 | 동작 |
|---|---|
| `unresolved` | `instruments: []`, 안내 문구. 뉴스·논문 기반 분석은 계속한다. |
| 일부 종목 시세 실패 | `{ provider: 'market', symbol, reason }`, 비교표 칸 "—". |
| `OPENDART_API_KEY` 미설정 | DART를 부르지 않는다. 한국 종목에 "한국 재무: API 키 미설정". 기동 오류 아님. |
| DART `status ≠ '000'` | `013` 데이터 없음, `020` 호출 한도 초과, `010`/`011` 키 오류를 사유 문구로 변환. 키 오류는 경고 로그. 키 값은 로그·응답 어디에도 남기지 않는다. |
| 코인 | 재무 대상 아님. degraded가 아니라 "해당 없음"으로 표시. |
| 스냅샷 없음·형식 오류 | 기동 시 경고 로그 후 별칭 사전과 분야 사전만으로 동작. |

DART 호출은 `http.js` 단일 통로(허용 목록, 리다이렉트 차단, 크기 상한)를 거치고,
회로차단기와 TTL 캐시(6시간)를 SEC와 같은 방식으로 적용한다.
요청 URL에 키가 쿼리로 들어가므로, 오류 로그에 URL을 남길 때 `crtfc_key`를 가린다.

## 7. 테스트

모두 네트워크와 LLM 비용 없이 실행한다.

- 단위
  - `sectors`: 키워드, 조사 형태, 회사 우선 규칙
  - `aliases`·일치 규칙: "메타버스"→null 회귀 테스트, "삼성전자의" 일치
  - `directory`: 미국·한국 이름과 티커 조회, 스냅샷 없을 때의 대체 동작
  - `resolve`: 우선순위 4단계, "AI"가 티커가 아니라 분야로 해석되는지
- DART: 픽스처로 정상 응답, 오류 코드별 처리, 보고서 후보 순회, CFS/OFS 선택, 전년 대비, 공시 링크, 로그의 키 가림
- 계약: 수집 응답 `instruments`가 분석 요청 스키마를 통과하는지, 견적과 분석의 `cacheKey`가 같은지
  (`provider-schema-contract` 확장)
- 프롬프트·후처리: `F1…Fn`, 묶음 안내문, DART URL 허용 목록
- 화면: 회사 하나 / 분야 묶음 / 없음 / 일부 실패
- 기존 단수 필드 테스트(약 20개 파일)를 배열 형태로 옮기고 전체 통과를 유지한다.

### 실네트워크 검증 (마지막에 한 번)

- 로컬 `LLM_MODE=mock` 서버에 `verify-research.sh`를 실행한다(LLM 비용 0).
  추가 항목: "반도체" → 종목 4개와 각 시세, "엔비디아" → SEC 재무,
  "삼성전자" → DART 재무(키가 있을 때), "메타버스" → META 아님.
- Render 배포 후 같은 스크립트를 한 번 실행한다(유료 분석 1회, 약 $0.01~0.03).
- OpenDART 키는 사용자가 발급 중이다(2026-11-08 기준 이메일 인증 대기). 키 없이 구현·테스트를 끝내고,
  스냅샷 생성(`kr-listed.json`)과 DART 실검증만 키 발급 후로 미룬다. 그 전까지 테스트는 픽스처 스냅샷을 쓴다.

## 8. 후속 작업과의 관계

사용자와 합의한 전체 순서는 A(이 문서) → B(하네스 엔지니어링으로 분석 품질 개선) → C(CS 파트 신설)다.
`instruments` 배열 형태는 C에서 새 도메인을 붙일 때 재사용할 수 있게 도메인 중립적으로 둔다.
§2의 범위 밖 항목은 어느 작업에도 배정되지 않은 후속 후보다.
