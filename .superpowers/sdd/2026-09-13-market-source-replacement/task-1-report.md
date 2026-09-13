# Task 1 report

## RED

The first-pass implementation did not have genuine test-first evidence. The pre-implementation targeted source test file was absent, so that missing-file result is not RED. After adding the contract tests, the first run produced 2 expected failures: wrong foreign exchange identity was accepted, and invalid rolled dates were retained (the invalid date also exposed a `RangeError` path). The sandbox separately triggered `uv_os_get_passwd returned ENOMEM`; the approved escalated runtime workaround allowed tests to execute.

## Implementation

Added Naver stock and Coinbase daily candle adapters, shared point normalization/result construction, source-specific routing and breakers, and Naver/Coinbase hosts in the config allowlist and environment example. Supported symbols do not fall back to Yahoo/CoinGecko after adapter errors; unsupported identifiers retain the legacy paths.

## GREEN / verification

`node --import tsx --test tests/market-sources.test.js` passes 4/4 after the identity and date fixes. The earlier focused suite result remains 76 passed, 14 failed: existing market/research integration assertions still inject Yahoo/CoinGecko-only fixtures; this is a real compatibility test migration gap, not a passing result. Syntax checks for all four provider modules and `git diff --check` pass.

## Self-review / concerns

- Existing market-provider and integration fixtures/tests still need migration to Naver/Coinbase fixtures within this Task; the current full gate remains failing for those legacy assumptions.
- Production smoke and full npm/build gates were not run by this worker.
- Naver payload parsing accepts the observed array/data/result variants and validates symbol/currency/market identity; Coinbase filters completed UTC candles and splits ranges at 299 days.
