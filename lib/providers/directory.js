import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMatcher } from './match.js';

// ─── 회사 디렉터리 ───
//
// SEC company_tickers.json과 OpenDART corpCode.xml의 스냅샷을 쓴다.
// 서버는 실행 중에 회사 목록을 내려받지 않는다(OpenDART 목록은 압축 해제 시 약 25MB).
// 갱신은 scripts/refresh-directory.js로 한다.

const DEFAULT_DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data');

const US_SUFFIXES = new Set([
  'inc', 'corp', 'corporation', 'co', 'company', 'ltd', 'plc', 'holdings', 'holding',
  'group', 'class', 'a', 'b', 'c', 'sa', 'nv', 'ag', 'se', 'lp', 'llc', '/de/', '/new/',
]);

/** "NVIDIA CORP" → "nvidia". 영문명 대조용이다. */
export function normalizeUsName(title) {
  const words = String(title).toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
  while (words.length > 1 && US_SUFFIXES.has(words.at(-1))) words.pop();
  if (words.length > 1 && words[0] === 'the') words.shift();
  return words.join(' ');
}

// 짧은 이름은 일반 단어와 겹친다("대상", "ai"). 일정 길이 미만은 이름 대조에서 뺀다.
// 그런 회사는 별칭 사전이나 티커로 찾는다.
const MIN_KR_NAME = 3;
const MIN_US_NAME = 4;

// 한국어 질의에서 이 약어들은 평범한 단어로 쓰인다("IT 업계", "EU 규제").
// 같은 철자의 티커가 있어도 티커로 보면 분야·미해결 질의를 가로챈다.
const COMMON_ACRONYMS = new Set([
  'IT', 'EU', 'US', 'UK', 'UN', 'CEO', 'CFO', 'CTO', 'ETF', 'IPO', 'GDP', 'CPI', 'PPI', 'PMI',
  'FOMC', 'FED', 'ECB', 'BOJ', 'IMF', 'OECD', 'OPEC', 'ESG', 'AI', 'EV', 'AR', 'VR', 'IOT',
  'SAAS', 'API', 'LLM', 'GPU', 'CPU', 'HBM', 'DRAM', 'NAND', 'PC', 'TV', 'OLED', 'LCD', 'SNS',
  'KPI', 'ROE', 'ROI', 'EPS', 'PER', 'PBR', 'YOY', 'QOQ', 'USD', 'KRW', 'JPY', 'CNY', 'EUR', 'NEWS',
]);

export function createDirectory({ us = [], kr = [] } = {}) {
  const usByTicker = new Map(us.map(([ticker, cik, title]) => [String(ticker).toUpperCase(), { cik, title }]));
  const usByName = new Map();
  for (const [ticker, , title] of us) {
    const n = normalizeUsName(title);
    if (n.length >= MIN_US_NAME && !usByName.has(n)) usByName.set(n, String(ticker).toUpperCase());
  }

  const krByCode = new Map(kr.map(([name, stockCode, corpCode]) => [stockCode, { name, corpCode }]));
  const krByName = new Map();
  for (const [name, stockCode] of kr) {
    const k = String(name).toLowerCase().trim();
    if (k.length >= MIN_KR_NAME && !krByName.has(k)) krByName.set(k, stockCode);
  }

  const findKr = createMatcher([...krByName.keys()]);
  const findUs = createMatcher([...usByName.keys()]);

  const usInstrument = (ticker) => {
    const e = usByTicker.get(ticker);
    return e ? { symbol: ticker, name: e.title, assetType: 'stock', market: 'US', cik: e.cik } : null;
  };
  const krInstrument = (code) => {
    const e = krByCode.get(code);
    return e ? { symbol: code, name: e.name, assetType: 'stock', market: 'KR', corpCode: e.corpCode } : null;
  };

  return {
    size: { us: usByTicker.size, kr: krByCode.size },

    bySymbol(symbol) {
      const s = String(symbol ?? '').toUpperCase();
      const kr6 = s.match(/^(\d{6})(?:\.(KS|KQ))?$/)?.[1];
      if (kr6) return krInstrument(kr6);
      return usInstrument(s);
    },

    findInQuery(query, { reserved = new Set() } = {}) {
      const krKey = findKr(query);
      if (krKey && !reserved.has(krKey)) return krInstrument(krByName.get(krKey));

      // 티커는 대문자로 입력한 단어만 본다. "apple"을 티커로 보면 안 된다.
      for (const word of String(query).split(/[\s,.;:!?()]+/)) {
        if (/^[A-Z]{2,5}$/.test(word) && !COMMON_ACRONYMS.has(word) && !reserved.has(word.toLowerCase()) && usByTicker.has(word)) {
          return usInstrument(word);
        }
      }

      const usKey = findUs(query);
      if (usKey && !reserved.has(usKey)) return usInstrument(usByName.get(usKey));
      return null;
    },
  };
}

const isRow = (row, length) => Array.isArray(row) && row.length === length && row.every((v) => typeof v === 'string');

function readRows(path, length, log) {
  try {
    const body = JSON.parse(readFileSync(path, 'utf8'));
    if (!Array.isArray(body?.rows) || !body.rows.every((r) => isRow(r, length))) {
      log?.warn?.({ path }, '디렉터리 스냅샷 형식이 올바르지 않다. 이 목록 없이 동작한다');
      return [];
    }
    return body.rows;
  } catch (error) {
    log?.warn?.({ path, err: error.message }, '디렉터리 스냅샷을 읽지 못했다. 이 목록 없이 동작한다');
    return [];
  }
}

export function loadDirectory({ dataDir = DEFAULT_DATA_DIR, log } = {}) {
  return createDirectory({
    us: readRows(join(dataDir, 'us-tickers.json'), 3, log),
    kr: readRows(join(dataDir, 'kr-listed.json'), 3, log),
  });
}
