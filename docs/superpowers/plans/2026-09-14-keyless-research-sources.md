# 키 없는 논문 소스 대체 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** OpenAlex와 Crossref를 이용해 KCI 키 없이 논문 검색을 보완한다.

**Architecture:** 기존 papers provider의 소스별 fetch/parse 경계를 유지하고 새 adapter를 추가한다. OpenAlex를 먼저 호출하고 결과가 부족할 때 Crossref를 보조 호출하며, 기존 Europe PMC·arXiv·KCI는 독립적으로 유지한다.

**Tech Stack:** Node >=22, ES modules, 기존 injected HTTP/cache/breaker, `node:test` via tsx.

## Global Constraints

- No new dependencies, secrets, UI/schema/auth changes.
- Exact HTTPS hosts `api.openalex.org`, `api.crossref.org` through existing allowlist.
- Preserve existing sourceName/normalization/partial-failure contracts and KCI optional behavior.
- Bounded requests, cache, source-specific breakers; no fallback that hides all source errors.

### Task 1: adapters and integration

**Files:** `lib/providers/papers.js`, new `lib/providers/openalex.js`, new `lib/providers/crossref.js`, `lib/config.js`, `.env.example`, tests and fixtures, README/API/HANDOFF.

- [ ] Add failing fixture tests for OpenAlex envelope, Crossref message/items, Korean query routing, empty-result fallback, duplicate normalization and 429 degradation.
- [ ] Implement parsers mapping title, abstract, authors, venue, DOI, URL, publication date, peer-reviewed status, sourceName and language to existing fields.
- [ ] Integrate bounded OpenAlex then Crossref calls without changing Europe PMC/arXiv/KCI behavior.
- [ ] Add hosts to default allowlist and environment example; use optional `RESEARCH_CONTACT_EMAIL` only when configured, with a safe default User-Agent.
- [ ] Run targeted tests, full test suite, client build, and keyless public smoke. Record actual results.
- [ ] Request independent review, fix blocker/major findings, commit, push and create Draft PR.
