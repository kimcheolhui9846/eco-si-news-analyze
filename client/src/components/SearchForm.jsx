import { useState } from 'react';

const RANGES = [
  ['5d', '5일'], ['1mo', '1개월'], ['3mo', '3개월'], ['6mo', '6개월'], ['1y', '1년'],
];

export default function SearchForm({ onSubmit, disabled }) {
  const [form, setForm] = useState({
    query: '', symbol: '', assetType: 'stock', lang: 'ko', range: '1mo', maxNews: 10,
  });

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <form
      className="card search-form"
      onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}
    >
      <label htmlFor="query">검색어</label>
      <input id="query" value={form.query} onChange={set('query')} required
        placeholder="예: 엔비디아 AI 반도체" />

      <label htmlFor="symbol">종목 코드 (선택)</label>
      <input id="symbol" value={form.symbol} onChange={set('symbol')}
        placeholder="비우면 자동으로 찾습니다 (예: NVDA, 005930.KS)" />

      <fieldset>
        <legend>자산 종류</legend>
        {[['stock', '주식'], ['crypto', '코인']].map(([v, label]) => (
          <label key={v} className="radio">
            <input type="radio" name="assetType" value={v}
              checked={form.assetType === v} onChange={set('assetType')} />
            {label}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>뉴스 언어</legend>
        {[['ko', '한국어'], ['en', 'English']].map(([v, label]) => (
          <label key={v} className="radio">
            <input type="radio" name="lang" value={v}
              checked={form.lang === v} onChange={set('lang')} />
            {label}
          </label>
        ))}
      </fieldset>

      <label htmlFor="range">분석 기간</label>
      <select id="range" value={form.range} onChange={set('range')}>
        {RANGES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>

      <label htmlFor="maxNews">최대 기사 수: {form.maxNews}</label>
      <input id="maxNews" type="range" min="1" max="20" value={form.maxNews}
        onChange={(e) => setForm({ ...form, maxNews: Number(e.target.value) })} />

      <button type="submit" className="primary" disabled={disabled || !form.query}>
        자료 수집
      </button>
    </form>
  );
}
