/**
 * 비용은 소수점 4자리까지 살린다.
 * $0.02로 반올림하면 0.004와 0.024가 같아 보여 예산 감각이 무너진다.
 */
export function formatUsd(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '$?';
  if (n === 0) return '$0';
  return `$${n.toFixed(4)}`;
}

/** ISO 문자열을 한국 표기로. 파싱할 수 없으면 원본을 그대로 돌려준다. */
export function formatDateTime(iso) {
  if (!iso) return '';

  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return String(iso);

  const d = new Date(ms);
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatCount(n, unit) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
  return `${n}${unit}`;
}
