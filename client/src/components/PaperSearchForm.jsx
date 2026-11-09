import { useState } from 'react';
import { arxivIdFrom } from '../lib/arxiv.js';

export default function PaperSearchForm({ onSubmit, disabled }) {
  const [arxiv, setArxiv] = useState('');
  const valid = Boolean(arxivIdFrom(arxiv));

  return (
    <form
      className="card search-form"
      onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit({ mode: 'paper', arxiv: arxiv.trim() }); }}
    >
      <label htmlFor="paper-arxiv">arXiv ID 또는 링크</label>
      <input id="paper-arxiv" value={arxiv} required placeholder="예: 2401.04088"
        onChange={(e) => setArxiv(e.target.value)} />
      <p className="muted small">
        arXiv HTML 판이 있는 논문만 분석할 수 있습니다. 참고문헌과 부록은 빼고 읽습니다.
      </p>
      {arxiv.trim() && !valid && (
        <p className="muted small" role="alert">arXiv ID(예: 2401.04088)나 arxiv.org 링크를 넣어 주세요.</p>
      )}
      <button type="submit" className="primary" disabled={disabled || !valid}>본문 가져오기</button>
    </form>
  );
}
