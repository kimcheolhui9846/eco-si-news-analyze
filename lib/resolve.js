import { lookupAlias } from './providers/aliases.js';
import { lookupSector, SECTOR_KEYWORDS } from './providers/sectors.js';

export const MAX_INSTRUMENTS = 4;

/**
 * 검색어 → 종목 배열.
 * 우선순위: 직접 입력한 티커 → 회사(별칭 → 디렉터리) → 분야 묶음 → 없음.
 */
export function createResolver({ directory }) {
  const reserved = new Set(SECTOR_KEYWORDS);

  const enrich = (inst) => {
    if (inst.assetType === 'crypto') {
      return { symbol: inst.symbol, name: inst.name, assetType: 'crypto', market: 'CRYPTO' };
    }
    const found = directory.bySymbol(inst.symbol);
    const market = inst.market ?? found?.market ?? (/^\d{6}/.test(inst.symbol) ? 'KR' : 'US');
    return {
      symbol: inst.symbol,
      name: inst.name,
      assetType: 'stock',
      market,
      ...(found?.cik ? { cik: found.cik } : {}),
      ...(found?.corpCode ? { corpCode: found.corpCode } : {}),
    };
  };

  return function resolveInstruments({ query, symbol, assetType }) {
    if (symbol) {
      const name = directory.bySymbol(symbol)?.name ?? symbol;
      return { kind: 'explicit', instruments: [enrich({ symbol, name, assetType: assetType ?? 'stock' })] };
    }

    const alias = lookupAlias(query);
    if (alias) {
      return { kind: 'company', instruments: [enrich({ symbol: alias.symbol, name: alias.name, assetType: alias.assetType })] };
    }

    const found = directory.findInQuery(query, { reserved });
    if (found) return { kind: 'company', instruments: [enrich(found)] };

    const sector = lookupSector(query);
    if (sector) {
      return { kind: 'sector', sector: sector.sector, instruments: sector.members.slice(0, MAX_INSTRUMENTS).map(enrich) };
    }

    return { kind: 'unresolved', instruments: [] };
  };
}
