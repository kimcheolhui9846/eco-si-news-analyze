# 세션 핸드오프

> 작업이 중단되어도 이어서 진행할 수 있도록 유지하는 문서다.
> **매 태스크를 커밋할 때마다 갱신한다.** 이 문서만 읽으면 다음 사람이 바로 이어받을 수 있어야 한다.

- **최종 갱신**: 2026-09-04 (Phase 2b 구현 완료 — KCI 키 발급만 남음)
- **현재 브랜치**: `feature/research-connectors`
- **저장소**: https://github.com/kimcheolhui9846/eco-si-news-analyze (PRIVATE)

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
| Phase 2b (재무·논문·실험) | 🟢 구현 완료 — 522개 테스트, 실네트워크 14/14 통과. KCI 키만 남음 |
| Phase 3 (프론트엔드) | ✅ 완료 — 379개 테스트, 실브라우저 전 과정 확인 |

## 2. 다음에 할 일

1. **PR 생성** — `feature/research-connectors` → `main`. Phase 2b 구현이 끝났다.
2. **KCI API 키 발급** (계획 Task 14) — 없어도 나머지는 전부 동작한다. 아래 참고.
3. **실제 OpenAI 호출 검증** — 아직 0회다 (§8 참조).

### KCI API 키에 대하여 (선택 사항)

사용자가 open.kci.go.kr에서 직접 받는다 (무료).

**`.env.example`이 아니라 `.env`에 넣는다.** `.env`는 아직 없으므로
`cp .env.example .env`로 만들어야 한다. `.env.example`은 커밋되는
템플릿이라 실제 키를 넣으면 GitHub에 올라간다.

키가 없어도 서버는 정상 기동하고 뉴스·차트·재무·영문 논문·임상시험이 전부 동작한다.
한국어 질의의 논문만 '자료 부족'으로 나가고 사유가 함께 표시된다.

신청서가 **신청 IP**를 요구한다. KCI는 등록된 공인 IP에서 온 요청만 받는다.
IP는 여러 개 등록할 수 있고 바뀌면 신청서에서 고치면 된다 (코드 변경 없음).
2026-09-03 기준 사용자 공인 IP는 `112.186.34.17`이었다.
**유동 IP라면 바뀔 수 있고, 바뀌면 키가 멀쩡해도 거부당한다.** 재등록은
쉽지만 바뀐 줄 알아채기가 어렵다 — 오류 없이 국내 논문만 조용히 사라진다.
그래서 IP 불일치를 일반 오류와 분리해 전용 문구로 표시하도록 구현했다
(`lib/providers/kci.js`의 `isIpRejection`).

### 키를 받으면 제일 먼저 할 일

KCI가 한국어 질의를 받는지 **아직 모른다.** 키 없이 확인할 수 없었다.
정상 응답의 XML 요소 이름도 확인하지 못해 `lib/providers/kci.js`의
`KCI_FIELD_NAMES` 한 곳에 후보를 모아 두었다. 실제 응답을 받으면 그 표만 고치면 된다.

계획 문서 Task 14에 4단계 검증 절차가 적혀 있다.

1. `title=battery` (ASCII) — API 자체가 도는지
2. `title=배터리` UTF-8 퍼센트 인코딩 — 되면 그대로 간다
3. 0건이면 EUC-KR 퍼센트 인코딩(`%B9%E8%C5%CD%B8%AE`) — `iconv-lite` 추가가 필요하다
4. 둘 다 실패하면 한계로 문서화하고 언어 가드에서 KCI도 제외
## 3. 핵심 문서

| 문서 | 내용 |
|---|---|
| `docs/superpowers/specs/2026-09-02-phase1-core-backend-design.md` | Phase 1 설계 (승인됨) |
| `docs/superpowers/plans/2026-09-02-phase1-core-backend.md` | Phase 1 구현 계획 (완료) |
| `docs/superpowers/specs/2026-09-02-phase2a-data-connectors-design.md` | Phase 2a 설계 (승인됨) |
| `docs/superpowers/plans/2026-09-03-phase2a-data-connectors.md` | Phase 2a 구현 계획 — 9개 태스크 |
| `docs/superpowers/specs/2026-09-03-phase3-frontend-design.md` | Phase 3 설계 (완료) |
| `docs/superpowers/specs/2026-09-03-phase2b-research-connectors-design.md` | Phase 2b 설계 (승인됨) |
| `docs/superpowers/plans/2026-09-04-phase2b-research-connectors.md` | **Phase 2b 구현 계획 — 14개 태스크. Task 14만 남음** |
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

- 작업 디렉터리: `C:\Users\00\Desktop\eco_si_news_analyze`
- Node v24.18.0 / npm 11.16.0 / Windows 11, PowerShell + Git Bash
- git 신원: `kim cheol hui <144594976+kimcheolhui9846@users.noreply.github.com>`
- `gh` CLI 인증됨 (`kimcheolhui9846`)

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
- **`.env`가 아직 존재하지 않는다.** 이것이 실제 OpenAI 호출 검증이 0회인
  이유이기도 하다. `cp .env.example .env` 후 실제 값을 채워야 한다.
  Phase 2b 실네트워크 검증은 환경변수를 인라인으로 넘겨(`LLM_MODE=mock`)
  돌렸으므로 LLM 비용이 들지 않았다

- **실제 OpenAI 호출 검증이 아직 0회다.** mock 모드로만 검증하고 병합했다
  (2026-09-02 사용자가 "나중에 맞춰가고 머지하자"고 결정). `.env`에 실제 키를 넣고
  `LLM_MODE=live ./scripts/verify.sh`를 1회 돌려야 구조화 출력이 실모델에서
  동작하는지 확인된다. `meta.degraded=false`여야 정상
- `gpt-4o`는 2026년 기준 구형 모델. 원본 요구사항대로 기본값 유지하되 `OPENAI_MODEL` 교체만으로 바꿀 수 있게 구현
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
