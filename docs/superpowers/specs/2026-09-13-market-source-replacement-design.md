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
| Naver TSM, 동일 1년 기간 | HTTP 200, 250행 | NYSE 후보 성공. TSM.N은 유효하지 않았으므로 suffix를 추측하면 안 됨 |
| Coinbase Exchange BTC-USD / XRP-USD, 30일 지정 | HTTP 200, 일봉 배열 | 무키 코인 후보 성공 |
| Coinbase Exchange ETH-USD / SOL-USD, 일봉 | HTTP 200, 각각 350행 | 기존 코인 별칭 4종 응답 확인. 기본 행 수에 의존하지 않을 것 |

NAVER metadata에서 NVDA.O의 symbolCode/거래소 NASDAQ 및 USD, TSM의 거래소 NYSE 및 USD를 확인했다. 공개 종목 페이지: [삼성전자](https://m.stock.naver.com/domestic/stock/005930/total), [엔비디아](https://m.stock.naver.com/worldstock/stock/NVDA.O/total).

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
- 별칭·명시 심볼 경로 유지. 기존 영문 Yahoo 검색 경로는 이번 차트 수집 교체와 분리해 보존하고, 검색 실패는 기존처럼 unresolved로 처리한다. 미지원 해외 거래소 심볼은 통화를 추측하지 않고 자료 없음으로 처리한다.
- 입력/응답 스키마, 분석 확인 토큰, 뉴스/재무/논문/임상시험, UI 레이아웃, 로그인 정책 변경 없음.
- 호가와 집계 시세가 아닌 최근 완료된 일봉 종가를 차트 요약에 사용한다. chartTrend에 제공자와 종가 기준을 명시해 실시간 시세로 오해하지 않게 한다. priceChange는 기존 기간 종가 변화율로 유지한다.

## 4. 데이터 흐름

### 주식

1. 한국 티커의 .KS/.KQ와 6자리 코드를 검증해 국내 경로로 연결한다.
2. 미국 종목은 명확한 기존 별칭의 제공자 코드와 metadata를 이용한다. 일반 명시 티커는 검증 가능한 metadata 후보를 제한적으로 확인하고 미국 거래소·원래 티커와의 일치를 확인한다. suffix만 무조건 붙이거나 통화를 임의로 지정하지 않는다.
3. 기간 지정 일봉 경로 `/chart/domestic/item/{code}/day` 또는 `/chart/foreign/item/{code}/day`를 사용한다. 단순 dayCandle의 약 110행에 의존하면 1y가 잘리므로 사용하지 않는다.
4. localDate를 유효한 달력 날짜로 검사하고 거래소 현지 기준으로 당일 미완료 봉을 제외한다. 시리즈 날짜 표현은 일별 레이블로 일관되게 정규화한다.
5. 종가와 거래량을 정규화해 시리즈와 지표를 동일 배열에서 만든다. 통화는 검증된 metadata의 USD/KRW만 사용한다.

### 코인

- 공식 공개 [Coinbase Exchange market data](https://docs.cdp.coinbase.com/exchange/introduction/welcome)를 사용한다. 주문·계좌·지갑 API는 필요 없다.
- 기존 식별자 bitcoin/ethereum/solana/ripple을 각각 BTC-USD/ETH-USD/SOL-USD/XRP-USD로 명시 매핑한다. 다른 CoinGecko ID를 임의로 추정하지 않으며 확인 가능한 매핑이 없으면 자료 없음으로 처리한다.
- [Candles 문서](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles)의 86400초 봉을 사용한다. 공식 최대 300행 제한에 맞춰 1y 요청은 최대 2개 기간으로 나누고 합친다. 응답에서 관측한 기본 350행에 의존하지 않는다.
- UTC 당일 진행 중 봉 제외, 요청 경계 밖 제거, timestamp 중복 제거, 오름차순 정렬. 체결이 없는 날을 가짜 봉으로 채우지 않는다.
- Coinbase 단일 거래소 USD 종가이며 CoinGecko 다중 거래소 집계 가격과 동일하지 않음을 chartTrend와 문서에 명시한다.

## 5. 실패·보안·운영

- 모든 요청은 lib/http.js의 HTTPS 정확한 호스트 허용목록, 타임아웃, 응답 크기 제한, redirect 차단을 통한다. 새 API 키·쿠키·임의 URL 입력은 없다.
- api.stock.naver.com, api.exchange.coinbase.com을 config와 .env.example 허용목록에 동기화한다. 운영 EXTERNAL_ALLOWLIST override가 있으면 새 호스트 반영 필요.
- 자산 종류별 회로차단기를 분리하고, malformed JSON/HTML, 빈 응답, 가격 2개 미만은 성공으로 기록하지 않는다. 실패는 기존 선택적 null 반환/collect degraded 경로로 전달한다.
- cache는 기존 계약대로 자산/심볼/기간을 분리한다. 제공자 metadata와 기간 분할은 반복 요청 비용을 제한하는 범위에서 캐시한다.
- 기존 HTTP 오류는 upstream status를 제거하므로, 이번에는 HTTP 공통 계층 전체를 바꾸지 않는다. 외부 원문/민감정보를 로그에 노출하는 진단 확장은 별도 범위다.

## 6. 구현·검증 계획

- Luna worker 실행 가능 확인됨. baseline provider+indicators 46/46 PASS (권한 상승 후). 이전 샌드박스 uv_os_get_passwd ENOMEM은 구현 결함이 아니다.
- 구현 소유: lib/providers/market.js, 필요한 제공자 매핑/정규화 모듈, config/.env.example, provider 및 수집 통합 테스트/fixtures. 주 에이전트는 공유 HANDOFF와 설계/PR 기록 담당.
- RED: source URL/한국·미국·코인 route, 1y 분할·정렬·중복·미완료 봉 제외, 날짜/비정상 종가·거래량, 통화/티커 불일치 거부, HTTP200 HTML/빈 결과, 지표 점 수 일치, 캐시·회로차단 테스트.
- GREEN: 실응답에서 만든 비민감 fixtures로 최소 구현. 그 다음 research/collect-scope 확인 토큰·선택적 degraded 통합 테스트.
- 검증 gate: targeted tests → npm test → npm run build:client → 독립 검토/수정 → Draft PR → 최종 로컬 검증.
- 실환경 gate: Render에서 NVDA/005930/bitcoin의 1mo와 1y 수집 결과에 marketData/marketSeries가 존재하고 통화·최신 완료일·점 수가 적절한지 확인. 수집 endpoint만 호출하면 LLM 비용 없음; verify-research.sh는 유료 분석을 포함하므로 필요할 때만 별도 사용.
- Render 접근 불가 시 로컬 구현 성공과 운영 미검증을 명시하며 해결 완료로 보고하지 않는다. 배포/병합은 별도 명시 승인 전 하지 않는다.

## 7. 검토와 승인

- 외부 교차 검토: DEGRADED. 현재 세션에서 Opus 5 실제 모델/쿼터, Gemini 무료 쿼터 미확인; Copilot CLI 없음. 외부 검토 성공 주장 없음.
- 설계 자체 검토: 비용·키 없음은 실측한 공개 요청 범위의 사실이다. 장기 이용·Render 접근·Naver API 호환성 보장으로 확대하지 않는다.
- 승인할 구체 범위: Stooq를 제외하고 Naver 주식 + Coinbase Exchange 코인으로 구현하는 대안, 최근 완료 일봉 종가 기준, Naver 비공식 인터페이스 의존 한계. 구현 코드 작성 전 사용자 확인 필요.
