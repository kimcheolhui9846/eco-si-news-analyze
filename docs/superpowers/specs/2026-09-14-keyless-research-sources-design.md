# Keyless Research Sources Design

## Goal

Provide Korean and English paper results when no KCI API key is available. OpenAlex is the primary source and Crossref is a supplemental source.

## Scope and contract

- Keep the existing research item shape, normalization limits, cache, breaker, language routing, and degraded-source reporting.
- Query OpenAlex first for every paper search. Query Crossref only when the deduplicated result is below the requested limit.
- Keep Europe PMC and arXiv for English queries. Call KCI only when a KCI key is configured.
- Use the existing HTTPS allowlist and HTTP client for api.openalex.org and api.crossref.org.
- Send Crossref mailto only when RESEARCH_CONTACT_EMAIL is configured; never log credentials.

## Failure behavior

- A failed source is recorded as degraded while other source results remain usable.
- Empty or malformed payloads produce no items and do not throw from the provider.
- DOI and normalized-title deduplication keeps the first item, preserving the existing precedence behavior.

## Out of scope

KCI key issuance, KCI response redesign, PDF downloads, UI redesign, market sources, authentication, and LLM behavior.
