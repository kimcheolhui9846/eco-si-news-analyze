// ─── 구조화 출력(JSON Schema strict) 도우미 ───
// strict 모드는 모든 속성이 required이고 additionalProperties가 false여야 한다.

export const strObj = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
export const str = () => ({ type: 'string' });
export const strArray = () => ({ type: 'array', items: str() });
