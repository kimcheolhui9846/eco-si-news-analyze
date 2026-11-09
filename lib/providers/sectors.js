import { createMatcher } from './match.js';

// ─── 분야 → 대표 종목 묶음 ───
//
// 분야 구성은 자동으로 정하지 않는다. 비공식 업종 API는 깨지기 쉽고,
// LLM에 티커를 물으면 존재하지 않는 티커를 지어낼 수 있다.
// cik·corpCode는 여기 적지 않는다. resolve 단계에서 디렉터리로 보강한다.

const us = (symbol, name) => ({ symbol, name, assetType: 'stock', market: 'US' });
const kr = (symbol, name) => ({ symbol, name, assetType: 'stock', market: 'KR' });
const coin = (symbol, name) => ({ symbol, name, assetType: 'crypto', market: 'CRYPTO' });

export const SECTOR_BASKETS = {
  반도체: {
    keywords: ['반도체', 'semiconductor', 'semiconductors', '칩'],
    members: [us('NVDA', 'NVIDIA'), us('TSM', 'TSMC'), kr('005930.KS', '삼성전자'), kr('000660.KS', 'SK하이닉스')],
  },
  AI: {
    keywords: ['ai', '인공지능', '생성형'],
    members: [us('NVDA', 'NVIDIA'), us('MSFT', 'Microsoft'), us('GOOGL', 'Alphabet'), kr('035420.KS', 'NAVER')],
  },
  '2차전지': {
    keywords: ['2차전지', '이차전지', '배터리'],
    members: [kr('373220.KS', 'LG에너지솔루션'), us('TSLA', 'Tesla'), kr('006400.KS', '삼성SDI'), kr('247540.KQ', '에코프로비엠')],
  },
  자동차: {
    keywords: ['자동차', '전기차', 'ev'],
    members: [us('TSLA', 'Tesla'), kr('005380.KS', '현대자동차'), kr('000270.KS', '기아'), us('GM', 'General Motors')],
  },
  바이오: {
    keywords: ['바이오', '제약'],
    members: [kr('068270.KS', '셀트리온'), kr('207940.KS', '삼성바이오로직스'), us('LLY', 'Eli Lilly'), us('AMGN', 'Amgen')],
  },
  '빅테크·플랫폼': {
    keywords: ['빅테크', '플랫폼'],
    members: [us('AAPL', 'Apple'), us('AMZN', 'Amazon'), us('META', 'Meta'), kr('035720.KS', '카카오')],
  },
  코인: {
    keywords: ['코인', '암호화폐', 'crypto'],
    members: [coin('bitcoin', '비트코인'), coin('ethereum', '이더리움'), coin('solana', '솔라나'), coin('ripple', '리플')],
  },
};

const SECTOR_BY_KEYWORD = new Map(
  Object.entries(SECTOR_BASKETS).flatMap(([sector, b]) => b.keywords.map((k) => [k.toLowerCase(), sector])),
);

export const SECTOR_KEYWORDS = [...SECTOR_BY_KEYWORD.keys()];

const findKeyword = createMatcher(SECTOR_KEYWORDS);

export function lookupSector(query) {
  const keyword = findKeyword(query);
  if (!keyword) return null;
  const sector = SECTOR_BY_KEYWORD.get(keyword);
  return { sector, members: SECTOR_BASKETS[sector].members.map((m) => ({ ...m })) };
}
