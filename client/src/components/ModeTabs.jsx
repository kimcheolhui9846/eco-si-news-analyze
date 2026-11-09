const MODES = [['invest', '투자'], ['cs', 'CS 동향'], ['paper', '논문 전문']];

export default function ModeTabs({ mode, onChange }) {
  return (
    <div className="mode-tabs" role="tablist" aria-label="분석 종류">
      {MODES.map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={mode === value}
          className={mode === value ? 'tab active' : 'tab'}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
