# 키 없는 논문 소스 대체 설계

## 목적

KCI API 키를 준비하기 어려운 환경에서도 논문 수집을 제공한다. OpenAlex를 기본 소스로 사용하고 Crossref를 보조 소스로 사용한다. 기존 Europe PMC·arXiv·선택적 KCI 경로는 유지한다.

## 범위와 계약

- `createResearchProvider`의 반환 구조, 언어 가드, 논문 정규화, 부분 실패(degraded) 계약을 유지한다.
- 영어와 한국어 검색 모두 OpenAlex를 먼저 사용한다. OpenAlex 결과가 부족하거나 정상 응답이 비어 있으면 Crossref를 보조 호출한다.
- KCI는 `KCI_API_KEY`가 있을 때만 한국어 검색에 추가한다. 키가 없으면 기존 안내를 유지한다.
- Europe PMC와 arXiv는 기존 영어 경로에서 유지한다. 한 소스의 429/timeout은 다른 소스 결과를 막지 않는다.
- 새 요청은 `https://api.openalex.org`, `https://api.crossref.org`를 주입된 HTTP 클라이언트와 허용목록을 통해서만 호출한다.
- Crossref 요청에는 polite pool용 `mailto` 또는 식별 가능한 User-Agent를 사용하되 비밀값은 넣지 않는다.
- 모든 소스 결과는 기존 논문 필드로 변환하고 제목 없는 항목, 중복, 저자·본문 상한을 기존 규칙으로 정리한다.

## 실패와 품질

- OpenAlex/Crossref가 모두 실패해도 기존 Europe PMC/arXiv/KCI 결과와 부분 결과를 반환한다.
- 429는 소스별 degraded로 기록하며 짧은 재시도나 캐시로 반복 호출을 줄인다. 무한 재시도는 하지 않는다.
- 새 소스의 결과를 KCI 등재 논문으로 표시하지 않는다. sourceName은 실제 제공자 이름을 사용한다.
- API 키 없이 OpenAlex·Crossref를 호출하는 동작을 fixture와 실제 비민감 smoke로 검증한다.

## 제외 범위

KCI 키 발급, KCI 응답 계약 확정, 정적 IP가 필요한 KCI 운영 보장, 전문 PDF 다운로드, UI 레이아웃 변경은 이번 Task에서 제외한다.
