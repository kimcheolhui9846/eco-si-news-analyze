import { createMatcher } from './match.js';

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
  엔비디아: { symbol: 'NVDA', assetType: 'stock', name: '엔비디아' },
  nvidia: { symbol: 'NVDA', assetType: 'stock', name: 'NVIDIA' },
  애플: { symbol: 'AAPL', assetType: 'stock', name: '애플' },
  apple: { symbol: 'AAPL', assetType: 'stock', name: 'Apple' },
  마이크로소프트: { symbol: 'MSFT', assetType: 'stock', name: '마이크로소프트' },
  microsoft: { symbol: 'MSFT', assetType: 'stock', name: 'Microsoft' },
  테슬라: { symbol: 'TSLA', assetType: 'stock', name: '테슬라' },
  tesla: { symbol: 'TSLA', assetType: 'stock', name: 'Tesla' },
  구글: { symbol: 'GOOGL', assetType: 'stock', name: '구글' },
  알파벳: { symbol: 'GOOGL', assetType: 'stock', name: '알파벳' },
  아마존: { symbol: 'AMZN', assetType: 'stock', name: '아마존' },
  메타: { symbol: 'META', assetType: 'stock', name: '메타' },
  amd: { symbol: 'AMD', assetType: 'stock', name: 'AMD' },
  인텔: { symbol: 'INTC', assetType: 'stock', name: '인텔' },
  브로드컴: { symbol: 'AVGO', assetType: 'stock', name: '브로드컴' },
  tsmc: { symbol: 'TSM', assetType: 'stock', name: 'TSMC' },
  // SEC 이름은 "Palantir Technologies"라 "Palantir"만으로는 디렉터리에서 찾지 못한다.
  팔란티어: { symbol: 'PLTR', assetType: 'stock', name: '팔란티어' },
  palantir: { symbol: 'PLTR', assetType: 'stock', name: 'Palantir' },

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

const findAliasKey = createMatcher(Object.keys(SYMBOL_ALIASES));

/**
 * 검색어에서 알려진 회사명을 찾는다.
 * 단어 단위로 보며 조사만 꼬리로 허용한다("삼성전자의"는 일치, "메타버스"는 불일치).
 */
export function lookupAlias(query) {
  const key = findAliasKey(query);
  return key ? SYMBOL_ALIASES[key] : null;
}

