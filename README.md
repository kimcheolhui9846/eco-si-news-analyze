# eco-si-news-analyze

실시간 뉴스·재무·논문·실험·주식 차트 통합 분석 플랫폼.

수집한 자료의 출처를 명시하고, 뉴스·재무·연구·시장 데이터를 통합해 LLM으로 분석하여
핵심 요약, 동향 비교, 투자 시나리오, 리스크 및 모니터링 지표를 제공하는 리서치 도구다.

**단순 챗봇이 아니다.** 모델의 기억이 아니라 제공된 자료만을 근거로 분석하고,
모델이 만들어낸 출처는 응답 후처리에서 제거한다.

---

## 진행 상태

| 단계 | 범위 | 상태 |
|---|---|---|
| **Phase 1** | 인증·세션, API 비용 방어, 분석 엔진, 예산 통제, 테스트, 문서 | ✅ 완료 |
| Phase 2 | 데이터 커넥터 5종 + `/api/research` 오케스트레이션 | 미착수 |
| Phase 3 | React 프론트엔드 12개 컴포넌트 | 미착수 |

Phase 1의 `/api/analyze/news`는 **클라이언트가 제공한 자료를 분석하는 순수 엔진**이다.
서버가 외부에서 뉴스를 수집하는 기능은 Phase 2에서 이 엔진 앞단에 붙는다.

---

## 시스템 구성

```
요청
 ↓ helmet · compression · cookieParser
 ↓ requestId 발급 + 자식 로거 바인딩
 ↓ IP rate limit → 본문 크기 제한 → 인증 → 세션 rate limit
 ↓ zod strictObject 검증 → 정규화 · 중복제거 → 출처 ID(S1..Sn) 부여
 ↓ 프롬프트 조립 (외부 자료 델리미터 구획) → 토큰 예산 사전 점검
 ↓ [견적 단계에서 발급한 확인 토큰 검증] → 비용 예산 확인
 ↓ 캐시 조회 → 세마포어 → 동일요청 병합 → 회로 차단기
 ↓ LLM 호출 (재시도 + 지수 백오프 + 지터)
 ↓ 구조화 파싱 2회 → 실패 시 Markdown 폴백
 ↓ URL 화이트리스트 후처리 → 예산 기록 → 캐시 저장 → 세션 연장
응답
```

핵심 로직은 `server.js` 하나에 섹션 주석으로 구획해 담았다.

---

## 설치

```bash
git clone https://github.com/kimcheolhui9846/eco-si-news-analyze.git
cd eco-si-news-analyze
npm install
```

Node.js 20 이상이 필요하다 (개발·검증은 24.18.0에서 했다).

---

## 환경변수 설정

```bash
cp .env.example .env
```

`.env`를 열어 최소 두 값을 채운다.

```env
MY_SECRET_PASSWORD=원하는_로그인_비밀번호
OPENAI_API_KEY=sk-...
```

**`.env`는 절대 커밋하지 않는다.** `.gitignore`가 막고 있다.

<details>
<summary>전체 환경변수 목록</summary>

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | 서버 포트 |
| `NODE_ENV` | `development` | `production`이면 Secure 쿠키 사용 |
| `TRUST_PROXY` | `false` | **리버스 프록시 뒤 배포 시 반드시 `true`** |
| `MY_SECRET_PASSWORD` | — | **필수.** 로그인 비밀번호 |
| `SESSION_TTL_MINUTES` | `15` | 세션 유효 시간 |
| `OPENAI_API_KEY` | — | `LLM_MODE=live`일 때 **필수** |
| `OPENAI_MODEL` | `gpt-4o` | 분석 모델 |
| `OPENAI_TIMEOUT_MS` | `60000` | LLM 호출 타임아웃 |
| `OPENAI_MAX_RETRIES` | `2` | 재시도 횟수 |
| `LLM_MODE` | `live` | `mock`이면 API 키 없이 동작 |
| `MAX_REQUEST_BODY_BYTES` | `200000` | 요청 본문 크기 상한 |
| `MAX_NEWS_ITEMS` | `20` | 기사 최대 개수 |
| `MAX_TITLE_CHARS` | `300` | 제목 최대 길이 |
| `MAX_CONTENT_CHARS` | `8000` | 본문 최대 길이 |
| `MAX_TREND_CHARS` | `1000` | 차트 트렌드 설명 최대 길이 |
| `MAX_PROMPT_CHARS` | `120000` | 조립된 프롬프트 최대 길이 |
| `MAX_INPUT_TOKENS` | `30000` | 추정 입력 토큰 상한 |
| `LOGIN_RATE_WINDOW_MS` / `LOGIN_RATE_MAX` | `900000` / `10` | 로그인 rate limit |
| `ANALYZE_RATE_WINDOW_MS` / `ANALYZE_RATE_MAX` | `900000` / `30` | 분석 rate limit (IP) |
| `SESSION_RATE_WINDOW_MS` / `SESSION_RATE_MAX` | `900000` / `20` | 분석 rate limit (세션) |
| `MAX_CONCURRENT_ANALYSES` | `3` | 동시 분석 한도 |
| `CACHE_TTL_MS` / `CACHE_MAX_ENTRIES` | `600000` / `100` | 결과 캐시 |
| `BREAKER_THRESHOLD` / `BREAKER_COOLDOWN_MS` | `5` / `60000` | 회로 차단기 |
| `BUDGET_FILE` | `.budget.json` | 예산 사용량 기록 파일. 빈 값이면 영속화 안 함 |
| `DAILY_ANALYSIS_LIMIT` | `50` | 일일 분석 호출 수 상한 |
| `MONTHLY_COST_LIMIT_USD` | `5` | **월 누적 비용 상한** |
| `PRICE_INPUT_PER_1M` / `PRICE_OUTPUT_PER_1M` | `2.5` / `10` | 모델 단가($/100만 토큰) |
| `ASSUMED_OUTPUT_TOKENS` | `2000` | 견적 시 가정하는 출력 토큰 수 |
| `CONFIRM_TOKEN_TTL_MS` | `300000` | 확인 토큰 유효 시간 |
| `CORS_ORIGIN` | `http://localhost:3000` | Phase 3에서 사용 |

</details>

---

## 실행

```bash
npm start        # 서버 기동
npm run dev      # 파일 변경 시 자동 재시작
npm test         # 테스트 (API 키 불필요)
```

**API 키 없이 전체 동작을 보고 싶다면:**

```bash
MY_SECRET_PASSWORD=test-pw LLM_MODE=mock npm start
```

`LLM_MODE=mock`은 결정적인 가짜 응답을 돌려준다. 모든 응답에 `[MOCK]` 표시가 붙으므로
실제 분석으로 오인할 수 없다.

---

## API 사용 예시

전체 명세는 [`docs/api.md`](docs/api.md)에 있다.

```bash
# 1) 로그인
TOKEN=$(curl -sS -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"your-password"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

BODY='{
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
}'

# 2) 견적 — 비용이 들지 않는다. 예상 비용과 남은 예산을 확인한다.
curl -sS -X POST http://localhost:3000/api/analyze/estimate \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" -d "$BODY"

# 3) 승인하고 실행 — 여기서 실제 비용이 발생한다.
curl -X POST http://localhost:3000/api/analyze/news \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Confirm-Token: ct_..." -d "$BODY"
```

전체 시나리오 자동 검증:

```bash
MY_SECRET_PASSWORD=your-password ./scripts/verify.sh
```

---

## 인증 방식

`Authorization: Bearer <token>` 헤더 또는 HttpOnly `session` 쿠키. 로그인 시 둘 다 발급된다.

- 토큰: `crypto.randomBytes(32)` 기반 256비트, base64url
- 쿠키: `HttpOnly; SameSite=Strict; Path=/`, `Secure`는 `NODE_ENV=production`일 때만
- 비밀번호 비교는 SHA-256 해시 후 `timingSafeEqual` 상수시간 비교
- **인증 실패는 `403`** (원본 요구사항 명시. 표준상 `401`이 맞지만 요구사항을 따랐다)

---

## 세션 만료 정책

기본 15분. **활동 기반으로 연장되며, 연장은 분석이 성공적으로 `200`을 반환하기 직전 한 곳에서만 일어난다.**

| 상황 | 연장 |
|---|---|
| 분석 성공 (`200`) | ✅ |
| 캐시 히트 (`200`) | ✅ 정상적인 사용자 활동이다 |
| 인증 미들웨어 통과만 | ❌ |
| 입력 검증 실패 | ❌ |
| 예산 초과·확인 토큰 없음 | ❌ |
| LLM 실패·타임아웃·파싱 실패 | ❌ |
| `GET /api/auth/session` 조회 | ❌ 읽기 전용이다 |

로그아웃은 멱등적이며, 로그아웃 후 같은 토큰으로 분석하면 반드시 `403`이다.

---

## 비용 방어 정책

### 예산 통제 — 총량을 막는다

rate limit은 시간 창이 지나면 리셋되므로 **총 지출을 막지 못한다.** 그래서 별도의 예산 계층을 둔다.

| 축 | 기본값 | 초기화 |
|---|---|---|
| 일일 호출 수 | 50회 | UTC 자정 |
| **월 누적 비용** | **$5** | UTC 매월 1일 |

둘 중 먼저 닿는 쪽에서 `429 BUDGET_EXCEEDED`로 차단한다. 실질적 상한은 비용 쪽이다 — 요청 크기에 따라 회당 비용이 크게 다르기 때문이다.

**사용량은 `BUDGET_FILE`에 기록되어 서버를 재시작해도 유지된다.** 메모리에만 두면 재시작이 곧 예산 리셋이 되어 상한이 무의미해진다.

### 명시적 호출 승인 — 실수로 돈이 나가지 않게 한다

비용이 드는 호출은 2단계다.

```
POST /api/analyze/estimate   → LLM 미호출. 예상 비용·남은 예산·확인 토큰 반환
POST /api/analyze/news       → X-Confirm-Token 헤더 필수. 실제 호출 + 예산 차감
```

확인 토큰은 **세션과 요청 내용에 묶인 일회용**이다. 작은 요청으로 견적을 받고 큰 요청을 실행할 수 없다.
캐시 히트는 LLM을 부르지 않아 비용이 0이므로 확인 없이 통과한다.

> ### ⚠️ 이 예산은 2차 방어선이다
>
> 앱의 한도는 **이 앱의 호출만** 막는다. OpenAI 계정의 자동 충전 자체를 막으려면
> OpenAI 대시보드에서 직접 설정해야 한다.
>
> - **Billing → auto-recharge 해제**
> - **Limits → monthly budget 설정**
>
> 계정 설정이 1차 방어선이다. 반드시 먼저 해둘 것.

### 그 밖의 방어

rate limit 3종(IP·세션·로그인), 동시 실행 세마포어, TTL+LRU 캐시, 동일 요청 병합,
회로 차단기, 지수 백오프+지터, 요청 크기·기사 수·본문 길이·프롬프트 길이·토큰 예산 상한,
요청 ID 부여, 로그 마스킹. 전부 환경변수로 조정 가능하다.

---

## 데이터 provider 설정 방법

**Phase 1에는 provider가 없다.** 자료는 클라이언트가 요청 본문으로 제공한다.

Phase 2에서 다음 provider가 추가되며, 각각 API 키를 환경변수로 관리한다.

```
NewsProvider · FinancialDataProvider · ResearchPaperProvider
ExperimentDataProvider · MarketChartProvider
```

키가 없는 provider는 mock 또는 "미설정" 상태로 명확히 표시하며,
**mock 데이터를 실제 최신 데이터인 것처럼 표시하지 않는다.**

---

## OpenAI API 설정

- 모델은 `OPENAI_MODEL`로 지정한다. 기본값은 원본 요구사항에 따라 `gpt-4o`다.
- 응답은 `response_format: json_schema` (strict)로 받는다. 파싱에 2회 실패하면 Markdown 폴백으로 전환하고 `meta.degraded: true`로 알린다.
- 시스템 프롬프트는 서버 상수다. 사용자 입력이 도달할 경로가 없다.
- SDK 자체 재시도는 끄고(`maxRetries: 0`) 재시도를 애플리케이션이 단독 관리한다. 이중 재시도로 비용이 곱절이 되는 것을 막기 위함이다.

> `gpt-4o`는 2026년 기준 오래된 모델이다. `OPENAI_MODEL`만 바꾸면 최신 모델로 교체된다.
> 모델을 바꾸면 `PRICE_INPUT_PER_1M`·`PRICE_OUTPUT_PER_1M`도 함께 맞춰야 비용 추정이 정확하다.

---

## 테스트 방법

```bash
npm test
```

**164개 테스트가 실제 API 키 없이 전부 통과한다.** `LLM_MODE=mock`과 주입된 시계를 쓴다.

| 파일 | 범위 |
|---|---|
| `tests/config.test.js` | 설정 로딩·검증, 헬스체크 |
| `tests/errors.test.js` | 요청 ID, 에러 형식, 내부 정보 비노출 |
| `tests/auth.test.js` | 로그인·세션·만료·로그아웃·연장 |
| `tests/validation.test.js` | 입력 검증, 정규화, 중복 제거 |
| `tests/prompt.test.js` | 프롬프트 조립, 인젝션 방어 |
| `tests/llm.test.js` | 재시도·백오프·회로 차단기·JSON 스키마 |
| `tests/postprocess.test.js` | URL 무결성, 파싱, 출처 생성 |
| `tests/costdefense.test.js` | 캐시·세마포어·요청 병합·rate limit |
| `tests/analyze.test.js` | 분석 파이프라인 통합 |
| `tests/budget.test.js` | 비용 예산, 호출 확인 |

실행 중인 서버에 대한 종단 검증:

```bash
MY_SECRET_PASSWORD=your-password ./scripts/verify.sh
```

---

## GitHub workflow

- `main`에 직접 작업하지 않는다. 기능별 브랜치를 쓴다 (`feature/backend-api` 등)
- 커밋은 기능 단위로 작게 나누고 Conventional Commits 형식을 쓴다
- push 전 테스트 통과와 민감정보 미포함을 확인한다
- 기능 완료 시 PR을 만들고 구현 내용·테스트 결과·보안 고려사항·알려진 제한사항·후속 작업을 담는다

---

## 운영환경 주의사항

배포 전에 반드시 확인한다.

1. **`TRUST_PROXY`를 배포 형태와 일치시킬 것.** 리버스 프록시 뒤인데 끄면 전체 사용자가 한 IP로 묶여 함께 차단되고, 프록시가 없는데 켜면 `X-Forwarded-For` 위조로 rate limit이 우회된다.
2. **HTTPS 종단을 붙일 것.** `Secure` 쿠키는 `NODE_ENV=production`에서 자동으로 붙지만 HTTPS 자체는 배포 환경의 책임이다.
3. **메모리 세션의 한계를 인지할 것.** 서버 재시작 시 전체 로그아웃되고, 다중 인스턴스에서는 동작하지 않는다.
4. **메모리 rate limit은 인스턴스별로 계산된다.** N대 배포 시 실질 한도가 N배다.
5. **`BUDGET_FILE`이 영속 볼륨에 있어야 한다.** 컨테이너 재생성마다 사라지면 예산 상한이 무의미하다.
6. **OpenAI 계정의 자동 충전을 꺼둘 것.**

Redis 전환 방법, 캐시 키 설계, 장애 시 fallback 전략은 [`docs/architecture.md`](docs/architecture.md)에 있다.

---

## 파인튜닝이 필요한 경우와 필요하지 않은 경우

**지금은 필요하지 않다.** 최신 금융·과학 정보는 파인튜닝으로 해결할 수 없다 — 모델 가중치는 학습 시점에 고정되기 때문이다. 최신성은 검색·검증·컨텍스트 주입으로만 확보된다.

현재 구현 순서:

1. 컨텍스트 주입 (제공된 자료를 프롬프트에 싣는다)
2. 엄격한 시스템 프롬프트
3. 구조화 출력 (json_schema strict)
4. 출처 연결 (`[S1]` 인용 + 서버 생성 `sources`)
5. 분석 결과 평가 ← Phase 2 이후
6. 평가 데이터셋 구축 ← Phase 2 이후
7. 필요할 경우에만 파인튜닝 검토

**파인튜닝은 다음이 모두 충족될 때만 추진한다.**

- 고품질 분석 예시가 충분히 축적됨
- 분석 형식과 문체를 안정적으로 고정할 필요가 확인됨
- 반복적인 오류 유형이 데이터로 확인됨
- 프롬프트와 RAG 개선만으로 해결되지 않음
- 평가 지표와 검증 데이터셋이 이미 있음

---

## 문서

| 문서 | 내용 |
|---|---|
| [`docs/api.md`](docs/api.md) | 엔드포인트 명세, 에러 코드표, curl 예시 |
| [`docs/architecture.md`](docs/architecture.md) | 메모리 세션 한계, Redis 전환, 캐시 키 설계, 장애 fallback |
| [`docs/security.md`](docs/security.md) | 보안 체크리스트 대조 결과와 알려진 약점 |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | 설계 판단 기록, 관점 충돌과 해결 |
| [`docs/SESSION-HANDOFF.md`](docs/SESSION-HANDOFF.md) | 진행 상태와 이어받기 위한 맥락 |

---

## 금융정보 면책사항

본 프로젝트가 생성하는 분석은 **제공된 자료를 기반으로 한 정보 제공 목적의 분석**이며,
특정 금융상품의 매수·매도 또는 투자 수익을 보장하는 **투자 권유가 아니다.**

- 분석은 입력된 자료의 범위를 넘지 않는다. 자료가 부족하면 "자료 부족"으로 표시된다.
- 확정적인 가격 예측이나 수익 보장을 하지 않도록 시스템 프롬프트와 응답 스키마가 제약한다.
- 모든 시나리오에는 그것이 틀렸음을 알 수 있는 **무효화 조건**이 함께 제시된다.
- 뉴스와 가격 변동 사이에 인과관계가 입증되지 않으면 상관관계와 인과관계를 구분해 서술한다.

투자 판단과 그 결과에 대한 책임은 이용자 본인에게 있다.
