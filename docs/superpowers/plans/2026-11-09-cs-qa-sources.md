# CS 브리핑 출처 추가(Stack Overflow·Lobsters) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CS 브리핑에 Lobsters(커뮤니티, ID `H`)와 Stack Overflow(새 출처 '개발자 질문', ID `Q`)를 추가하고 보고서에 `developerPainPoints` 섹션을 넣는다.

**Architecture:** C1의 provider 규약(`createCachedSource` → `{ items, degraded }`)을 그대로 쓴다. Lobsters는 검색 API가 없어 태그 피드를 읽어 로컬에서 거르고, HN 결과와 6:4로 합쳐 `community`에 싣는다. SO는 `questions` 범위로 수집·검증·프로필·프롬프트·품질 검사·화면을 한 줄로 관통한다.

**Tech Stack:** Node 22 ESM, Express, Zod 4 `strictObject`, `node:test` + tsx + supertest, React 19 + Vite.

설계: `docs/superpowers/specs/2026-11-09-cs-qa-sources-design.md`

**설계 대비 결정(계획 작성 중 확인):**
1. eval 케이스는 원본 커뮤니티 항목이 아니라 출처 목록(`eval/contexts/cs.json`)만 저장한다. 설계의 "기존 eval 케이스에 `site` 보강"은 할 일이 없다. 대신 `eval/run.js`가 하드코딩한 `'PHSBG'`를 품질 모듈의 상수로 바꾼다.
2. CC BY-SA 작성자 표기는 출처 이름에 싣는다: 질문 출처의 `source`는 `Stack Overflow · <작성자> · CC BY-SA`(작성자가 없으면 `작성자 미상`). 기존 `SourceCitation`이 그대로 보여 주므로 새 컴포넌트가 필요 없다.
3. 질문 출처의 `type`은 `'question'`이다. 빈 섹션 경고는 품질 컨텍스트의 출처 `type`으로 판단한다.

## Global Constraints

- 비밀값(키·토큰·비밀번호)을 로그·degraded 사유·캐시 키·커밋에 넣지 않는다. `STACKEXCHANGE_KEY`도 같다.
- 투자 모드 동작은 바뀌지 않는다. 투자 인용 접두사 기본값 `SPTFM`은 그대로다.
- 실패와 형식이 틀린 200 응답은 degraded로 알리고 캐시하지 않는다. 정상적인 빈 결과는 degraded가 아니고 캐시하지 않는다.
- `CS_SCOPES` 순서: `['papers', 'community', 'questions', 'news', 'blogs', 'repos']`. 서버(`lib/validation.js`)와 클라이언트(`ScopePicker`)가 같아야 한다.
- 커뮤니티 기본 몫: HN 6, Lobsters 4, 합계 상한 `CS_MAX.community` = 10.
- `CS_MAX.questions` = 8. `SO_WINDOW_DAYS` = 90. Lobsters 기간 = `HN_WINDOW_DAYS`(30).
- SO 한도 초과 사유: `'Stack Overflow 호출 한도를 초과했습니다. 잠시 뒤 다시 시도해 주세요.'`(`upstreamStatus` 400 또는 429).
- `developerPainPoints`: 최대 5개, `{ title, detail, sourceIds }`, 근거는 Q 출처만.
- CS 인용 접두사: `PHSBGQ`.
- 새 허용 호스트: `api.stackexchange.com`, `lobste.rs` — `lib/config.js` 기본값과 `.env.example` 모두.
- 모든 사용자 노출 문구는 한국어. 코드 주석은 기존 관례대로 한국어.
- 테스트는 고정 응답만 쓴다. 실제 네트워크를 부르지 않는다.
- 커밋 메시지에 AI 공동저자 표기를 넣지 않는다.

---

### Task 1: Stack Overflow provider와 설정

**Files:**
- Modify: `lib/providers/cs-common.js` (CS_LIMITS, CS_MAX)
- Create: `lib/providers/stackoverflow.js`
- Create: `tests/fixtures/so-search.json`
- Modify: `lib/config.js:83` (허용목록 기본값), `lib/config.js:111` 부근 (`stackexchangeKey`)
- Modify: `.env.example` (허용목록, `STACKEXCHANGE_KEY`)
- Test: `tests/cs-providers.test.js`

**Interfaces:**
- Produces: `CS_MAX.questions === 8`, `CS_LIMITS.author === 100`, `CS_LIMITS.tag === 35`, `CS_LIMITS.tags === 5`
- Produces: `SO_WINDOW_DAYS`, `SO_LIMIT_REASON`, `buildSoUrl({ query, fromEpochSec, limit, key })`, `parseSoSearch(text)`, `createStackOverflowProvider({ http, cache, clock, makeBreaker, key })` → `{ search({ query, limit }) → Promise<{ items, degraded }> }`
- Produces: 질문 항목 `{ title, url, author, tags, score, answerCount, isAnswered, hasAcceptedAnswer, viewCount, publishedAt, text }`
- Produces: `config.stackexchangeKey`(기본 `''`)

- [ ] **Step 1: fixture 작성** — `tests/fixtures/so-search.json`

```json
{
  "items": [
    {
      "tags": ["python", "langchain", "rag"],
      "owner": { "display_name": "dev&amp;ops" },
      "is_answered": true,
      "view_count": 605,
      "accepted_answer_id": 79926667,
      "answer_count": 2,
      "score": 7,
      "creation_date": 1792074068,
      "question_id": 79923286,
      "link": "https://stackoverflow.com/questions/79923286/rag-retriever-returns-irrelevant-chunks",
      "title": "RAG retriever returns irrelevant chunks &quot;sometimes&quot;",
      "body": "<p>My retriever returns <code>unrelated</code> chunks.</p>"
    },
    {
      "tags": ["vector-database", "pgvector", "postgresql", "embeddings", "rag", "extra-tag"],
      "owner": {},
      "is_answered": false,
      "view_count": 41,
      "answer_count": 0,
      "score": -1,
      "creation_date": 1791900000,
      "question_id": 79923999,
      "link": "https://stackoverflow.com/questions/79923999/pgvector-index-not-used",
      "title": "pgvector index not used",
      "body": "<p>EXPLAIN shows seq scan.</p>"
    },
    {
      "tags": ["rag"],
      "owner": { "display_name": "x" },
      "is_answered": false,
      "view_count": 1,
      "answer_count": 0,
      "score": 0,
      "creation_date": 1791800000,
      "question_id": 1,
      "link": "https://evil.example.com/questions/1",
      "title": "off-site link",
      "body": ""
    }
  ],
  "has_more": false,
  "quota_max": 300,
  "quota_remaining": 290
}
```

- [ ] **Step 2: 실패하는 테스트 작성** — `tests/cs-providers.test.js` 상단 import에 추가하고 파일 끝에 테스트를 붙인다.

```js
import {
  buildSoUrl, parseSoSearch, createStackOverflowProvider, SO_LIMIT_REASON,
} from '../lib/providers/stackoverflow.js';
import { CS_MAX } from '../lib/providers/cs-common.js';
```

```js
// ─── Stack Overflow ───

test('SO 검색 URL: 90일·투표순·본문 포함, 키는 있을 때만', () => {
  assert.equal(
    buildSoUrl({ query: 'rag agents', fromEpochSec: 1_692_224_000, limit: 8, key: '' }),
    'https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=votes&q=rag+agents&site=stackoverflow&fromdate=1692224000&pagesize=8&filter=withbody',
  );
  assert.ok(buildSoUrl({ query: 'x', fromEpochSec: 1, limit: 8, key: 'k1' }).endsWith('&key=k1'));
});

test('SO 응답 파싱', () => {
  const items = parseSoSearch(fixture('so-search.json'));
  // stackoverflow.com이 아닌 링크는 버린다.
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    title: 'RAG retriever returns irrelevant chunks "sometimes"',
    url: 'https://stackoverflow.com/questions/79923286/rag-retriever-returns-irrelevant-chunks',
    author: 'dev&ops',
    tags: ['python', 'langchain', 'rag'],
    score: 7,
    answerCount: 2,
    isAnswered: true,
    hasAcceptedAnswer: true,
    viewCount: 605,
    publishedAt: new Date(1792074068 * 1000).toISOString(),
    text: 'My retriever returns unrelated chunks.',
  });
  // 음수 점수는 그대로, 작성자가 없으면 빈 문자열, 태그는 5개까지.
  assert.equal(items[1].score, -1);
  assert.equal(items[1].author, '');
  assert.equal(items[1].tags.length, 5);
  assert.equal(items[1].hasAcceptedAnswer, false);
});

test('SO 파서는 깨진 JSON에 빈 배열', () => {
  assert.deepEqual(parseSoSearch('{'), []);
});

test('SO provider: 90일 전 기준으로 부르고 결과를 캐시한다', async () => {
  const http = makeHttp(() => fixture('so-search.json'));
  const so = createStackOverflowProvider({ ...deps(http), key: '' });

  const first = await so.search({ query: 'rag', limit: CS_MAX.questions });
  await so.search({ query: 'rag', limit: CS_MAX.questions });

  assert.equal(first.items.length, 2);
  assert.deepEqual(first.degraded, []);
  assert.equal(http.calls.length, 1);
  // makeClock 기본 시각 1_700_000_000_000ms → 90일 전 1_692_224_000초
  assert.ok(http.calls[0].url.includes('fromdate=1692224000'));
});

test('SO provider: 400·429는 한도 사유, 그 밖은 일반 사유, 캐시하지 않는다', async () => {
  for (const [status, reason] of [[400, SO_LIMIT_REASON], [429, SO_LIMIT_REASON], [500, '자료를 가져오지 못했습니다.']]) {
    const http = makeHttp(() => upstream(status));
    const so = createStackOverflowProvider({ ...deps(http), key: '' });
    const r = await so.search({ query: 'rag', limit: 8 });
    assert.deepEqual(r, { items: [], degraded: [{ source: 'Stack Overflow', reason }] });
    await so.search({ query: 'rag', limit: 8 });
    assert.equal(http.calls.length, 2);
  }
});

test('SO provider: 200인데 HTML이거나 items가 없으면 degraded', async () => {
  for (const body of ['<html>blocked</html>', '{"quota_max":300}']) {
    const so = createStackOverflowProvider({ ...deps(makeHttp(() => body)), key: '' });
    const r = await so.search({ query: 'rag', limit: 8 });
    assert.equal(r.items.length, 0);
    assert.equal(r.degraded[0].source, 'Stack Overflow');
  }
});

test('SO provider: 키는 URL에만 싣고 사유·캐시 키에 남기지 않는다', async () => {
  const KEY = 'se-key-SECRET123';
  const http = makeHttp(() => upstream(400));
  const cacheKeys = [];
  const d = deps(http);
  const cache = { get: (k) => { cacheKeys.push(k); return undefined; }, set: (k) => cacheKeys.push(k) };
  const so = createStackOverflowProvider({ ...d, cache, key: KEY });
  const r = await so.search({ query: 'rag', limit: 8 });
  assert.ok(http.calls[0].url.includes(`key=${KEY}`));
  assert.ok(!JSON.stringify(r).includes(KEY));
  assert.ok(cacheKeys.every((k) => !k.includes(KEY)));
});

test('기본 허용 목록에 Stack Exchange·Lobsters가 있고 SE 키 기본값은 빈 문자열', () => {
  const config = loadConfig({
    MY_SECRET_PASSWORD: 'x', LLM_MODE: 'mock', EXTERNAL_ALLOWLIST: undefined, STACKEXCHANGE_KEY: undefined,
  });
  for (const host of ['api.stackexchange.com', 'lobste.rs']) {
    assert.ok(config.externalAllowlist.includes(host), host);
  }
  assert.equal(config.stackexchangeKey, '');
});
```

- [ ] **Step 3: 실패 확인**

Run: `node --import tsx --test tests/cs-providers.test.js`
Expected: FAIL — `Cannot find module '../lib/providers/stackoverflow.js'`

- [ ] **Step 4: `cs-common.js` 상한 추가**

`CS_LIMITS`에 `author: 100, tag: 35, tags: 5`를 추가한다. `CS_MAX`를 다음으로 바꾼다.

```js
export const CS_MAX = Object.freeze({ papers: 8, community: 10, questions: 8, news: 8, blogs: 8, repos: 8 });
```

- [ ] **Step 5: `lib/providers/stackoverflow.js` 작성**

```js
import {
  CS_LIMITS, DAY_MS, FETCH_FAILED, clamp, cleanText, httpUrlOrNull, nonNegInt,
  createCachedSource, jsonArrayField,
} from './cs-common.js';

// ─── Stack Overflow (Stack Exchange API 2.3) ───
//
// 키 없이 IP당 하루 300회, STACKEXCHANGE_KEY가 있으면 하루 10,000회.
// 점수·조회수는 "얼마나 많은 개발자가 막히는가"의 신호이지 정확성의 근거가 아니다.
// 글은 CC BY-SA다. 작성자 이름을 함께 싣는다.

export const SO_WINDOW_DAYS = 90;
export const SO_LIMIT_REASON = 'Stack Overflow 호출 한도를 초과했습니다. 잠시 뒤 다시 시도해 주세요.';

export function buildSoUrl({ query, fromEpochSec, limit, key }) {
  const params = new URLSearchParams({
    order: 'desc',
    sort: 'votes',
    q: query,
    site: 'stackoverflow',
    fromdate: String(fromEpochSec),
    pagesize: String(limit),
    filter: 'withbody',
  });
  if (key) params.set('key', key);
  return `https://api.stackexchange.com/2.3/search/advanced?${params}`;
}

const intOrZero = (n) => (Number.isInteger(n) ? n : 0);

export function parseSoSearch(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const items = Array.isArray(data?.items) ? data.items : [];

  return items.map((q) => {
    const url = httpUrlOrNull(q?.link);
    // 질문 링크는 stackoverflow.com이어야 한다. 다른 호스트는 출처로 믿을 수 없다.
    if (!url || !url.startsWith('https://stackoverflow.com/')) return null;
    const title = clamp(cleanText(q.title), CS_LIMITS.title);
    if (!title || !Number.isInteger(q.creation_date)) return null;

    const tags = (Array.isArray(q.tags) ? q.tags : [])
      .filter((t) => typeof t === 'string' && t)
      .slice(0, CS_LIMITS.tags)
      .map((t) => clamp(t, CS_LIMITS.tag));

    return {
      title,
      url,
      author: clamp(cleanText(q.owner?.display_name), CS_LIMITS.author),
      tags,
      score: intOrZero(q.score),
      answerCount: nonNegInt(q.answer_count),
      isAnswered: q.is_answered === true,
      hasAcceptedAnswer: q.accepted_answer_id != null,
      viewCount: nonNegInt(q.view_count),
      publishedAt: new Date(q.creation_date * 1000).toISOString(),
      text: clamp(cleanText(q.body), CS_LIMITS.text),
    };
  }).filter(Boolean);
}

export function createStackOverflowProvider({ http, cache, clock, makeBreaker, key = '' }) {
  const fetchSource = createCachedSource({
    http, cache, makeBreaker, source: 'Stack Overflow',
    // lib/http.js는 오류 본문을 버리고 상태 코드만 남긴다. SE는 한도 초과를 400(throttle_violation)으로 준다.
    failureReason: (err) => ([400, 429].includes(err?.upstreamStatus) ? SO_LIMIT_REASON : FETCH_FAILED),
  });

  return {
    search({ query, limit }) {
      const fromEpochSec = Math.floor(clock.now() / 1000) - SO_WINDOW_DAYS * (DAY_MS / 1000);
      return fetchSource({
        // 키는 캐시 키에 넣지 않는다. 결과는 키와 무관하다.
        key: `so:${limit}:${query}`,
        url: buildSoUrl({ query, fromEpochSec, limit, key }),
        parse: (text) => {
          jsonArrayField(text, 'items');
          return parseSoSearch(text).slice(0, limit);
        },
      });
    },
  };
}
```

- [ ] **Step 6: 설정**

`lib/config.js:83`의 허용목록 기본 문자열 끝(`…,toss.tech`)에 `,api.stackexchange.com,lobste.rs`를 붙인다. `githubToken` 줄 아래에 추가한다.

```js
    stackexchangeKey: e.STACKEXCHANGE_KEY ?? '',
```

`.env.example`의 `EXTERNAL_ALLOWLIST=` 줄 끝에 `,api.stackexchange.com,lobste.rs`를 붙이고, `GITHUB_TOKEN=` 줄 아래에 추가한다.

```
# Stack Overflow 검색 키(선택). 없으면 IP당 하루 300회, 있으면 10,000회. stackapps.com에서 무료 발급.
STACKEXCHANGE_KEY=
```

- [ ] **Step 7: 통과 확인**

Run: `node --import tsx --test tests/cs-providers.test.js`
Expected: PASS (전부)

- [ ] **Step 8: 전체 테스트**

Run: `npm test`
Expected: 0 fail. `CS_MAX`를 쓰는 기존 테스트가 깨지면 그 테스트가 `questions` 키를 몰라서다 — 기대값에 `questions: 8`을 더한다.

- [ ] **Step 9: 커밋**

```bash
git add lib/providers/cs-common.js lib/providers/stackoverflow.js lib/config.js .env.example tests/fixtures/so-search.json tests/cs-providers.test.js
git commit -m "feat: add Stack Overflow provider for CS briefing"
```

---

### Task 2: Lobsters provider, HN `site`, 커뮤니티 합치기

**Files:**
- Modify: `lib/providers/hackernews.js` (항목에 `site: 'hackernews'`)
- Create: `lib/providers/lobsters.js`
- Create: `lib/providers/community.js`
- Create: `tests/fixtures/lobsters-tags.json`, `tests/fixtures/lobsters-ai.json`, `tests/fixtures/lobsters-newest.json`
- Test: `tests/cs-providers.test.js`, `tests/cs-community.test.js`(새 파일)

**Interfaces:**
- Consumes: `CS_LIMITS`, `CS_MAX.community`, `createCachedSource`, `MalformedUpstream` (cs-common)
- Produces: `LOBSTERS_TAG_ALIASES`, `pickLobstersTags(query, tagNames) → string[]`(최대 2), `parseLobstersStories(text) → item[]`, `createLobstersProvider({ http, cache, clock, makeBreaker, tagCache })` → `{ search({ query, limit }) }`
- Produces: 커뮤니티 항목 `{ site: 'hackernews' | 'lobsters', title, url, discussionUrl, points, numComments, publishedAt, text }`
- Produces: `COMMUNITY_SHARE = { hackernews: 6, lobsters: 4 }`, `mergeCommunity(hnItems, lobstersItems, max) → item[]`

- [ ] **Step 1: fixture 작성**

`tests/fixtures/lobsters-tags.json`:

```json
[
  { "tag": "ai", "description": "Artificial Intelligence", "active": true, "category": "field" },
  { "tag": "databases", "description": "Databases", "active": true, "category": "field" },
  { "tag": "rust", "description": "Rust programming", "active": true, "category": "languages" },
  { "tag": "go", "description": "Golang programming", "active": true, "category": "languages" },
  { "tag": "retired", "description": "old", "active": false, "category": "meta" }
]
```

`tests/fixtures/lobsters-ai.json`(태그 피드, makeClock 기본 시각 2023-11-14T22:13:20Z 기준으로 1·2번은 30일 안, 3번은 밖, 4번은 잘못된 short_id):

```json
[
  {
    "short_id": "abc123", "created_at": "2023-11-10T11:07:51.827-06:00",
    "title": "Local LLM inference on a Mac mini", "url": "",
    "score": 13, "comment_count": 5, "description_plain": "What works &amp; what doesn't.",
    "tags": ["ai", "hardware"], "short_id_url": "https://lobste.rs/s/abc123",
    "comments_url": "https://lobste.rs/s/abc123/local_llm_inference_on_mac_mini"
  },
  {
    "short_id": "def456", "created_at": "2023-11-01T09:00:00.000-05:00",
    "title": "Retrieval for code search", "url": "https://example.com/code-search",
    "score": 40, "comment_count": 12, "description_plain": "",
    "tags": ["ai", "search"], "short_id_url": "https://lobste.rs/s/def456",
    "comments_url": "https://lobste.rs/s/def456/retrieval_for_code_search"
  },
  {
    "short_id": "old789", "created_at": "2023-09-01T09:00:00.000-05:00",
    "title": "Old story", "url": "https://example.com/old",
    "score": 99, "comment_count": 1, "description_plain": "",
    "tags": ["ai"], "short_id_url": "https://lobste.rs/s/old789",
    "comments_url": "https://lobste.rs/s/old789/old_story"
  },
  {
    "short_id": "../bad", "created_at": "2023-11-10T09:00:00.000-05:00",
    "title": "Bad id", "url": "https://example.com/bad",
    "score": 50, "comment_count": 0, "description_plain": "",
    "tags": ["ai"], "short_id_url": "https://lobste.rs/s/bad",
    "comments_url": "https://lobste.rs/s/bad/bad_id"
  }
]
```

`tests/fixtures/lobsters-newest.json`:

```json
[
  {
    "short_id": "new111", "created_at": "2023-11-12T10:00:00.000Z",
    "title": "Zig 0.14 released", "url": "https://ziglang.org/news",
    "score": 30, "comment_count": 8, "description_plain": "",
    "tags": ["zig", "release"], "short_id_url": "https://lobste.rs/s/new111",
    "comments_url": "https://lobste.rs/s/new111/zig_0_14_released"
  },
  {
    "short_id": "new222", "created_at": "2023-11-12T11:00:00.000Z",
    "title": "Writing a webassembly runtime", "url": "https://example.com/wasm",
    "score": 12, "comment_count": 3, "description_plain": "",
    "tags": ["wasm", "compilers"], "short_id_url": "https://lobste.rs/s/new222",
    "comments_url": "https://lobste.rs/s/new222/writing_webassembly_runtime"
  }
]
```

- [ ] **Step 2: HN 테스트 갱신(실패하게)** — `tests/cs-providers.test.js`의 `'HN 응답 파싱'` 기대 객체 첫 줄에 `site: 'hackernews',`를 넣는다.

- [ ] **Step 3: Lobsters 테스트 작성** — `tests/cs-providers.test.js` import와 끝에 추가.

```js
import {
  pickLobstersTags, parseLobstersStories, createLobstersProvider,
} from '../lib/providers/lobsters.js';
```

```js
// ─── Lobsters ───

const TAGS = ['ai', 'databases', 'rust', 'go'];

test('Lobsters 태그 고르기: 정확 일치·별칭·최대 2개·없는 별칭', () => {
  assert.deepEqual(pickLobstersTags('Rust async runtime', TAGS), ['rust']);
  assert.deepEqual(pickLobstersTags('retrieval augmented generation', TAGS), []);
  assert.deepEqual(pickLobstersTags('LLM agents', TAGS), ['ai']);
  assert.deepEqual(pickLobstersTags('machine learning in go with sql', TAGS), ['ai', 'go']);
  // 별칭이 가리키는 태그가 목록에 없으면 쓰지 않는다.
  assert.deepEqual(pickLobstersTags('kubernetes operators', TAGS), []);
});

test('Lobsters 글 파싱: 링크 없는 글은 토론 링크, 잘못된 short_id는 버림', () => {
  const items = parseLobstersStories(fixture('lobsters-ai.json'));
  assert.equal(items.length, 3);
  assert.deepEqual(items[0], {
    site: 'lobsters',
    title: 'Local LLM inference on a Mac mini',
    url: 'https://lobste.rs/s/abc123/local_llm_inference_on_mac_mini',
    discussionUrl: 'https://lobste.rs/s/abc123/local_llm_inference_on_mac_mini',
    points: 13,
    numComments: 5,
    publishedAt: '2023-11-10T17:07:51.827Z',
    text: "What works & what doesn't.",
  });
  assert.equal(items[1].url, 'https://example.com/code-search');
});

const lobstersHttp = (routes) => makeHttp((url) => {
  for (const [pattern, body] of Object.entries(routes)) if (url.includes(pattern)) return body;
  return new Error(`라우트 없음: ${url}`);
});

test('Lobsters provider: 태그 피드를 30일·점수순으로, 태그 목록은 한 번만', async () => {
  const http = lobstersHttp({
    '/tags.json': fixture('lobsters-tags.json'),
    '/t/ai.json': fixture('lobsters-ai.json'),
  });
  const lob = createLobstersProvider(deps(http));

  const r = await lob.search({ query: 'llm inference', limit: 10 });
  assert.deepEqual(r.degraded, []);
  assert.deepEqual(r.items.map((i) => i.title), ['Retrieval for code search', 'Local LLM inference on a Mac mini']);

  await lob.search({ query: 'rag', limit: 10 });
  assert.equal(http.calls.filter((c) => c.url.endsWith('/tags.json')).length, 1);
});

test('Lobsters provider: 맞는 태그가 없으면 최신 글에서 질의 단어로 거른다', async () => {
  const http = lobstersHttp({
    '/tags.json': fixture('lobsters-tags.json'),
    '/newest.json': fixture('lobsters-newest.json'),
  });
  const r = await createLobstersProvider(deps(http)).search({ query: 'webassembly runtime', limit: 10 });
  assert.deepEqual(r.items.map((i) => i.title), ['Writing a webassembly runtime']);
});

test('Lobsters provider: 태그 목록 실패는 알리지 않고 최신 글로 대체한다', async () => {
  const http = lobstersHttp({
    '/tags.json': new Error('down'),
    '/newest.json': fixture('lobsters-newest.json'),
  });
  const r = await createLobstersProvider(deps(http)).search({ query: 'zig release', limit: 10 });
  assert.deepEqual(r.degraded, []);
  assert.deepEqual(r.items.map((i) => i.title), ['Zig 0.14 released']);
});

test('Lobsters provider: 글 피드 실패·HTML 200은 degraded이고 캐시하지 않는다', async () => {
  for (const feed of [new Error('down'), '<html>blocked</html>']) {
    const http = lobstersHttp({ '/tags.json': fixture('lobsters-tags.json'), '/t/ai.json': feed });
    const lob = createLobstersProvider(deps(http));
    const r = await lob.search({ query: 'llm', limit: 10 });
    assert.deepEqual(r, { items: [], degraded: [{ source: 'Lobsters', reason: '자료를 가져오지 못했습니다.' }] });
    await lob.search({ query: 'llm', limit: 10 });
    assert.equal(http.calls.filter((c) => c.url.endsWith('/t/ai.json')).length, 2);
  }
});
```

- [ ] **Step 4: 커뮤니티 합치기 테스트** — 새 파일 `tests/cs-community.test.js`.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCommunity, COMMUNITY_SHARE } from '../lib/providers/community.js';

const item = (site, i) => ({
  site, title: `${site} ${i}`, url: `https://example.com/${site}/${i}`,
  discussionUrl: `https://d.example.com/${site}/${i}`, points: 1, numComments: 0,
  publishedAt: '2026-11-01T00:00:00.000Z', text: '',
});
const many = (site, n) => Array.from({ length: n }, (_, i) => item(site, i + 1));

test('기본 몫은 HN 6, Lobsters 4', () => {
  assert.deepEqual(COMMUNITY_SHARE, { hackernews: 6, lobsters: 4 });
  const merged = mergeCommunity(many('hackernews', 10), many('lobsters', 10), 10);
  assert.deepEqual(merged.map((m) => m.title), [
    'hackernews 1', 'hackernews 2', 'hackernews 3', 'hackernews 4', 'hackernews 5', 'hackernews 6',
    'lobsters 1', 'lobsters 2', 'lobsters 3', 'lobsters 4',
  ]);
});

test('한쪽이 모자라면 다른 쪽 나머지로 채운다', () => {
  assert.deepEqual(
    mergeCommunity(many('hackernews', 10), many('lobsters', 1), 10).map((m) => m.title),
    [...many('hackernews', 6).map((m) => m.title), 'lobsters 1', 'hackernews 7', 'hackernews 8', 'hackernews 9'],
  );
  assert.equal(mergeCommunity([], many('lobsters', 10), 10).length, 10);
});

test('같은 url은 먼저 온 것만 남긴다', () => {
  const dup = { ...item('lobsters', 1), url: 'https://example.com/hackernews/1' };
  const merged = mergeCommunity(many('hackernews', 2), [dup, item('lobsters', 2)], 10);
  assert.deepEqual(merged.map((m) => m.title), ['hackernews 1', 'hackernews 2', 'lobsters 2']);
});
```

- [ ] **Step 5: 실패 확인**

Run: `node --import tsx --test tests/cs-providers.test.js tests/cs-community.test.js`
Expected: FAIL — 모듈 없음, HN 파싱 기대값 불일치.

- [ ] **Step 6: HN에 `site`** — `lib/providers/hackernews.js`의 `parseHnSearch` 반환 객체 첫 속성으로 `site: 'hackernews',`를 넣는다.

- [ ] **Step 7: `lib/providers/lobsters.js` 작성**

```js
import {
  CS_LIMITS, DAY_MS, clamp, cleanText, httpUrlOrNull, isoOrNull, nonNegInt,
  createCachedSource, MalformedUpstream,
} from './cs-common.js';
import { createTtlCache } from '../cost-defense.js';
import { HN_WINDOW_DAYS } from './hackernews.js';

// ─── Lobsters ───
//
// 검색 JSON이 없다. 질의를 태그로 바꿔 태그 피드를 읽고, 맞는 태그가 없으면 최신 글에서 거른다.
// 점수·댓글 수는 화제성이지 정확성이 아니다.

const BASE = 'https://lobste.rs';
const MAX_TAGS = 2;
const TAGS_TTL_MS = DAY_MS;

/** 흔한 표현 → Lobsters 태그. 태그 목록에 실제로 있을 때만 쓴다. */
export const LOBSTERS_TAG_ALIASES = Object.freeze({
  llm: 'ai', llms: 'ai', rag: 'ai', gpt: 'ai', transformer: 'ai', transformers: 'ai',
  'machine learning': 'ai', 'deep learning': 'ai', ml: 'ai', agent: 'ai', agents: 'ai',
  database: 'databases', db: 'databases', sql: 'databases',
  golang: 'go',
  js: 'javascript', typescript: 'javascript', node: 'javascript',
  k8s: 'devops', kubernetes: 'devops', docker: 'devops',
  crypto: 'security', cryptography: 'security',
});

const words = (query) => String(query).toLowerCase().split(/[^a-z0-9+#.-]+/).filter(Boolean);

export function pickLobstersTags(query, tagNames) {
  const available = new Set(tagNames);
  const ws = words(query);
  const picked = [];
  const add = (tag) => {
    if (tag && available.has(tag) && !picked.includes(tag)) picked.push(tag);
  };
  for (let i = 0; i < ws.length; i += 1) {
    // 두 단어 별칭("machine learning")을 먼저 본다.
    const pair = ws[i + 1] ? `${ws[i]} ${ws[i + 1]}` : null;
    if (pair && LOBSTERS_TAG_ALIASES[pair]) {
      add(LOBSTERS_TAG_ALIASES[pair]);
      i += 1;
      continue;
    }
    add(available.has(ws[i]) ? ws[i] : LOBSTERS_TAG_ALIASES[ws[i]]);
  }
  return picked.slice(0, MAX_TAGS);
}

export function parseLobstersStories(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];

  return data.map((s) => {
    // 토론 링크를 만드는 값이다. 형식이 다르면 링크를 신뢰할 수 없다.
    if (!/^[a-z0-9]+$/.test(String(s?.short_id ?? ''))) return null;
    const discussionUrl = httpUrlOrNull(s.comments_url);
    if (!discussionUrl || !discussionUrl.startsWith(`${BASE}/s/${s.short_id}`)) return null;
    const title = clamp(cleanText(s.title), CS_LIMITS.title);
    const publishedAt = isoOrNull(s.created_at);
    if (!title || !publishedAt) return null;

    return {
      site: 'lobsters',
      title,
      // 링크가 없는 글은 토론 페이지가 원문이다.
      url: httpUrlOrNull(s.url) ?? discussionUrl,
      discussionUrl,
      points: nonNegInt(s.score),
      numComments: nonNegInt(s.comment_count),
      publishedAt,
      text: clamp(cleanText(s.description_plain), CS_LIMITS.text),
      tags: Array.isArray(s.tags) ? s.tags.filter((t) => typeof t === 'string') : [],
    };
  }).filter(Boolean);
}

/** 본문이 JSON 배열이 아니면(차단 안내 HTML 등) 실패로 다룬다. */
const jsonArray = (text) => {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new MalformedUpstream('not json');
  }
  if (!Array.isArray(data)) throw new MalformedUpstream('not array');
};

export function createLobstersProvider({
  http, cache, clock, makeBreaker,
  // 태그 목록은 하루 붙잡아 둔다. CS 공용 캐시와 TTL이 달라 따로 둔다.
  tagCache = createTtlCache({ ttlMs: TAGS_TTL_MS, maxEntries: 1, clock }),
}) {
  const fetchStories = createCachedSource({ http, cache, makeBreaker, source: 'Lobsters' });
  const fetchTags = createCachedSource({ http, cache: tagCache, makeBreaker, source: 'Lobsters tags' });

  const tagNames = async () => {
    const { items } = await fetchTags({
      key: 'lobsters:tags',
      url: `${BASE}/tags.json`,
      parse: (text) => {
        jsonArray(text);
        return JSON.parse(text).filter((t) => t?.active && typeof t.tag === 'string').map((t) => t.tag);
      },
    });
    // 실패해도 알리지 않는다. 최신 글로 대체한다.
    return items;
  };

  const stories = (path) => fetchStories({
    key: `lobsters:${path}`,
    url: `${BASE}${path}`,
    parse: (text) => {
      jsonArray(text);
      return parseLobstersStories(text);
    },
  });

  return {
    async search({ query, limit }) {
      const since = clock.now() - HN_WINDOW_DAYS * DAY_MS;
      const tags = pickLobstersTags(query, await tagNames());

      let items = [];
      const degraded = [];
      if (tags.length > 0) {
        const results = await Promise.all(tags.map((t) => stories(`/t/${t}.json`)));
        for (const r of results) {
          items.push(...r.items);
          degraded.push(...r.degraded);
        }
      } else {
        const r = await stories('/newest.json');
        degraded.push(...r.degraded);
        const keywords = words(query).filter((w) => w.length >= 3);
        items = r.items.filter((s) => keywords.some((k) =>
          s.title.toLowerCase().includes(k) || s.tags.some((t) => t.includes(k))));
      }

      const seen = new Set();
      const picked = items
        .filter((s) => Date.parse(s.publishedAt) >= since)
        .filter((s) => (seen.has(s.discussionUrl) ? false : seen.add(s.discussionUrl)))
        .sort((a, b) => b.points - a.points)
        .slice(0, limit)
        // tags는 거르기에만 쓴다. 커뮤니티 공통 모양에 없는 필드다.
        .map(({ tags: _tags, ...rest }) => rest);

      // 같은 사유가 태그마다 반복되면 하나로 합친다.
      const uniqueDegraded = [...new Map(degraded.map((d) => [`${d.source}:${d.reason}`, d])).values()];
      return { items: picked, degraded: uniqueDegraded };
    },
  };
}
```

`parseLobstersStories` 테스트의 `deepEqual`은 `tags` 필드 때문에 실패한다. 테스트 기대 객체에 `tags: ['ai', 'hardware'],`를 마지막 속성으로 넣는다(파서는 거르기용으로 `tags`를 남기고, provider가 내보내기 전에 뺀다).

- [ ] **Step 8: `lib/providers/community.js` 작성**

```js
// ─── 커뮤니티 합치기 ───
//
// HN과 Lobsters를 한 목록으로 싣는다. 한쪽이 몫보다 적으면 다른 쪽 나머지로 채운다.

export const COMMUNITY_SHARE = Object.freeze({ hackernews: 6, lobsters: 4 });

export function mergeCommunity(hn = [], lobsters = [], max) {
  const head = [
    ...hn.slice(0, COMMUNITY_SHARE.hackernews),
    ...lobsters.slice(0, COMMUNITY_SHARE.lobsters),
  ];
  const rest = [
    ...hn.slice(COMMUNITY_SHARE.hackernews),
    ...lobsters.slice(COMMUNITY_SHARE.lobsters),
  ];
  const seen = new Set();
  const out = [];
  for (const item of [...head, ...rest]) {
    if (out.length >= max) break;
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}
```

- [ ] **Step 9: 통과 확인**

Run: `node --import tsx --test tests/cs-providers.test.js tests/cs-community.test.js`
Expected: PASS

- [ ] **Step 10: 전체 테스트**

Run: `npm test`
Expected: HN 항목 모양이 바뀌어 `communitySchema`(strict)가 `site`를 거부하는 테스트가 깨질 수 있다(`'수집기 출력은 그대로 CS 분석 스키마를 통과한다'`, `cs-collect`의 분석 흐름). **이 태스크에서 스키마를 미리 고치지 않는다** — Task 3이 고친다. 깨지는 테스트 이름을 보고서에 적고, 다른 원인의 실패가 없는지만 확인한다.

- [ ] **Step 11: 커밋**

```bash
git add lib/providers/hackernews.js lib/providers/lobsters.js lib/providers/community.js tests/fixtures/lobsters-*.json tests/cs-providers.test.js tests/cs-community.test.js
git commit -m "feat: add Lobsters provider and merge it with Hacker News"
```

---

### Task 3: 입력 스키마와 CS 프로필

**Files:**
- Modify: `lib/validation.js:177-240` (`CS_SCOPES`, `communitySchema`, `questionSchema`, `buildCsAnalyzeSchema`)
- Modify: `lib/modes/cs.js` (normalize, hashInput, buildSources, urlWhitelist, baseMeta)
- Modify: `lib/modes/cs-prompt.js` (`buildCsUserPrompt` 질문 블록·커뮤니티 사이트 표시·자료 수 줄)
- Modify: `tests/cs-fixtures.js` (`hn()`에 `site`, `question()` 추가)
- Modify: `tests/client/cs-fixtures.js` (커뮤니티 항목에 `site: 'hackernews'`)
- Test: `tests/cs-profile.test.js`

**Interfaces:**
- Consumes: 질문 항목 모양(Task 1), 커뮤니티 항목 모양(Task 2), `CS_MAX.questions`, `CS_LIMITS.author/tag/tags`
- Produces: `CS_SCOPES = ['papers', 'community', 'questions', 'news', 'blogs', 'repos']`
- Produces: `csProfile.normalize(data).questions`(ID `Q1…`), `baseMeta(n).counts.questions`
- Produces: 출처 `type: 'question'`, `source: 'Stack Overflow · <작성자|작성자 미상> · CC BY-SA'`; 커뮤니티 출처 `source`는 `'Hacker News'` 또는 `'Lobsters'`

- [ ] **Step 1: 테스트 자료 갱신** — `tests/cs-fixtures.js`

`hn()` 기본 객체 첫 줄에 `site: 'hackernews',`. 아래 함수를 추가한다.

```js
export const lobsters = (over = {}) => ({
  site: 'lobsters',
  title: 'Retrieval for code search',
  url: 'https://example.com/code-search',
  discussionUrl: 'https://lobste.rs/s/def456/retrieval_for_code_search',
  points: 40,
  numComments: 12,
  publishedAt: '2026-11-01T14:00:00.000Z',
  text: '',
  ...over,
});

export const question = (over = {}) => ({
  title: 'RAG retriever returns irrelevant chunks',
  url: 'https://stackoverflow.com/questions/79923286/rag-retriever-returns-irrelevant-chunks',
  author: 'devops',
  tags: ['python', 'rag'],
  score: 7,
  answerCount: 2,
  isAnswered: true,
  hasAcceptedAnswer: true,
  viewCount: 605,
  publishedAt: '2026-10-20T00:00:00.000Z',
  text: 'My retriever returns unrelated chunks.',
  ...over,
});
```

`csData()`는 그대로 둔다(질문 없음 — 기존 테스트 유지). `tests/client/cs-fixtures.js`의 `CS_COLLECT.community[0]`에 `site: 'hackernews',`를 넣는다.

- [ ] **Step 2: 실패하는 테스트** — `tests/cs-profile.test.js` import에 `lobsters, question`을 더하고 끝에 추가.

```js
test('normalize: 질문에 Q ID를 붙이고 합계에 센다', () => {
  const n = csProfile.normalize(csData({ questions: [question(), question({ url: 'https://stackoverflow.com/questions/2/x' })] }));
  assert.deepEqual(n.questions.map((q) => q.sourceId), ['Q1', 'Q2']);
  assert.equal(n.total, 8);
  assert.equal(csProfile.baseMeta(n).counts.questions, 2);
});

test('hashInput에 질문이 들어간다', () => {
  const a = csProfile.hashInput(csProfile.normalize(csData()));
  const b = csProfile.hashInput(csProfile.normalize(csData({ questions: [question()] })));
  assert.notDeepEqual(a, b);
  assert.equal(b.questions.length, 1);
});

test('buildSources: Lobsters·Stack Overflow 출처 이름과 CC BY-SA 표기', () => {
  const n = csProfile.normalize(csData({
    community: [hn(), lobsters()],
    questions: [question(), question({ url: 'https://stackoverflow.com/questions/2/x', author: '' })],
  }));
  const sources = csProfile.buildSources(n, '2026-11-09T00:00:00.000Z');
  const by = new Map(sources.map((s) => [s.sourceId, s]));
  assert.equal(by.get('H1').source, 'Hacker News');
  assert.equal(by.get('H2').source, 'Lobsters');
  assert.equal(by.get('H2').url, 'https://lobste.rs/s/def456/retrieval_for_code_search');
  assert.equal(by.get('Q1').type, 'question');
  assert.equal(by.get('Q1').source, 'Stack Overflow · devops · CC BY-SA');
  assert.equal(by.get('Q2').source, 'Stack Overflow · 작성자 미상 · CC BY-SA');
  assert.equal(by.get('Q1').url, question().url);
  // 순서: 논문 → 커뮤니티 → 질문 → 뉴스 → 블로그 → 저장소
  assert.deepEqual(sources.map((s) => s.sourceId[0]), ['P', 'P', 'H', 'H', 'Q', 'Q', 'S', 'B', 'G']);
});

test('urlWhitelist에 질문 링크가 있다', () => {
  const urls = csProfile.urlWhitelist(csProfile.normalize(csData({ questions: [question()] })));
  assert.ok(urls.has(question().url));
});

test('사용자 프롬프트: 질문 구획과 커뮤니티 사이트 표시', () => {
  const n = csProfile.normalize(csData({ community: [hn(), lobsters()], questions: [question()] }));
  const p = csProfile.buildUserPrompt(n, { collectedAt: '2026-11-09T00:00:00.000Z' });
  assert.ok(p.includes('[개발자 질문 (Stack Overflow)]'));
  assert.ok(p.includes('- 출처 ID: Q1'));
  assert.ok(p.includes('- 반응: 점수 7 · 답변 2 · 채택 답변 있음 · 조회 605'));
  assert.ok(p.includes('- 태그: python, rag'));
  assert.ok(p.includes('- 사이트: Lobsters'));
  assert.ok(p.includes('질문 1'));
});

test('CS 분석 스키마: 커뮤니티 site 필수, 질문 strict·상한', () => {
  const schema = csProfile.buildAnalyzeSchema(loadConfig({ MY_SECRET_PASSWORD: 'x', LLM_MODE: 'mock' }));
  const { site: _site, ...noSite } = hn();
  assert.equal(schema.safeParse({ community: [noSite] }).success, false);
  assert.equal(schema.safeParse({ community: [hn({ site: 'reddit' })] }).success, false);
  assert.equal(schema.safeParse({ community: [lobsters()] }).success, true);
  assert.equal(schema.safeParse({ questions: [question()] }).success, true);
  assert.equal(schema.safeParse({ questions: [question({ extra: 1 })] }).success, false);
  assert.equal(schema.safeParse({ questions: [question({ score: -3 })] }).success, true);
  assert.equal(schema.safeParse({ questions: Array.from({ length: 9 }, () => question()) }).success, false);
});
```

`loadConfig` import가 없으면 `import { loadConfig } from '../server.js';`를 더한다. 이미 있는 스키마 생성 방식이 있으면 그것을 쓴다.

기존 `'CS 수집 스키마와 범위 정규화'` 테스트가 `CS_SCOPES` 전체를 기대하면 `questions`를 두 번째 뒤에 넣은 새 순서로 고친다.

- [ ] **Step 3: 실패 확인**

Run: `node --import tsx --test tests/cs-profile.test.js`
Expected: FAIL

- [ ] **Step 4: `lib/validation.js`**

```js
export const CS_SCOPES = ['papers', 'community', 'questions', 'news', 'blogs', 'repos'];
```

`communitySchema`의 첫 속성으로 추가한다.

```js
  site: z.enum(['hackernews', 'lobsters']),
```

`repoSchema` 아래에 추가한다.

```js
const questionSchema = z.strictObject({
  title: z.string().min(1).max(CS_LIMITS.title),
  url: httpUrl,
  author: z.string().max(CS_LIMITS.author),
  tags: z.array(z.string().min(1).max(CS_LIMITS.tag)).max(CS_LIMITS.tags),
  score: z.number().int(),
  answerCount: z.number().int().min(0),
  isAnswered: z.boolean(),
  hasAcceptedAnswer: z.boolean(),
  viewCount: z.number().int().min(0),
  publishedAt: parsableDate,
  text: z.string().max(CS_LIMITS.text),
});
```

`buildCsAnalyzeSchema`의 `community` 줄 아래에:

```js
    questions: z.array(questionSchema).max(CS_MAX.questions).optional(),
```

- [ ] **Step 5: `lib/modes/cs.js`**

`normalize`의 `n` 객체에 `questions: withIds('Q', data.questions),`(community 다음), 합계에 `n.questions.length`를 더한다. `hashInput`에 `questions: n.questions`. `buildSources`의 커뮤니티 매핑과 질문 매핑:

```js
      // 커뮤니티 출처는 토론 페이지로 연결한다. 원문 링크는 글 자체가 가리킨다.
      ...sourceOf(n.community, 'community', collectedAt, (h) => ({
        title: h.title, source: SITE_NAME[h.site], url: h.discussionUrl, publishedAt: h.publishedAt,
      })),
      // Stack Overflow 글은 CC BY-SA다. 출처 이름에 작성자와 라이선스를 싣는다.
      ...sourceOf(n.questions, 'question', collectedAt, (q) => ({
        title: q.title,
        source: `Stack Overflow · ${q.author || '작성자 미상'} · CC BY-SA`,
        url: q.url,
        publishedAt: q.publishedAt,
      })),
```

파일 위쪽에 `const SITE_NAME = Object.freeze({ hackernews: 'Hacker News', lobsters: 'Lobsters' });`. `urlWhitelist`의 첫 루프 목록에 `n.questions`를 넣는다. `baseMeta.counts`에 `questions: n.questions.length`(community 다음).

- [ ] **Step 6: `lib/modes/cs-prompt.js` 사용자 프롬프트**

커뮤니티 블록의 `- 제목:` 앞 줄에 `` `- 사이트: ${h.site === 'lobsters' ? 'Lobsters' : 'Hacker News'}`, ``를 넣는다. 질문 블록을 추가한다.

```js
  const questions = block(n.questions, (q) => [
    `- 출처 ID: ${q.sourceId}`,
    `- 제목: ${esc(q.title)}`,
    `- 태그: ${q.tags.length ? esc(q.tags.join(', ')) : '없음'}`,
    `- 작성일: ${esc(q.publishedAt)}`,
    `- 반응: 점수 ${q.score} · 답변 ${q.answerCount} · ${q.hasAcceptedAnswer ? '채택 답변 있음' : '채택 답변 없음'} · 조회 ${q.viewCount}`,
    `- 본문 발췌: ${q.text ? esc(q.text) : '없음'}`,
  ].join('\n'));
```

템플릿에서 커뮤니티 구획 제목을 `[커뮤니티 (Hacker News·Lobsters)]`로 바꾸고, 그 아래에 구획을 넣는다.

```
[개발자 질문 (Stack Overflow)]

${questions}
```

자료 수 줄을 `- 자료 수: 논문 … · 커뮤니티 ${n.community.length} · 질문 ${n.questions.length} · 뉴스 …`로 바꾼다.

- [ ] **Step 7: 통과 확인**

Run: `node --import tsx --test tests/cs-profile.test.js tests/cs-providers.test.js`
Expected: PASS

- [ ] **Step 8: 전체 테스트**

Run: `npm test`
Expected: 0 fail. 기존 테스트가 커뮤니티 구획 제목 `[커뮤니티 (Hacker News)]`나 자료 수 줄을 문자열로 기대하면 새 문구로 고친다. `cs-collect`의 수집 라우트 테스트는 아직 Lobsters·SO를 부르지 않는다(Task 5).

- [ ] **Step 9: 커밋**

```bash
git add lib/validation.js lib/modes/cs.js lib/modes/cs-prompt.js tests/cs-fixtures.js tests/client/cs-fixtures.js tests/cs-profile.test.js
git commit -m "feat: accept Stack Overflow questions and community site in CS analysis"
```

---

### Task 4: `developerPainPoints` 응답·프롬프트 규칙·품질 검사·eval

**Files:**
- Modify: `lib/modes/cs-schema.js` (`CS_JSON_SCHEMA`, `CS_MOCK_REPORT`)
- Modify: `lib/modes/cs-prompt.js` (`CS_SYSTEM_PROMPT`)
- Modify: `lib/quality/cs.js` (`CS_ID_PREFIXES`, `checkSourceRefs`)
- Modify: `eval/run.js:33` (`'PHSBG'` → `CS_ID_PREFIXES`)
- Modify: `eval/contexts/cs.json` 대신 새 컨텍스트 `eval/contexts/cs-questions.json`
- Create: `eval/cases/cs-10-painpoint-wrong-type.json`, `eval/cases/cs-11-painpoints-missing.json`
- Test: `tests/quality-cs.test.js`

**Interfaces:**
- Consumes: 출처 `type: 'question'`, ID `Q…`(Task 3)
- Produces: `CS_ID_PREFIXES = 'PHSBGQ'`(export, `lib/quality/cs.js`)
- Produces: 응답 필드 `developerPainPoints: Array<{ title: string, detail: string, sourceIds: string[] }>`

- [ ] **Step 1: 실패하는 테스트** — `tests/quality-cs.test.js` 끝에 추가(파일 위쪽의 기존 헬퍼·import를 쓴다. `CS_ID_PREFIXES`를 import에 더한다).

```js
const qCtx = () => buildCsQualityContext([
  { sourceId: 'P1', title: 'p', source: 'arXiv', publishedAt: '2026-11-01', type: 'paper' },
  { sourceId: 'H1', title: 'h', source: 'Lobsters', publishedAt: '2026-11-01', type: 'community' },
  { sourceId: 'Q1', title: 'q1', source: 'Stack Overflow · a · CC BY-SA', publishedAt: '2026-11-01', type: 'question' },
  { sourceId: 'Q2', title: 'q2', source: 'Stack Overflow · b · CC BY-SA', publishedAt: '2026-11-01', type: 'question' },
]);

test('CS 인용 접두사는 PHSBGQ다', () => {
  assert.equal(CS_ID_PREFIXES, 'PHSBGQ');
  assert.equal(qCtx().idPrefixes, 'PHSBGQ');
});

test('sourceRefs: 막히는 지점은 Q 출처만 남기고, 남는 게 없으면 항목을 뺀다', () => {
  const analysis = {
    developerPainPoints: [
      { title: 'a', detail: 'd', sourceIds: ['Q1', 'P1', 'Q9', 'Q1'] },
      { title: 'b', detail: 'd', sourceIds: ['H1'] },
    ],
  };
  const { analysis: out, issues } = checkSourceRefs(analysis, qCtx());
  assert.deepEqual(out.developerPainPoints, [{ title: 'a', detail: 'd', sourceIds: ['Q1'] }]);
  assert.ok(issues.some((i) => i.severity === 'fixed' && i.path === 'developerPainPoints[0].sourceIds'));
  assert.ok(issues.some((i) => i.severity === 'fixed' && i.path === 'developerPainPoints[1]'));
});

test('sourceRefs: 질문 자료가 있는데 막히는 지점이 비면 경고, 없으면 조용하다', () => {
  const { issues } = checkSourceRefs({ developerPainPoints: [] }, qCtx());
  assert.ok(issues.some((i) => i.severity === 'warning' && i.path === 'developerPainPoints'));
  const noQ = buildCsQualityContext([{ sourceId: 'P1', title: 'p', source: 'arXiv', publishedAt: '2026-11-01', type: 'paper' }]);
  assert.deepEqual(checkSourceRefs({ developerPainPoints: [] }, noQ).issues, []);
});

test('citations: 본문의 없는 Q ID는 출처 미확인으로 바꾼다', () => {
  const { analysis: out } = checkCitations({ summary: '막힘 [Q1] [Q7]' }, qCtx());
  assert.equal(out.summary.includes('[Q1]'), true);
  assert.equal(out.summary.includes('[Q7]'), false);
});

test('CS JSON 스키마에 developerPainPoints가 strict로 있고 mock 보고서는 빈 배열이다', () => {
  const p = CS_JSON_SCHEMA.schema.properties.developerPainPoints;
  assert.equal(p.type, 'array');
  assert.deepEqual(p.items.required, ['title', 'detail', 'sourceIds']);
  assert.equal(p.items.additionalProperties, false);
  assert.deepEqual(CS_MOCK_REPORT.developerPainPoints, []);
});

test('시스템 프롬프트: Q 접두사와 막히는 지점 규칙', () => {
  assert.ok(CS_SYSTEM_PROMPT.includes('Q 개발자 질문(Stack Overflow)'));
  assert.ok(CS_SYSTEM_PROMPT.includes('developerPainPoints는 개발자 질문(Q) 출처만'));
});
```

필요한 import(`checkCitations`, `CS_JSON_SCHEMA`, `CS_MOCK_REPORT`, `CS_SYSTEM_PROMPT`)가 없으면 각각 `../lib/quality/citations.js`, `../lib/modes/cs-schema.js`, `../lib/modes/cs-prompt.js`에서 더한다. 기존 `'CS 컨텍스트는 PHSBG 접두사를 쓰고…'` 테스트의 기대값을 `PHSBGQ`로 바꾼다.

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test tests/quality-cs.test.js`
Expected: FAIL

- [ ] **Step 3: 응답 스키마** — `lib/modes/cs-schema.js`의 `openSourceSignals` 다음에:

```js
    developerPainPoints: {
      type: 'array',
      items: strObj({ title: str(), detail: str(), sourceIds: strArray() }),
    },
```

`CS_MOCK_REPORT`의 `openSourceSignals: [],` 다음에 `developerPainPoints: [],`.

- [ ] **Step 4: 시스템 프롬프트** — `lib/modes/cs-prompt.js`

- 첫 문단의 자료 나열에 "Stack Overflow 질문"과 "Lobsters"를 넣는다: `…arXiv 논문 초록, Hacker News·Lobsters 게시글, Stack Overflow 질문, 뉴스, …`.
- 분석 원칙 4번을 바꾼다: `4. Hacker News·Lobsters 점수·댓글 수와 GitHub 스타 수는 화제성 지표일 뿐 정확성이나 품질의 근거가 아닙니다. Stack Overflow 점수·조회수·답 없는 질문은 "얼마나 많은 개발자가 막히는가"의 신호이지 기술이 옳다는 근거가 아닙니다.`
- 인용 규칙 예시를 `[P1], [H2], [Q1], [S3], [B1], [G1]`로, 접두사 줄을 `출처 ID 접두사: P 논문(arXiv), H 커뮤니티(Hacker News·Lobsters), Q 개발자 질문(Stack Overflow), S 뉴스, B 기술 블로그, G GitHub 저장소.`로 바꾼다.
- 작성 규칙에 두 줄을 추가한다:
  - `- developerPainPoints는 개발자 질문(Q) 출처만 근거로, 개발자들이 반복해서 막히는 지점을 최대 5개 정리하세요. 각 항목의 sourceIds에는 Q 출처 ID를 1개 이상 넣으세요. 질문 자료가 없으면 빈 배열로 두세요.`
  - `- communityPulse는 커뮤니티(H) 자료가 없으면 "자료 부족"이라고 적으세요.` (기존 "Hacker News 자료가 없으면" 줄을 이것으로 바꾼다)

- [ ] **Step 5: 품질 검사** — `lib/quality/cs.js`

```js
/** CS 출처 ID 접두사. eval 러너도 이 값을 쓴다. */
export const CS_ID_PREFIXES = 'PHSBGQ';
```

`buildCsQualityContext`의 `idPrefixes: 'PHSBG'`를 `idPrefixes: CS_ID_PREFIXES`로. `checkSourceRefs`의 `return { analysis: next, issues };` 바로 앞에 추가한다.

```js
  // 개발자 질문(Q)만 근거가 된다. 남는 근거가 없으면 항목째 뺀다.
  if (Array.isArray(analysis.developerPainPoints)) {
    const kept = [];
    analysis.developerPainPoints.forEach((pain, i) => {
      const ids = Array.isArray(pain?.sourceIds) ? pain.sourceIds : [];
      const valid = [...new Set(ids.filter((id) => sources.has(id) && id.startsWith('Q')))];
      const dropped = new Set(ids).size - valid.length;
      if (valid.length === 0) {
        issues.push(issue('sourceRefs', 'fixed',
          '개발자 질문 근거가 없는 막히는 지점 항목을 제거했습니다.', `developerPainPoints[${i}]`));
        return;
      }
      if (dropped > 0) {
        issues.push(issue('sourceRefs', 'fixed',
          `막히는 지점에서 개발자 질문이 아니거나 제공되지 않은 출처 ID ${dropped}개를 뺐습니다.`,
          `developerPainPoints[${i}].sourceIds`));
      }
      kept.push({ ...pain, sourceIds: valid });
    });
    next.developerPainPoints = kept;

    const hasQuestions = [...sources.values()].some((s) => s.type === 'question');
    if (hasQuestions && kept.length === 0) {
      issues.push(issue('sourceRefs', 'warning',
        '개발자 질문 자료가 있는데 막히는 지점을 정리하지 않았습니다.', 'developerPainPoints'));
    }
  }
```

- [ ] **Step 6: eval** — `eval/run.js` import에 `CS_ID_PREFIXES`를 더하고(`import { CS_CHECKS, CS_ID_PREFIXES } from '../lib/quality/cs.js';`), `idPrefixes: 'PHSBG'`를 `idPrefixes: CS_ID_PREFIXES`로.

`eval/contexts/cs-questions.json`: `eval/contexts/cs.json`을 복사하고 `sources`에 두 항목을 더하고 `total`을 8로.

```json
    "Q1": { "title": "RAG retriever returns irrelevant chunks", "source": "Stack Overflow · devops · CC BY-SA", "publishedAt": "2026-10-20T00:00:00.000Z", "type": "question" },
    "Q2": { "title": "pgvector index not used", "source": "Stack Overflow · 작성자 미상 · CC BY-SA", "publishedAt": "2026-10-18T00:00:00.000Z", "type": "question" }
```

`eval/cases/cs-10-painpoint-wrong-type.json`:

```json
{
  "name": "CS: 막히는 지점이 질문이 아닌 출처를 인용",
  "mode": "cs",
  "context": "cs-questions",
  "base": "cs",
  "override": {
    "developerPainPoints": [
      { "title": "검색 품질", "detail": "검색 결과가 질의와 맞지 않는다는 질문이 반복된다.", "sourceIds": ["Q1", "P1"] },
      { "title": "인덱스", "detail": "커뮤니티에서만 언급됐다.", "sourceIds": ["H1"] }
    ]
  },
  "expect": { "mustFix": ["sourceRefs"] }
}
```

`eval/cases/cs-11-painpoints-missing.json`:

```json
{
  "name": "CS: 질문 자료가 있는데 막히는 지점이 비었다",
  "mode": "cs",
  "context": "cs-questions",
  "base": "cs",
  "override": { "developerPainPoints": [] },
  "expect": { "mustWarn": ["sourceRefs"] }
}
```

`eval/run.js`가 `mustWarn`을 지원하는지 확인한다(`grep -n "mustWarn\|mustFix" eval/run.js`). 지원하지 않으면 기존 키 중 경고를 기대하는 키 이름을 쓴다. `eval/responses/cs.json`에 `developerPainPoints` 키가 없으면 `"developerPainPoints": []`를 더한다(cs-01 깨끗한 응답은 Q 출처가 없는 `cs` 컨텍스트라 경고가 나지 않는다).

- [ ] **Step 7: 통과 확인**

Run: `node --import tsx --test tests/quality-cs.test.js && npm run eval`
Expected: PASS, eval `케이스 27개 · 실패 0개`

- [ ] **Step 8: 전체 테스트**

Run: `npm test`
Expected: 0 fail. CS 분석 라우트 테스트가 mock 보고서의 키 목록을 기대하면 `developerPainPoints`를 더한다.

- [ ] **Step 9: 커밋**

```bash
git add lib/modes/cs-schema.js lib/modes/cs-prompt.js lib/quality/cs.js eval/run.js eval/contexts/cs-questions.json eval/cases/cs-10-painpoint-wrong-type.json eval/cases/cs-11-painpoints-missing.json eval/responses/cs.json tests/quality-cs.test.js
git commit -m "feat: add developer pain points section with Q-only citations"
```

---

### Task 5: 수집 라우트 연결

**Files:**
- Modify: `server.js:340-435` (provider 생성, `collectCs`)
- Test: `tests/cs-collect.test.js`

**Interfaces:**
- Consumes: `createStackOverflowProvider`(Task 1), `createLobstersProvider`·`mergeCommunity`(Task 2), `CS_SCOPES`·`CS_MAX.questions`(Task 1·3), `config.stackexchangeKey`
- Produces: 수집 응답에 `questions` 배열, `collected.counts.questions`, degraded `provider`는 `'community'`(HN·Lobsters 공통) / `'questions'`

- [ ] **Step 1: 테스트 라우트와 기대값 갱신** — `tests/cs-collect.test.js`

`ROUTES`에 추가한다(순서 주의: `lobste.rs` 패턴은 경로별로 나눈다).

```js
  'lobste.rs/tags.json': fixture('lobsters-tags.json'),
  'lobste.rs/t/ai.json': fixture('lobsters-ai.json'),
  'lobste.rs/newest.json': fixture('lobsters-newest.json'),
  'api.stackexchange.com': fixture('so-search.json'),
```

`csAnalysisBody`의 키 목록을 `['newsList', 'papers', 'community', 'questions', 'blogs', 'repos']`로.

Lobsters fixture 날짜는 2023년이라 이 파일의 `NOW`(2026-11-09) 기준 30일 밖이다. 이 파일에서는 Lobsters 결과가 0건이 된다 — 아래 새 테스트는 Lobsters용 라우트를 날짜를 바꾼 문자열로 덮어쓴다.

`'CS 수집: 다섯 출처를 모으고…'` 테스트를 고친다: 제목을 `'CS 수집: 여섯 범위를 모으고 견적·확인 토큰을 준다'`로, `included` 기대를 `['papers', 'community', 'questions', 'news', 'blogs', 'repos']`로, `assert.equal(res.body.questions.length, 2);`와 `assert.equal(res.body.collected.counts.questions, 2);`를 더하고, 합계 식에 `+ 2`(질문)를 더한다. `res.body.community.length`는 HN 2건 그대로다(질의 'rag'는 Lobsters 태그 `ai`로 바뀌지만 fixture 날짜가 30일 밖).

새 테스트를 추가한다.

```js
const recent = (json) => JSON.stringify(JSON.parse(json).map((s) => ({ ...s, created_at: '2026-11-05T00:00:00.000Z' })));

test('CS 수집: Lobsters를 HN과 합쳐 커뮤니티에 싣고 사이트를 표시한다', async () => {
  const { app } = boot(makeHttp({ ...ROUTES, 'lobste.rs/t/ai.json': recent(fixture('lobsters-ai.json')) }));
  const token = await login(app);
  const res = await collect(app, token, { mode: 'cs', query: 'rag', include: ['community'] });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.community.map((c) => c.site), ['hackernews', 'hackernews', 'lobsters', 'lobsters', 'lobsters']);
});

test('CS 수집: 질문만 골라도 SO만 부른다', async () => {
  const http = makeHttp();
  const { app } = boot(http);
  const token = await login(app);
  const res = await collect(app, token, { mode: 'cs', query: 'rag', include: ['questions', 'repos'] });

  assert.equal(res.status, 200);
  assert.equal(res.body.questions.length, 2);
  assert.ok(http.calls.every((u) => u.includes('api.stackexchange.com') || u.includes('api.github.com')));
});

test('SO 한도 초과는 사유와 함께 questions degraded로 남는다', async () => {
  const limited = Object.assign(new Error('limit'), { upstreamStatus: 400 });
  const { app } = boot(makeHttp({ ...ROUTES, 'api.stackexchange.com': limited }));
  const token = await login(app);
  const res = await collect(app, token, { mode: 'cs', query: 'rag' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.collected.degraded.filter((d) => d.provider === 'questions'), [{
    provider: 'questions', source: 'Stack Overflow',
    reason: 'Stack Overflow 호출 한도를 초과했습니다. 잠시 뒤 다시 시도해 주세요.',
  }]);
});
```

`'CS 수집 토큰으로 그대로 분석할 수 있다(cacheKey 일치)'` 테스트는 `csAnalysisBody`가 `questions`를 싣게 됐으므로 그대로 통과해야 한다.

`'include로 고른 출처만 부른다'` 테스트가 호출 호스트 목록을 기대하면 Lobsters 호출이 커뮤니티에 더해진 것을 반영한다.

- [ ] **Step 2: 실패 확인**

Run: `node --import tsx --test tests/cs-collect.test.js`
Expected: FAIL — `questions`가 응답에 없음 등.

- [ ] **Step 3: `server.js` 연결**

import에 추가:

```js
import { createLobstersProvider } from './lib/providers/lobsters.js';
import { createStackOverflowProvider } from './lib/providers/stackoverflow.js';
import { mergeCommunity } from './lib/providers/community.js';
```

provider 생성부(`const hnProvider = …` 아래):

```js
  const lobstersProvider = createLobstersProvider(csDeps());
  const soProvider = createStackOverflowProvider({ ...csDeps(), key: config.stackexchangeKey });
```

`collectCs`의 병렬 호출을 바꾼다.

```js
    const [papers, hn, lobsters, questions, news, blogs, repos] = await Promise.all([
      wanted('papers') ? arxivCsProvider.search({ query, limit: CS_MAX.papers }) : null,
      wanted('community') ? hnProvider.search({ query, limit: CS_MAX.community }) : null,
      wanted('community') ? lobstersProvider.search({ query, limit: CS_MAX.community }) : null,
      wanted('questions') ? soProvider.search({ query, limit: CS_MAX.questions }) : null,
      wanted('news') ? newsProvider.search({ query, lang, limit: CS_MAX.news }) : null,
      wanted('blogs') ? blogProvider.search({ query, limit: CS_MAX.blogs }) : null,
      wanted('repos') ? githubProvider.search({ query, limit: CS_MAX.repos }) : null,
    ]);

    const degraded = [
      ['papers', papers], ['community', hn], ['community', lobsters], ['questions', questions],
      ['news', news], ['blogs', blogs], ['repos', repos],
    ].flatMap(([provider, result]) => (result?.degraded ?? []).map((d) => ({ provider, ...d })));
```

`lists`:

```js
    const lists = {
      papers: papers?.items ?? [],
      community: wanted('community') ? mergeCommunity(hn?.items, lobsters?.items, CS_MAX.community) : [],
      questions: questions?.items ?? [],
      newsList: …(그대로),
      blogs: blogs?.items ?? [],
      repos: repos?.items ?? [],
    };
```

- [ ] **Step 4: 통과 확인**

Run: `node --import tsx --test tests/cs-collect.test.js`
Expected: PASS

- [ ] **Step 5: 전체 테스트**

Run: `npm test`
Expected: 0 fail

- [ ] **Step 6: 커밋**

```bash
git add server.js tests/cs-collect.test.js
git commit -m "feat: collect Stack Overflow and Lobsters in the CS route"
```

---

### Task 6: 화면

**Files:**
- Modify: `client/src/components/ScopePicker.jsx` (`CS_SCOPES`)
- Modify: `client/src/pages/CsReviewPage.jsx` (질문 그룹, 커뮤니티 사이트 배지, 요약 줄, 승인 본문)
- Modify: `client/src/pages/CsReportPage.jsx` (막히는 지점 섹션)
- Modify: `client/src/api/client.js:12` (`CS_ANALYSIS_KEYS`)
- Modify: `tests/client/cs-fixtures.js` (질문 자료, `included`)
- Test: `tests/client/cs-search-review.test.jsx`, `tests/client/cs-report.test.jsx`, `tests/client/api-client.test.js`, `tests/client/scope.test.jsx`

**Interfaces:**
- Consumes: 수집 응답 `questions`, 커뮤니티 `site`, 분석 `developerPainPoints`, 출처 `source` 문자열(Task 3·4·5)
- Produces: 화면 문구 '개발자 질문', '개발자들이 막히는 지점'

- [ ] **Step 1: 테스트 자료** — `tests/client/cs-fixtures.js`의 `CS_COLLECT`에 `questions`를 넣고(`community` 다음), `collected.included`를 `['papers', 'community', 'questions', 'news', 'blogs', 'repos']`로.

```js
  questions: [{
    title: 'RAG retriever returns irrelevant chunks',
    url: 'https://stackoverflow.com/questions/79923286/rag-retriever',
    author: 'devops', tags: ['python', 'rag'], score: 7, answerCount: 0,
    isAnswered: false, hasAcceptedAnswer: false, viewCount: 605,
    publishedAt: '2026-10-20T00:00:00.000Z', text: 'My retriever returns unrelated chunks.',
  }],
```

`CS_COLLECT.community`에 Lobsters 항목 하나를 더한다.

```js
  {
    site: 'lobsters', title: 'Retrieval for code search', url: 'https://example.com/code-search',
    discussionUrl: 'https://lobste.rs/s/def456/retrieval', points: 40, numComments: 12,
    publishedAt: '2026-11-01T14:00:00.000Z', text: '',
  },
```

같은 파일에 CS 보고서 자료(`CS_REPORT` 등)가 있으면 `analysis.developerPainPoints`에 `[{ title: '검색 품질', detail: '질의와 맞지 않는 결과', sourceIds: ['Q1'] }]`, `sources`에 `{ sourceId: 'Q1', title: 'RAG retriever returns irrelevant chunks', source: 'Stack Overflow · devops · CC BY-SA', url: 'https://stackoverflow.com/questions/79923286/rag-retriever', publishedAt: '2026-10-20T00:00:00.000Z', type: 'question', collectedAt: '2026-11-09T00:00:00.000Z', relevance: 0 }`을 더한다.

- [ ] **Step 2: 실패하는 테스트** — 각 파일의 기존 렌더 헬퍼를 그대로 쓴다.

`tests/client/cs-search-review.test.jsx`에:

```js
test('CS 검토: 개발자 질문과 커뮤니티 사이트 배지를 보인다', () => {
  render(<CsReviewPage collected={CS_COLLECT} onApprove={() => {}} onBack={() => {}} busy={false} />);
  assert.ok(screen.getByRole('heading', { name: /개발자 질문 \(Stack Overflow\) \(1건\)/ }));
  assert.ok(screen.getByText('RAG retriever returns irrelevant chunks'));
  assert.ok(screen.getByText(/점수 7 · 답변 0 · 답 없음 · 조회 605/));
  assert.ok(screen.getByText('python · rag'));
  assert.ok(screen.getByText('Lobsters'));
  assert.ok(screen.getByText('HN'));
});

test('CS 검토: 승인 본문에 질문을 싣는다', () => {
  let payload;
  render(<CsReviewPage collected={CS_COLLECT} onApprove={(p) => { payload = p; }} onBack={() => {}} busy={false} />);
  fireEvent.click(screen.getByRole('button', { name: '분석 시작' }));
  assert.equal(payload.questions.length, 1);
});
```

`tests/client/cs-report.test.jsx`에:

```js
test('CS 보고서: 개발자들이 막히는 지점과 SO 출처 표기', () => {
  render(<CsReportPage report={CS_REPORT} onNewSearch={() => {}} />);
  assert.ok(screen.getByRole('heading', { name: '개발자들이 막히는 지점' }));
  assert.ok(screen.getByText('검색 품질'));
  assert.ok(screen.getAllByText(/Stack Overflow · devops · CC BY-SA/).length > 0);
});
```

(`CS_REPORT`는 실제 fixture 이름을 쓴다. 빈 자료 테스트(`'CS 보고서: 빈 자료는 자료 없음으로 표시한다'`)의 '자료 없음' 개수 기대가 있으면 섹션이 하나 늘어난 것을 반영한다.)

`tests/client/api-client.test.js`에 CS 분석 본문이 비어 있지 않은 `questions`를 싣는지 보는 기대를 추가한다(기존 CS 분석 테스트의 본문 비교에 `questions`를 넣는다).

`tests/client/scope.test.jsx`에 CS 범위 값 순서가 `['papers', 'community', 'questions', 'news', 'blogs', 'repos']`인지 보는 기대를 추가한다.

- [ ] **Step 3: 실패 확인**

Run: `node --import tsx --test tests/client/*.test.*`
Expected: FAIL

- [ ] **Step 4: 구현**

`ScopePicker.jsx`의 `CS_SCOPES`:

```js
  { value: 'community', label: '커뮤니티', hint: 'Hacker News·Lobsters 최근 30일 · 영문 질의 권장' },
  { value: 'questions', label: '개발자 질문', hint: 'Stack Overflow 최근 90일 · 투표순 · 영문 질의 권장' },
```

`client.js`: `const CS_ANALYSIS_KEYS = ['newsList', 'papers', 'community', 'questions', 'blogs', 'repos'];`

`CsReviewPage.jsx`:
- `PROVIDER_LABEL`에 `questions: '개발자 질문'`.
- 구조 분해에 `questions = []`, 요약 줄에 `· 질문 {questions.length}`(커뮤니티 다음).
- 커뮤니티 그룹 제목을 `"커뮤니티 (Hacker News·Lobsters)"`로, 각 항목 `news-head`에 `<span className="kind">{h.site === 'lobsters' ? 'Lobsters' : 'HN'}</span>`를 더한다.
- 커뮤니티 그룹 아래에:

```jsx
      {shown('questions') && (
        <Group title="개발자 질문 (Stack Overflow)" items={questions}>
          {questions.map((q) => (
            <li key={q.url} className="news-item">
              <div className="news-head"><span className="news-title">{q.title}</span></div>
              <div className="news-meta">
                점수 {q.score} · 답변 {q.answerCount} · {q.hasAcceptedAnswer ? '채택 답변 있음' : (q.isAnswered ? '답변 있음' : '답 없음')} · 조회 {q.viewCount} ·
                {' '}{formatDateTime(q.publishedAt)} · <ExternalLink href={q.url}>질문</ExternalLink>
              </div>
              {q.tags.length > 0 && <div className="muted small">{q.tags.join(' · ')}</div>}
              <div className="muted small">작성자 {q.author || '미상'} · CC BY-SA</div>
              {q.text && <p className="news-body">{q.text}</p>}
            </li>
          ))}
        </Group>
      )}
```

- 승인 본문에 `questions`를 더한다: `mode: 'cs', newsList, papers, community, questions, blogs, repos, confirmToken`.

`CsReportPage.jsx`: `const pains = analysis.developerPainPoints ?? [];`, '커뮤니티 반응' 섹션 다음에:

```jsx
      <Section title="개발자들이 막히는 지점">
        {pains.length === 0 ? <Empty /> : pains.map((p, i) => (
          <article key={i} className="dev-card">
            <div className="dev-head"><strong>{p.title}</strong></div>
            <p>{p.detail}</p>
            <Cites ids={p.sourceIds} />
          </article>
        ))}
      </Section>
```

- [ ] **Step 5: 통과 확인**

Run: `node --import tsx --test tests/client/*.test.*`
Expected: PASS

- [ ] **Step 6: 전체 테스트와 빌드**

Run: `npm test && npm run build:client`
Expected: 0 fail, 빌드 성공

- [ ] **Step 7: 커밋**

```bash
git add client/src tests/client
git commit -m "feat: show developer questions and pain points in the CS screens"
```

---

### Task 7: 문서와 핸드오프

**Files:**
- Modify: `README.md` (CS 출처 목록·환경변수 설명이 있는 곳)
- Modify: `docs/SESSION-HANDOFF.md`

- [ ] **Step 1: README** — `grep -n "Hacker News\|GITHUB_TOKEN\|CS 기술 동향" README.md`로 CS 설명 위치를 찾는다. 출처 목록에 'Lobsters(커뮤니티, 태그 피드)'와 'Stack Overflow(개발자 질문, 최근 90일)'를, 환경변수 표(또는 목록)에 `STACKEXCHANGE_KEY`(선택, 없으면 IP당 하루 300회)를, 보고서 섹션 설명에 '개발자들이 막히는 지점'을 더한다. README에 해당 구획이 없으면 손대지 않는다.

- [ ] **Step 2: 핸드오프** — `docs/SESSION-HANDOFF.md` 맨 위 섹션(`---` 다음)에 새 섹션을 넣는다.

```markdown
## 2026-11-09 CS 출처 추가: Stack Overflow·Lobsters (구현 완료, 실호출 전)

- 브랜치 `feature/cs-qa-sources` — main(6e3cd04)에서 땄다. 설계 `docs/superpowers/specs/2026-11-09-cs-qa-sources-design.md`, 계획 `docs/superpowers/plans/2026-11-09-cs-qa-sources.md`.
- Lobsters는 커뮤니티(H)에 HN과 6:4로 합친다(검색 API가 없어 태그 피드·최신 글을 거른다). Stack Overflow는 새 범위 `questions`(Q), 보고서 섹션 `developerPainPoints`. 인용 접두사 `PHSBGQ`.
- 새 환경변수 `STACKEXCHANGE_KEY`(선택). 새 허용 호스트 `api.stackexchange.com`, `lobste.rs` — 로컬 `.env`의 `EXTERNAL_ALLOWLIST`에도 더해야 한다.
- 검증: `npm test` <결과>, `npm run eval` <결과>, 빌드 <결과>.
- C1 운영 확인(2026-11-09, PR #14 병합 6e3cd04 후): 'retrieval augmented generation' 논문 8·커뮤니티 1·뉴스 8·블로그 8·저장소 8, 품질 100점, 실제 $0.020. 운영에서는 arXiv가 정상(로컬 IP만 429).
```

`<결과>` 자리에는 실제로 실행한 명령의 결과 숫자를 적는다(예: `880 / 879 pass / 0 fail / 1 skip`).

- [ ] **Step 3: 최종 확인**

Run: `npm test && npm run eval && npm run build:client`
Expected: 0 fail, eval 실패 0, 빌드 성공

- [ ] **Step 4: 커밋**

```bash
git add README.md docs/SESSION-HANDOFF.md
git commit -m "docs: record Stack Overflow and Lobsters CS sources"
```
