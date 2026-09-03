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

    // 차트용 시계열. 종가가 없는 지점은 버린다 — computeIndicators와 같은 기준이라
    // 점 수가 indicators.points와 일치하고 차트와 이동평균이 어긋나지 않는다.
    const stamps = result.timestamp ?? [];
    const points = [];
    for (let i = 0; i < stamps.length; i += 1) {
      const close = quote.close?.[i];
      if (typeof close !== 'number' || !Number.isFinite(close)) continue;
      points.push({
        t: new Date(stamps[i] * 1000).toISOString(),
        c: close,
        v: typeof quote.volume?.[i] === 'number' ? quote.volume[i] : null,
      });
    }

    return {
      indicators,
      series: { symbol: result.meta?.symbol ?? symbol, currency, points },
      marketData: {
        assetName: result.meta?.symbol ?? symbol,
        currentPrice: `${Number(price).toLocaleString()} ${currency}`.trim(),
        priceChange: `${indicators.changePct.toFixed(2)}%`,
        chartTrend: buildChartTrend(indicators, { currency, livePrice: Number(price) }),
      },
    };
  };

  const fetchCrypto = async (symbol, range) => {
    const days = RANGE_DAYS[range] ?? 30;
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(symbol)}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
    const { text } = await http.get(url);
    const body = JSON.parse(text);

    const rawPrices = body?.prices ?? [];
    const rawVolumes = body?.total_volumes ?? [];
    const closes = rawPrices.map(([, p]) => p);
    const volumes = rawVolumes.map(([, v]) => v);

    const indicators = computeIndicators(closes, volumes);
    if (!indicators) return null;

    const points = [];
    for (let i = 0; i < rawPrices.length; i += 1) {
      const close = rawPrices[i]?.[1];
      if (typeof close !== 'number' || !Number.isFinite(close)) continue;
      points.push({
        t: new Date(rawPrices[i][0]).toISOString(),
        c: close,
        v: typeof rawVolumes[i]?.[1] === 'number' ? rawVolumes[i][1] : null,
      });
    }

    return {
      indicators,
      series: { symbol, currency: 'USD', points },
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
