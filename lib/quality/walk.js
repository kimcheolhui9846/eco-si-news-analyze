// ─── 품질 검사 공용 도우미 ───

/** 문자열 값마다 fn(str, path)를 적용한 새 값을 돌려준다. 입력은 바꾸지 않는다. */
export function mapStrings(node, fn, path = '') {
  if (typeof node === 'string') return fn(node, path);
  if (Array.isArray(node)) return node.map((v, i) => mapStrings(v, fn, `${path}[${i}]`));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) =>
      [k, mapStrings(v, fn, path ? `${path}.${k}` : k)]));
  }
  return node;
}

export const issue = (check, severity, message, path) => ({ check, severity, message, path });
