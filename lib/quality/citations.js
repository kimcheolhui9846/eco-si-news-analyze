import { mapStrings, issue } from './walk.js';

// ─── 출처 인용 검사 ───
//
// 출처 목록은 서버가 만든다. 모델이 쓴 출처 ID·제목·날짜는 그 목록과 대조해야 한다.

export const UNKNOWN_CITATION = '출처 미확인';

const BRACKET = /\[([^[\]\n]{1,80})\]/g;
const ID_TOKEN = /\b[SPTFM]\d{1,3}\b/g;
const ID_SHAPE = /^[SPTFM]\d{1,3}$/;
const FIELD_LABEL = { title: '제목', source: '출처', publishedAt: '작성일' };
const BRIEF_FIELDS = Object.keys(FIELD_LABEL);

/** 모델이 쓴 ID를 메시지에 넣기 전에 형태를 확인한다. 원문이 메시지로 새지 않게 한다. */
const safeId = (id) => (typeof id === 'string' && ID_SHAPE.test(id) ? id : '형식 오류');

/** [..] 묶음 안의 출처 ID 중 없는 것만 바꾼다. */
export function replaceUnknownIds(text, known) {
  let changed = false;
  const out = text.replace(BRACKET, (_whole, inner) => {
    const next = inner.replace(ID_TOKEN, (id) => {
      if (known.has(id)) return id;
      changed = true;
      return UNKNOWN_CITATION;
    });
    return `[${next}]`;
  });
  return { text: out, changed };
}

function checkBriefing(list, sources, issues) {
  const seen = new Set();
  const kept = [];
  list.forEach((item, i) => {
    const path = `newsBriefing[${i}]`;
    const id = item?.sourceId;
    if (!sources.has(id)) {
      issues.push(issue('citations', 'fixed',
        `브리핑 항목의 출처 ID(${safeId(id)})가 제공된 출처에 없어 항목을 제거했습니다.`, `${path}.sourceId`));
      return;
    }
    if (seen.has(id)) {
      issues.push(issue('citations', 'fixed', `같은 출처(${id})의 브리핑이 중복되어 첫 항목만 남겼습니다.`, path));
      return;
    }
    seen.add(id);
    const original = sources.get(id);
    const drifted = BRIEF_FIELDS.filter((f) => String(item[f] ?? '') !== String(original[f] ?? ''));
    const fixed = { ...item };
    for (const f of drifted) fixed[f] = String(original[f] ?? '');
    if (drifted.length > 0) {
      issues.push(issue('citations', 'fixed',
        `브리핑 ${id}의 ${drifted.map((f) => FIELD_LABEL[f]).join('·')}을(를) 원본 출처 값으로 바로잡았습니다.`, path));
    }
    kept.push(fixed);
  });
  if (kept.length === 0 && list.length > 0) {
    issues.push(issue('citations', 'warning', '브리핑의 출처가 모두 확인되지 않아 브리핑을 비웠습니다.', 'newsBriefing'));
  }
  return kept;
}

export function checkCitations(analysis, { sources }) {
  const issues = [];
  let next = analysis;
  if (Array.isArray(analysis.newsBriefing)) {
    next = { ...analysis, newsBriefing: checkBriefing(analysis.newsBriefing, sources, issues) };
  }
  const known = new Set(sources.keys());
  next = mapStrings(next, (text, path) => {
    const { text: out, changed } = replaceUnknownIds(text, known);
    if (changed) {
      issues.push(issue('citations', 'fixed', '제공되지 않은 출처 ID 인용을 "출처 미확인"으로 바꿨습니다.', path));
    }
    return out;
  });
  return { analysis: next, issues };
}
