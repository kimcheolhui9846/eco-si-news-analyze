export default function ErrorBanner({ error, onDismiss }) {
  if (!error) return null;

  return (
    <div className="banner error-banner" role="alert">
      <span>{error.message}</span>
      {/* requestId는 서버 로그와 대조할 수 있는 유일한 단서다. */}
      {error.requestId && <code className="request-id">{error.requestId}</code>}
      {onDismiss && (
        <button type="button" className="link" onClick={onDismiss}>닫기</button>
      )}
    </div>
  );
}
