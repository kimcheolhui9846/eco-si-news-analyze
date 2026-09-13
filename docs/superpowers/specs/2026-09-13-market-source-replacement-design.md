# 시장 데이터 소스 교체 설계

- 상태: 실측 기반 대안 제안, 구현 전 사용자 설계 검토 대기.
- 승인된 목적: Render에서 실패하는 Yahoo/CoinGecko 차트 수집을 교체한다. 무키 소스를 우선하며 기존 미국·한국 주식과 코인을 유지한다.
- 브랜치: codex/task-6-market-sources. base: codex/task-5-post-merge-verification (4d883f3). 이전 문서 PR #6은 별개이며 자동 병합하지 않는다.

## 1. 실측 결과 (2026-09-13, 로컬 네트워크)

동일 앱 User-Agent의 일반 HTTPS GET으로 소수 요청했다. 로그인·쿠키·API 키·브라우저 검증 우회는 사용하지 않았다. HTTP 성공과 유효한 데이터 성공을 구분한다.

| 소스/질의 | 관측 | 판단 |
|---|---|---|
| Stooq nvda.us / 005930.kr, 일별 CSV 경로 | HTTP 200, 796자 브라우저 JavaScript 검증 HTML | 데이터 확보 실패. 한국 종목 지원 여부도 입증되지 않음. 현 교체안에서 제외 |
| Naver NVDA.O, 2025-09-13~2026-09-12 일봉 | HTTP 200, 250행, 날짜 20250915~20260911 | NASDAQ 일봉 후보 성공 |
| Naver 005930, 동일 기간 | HTTP 200, 242행 | KOSPI 일봉 후보 성공 |
| Naver 035900 dayCandle | HTTP 200, 110행 | KOSDAQ 후보 성공 |
| Naver 035900 기간 지정 /day | 1개월 21행, 1년 242행, 모두 HTTP 200 | 실제 사용할 KOSDAQ 기간 경로 확인 |
| Naver TSM, 동일 1년 기간 | HTTP 200, 250행 | NYSE 후보 성공. TSM.N은 유효하지 않았으므로 suffix를 추측하면 안 됨 |
| Coinbase Exchange BTC-USD / XRP-USD, 30일 지정 | HTTP 200, 일봉 배열 | 무키 코인 후보 성공 |
| Coinbase Exchange ETH-USD / SOL-USD, 일봉 | HTTP 200, 각각 350행 | 기존 코인 별칭 4종 응답 확인. 기본 행 수에 의존하지 않을 것 |

NAVER metadata에서 NVDA.O의 symbolCode/거래소 NASDAQ 및 USD, TSM의 거래소 NYSE 및 USD를 확인했다. 공개 종목 페이지: [삼성전자](https://m.stock.naver.com/domestic/stock/005930/total), [엔비디아](https://m.stock.naver.com/worldstock/stock/NVDA.O/total).

기존 미국 별칭 11개 전부 `/stock/{code}/basic` HTTP200, symbolCode 원본 일치, USD 확인: NVDA/AAPL/MSFT/TSLA/GOOGL/AMZN/META/AMD/INTC/AVGO는 `.O`, TSM은 suffix 없는 `TSM`. 모두 marketStatus=CLOSE, localTradedAt=2026-09-11T16:00:00-04:00을 반환했다. 이는 주말 관측이며 장중/마감 전환은 fixtures의 시간 경계 테스트와 Render 실측 대상으로 남긴다.

**Render 서버에서의 후보 호출은 아직 하지 않았다.** 로컬 HTTP 200은 Render 성공 증거가 아니다. 접근이 확보되면 같은 후보 요청을 Render에서 검증해야 최종 문제 해결을 판정할 수 있다.

## 2. 대안과 권장안

1. **권장: Naver 주식 + Coinbase Exchange 코인.** 현 실측에서 키 없이 미국·한국 주식과 기존 코인을 제공한다. Naver 차트는 외부 개발자용 공식 API 계약을 확인하지 못한 공개 사이트 응답이며, 호환성·지속적 접근 보장이 없다. 이 한계를 사용자에게 알리고 설계 승인 후 구현한다.
2. Twelve Data 같은 공식 키 기반 주식 API + Coinbase 코인. 공식 문서/지원이 장점이나 무료 Basic 범위는 미국 중심이며 한국 시장과 화면 표시 용도는 plan 조건 확인이 필요하다. 키 발급과 비용/사용조건 선택이 추가되므로 자동 채택하지 않는다.
3. Stooq + 코인 소스. 초기 승인한 우선 조사안이나 CSV 대신 검증 HTML을 받아 현재 채택 근거가 없다. 브라우저 검증을 우회하지 않는다.

참고: [Twelve Data 요금/범위](https://twelvedata.com/pricing), [Alpha Vantage 무료 호출 조건](https://www.alphavantage.co/support/) (기본 25회/일). 이 문서는 유료 서비스 가입이나 데이터 재배포 권리를 승인하지 않는다.

## 3. 유지할 계약과 범위

- createMarketProvider({ http, cache, clock, makeBreaker })의 resolveSymbol/fetch 인터페이스, 기존 symbol/assetType, marketData 및 series 반환 형식 유지.
- 기존 .KS/.KQ 한국 티커와 미국 티커 및 bitcoin/ethereum/solana/ripple 식별자를 외부 응답에 그대로 유지한다. 제공자 전용 코드로 사용자 심볼을 덮어쓰지 않는다.
- 5d/1mo/3mo/6mo/1y 범위 유지. 잘못된 자산을 비슷한 티커로 대체하지 않는다.
- 별칭·명시 심볼 경로 유지. 기존 영문 Yahoo 검색 경로는 이번 차트 수집 교체와 분리해 보존하고, 검색 실패는 기존처럼 unresolved로 처리한다. 새 제공자에서 매핑을 검증할 수 없는 종목은 기존 Yahoo/CoinGecko 경로를 호환성 fallback으로 보존한다. fallback의 Render 차단 문제는 해결했다고 주장하지 않는다. 기존에 성공하던 임의 심볼의 지원을 조용히 삭제하지 않는다.
- 입력/응답 스키마, 분석 확인 토큰, 뉴스/재무/논문/임상시험, UI 레이아웃, 로그인 정책 변경 없음.
- 호가와 집계 시세가 아닌 최근 완료된 일봉 종가를 차트 요약에 사용한다. chartTrend에 제공자와 종가 기준을 명시해 실시간 시세로 오해하지 않게 한다. priceChange는 기존 기간 종가 변화율로 유지한다.

## 4. 데이터 흐름

### 주식

1. 한국 티커의 .KS/.KQ와 6자리 코드를 검증해 국내 경로로 연결한다.
2. 미국 종목은 위 실측 매핑을 먼저 쓰고 `/stock/{code}/basic` metadata에서 symbolCode(대문자 정규화)=원본 티커, USD, 미국 NASDAQ/NYSE/AMEX 여부를 검사한다. 일반 영문/숫자 티커는 `{symbol}.O`와 `{symbol}` 두 후보를 고정 순서로 검사한다. 둘 다 일치하면서 서로 다른 자산이면 모호한 결과로 거부한다. punctuation 티커(BRK-B 등)는 하이픈을 임의 변환하지 않고 검증 실패 시 기존 Yahoo fallback으로 보낸다. 국내 metadata의 종목 코드와 시장(KOSPI/.KS, KOSDAQ/.KQ)도 일치해야 한다.
3. 기간 지정 일봉 경로 `/chart/domestic/item/{code}/day` 또는 `/chart/foreign/item/{code}/day`를 사용한다. 단순 dayCandle의 약 110행에 의존하면 1y가 잘리므로 사용하지 않는다.
4. localDate를 유효한 달력 날짜로 검사한다. 주식 시리즈 t는 거래일의 UTC 00:00 ISO로 정규화한 일별 레이블이며 실제 체결 시각으로 설명하지 않는다. 아래 종료일 판정으로 미완료 봉을 제외한다.
5. 종가와 거래량을 정규화해 시리즈와 지표를 동일 배열에서 만든다. 통화는 검증된 metadata의 USD/KRW만 사용한다.

### 코인

- 공식 공개 [Coinbase Exchange market data](https://docs.cdp.coinbase.com/exchange/introduction/welcome)를 사용한다. 주문·계좌·지갑 API는 필요 없다.
- 기존 식별자 bitcoin/ethereum/solana/ripple을 각각 BTC-USD/ETH-USD/SOL-USD/XRP-USD로 명시 매핑한다. 다른 CoinGecko ID를 임의로 추정하지 않으며 확인 가능한 매핑이 없으면 기존 CoinGecko fallback으로 호환성을 유지한다. 현재 검증된 무키 교체 보장 대상은 기존 별칭 4종이다.
- [Candles 문서](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles)의 86400초 봉을 사용한다. 공식 최대 300행 제한에 맞춰 1y 요청은 최대 2개 기간으로 나누고 합친다. 응답에서 관측한 기본 350행에 의존하지 않는다.
- UTC 당일 진행 중 봉 제외, 요청 경계 밖 제거, timestamp 중복 제거, 오름차순 정렬. 체결이 없는 날을 가짜 봉으로 채우지 않는다.
- Coinbase 단일 거래소 USD 종가이며 CoinGecko 다중 거래소 집계 가격과 동일하지 않음을 chartTrend와 문서에 명시한다.

### 기간·완료 봉의 정확한 기준

- 모든 판정은 주입된 clock()에서 한 번 캡처한 now를 사용한다. 미국은 America/New_York(DST 포함), 한국은 Asia/Seoul, 코인은 UTC다.
- 주식: 현지 오늘 날짜를 D라 한다. metadata marketStatus가 CLOSE이고 localTradedAt이 유효한 offset 포함 시각이며 now 이하인 경우 그 현지 거래일 C까지 포함한다. C가 D이면 metadata의 수치화된 closePrice와 일봉 closePrice가 같은 경우에만 당일 봉을 포함한다. 이 조건을 확인하지 못하면 D 이전 날짜의 봉만 사용한다. 과거 metadata가 가리키는 마감일 이후의 봉도 제외한다. 휴일·주말은 마지막 실제 봉을 유지하며 봉을 만들지 않는다.
- 주식 5d: D-45일부터 조회한 유효 완료 봉 중 최근 5개. 5개 미만이면 있는 자료만 사용하고 2개 미만이면 null. 1mo/3mo/6mo/1y: D에서 1/3/6/12 달력월을 뺀 날짜 S(말일 clamp)부터 위 완료 종료일까지 S 포함. 의미를 기간 변동률로 유지하며 자료가 없던 날을 채우지 않는다.
- 코인: UTC 오늘 00:00을 E로 두고 기존 RANGE_DAYS 값 5/30/90/180/365를 사용한다. `[E-days*86400, E)`의 완료 봉만 포함한다. 요청 chunk는 `[start, min(start+299days,E))`로 분할하고 응답 필터도 동일 반개구간을 적용해 경계 중복을 제거한다. API가 요청 밖 봉을 반환해도 제외한다.
- 테스트: 미국 DST 전후, 주말/휴일, 월말 clamp, 장중과 CLOSE 당일의 가격 일치/불일치, stale metadata, 날짜 없는 행, 1y chunk 경계·중복, 자료가 2개 미만인 경우.

## 5. 실패·보안·운영

- 모든 요청은 lib/http.js의 HTTPS 정확한 호스트 허용목록, 타임아웃, 응답 크기 제한, redirect 차단을 통한다. 새 API 키·쿠키·임의 URL 입력은 없다.
- api.stock.naver.com, api.exchange.coinbase.com을 config와 .env.example 허용목록에 동기화한다. 운영 EXTERNAL_ALLOWLIST override가 있으면 새 호스트 반영 필요.
- 소스별 회로차단기를 분리한다. transport/timeout/잘못된 JSON·HTML 등의 상류 실패는 실패로 계산한다. 정상 JSON의 미지원 심볼·빈 데이터·가격 2개 미만·metadata 불일치는 중립 결과로 두어 임의의 잘못된 심볼이 다른 유효 종목의 회로를 열지 않게 한다. 기존 공통 HTTP 계층이 상태를 감추는 HTTP 오류는 기존 오류 계약을 유지하고 알려진 매핑 경로로 호출 수를 제한한다. fallback 회로는 새 소스 회로와 분리한다.
- cache는 기존 계약대로 자산/심볼/기간을 분리한다. 제공자 metadata와 기간 분할은 반복 요청 비용을 제한하는 범위에서 캐시한다.
- 기존 HTTP 오류는 upstream status를 제거하므로, 이번에는 HTTP 공통 계층 전체를 바꾸지 않는다. 외부 원문/민감정보를 로그에 노출하는 진단 확장은 별도 범위다.

## 6. 구현·검증 계획

- Luna worker 실행 가능 확인됨. baseline provider+indicators 46/46 PASS (권한 상승 후). 이전 샌드박스 uv_os_get_passwd ENOMEM은 구현 결함이 아니다.
- 구현 소유: lib/providers/market.js, 필요한 제공자 매핑/정규화 모듈, config/.env.example, provider 및 수집 통합 테스트/fixtures. 주 에이전트는 공유 HANDOFF와 설계/PR 기록 담당.
- RED: source URL/한국·미국·코인 route, 1y 분할·정렬·중복·미완료 봉 제외, 날짜/비정상 종가·거래량, 통화/티커 불일치 거부, HTTP200 HTML/빈 결과, 지표 점 수 일치, 캐시·회로차단 테스트.
- GREEN: 실응답에서 만든 비민감 fixtures로 최소 구현. 그 다음 research/collect-scope 확인 토큰·선택적 degraded 통합 테스트.
- 검증 gate: targeted tests → npm test → npm run build:client → 독립 검토/수정 → Draft PR → 최종 로컬 검증.
- 실환경 gate: Render에서 NVDA, TSM, 005930.KS, 035900.KQ, bitcoin의 1mo와 1y 수집 결과에 marketData/marketSeries가 존재하고 통화·최신 완료일·점 수가 적절한지 확인. 기존 별칭 전체 매핑, punctuation fallback, 나머지 코인 3종은 fixtures 계약 테스트와 후보 응답으로 확인한다. 기존 Yahoo 검색은 Render에서 별도 확인하고 unresolved이면 차트 수집 성공과 분리 보고한다. 수집 endpoint만 호출하면 LLM 비용 없음; verify-research.sh는 유료 분석을 포함하므로 필요할 때만 별도 사용.
- Render 접근 불가 시 로컬 구현 성공과 운영 미검증을 명시하며 해결 완료로 보고하지 않는다. 배포/병합은 별도 명시 승인 전 하지 않는다.

## 7. 검토와 승인

- 외부 교차 검토: DEGRADED. 현재 세션에서 Opus 5 실제 모델/쿼터, Gemini 무료 쿼터 미확인; Copilot CLI 없음. 외부 검토 성공 주장 없음.
- 설계 자체 검토: 비용·키 없음은 실측한 공개 요청 범위의 사실이다. 장기 이용·Render 접근·Naver API 호환성 보장으로 확대하지 않는다.
- native 보완 리뷰의 초기 major 의견(KOSDAQ 실제 기간 경로, 미국 전체 매핑, 완료 봉/기간 경계)을 반영해 실측과 정확한 규칙을 추가했다. 무지원 심볼을 기존 경로로 fallback해 지원 축소를 피하고, no-data 회로차단 중립 규칙도 명시했다. 추가 검토 결과는 HANDOFF에 기록한다.
- 승인할 구체 범위: Stooq를 제외하고 Naver 주식 + Coinbase Exchange 코인으로 구현하는 대안, 최근 완료 일봉 종가 기준, Naver 비공식 인터페이스 의존 한계. 구현 코드 작성 전 사용자 확인 필요.
