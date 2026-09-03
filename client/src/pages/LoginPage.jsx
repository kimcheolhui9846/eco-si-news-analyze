import { useState } from 'react';
import { messageForError } from '../api/errors.js';
import ErrorBanner from '../components/ErrorBanner.jsx';

export default function LoginPage({ api, onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      const mapped = messageForError(err);
      setError({ message: mapped.message, requestId: err?.requestId });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="centered">
      <form className="card login" onSubmit={submit}>
        <h1>통합 분석 플랫폼</h1>
        <p className="muted">뉴스와 시장 데이터를 모아 분석합니다.</p>

        <ErrorBanner error={error} />

        <label htmlFor="password">비밀번호</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />

        <button type="submit" className="primary" disabled={busy || !password}>
          {busy ? '확인 중…' : '로그인'}
        </button>
      </form>
    </main>
  );
}
