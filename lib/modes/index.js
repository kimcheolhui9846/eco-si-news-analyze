import { ApiError } from '../errors.js';
import { investProfile } from './invest.js';

// ─── 분석 모드 선택 ───

/** 모드 이름 → 프로필. Map이어야 'constructor' 같은 프로토타입 키가 프로필로 잡히지 않는다. */
export const PROFILES = new Map([
  ['invest', investProfile],
]);

/** mode가 없으면 투자 모드다. 기존 클라이언트와 테스트가 그대로 동작한다. */
export function getProfile(mode) {
  const profile = PROFILES.get(mode === undefined ? 'invest' : mode);
  if (!profile) throw new ApiError(400, 'INVALID_REQUEST', '지원하지 않는 분석 모드입니다.');
  return profile;
}

/**
 * 요청 본문에서 mode를 떼어 낸다. 프로필 스키마는 strictObject라
 * mode가 남아 있으면 모르는 키로 거부된다.
 */
export function splitMode(body) {
  if (body && typeof body === 'object' && !Array.isArray(body) && Object.hasOwn(body, 'mode')) {
    const { mode, ...rest } = body;
    return { mode, body: rest };
  }
  return { mode: undefined, body };
}
