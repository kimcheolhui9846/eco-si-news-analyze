const DEFAULT = '본 분석은 제공된 자료를 기반으로 한 정보 제공 목적의 분석이며, '
  + '특정 금융상품의 매수·매도 또는 투자 수익을 보장하는 투자 권유가 아닙니다.';

export default function Disclaimer({ text }) {
  return <footer className="disclaimer">{text || DEFAULT}</footer>;
}
