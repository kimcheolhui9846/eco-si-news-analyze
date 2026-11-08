# 세션 핸드오프

> 작업이 중단되어도 이어서 진행할 수 있도록 유지하는 문서다.
> **매 태스크를 커밋할 때마다 갱신한다.** 이 문서만 읽으면 다음 사람이 바로 이어받을 수 있어야 한다.

- **최종 갱신**: 2026-09-14 (Task 6 시장 데이터 소스 교체 구현 검증 중)
- **현재 브랜치**: `codex/task-6-market-sources` (Task 5 기록 브랜치 기반, Draft PR #7)
- **저장소**: https://github.com/kimcheolhui9846/eco-si-news-analyze (PRIVATE)

---

## 2026-11-09 B: 분석 품질 게이트 (구현·리뷰·실호출 검증 완료, 푸시 전)

- 브랜치 `feature/analysis-quality-gate` — `feature/sector-baskets-opendart`(Draft PR #12)에서 땄다. PR #12 병합 후 기준을 main으로 바꾼다. **아직 푸시하지 않았다.**
- 설계: `docs/superpowers/specs/2026-11-09-analysis-quality-gate-design.md`, 계획: `docs/superpowers/plans/2026-11-09-analysis-quality-gate.md`.
- 구현: `lib/quality/`(citations·availability·disclaimer·scenarios·comparison + `assessQuality`), `server.js` 분석 경로 연결(`meta.quality`, 캐시 포함), 응답 스키마 `instrumentComparison`, `eval/`(`npm run eval`, 16케이스), 화면 `QualityBadge`·`InstrumentInsight`.
- 계획 대비 사용자 승인 변경: ① 단정 표현 정규식 보정(한다체 권유, 목표가는 통화 단위 필수, 부정·과거 수익률 제외, 무효화 조건 빈 값 확대), 종목 심볼 대소문자 무시. ② 최종 리뷰 후: 브리핑 제목·출처·날짜는 서버 값으로 **조용히** 덮어쓰고 감점하지 않음, 복원된 제목의 `[T1]` 등은 건드리지 않음, 비교 검사 종목은 시세가 있는 종목만, 분야가 아니어도 2종목 이상이면 비교 지시.
- 검증: `npm test` 709 / 708 pass / 0 fail / 1 skip, `npm run eval` 16/16, `npm run build:client` 성공(Task 8).
- 실호출(gpt-4o, 로컬 live, 2회 합계 약 $0.025): 엔비디아 100점(교정·경고 0), 반도체 100점, `instrumentComparison` 4종목 모두 채움. 두 응답을 eval 케이스 15·16으로 추가(커밋 fb8f594).
- 관찰: 반도체 비교에서 삼성전자·SK하이닉스의 "핵심 차이"에 재무 자료 없이(OpenDART 키 없음) 사업 구조를 서술했다. 수치·사실 대조는 이번 범위 밖(설계 "범위 밖" 참고).
- 남은 사소 항목(최종 리뷰에서 병합 후로 미룸): 분석 비교 지시의 종목 수가 시세 없는 종목까지 센다(1/4만 시세 있으면 요청 후 비움), "목표주가 15만원" 미검출, eval 러너 main-guard 경로 비교, 검사기 예외 무로그, 스펙의 "초기 케이스(13개)" 표기.
- 사용자는 로컬 `.env`의 `EXTERNAL_ALLOWLIST`를 `.env.example` 값으로 맞췄다(2026-11-09 확인, 17개 호스트 모두 포함).

## 2026-11-08 분야 묶음 + OpenDART (Task 10 대기)

- 브랜치 `feature/sector-baskets-opendart`. 설계: `docs/superpowers/specs/2026-11-08-sector-baskets-opendart-design.md`, 계획: `docs/superpowers/plans/2026-11-08-sector-baskets-opendart.md`.
- 완료: Task 1~9 (해석기·분야 사전·DART provider·종목별 수집·스키마·프롬프트·화면·배포 설정·검증 스크립트·문서).
- 남은 일: **Task 10** — OpenDART 키 발급 후 `scripts/refresh-directory.js`로 `data/kr-listed.json` 생성·커밋, DART 실검증(`OPENDART_EXPECTED=1 ./scripts/verify-research.sh`), Render에 `OPENDART_API_KEY` 입력 후 배포 검증.
- **Task 10 전에 사용자가 할 일**: 로컬 `.env`의 `EXTERNAL_ALLOWLIST`에 `opendart.fss.or.kr`를 추가한다(`.env`가 코드 기본값을 덮어쓴다). Render는 코드 기본값을 쓰므로 `OPENDART_API_KEY`만 넣으면 된다.
- 알려진 환경 문제: 로컬 `.env`의 `EXTERNAL_ALLOWLIST`에 Naver·Coinbase 호스트(`api.stock.naver.com`, `m.stock.naver.com`, `api.exchange.coinbase.com`)도 없어, 그대로 서버를 띄우면 모든 종목 시세가 "가져오지 못했습니다"로 빠진다(9-14 Task 6 이후 계속). `.env.example`의 값으로 맞추면 해결된다.
- 최종 브랜치 리뷰(전체 diff) 반영 커밋 5개: 흔한 영단어(news, target, quantum…)가 미국 단일어 회사명으로 잡혀 분야 묶음을 가로채던 문제 수정(단일어 회사명은 대문자로 시작해야 하고 `COMMON_ENGLISH_WORDS`에 없어야 함, 실제 스냅샷 회귀 테스트 `tests/resolve-real-snapshot.test.js`), 분석 스키마 `sector`를 분야 이름 enum으로 제한, 비교 지시는 종목 2개 이상일 때만, 종목별 오류 격리(try/catch), `verify-research.sh`의 수집 응답 코드 확인. 부작용: 소문자 `general motors`는 GM으로 해석되지 않는다(대문자 `General Motors`는 됨). `palantir`/`팔란티어` 별칭 추가.
- Task 10 때 함께 할 일(최종 리뷰 권고): `refresh-directory.js`의 KR XML 엔티티(`&amp;` 등) 디코딩, 생성된 `kr-listed.json`의 3자 이상 회사명이 흔한 한국어 뉴스 단어와 겹치는지 점검, Render(고정 IP 없음)에서 OpenDART가 `012`(IP 불허)를 주는지 확인, 가능하면 KS/KQ 시장 구분 저장.
- 최신 `npm test`: 642 tests / 641 pass / 0 fail / 1 skip. `npm run build:client` 성공.
- 로컬 실네트워크 검증(`LLM_MODE=mock`, `EXTERNAL_ALLOWLIST`를 `.env.example` 값으로 명령행 지정): `verify-research.sh` **19 pass / 0 fail**.
  - `[OK] 반도체 → 분야 묶음`, `[OK] 반도체 → 종목 4개`, `[OK] 반도체 → 시세 확보 종목 수 (기대 4, 실제 4)`, `[OK] 엔비디아 → SEC 재무`, `[OK] 메타버스 → META 아님`.
  - degraded: TSM 재무("SEC 제출 서류에서 재무지표를 찾지 못했습니다", TSM은 20-F/외국 발행사), 005930.KS·000660.KS 재무("OPENDART_API_KEY가 설정되지 않았습니다"). 시세는 TSM 포함 4종목 모두 확보.
  - 삼성전자 재무 출처는 키가 없어 "없음"(참고 출력). `.env` 그대로 한 첫 실행은 17 pass / 2 fail(시세 전부 미확보, 위 허용목록 문제).


## 2026-09-13 병합 후 검증

현재 Task 6은 사용자 승인된 Naver 주식/Coinbase 4종 코인 일봉 교체를 진행한다.
최초 구현의 테스트 14개 실패와 날짜/종목 검증 누락을 수정했다.
최신 전체 테스트는 551 pass / 0 fail / 1 skip, 빌드와 실제 공개 데이터 13개 조합 수집이 통과했다.
별도 native Astra 최종 리뷰는 PASS WITH NOTES(중대 결함 없음)이다. Draft PR #7 갱신·push 후
최종 전체 테스트도 551 pass / 0 fail / 1 skip, 빌드 PASS를 확인했다. 병합 승인을 기다린다.
계획·최신 검증·리뷰는 [루트 HANDOFF.md](../HANDOFF.md)의 Task 6 항목을 따른다.
새 소스의 Render 배포·검증은 아직 수행하지 않았다. 아래 내용은 Task 5 운영 검증 이력이다.

- 사용자 승인으로 [PR #5](https://github.com/kimcheolhui9846/eco-si-news-analyze/pull/5)를 병합했다. 커밋: `8e16b308adee43c532bd6793cc83e1960433be54`.
- 이번 실행의 계획·검증·검토 공백·미완료 항목은 [루트 HANDOFF.md](../HANDOFF.md)에 기록한다. 아래 2026-09-10 실측 결과는 과거 이력이며 이번 재검증 결과가 아니다.
- 병합 전 배포 테스트 7/7, 전체 529 pass / 0 fail / 1 skip, 클라이언트 빌드 성공.
- 처음에는 로컬 `.env` 비밀번호가 HTTP 403으로 거부됐으나 사용자 갱신 후 로그인 200 확인. 06:43:32 UTC health `200 ok/live`.
- `verify.sh`: **9 pass / 0 fail**, `degraded=false`, `fabricatedUrlsRemoved=0`, model `gpt-4o-2024-08-06`. 로그인·견적·분석·출처·세션 연장·로그아웃 검증 통과.
- `verify-research.sh`: **13 pass / 1 fail**, 기존 시장 데이터 미확보. 뉴스 8건·재무지표 6개·논문 5건·임상시험 5건 및 분석·언어 가드 통과. arXiv 소스 부분 실패도 관측됐으며 원인·지속성은 미확인.
- 서버가 보고한 실제 분석 2회 비용 합계: **0.03379 USD** (0.02798 + 0.00581).
- 사용자가 Render main 전환·Live·병합 커밋 `8e16b30`을 확인했다고 보고했다. 에이전트의 대시보드 직접 확인과 브라우저 UI 검증은 연결 도구 부재로 미수행. 기존 배포 브랜치는 보존했다.
- 외부 교차 검토는 DEGRADED. 별도 native 보완 리뷰는 새로운 blocker/major 회귀 없음. 기존 프록시 제한과 시장 데이터 결함은 유지한다.

## 0. 처음 이어받는다면 — 빠른 지도

**이 앱이 하는 일.** 검색어를 받아 뉴스·주가차트·SEC 재무지표·논문·임상시험을 모으고,
그것만을 근거로 LLM 분석 보고서를 만든다. 챗봇이 아니라 조사 도구다.
출처를 지어내지 않는 것과 LLM 비용이 새지 않는 것이 이 프로젝트의 두 축이다.

### 구조

```
server.js              Express 앱 팩토리. 모든 라우트와 배선. lib/의 심볼을 re-export한다
lib/
  config.js            환경변수 로드·검증. 기동 시 한 번만 읽는다
  session.js           메모리 Map 기반 세션
  validation.js        Zod 입력 스키마. z.strictObject로 미허용 필드를 거부
  normalize.js         뉴스 정규화·중복 제거·출처 ID(S1..Sn) 부여
  prompt.js            시스템/사용자 프롬프트 조립
  sections.js          재무·논문·실험 구획 문자열과 출처 ID(P/T/F)
  llm.js               OpenAI 클라이언트, 응답 스키마, 회로차단기, 재시도
  postprocess.js       위조 URL 제거, 출처 배열 생성
  cost-defense.js      TTL 캐시·세마포어·중복 병합·rate limit·해시
  budget.js            비용 추정과 예산 추적 (.budget.json에 영속화)
  http.js              외부 호출 단일 통로. 허용목록·리다이렉트 차단·크기 상한
  providers/           news, market, financial, papers, kci, experiments, language
client/src/            React 19 프론트엔드 (Vite). 빌드 산출물은 Express가 서빙
tests/                 node:test. 530개
scripts/               verify.sh, verify-research.sh, verify-kci.sh
docs/superpowers/      specs(설계)와 plans(구현 계획)
```

### 명령

```bash
npm test               # 전체 테스트. API 키·네트워크 불필요
npm run build:client   # 프론트엔드 빌드 (client/dist는 gitignore)
npm start              # 서버 기동 → http://localhost:3000  (.env를 읽는다)

# 실네트워크 검증. 서버가 떠 있어야 한다
./scripts/verify-research.sh [BASE_URL]   # 14항목. live 서버에서는 유료 분석 1회 포함(비용 가변). LLM_MODE=mock 서버에서는 LLM 비용 0
MY_SECRET_PASSWORD=<값> ./scripts/verify.sh [BASE_URL]   # 실호출 1회 약 $0.005
./scripts/verify-kci.sh                   # KCI 계약 확인. 키가 있어야 의미 있다

# 비용 없이 전체 동작 보기
MY_SECRET_PASSWORD=test-pw LLM_MODE=mock npm start
```

테스트 하나만 돌리려면 `node --import tsx --test tests/<파일>`.
`node --test tests/`는 Windows에서 `MODULE_NOT_FOUND`가 난다 — 글롭을 써야 한다.

### 일할 때 지킬 것

- 저장소 루트 `CLAUDE.md`와 §4를 먼저 읽는다. 커밋 저자 표기 규칙이 있다
- 커밋·푸시는 **사용자가 요청할 때만** 한다
- 기능을 고칠 때는 테스트를 먼저 쓴다. 이 저장소는 그렇게 만들어졌다
- 실패하는 테스트나 동작하지 않는 기능을 완료로 보고하지 않는다 (원본 요구사항 §1-7)
- 외부 호출은 반드시 `lib/http.js`를 통한다. provider가 `fetch`를 직접 부르지 않는다
- 새 외부 호스트는 `EXTERNAL_ALLOWLIST`에 정확한 호스트명으로 추가한다
- **`.env`, API 키, 비밀번호를 커밋하지 않는다.** `.env.example`은 커밋되는 템플릿이다

---
## 1. 지금 어디까지 왔나

| 단계 | 상태 |
|---|---|
| 요구사항 브레인스토밍 | ✅ 완료 |
| Phase 1 설계 spec 작성·승인 | ✅ 완료 |
| GitHub 비공개 저장소 생성·연동 | ✅ 완료 |
| Phase 1 구현 계획 작성 | ✅ 완료 (12개 태스크, 138개 테스트 설계) |
| Phase 1 구현 | ✅ 완료 — PR #1 병합됨 (d0ba4ae), 164개 테스트 통과 |
| Phase 2a (뉴스·시장 커넥터) | ✅ 완료 — 289개 테스트, 실네트워크 검증 통과 |
| Phase 2b (재무·논문·실험) | ✅ 완료 — **PR #4 병합됨** (`2cad716`). KCI 키만 미발급 |
| Phase 3 (프론트엔드) | ✅ 완료 — 379개 테스트, 실브라우저 전 과정 확인 |
| 실제 OpenAI 호출 검증 | ✅ 완료 (2026-09-04) — `verify.sh` 9/0, `degraded=false` |
| 배포 설계·계획 | ✅ 완료 — spec·plan 작성 및 커밋 |
| 배포 구현 (Task 1~2) | ✅ 완료 — `render.yaml`, `engines`, 테스트 7건, 문서 |
| 배포 실행 (Task 3) | ✅ 완료 — https://eco-si-news-analyze.onrender.com |
| 배포 검증 | 🟡 `verify.sh` **9/0 통과**, `verify-research.sh` **13/1** — 시장 차트만 실패 |
| 배포 기록·PR (Task 4) | PR #5 main 병합 완료 (2026-09-13). main Live/커밋 사용자 확인, API 재검증 9/0·13/1 |
| **시장 차트 소스 교체** | 🔴 **다음 작업.** §2 참고 |

**현재 테스트: 530 tests / 529 pass / 0 fail / 1 skip** (`npm test`)
skip 1건은 KCI 정상 응답 픽스처가 없어서다. 키를 받으면 해제한다.

## 2. 다음에 할 일 — 시장 차트 소스 교체

> **이어받는 사람에게.** 배포는 끝났고 앱은 살아 있다. 뉴스·재무·논문·실험·LLM 분석이
> 배포 환경에서 동작하는 것을 실측으로 확인했다. **시장 차트는 여전히 안 된다.**
> 2026-09-13에는 arXiv 부분 실패도 관측됐다. 다른 소스로 논문 5건을 확보했으며 원인·지속성은 미확인이다.
> 아래 조사는 이미 끝났으니 다시 하지 말 것.

### 배포 현황

- URL: **https://eco-si-news-analyze.onrender.com**
- Render 무료 웹 서비스. Blueprint(`render.yaml`)로 생성
- 대시보드에 직접 넣은 환경변수는 `MY_SECRET_PASSWORD`와 `OPENAI_API_KEY` 둘뿐이다.
  나머지는 `render.yaml`과 `lib/config.js` 기본값이 적용된다
- **2026-09-10 기록상 Render 추적 브랜치는 `feature/deployment`다.** PR #5는 2026-09-13 병합했다.
  이후 사용자가 `main` 전환·Live·병합 커밋을 확인했다고 보고했다. 에이전트는 대시보드를 직접 확인하지 않았다.

### 실측 검증 결과 (2026-09-10)

| 스크립트 | 결과 |
|---|---|
| `verify.sh` | **통과 9 / 실패 0.** `degraded=false`, `model=gpt-4o-2024-08-06`, 위조 URL 0건 |
| `verify-research.sh` | **통과 13 / 실패 1.** 시장 데이터만 실패 |

배포에서 확인된 것: 로그인, 확인 토큰 `428` 차단, 견적, **OpenAI 실호출**, 세션 연장,
로그아웃 후 `403`, 뉴스 8건, 재무지표 6개, 논문 5건, 임상시험 5건, 한국어 언어 가드.

### 시장 차트가 안 되는 이유 — 조사 끝났다

**Yahoo 차트 API와 CoinGecko가 Render의 데이터센터 IP를 거부한다.**

확정에 쓴 증거다. 다시 확인할 필요 없다.

| 확인한 것 | 결과 |
|---|---|
| Yahoo만의 문제인가 | 아니다. **CoinGecko도 동일하게 실패** |
| 아웃바운드 자체가 막혔나 | 아니다. SEC·arXiv·EuropePMC·ClinicalTrials·Google뉴스·OpenAI 정상 |
| 타임아웃인가 | 아니다. **0.2초 즉시 실패** |
| API가 죽었나 | 아니다. **가정용 IP에서는 둘 다 `HTTP 200`** |
| 허용목록 설정 문제인가 | 아니다. 대시보드에 `EXTERNAL_ALLOWLIST`를 넣지 않아 기본값이 적용됐고,
  기본값에 두 호스트가 모두 있다 |
| 인스턴스가 여러 개인가 | 아니다. Render 무료는 단일 인스턴스로 제한된다 |

Yahoo는 **RSS(`feeds.finance.yahoo.com`)는 되고 API(`query1.finance.yahoo.com`)만 안 된다.**
서비스별 차단 정책과 일치한다. Phase 2b 설계에서 Yahoo `quoteSummary`를
"쿠키+crumb 인증 필요"로 탈락시킨 적이 있는데, 데이터센터 IP에서는 차트 엔드포인트에도
같은 요구가 붙는 것으로 보인다.

**설정으로 못 고친다. 호스팅을 옮겨도 대부분의 클라우드 IP가 같은 취급을 받는다.**

### 그래서 할 일 — 시세 소스 교체

사용자가 "1 → 2"로 결정했다. 즉 **지금 상태를 한계로 적고 병합**한 뒤,
**시세 소스 교체를 별도 작업으로** 진행한다.

브레인스토밍부터 시작할 것. 설계 없이 provider부터 짜지 말 것.

**요구 조건**

- 데이터센터 IP를 막지 않을 것 (이게 교체하는 이유다)
- 일별 종가 시계열을 줄 것. `lib/providers/indicators.js`가 이동평균·변동성을 계산한다
- 주식과 코인을 모두 다룰 것. 한 소스로 안 되면 둘로 나눠도 된다
- API 키는 없는 편이 낫다. 필요하면 KCI처럼 "없어도 서버가 뜨는" 구조로

**후보 (미검증 — 실제로 호출해 확인할 것)**

| 소스 | 특징 |
|---|---|
| Stooq (`stooq.com`) | 키 불필요, CSV. 데이터센터 허용으로 알려져 있다 |
| Alpha Vantage | 키 필요(무료), 하루 호출 수 제한이 빡빡하다 |
| Twelve Data | 키 필요(무료), 한도가 좀 넉넉하다 |

**추정하지 말고 실제로 호출해 확인할 것.** Phase 2b에서 후보를 전부 실측한 뒤
설계를 확정했고, 그 과정에서 처음 가정이 여러 번 뒤집혔다(§9 참고).

**바꾸지 말아야 할 것**

`createMarketProvider`의 계약은 그대로 두고 내부만 갈아끼운다. 호출부가 의존하는 형태다.

```js
createMarketProvider({ http, cache, clock, makeBreaker })
  → resolveSymbol({ query, symbol, assetType })
      → { symbol, assetType, name, source, cik? }
  → fetch({ symbol, assetType, range })
      → { indicators, series, marketData } | null
```

- `marketData`는 `lib/validation.js`의 스키마를 통과해야 한다
  (`assetName`, `currentPrice`, `priceChange`, `chartTrend`)
- `series.points`의 개수는 `indicators.points`와 **반드시 같아야 한다**.
  어긋나면 차트와 이동평균이 따로 논다
- `chartTrend` 문장은 계속 코드가 만든다. LLM에게 추세 판단을 맡기지 않는다
- 기존 테스트 `tests/market-provider.test.js`와 픽스처가 있다. 새 소스의 실제 응답을
  픽스처로 저장하고 같은 방식으로 검증할 것
- 새 호스트를 `EXTERNAL_ALLOWLIST` 기본값(`lib/config.js`)과 `.env.example`에 추가할 것

**먼저 고치면 좋을 것**

`lib/providers/market.js`는 실패를 **조용히 삼킨다**. `catch { breaker.recordFailure(); return null; }`뿐이라
`403`인지 `429`인지 알 수 없었고, 이번 조사에서 상태코드를 끝내 확인하지 못했다.
새 provider에는 실패 사유를 로그로 남길 것. 뉴스 provider가 `degraded`에 사유를 담는 것과 같은 방식으로.

### 배포 후 남은 다른 일

1. **main 전환·Live·커밋 사용자 확인 완료** — 에이전트의 브라우저 UI 검증은 연결 도구가 생기면 수행 (위 배포 현황 참고)
2. **`trust proxy: 1`이 Render 프록시 깊이와 맞지 않는다** — §8 참고
3. **KCI 키** — 배포 환경에서는 어차피 못 쓴다(고정 IP 없음). §8 참고
## 3. 핵심 문서

| 문서 | 내용 |
|---|---|
| `docs/superpowers/specs/2026-09-02-phase1-core-backend-design.md` | Phase 1 설계 (승인됨) |
| `docs/superpowers/plans/2026-09-02-phase1-core-backend.md` | Phase 1 구현 계획 (완료) |
| `docs/superpowers/specs/2026-09-02-phase2a-data-connectors-design.md` | Phase 2a 설계 (승인됨) |
| `docs/superpowers/plans/2026-09-03-phase2a-data-connectors.md` | Phase 2a 구현 계획 — 9개 태스크 |
| `docs/superpowers/specs/2026-09-03-phase3-frontend-design.md` | Phase 3 설계 (완료) |
| `docs/superpowers/specs/2026-09-03-phase2b-research-connectors-design.md` | Phase 2b 설계 (승인됨) |
| `docs/superpowers/plans/2026-09-04-phase2b-research-connectors.md` | Phase 2b 구현 계획 — 14개 태스크. Task 14(KCI 키)만 남음 |
| `docs/superpowers/specs/2026-09-06-deployment-design.md` | 배포 설계 (승인됨) |
| `docs/superpowers/plans/2026-09-06-render-deployment.md` | 배포 구현·PR 병합 완료, main Live 사용자 확인 및 인증 API 재검증 완료. 차트 실패/UI 검증 공백 유지 |
| `~/Desktop/claude-code-integrated-prompt.md` | 사용자 원본 요구사항 |

## 4. 반드시 지켜야 할 결정사항

이유가 있어서 정한 것들이다. 바꾸기 전에 spec을 먼저 읽을 것.

- **3단계 분할**: Phase 1은 코어 백엔드만. 외부 데이터 커넥터·프론트엔드는 범위 밖
- **`/api/analyze/news`는 순수 분석 엔진**: 클라이언트가 `newsList`를 보낸다. 서버가 수집하지 않는다 (수집은 Phase 2)
- **`sources` 배열은 서버가 생성한다**: LLM 응답 스키마에 `sources`가 없다. 출처 위조를 구조적으로 차단하기 위함
- **URL 화이트리스트 후처리**: LLM 응답에서 입력에 없던 URL은 제거하고 `meta.fabricatedUrlsRemoved`에 카운트
- **세션 연장은 200 응답 직전 한 곳에서만**: 미들웨어 통과·검증 실패·LLM 실패로는 연장하지 않는다. 캐시 히트는 연장한다
- **인증 실패는 403** (401 아님 — 원본 요구사항 명시)
- **시계·LLM 주입**: 세션 만료를 15분 기다리지 않고, 실제 API 키 없이 테스트하기 위한 유일한 방법
- **커밋에 AI 귀속 트레일러 금지** (사용자 전역 규칙)
- **`main`에 직접 구현 커밋 금지**
- **예산 한도의 목적은 비용 상한이지 속도 제한이 아니다** (2026-09-02 사용자 추가 요청):
  사용자가 "추가 크레딧 자동 결제를 막고 싶다, 비용이 한정적"이라고 밝혔다. 기존 rate limit은
  시간 창이 지나면 리셋되므로 총량을 막지 못한다. 일일 호출 수 한도만으로도 부족하다 —
  요청 크기에 따라 회당 비용이 크게 다르기 때문이다. 그래서 **누적 비용(USD) 상한**을 축으로 두고
  일일 호출 수를 보조 지표로 쓴다. 예산 상태는 재시작에도 살아남아야 하므로 파일에 영속화한다
  (메모리만 쓰면 재시작이 곧 예산 리셋이 되어 상한이 무의미해진다).
- **앱 예산은 2차 방어선이다**: 자동 충전 차단은 OpenAI 계정 Billing 설정에서 해야 한다.
  앱은 자기 호출만 막을 수 있다. 사용자에게 이 점을 안내했다.

## 5. 사용자 승인 이력

| 시점 | 승인 내용 |
|---|---|
| 2026-09-02 | 3단계 분할 진행 |
| 2026-09-02 | OpenAI 키 보유 — 최종 검증에 실제 호출 1회 포함 |
| 2026-09-02 | 비공개 GitHub 저장소 생성 |
| 2026-09-02 | `/api/analyze/news`를 §11대로 클라이언트 제공 방식으로 |
| 2026-09-02 | Phase 1 설계 spec 승인 (3개 판단 사항 포함) |
| 2026-09-03 | 국내 논문에 KCI OpenAPI 채택 (RISS·DBpia는 공개 API 없음) |
| 2026-09-04 | Phase 2b spec 승인 — "환경변수 키 넣는건 맨 마지막에 해도 되잖아 그러니 구현부터 하자" |

## 6. 환경 정보

- 작업 디렉터리: `D:\eco_si_news_analyze` (2026-10-02에 `C:\Users\00\Desktop\`에서 옮김)
- Node v24.18.0 / npm 11.16.0 / Windows 11, PowerShell + Git Bash
- git 신원: `kim cheol hui <144594976+kimcheolhui9846@users.noreply.github.com>`
- `gh` CLI 인증됨 (`kimcheolhui9846`)
- 로컬 `.env` 존재함. `MY_SECRET_PASSWORD`(8자)와 `OPENAI_API_KEY`가 채워져 있고
  `KCI_API_KEY`는 비어 있다. `.gitignore`에 걸려 커밋되지 않는다

### 배포 (2026-09-10 확인)

- URL: **https://eco-si-news-analyze.onrender.com**
- 플랫폼: Render 무료 웹 서비스
- 설정 출처: `render.yaml` (Blueprint). 대시보드에 직접 넣은 것은 비밀값 2개뿐
- 추적 브랜치: **`feature/deployment`** — PR #5 병합 후 `main`으로 바꿀 것
- 인스턴스 수: Render 무료는 단일 인스턴스로 제한되므로 자동으로 1개다
- 배포된 Node 버전: 빌드 로그에서 미확인. `engines: >=22`는 반영돼 있고 앱은 정상 기동
- 비밀값 2개(`MY_SECRET_PASSWORD`, `OPENAI_API_KEY`)는 Render 대시보드에만 있다
- 로컬 `.env`의 `DEPLOY_PASSWORD`는 배포 검증용으로 사용자가 넣은 값이다.
  검증이 끝났으므로 지워도 된다

**인스턴스를 늘리지 말 것.** 이유는 `docs/architecture.md`의
"상태는 어디에 사는가" 절 참고. 성능이 아니라 정확성 문제다.

## 7. 계획 단계에서 확인한 라이브러리 사실

기억에 의존하면 틀리는 것들이다. 구현 중 바꾸지 말 것.

- **Zod 4**: 미허용 필드 거부는 `z.strictObject({...})`. `.strict()`는 deprecated
- **express-rate-limit 8**: 커스텀 `keyGenerator`에서 IP 폴백 시 반드시 `ipKeyGenerator(req.ip, 56)`.
  생 `req.ip`를 쓰면 IPv6 우회가 가능하고 라이브러리가 `ERR_ERL_KEY_GEN_IPV6`로 거부한다
- **OpenAI strict json_schema**: `strict: true`면 **모든** 속성이 `required`에 있어야 하고
  모든 객체에 `additionalProperties: false`가 있어야 한다. 하나만 어겨도 400을 돌려받는다
- **Express 5**: async 핸들러의 rejection을 자동으로 에러 핸들러에 전달한다. `try/catch` 래퍼 불필요
- **`setInterval(...).unref()`**: sweeper에 반드시 필요. 없으면 프로세스가 종료되지 않아 테스트가 멈춘다
- **`fast-xml-parser`는 CDATA를 자동으로 벗기고 외부 엔티티(XXE)를 거부한다** — XXE 방어를 따로 짤 필요가 없다
- **Google News RSS의 description에는 본문이 없다** — 제목 반복 앵커뿐. 검색은 되지만 본문이 없다
- **Yahoo 티커 검색은 한글 질의에 400을 반환한다** — 한글 회사명은 별칭 사전으로만 해석 가능
- **소스에 리터럴 제어문자를 넣지 않는다** — `` 형식 이스케이프를 쓴다. 리터럴 NUL이 들어가면
  git이 파일을 바이너리로 취급해 diff가 망가진다 (Phase 1에서 겪음)
- **bash heredoc은 `\`를 `\`로 축약한다** — python 스크립트에서 백슬래시 이스케이프를 쓰려면
  `chr(92)`로 조립해야 한다 (Task 3에서 겪음)
- **Git Bash에서 curl에 한글을 직접 넣지 말 것** — 콘솔 인코딩(CP949)에서 깨져 전달된다.
  UTF-8 파일로 써서 `--data-binary @file`로 보내야 한다 (Task 8에서 오진의 원인이었다)
- **jsdom은 `^29`로 고정한다** — `global-jsdom@29`의 peer가 `>=29 <30`이라 `jsdom@30`을 넣으면 ERESOLVE로 설치 실패
- **JSX 테스트에는 `tsx` 로더가 필요하다** — `node --import tsx --test`. 루트 `tsconfig.json`에
  `"jsx": "react-jsx"`가 없으면 classic 런타임으로 변환돼 `React is not defined`
- **JSX를 쓰는 테스트 파일은 `.test.jsx`여야 한다** — tsx는 `.jsx`만 변환한다. `.test.js`에 JSX를
  넣으면 `SyntaxError: Unexpected token '<'`. 글롭도 `"tests/**/*.test.{js,jsx}"`로 확장했다
- **`@testing-library`의 자동 cleanup이 node:test에는 붙지 않는다** — `afterEach(cleanup)`을
  직접 등록해야 한다. 없으면 이전 렌더가 DOM에 쌓여 `getByText`가 중복으로 실패한다
- **client는 npm workspace다** — 루트 `package.json`의 `workspaces: ["client"]`. React를 루트로
  끌어올려 인스턴스를 하나로 유지한다. `client/node_modules`에 React 사본이 생기면
  훅 디스패처가 어긋나 `Cannot read properties of null (reading 'useState')`가 난다.
  **client 디렉터리에서 직접 `npm install`하지 말 것** — 루트에서 해야 한다
- **정적 서빙 경로는 `fileURLToPath`를 쓴다** — `URL.pathname`은 Windows에서 `/C:/...`가 되어 fs가 못 읽는다
- **supertest 요청은 지연 실행이다** — `.then()`을 걸어야 실제로 전송된다 (Phase 1에서 겪음)
- **테스트 실행 스크립트**: `node --test tests/`는 Node 24/Windows에서 `tests`를 모듈 경로로
  해석해 `MODULE_NOT_FOUND`가 난다. `node --test "tests/**/*.test.js"` 글롭을 써야 한다.
  (Task 1에서 실제로 겪고 수정함)
- **`loadConfig`는 `process.env`를 병합한다**: 누락 검증 테스트는 `''`를 명시적으로 넘겨야 한다.
  개발자 로컬에 `.env`가 있으면 그냥 통과해버려 테스트가 무의미해진다 (Task 1에서 수정함)

## 8. 아직 해결되지 않은 것

- **KCI가 한국어 질의를 받는지 확인되지 않았다.** 키 발급 후 §2의 4단계로
  검증한다. 되는 것으로 가정하고 구현하면 안 된다
- **KCI의 IP 거부 응답이 어떻게 생겼는지 모른다.** 키가 없어 확인하지 못했다.
  키 발급 후 함께 확인해 식별 조건을 확정한다
- ~~`.env`가 아직 존재하지 않는다.~~ **2026-09-04 생성 완료.** 비밀번호와 OpenAI 키가
  채워져 있고 로그인·실호출이 확인됐다. `KCI_API_KEY`만 비어 있다
- **배포 환경에서 예산 카운터가 재시작마다 리셋된다.** Render 무료는 파일시스템이
  휘발성이라 `.budget.json`이 정지·재배포마다 사라진다. **실제 지출 상한은
  OpenAI 계정 Billing에서 걸어야 한다.** 앱 예산은 한 세션 안에서만 유효하다.
  이것은 결함이 아니라 배포 설계 §5에서 근거를 적고 받아들인 선택이다
- **배포 환경에서 KCI를 쓸 수 없다.** 아웃바운드 IP가 유동이라 허용목록에 등록할 수 없다
- ~~Render Blueprint가 무료 플랜에서 되는지 모른다.~~ **된다.** Blueprint로 배포했다
- **[중요] 배포 환경에서 시장 차트가 동작하지 않는다.** Yahoo 차트 API와 CoinGecko가
  Render의 데이터센터 IP를 거부한다. 조사는 끝났고 §2에 근거가 전부 적혀 있다.
  해결책은 시세 소스 교체이며 그것이 다음 작업이다
- **`trust proxy: 1`이 Render의 프록시 깊이와 맞지 않는다.** Render는 Cloudflare와
  자체 로드밸런서를 거치는데 `server.js`는 홉 하나만 신뢰한다. 그래서 `req.ip`가
  실제 사용자가 아니라 중간 프록시 주소로 잡히고, 그 주소가 노드마다 달라진다.

  **관측 근거**: 같은 클라이언트로 연속 요청했는데 rate limit 카운터가 두 갈래로 갈렸다
  (`remaining` 51→50→49 / `reset=798`과 `remaining=54` / `reset=792`가 번갈아 나옴).
  `express-rate-limit` 8.7.0의 `MemoryStore`는 키 하나당 카운터 하나이므로(`localKeys = true`)
  키가 둘이라는 뜻이다. IPv4 고정, XFF 고정, 단일 인스턴스를 모두 배제했다.

  **영향은 제한적이다.** 세션·확인 토큰·예산은 IP로 키를 만들지 않아 멀쩡하다.
  로그인 무차별 대입 방어가 `10회`가 아니라 `10 × 프록시 노드 수`로 느슨해질 뿐이다.

  **주의**: `trust proxy: true`로 바꾸면 이번엔 클라이언트가 `X-Forwarded-For`를
  위조해 rate limit을 우회할 수 있다(README에 적힌 트레이드오프). 단순 교체가 답이 아니다.
  Render가 보장하는 헤더를 쓰거나 `keyGenerator`를 직접 만드는 쪽을 검토할 것

- ~~실제 OpenAI 호출 검증이 아직 0회다.~~ **2026-09-04 완료.** `./scripts/verify.sh`
  **통과 9 / 실패 0**. `degraded=false`로 구조화 출력이 실모델에서 첫 시도에 통했다.
  Phase 2b에서 추가한 `financialSummary`·`researchSummary`·`experimentSummary`
  세 필드까지 포함한 strict json_schema가 그대로 받아들여졌다.
  응답 모델 `gpt-4o-2024-08-06`, 실제 비용 **$0.00532**
- `gpt-4o`는 2026년 기준 구형 모델. 원본 요구사항대로 기본값 유지하되 `OPENAI_MODEL`
  교체만으로 바꿀 수 있게 구현했다. **모델을 바꾸면 `PRICE_INPUT_PER_1M`·
  `PRICE_OUTPUT_PER_1M`도 함께 고쳐야 한다** — 안 고치면 예산 상한이 엉뚱한 단가로
  계산돼 비용 방어가 무의미해진다. 2026-09-04 기준 계정에서 쓸 수 있는 모델은
  `/v1/models`로 확인했다. `gpt-5.5`와 `gpt-5.5-pro`는 있으나 **`gpt-5.5-mini`는 없다.**
  mini 계열 최신은 `gpt-5.4-mini`다
- 토큰 추정은 문자수/4 근사치 — 한국어에서 부정확. 보수적 마진 적용 예정

---

## 9. Phase 2b spec에서 실측으로 뒤집힌 것들

조사가 설계를 바꾼 지점이다. 다시 조사하지 않도록 남긴다.

| 처음 가정 | 실측 결과 |
|---|---|
| Yahoo로 재무를 받는다 | `401 Invalid Crumb` — 쿠키+crumb 인증 필요. SEC EDGAR로 선회 |
| SEC `companyfacts`를 쓴다 | **4MB** — 응답 상한 2MB 초과. `companyconcept`(42KB)로 변경 |
| Crossref로 논문을 받는다 | 초록이 5건 중 **0건**. Europe PMC + arXiv로 대체 |
| Semantic Scholar 병용 | 키 없이 `429`. 탈락 |
| 한국어 질의는 0건이 나온다 | **무관한 실존 논문이 돌아온다.** 기존 방어를 전부 통과하는 오염. 언어 가드 필수 |
| RISS·DBpia에서 국내 논문 | RISS 공개 API 없음(404), DBpia 구독 기반. KCI OpenAPI가 유일한 정당 경로 |
| DART는 키가 필요해서 탈락 | KCI 키를 쓰기로 한 이상 무효한 사유. 범위 문제라 **Phase 2c 후보**로 남김 |

### 잊으면 다시 당하는 두 가지

- **오류를 HTTP 상태코드로 판정하면 안 된다.** KISTI ScienceON은 `HTTP 200`에
  본문 `statusCode 400`을 싣는다. KCI도 본문 `<resultMsg>`로 판정한다
- **`cacheKey`에 새 자료를 넣지 않으면 확인 토큰이 뚫린다** (spec §4.5).
  뉴스만으로 견적받고 논문 20건을 실어 실행하는 우회가 성립한다

---

## 10. Phase 2b 구현 중 실측으로 잡은 결함

테스트는 전부 통과하는데 실네트워크에서 터진 것들이다. 계획에 없던 수정이다.

### provider가 자기 검증기를 통과하지 못했다

arXiv의 NVIDIA 협업 논문에 **저자가 217명**이었다. 분석 스키마의 상한은 50이었고,
서버가 자기 provider의 출력을 `400 INVALID_REQUEST`로 거부했다.
손으로 쓴 픽스처만 검증하던 테스트는 이것을 잡지 못했다.

**고친 방식**: 상한을 provider 쪽(`RESEARCH_LIMITS`, `EXPERIMENT_LIMITS`)에 두고
제목·초록·저널명·DOI·저자를 스키마와 같은 값으로 자른다. 저자는 10명까지 싣고
총 인원을 `authorCount`로 남긴다 — 자르고 침묵하면 연구 규모를 잃는다.

**추가한 안전장치**: `tests/provider-schema-contract.test.js`가 provider 출력을
실제 분석 스키마에 통과시킨다. 이 테스트가 있었으면 실측 없이 잡혔다.
**손으로 쓴 픽스처는 provider가 실제로 만드는 것과 다를 수 있다.**

### 화면 문구가 레이블 조회와 충돌했다

`ScopePicker`의 실험 항목 힌트가 "영어 **검색어**에서만"이었는데, 같은 폼의
`검색어` 입력 레이블과 겹쳐 `getByLabelText(/검색어/)`가 두 요소를 찾았다.
테스트만의 문제가 아니라 화면 낭독기에서도 같은 모호함이 생긴다.
힌트를 "영문 질의에서만 동작"으로 바꿨다.

### 검증 스크립트의 기대가 틀렸다

`nvidia earnings`에 임상시험이 0건인 것은 결함이 아니라 사실이다.
임상시험 경로는 의학 질의(`obesity drug trial`)로 따로 확인하도록 7단계를 나눴다.

### 브라우저에서 잡은 두 가지

**수집 범위 체크박스의 레이블과 설명이 붙어 나왔다.** `.search-form label`이
`(0,1,1)`이라 `.scope-row` 클래스 하나로는 이기지 못한다. 폼으로 한정해
`.search-form .scope-row`로 고쳤다. **같은 파일의 `.radio`도 같은 이유로
눌려 있다** — 라디오가 한 줄에 안 붙고 세로로 쌓이는 것이 그 결과다.
Phase 3에서 확인된 모습이라 손대지 않았지만, 바꾸려면 여기가 원인이다.

**arXiv 협업 논문의 저자 목록에 구분 기호가 섞여 온다.**
`<name>NVIDIA</name><name>:</name><name>Aarti Basant</name>` 형태라
화면과 프롬프트에 `NVIDIA, :, Aarti Basant`로 나갔다.
글자도 숫자도 없는 이름을 거르고 총 인원에서도 뺀다.

### 브라우저 확인 결과 (2026-09-04, LLM_MODE=mock)

검토 화면과 보고서 화면 양쪽에서 세 섹션이 모두 렌더링되는 것을 확인했다.

| 확인 항목 | 결과 |
|---|---|
| 재무 기준 기간 | `FY2027 Q2 · 10-Q · 2026-08-26 제출` 각 값 옆에 표시 |
| 계산값 배지 | 부채비율 28.5%, 매출 성장률 105.85%에 `계산값` 배지 |
| 논문 배지 | 5건 모두 `프리프린트` (Europe PMC의 PPR + arXiv) |
| 빈 섹션 | 실험·임상이 `검색 결과가 없습니다.`로 표시됨 — 감추지 않는다 |
| 보고서 화면 | 세 섹션 모두 렌더링 확인 |
### 실네트워크 검증 결과 (2026-09-04)

`./scripts/verify-research.sh` — **통과 14 / 실패 0**

| 항목 | 결과 |
|---|---|
| 수집 범위 5종 | `news,market,financial,research,experiments` |
| 뉴스 | 8건 |
| 재무지표 | 6개 (NVDA 전 개념 확보) |
| 논문 | 5건 |
| 임상시험 | 5건 (의학 질의) |
| 출처 타입 | `financial,news,research` |
| 한국어 언어 판정 | `ko` — 영어 소스에 요청 나가지 않음 |
