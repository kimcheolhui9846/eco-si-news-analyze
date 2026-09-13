import { lookupAlias, SYMBOL_ALIASES } from './aliases.js';
import { createNaverMarket } from './naver-market.js';
import { createCoinbaseMarket } from './coinbase-market.js';
import { makeMarketResult, RANGE_DAYS } from './market-series.js';

const isAscii = (s) => /^[ -~]+$/.test(String(s));
const US = new Set(['NVDA','AAPL','MSFT','TSLA','GOOGL','AMZN','META','AMD','INTC','AVGO','TSM']);
const CRYPTO = new Set(['bitcoin','ethereum','solana','ripple']);

export function createMarketProvider({ http, cache, clock, makeBreaker }) {
  const breakers = new Map();
  const breakerFor = (key) => { if (!breakers.has(key)) breakers.set(key, makeBreaker()); return breakers.get(key); };
  const naver = createNaverMarket({ http, clock });
  const coinbase = createCoinbaseMarket({ http, clock });
  const searchSymbol = async (query) => {
    const b = breakerFor('yahoo-search'); if (!b.canPass()) return null;
    try { const { text } = await http.get(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=1&newsCount=0`); const hit = JSON.parse(text)?.quotes?.[0]; b.recordSuccess(); return hit?.symbol ? { symbol: hit.symbol, assetType: 'stock', name: hit.shortname ?? hit.symbol } : null; } catch { b.recordFailure(); return null; }
  };
  const legacyStock = async (symbol, range) => { const body = JSON.parse((await http.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`)).text); const r = body?.chart?.result?.[0]; if (!r) return null; const q = r.indicators?.quote?.[0] ?? {}; return makeMarketResult({ symbol: r.meta?.symbol ?? symbol, currency: r.meta?.currency ?? '', points: (r.timestamp ?? []).map((t,i)=>({t:new Date(t*1000).toISOString(),c:q.close?.[i],v:q.volume?.[i]})), source:'Yahoo', livePrice:r.meta?.regularMarketPrice }); };
  const legacyCrypto = async (symbol, range) => { const days = RANGE_DAYS[range] ?? 30; const b = JSON.parse((await http.get(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(symbol)}/market_chart?vs_currency=usd&days=${days}&interval=daily`)).text); const vs = new Map((b?.total_volumes ?? []).map(([t,v])=>[t,v])); return makeMarketResult({symbol,currency:'USD',points:(b?.prices ?? []).map(([t,c])=>({t:new Date(t).toISOString(),c,v:vs.get(t)})),source:'CoinGecko'}); };
  return {
    async resolveSymbol({ query, symbol, assetType }) { if (symbol) return {symbol,assetType:assetType??'stock',name:symbol,source:'explicit'}; const a=lookupAlias(query); if(a)return {...a,source:'alias'}; if(isAscii(query)){const f=await searchSymbol(query);if(f)return {...f,source:'search'};} return {symbol:null,assetType:assetType??'stock',name:null,source:'unresolved'}; },
    async fetch({ symbol, assetType, range }) { if(!symbol)return null; const key=`${assetType}:${symbol}:${range}`; const hit=cache.get(key); if(hit)return hit; const crypto=assetType==='crypto'; const s=String(symbol); const supported=crypto?CRYPTO.has(s.toLowerCase()):US.has(s.toUpperCase())||/^\d{6}(?:\.(KS|KQ))?$/i.test(s); const source=supported?(crypto?'coinbase':'naver'):(crypto?'coingecko':'yahoo-chart'); const b=breakerFor(source); if(!b.canPass())return null; try { const result=supported?(crypto?await coinbase(s.toLowerCase(),range):await naver(s.toUpperCase(),range)):(crypto?await legacyCrypto(s,range):await legacyStock(s,range)); if(result){b.recordSuccess();cache.set(key,result);} return result; } catch { b.recordFailure(); return null; } },
  };
}
export { lookupAlias, SYMBOL_ALIASES };
