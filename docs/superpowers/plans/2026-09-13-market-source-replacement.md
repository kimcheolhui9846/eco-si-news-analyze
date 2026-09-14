# Market Source Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. All steps below belong to one user-approved Task 6, not separate approval gates.

**Goal:** Replace supported stock/crypto chart retrieval with Naver/Coinbase while preserving existing API contracts and unsupported-symbol compatibility.

**Architecture:** market.js keeps orchestration, symbol resolution, source selection, cache and breakers. Focused naver-market.js/coinbase-market.js adapters share market-series.js normalization/date/result utilities; market-legacy.js can hold unchanged legacy chart fetchers. No new dependencies, no common HTTP redesign.

**Tech Stack:** Node >=22, ES modules, node:test via tsx, existing injected http/cache/clock/makeBreaker.

**Execution record (2026-09-14):** Implementation and regression coverage delivered. Initial Luna pass lacked test-first evidence; actual later RED cases included identity/date rejection, chunk filtering and metadata cache reuse. All are fixed and recorded in root HANDOFF.md. Full gate:551pass/0fail/1skip, buildPASS; public smoke13/13PASS. Supplementary native Astra review PASS WITH NOTES; external cross-check DEGRADED and Render NOT RUN. Checklist below preserves the original planned steps; this record and HANDOFF.md are authoritative for observed execution.

## Global Constraints

- User approved design: docs/superpowers/specs/2026-09-13-market-source-replacement-design.md, including exact interval/identity/fallback rules in sections 3–5.
- Preserve createMarketProvider({ http, cache, clock, makeBreaker }), resolveSymbol and fetch signatures, existing symbol/assetType, marketData/series/indicators shapes and confirmation-token behavior.
- All source requests go through injected http.get; exact HTTPS hosts api.stock.naver.com, m.stock.naver.com (domestic metadata), api.exchange.coinbase.com enter config and .env.example. No secrets/keys/new dependencies.
- Legacy fallback only for unsupported mappings, never to hide errors on supported Naver/Coinbase identifiers. Yahoo search remains separate.
- Crypto ids bitcoin/ethereum/solana/ripple map to BTC-USD/ETH-USD/SOL-USD/XRP-USD. Preserve output ids, USD, explicit Coinbase daily-close attribution.
- Stock metadata must prove symbol/market/currency. Known NASDAQ aliases NVDA AAPL MSFT TSLA GOOGL AMZN META AMD INTC AVGO use .O; TSM uses bare code. Domestic .KS/.KQ uses six digits with market identity check.
- Preserve exact date rules from design: one clock snapshot, exchange local day/DST, CLOSE/localTradedAt/current close agreement; calendar month clamp; stock 5d last5 of bounded45days; crypto completed UTC candles and halfopen299day chunks.
- Normalize series once: real calendar dates, finite positive close, finite nonnegative volumes or null, chronological/deduplicated points and indicators from the same points. No invented missing candles.
- Source breaker failures on transport/malformed payload; unsupported/normal empty/<2 points/metadata mismatch neutral. Sources and fallback breakers isolated.
- Controller owns HANDOFF/spec/plan/README/PR records. Implementer owns production code, associated config/env example, tests/fixtures only and its scratch report. No credentials, .env, or unrelated files. No checkout/reset/stash/revert of others' work.

### Task 1: Implement and integrate source adapters

**Files:**
- Modify: lib/providers/market.js, lib/config.js, .env.example
- Create as needed: lib/providers/naver-market.js, lib/providers/coinbase-market.js, lib/providers/market-series.js, lib/providers/market-legacy.js
- Test: tests/market-provider.test.js, tests/market-sources.test.js (new), tests/research.test.js, tests/collect-scope.test.js, tests/config.test.js if config assertions require updates
- Fixtures/utilities: tests/fixtures/naver-*.json, tests/fixtures/coinbase-*.json, tests/helpers/market-fixtures.js if shared integration routes are useful

**Interfaces:** consumes http.get(url)->{status,text,url}, cache.get/set, clock()->epoch milliseconds, makeBreaker()->canPass/recordSuccess/recordFailure. Produces existing provider fetch result `{ indicators, series:{symbol,currency,points:[{t,c,v}]}, marketData:{assetName,currentPrice,priceChange,chartTrend} } | null`.

- [ ] **Step 1: baseline and RED.** Read approved design and current helpers/tests. Baseline provider+indicators already46/46 and full529/0/1; establish current targeted baseline. Add behavioral tests before source changes. Example of required acceptance:

```js
const result = await p.fetch({symbol:'NVDA',assetType:'stock',range:'1y'});
assert.equal(result.series.symbol,'NVDA');
assert.equal(result.series.currency,'USD');
assert.equal(result.series.points.length,result.indicators.points);
assert.ok(result.series.points.every((point,i,all)=>i===0||all[i-1].t<point.t));
assert.match(result.marketData.chartTrend,/네이버|Naver/);
assert.equal(http.calls.some(url=>url.includes('query1.finance.yahoo.com/v8')),false);
```

Use injected network responses (raw minimal rows derived from observed live shape) and fixed clock, not current wall time. metadata fixture foreign shape includes reutersCode, symbolCode, currencyType:{code:'USD'}, stockExchangeType:{name:'NASDAQ',nationCode:'USA'}, marketStatus:'CLOSE', localTradedAt:'2026-09-11T16:00:00-04:00', closePrice:'218.29'. Domestic metadata actual shape must be inspected with small safe public probe if not present; do not assume it matches foreign fields. Daily chart is an array of `{localDate:'20260911',closePrice:218.29,accumulatedTradingVolume:89060140}`. Coinbase candle is `[unixSeconds,low,high,open,close,volume]`.

Run `node --import tsx --test tests/market-sources.test.js`; record actual expected failures before implementation. Sandbox uv_os_get_passwd ENOMEM requires escalation, not changing tests or claims of RED.

- [ ] **Step 2: normalize/results/date utilities and GREEN.** Implement small pure helpers consumed by both adapters. Build indicators only from normalized points; guard zero/negative/malformed numbers/dates; use existing computeIndicators/buildChartTrend without changing their public contract. Attributed trend prefix must fit configured maxTrendChars. Example internal result construction:

```js
const indicators=computeIndicators(points.map(p=>p.c),points.map(p=>p.v));
if(!indicators)return null;
return {indicators,series:{symbol,currency,points},marketData:{
 assetName:symbol,currentPrice:`${indicators.last.toLocaleString()} ${currency}`,
 priceChange:`${indicators.changePct.toFixed(2)}%`,
 chartTrend:`${sourceLabel} 일봉 종가 기준. ${buildChartTrend(indicators,{currency})}`
}};
```

- [ ] **Step 3: Naver adapter.** Metadata `api.stock.naver.com/stock/{code}/basic` for foreign; verified domestic `m.stock.naver.com/api/stock/{code}/basic` returns itemCode, stockExchangeType {code:'KS'|'KQ',nationCode:'KOR',name:'KOSPI'|'KOSDAQ'}, marketStatus/localTradedAt, comma-formatted closePrice. Domestic has no currencyType: derive KRW only from validated domestic identity/Korean market. Deterministic candidate/identity rules from design; cache validated metadata carefully without turning cached CLOSE into current-session proof (metadata time still bounds data). Query `/chart/{domestic|foreign}/item/{code}/day?startDateTime=YYYYMMDD0000&endDateTime=YYYYMMDD2359` with design filtering as authority. Validate known mapping metadata and periods. Existing symbol preserved. Test all11 US alias mappings, KOSPI/KOSDAQ, currency/identity mismatch, unsupported punctuation fallback, general candidate ambiguity, 5d/monthclamp/DST/OPEN/CLOSE/stale/holiday boundaries.

- [ ] **Step 4: Coinbase adapter.** UTC today00:00 exclusive end; fixed range days; use granularity=86400 with start/end ISO. At most2 chunks for1y, max299days each, filter each halfopen chunk and global range then normalize/dedupe. Unknown ids go legacy only; bad responses for supported ids do not. Tests for all4 ids, 1y two requests, boundary duplicates/out-of-range/current-day discard, no-data and transport failure isolation.

- [ ] **Step 5: integrate orchestrator/config and existing suites.** Keep resolveSymbol behavior; select adapters, retain unsupported legacy source functions, maintain range-specific result cache/source-specific breakers. Add hosts to defaults and .env.example (legacy hosts stay because search/fallback use them). Update previous known-symbol Yahoo tests to Naver fixtures or move explicit legacy cases to unsupported symbols. Integration routes must exercise new adapters, not force legacy fallback. Preserve authorization/confirmation-source tests.

Run `node --import tsx --test tests/market-provider.test.js tests/market-sources.test.js tests/indicators.test.js tests/research.test.js tests/collect-scope.test.js tests/config.test.js`.

- [ ] **Step 6: focused live smoke and full gate.** Use provider factory and production HTTP abstraction to query NVDA/TSM/005930.KS/035900.KQ/bitcoin for1mo and1y plus other3 crypto1mo. No server or LLM needed. Print symbol/currency/pointcount/date interval only; do not read .env. Controller will run/review live smoke, so worker need not duplicate calls. Run npm test and npm run build:client once, capture results.

- [ ] **Step 7: review and report.** Self-review against exact design, report RED/GREEN output and files/concerns to assigned scratch report, commit only owned files with conventional subject. Do not push; controller owns push/PR. Subsequent fixes remain same Task.

## Controller delivery

- Update README/source semantics and both handoffs from actual results. Native review spec+quality and final Astra direct checks, external cross-check DEGRADED reasons maintained accurately.
- Inspect scoped commits/diff, push existing Task6 branch, update Draft PR7 against task5 documentation branch. No merge/deploy without explicit authorization.
- Final local gate after PR update if code changed since last gate. Render runtime check requires platform access/approved deploy; if absent report NOT RUN and do not claim operational repair.
