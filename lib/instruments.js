// ─── 종목별 시세·재무 수집 ───
//
// 종목 하나가 실패해도 나머지로 진행한다. 실패 사유는 종목 단위로 남긴다.

export const UNRESOLVED_REASON = '종목을 찾지 못했습니다. 회사명이나 분야(예: 반도체, AI)를 함께 입력해 주세요.';

const MARKET_FAILED = '시장 데이터를 가져오지 못했습니다.';
const FINANCIAL_FAILED = '재무 자료를 처리하지 못했습니다.';
const SEC_EMPTY = 'SEC 제출 서류에서 재무지표를 찾지 못했습니다.';
const SEC_UNKNOWN = 'SEC 디렉터리에 없는 종목입니다. SEC EDGAR는 미국 상장사만 다룹니다.';
const KR_KEY_MISSING = '한국 재무: OPENDART_API_KEY가 설정되지 않았습니다.';
const KR_UNKNOWN = '한국 재무: 종목 디렉터리에 없습니다. 스냅샷 갱신이 필요합니다.';

async function financialFor(inst, { sec, dart }) {
  if (inst.assetType === 'crypto') return { financial: null, reason: null };
  if (inst.market === 'KR') {
    if (!dart.configured) return { financial: null, reason: KR_KEY_MISSING };
    if (!inst.corpCode) return { financial: null, reason: KR_UNKNOWN };
    return dart.fetch({ corpCode: inst.corpCode, symbol: inst.symbol, name: inst.name });
  }
  if (!inst.cik) return { financial: null, reason: SEC_UNKNOWN };
  const financial = await sec.fetch({ cik: inst.cik, symbol: inst.symbol });
  return financial ? { financial, reason: null } : { financial: null, reason: SEC_EMPTY };
}

async function collectOne(inst, { wantMarket, wantFinancial, range, market, sec, dart }) {
  const [m, f] = await Promise.all([
    wantMarket ? market.fetch({ symbol: inst.symbol, assetType: inst.assetType, range }) : null,
    wantFinancial ? financialFor(inst, { sec, dart }) : { financial: null, reason: null },
  ]);

  const degraded = [];
  if (wantMarket && !m) degraded.push({ provider: 'market', symbol: inst.symbol, reason: MARKET_FAILED });
  if (f.reason) degraded.push({ provider: 'financial', symbol: inst.symbol, reason: f.reason });

  const out = { symbol: inst.symbol, name: inst.name, assetType: inst.assetType, market: inst.market };
  if (m) {
    out.marketData = m.marketData;
    // 차트용. 프롬프트·cacheKey에는 넣지 않는다.
    out.series = { ...m.series, indicators: m.indicators };
  }
  if (f.financial) out.financial = f.financial;
  return { out, degraded };
}

export async function collectInstruments({
  instruments, wantMarket, wantFinancial, range, market, sec, dart,
}) {
  const results = await Promise.all(instruments.map(async (inst) => {
    try {
      return await collectOne(inst, { wantMarket, wantFinancial, range, market, sec, dart });
    } catch {
      // provider가 예상 밖으로 던져도 이 종목만 빈 결과로 둔다. 다른 종목과 요청 전체는 살린다.
      // 오류 객체는 남기지 않는다 — 메시지에 API 키가 붙은 URL이 들어 있을 수 있다.
      const degraded = [];
      if (wantMarket) degraded.push({ provider: 'market', symbol: inst.symbol, reason: MARKET_FAILED });
      if (wantFinancial) degraded.push({ provider: 'financial', symbol: inst.symbol, reason: FINANCIAL_FAILED });
      return {
        out: { symbol: inst.symbol, name: inst.name, assetType: inst.assetType, market: inst.market },
        degraded,
      };
    }
  }));

  return {
    instruments: results.map((r) => r.out),
    degraded: results.flatMap((r) => r.degraded),
  };
}

/**
 * 분석 입력 형태. 클라이언트(client/src/api/client.js)가 같은 규칙으로 되돌려 보낸다.
 * 규칙이 어긋나면 cacheKey가 달라져 확인 토큰이 428로 거부된다.
 */
export function toAnalysisInstruments(collected) {
  return collected
    .filter((i) => i.marketData || i.financial)
    .map(({ series, ...rest }) => rest);
}

/** 뉴스 관련도 점수용 이름. 종목이 여럿이면 특정 종목에 치우치지 않게 쓰지 않는다. */
export function relevanceName(analysisInstruments) {
  return analysisInstruments?.length === 1 ? analysisInstruments[0].marketData?.assetName : undefined;
}
