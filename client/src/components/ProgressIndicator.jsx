// 실제 호출은 collect 1회, analyze 1회다. 없는 단계를 흉내 내지 않는다.
const LABEL = {
  collecting: '자료를 수집하고 있습니다',
  analyzing: '분석 보고서를 작성하고 있습니다',
};

export default function ProgressIndicator({ stage }) {
  return (
    <div className="progress" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{LABEL[stage] ?? '처리 중입니다'}</span>
    </div>
  );
}
