# HANDOFF

## Task 7 — 키 없는 논문 소스 대체

- 목적: KCI 키 없이도 한국어·영문 논문 결과를 제공하도록 OpenAlex 기본 + Crossref 보조 경로를 추가한다.
- 사용자 요구사항: KCI는 나중에 키를 발급받아 추가하고, 지금은 키 없는 소스를 사용한다.
- 범위: 논문 검색 provider, 허용목록/환경변수, 테스트·fixtures, API/README 문서. 시장·인증·LLM·UI 동작은 제외한다.
- 현재 상태: main `bbfd41d`에서 Task 브랜치 생성. 설계 문서 작성. 구현 전.

## 계획

- [ ] OpenAlex/Crossref 응답 계약과 기존 papers provider 경계 확인
- [ ] 실패 테스트와 fixture 작성
- [ ] OpenAlex 기본·Crossref 보조 adapter 구현
- [ ] 언어 가드, KCI 선택 경로, breaker/cache 통합
- [ ] 문서·환경 허용목록 갱신
- [ ] targeted/full test, build, live keyless smoke
- [ ] 리뷰·commit/push/Draft PR

## 검증 계획

- `node --import tsx --test tests/research-provider.test.js tests/collect-scope.test.js tests/config.test.js tests/kci-provider.test.js`
- `npm.cmd test`
- `npm.cmd run build:client`
- 공개 API keyless smoke: OpenAlex·Crossref 응답 상태와 논문 수만 기록

## 검토 상태

- 외부 교차검토는 실제 호출 가능한 provider를 확인한 뒤 기록한다. 비밀값은 전송하지 않는다.
- KCI 운영 검증은 키·IP가 없으므로 NOT RUN으로 기록한다.
