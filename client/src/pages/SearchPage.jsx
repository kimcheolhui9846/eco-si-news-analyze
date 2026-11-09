import SearchForm from '../components/SearchForm.jsx';
import PaperSearchForm from '../components/PaperSearchForm.jsx';
import CsSearchForm from '../components/CsSearchForm.jsx';
import ModeTabs from '../components/ModeTabs.jsx';
import { formatUsd } from '../lib/format.js';

const HEADINGS = { invest: '무엇을 분석할까요?', cs: '어떤 기술 동향을 볼까요?', paper: '어떤 논문을 읽을까요?' };

export default function SearchPage({ budget, onSearch, busy, mode = 'invest', onModeChange }) {
  // 예산이 없으면 수집까지 한 뒤 막히는 것보다 여기서 막는 편이 낫다.
  const callsLeft = budget?.calls?.remaining ?? null;
  const costLeft = budget?.cost?.remainingUsd ?? null;
  const exhausted = callsLeft === 0 || costLeft === 0;

  return (
    <main className="page">
      <header className="page-head">
        <h1>{HEADINGS[mode] ?? HEADINGS.invest}</h1>
        {budget && (
          <p className="muted">
            오늘 {callsLeft}/{budget.calls.limit}회 남음 · 이번 달 {formatUsd(costLeft)} 남음
          </p>
        )}
      </header>

      {onModeChange && <ModeTabs mode={mode} onChange={onModeChange} />}

      {exhausted && (
        <div className="banner warn-banner">
          예산을 모두 사용했습니다. 한도가 초기화된 뒤 다시 시도해 주세요.
        </div>
      )}

      {mode === 'cs' && <CsSearchForm onSubmit={onSearch} disabled={busy || exhausted} />}
      {mode === 'paper' && <PaperSearchForm onSubmit={onSearch} disabled={busy || exhausted} />}
      {mode !== 'cs' && mode !== 'paper' && <SearchForm onSubmit={onSearch} disabled={busy || exhausted} />}
    </main>
  );
}
