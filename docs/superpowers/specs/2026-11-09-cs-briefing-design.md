# CS 기술 동향 브리핑(C1) 설계

작성일: 2026-11-09
브랜치: `feature/cs-briefing` — `feature/analysis-quality-gate`(PR #13)에서 땄다. 품질 게이트를 재사용한다.
후속: C2 "논문 한 편 전문 분석"은 같은 구조에 `mode: 'paper'` 프로필로 얹는다. 이 문서의 범위가 아니다.

## 배경과 목표

지금 앱은 투자 관점 보고서만 만든다. 논문 수집(arXiv·OpenAlex 등)이 있지만 투자 보고서의 보조 자료다.
사용자는 CS(컴퓨터 과학) 주제의 최신 논문·기술 소식을 모아 "무엇이 새롭고, 왜 중요하고, 어디까지 검증됐나"를 정리한 브리핑을 원한다. 공부·연구·취업 준비용이며 투자와 무관하다.

목표:

1. `mode: 'cs'`로 수집·견적·분석이 동작한다. `mode`가 없으면 지금과 똑같이 투자 모드다.
2. 비용 방어(견적·확인 토큰·예산·동시 실행 제한·요청 병합·캐시)와 품질 게이트는 한 벌만 둔다.
3. 출처 5종: arXiv cs.* 논문, Hacker News, 기존 뉴스, 기업 연구 블로그 RSS, GitHub 저장소.
4. CS 전용 응답 스키마·프롬프트·품질 검사·화면.

## 범위 밖

- C2 논문 전문 분석.
- 모드별 예산 분리. 예산과 일일 호출 한도는 공유한다.
- 블로그 목록 편집 화면.
- 영어 보고서.
- 저장소 README 본문 수집.

## 구조

### 리팩터링: 분석 실행부 추출 (동작 불변)

`server.js`(약 790줄)의 수집 라우트 끝부분과 분석 라우트에는 비용 방어 흐름과 투자 전용 조립(정규화·프롬프트·cacheKey)이 섞여 있다. 다음과 같이 나눈다.

- `lib/analysis-runner.js`: 프로필을 받아 견적·분석을 실행하는 공용부.
  - `prepare(profile, body)` → `{ userPrompt, estimatedInputTokens, estimatedCostUsd, cacheKey, sources, urlWhitelist, qualityContext, baseMeta }`
  - 분석 실행: 캐시 확인 → 확인 토큰 검증(세션·cacheKey 일치, 일회용) → 예산 → 세마포어 → 요청 병합 → LLM(구조화 2회 + Markdown 폴백) → 실제 비용 기록 → `assessQuality(…, profile.checks)` → `stripFabricatedUrls` → 캐시 → 응답.
  - 확인 토큰 발급 `issueConfirmToken(cacheKey, session)`도 이곳에 둔다. 수집 라우트와 견적 라우트가 같이 쓴다.
- `lib/modes/invest.js`: 지금의 투자 로직을 프로필로 옮긴다.
- `lib/modes/cs.js`: 새 CS 프로필.
- `lib/modes/index.js`: `getProfile(mode)`. 모르는 모드는 400.

리팩터링 커밋은 기능 추가와 분리한다. 기존 테스트가 하나도 바뀌지 않고 통과해야 한다.

### 프로필 인터페이스

```
{
  mode: 'invest' | 'cs',
  buildAnalyzeSchema(config) → zod 스키마         // 분석 요청 본문
  normalize(parsedBody, { now }) → normalized      // 출처 ID 부여, 중복 제거 등
  systemPrompt: string
  buildUserPrompt(normalized, { collectedAt }) → string
  jsonSchema                                        // OpenAI strict json_schema
  buildSources(normalized, collectedAt) → sources[]
  urlWhitelist(normalized) → Set<string>
  hashInput(normalized) → object                    // cacheKey 재료. mode를 반드시 포함
  qualityContext(normalized, sources) → context
  checks                                            // assessQuality에 넘길 [name, fn][]
  mockReport                                        // LLM_MODE=mock 응답
}
```

- cacheKey는 `hashRequest({ mode, ...profile.hashInput(normalized), model })`. invest의 `hashInput`은 지금과 같은 키 집합 `{ items, instruments, sector, analysisPeriod, research, experiments }`에 `mode: 'invest'`가 더해진다. 그래서 배포 직후 기존 캐시·확인 토큰이 무효가 된다. 캐시와 토큰은 메모리에만 있으므로 문제없다.
- `assessQuality(analysis, context, { degraded, checks })`의 `checks` 인자는 이미 있다.
- mock LLM은 요청의 `jsonSchema.name`을 보고 투자 또는 CS mock 보고서를 돌려준다.

### 요청 형태

수집:

```
POST /api/research/collect
{ mode: 'cs', query, lang?: 'ko'|'en', include?: ('papers'|'community'|'news'|'blogs'|'repos')[] }
```

`include`가 없으면 다섯 가지 전부. `mode`가 없으면 기존 투자 요청 스키마 그대로.

견적·분석:

```
POST /api/analyze/estimate, /api/analyze/news
{ mode: 'cs', newsList?, papers?, community?, blogs?, repos? }
```

CS 요청 본문은 `strictObject`이며 항목 배열은 모두 선택이다. 합계 3건 미만이면 422 `INSUFFICIENT_DATA`.

## 수집기

2026-11-09에 모든 엔드포인트를 키 없이 실측했다(HTTP 200). 기본 기간 최근 30일.

| ID | 파일 | 호출 | 상한 | 담는 값 |
|---|---|---|---|---|
| P | `lib/providers/papers.js`에 `searchCs` 추가 | `https://export.arxiv.org/api/query?search_query=all:<q>+AND+cat:cs.*&sortBy=submittedDate&sortOrder=descending&max_results=8` (cs.* 와일드카드 실측 확인, 결과의 primary_category가 cs.LG·cs.CL) | 8 | 기존 `parseArxiv` 형태 + `category`(primary_category) |
| H | `lib/providers/hackernews.js` | `https://hn.algolia.com/api/v1/search?query=<q>&tags=story&numericFilters=created_at_i><30일 전 epoch>&hitsPerPage=10` | 10 | `title`, `url`(없으면 HN 토론 링크), `discussionUrl`(`https://news.ycombinator.com/item?id=<objectID>`), `points`, `numComments`, `publishedAt`, `text`(story_text, 태그 제거, 1500자) |
| S | 기존 `newsProvider.search` | 그대로 | `maxNews` | 기존 뉴스 항목 |
| B | `lib/providers/tech-blogs.js` | 고정 RSS 목록, 기존 `lib/providers/rss.js` 파서 재사용 | 8 | 검색어 토큰 중 하나가 제목·요약에 있는 최근 60일 글. `title`, `url`, `blog`, `summary`(1500자), `publishedAt` |
| G | `lib/providers/github.js` | `https://api.github.com/search/repositories?q=<q>+pushed:><30일 전 YYYY-MM-DD>&sort=stars&order=desc&per_page=8`, 헤더 `Accept: application/vnd.github+json`, `User-Agent: eco-si-news-analyze`, `GITHUB_TOKEN`이 있으면 `Authorization: Bearer` | 8 | `fullName`, `url`, `description`(500자), `stars`, `language`, `license`(SPDX 또는 null), `pushedAt`, `createdAt` |

블로그 RSS 목록(실측 200):

- `https://research.google/blog/rss/` (Google Research)
- `https://deepmind.google/blog/rss.xml` (Google DeepMind)
- `https://openai.com/news/rss.xml` (OpenAI)
- `https://huggingface.co/blog/feed.xml` (Hugging Face)
- `https://www.microsoft.com/en-us/research/feed/` (Microsoft Research)
- `https://developer.nvidia.com/blog/feed/` (NVIDIA Developer)
- `https://aws.amazon.com/blogs/machine-learning/feed/` (AWS ML)
- `https://engineering.fb.com/feed/` (Meta Engineering)
- `https://bair.berkeley.edu/blog/feed.xml` (BAIR)
- 한국 기술 블로그 1곳: 구현 계획 작성 시 실측해 응답하는 곳으로 정한다. 응답하는 곳이 없으면 9개로 간다.

공통 규칙(기존 수집기와 같다):

- 모든 호스트를 `EXTERNAL_ALLOWLIST` 기본값, `.env.example`, `render.yaml`에 추가한다. 로컬 `.env`는 사용자가 맞춘다.
- `lib/http.js` 경유(허용 목록·타임아웃·크기 제한), 소스별 회로 차단기, 캐시 6시간, 실패는 캐시하지 않는다.
- 소스 하나의 실패는 `degraded: [{ provider, reason }]`로 남기고 나머지로 진행한다.
- 파서가 길이를 잘라 검증 스키마 상한 안에 넣는다(`RESEARCH_LIMITS`와 같은 방식으로 `CS_LIMITS`를 둔다).
- GitHub 비인증 한도(분당 10회)를 넘으면 403/429 → `degraded` 사유 "GitHub 검색 한도를 넘었습니다".
- 수집 결과 합계가 3건 미만이면 502 `COLLECTION_FAILED`(투자 모드는 뉴스 0건 기준 그대로).

## CS 보고서

### 응답 스키마 `cs_trend_briefing` (strict)

```
summary: string
keyDevelopments: [{
  title: string,
  whatIsNew: string,
  whyItMatters: string,
  evidenceLevel: enum['동료 심사 논문','프리프린트','공식 발표·블로그','코드 공개','커뮤니티 화제','언론 보도'],
  sourceIds: string[]
}]
paperHighlights: [{ sourceId, contribution, method, limitations }]   (모두 string)
communityPulse: string
openSourceSignals: [{ sourceId, signal }]
openQuestions: string[]
whatToWatch: string[]
sourceCoverage: { level: enum['충분','부분적','부족'], note: string }
```

### 프롬프트 원칙

- 역할: CS 기술 동향 분석가. 독자: 학생·연구자·개발자.
- 사실과 해석을 분리한다. 프리프린트는 동료 심사를 거치지 않은 결과로 표시한다. 초록·본문에 없는 수치·표본·한계를 지어내지 않는다(없으면 "자료 부족").
- HN 점수·GitHub 스타는 화제성이지 정확성이 아니다.
- 인용은 `[P1]`, `[H2]` 형식 출처 ID로만 한다. URL을 쓰지 않는다.
- 외부 자료 구획(`DATA_BEGIN`/`DATA_END`)·`escapeDelimiters`·주입 방어 문구는 투자 프롬프트와 같은 것을 쓴다.
- 투자 권유·주가·종목 언급을 하지 않는다.
- `keyDevelopments`는 최대 6개, 각 항목 `sourceIds`는 1개 이상.

### 품질 검사 (`profile.checks`)

| check | 동작 |
|---|---|
| `citations` | 기존 검사기. `newsBriefing`이 없으므로 본문 인용 교정만 동작한다. ID 토큰 정규식을 `[SPTFMHBG]`로 넓힌다. |
| `sourceRefs` | `keyDevelopments[].sourceIds`, `paperHighlights[].sourceId`, `openSourceSignals[].sourceId`의 없는 ID 제거(fixed). `paperHighlights`·`openSourceSignals` 항목은 ID가 없으면 항목째 제거(fixed). `sourceIds`가 비게 된 동향은 warning. |
| `evidence` | 동향의 근거가 전부 P(arXiv 프리프린트)인데 '동료 심사 논문'이면 '프리프린트'로 교정(fixed). '코드 공개'인데 근거에 G가 없으면 warning. |
| `coverage` | 수집 합계 5건 미만인데 `level`이 '충분'이면 '부족'으로 교정(fixed). |
| `investmentLanguage` | `매수`, `매도`, `목표주가`, `주가`, `투자 권유` 표현이 있으면 경로당 warning. |

점수·`meta.quality` 형태는 투자 모드와 같다.

### 평가 세트

`eval/cases/cs-*.json`. 케이스에 `"mode": "cs"`를 두면 러너가 CS 프로필의 `checks`를 쓴다. 초기 케이스: 깨끗한 응답 1, `sourceRefs` 2, `evidence` 2, `coverage` 1, `investmentLanguage` 1(+ 오탐 방지 1), 본문 없는 ID 1.

## 화면

- 검색 화면 상단에 "투자 | CS 동향" 탭. CS에서는 종목·심볼 입력을 숨기고 범위 선택이 논문·커뮤니티·뉴스·블로그·저장소로 바뀐다.
- 검토 화면: 수집 자료를 출처 종류별로 묶어 보여 주고, 견적 확인 후 분석한다(기존 흐름).
- `CsReportPage`: `QualityBadge` → 핵심 요약 → 주요 동향 카드(근거 수준 배지, 출처 ID) → 논문 하이라이트(각 항목에 비활성 "전문 분석 (준비 중)" 버튼) → 커뮤니티 반응 → 오픈소스 신호 → 미해결 질문 → 지켜볼 것 → 출처 목록.
- 모든 문자열은 텍스트로만 렌더링한다(HTML 렌더러 금지).

## 테스트

- 리팩터링: 기존 709개 테스트 무변경 통과.
- 수집기: 녹화 fixture로 파서 단위 테스트(HN, GitHub, RSS 2종, arXiv cs).
- 라우트: `mode: 'cs'` 수집 → 견적 → 분석(mock), 투자 확인 토큰으로 CS 분석 시 428, 자료 3건 미만 시 실패, 모르는 `mode` 400.
- 품질 검사기 단위 테스트와 CS 평가 케이스.
- client: 모드 전환, `CsReportPage` 빈 자료·전체 자료 렌더링.
- 구현 후 OpenAI 실호출 1회(CS 주제, 약 $0.01).

## 문서

- `docs/api.md`: `mode`, CS 수집 요청·응답, CS 분석 요청·응답, CS 품질 검사.
- `README.md`: CS 모드 소개, 새 허용 호스트, `GITHUB_TOKEN`(선택).
- `docs/SESSION-HANDOFF.md`: 태스크마다 갱신.
