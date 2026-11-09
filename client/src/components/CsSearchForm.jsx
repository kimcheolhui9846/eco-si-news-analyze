import { useState } from 'react';

import ScopePicker, { CS_SCOPES } from './ScopePicker.jsx';

export default function CsSearchForm({ onSubmit, disabled }) {
  const [form, setForm] = useState({
    mode: 'cs', query: '', lang: 'ko', include: CS_SCOPES.map((s) => s.value),
  });

  return (
    <form
      className="card search-form"
      onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}
    >
      <label htmlFor="cs-query">검색어</label>
      <input id="cs-query" value={form.query} required
        placeholder="예: retrieval augmented generation"
        onChange={(e) => setForm({ ...form, query: e.target.value })} />
      <p className="muted small">
        논문·커뮤니티·저장소·해외 블로그는 영어로 찾아야 결과가 잘 나옵니다.
      </p>

      <fieldset>
        <legend>뉴스 언어</legend>
        {[['ko', '한국어'], ['en', 'English']].map(([v, label]) => (
          <label key={v} className="radio">
            <input type="radio" name="cs-lang" value={v}
              checked={form.lang === v} onChange={() => setForm({ ...form, lang: v })} />
            {label}
          </label>
        ))}
      </fieldset>

      <ScopePicker
        scopes={CS_SCOPES}
        value={form.include}
        onChange={(include) => setForm({ ...form, include })}
        disabled={disabled}
      />

      <button type="submit" className="primary" disabled={disabled || !form.query}>
        자료 수집
      </button>
    </form>
  );
}
