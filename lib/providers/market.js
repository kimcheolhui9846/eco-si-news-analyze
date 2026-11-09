import { createNaverMarket, NAVER_UNSUPPORTED } from './naver-market.js';
import { createCoinbaseMarket } from './coinbase-market.js';
import { makeMarketResult, RANGE_DAYS } from './market-series.js';

const CRYPTO = new Set(['bitcoin', 'ethereum', 'solana', 'ripple']);
const canMapStock = (symbol) => /^[A-Z0-9]+$/i.test(symbol) || /^\d{6}\.(KS|KQ)$/i.test(symbol);

export function createMarketProvider({ http, cache, clock, makeBreaker }) {
  const breakers = new Map();
  const breakerFor = (key) => {
    if (!breakers.has(key)) breakers.set(key, makeBreaker());
    return breakers.get(key);
  };
  const naver = createNaverMarket({ http, clock, cache });
  const coinbase = createCoinbaseMarket({ http, clock });

  const legacyStock = async (symbol, range) => {
    const { text } = await http.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`);
    const result = JSON.parse(text)?.chart?.result?.[0];
    if (!result) return null;
    const quote = result.indicators?.quote?.[0] ?? {};
    return makeMarketResult({
      symbol: result.meta?.symbol ?? symbol,
      currency: result.meta?.currency ?? '',
      points: (result.timestamp ?? []).map((stamp, i) => ({
        t: new Date(stamp * 1000), c: quote.close?.[i], v: quote.volume?.[i],
      })),
      source: 'Yahoo', livePrice: result.meta?.regularMarketPrice,
    });
  };

  const legacyCrypto = async (symbol, range) => {
    const days = RANGE_DAYS[range] ?? 30;
    const { text } = await http.get(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(symbol)}/market_chart?vs_currency=usd&days=${days}&interval=daily`);
    const body = JSON.parse(text);
    const volumes = new Map((body?.total_volumes ?? []).map(([stamp, volume]) => [stamp, volume]));
    return makeMarketResult({
      symbol, currency: 'USD', source: 'CoinGecko',
      points: (body?.prices ?? []).map(([stamp, close]) => ({ t: new Date(stamp), c: close, v: volumes.get(stamp) })),
    });
  };

  // A neutral result must neither clear failures nor open the source circuit.
  const fetchSource = async (source, fetcher) => {
    const breaker = breakerFor(source);
    if (!breaker.canPass()) return null;
    try {
      const result = await fetcher();
      if (result && result !== NAVER_UNSUPPORTED) breaker.recordSuccess();
      return result;
    } catch {
      breaker.recordFailure();
      return null;
    }
  };

  return {
    async fetch({ symbol, assetType, range }) {
      if (!symbol) return null;
      const key = `${assetType}:${symbol}:${range}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const crypto = assetType === 'crypto';
      const mapped = crypto ? CRYPTO.has(symbol.toLowerCase()) : canMapStock(symbol);
      let result;
      if (mapped) {
        result = crypto
          ? await fetchSource('coinbase', () => coinbase(symbol.toLowerCase(), range))
          : await fetchSource('naver', () => naver(symbol.toUpperCase(), range));
      }
      if (!mapped || result === NAVER_UNSUPPORTED) {
        result = crypto
          ? await fetchSource('coingecko', () => legacyCrypto(symbol, range))
          : await fetchSource('yahoo-chart', () => legacyStock(symbol, range));
      } else if (result) {
        // Provider-specific casing/codes are internal; preserve the input identifier.
        result.series.symbol = symbol;
        result.marketData.assetName = symbol;
      }
      if (result) cache.set(key, result);
      return result;
    },
  };
}
