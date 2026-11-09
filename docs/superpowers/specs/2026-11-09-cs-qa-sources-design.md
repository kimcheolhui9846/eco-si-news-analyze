# CS 브리핑 출처 추가: Stack Overflow·Lobsters 설계

작성일: 2026-11-09
브랜치: `feature/cs-qa-sources` — main(6e3cd04, C1 CS 브리핑 병합 후)에서 땄다.
선행: `docs/superpowers/specs/2026-11-09-cs-briefing-design.md`(C1). 이 문서는 C1의 출처 구조에 두 출처를 얹는다.

## 배경과 목표

CS 브리핑은 논문·HN·뉴스·연구 블로그·GitHub 다섯 출처를 쓴다. 모두 "무엇이 새로 나왔나"를 말한다.
개발자가 실제로 어디서 막히는지, HN 밖의 개발자 커뮤니티가 무엇을 이야기하는지는 비어 있다.

목표:

1. **Lobsters**를 기존 커뮤니티 출처(ID `H`)에 HN과 함께 싣는다.
2. **Stack Overflow**를 새 출처 종류 '개발자 질문'(수집 범위 `questions`, ID `Q`)으로 싣는다.
3. 보고서에 `developerPainPoints`(개발자들이 막히는 지점) 섹션을 추가한다.

X(트위터)는 넣지 않는다. 무료 API로는 읽기가 사실상 막혀 있고 스크래핑은 약관 위반이다.

## 범위 밖

- X, Reddit.
- SO 답변 본문, Lobsters 댓글 수집.
- 커뮤니티 비율·SO 기간의 사용자 설정.
- 투자 모드 변경. 투자 모드 동작은 바뀌지 않는다.

## 실측으로 확인한 API (2026-11-09)

- **Stack Exchange** `GET https://api.stackexchange.com/2.3/search/advanced?q=…&site=stackoverflow` — 키 없이 200. 응답 `{ items: [...], has_more, quota_max, quota_remaining }`. 항목에 `tags`, `owner.display_name`, `is_answered`, `view_count`, `accepted_answer_id`, `answer_count`, `score`, `creation_date`(epoch 초), `question_id`, `content_license`, `link`, `title`(HTML 엔티티 포함). `filter=withbody`면 `body`(HTML)가 붙는다. 본문은 gzip이다.
  - 키 없이 IP당 하루 300회, 키가 있으면 하루 10,000회. 한도 초과는 HTTP 400과 `{ error_id: 502, error_name: 'throttle_violation' }`. 응답에 `backoff`(초)가 오면 그동안 같은 메서드를 다시 부르지 않아야 한다.
- **Lobsters** — 검색 JSON이 없다(`/search.json`은 404 HTML). 쓸 수 있는 JSON:
  - `GET https://lobste.rs/tags.json` — 태그 117개, `{ tag, description, category, active, … }`.
  - `GET https://lobste.rs/t/<tag>.json` — 그 태그의 최신 글 25개.
  - `GET https://lobste.rs/newest.json` — 전체 최신 글 25개.
  - 글 항목: `short_id`, `created_at`, `title`, `url`(링크 없는 글은 빈 문자열), `score`, `comment_count`, `description_plain`, `tags`, `short_id_url`, `comments_url`.

## 구조

### Lobsters provider — `lib/providers/lobsters.js`

`createLobstersProvider({ http, cache, clock, makeBreaker })` → `{ search({ query, limit }) }`. 반환은 다른 CS provider와 같은 `{ items, degraded }`.

1. **태그 고르기** `pickLobstersTags(query, tagNames)` — 순수 함수.
   - 질의를 소문자 단어로 나눈다. 단어가 활성 태그 이름과 같으면 그 태그.
   - 별칭표 `LOBSTERS_TAG_ALIASES`로 흔한 표현을 태그에 잇는다: `llm`·`llms`·`rag`·`gpt`·`transformer`·`transformers`·`machine learning`·`deep learning`·`ml`·`agent`·`agents` → `ai`, `database`·`db`·`sql` → `databases`, `golang` → `go`, `js`·`typescript`·`node` → `javascript`, `k8s`·`kubernetes`·`docker` → `devops`, `crypto`·`cryptography` → `security`. 별칭은 태그 목록에 실제로 있을 때만 쓴다.
   - 질의 순서대로 최대 2개. 하나도 없으면 빈 배열.
2. **태그 목록** `tags.json`은 캐시 키 `lobsters:tags`로 24시간 붙잡아 둔다(CS 공용 캐시와 별도 TTL). 목록을 못 가져오면 태그 없이 3번(최신 글)으로 간다.
3. **글 가져오기**
   - 태그가 있으면 태그별 `/t/<tag>.json`.
   - 없으면 `/newest.json`을 받아 **제목·태그에 질의 단어(3자 이상)가 들어간 글만** 남긴다.
4. **거르기와 정렬**: 최근 30일(`HN_WINDOW_DAYS`와 같은 값) 안의 글만, 같은 `short_id`는 하나로, 점수 내림차순, `limit`개.
5. **항목 모양**(커뮤니티 공통 모양):
   `{ site: 'lobsters', title, url, discussionUrl, points, numComments, publishedAt, text }`
   - `url`은 글 링크, 비어 있으면 `comments_url`. `discussionUrl`은 `comments_url`. `text`는 `description_plain`(1500자).
   - `short_id`가 `/^[a-z0-9]+$/`가 아니거나 제목·날짜가 없으면 버린다.

### HN provider 변경

`parseHnSearch` 항목에 `site: 'hackernews'`를 붙인다. 다른 동작은 그대로다.

### 커뮤니티 합치기 — `mergeCommunity(hn, lobsters, max)`

`lib/providers/community.js`의 순수 함수. 기본 몫은 HN 6, Lobsters 4(`COMMUNITY_SHARE`). 한쪽이 몫보다 적으면 다른 쪽 나머지로 `CS_MAX.community`(10)까지 채운다. 순서: HN 몫 → Lobsters 몫 → 채운 항목. 같은 `url`은 먼저 온 것만 남긴다. 서버는 두 provider를 병렬로 부르고(`hn`은 10, `lobsters`는 10 요청) degraded를 모두 `provider: 'community'`로 싣는다.

### Stack Overflow provider — `lib/providers/stackoverflow.js`

`createStackOverflowProvider({ http, cache, clock, makeBreaker, key })` → `{ search({ query, limit }) }`.

- URL `buildSoUrl({ query, fromEpochSec, limit, key })`:
  `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=votes&q=<query>&site=stackoverflow&fromdate=<90일 전>&pagesize=<limit>&filter=withbody[&key=<key>]`
- `SO_WINDOW_DAYS = 90`, `limit`은 `CS_MAX.questions`(8).
- **파싱** `parseSoSearch(text)` — 항목:
  `{ title, url, author, tags, score, answerCount, isAnswered, hasAcceptedAnswer, viewCount, publishedAt, text }`
  - `title`은 `cleanText`(HTML 엔티티 해제), 300자. `url`은 `link`가 `https://stackoverflow.com/`로 시작할 때만, 아니면 항목을 버린다.
  - `author`는 `owner.display_name`(100자, 없으면 빈 문자열). `tags`는 문자열 최대 5개, 각 35자.
  - `score`는 정수(음수 허용), 나머지 수치는 음이 아닌 정수. `hasAcceptedAnswer`는 `accepted_answer_id` 존재 여부.
  - `publishedAt`은 `creation_date`(epoch 초)의 ISO 문자열. `text`는 `body`를 `cleanText`한 1500자.
- **구조 검사**: 본문이 JSON이 아니거나 `items`가 배열이 아니면 `MalformedUpstream`(기존 `jsonArrayField`).
- **한도 초과**: `lib/http.js`는 3xx 이상에서 본문 없이 `err.upstreamStatus`만 남긴다. 그래서 `failureReason`이 `upstreamStatus`가 400 또는 429면 사유 `SO_LIMIT_REASON = 'Stack Overflow 호출 한도를 초과했습니다. 잠시 뒤 다시 시도해 주세요.'`, 그 밖은 `FETCH_FAILED`(GitHub provider와 같은 방식). Stack Exchange는 한도 초과를 400(`throttle_violation`)으로 주고, 이 provider가 만드는 질의 형식에서는 다른 400이 나지 않는다.
  - 200 응답의 `backoff`는 따로 처리하지 않는다. 같은 질의는 캐시가 막고, 수집은 사람이 버튼을 누를 때만 일어난다.
- **키**: 선택 환경변수 `STACKEXCHANGE_KEY` → `config.stackexchangeKey`. SE 정책상 비밀값이 아니지만 로그·degraded 사유·캐시 키에 넣지 않는다.

### 설정

- `EXTERNAL_ALLOWLIST` 기본값(`lib/config.js`)과 `.env.example`에 `api.stackexchange.com`, `lobste.rs` 추가.
- `.env.example`에 `STACKEXCHANGE_KEY=` 빈 줄과 설명 주석.

### 입력 스키마 — `lib/validation.js`

- `CS_SCOPES`에 `questions` 추가: `['papers', 'community', 'questions', 'news', 'blogs', 'repos']`. 클라이언트 `ScopePicker`도 같은 순서.
- `CS_MAX.questions = 8`.
- `communitySchema`에 `site: z.enum(['hackernews', 'lobsters'])` 필수 필드 추가. 기존 eval 케이스의 커뮤니티 자료에는 `site: 'hackernews'`를 채운다.
- `questionSchema`(strict): 위 SO 항목 모양 그대로. `url`은 `httpUrl`, `tags`는 `z.array(z.string().max(35)).max(5)`, `score`는 `z.number().int()`.
- `buildCsAnalyzeSchema`에 `questions: z.array(questionSchema).max(CS_MAX.questions).optional()`.

### CS 프로필 — `lib/modes/cs.js`

- `normalize`: `questions: withIds('Q', data.questions)`, 합계에 포함.
- `hashInput`에 `questions` 추가(확인 토큰이 질문 자료에 묶인다).
- `buildSources`:
  - 커뮤니티 `source`는 `site`에 따라 `'Hacker News'` 또는 `'Lobsters'`.
  - 질문은 `type: 'question'`, `source: 'Stack Overflow'`, `url`은 질문 링크.
- `urlWhitelist`에 질문 `url` 추가.
- `baseMeta.counts.questions` 추가.

### 응답 스키마·프롬프트 — `lib/modes/cs-schema.js`, `lib/modes/cs-prompt.js`

- `developerPainPoints`: 배열 최대 5. 항목 `{ title(≤120), detail(≤400), sourceIds: string[] (1~4) }`. strict JSON 스키마라 모든 속성 required.
- 프롬프트 규칙:
  - 질문 자료(Q)만 근거로 쓴다.
  - 질문 자료가 없으면 빈 배열.
  - SO 점수·조회수·답 없는 질문 비율은 "얼마나 많은 개발자가 막히는가"의 신호이지 기술의 정확성 근거가 아니다.
  - 질문 블록에는 제목·태그·점수·답변 수·채택 여부·조회수·본문 발췌를 싣는다.
- `CS_MOCK_REPORT`에 빈 `developerPainPoints`.

### 품질 검사 — `lib/quality/cs.js`

- `idPrefixes: 'PHSBGQ'`. 투자 모드 기본값(`SPTFM`)은 그대로다.
- `checkSourceRefs`:
  - `developerPainPoints[i].sourceIds`에서 제공되지 않은 ID와 Q가 아닌 ID를 뺀다(`fixed`).
  - 남은 ID가 없으면 항목을 제거한다(`fixed`).
- 질문 출처가 1건 이상인데 `developerPainPoints`가 비어 있으면 `warning`.
- 자료 충분도(coverage) 계산은 출처 총수를 쓰므로 질문도 자동으로 센다.

### 화면 — `client/src`

- `ScopePicker`: CS 범위에 '개발자 질문'.
- `CsReviewPage`: 질문 목록(제목·점수·답변 수·태그). 커뮤니티 항목에 HN/Lobsters 배지.
- `CsReportPage`: '개발자들이 막히는 지점' 섹션(제목·설명·출처 링크). 질문 출처 표기에 작성자와 `CC BY-SA`.
- `api/client.js`: 분석 요청 본문에 비어 있지 않은 `questions`를 싣는다.

## 오류 처리

- 출처마다 실패를 degraded로 알리고 나머지로 진행한다. 실패와 형식이 틀린 200 응답은 캐시하지 않는다(C1 규칙 그대로).
- Lobsters 태그 목록 실패는 degraded로 알리지 않는다. 최신 글로 대체하고, 그것도 실패하면 그때 degraded.
- 수집 합계가 3건 미만이면 기존처럼 502 `COLLECTION_FAILED`.

## 테스트

모두 고정 응답(fixture). 실제 응답에서 몇 건을 잘라 `tests/fixtures/`에 둔다.

- Lobsters: 태그 고르기(정확 일치·별칭·없는 별칭·최대 2개), 최신 글 키워드 거르기, 30일 거르기·중복 제거·점수 정렬, 링크 없는 글의 `url`, 잘못된 `short_id` 버림, 태그 목록 실패 시 최신 글 대체, 형식이 틀린 200은 degraded.
- 커뮤니티 합치기: 6:4 기본, 한쪽 부족 시 채우기, 같은 URL 중복 제거.
- SO: 파싱(엔티티 해제, 음수 점수, 채택 여부, 태그 상한, stackoverflow.com 아닌 링크 버림), URL 생성(키 있을 때만 `key`), 한도 초과 사유, 키가 로그·사유·캐시 키에 없음.
- 스키마: `site` 필수, `questions` 상한, 질문 strict.
- 프로필: Q ID, 해시에 질문 포함, 출처 이름(HN/Lobsters/Stack Overflow), URL 화이트리스트.
- 품질: 섹션의 비-Q ID 제거, 빈 섹션 경고, `PHSBGQ` 인용 치환.
- 화면: 범위 선택, 검토 목록, 보고서 섹션과 CC BY-SA 표기.
- eval: 질문 자료가 있는 케이스 1개 추가, 기존 케이스 `site` 보강.
- 실호출: 구현 끝에 로컬에서 1회(약 $0.02), 배포 후 운영 1회.
