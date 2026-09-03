# 보안 점검 결과

원본 요구사항 §19 체크리스트를 구현 위치·검증 테스트와 함께 대조한다.
`✅` 구현·검증됨 · `⚠️` 부분적이거나 이 단계 범위 밖 · `❌` 미구현

---

## 1. 비밀정보 관리

| 점검 항목 | 상태 | 구현 위치 | 검증 |
|---|---|---|---|
| API 키가 프론트엔드 번들에 포함되지 않았는가 | ✅ | 프론트엔드가 없다. 키는 `loadConfig`가 서버 프로세스에서만 읽는다 | Phase 3에서 재확인 필요 |
| `.env`가 Git에 포함되지 않았는가 | ✅ | `.gitignore` 1행 — `.env`, `.env.*`, `!.env.example` | `git ls-files`로 확인 (Task 12 Step 10) |
| 비밀번호가 로그에 남지 않는가 | ✅ | `createLogger`의 pino `redact`에 `password`, `*.password`. 로그인 실패 시 값 없이 `req.log.warn('로그인 실패')`만 기록 | 실서버 로그 확인 — `requestId`만 남음 |
| 세션 토큰이 로그에 남지 않는가 | ✅ | `redact`에 `token`, `*.token`, `req.headers.authorization`, `req.headers.cookie`. 로그인 성공 시에도 토큰을 찍지 않는다 | 실서버 로그 확인 |
| 기사 본문이 로그에 남지 않는가 | ✅ | `redact`에 `newsList`, `*.newsList` | — |

## 2. 세션

| 점검 항목 | 상태 | 구현 위치 | 검증 |
|---|---|---|---|
| 세션 토큰이 예측 불가능한가 | ✅ | `randomBytes(32).toString('base64url')` — 256비트 | `auth.test.js` — "발급되는 토큰은 매번 다르고 충분히 길다" |
| 로그아웃 시 서버 메모리에서 삭제되는가 | ✅ | `POST /api/auth/logout` → `sessions.destroy` | `auth.test.js` — "로그아웃은 세션을 메모리에서 즉시 삭제한다" |
| 만료 세션이 자동 삭제되는가 | ✅ | `sessions.get`이 조회 시점에 삭제 + `unref`된 sweeper가 60초마다 청소 | `auth.test.js` — "만료된 세션은 403을 반환하고 메모리에서 삭제된다", "sweep은 만료 세션만 제거한다" |
| 비밀번호 비교가 타이밍 공격에 안전한가 | ✅ | `safeCompare` — SHA-256으로 길이를 고정한 뒤 `timingSafeEqual` | `auth.test.js` — "비밀번호 길이가 달라도 예외 없이 403을 반환한다" |
| 세션이 부적절하게 연장되지 않는가 | ✅ | `sessions.touch`는 분석 `200` 응답 직전 한 곳에서만 호출된다 | `auth.test.js` — "미들웨어 통과만으로는 세션이 연장되지 않는다"<br>`analyze.test.js` — "검증 실패로는", "LLM 실패로는 세션이 연장되지 않는다" |

## 3. 인증 게이트

| 점검 항목 | 상태 | 구현 위치 | 검증 |
|---|---|---|---|
| 인증 실패 시 OpenAI API가 호출되지 않는가 | ✅ | `requireAuth`를 라우트 핸들러보다 **먼저** 등록해 구조적으로 보장. 미들웨어가 예외를 던지면 핸들러에 도달하지 않는다 | `analyze.test.js` — "인증 없이 분석을 요청하면 403이고 LLM을 호출하지 않는다" (mock 호출 카운터로 확인), "만료된 세션으로 요청하면", "로그아웃 후 같은 토큰으로" |
| 로그아웃된 토큰이 차단되는가 | ✅ | 위와 같음 | `scripts/verify.sh` 8단계 |

## 4. 요청 크기와 비용

| 점검 항목 | 상태 | 구현 위치 | 검증 |
|---|---|---|---|
| 요청 길이가 제한되는가 | ✅ | `express.json({ limit })`, zod 문자열 상한, `MAX_PROMPT_CHARS`, `MAX_INPUT_TOKENS` | `analyze.test.js` — "본문 크기 상한을 넘으면 413", "토큰 예산을 넘으면 LLM 호출 전에 거부한다"<br>`validation.test.js` — 길이·개수 제한 다수 |
| rate limit이 동작하는가 | ✅ | `makeLoginLimiter` / `makeAnalyzeLimiter` / `makeSessionLimiter` | `costdefense.test.js` — "로그인 rate limit을 넘기면 429" |
| IPv6로 rate limit을 우회할 수 없는가 | ✅ | 커스텀 `keyGenerator`에서 `ipKeyGenerator(req.ip, 56)` 사용 | 라이브러리가 생 `req.ip` 사용 시 `ERR_ERL_KEY_GEN_IPV6`로 거부 |
| 총 비용에 상한이 있는가 | ✅ | `createBudgetTracker` — 일일 호출 수 + 월 누적 비용(USD). rate limit과 달리 시간 창으로 리셋되지 않는다 | `budget.test.js` — "비용 상한을 넘길 요청은 호출 전에 거부한다" 외 다수 |
| 서버 재시작으로 예산이 리셋되지 않는가 | ✅ | 예산 상태를 `BUDGET_FILE`에 영속화. 임시 파일 쓰기 후 `rename`이라 쓰는 도중 죽어도 파일이 깨지지 않는다 | `budget.test.js` — "예산 상태가 파일에 저장되어 재시작 후에도 유지된다" + 실서버 재시작 확인 |
| 의도치 않은 비용 지출이 방지되는가 | ✅ | 비용이 드는 호출은 `POST /api/analyze/estimate`로 견적을 받고 일회용 확인 토큰을 붙여야 실행된다 | `budget.test.js` — "확인 토큰 없이 분석하면 428", "다른 요청 내용으로는 확인 토큰을 쓸 수 없다" |
| 동시 요청이 제한되는가 | ✅ | `createSemaphore` — 대기열 없이 즉시 거절 | `analyze.test.js` — "동시 분석 한도를 넘으면 429" |
| 중복 호출이 방지되는가 | ✅ | TTL 캐시 + in-flight 병합 | `analyze.test.js` — "같은 요청을 두 번 보내면 두 번째는 캐시에서 온다"<br>`costdefense.test.js` — "같은 키의 동시 요청은 하나의 실행을 공유한다" |
| timeout이 동작하는가 | ✅ | OpenAI 클라이언트 `timeout` + `classifyLlmError`가 504로 변환 | `analyze.test.js` — "LLM 타임아웃은 504를 반환한다" |

## 5. 프롬프트 인젝션

| 점검 항목 | 상태 | 구현 위치 | 검증 |
|---|---|---|---|
| 프롬프트 인젝션 방어가 있는가 | ✅ | ① 시스템 프롬프트는 서버 상수 — 사용자 입력이 `system` role에 도달할 경로가 없다<br>② 외부 자료를 델리미터로 구획<br>③ `escapeDelimiters`가 자료 내 델리미터를 무력화<br>④ zod `strictObject`가 `systemPrompt`·`messages`·`model` 등을 거부 | `analyze.test.js` — "사용자 입력은 시스템 프롬프트를 덮어쓸 수 없다"<br>`prompt.test.js` — "조립된 프롬프트 안에 델리미터가 정확히 한 쌍만 존재한다"<br>`validation.test.js` — "허용되지 않은 최상위 필드를 거부한다" |
| 검색 결과 내부 지시문이 데이터로만 취급되는가 | ✅ | 시스템 프롬프트 13·14번 원칙 + 델리미터 취급 규칙 명시 | `prompt.test.js` — "시스템 프롬프트에 핵심 방어 규칙이 들어 있다" |
| 제어문자로 로그·출력을 오염시킬 수 없는가 | ✅ | `stripControlChars`가 제어문자와 ANSI 이스케이프 제거 | `validation.test.js` — "제어문자와 ANSI 이스케이프를 제거한다" |

## 6. 출처 무결성

| 점검 항목 | 상태 | 구현 위치 | 검증 |
|---|---|---|---|
| LLM이 존재하지 않는 URL을 만들어내지 못하는가 | ✅ | `stripFabricatedUrls`가 응답을 재귀 순회하며 입력 화이트리스트에 없는 URL을 `[출처 미확인]`으로 치환. **프롬프트 지시가 아니라 결정적 후처리로 강제** | `analyze.test.js` — "LLM이 지어낸 URL을 제거하고 카운트한다"<br>`postprocess.test.js` — 8개 케이스 |
| 출처 목록이 위조될 수 없는가 | ✅ | `sources`는 `buildSources`가 입력 자료에서 생성한다. LLM 응답 스키마에 `sources`가 아예 없다 | `llm.test.js` — "스키마에 sources가 없다"<br>`postprocess.test.js` — "출처 목록은 입력 자료에서 서버가 만든다" |

## 7. HTTP 보안

| 점검 항목 | 상태 | 구현 위치 | 검증 |
|---|---|---|---|
| CORS가 제한되어 있는가 | ✅ Phase 3에서 해결 | 동일 출처가 되어 CORS 미들웨어 자체가 불필요해졌다. §10 참조 | `static.test.js` |
| Helmet 또는 동등한 보안 헤더가 적용되는가 | ✅ | `app.use(helmet())` + `app.disable('x-powered-by')` | — |
| 에러 응답에 내부 정보가 노출되지 않는가 | ✅ | 에러 핸들러가 `ApiError`가 아닌 예외는 고정 메시지로 바꾼다. 상류 원본 메시지도 `classifyLlmError`가 감싼다 | `errors.test.js` — "예상치 못한 예외는 내부 정보를 노출하지 않는다" (스택·내부 문자열 부재 확인) |
| 요청 ID를 클라이언트가 위조할 수 없는가 | ✅ | 항상 서버가 `randomUUID()`로 발급하고 클라이언트 헤더는 무시 | `errors.test.js` — "클라이언트가 보낸 X-Request-Id를 신뢰하지 않고 새로 발급한다" |
| 운영환경에서 HTTPS 및 Secure 쿠키를 사용하는가 | ⚠️ | 코드는 `NODE_ENV=production`에서 `Secure` 플래그를 붙인다. **HTTPS 종단 자체는 배포 환경(리버스 프록시·로드밸런서)의 책임**이며 앱이 보장할 수 없다 | `auth.test.js` — "운영 환경에서는 Secure 쿠키를 쓴다" |

## 8. 이 단계 범위 밖

| 점검 항목 | 상태 | 사유와 후속 계획 |
|---|---|---|
| 외부 URL fetch가 SSRF 취약점을 만들지 않는가 | ✅ Phase 2a에서 구현 | §9 참조 |
| 허용되지 않은 도메인 접근을 막는가 | ✅ Phase 2a에서 구현 | §9 참조 |
| 외부 응답 HTML의 스크립트를 실행하지 않는가 | ✅ | 서버는 HTML을 파싱하거나 실행하지 않는다. 입력은 JSON 문자열로만 다룬다 |
| LLM 응답을 HTML로 렌더링할 때 XSS를 방지하는가 | ✅ Phase 3에서 구현 | §10 참조 |
| 단일 서버 메모리 세션의 한계를 문서화했는가 | ✅ | `docs/architecture.md` §2 — 장점·한계·Redis 전환 방법·전환 시점 |

---

## 9. 외부 호출 방어 (Phase 2a)

| 점검 항목 | 상태 | 구현 위치 | 검증 |
|---|---|---|---|
| 외부 URL fetch가 SSRF를 만들지 않는가 | ✅ | `createHttpClient`가 호스트 허용목록을 강제. 호출 대상 호스트는 코드 상수이며 사용자 입력이 호스트를 결정하지 못한다 | `http.test.js` — "허용목록에 없는 호스트를 차단한다" |
| 서브도메인 우회가 막히는가 | ✅ | 정확히 일치 비교. `endsWith`를 쓰지 않는다 | `http.test.js` — "서브도메인을 허용목록 항목으로 착각하지 않는다" |
| 리다이렉트로 허용목록을 우회할 수 없는가 | ✅ | `redirect: 'manual'`, 3xx는 실패 처리 | `http.test.js` — "3xx 리다이렉트를 따라가지 않고 실패로 처리한다" |
| 평문 통신을 막는가 | ✅ | `https:`만 허용 | `http.test.js` — "http 스킴을 거부한다" |
| 외부 응답 크기가 제한되는가 | ✅ | Content-Length 선검사 + 본문 길이 검사 | `http.test.js` — "Content-Length가 상한을 넘으면 본문을 읽기 전에 거부한다" |
| 언론사 페이지를 크롤링하지 않는가 | ✅ | RSS 링크를 fetch하지 않는다. 이것이 SSRF 표면을 좁게 유지하는 실질적 근거다 | 설계상 보장 |
| XXE가 막히는가 | ✅ | `fast-xml-parser`가 외부 엔티티를 거부한다 (`External entities are not supported`) | `rss.test.js` — "외부 엔티티(XXE)가 확장되지 않는다" |
| 외부 응답이 프롬프트를 오염시키지 못하는가 | ✅ | Phase 1의 델리미터 구획·`escapeDelimiters`·`stripControlChars`가 그대로 적용된다 | `research.test.js` — "RSS에 심어진 지시문이 데이터 구획에 갇힌다" |
| provider 장애가 서비스 전체를 멈추지 않는가 | ✅ | provider별 독립 회로 차단기 + 부분 실패 허용 | `news-provider.test.js` — "일부 피드가 실패해도 나머지로 진행한다" |
| 상류 오류 메시지가 노출되지 않는가 | ✅ | `degraded.reason`은 고정 문구. 원본을 담지 않는다 | `news-provider.test.js` — "degraded 사유에 상류 원본 메시지를 담지 않는다" |
| 수집이 예산을 우회하지 않는가 | ✅ | `/api/research/collect`는 LLM을 호출하지 않으므로 비용이 0이다. 실제 분석은 여전히 확인 토큰과 예산을 거친다 | `research.test.js` — "수집은 LLM을 호출하지 않는다", "수집은 예산을 차감하지 않는다" |

---

## 10. 프론트엔드 (Phase 3)

| 점검 항목 | 상태 | 구현 위치 | 검증 |
|---|---|---|---|
| LLM 응답을 HTML로 렌더링할 때 XSS를 방지하는가 | ✅ | `dangerouslySetInnerHTML`을 쓰지 않는다. React 기본 이스케이프에 의존 | `components.test.jsx` — "LLM 응답에 script가 들어와도 DOM에 태그가 생기지 않는다", "img onerror도 실행되지 않는다" |
| Markdown 폴백이 XSS 표면을 만들지 않는가 | ✅ | 렌더러 없이 `<pre>`로 표시. 렌더러는 HTML을 생성하고 그 순간 표면이 생긴다 | `components.test.jsx` — "degraded면 Markdown 폴백을 pre로 표시한다" |
| CORS가 제한되어 있는가 | ✅ | 동일 출처라 CORS 미들웨어가 불필요하다. Express가 프론트를 서빙한다. `CORS_ORIGIN` 설정값은 남아 있으나 **현재 미사용**이다 | `static.test.js` |
| 토큰이 JS에서 접근 가능한가 | ✅ 아니다 | HttpOnly 쿠키만 쓴다. `localStorage`·헤더를 쓰지 않으므로 XSS가 나도 탈취되지 않는다 | `api-client.test.js` — "토큰을 저장하거나 헤더에 넣지 않는다" |
| 외부 링크가 opener를 노출하는가 | ✅ 아니다 | 모든 외부 링크에 `rel="noopener noreferrer"` | `components.test.jsx` — "외부 링크에 noopener noreferrer를 붙인다" · 실브라우저에서 링크 10개 전부 확인 |
| API 경로가 SPA 폴백에 삼켜지는가 | ✅ 아니다 | 정적 서빙을 API 라우트 뒤에 등록하고 폴백 정규식에서 `/api/`를 제외 | `static.test.js` — "없는 API 경로는 여전히 JSON 404를 준다" |
| API 키가 프론트엔드 번들에 포함되는가 | ✅ 아니다 | 모든 외부 호출은 서버가 한다. `client/`에 `.env`가 없다 | 빌드 산출물에 키 패턴 없음 |

---

## 알려진 약점

정직하게 남긴다.

1. **단일 공유 비밀번호** — 사용자 구분이 없어 감사 추적이 불가능하고, 유출 시 전체를 교체해야 한다. 확장 경로는 `docs/architecture.md` §7.
2. **메모리 rate limit** — 인스턴스별 독립 계산이라 N대 배포 시 실질 한도가 N배. `docs/architecture.md` §3.
3. **`trust proxy` 오설정 위험** — 프록시 뒤에서 끄면 전체 사용자가 한 키로 묶이고, 프록시 없이 켜면 `X-Forwarded-For` 위조로 우회된다. 배포 형태와 반드시 일치시켜야 한다.
4. **토큰 추정이 근사치** — `문자수/4`는 한국어에서 부정확하다. 비용 추정에도 같은 오차가 전파되므로 예산 한도를 보수적으로 잡아야 한다.
5. **예산은 이 앱만 막는다** — OpenAI 계정의 자동 충전 차단은 계정 Billing 설정에서 별도로 해야 한다. 앱 예산은 2차 방어선이다.
6. **CORS 미적용** — Phase 3에서 프론트엔드를 붙일 때 반드시 설정해야 한다.
7. **뉴스 본문이 제목 또는 리드 문단뿐이다** — 전문 분석이 아니다. `contentKind`로 표시하고 시스템 프롬프트가 추론을 금지하지만, 분석 깊이의 한계는 남는다.
8. **Yahoo Finance는 비공식 엔드포인트다** — 문서화된 공개 API가 아니라 예고 없이 바뀌거나 차단될 수 있다. 상용 전환 시 정식 시장 데이터 API로 교체해야 한다.
9. **RSS 피드는 언제든 죽는다** — 검증 중 매일경제 RSS가 이미 `403`이었다. 부분 실패를 정상으로 다루지만 커버리지는 그만큼 준다.
