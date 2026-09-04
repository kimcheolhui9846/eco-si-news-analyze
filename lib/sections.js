// ─── 프롬프트 구획 조립 ───
//
// escapeDelimiters를 import하지 않고 인자로 받는다. lib/prompt.js가 이 파일을
// 부르므로 서로 import하면 순환이 된다.

export const FINANCIAL_SOURCE_ID = 'F1';

/** 뉴스는 S, 논문은 P, 실험은 T. 인용만 봐도 자료의 종류를 알 수 있다. */
export const assignResearchIds = (items) =>
  items.map((item, i) => ({ ...item, sourceId: `P${i + 1}` }));

export const assignExperimentIds = (items) =>
  items.map((item, i) => ({ ...item, sourceId: `T${i + 1}` }));

const EMPTY_FINANCIAL = '자료 부족 — 이번 요청에 재무지표가 포함되지 않았습니다.';
const EMPTY_RESEARCH = '자료 부족 — 이번 요청에 논문 자료가 포함되지 않았습니다.';
const EMPTY_EXPERIMENT = '자료 부족 — 이번 요청에 실험 자료가 포함되지 않았습니다.';

const PEER_REVIEW_LABEL = {
  'peer-reviewed': '동료 심사 완료',
  preprint: '프리프린트 (동료 심사를 거치지 않음)',
  unknown: '검증 여부 확인 불가',
};

/** 연도만 아는 발표일을 일자처럼 보이게 하지 않는다. */
function publishedLabel(item) {
  if (!item.publishedAt) return '확인 불가';
  const iso = String(item.publishedAt).slice(0, 10);
  if (item.datePrecision === 'year') return `${iso.slice(0, 4)} (연도만 확인됨)`;
  if (item.datePrecision === 'month') return `${iso.slice(0, 7)} (월까지만 확인됨)`;
  return iso;
}

export function formatFinancialSection(financial, esc) {
  if (!financial || financial.metrics.length === 0) return EMPTY_FINANCIAL;

  const lines = [
    `- 대상: ${esc(financial.entityName ?? financial.symbol ?? '미상')} (SEC EDGAR, 출처 ID: ${FINANCIAL_SOURCE_ID})`,
  ];

  for (const m of financial.metrics) {
    // 기준 기간을 값과 붙여 쓴다. 떼어 놓으면 어느 분기 숫자인지 잃어버린다.
    const basis = [
      m.fiscalYear ? `FY${m.fiscalYear}${m.fiscalPeriod ? ` ${m.fiscalPeriod}` : ''}` : null,
      m.form,
      m.filed ? `${m.filed} 제출` : null,
    ].filter(Boolean).join(', ');
    lines.push(`- ${esc(m.label)} (${esc(m.concept)}): ${Number(m.value).toLocaleString('en-US')} ${esc(m.unit)} [${basis}]`);
  }

  for (const d of financial.derived) {
    lines.push(`- ${esc(d.label)} (계산값): ${d.value}${esc(d.unit)} = ${esc(d.formula)} [${esc(d.basis)}]`);
  }

  for (const d of financial.degraded) {
    lines.push(`- ${esc(d.concept)}: 자료 부족 — ${esc(d.reason)}`);
  }

  if (financial.filingUrl) lines.push(`- 제출 서류: ${esc(financial.filingUrl)}`);
  return lines.join('\n');
}

export function formatResearchSection(items, esc) {
  if (!items || items.length === 0) return EMPTY_RESEARCH;

  return items.map((item, i) => [
    `논문 ${i + 1}`,
    `- 출처 ID: ${item.sourceId}`,
    `- 제목: ${esc(item.title)}`,
    `- 출처: ${esc(item.sourceName)}${item.venue ? ` · ${esc(item.venue)}` : ''}`,
    `- 저자: ${item.authors.length > 0 ? esc(item.authors.join(', ')) : '확인 불가'}`,
    `- 발표: ${publishedLabel(item)}`,
    `- 검증: ${PEER_REVIEW_LABEL[item.peerReviewed] ?? PEER_REVIEW_LABEL.unknown}`,
    `- DOI: ${item.doi ? esc(item.doi) : '없음'}`,
    `- URL: ${item.url ? esc(item.url) : '없음'}`,
    `- 초록: ${item.abstract ? esc(item.abstract) : '자료 부족 — 초록이 제공되지 않았습니다.'}`,
  ].join('\n')).join('\n\n');
}

export function formatExperimentSection(items, esc) {
  if (!items || items.length === 0) return EMPTY_EXPERIMENT;

  return items.map((item, i) => {
    // 목표치를 실제 등록 수처럼 적으면 "300명을 대상으로 한 연구"가 된다.
    const enrollment = item.enrollmentCount === null || item.enrollmentCount === undefined
      ? '자료 부족'
      : `${item.enrollmentCount}명 (${item.enrollmentType === 'ESTIMATED' ? '모집 목표치, 실제 등록 수 아님' : '실제 등록'})`;

    return [
      `실험 ${i + 1}`,
      `- 출처 ID: ${item.sourceId}`,
      `- 실험명: ${esc(item.title)}`,
      `- 등록번호: ${esc(item.nctId)}`,
      `- 수행기관: ${item.organization ? esc(item.organization) : '확인 불가'}`,
      `- 연구 단계: ${item.phase ? esc(item.phase) : '자료 부족'}`,
      `- 표본 수: ${enrollment}`,
      `- 대상: ${item.conditions.length > 0 ? esc(item.conditions.join(', ')) : '자료 부족'}`,
      `- 시작일: ${item.startDate ? esc(item.startDate) : '자료 부족'}`,
      `- 상태: ${item.status ? esc(item.status) : '확인 불가'} · ${item.hasResults ? '결과 등록됨' : '결과 등록 안 됨'}`,
      `- URL: ${item.url ? esc(item.url) : '없음'}`,
    ].join('\n');
  }).join('\n\n');
}
