# 아키텍처와 운영 한계

Phase 1 기준. 지금의 선택이 무엇을 얻고 무엇을 포기했는지, 그리고 언제 무엇으로 바꿔야 하는지를 기록한다.

---

## 1. 구조 개요

```
요청
 ↓ helmet · compression · cookieParser
 ↓ requestId 발급 + 자식 로거 바인딩
 ↓ [분석 요청만] IP rate limit → 본문 크기 제한 → 인증 → 세션 rate limit
 ↓ zod 검증 → 정규화·중복제거 → 출처 ID 부여
 ↓ 프롬프트 조립 (델리미터 구획) → 토큰 예산 사전 점검
 ↓ 캐시 조회 → 세마포어 획득 → 동일요청 병합 → 회로 차단기
 ↓ LLM 호출 (재시도 + 지수 백오프)
 ↓ 구조화 파싱 (2회) → 실패 시 Markdown 폴백
 ↓ URL 화이트리스트 후처리 → 캐시 저장 → 세션 연장
응답
```

`server.js` 하나에 담되 섹션 주석으로 구획한다. Phase 2에서 provider가 추가될 때 `lib/`로 분리하며, 그때도 실행 가능한 진입점은 `server.js`로 유지한다.

### 팩토리 + 조건부 listen

```js
export function createApp({ env, clock, llm, extraRoutes }) { ... }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp().app.listen(port);
}
```

주입하는 것은 셋뿐이다.

- **`clock`** — 세션 만료를 검증하려면 시간을 앞으로 돌려야 한다. 대안은 테스트에서 15분을 실제로 기다리는 것뿐이다.
- **`llm`** — 실제 API 키와 비용 없이 전체 파이프라인을 검증하기 위해서다.
- **`env`** — rate limit·TTL 한도를 테스트마다 다르게 주기 위해서다.

테스트 편의를 위한 그 이상의 추상화는 만들지 않았다.

---

## 2. 메모리 세션

### 장점

- 외부 의존이 없다. Redis를 띄우지 않아도 개발과 검증이 된다.
- 네트워크 왕복이 없어 지연이 사실상 0이다.
- 만료 처리가 단순하다. 조회 시점에 검사하고, `unref`된 sweeper가 주기적으로 청소한다.

### 한계

| 한계 | 영향 |
|---|---|
| 서버 재시작 시 전체 소실 | 배포·크래시 때마다 모든 사용자가 로그아웃된다 |
| 다중 인스턴스에서 동작하지 않음 | 인스턴스 A에서 로그인한 토큰이 B에서는 무효다 |
| 세션 수가 메모리에 비례 | 사용자가 늘면 프로세스 메모리가 함께 는다 |
| 자동 스케일링과 충돌 | 스케일 인 시 해당 인스턴스의 세션이 사라진다 |

### Redis로 전환하는 방법

`createSessionStore`의 인터페이스를 그대로 유지한 구현체로 교체하면 호출부는 바뀌지 않는다.

```
create()        → SET  session:<token> <json> EX <ttl초>
get(token)      → GET  session:<token>   (없으면 undefined; TTL 만료는 Redis가 처리)
destroy(token)  → DEL  session:<token>
touch(session)  → EXPIRE session:<token> <ttl초>
sweep()         → 불필요. Redis의 EXPIRE가 대신한다
size()          → 운영에서는 쓰지 않는다 (SCAN은 비싸다). 테스트 전용으로 남긴다
```

TTL을 Redis에 위임하면 `sweep()`과 조회 시점 만료 검사가 모두 사라진다. 다만 `get`이 네트워크 호출이 되므로 미들웨어가 `async`가 되고, 호출부의 `requireAuth`도 `async`로 바뀐다.

### 전환 시점

다음 중 하나라도 해당하면 전환한다.

- 서버를 2대 이상 띄운다
- 무중단 배포가 필요하다
- 자동 스케일링을 쓴다
- 재시작 후에도 로그인이 유지되어야 한다

---

## 3. 메모리 rate limit

`express-rate-limit`의 기본 저장소는 프로세스 메모리다.

**한계**: 인스턴스별로 독립 계산된다. N대를 띄우면 실질 한도가 **N배**가 된다. 로드밸런서가 요청을 분산할수록 방어가 약해진다.

### Redis로 통합하는 방법

```js
import RedisStore from 'rate-limit-redis';

rateLimit({
  store: new RedisStore({ sendCommand: (...args) => redisClient.sendCommand(args) }),
  windowMs: config.analyzeRateWindowMs,
  limit: config.analyzeRateMax,
  // keyGenerator는 그대로 유지한다
});
```

세션 저장소와 같은 Redis 인스턴스를 쓰되 키 접두어를 분리한다 (`rl:` / `session:`).

### `trust proxy` 주의사항

리버스 프록시(nginx, ALB, Cloudflare) 뒤에 배포하면 `TRUST_PROXY=true`가 **필수**다.

- **설정하지 않으면**: 모든 요청이 프록시 IP 하나로 집계된다. 한 사용자가 한도를 채우면 전체 사용자가 함께 차단된다.
- **프록시 없이 켜면**: 클라이언트가 `X-Forwarded-For` 헤더를 위조해 한도를 무한히 우회할 수 있다.

즉 이 설정은 배포 형태와 반드시 일치해야 한다. 어느 쪽으로든 틀리면 방어가 무너진다.

### IPv6

커스텀 `keyGenerator`에서 IP로 폴백할 때는 반드시 `ipKeyGenerator(req.ip, 56)`을 쓴다. 생 `req.ip`를 반환하면 IPv6 사용자가 같은 /64 안에서 주소를 바꿔가며 한도를 우회할 수 있고, 라이브러리도 이를 `ERR_ERL_KEY_GEN_IPV6`로 거부한다.

---

## 4. 캐시 키 설계

```js
hashRequest({ items, marketData, analysisPeriod, model: config.openaiModel })
```

SHA-256 16진 문자열이며, 직렬화 전에 객체 키를 재귀적으로 정렬한다. 따라서 **키 순서만 다른 요청은 같은 캐시 키**가 된다.

### 무엇을 키에 넣었고 왜인가

| 포함 | 이유 |
|---|---|
| `items` (정규화 **후**) | 중복 제거·정규화를 거친 결과가 실제 분석 입력이다. 원본을 키로 쓰면 공백만 다른 요청이 캐시를 못 맞춘다 |
| `marketData` | 같은 뉴스라도 시장 데이터가 다르면 분석이 달라진다 |
| `analysisPeriod` | 프롬프트에 들어가므로 결과에 영향을 준다 |
| `model` | **모델이 바뀌면 결과가 달라진다.** 넣지 않으면 모델 교체 후에도 옛 모델의 결과를 계속 돌려준다 |

| 제외 | 이유 |
|---|---|
| 세션 토큰 | 캐시를 사용자 간에 공유하기 위해서다. 같은 자료면 같은 분석이다 |
| `collectedAt` | 매 요청 달라지므로 넣으면 캐시가 절대 맞지 않는다 |
| `requestId` | 위와 같다 |

### 캐시가 저장하는 것

`analysis`(URL 후처리 **완료 후**)와 `meta`의 일부(`fabricatedUrlsRemoved`, `degraded`, `model`)만 저장한다. `collectedAt`·`sourceCount`는 매 요청 새로 계산한다. 후처리 후를 저장하는 이유는 캐시 히트마다 같은 후처리를 반복하지 않기 위해서다.

### Redis 전환 시

`createTtlCache`의 `get`/`set` 인터페이스를 유지한 구현체로 교체한다. TTL은 `SETEX`에 위임하고, LRU 축출은 Redis의 `maxmemory-policy allkeys-lru`에 맡긴다.

---

## 5. 장애 시 fallback 전략

### LLM 상류 장애

1. **재시도** — `OPENAI_MAX_RETRIES`(기본 2)회까지, 지수 백오프 + 지터
2. **회로 차단** — 연속 `BREAKER_THRESHOLD`(기본 5)회 실패 시 OPEN. 쿨다운 동안 상류를 호출하지 않고 즉시 `503 CIRCUIT_OPEN`을 반환한다
3. **half-open 시험** — 쿨다운 후 한 번만 통과시켜 상류 회복을 확인한다. 실패하면 쿨다운을 다시 시작한다

회로가 열려 있는 동안 요청을 큐에 쌓지 않는다. 즉시 거절하는 편이 사용자에게도 비용에도 낫다.

### 구조화 출력 실패

구조화 2회 → Markdown 폴백 1회 → `502 PARSE_FAILED`. 폴백으로 응답할 때는 `meta.degraded: true`로 클라이언트에 알린다. **품질 저하를 조용히 숨기지 않는다.**

### Redis 도입 후 Redis가 죽으면

두 가지 선택지가 있고, 트레이드오프가 다르다.

| 전략 | 장점 | 단점 |
|---|---|---|
| **메모리로 degrade** | 서비스가 계속된다 | rate limit이 인스턴스별로 쪼개져 방어가 약해진다. 세션은 인스턴스에 묶인다 |
| **요청 거부 (503)** | 방어 보장이 유지된다 | 서비스가 멈춘다 |

**권장**: 세션은 degrade하지 말고 `503`을 반환한다 (인증이 인스턴스마다 달라지면 디버깅이 불가능해진다). rate limit은 메모리로 degrade하되 한도를 보수적으로 낮춘다. 어느 쪽이든 degrade 사실을 반드시 로그와 메트릭에 남긴다.

---

## 6. 토큰 추정의 한계

`estimateTokens`는 `문자수 / 4`다. 이는 영어 기준 경험칙이며 **한국어에서는 실제보다 낮게 나온다.** 한글은 토큰당 문자 수가 영어보다 적기 때문이다.

즉 이 추정은 안전한 방향으로 틀리지 않는다 — 실제 토큰이 추정보다 많을 수 있다. 그래서 `MAX_INPUT_TOKENS` 기본값(30,000)을 모델 컨텍스트 한도보다 크게 낮춰 잡았다.

**개선 방향**: `tiktoken` 같은 실제 토크나이저를 쓰면 정확해지지만 의존성과 초기화 비용이 붙는다. Phase 2에서 실제 사용 데이터를 보고 판단한다.

---

## 7. 단일 공유 비밀번호

현재 인증은 `MY_SECRET_PASSWORD` 하나를 모든 사용자가 공유한다. 사용자 구분이 없으므로 누가 무엇을 했는지 추적할 수 없고, 유출 시 전체를 교체해야 한다.

### 확장 경로

1. `users` 테이블 도입 — `id`, `email`, `passwordHash`(bcrypt/argon2), `createdAt`
2. `safeCompare(password, config.secretPassword)`를 `verifyHash(password, user.passwordHash)`로 교체
3. 세션에 `userId` 추가 — 세션 rate limit 키를 토큰 대신 `userId`로 바꿀 수 있다
4. 캐시 키는 그대로 둔다. 자료가 같으면 분석도 같으므로 사용자 간 공유가 바람직하다

세션 저장소 인터페이스는 `create()`가 `userId`를 받도록 하는 것 외에 바뀌지 않는다.

---

## 8. Phase 2·3에서 반드시 다뤄야 할 것

| 항목 | 단계 | 이유 |
|---|---|---|
| **SSRF 방어** | Phase 2 | provider가 외부 URL을 fetch하기 시작한다. 도메인 허용목록과 사설 IP 대역(`127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, IPv6 링크로컬) 차단이 필수다. 리다이렉트 추적 시 매 홉마다 재검사해야 한다 |
| **XSS 방어** | Phase 3 | LLM 응답을 HTML로 렌더링한다. `dangerouslySetInnerHTML` 없이 렌더링하거나 sanitizer를 거쳐야 한다. Markdown 폴백 경로가 특히 위험하다 |
| **외부 응답 크기 제한** | Phase 2 | provider가 거대한 응답을 받으면 메모리가 터진다 |
| **provider별 회로 차단기** | Phase 2 | 지금은 LLM용 하나뿐이다. provider마다 독립적으로 필요하다 |
