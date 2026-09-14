# Keyless Research Sources Implementation Plan

**Goal:** supplement KCI with keyless OpenAlex and Crossref paper search.

**Architecture:** Add isolated OpenAlex and Crossref adapters. The existing provider performs OpenAlex first, retains Europe PMC and arXiv for English queries, uses configured KCI only when a key exists, and calls Crossref when results remain below the requested limit.

## Constraints

- No new dependencies, secrets, schema changes, authentication changes, or UI changes.
- Route requests through the injected HTTP client and exact HTTPS allowlist hosts.
- Preserve source-specific degradation, cache, circuit breakers, normalization limits, and output shape.

## Verification sequence

1. Add failing parser, URL, routing, fallback, and degradation tests.
2. Implement adapters and provider wiring.
3. Run focused research/config/collect tests.
4. Run the full test suite and client build.
5. Run public keyless OpenAlex and Crossref smoke checks.
6. Update README and HANDOFF, inspect the diff, commit, push, and open a Draft PR.
