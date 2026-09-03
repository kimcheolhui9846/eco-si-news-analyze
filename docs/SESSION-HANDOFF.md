# 세션 핸드오프

> 작업이 중단되어도 이어서 진행할 수 있도록 유지하는 문서다.
> **매 태스크를 커밋할 때마다 갱신한다.** 이 문서만 읽으면 다음 사람이 바로 이어받을 수 있어야 한다.

- **최종 갱신**: 2026-09-03 (Phase 3 계획 작성 완료)
- **현재 브랜치**: `feature/frontend-ui`
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
| Phase 2b (재무·논문·실험) | ⬜ 미착수 — 다음 단계 |
| Phase 3 (프론트엔드) | 🔄 구현 중 (Task 1/8 완료 — 툴체인·순수함수) |

## 2. 다음에 할 일

**Phase 3 구현** — Task 2 (marketSeries 백엔드)부터 이어서 진행한다.
계획서: `docs/superpowers/plans/2026-09-03-phase3-frontend.md`

태스크 순서: 1 툴체인·순수함수 → 2 marketSeries(백엔드) → 3 API클라이언트
→ 4 차트좌표 → 5 컴포넌트 → 6 화면·상태기계 → 7 스타일 → 8 정적서빙·문서·PR

## 3. 핵심 문서

| 문서 | 내용 |
|---|---|
| `docs/superpowers/specs/2026-09-02-phase1-core-backend-design.md` | Phase 1 설계 (승인됨) |
| `docs/superpowers/plans/2026-09-02-phase1-core-backend.md` | Phase 1 구현 계획 (완료) |
| `docs/superpowers/specs/2026-09-02-phase2a-data-connectors-design.md` | Phase 2a 설계 (승인됨) |
| `docs/superpowers/plans/2026-09-03-phase2a-data-connectors.md` | Phase 2a 구현 계획 — 9개 태스크 |
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
- **정적 서빙 경로는 `fileURLToPath`를 쓴다** — `URL.pathname`은 Windows에서 `/C:/...`가 되어 fs가 못 읽는다
- **supertest 요청은 지연 실행이다** — `.then()`을 걸어야 실제로 전송된다 (Phase 1에서 겪음)
- **테스트 실행 스크립트**: `node --test tests/`는 Node 24/Windows에서 `tests`를 모듈 경로로
  해석해 `MODULE_NOT_FOUND`가 난다. `node --test "tests/**/*.test.js"` 글롭을 써야 한다.
  (Task 1에서 실제로 겪고 수정함)
- **`loadConfig`는 `process.env`를 병합한다**: 누락 검증 테스트는 `''`를 명시적으로 넘겨야 한다.
  개발자 로컬에 `.env`가 있으면 그냥 통과해버려 테스트가 무의미해진다 (Task 1에서 수정함)

## 8. 아직 해결되지 않은 것

- **실제 OpenAI 호출 검증이 아직 0회다.** mock 모드로만 검증하고 병합했다
  (2026-09-02 사용자가 "나중에 맞춰가고 머지하자"고 결정). `.env`에 실제 키를 넣고
  `LLM_MODE=live ./scripts/verify.sh`를 1회 돌려야 구조화 출력이 실모델에서
  동작하는지 확인된다. `meta.degraded=false`여야 정상
- `gpt-4o`는 2026년 기준 구형 모델. 원본 요구사항대로 기본값 유지하되 `OPENAI_MODEL` 교체만으로 바꿀 수 있게 구현
- 토큰 추정은 문자수/4 근사치 — 한국어에서 부정확. 보수적 마진 적용 예정
