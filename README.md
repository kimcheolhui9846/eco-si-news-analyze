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
| **Phase 1** | 인증·세션, API 비용 방어, 분석 엔진, 예산 통제 | ✅ 완료 |
| **Phase 2a** | 뉴스·시장 데이터 커넥터, `/api/research/collect`, SSRF 방어 | ✅ 완료 |
| **Phase 3** | React 프론트엔드 — 로그인·검색·검토·보고서 4화면 | ✅ 완료 |
| Phase 2b | 재무지표·논문·실험 provider | 미착수 |

**브라우저에서 검색어 하나로 뉴스와 시장 데이터를 모아 분석 보고서까지 볼 수 있다.**
`/api/analyze/news`는 여전히 클라이언트가 자료를 직접 넣는 경로도 지원한다.

### 화면 흐름

```
로그인 → 검색 → (수집 중) → 검토 → (분석 중) → 보고서
                              │                    │
                    비용 승인 지점            차트 + 분석 + 출처
```

**검토 화면이 돈을 쓸지 정하는 유일한 지점이다.** 하단 고정 바에 예상 비용, 남은 예산,
그리고 제목만 확보된 자료 수가 함께 표시된다. 승인 전에는 LLM이 호출되지 않는다.

---

## 시스템 구성

```
POST /api/research/collect  (무료 — LLM 미호출)
 ↓ 종목 해석: 직접 입력 티커 → 회사(별칭 → SEC/OpenDART 디렉터리) → 분야 묶음(최대 4종목) → 미해석
 ↓ 뉴스 RSS + 시장 차트 병렬 수집 (허용목록·회로차단기·캐시)
 ↓ 차트 지표를 코드가 계산 → chartTrend 문장
 ↓ 정규화 → 견적 → 확인 토큰 발급
   ↓
POST /api/analyze/news  (X-Confirm-Token 필수 — 여기서 비용 발생)
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

Node.js 22 이상이 필요하다 (개발·검증은 24.18.0에서 했다).

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
| `TRUST_PROXY` | `false` | **리버스 프록시 뒤 배포 시 반드시 `true`.** 안 켜면 `req.ip`가 프록시 주소가 되어 rate limit이 전체 트래픽을 한 통으로 센다 |
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
| `CORS_ORIGIN` | `http://localhost:3000` | **현재 미사용** — 동일 출처라 CORS 미들웨어를 붙이지 않았다 |
| `EXTERNAL_TIMEOUT_MS` | `10000` | 외부 API 타임아웃 |
| `MAX_EXTERNAL_RESPONSE_BYTES` | `2000000` | 외부 응답 크기 상한 |
| `EXTERNAL_ALLOWLIST` | (`lib/config.js` 기본값) | **허용목록. 여기 없는 호스트로는 요청이 나가지 않는다** |
| `PROVIDER_BREAKER_THRESHOLD` / `_COOLDOWN_MS` | `3` / `60000` | provider별 회로 차단기 |
| `NEWS_CACHE_TTL_MS` | `300000` | 뉴스 피드 캐시 |
| `MARKET_CACHE_TTL_MS` | `60000` | 시장 차트 캐시 |
| `RESEARCH_RATE_WINDOW_MS` / `_MAX` | `900000` / `60` | 수집 rate limit |
| `FINANCIAL_CACHE_TTL_MS` | `86400000` | SEC 재무지표 캐시. 분기 실적은 하루에 여러 번 바뀌지 않는다 |
| `OPENDART_API_KEY` | (비어 있음) | 선택. 한국 상장사 재무(OpenDART). 비어 있으면 한국 재무만 사유와 함께 빠진다. 허용목록에 `opendart.fss.or.kr` 필요 |
| `DART_CACHE_TTL_MS` | `21600000` | OpenDART 재무 캐시(6시간) |
| `RESEARCH_CACHE_TTL_MS` | `3600000` | 논문 캐시 |
| `EXPERIMENT_CACHE_TTL_MS` | `3600000` | 임상시험 캐시 |
| `MAX_RESEARCH_ITEMS` | `5` | 수집할 논문 수 상한 |
| `MAX_EXPERIMENT_ITEMS` | `5` | 수집할 임상시험 수 상한 |
| `KCI_API_KEY` | (빈 값) | **선택.** 국내 논문 검색용. 아래 설명 참고 |
| `RESEARCH_CONTACT_EMAIL` | (빈 값) | **선택.** Crossref polite pool 연락 이메일 |

**키 없는 논문 검색.** 한국어·영문 논문은 OpenAlex를 기본으로 조회하고, 결과가 부족하면 Crossref를 보조로 조회한다. 두 소스 모두 API 키 없이 사용할 수 있다. Crossref polite pool을 사용하려면 선택적으로 `RESEARCH_CONTACT_EMAIL`을 설정한다.

**`KCI_API_KEY`에 대하여.** `open.kci.go.kr`에서 무료로 발급한다. 신청서에 **공인 IP**를
적어야 하고 등록된 IP에서 온 요청만 받는다. IP는 여러 개 등록할 수 있다.

비워 두면 한국어 검색어의 논문 결과가 "자료 부족"으로 나가고 사유가 함께 표시된다.
**서버 기동과 나머지 기능에는 영향이 없다** — 뉴스·차트·재무·영문 논문·임상시험은 그대로 동작한다.

가정용 회선은 유동 IP라 공유기 재부팅이나 임대 갱신만으로 바뀔 수 있다. 그때는 아무 오류도
나지 않고 국내 논문 섹션만 조용히 비어 나오므로, 그 상황을 전용 문구로 알린다.

키를 받으면 `./scripts/verify-kci.sh`로 동작을 확인한다. 이 스크립트는 ASCII·UTF-8·EUC-KR
세 방식으로 질의해 어느 것이 통하는지 판정하고, 정상 응답이면 XML 요소 이름을 출력한다.
출력과 저장 파일에서 키는 가려진다.

</details>

---

## 실행

```bash
npm run build:client   # 프론트엔드 빌드 (최초 1회, 또는 UI 변경 후)
npm start              # 서버 기동 → http://localhost:3000
npm test               # 테스트 (API 키·네트워크 불필요)
```

빌드하면 Express가 프론트엔드를 함께 서빙한다. **동일 출처라 CORS 설정이 필요 없다.**

프론트엔드 개발 중에는 Vite dev 서버를 따로 띄운다.

```bash
npm start        # 터미널 1 — 백엔드 (3000)
npm run dev:client   # 터미널 2 — Vite (5173, /api를 3000으로 프록시)
```

> **`client` 디렉터리에서 직접 `npm install`하지 말 것.** npm workspace로 묶여 있어
> 루트에서 설치해야 한다. client에 React 사본이 생기면 훅이 깨진다.

**API 키 없이 전체 동작을 보고 싶다면:**

```bash
MY_SECRET_PASSWORD=test-pw LLM_MODE=mock npm start
```

`LLM_MODE=mock`은 결정적인 가짜 응답을 돌려준다. 모든 응답에 `[MOCK]` 표시가 붙으므로
실제 분석으로 오인할 수 없다.

---

## 배포

Render 무료 인스턴스에 올린다. 설정은 저장소의 `render.yaml`이 단일 출처다.
설계 근거는 `docs/superpowers/specs/2026-09-06-deployment-design.md`에 있다.
https://eco-si-news-analyze.onrender.com/
### 절차

1. [render.com](https://render.com)에서 GitHub 저장소를 연결한다 (비공개 저장소도 된다)
2. Blueprint로 `render.yaml`을 읽히거나, 안 되면 대시보드에 같은 값을 넣는다
3. 대시보드 Environment에 비밀값 둘을 넣는다 — 저장소에는 없다

   | 변수 | 값 |
   |---|---|
   | `MY_SECRET_PASSWORD` | 로그인 비밀번호. **공개 인터넷이므로 길게 잡는다** |
   | `OPENAI_API_KEY` | OpenAI 키 |

4. 배포 후 확인한다

   ```bash
   curl https://<앱이름>.onrender.com/api/health          # llmMode: live
   ./scripts/verify-research.sh https://<앱이름>.onrender.com
   MY_SECRET_PASSWORD=<값> ./scripts/verify.sh https://<앱이름>.onrender.com
   ```

**첫 요청은 약 1분 걸린다.** 정지 상태에서 깨어나는 시간이다. 검증 스크립트가
타임아웃으로 실패하면 결함이 아니므로, 먼저 `/api/health`를 한 번 불러 깨워 두고 시작한다.

### 무료 인스턴스의 한계

1. **예산 파일이 휘발한다.** 정지·재배포마다 `.budget.json`이 사라져 하루 50회·월 상한
   카운터가 0으로 돌아간다. **실제 지출 상한은 OpenAI 계정 Billing에서 걸어야 한다.**
   앱 예산은 한 세션 안에서만 유효하다
2. **15분 유휴 후 정지한다.** 다시 깨우는 데 약 1분
3. **KCI를 쓸 수 없다.** 아웃바운드 IP가 유동이라 허용목록에 등록할 수 없다.
   한국어 검색어의 논문은 사유와 함께 비어 나간다
3-1. **기존 배포의 시장 차트 수집 실패.** Yahoo 차트 API와 CoinGecko 접근 실패가
   운영 검증에서 관측됐다. Task 6은 Naver/Coinbase로 교체하며, 새 소스의 Render 동작은
   아직 검증하지 않았다. 최신 검증 상태는 [`HANDOFF.md`](HANDOFF.md)를 참고한다.
4. **월 750 instance-hours.** 개인 사용에는 넉넉하지만 계속 깨워 두면 한도에 붙는다
5. **인스턴스를 늘리면 안 된다.** 이유는 `docs/architecture.md` 참고
6. **비밀번호 하나가 유일한 인증이고 공개 인터넷에 노출된다**

1·2·3이 거슬리면 Fly.io로 옮긴다. 항상 켜진 소형 머신 월 $2~3, 볼륨 $0.15/GB,
전용 IPv4 $2로 세 가지를 모두 푼다.

---

## API 사용 예시

전체 명세는 [`docs/api.md`](docs/api.md)에 있다.

### 검색으로 시작하기 (Phase 2a)

```bash
TOKEN=$(curl -sS -X POST http://localhost:3000/api/auth/login   -H 'Content-Type: application/json'   -d '{"password":"your-password"}'   | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

# 1) 수집 — 무료. 무엇이 모였는지 보고 분석 여부를 정한다.
#    한글이 깨지지 않도록 요청 본문은 파일로 만든다.
node -e "require('fs').writeFileSync('/tmp/req.json', JSON.stringify({
  query: '엔비디아 AI 반도체', symbol: 'NVDA', lang: 'ko', maxNews: 8
}), 'utf8')"

curl -sS -X POST http://localhost:3000/api/research/collect   -H 'Content-Type: application/json; charset=utf-8'   -H "Authorization: Bearer $TOKEN"   --data-binary @/tmp/req.json > /tmp/collected.json

# 2) 수집 결과로 분석 — 여기서 비용이 발생한다.
CONFIRM=$(node -pe "require('/tmp/collected.json').confirmToken")
node -e "
  const c = require('/tmp/collected.json');
  const body = { newsList: c.newsList };
  // 시세·재무가 있는 종목만 싣고 차트용 series는 뺀다. 빈 자료는 필드를 생략한다.
  const inst = (c.instruments || []).filter(i => i.marketData || i.financial).map(({ series, ...rest }) => rest);
  if (inst.length) body.instruments = inst;
  if (c.collected && c.collected.resolution && c.collected.resolution.sector) body.sector = c.collected.resolution.sector;
  if (c.research && c.research.length) body.research = c.research;
  if (c.experiments && c.experiments.length) body.experiments = c.experiments;
  require('fs').writeFileSync('/tmp/analyze.json', JSON.stringify(body), 'utf8');
"

curl -X POST http://localhost:3000/api/analyze/news   -H 'Content-Type: application/json; charset=utf-8'   -H "Authorization: Bearer $TOKEN"   -H "X-Confirm-Token: $CONFIRM"   --data-binary @/tmp/analyze.json
```

자동 검증:

```bash
MY_SECRET_PASSWORD=your-password ./scripts/verify-research.sh
```

### 자료를 직접 넣기 (Phase 1 경로)

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
  "instruments": [{
    "symbol": "NVDA", "name": "NVIDIA", "assetType": "stock", "market": "US",
    "marketData": {
      "assetName": "엔비디아",
      "currentPrice": "182.50",
      "priceChange": "+2.3%",
      "chartTrend": "20일 이동평균 상회"
    }
  }]
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

**Phase 2a의 provider는 전부 API 키가 필요 없다.**

| provider | 소스 | 키 |
|---|---|---|
| 뉴스 (검색) | Google News RSS (한국어·영어) | 불필요 |
| 뉴스 (주제) | 연합뉴스·전자신문 RSS, Yahoo Finance 티커 RSS | 불필요 |
| 주식 시세 | Naver 일봉 (매핑되지 않은 심볼은 기존 Yahoo Finance 경로) | 불필요 |
| 코인 시세 | Coinbase Exchange BTC/ETH/SOL/XRP 일봉 (그 외 기존 CoinGecko 경로) | 불필요 |

Task 6의 새 소스는 완료된 일봉 종가를 사용한다. Coinbase 가격은 해당 거래소의 USD 가격이며,
기존 CoinGecko 집계 가격과 차이가 날 수 있다. 응답의 `chartTrend`에 출처와 기준을 표시한다.
지원되는 새 소스가 실패하면 시장 자료 없이 부분 결과를 반환한다.

운영 환경에서 `EXTERNAL_ALLOWLIST`를 직접 설정했다면 기존 호스트와 함께
`api.stock.naver.com`, `m.stock.naver.com`, `api.exchange.coinbase.com`을 포함해야 한다.
환경변수를 생략하면 코드 기본 허용목록을 사용한다.

### 피드 추가·변경

`lib/providers/feeds.js`의 `FEEDS` 배열에 항목을 추가한다.

```js
{
  id: 'my-feed',
  name: '표시할 매체명',
  kind: 'topic',            // 'search'면 urlTemplate에 {query}를 넣는다
  lang: 'ko',
  contentKind: 'summary',   // description에 본문이 있으면 summary, 없으면 headline
  url: 'https://example.com/rss.xml',
}
```

**새 호스트는 `EXTERNAL_ALLOWLIST`에도 추가해야 한다.** 허용목록에 없으면 요청 자체가 나가지 않는다.

### 종목·분야 추가

회사는 `lib/providers/aliases.js`의 `SYMBOL_ALIASES`(한글명 별칭)와 디렉터리 스냅샷
(`data/us-tickers.json`, `data/kr-listed.json`)에서 찾는다. 스냅샷은
`node scripts/refresh-directory.js`로 갱신한다(한국 상장사는 `OPENDART_API_KEY` 필요).
분야 묶음은 `lib/providers/sectors.js`의 분야 사전이 정하며 묶음당 최대 4종목이다.

```js
'회사이름': { symbol: '123456.KS', assetType: 'stock', name: '회사이름' },
```

사전에 없으면 요청에 `symbol`을 직접 넣으면 된다.

> **Naver 주식과 기존 Yahoo Finance 경로는 비공식 엔드포인트다.** 예고 없이
> 바뀌거나 차단될 수 있다. 개인 리서치 용도의 저빈도 호출을 전제로 하며,
> 상용 서비스로 전환한다면 정식 시장 데이터 API로 교체해야 한다.

### 뉴스 본문의 한계

**분석은 기사 전문이 아니라 제목 또는 리드 문단에 근거한다.**

검색이 되는 소스(Google News RSS)에는 본문이 없고, 본문이 있는 언론사 RSS는 검색이 안 된다.
전문을 얻으려면 언론사 페이지를 크롤링해야 하는데, SSRF 표면·사이트별 파싱·약관 문제가
한꺼번에 딸려와 하지 않는다.

각 자료에 `contentKind`(`headline`/`summary`/`full`)를 붙여 LLM이 제목만 보고 본문을
추론하지 못하게 막고, 응답의 `headlineOnlyCount`로 사용자도 한계를 미리 안다.

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

**379개 테스트가 실제 API 키와 외부 네트워크 없이 전부 통과한다.** `LLM_MODE=mock`, 주입된 시계, 주입된 http 클라이언트와 `tests/fixtures/`의 실제 API 응답을 쓴다.

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
| `tests/http.test.js` | 외부 호출 방어 (허용목록·리다이렉트·크기·타임아웃) |
| `tests/rss.test.js` | RSS 파싱, 피드 레지스트리, XXE |
| `tests/news-provider.test.js` | 뉴스 수집, 부분 실패, 캐시·회로차단기 |
| `tests/indicators.test.js` | 차트 지표 계산, 추세 문장 |
| `tests/market-provider.test.js` | 시세 조회 |
| `tests/research.test.js` | 수집 엔드포인트 통합 |
| `tests/static.test.js` | 정적 서빙, SPA 폴백이 API를 삼키지 않는지 |
| `tests/client/errors.test.js` | 에러 코드 → 메시지·다음 화면 매핑 |
| `tests/client/format.test.js` | 날짜·통화·비용 표기 |
| `tests/client/chart.test.js` | 차트 좌표 계산, 이동평균 |
| `tests/client/api-client.test.js` | fetch 래퍼, 토큰 미저장 |
| `tests/client/components.test.jsx` | 컴포넌트 렌더링, **XSS 방어** |
| `tests/client/pages.test.jsx` | 화면별 동작 |
| `tests/client/app-flow.test.jsx` | 전체 흐름과 오류 복구 |

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
7. **Yahoo Finance 의존을 재검토할 것.** 비공식 엔드포인트라 예고 없이 바뀔 수 있다.
8. **RSS 피드는 죽는다.** 검증 중 매일경제 RSS가 이미 `403`이었다. `degraded` 필드를 모니터링할 것.

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
