# C2 논문 한 편 전문 분석 (`mode: 'paper'`) 설계

작성일: 2026-11-09
브랜치: `feature/cs-paper-analysis` — main(58e976c, PR #15 병합 후)에서 땄다.
선행: `docs/superpowers/specs/2026-11-09-cs-briefing-design.md`(C1). C1의 모드 프로필 구조(`lib/modes/*`, `lib/analysis-runner.js`)에 세 번째 프로필을 얹는다.

## 배경과 목표

C1 브리핑은 논문을 초록까지만 읽는다. 사용자는 "좀 더 딥하게 세부 분석"을 원했고 "논문 한 편 전문 분석"을 골랐다.

목표:

1. arXiv 논문 한 편의 본문(HTML 판)을 가져와 **비판적 읽기** 보고서를 만든다.
2. 보고서의 모든 주장은 본문 장(章)을 인용하고, 결과 수치는 **인용한 장 본문과 기계적으로 대조**한다.
3. 진입점은 둘이다. 검색 화면의 arXiv ID·링크 입력, 그리고 CS 보고서 논문 카드의 '전문 분석' 버튼.

사용자 결정(2026-11-09):

- 입력: arXiv ID·링크 + 브리핑에서 바로 진입. PDF 업로드는 하지 않는다.
- 초점: 비판적 읽기(문제·방법·실험 설정·핵심 결과·한계·리뷰어 시각의 약점·재현성).
- 길이: 한 번 호출. 참고문헌·부록을 빼고 본문 약 25,000토큰까지, 넘으면 뒤쪽 장부터 자르고 표시한다.

## 범위 밖

- PDF 업로드, arXiv 밖의 논문.
- HTML 판이 없을 때 초록만으로 분석하는 대체 경로(그건 C1이 한다).
- 장별 요약 후 종합(여러 번 호출).
- 그림 이미지 분석, 인용 논문 추적.
- 투자·CS 모드 동작 변경. 두 모드의 출력은 바뀌지 않는다(CS 보고서 화면에 버튼만 더한다).

## 실측으로 확인한 arXiv HTML (2026-11-09)

- `GET https://arxiv.org/html/<id>` — 2401.04088(Mixtral), 1706.03762(Transformer) 모두 200. LaTeXML 산출물이다.
- 없는 ID(2401.99999)는 404.
- 구조:
  - 제목 `<h1 class="ltx_title ltx_title_document">`, 저자 `<div class="ltx_authors">`(이름은 `ltx_personname`).
  - 초록 `<div id="abstract1" class="ltx_abstract">`.
  - 장 `<section id="S1" class="ltx_section">`, 번호 없는 장 `id="Sx1"`(감사의 글 등), 소절 `<section id="S2.SS1" class="ltx_subsection">`(장 안에 중첩).
  - 참고문헌 `<section id="bib" class="ltx_bibliography">`, 부록 `class="ltx_appendix"`.
  - 수식 `<math alttext="…TeX…">`, 표 `ltx_tabular`/`ltx_tr`/`ltx_td`, 그림 `ltx_figure` + `ltx_caption`.
- 오래된 논문 일부는 200이지만 LaTeXML 본문이 없다(변환 실패 안내 페이지). 제목이나 장이 없으면 "HTML 판 없음"으로 본다.
- Mixtral HTML은 약 190KB. 큰 논문은 수 MB가 될 수 있다.

## 구조

### 제공자 — `lib/providers/arxiv-html.js`

- `parseArxivId(input)` → 정규화된 ID 또는 `null`.
  - 받는 형태: `2401.04088`, `2401.04088v2`, `https://arxiv.org/abs/2401.04088`, `/pdf/2401.04088v2(.pdf)`, `/html/2401.04088v1`, 옛 형식 `hep-th/9901001`.
  - 버전이 있으면 유지한다(`v2`). 없으면 최신이다.
  - 그 밖(다른 호스트, 빈 문자열, 경로 조작 문자)은 `null` → 라우트가 400 `INVALID_REQUEST`.
- `parseArxivHtml(html, { id })` → `{ id, title, authors[], url, sections: [{ id, anchor, heading, text }] }`. `anchor`는 원래 HTML id(`S2`, `Sx1`, 초록은 `abstract1`)다.
  - HTML 파서는 새 의존성 **`node-html-parser`**를 쓴다. 정규식으로 중첩 `section`을 가르면 깨지기 쉽다. jsdom은 devDependency라 운영에 없다.
  - `S0`은 초록(`heading: 'Abstract'`).
  - 최상위 `ltx_section`을 문서 순서대로 `S1`, `S2`, …로 다시 번호 매긴다(원래 `Sx1` 같은 번호 없는 장 포함). 소절은 장 본문 안에 `## 소제목` 줄로 남긴다.
  - 텍스트 변환: 수식은 `alttext`를 `$…$`로, 표는 행마다 셀을 탭으로 이어 줄로, 그림은 캡션만(`[Figure n] …`), 각주 표시·참조 앵커 장식은 버린다. 공백은 접는다.
  - 참고문헌과 부록은 뺀다.
  - 제목이 없거나 `S1` 이상의 장이 0개이거나 본문 합계가 2,000자 미만이면 `MalformedUpstream`을 던진다.
- `createArxivHtmlProvider({ http, cache, makeBreaker })` → `fetchPaper(id)`.
  - URL `https://arxiv.org/html/${id}`. 허용목록에 `arxiv.org`를 더한다(코드 기본값과 `.env.example`). 로컬 `.env`는 사용자가 고친다.
  - 404와 `MalformedUpstream`은 `FULLTEXT_UNAVAILABLE`(422, "이 논문은 arXiv HTML 판이 없어 전문 분석을 할 수 없습니다.")로 바꾼다. 그 밖의 실패는 502 `COLLECTION_FAILED`.
  - 응답 바이트 상한은 이 호출만 8MB로 올린다. `http.get`이 호출별 상한을 받지 못하면 그 옵션을 더한다(헤더 옵션을 더했던 C1과 같은 방식).
  - 성공한 파싱 결과만 캐시한다(키 `arxiv-html:${id}`). 실패·잘못된 응답은 캐시하지 않는다(C1 규칙).

### 본문 예산 — `lib/modes/paper-budget.js`

- `fitSections(sections, { maxTokens = 25_000, estimate })` → `{ sections, truncated: [{ id, heading, partial }] }`.
- 앞에서부터 담는다. `S0`(초록)은 항상 담는다.
- 다음 장이 예산을 넘으면: 남은 예산이 2,000토큰 이상이면 그 장의 앞부분만 담고 `partial: true`로 기록한다. 아니면 그 장과 이후 장을 모두 빼고 `partial: false`로 기록한다.
- 토큰 추정은 분석 실행부가 쓰는 기존 추정 함수를 그대로 쓴다.
- 수집 단계에서 자르고, 분석 요청 본문에는 잘린 결과만 실린다. 빠진 장의 ID는 프롬프트에 없으므로 그 ID를 인용하면 품질 검사가 '모르는 ID'로 지운다.

### 수집 라우트 — `server.js`의 `collectPaper`

- `POST /api/research/collect` `{ mode: 'paper', arxiv: string }`. 다른 키는 400(strictObject).
- 응답: `{ mode: 'paper', paper: { id, title, authors, url, sections, truncated }, collected: { collectedAt, sectionCount, truncatedCount }, estimate, confirmToken }`.
  - `sections`에는 장별 `tokens`(추정)를 같이 싣는다. 화면 표시용이며 분석 본문에서는 뺀다.
- 견적과 확인 토큰은 C1과 같은 방식(`runner.estimate` + cacheKey 바인딩).

### 프로필 — `lib/modes/paper.js`

- `PROFILES`에 `['paper', paperProfile]`을 더한다.
- 분석 요청 본문(`buildPaperAnalyzeSchema`, strictObject): `{ paper: { id, title, authors[], url, sections: [{ id, anchor, heading, text }], truncated: [{ id, heading, partial }] } }`.
  - 장 ID 형식 `^S\d{1,3}$`, `anchor`는 `^[A-Za-z0-9.]{1,40}$`, 장 수 ≤ 200, 장 본문 합계는 `maxPromptChars` 안.
  - `maxRequestBodyBytes`(200,000)는 그대로 둔다. 25,000토큰 영문 본문은 약 100KB다.
- `normalize`: 장이 `S0` 하나뿐이면 422 `INSUFFICIENT_DATA`("본문 장이 없어 전문 분석을 할 수 없습니다.").
- `hashInput`: `{ mode: 'paper', paper }`. 다른 모드의 토큰으로는 분석할 수 없다.
- `buildSources`: 장마다 출처 한 건 `{ sourceId: 'S3', title: '<장 제목>', source: 'arXiv <id>', url: `${htmlUrl}#${anchor}`, type: 'section' }`.
- `urlWhitelist`: 논문 abs·html URL과 장 앵커 URL.
- `baseMeta`: `{ sourceCount: 장 수, paper: { id, title }, truncated }`.

### 응답 스키마 — `lib/modes/paper-schema.js` (`paper_critical_reading`, strict)

| 필드 | 형태 |
|---|---|
| `summary` | string |
| `problem` | `{ statement, sourceIds[] }` |
| `method` | `{ overview, keyIdeas[], sourceIds[] }` |
| `experimentalSetup` | `{ datasets[], baselines[], metrics[], sourceIds[] }` |
| `keyResults` (≤6) | `[{ claim, numbers[], sourceIds[] }]` — `numbers`는 본문 표기 그대로 |
| `authorStatedLimitations` | `[{ point, sourceIds[] }]` |
| `reviewerConcerns` (≤5) | `[{ concern, why, severity: '경미'\|'중요'\|'치명', sourceIds[] }]` |
| `reproducibility` | `{ code: '공개'\|'미공개'\|'언급 없음', data: 같은 enum, note, sourceIds[] }` |
| `openQuestions` | string[] |

- `PAPER_MOCK_REPORT`: `LLM_MODE=mock` 응답. `S0`, `S1`만 인용하고 `keyResults`는 비운다.

### 프롬프트 — `lib/modes/paper-prompt.js`

- 시스템 프롬프트: 한국어로 쓴다. 본문에 없는 수치·비교·데이터셋을 만들지 않는다. 외부 지식(다른 논문, 알려진 후속 결과)을 근거로 쓰지 않는다. 저자가 밝힌 한계와 리뷰어 시각의 약점을 섞지 않는다. `numbers`에는 본문 표기 그대로 옮긴다. 잘린 장이 있으면 그 내용을 추측하지 않는다.
- 사용자 프롬프트: 제목·저자·arXiv ID, 잘린 장 목록, 그리고 `[S3] 3 Method` 머리 뒤에 장 본문.

### 품질 검사 — `lib/quality/paper.js`

기존 품질 게이트(`assessQuality`, 교정 1건 −10점, 경고 1건 −5점)에 `PAPER_CHECKS`를 넘긴다. 인용 접두사는 `'S'`.

1. **인용 검사**: `sourceIds`에서 모르는 ID(프롬프트에 없던 장 포함)를 지운다(교정). 인용이 하나도 남지 않은 배열 항목은 제거한다(교정). 객체 섹션(`problem`, `method` 등)은 인용이 비면 경고만 남긴다.
2. **수치 대조**: `keyResults[].numbers`의 각 값을 정규화해 인용 장 본문에서 찾는다.
   - 정규화: 쉼표 천 단위 제거, 끝의 `%`·`x`·`×` 분리, 앞뒤 공백 제거, 유니코드 마이너스(`−`)를 `-`로. 본문도 같은 규칙으로 정규화한 뒤 수치 토큰 경계(앞뒤가 숫자·소수점이 아님)로 찾는다. `85.3`이 `185.3`에 걸리지 않는다.
   - 못 찾은 값은 지운다(교정, 메시지에 값과 장 ID). `numbers`가 모두 지워진 항목은 제거한다(교정).
   - `numbers`가 원래 빈 항목은 그대로 둔다(정성 결과).
3. **잘림 경고**: `truncated`가 있으면 경고 1건("본문 일부(…)가 길이 제한으로 분석에서 빠졌습니다.").
4. **빈 섹션 경고**: 본문 장 제목에 `experiment|evaluation|result|benchmark`(대소문자 무시)가 있는데 `keyResults`가 비면 경고. `reviewerConcerns`가 비면 경고.
5. **투자 표현 검사**: C1의 `checkInvestmentLanguage`를 재사용한다.

### 화면 (client)

- **검색 화면** `SearchPage.jsx`: 모드 탭에 '논문 전문'을 더한다. 입력란 레이블 "arXiv ID 또는 링크", 예시 `2401.04088`. 클라이언트에서도 같은 ID 규칙으로 미리 거른다(서버가 최종 판단).
- **검토 화면** `PaperReviewPage.jsx`: 제목·저자·arXiv 링크, 장 목록(ID·제목·추정 토큰), 잘릴 장은 회색과 '잘림'/'일부만' 표시, 예상 비용, 승인 버튼. 기존 `CsReviewPage`의 승인 흐름을 따른다.
- **보고서 화면** `PaperReportPage.jsx`: 위 스키마 순서. 인용 `[S3]`을 누르면 장 제목과 본문 앞 600자를 펼친다(분석 요청 본문을 화면 상태로 들고 있다). `numbers`는 강조 표시, `severity`는 배지. 머리에 품질 점수와 잘림 안내.
- **CS 보고서** `CsReportPage.jsx`: 논문 하이라이트·논문 출처 항목에 '전문 분석' 버튼. arXiv URL에서 ID를 뽑아 논문 모드 수집으로 넘어가고, 검토 화면에서 승인해야 과금된다.
- `api/client.js`: `collectPaper(arxiv)`, 분석 본문 `{ mode: 'paper', paper }`.

### 평가 — `eval/`

- 케이스 3개: `paper-1` 정상, `paper-2` 본문에 없는 수치를 넣은 응답 → 수치 제거, `paper-3` 잘린 장 ID를 인용한 응답 → 인용 제거.
- 컨텍스트 `eval/contexts/paper-mixtral.json`(fixture에서 만든 장 일부).

## 오류 처리 요약

| 상황 | 결과 |
|---|---|
| arXiv 입력 형식 오류 | 400 `INVALID_REQUEST` |
| HTML 판 404, 본문 없는 페이지 | 422 `FULLTEXT_UNAVAILABLE` |
| arXiv 네트워크 오류·5xx·429 | 502 `COLLECTION_FAILED`(사유 포함) |
| 본문 장 없음(분석 요청) | 422 `INSUFFICIENT_DATA` |
| 다른 모드 확인 토큰 | 기존 cacheKey 불일치 오류 |

## 테스트

- fixture: `tests/fixtures/arxiv-html-short.html`(Mixtral에서 줄인 것: 초록, 장 3개, 소절 1개, 표 1개, 수식, 참고문헌, 부록), `arxiv-html-long.html`(예산을 넘는 합성 장), `arxiv-html-empty.html`(본문 없는 안내 페이지).
- 단위: `parseArxivId`(허용·거부 표), `parseArxivHtml`(장 번호, 소절, 표·수식·그림 변환, 참고문헌·부록 제외, 잘못된 응답), `fitSections`(완전 포함, 부분, 제외), 수치 정규화·경계 일치, `PAPER_CHECKS` 각 규칙.
- 라우트: 수집 성공·잘림·404→422·형식 오류 400·모르는 키 400, 수집 토큰으로 분석 통과(cacheKey 일치), CS 토큰 재사용 거부.
- 클라이언트: 검색 탭 입력 검증, 검토 화면 잘림 표시, 보고서 인용 펼침, CS 보고서 버튼이 ID를 넘기는지.
- `npm test`, `npm run eval`, `npm run build:client` 모두 통과.
- 실호출: 마지막에 로컬 1회(2401.04088, 약 $0.08). 운영 확인은 병합 후 사용자 승인을 받아 따로 한다.

## 비용

gpt-4o 기준 입력 약 26,000토큰 + 출력 약 3,000토큰 → 논문 한 편 약 $0.07~0.10. 기존 일일 예산·요청당 상한이 그대로 적용된다.
