# 분석 품질 게이트 설계

작성일: 2026-11-09
브랜치: `feature/analysis-quality-gate`. `feature/sector-baskets-opendart`(PR #12)에서 땄다. PR #12가 병합되면 기준을 main으로 바꾼다.

## 배경

LLM 분석 결과에 결정적으로 강제되는 장치는 `stripFabricatedUrls`(입력에 없던 URL 제거) 하나뿐이다. 그래서 다음 결함이 그대로 사용자에게 간다.

- `newsBriefing`의 `sourceId`가 실제로 없는 출처일 수 있다. 같은 항목의 title·source·publishedAt은 모델이 다시 받아 적은 값이라 원본과 다를 수 있다.
- 본문에 인용된 `[S7]`처럼 존재하지 않는 출처 ID가 남는다.
- 재무·논문·실험 자료를 주지 않았는데 `available: '자료 있음'`이 나와도 통과한다.
- 면책 문구가 모델이 쓴 문장 그대로 나간다.
- 분야 묶음의 종목 간 비교가 프롬프트 지시 한 줄뿐이다. 응답 스키마에 비교 칸이 없다.
- 품질을 잴 평가 세트가 없다. 프롬프트를 고쳐도 좋아졌는지 알 수 없다.

## 목표

1. LLM 응답 뒤에 결정적 검사기를 두어 교정할 수 있는 것은 교정하고, 교정할 수 없는 것은 경고한다.
2. 검증 결과를 `meta.quality`로 응답하고 화면에 보여 준다.
3. 분야 비교를 응답 스키마로 강제한다(`instrumentComparison`).
4. LLM을 부르지 않는 오프라인 평가 세트(`npm run eval`)로 검사기의 회귀를 막는다.

LLM 추가 호출은 없다. 비용은 기존과 같다.

## 범위 밖

- 수치 대조. 보고서 숫자가 입력 수치와 맞는지 보는 일이다. 단위와 표현이 다양해서 오탐이 많다.
- LLM-as-judge로 분석 깊이를 채점하는 일. 비용이 든다.
- 검증에 실패했을 때 LLM에 재요청하는 일. 비용이 최대 두 배가 되고 견적과 어긋난다.
- 시장 데이터 출처 ID(`M1…`). 이전 작업에서 범위 밖으로 둔 항목이다.

## 구조

### 흐름 (`server.js` 분석 경로)

```
parseAnalysis
  → assessQuality(analysis, context, { degraded })   ← 신규
  → stripFabricatedUrls                              (기존)
  → 캐시 저장(교정된 analysis + quality)
  → 응답 meta.quality
```

캐시 히트는 저장된 quality를 그대로 돌려준다. 캐시는 메모리에만 있으므로 배포하면 비워진다. 옛 형태의 캐시 항목을 처리하는 코드는 두지 않는다.

### 검사 컨텍스트

`buildQualityContext({ sources, instruments, sector })`가 만든다. `sources`는 서버가 응답용으로 이미 만든 출처 배열(`buildSources` + `buildExtraSources`)이다. `has`는 type이 `financial`·`research`·`experiment`인 출처가 있는지로 정한다.

```
{
  sources: Map<sourceId, { title, source, publishedAt }>,   // S·P·T·F 전부
  instruments: [{ symbol, name }],
  sector: string | undefined,
  has: { financial: bool, research: bool, experiments: bool },
}
```

`sources`의 F 항목은 `buildExtraSources`가 만드는 title·source·publishedAt과 같은 값을 쓴다.

### 검사기 (`lib/quality/`)

파일마다 검사기 하나를 둔다. 검사기는 순수 함수 `(analysis, context) → { analysis, issues }`이며 입력 객체를 변경하지 않는다.

issue 형태:

```
{ check: string, severity: 'fixed' | 'warning', message: string, path: string }
```

`message`는 사용자에게 보여 줄 수 있는 한국어 문장이다. 모델 출력 원문을 담지 않는다. `path`는 `newsBriefing[2].sourceId` 같은 위치 표기다.

| 파일 | check | 동작 |
|---|---|---|
| `citations.js` | `citations` | ① `newsBriefing`에서 `sourceId`가 `sources`에 없는 항목을 제거한다(fixed). ② 같은 `sourceId`가 다시 나오면 첫 항목만 남긴다(fixed). ③ 남은 항목의 title·source·publishedAt이 원본과 다르면 원본으로 덮어쓴다(항목당 fixed 1건). ④ 모든 문자열 값에서 `[...]` 안의 ID 토큰(`/\b[SPTFM]\d+\b/`)을 각각 판정해 없는 ID를 `출처 미확인`으로 바꾼다. `[S1, S9]`는 `[S1, 출처 미확인]`이 된다(바뀐 토큰마다 fixed 1건이 아니라 경로당 fixed 1건). ⑤ 검증 뒤 `newsBriefing`이 0건이 됐고 원래 1건 이상이었다면 warning 1건을 더한다. |
| `availability.js` | `availability` | `financialSummary`·`researchSummary`·`experimentSummary` 각각에 대해, 자료가 없는데 `'자료 있음'`이면 `available`·`periodBasis`/`maturity`/`evidenceLevel`을 `'자료 부족'`으로, `notes`를 `'제공된 자료가 없습니다.'`로 바꾼다(fixed). 자료가 있는데 `'자료 부족'`이면 warning만 남긴다. |
| `disclaimer.js` | `disclaimer` | `disclaimer`를 `DISCLAIMER`(SYSTEM_PROMPT의 고정 문구와 같은 상수)로 덮어쓴다. 원문과 다를 때만 fixed 1건. |
| `scenarios.js` | `scenarios` | 시나리오마다 `invalidationCondition`이 비었거나 공백·`'자료 부족'`뿐이면 warning. 모든 문자열 값에서 단정 표현 정규식이 맞으면 경로당 warning 1건. 고치지 않는다. |
| `comparison.js` | `comparison` | 종목이 2개 이상이면, `instrumentComparison` 중 symbol이 입력에 없는 항목을 제거하고(fixed), 같은 symbol의 중복은 첫 항목만 남기고(fixed), 남은 항목의 name을 입력 name으로 맞춘다(fixed 없이 조용히). 입력 종목 중 빠진 것이 있으면 warning 1건(빠진 symbol 나열). 종목이 1개 이하인데 비어 있지 않으면 빈 배열로 바꾼다(fixed). |
| `index.js` | — | `assessQuality`. 검사기를 citations → availability → disclaimer → scenarios → comparison 순서로 실행한다. 검사기가 예외를 던지면 그 검사기만 건너뛰고 원본 값을 유지한 채 `{ check, severity: 'warning', message: '자동 검사 중 오류가 나서 이 항목은 검증하지 못했습니다.' }`를 남긴다. |

단정 표현 정규식 목록(`scenarios.js`의 `ASSERTIVE_PATTERNS`):

- `반드시\s*(상승|하락|오른|내린|오를|내릴)`
- `확실히\s*(상승|하락|오른|내린|오를|내릴)`
- `(상승|하락)할\s*것이\s*(확실|분명)`
- `목표\s*(주가|가격|가)\s*[:은는]?\s*[\d,]+`
- `(매수|매도)\s*(을|를)?\s*(추천|권유|권고)(합니다|드립니다|해요)`
- `(매수|매도)\s*하(세요|십시오)`
- `100\s*%\s*(상승|하락|수익)`

"반드시 확인해야 할 지표"처럼 방향어가 붙지 않은 "반드시"와 "매수를 추천하지 않습니다" 같은 부정은 잡지 않는다.

### 품질 보고서

```
meta.quality = { score, fixed, warnings, issues, limited }
```

- `score = max(0, 100 - 10·fixed - 5·warnings)`
- `limited`: Markdown 폴백(`degraded`)이면 true.
- degraded일 때는 `analysis.report` 문자열에 citations ④만 적용한다. 그리고 warning `{ check: 'structure', message: '구조화 응답이 아니어서 검증이 제한되었습니다.' }`를 남긴다.

로그에는 `{ qualityScore, fixed, warnings, checks: [이름…] }`만 남긴다. 모델 출력 본문은 남기지 않는다.

### 응답 스키마 변경 (`lib/llm.js`)

`ANALYSIS_JSON_SCHEMA`에 다음을 추가한다. strict 모드이므로 required에 들어간다.

```
instrumentComparison: array of { symbol, name, positioning, keyDifference }  (모두 string)
```

mock 응답에는 `instrumentComparison: []`를 넣는다. mock의 disclaimer는 `DISCLAIMER` 상수를 쓴다.

### 프롬프트 변경 (`lib/prompt.js`)

- 면책 문구를 `DISCLAIMER` 상수로 빼서 SYSTEM_PROMPT와 검사기가 같은 값을 쓴다.
- 출처 인용 규칙에 "시장 데이터에는 출처 ID가 없다. 시장 수치는 ID 없이 서술하라"를 추가한다.
- 종목 비교 규칙: "`instrumentComparison`에는 제공된 종목만, 종목당 한 항목을 쓴다. 종목이 하나 이하면 빈 배열로 둔다."
- 분야 묶음 지시 줄(DATA_END 뒤)은 "종목 간 비교를 instrumentComparison에 작성하세요"로 바꾼다.

## 화면 (client)

- `QualityBadge.jsx`: 리포트 분석 영역 맨 위(`InsightReport` 바로 앞). 한 줄 "검증 92점 · 교정 1건 · 경고 1건". `<details>`로 펼치면 issue 목록이 나오고, 각 항목에 "교정됨" 또는 "확인 필요" 표시와 message가 붙는다. issue가 0건이면 "자동 검증 통과". `limited`면 "검증 제한" 문구를 덧붙인다. `meta.quality`가 없으면(옛 응답) 아무것도 그리지 않는다.
- `InstrumentInsight.jsx`: `analysis.instrumentComparison`이 1건 이상일 때만, 기존 `InstrumentComparison`(수치 비교표) 아래에 종목별 positioning·keyDifference를 보여 준다.

## 평가 세트

- `eval/cases/*.json`: `{ name, context, contextOverride?, base?, override?, response?, degraded?, expect }`. `context`가 문자열이면 `eval/contexts/<이름>.json`, `base`가 있으면 `eval/responses/<이름>.json`에 `override`를 최상위 키 단위로 덮어쓴다.
  - `context`는 직렬화 가능한 형태다(`sources`는 객체, `instruments`·`sector`·`has` 그대로). 러너가 Map으로 바꾼다.
  - `expect`: `{ minScore?, maxScore?, mustFix?: [check], mustWarn?: [check], mustNotFlag?: [check] }`
- `eval/run.js`(`lib/quality`만 쓴다): 모든 케이스를 실행해 케이스별 통과 여부, 검사기별 적중 수, 평균 점수를 출력한다. 실패가 하나라도 있으면 종료 코드 1.
- `package.json`: `"eval": "node eval/run.js"`.
- `tests/eval.test.js`: 같은 케이스를 node:test로 돌려 `npm test`에도 포함한다.
- 초기 케이스(13개):
  1. clean-single: 깨끗한 단일 종목 응답 → 점수 100, 아무 검사도 걸리지 않음
  2. clean-sector: 깨끗한 분야 묶음 응답(4종목 비교) → 점수 100
  3. unknown-briefing-source: 없는 `S9` 브리핑 항목 → citations fixed
  4. briefing-metadata-drift: 날짜·제목이 원본과 다름 → citations fixed
  5. unknown-inline-citation: 본문 `[S1, S9]`, `[M1]` → citations fixed
  6. availability-fabricated: 재무 자료 없음 + `'자료 있음'` → availability fixed
  7. availability-missed: 논문 자료 있음 + `'자료 부족'` → availability warning
  8. disclaimer-altered → disclaimer fixed
  9. scenario-no-invalidation → scenarios warning
  10. scenario-assertive: "반드시 상승할 것" → scenarios warning
  11. scenario-not-assertive: "반드시 확인해야 할 지표", "매수를 추천하지 않습니다" → scenarios는 걸리지 않음
  12. comparison-mismatch: 입력에 없는 종목 1개 + 누락 1개 → comparison fixed와 warning
  13. degraded-report: Markdown 폴백의 없는 출처 ID → citations fixed, structure warning
- README에 실제 응답을 케이스로 추가하는 절차를 적는다. 응답에서 개인 정보·키를 확인하고 지운 뒤 넣는다.

## 테스트

- 검사기별 단위 테스트: `tests/quality-citations.test.js`, `quality-availability`, `quality-disclaimer`, `quality-scenarios`, `quality-comparison`, `quality-index`(순서, 예외 격리, 점수).
- `tests/analyze.test.js` 통합 테스트: 결함 있는 응답을 돌려주는 가짜 LLM 클라이언트를 주입해, 교정된 analysis와 `meta.quality`가 응답에 실리는지, 캐시 히트에도 같은 quality가 붙는지, degraded 응답에서 `limited: true`가 나오는지 확인한다.
- client: `QualityBadge` 0건·여러 건·limited·quality 없음, `InstrumentInsight` 빈 배열이면 렌더링하지 않음.
- 기존 테스트 중 analysis 응답 형태를 고정한 것은 `instrumentComparison`과 `meta.quality`를 반영해 갱신한다.

## 문서

- `docs/api.md`: `meta.quality`, `analysis.instrumentComparison`.
- `README.md`: `npm run eval`, 케이스 추가 방법.
- `docs/SESSION-HANDOFF.md`: 태스크마다 갱신.
