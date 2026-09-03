import SearchForm from '../components/SearchForm.jsx';
import { formatUsd } from '../lib/format.js';

export default function SearchPage({ budget, onSearch, busy }) {
  // 예산이 없으면 수집까지 한 뒤 막히는 것보다 여기서 막는 편이 낫다.
  const callsLeft = budget?.calls?.remaining ?? null;
  const costLeft = budget?.cost?.remainingUsd ?? null;
  const exhausted = callsLeft === 0 || costLeft === 0;

  return (
    <main className="page">
      <header className="page-head">
        <h1>무엇을 분석할까요?</h1>
        {budget && (
          <p className="muted">
            오늘 {callsLeft}/{budget.calls.limit}회 남음 · 이번 달 {formatUsd(costLeft)} 남음
          </p>
        )}
      </header>

      {exhausted && (
        <div className="banner warn-banner">
          예산을 모두 사용했습니다. 한도가 초기화된 뒤 다시 시도해 주세요.
        </div>
      )}

      <SearchForm onSubmit={onSearch} disabled={busy || exhausted} />
    </main>
  );
}
