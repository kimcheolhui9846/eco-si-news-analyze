import { useState, useEffect } from 'react';
import { createApiClient } from './api/client.js';
import { messageForError } from './api/errors.js';

import LoginPage from './pages/LoginPage.jsx';
import SearchPage from './pages/SearchPage.jsx';
import ReviewPage from './pages/ReviewPage.jsx';
import CsReviewPage from './pages/CsReviewPage.jsx';
import ReportPage from './pages/ReportPage.jsx';
import ProgressIndicator from './components/ProgressIndicator.jsx';
import ErrorBanner from './components/ErrorBanner.jsx';

const defaultApi = createApiClient();

export default function App({ api = defaultApi }) {
  const [step, setStep] = useState('login');
  const [collected, setCollected] = useState(null);
  const [report, setReport] = useState(null);
  const [budget, setBudget] = useState(null);
  const [error, setError] = useState(null);
  // 검색 화면의 탭. 새 검색으로 돌아와도 고른 탭을 유지한다.
  const [mode, setMode] = useState('invest');

  // 검색 화면에 들어올 때마다 남은 예산을 새로 읽는다.
  useEffect(() => {
    if (step !== 'search') return;
    api.budget().then(setBudget).catch(() => setBudget(null));
  }, [step, api]);

  const search = async (form) => {
    setStep('collecting');
    setError(null);
    try {
      const result = await api.collect(form);
      setCollected(result);
      setStep('review');
    } catch (err) {
      const mapped = messageForError(err);
      setError({ message: mapped.message, requestId: err?.requestId });
      // nextStep이 없어도 수집 중 화면에 머물면 안 된다.
      setStep(mapped.nextStep ?? 'search');
    }
  };

  const approve = async (payload) => {
    setStep('analyzing');
    setError(null);
    try {
      // 받은 자료를 그대로 넘긴다. 한 글자만 바뀌어도 확인 토큰이 428로 거부된다.
      const result = await api.analyze(payload);
      setReport(result);
      setStep('report');
    } catch (err) {
      const mapped = messageForError(err);
      setError({ message: mapped.message, requestId: err?.requestId });
      // 상류 오류는 검토 화면으로 돌아가 재시도할 수 있게 한다.
      setStep(mapped.nextStep ?? 'review');
    }
  };

  const newSearch = () => {
    setCollected(null);
    setReport(null);
    setError(null);
    setStep('search');
  };

  if (step === 'login') {
    return <LoginPage api={api} onSuccess={() => { setError(null); setStep('search'); }} />;
  }

  return (
    <>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {step === 'collecting' && <ProgressIndicator stage="collecting" />}
      {step === 'analyzing' && <ProgressIndicator stage="analyzing" />}

      {step === 'search' && (
        <SearchPage budget={budget} onSearch={search} busy={false} mode={mode} onModeChange={setMode} />
      )}

      {/* analyzing일 때도 ReviewPage를 계속 렌더링한다.
          분석이 실패하면 그 자리에서 재시도할 수 있고 화면이 깜빡이지 않는다. */}
      {(step === 'review' || step === 'analyzing') && (collected?.mode === 'cs' ? (
        <CsReviewPage
          collected={collected}
          onApprove={approve}
          onBack={newSearch}
          busy={step === 'analyzing'}
        />
      ) : (
        <ReviewPage
          collected={collected}
          onApprove={approve}
          onBack={newSearch}
          busy={step === 'analyzing'}
        />
      ))}

      {step === 'report' && (
        <ReportPage
          report={report}
          instruments={collected?.instruments}
          research={collected?.research}
          experiments={collected?.experiments}
          collectedMeta={collected?.collected}
          onNewSearch={newSearch}
        />
      )}
    </>
  );
}
