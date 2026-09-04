/**
 * 한글 회사명 → 티커 사전.
 *
 * Yahoo 검색이 한글 질의에 400을 반환하는 것이 확인됐으므로
 * 한국어 이름은 API로 해석할 수 없다. 사전이 유일한 방법이다.
 *
 * 키는 소문자로 비교한다. 값의 name은 사용자에게 보여줄 표시 이름이다.
 */
export const SYMBOL_ALIASES = {
  // 미국 주식
  엔비디아: { symbol: 'NVDA', assetType: 'stock', name: '엔비디아', cik: '0001045810' },
  nvidia: { symbol: 'NVDA', assetType: 'stock', name: 'NVIDIA', cik: '0001045810' },
  애플: { symbol: 'AAPL', assetType: 'stock', name: '애플', cik: '0000320193' },
  apple: { symbol: 'AAPL', assetType: 'stock', name: 'Apple', cik: '0000320193' },
  마이크로소프트: { symbol: 'MSFT', assetType: 'stock', name: '마이크로소프트', cik: '0000789019' },
  microsoft: { symbol: 'MSFT', assetType: 'stock', name: 'Microsoft', cik: '0000789019' },
  테슬라: { symbol: 'TSLA', assetType: 'stock', name: '테슬라', cik: '0001318605' },
  tesla: { symbol: 'TSLA', assetType: 'stock', name: 'Tesla', cik: '0001318605' },
  구글: { symbol: 'GOOGL', assetType: 'stock', name: '구글', cik: '0001652044' },
  알파벳: { symbol: 'GOOGL', assetType: 'stock', name: '알파벳', cik: '0001652044' },
  아마존: { symbol: 'AMZN', assetType: 'stock', name: '아마존', cik: '0001018724' },
  메타: { symbol: 'META', assetType: 'stock', name: '메타', cik: '0001326801' },
  amd: { symbol: 'AMD', assetType: 'stock', name: 'AMD', cik: '0000002488' },
  인텔: { symbol: 'INTC', assetType: 'stock', name: '인텔', cik: '0000050863' },
  브로드컴: { symbol: 'AVGO', assetType: 'stock', name: '브로드컴', cik: '0001730168' },
  tsmc: { symbol: 'TSM', assetType: 'stock', name: 'TSMC', cik: '0001046179' },

  // 한국 주식
  삼성전자: { symbol: '005930.KS', assetType: 'stock', name: '삼성전자' },
  sk하이닉스: { symbol: '000660.KS', assetType: 'stock', name: 'SK하이닉스' },
  하이닉스: { symbol: '000660.KS', assetType: 'stock', name: 'SK하이닉스' },
  lg에너지솔루션: { symbol: '373220.KS', assetType: 'stock', name: 'LG에너지솔루션' },
  현대차: { symbol: '005380.KS', assetType: 'stock', name: '현대자동차' },
  기아: { symbol: '000270.KS', assetType: 'stock', name: '기아' },
  네이버: { symbol: '035420.KS', assetType: 'stock', name: 'NAVER' },
  카카오: { symbol: '035720.KS', assetType: 'stock', name: '카카오' },
  셀트리온: { symbol: '068270.KS', assetType: 'stock', name: '셀트리온' },
  삼성바이오로직스: { symbol: '207940.KS', assetType: 'stock', name: '삼성바이오로직스' },
  posco홀딩스: { symbol: '005490.KS', assetType: 'stock', name: 'POSCO홀딩스' },
  포스코: { symbol: '005490.KS', assetType: 'stock', name: 'POSCO홀딩스' },

  // 코인
  비트코인: { symbol: 'bitcoin', assetType: 'crypto', name: '비트코인' },
  bitcoin: { symbol: 'bitcoin', assetType: 'crypto', name: 'Bitcoin' },
  btc: { symbol: 'bitcoin', assetType: 'crypto', name: 'Bitcoin' },
  이더리움: { symbol: 'ethereum', assetType: 'crypto', name: '이더리움' },
  ethereum: { symbol: 'ethereum', assetType: 'crypto', name: 'Ethereum' },
  eth: { symbol: 'ethereum', assetType: 'crypto', name: 'Ethereum' },
  솔라나: { symbol: 'solana', assetType: 'crypto', name: '솔라나' },
  solana: { symbol: 'solana', assetType: 'crypto', name: 'Solana' },
  리플: { symbol: 'ripple', assetType: 'crypto', name: '리플' },
};

// 긴 이름부터 확인한다. "삼성바이오로직스"가 "삼성전자"보다 먼저 걸려야 한다.
const KEYS_BY_LENGTH = Object.keys(SYMBOL_ALIASES).sort((a, b) => b.length - a.length);

/**
 * 검색어에서 알려진 회사명을 찾는다.
 * 사용자는 "엔비디아 AI 반도체 실적"처럼 문장으로 입력하므로 부분 일치를 본다.
 */
export function lookupAlias(query) {
  const needle = String(query).toLowerCase().trim();
  if (!needle) return null;

  for (const key of KEYS_BY_LENGTH) {
    if (needle.includes(key)) return SYMBOL_ALIASES[key];
  }
  return null;
}

/**
 * 티커로 CIK를 찾는다.
 *
 * 사용자가 symbol을 직접 넣으면 별칭 조회를 거치지 않아 cik가 없다.
 * 그때도 재무를 가져오려면 이 경로가 필요하다.
 */
export function cikForSymbol(symbol) {
  if (!symbol) return null;
  const needle = String(symbol).toUpperCase();
  for (const entry of Object.values(SYMBOL_ALIASES)) {
    if (entry.cik && entry.symbol.toUpperCase() === needle) return entry.cik;
  }
  return null;
}
