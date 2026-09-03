import { computeIndicators, buildChartTrend } from './indicators.js';
import { lookupAlias } from './aliases.js';

/** CoinGecko는 range 대신 일수를 받는다. */
const RANGE_DAYS = { '5d': 5, '1mo': 30, '3mo': 90, '6mo': 180, '1y': 365 };

// 출력 가능한 ASCII만으로 이루어졌는지. 한글이면 Yahoo 검색이 400을 준다.
const isAscii = (s) => /^[ -~]+$/.test(s);

export function createMarketProvider({ http, cache, clock, makeBreaker }) {
  const breakers = new Map();
  const breakerFor = (key) => {
    if (!breakers.has(key)) breakers.set(key, makeBreaker());
    return breakers.get(key);
  };

  /** Yahoo 검색. 실패는 null로 흡수한다. */
  const searchSymbol = async (query) => {
    const breaker = breakerFor('yahoo-search');
    if (!breaker.canPass()) return null;

    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=1&newsCount=0`;
    try {
      const { text } = await http.get(url);
      breaker.recordSuccess();
      const hit = JSON.parse(text)?.quotes?.[0];
      return hit?.symbol
        ? { symbol: hit.symbol, assetType: 'stock', name: hit.shortname ?? hit.symbol }
        : null;
    } catch {
      breaker.recordFailure();
      return null;
    }
  };

  const fetchStock = async (symbol, range) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
    const { text } = await http.get(url);
    const result = JSON.parse(text)?.chart?.result?.[0];
    if (!result) return null;

    const quote = result.indicators?.quote?.[0] ?? {};
    const indicators = computeIndicators(quote.close ?? [], quote.volume ?? []);
    if (!indicators) return null;

    const currency = result.meta?.currency ?? '';
    const price = result.meta?.regularMarketPrice ?? indicators.last;

    return {
      indicators,
      marketData: {
        assetName: result.meta?.symbol ?? symbol,
        currentPrice: `${Number(price).toLocaleString()} ${currency}`.trim(),
        priceChange: `${indicators.changePct.toFixed(2)}%`,
        chartTrend: buildChartTrend(indicators, { currency }),
      },
    };
  };

  const fetchCrypto = async (symbol, range) => {
    const days = RANGE_DAYS[range] ?? 30;
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(symbol)}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
    const { text } = await http.get(url);
    const body = JSON.parse(text);

    const closes = (body?.prices ?? []).map(([, p]) => p);
    const volumes = (body?.total_volumes ?? []).map(([, v]) => v);
    const indicators = computeIndicators(closes, volumes);
    if (!indicators) return null;

    return {
      indicators,
      marketData: {
        assetName: symbol,
        currentPrice: `${indicators.last.toLocaleString()} USD`,
        priceChange: `${indicators.changePct.toFixed(2)}%`,
        chartTrend: buildChartTrend(indicators, { currency: 'USD' }),
      },
    };
  };

  return {
    async resolveSymbol({ query, symbol, assetType }) {
      // 1) 명시된 심볼이 가장 확실하다.
      if (symbol) {
        return { symbol, assetType: assetType ?? 'stock', name: symbol, source: 'explicit' };
      }

      // 2) 별칭 사전. 한글은 이 경로로만 해석된다.
      const alias = lookupAlias(query);
      if (alias) return { ...alias, source: 'alias' };

      // 3) 영문이면 Yahoo 검색. 한글은 400을 받으므로 시도하지 않는다.
      if (isAscii(query)) {
        const found = await searchSymbol(query);
        if (found) return { ...found, source: 'search' };
      }

      // 4) 해석 실패는 오류가 아니다. 뉴스만으로 진행한다.
      return { symbol: null, assetType: assetType ?? 'stock', name: null, source: 'unresolved' };
    },

    async fetch({ symbol, assetType, range }) {
      if (!symbol) return null;

      const cacheKey = `${assetType}:${symbol}:${range}`;
      const cached = cache.get(cacheKey);
      if (cached) return cached;

      const breaker = breakerFor(assetType === 'crypto' ? 'coingecko' : 'yahoo-chart');
      if (!breaker.canPass()) return null;

      try {
        const result = assetType === 'crypto'
          ? await fetchCrypto(symbol, range)
          : await fetchStock(symbol, range);

        breaker.recordSuccess();
        if (result) cache.set(cacheKey, result);
        return result;
      } catch {
        breaker.recordFailure();
        // 시장 데이터는 선택 사항이다. 없으면 뉴스만으로 진행한다.
        return null;
      }
    },
  };
}
