/**
 * 백엔드 에러 코드를 사용자 메시지와 다음 화면으로 옮긴다.
 *
 * nextStep이 null이면 현재 화면을 유지한다.
 * 상류 오류에 'review'를 주는 이유: 수집 결과와 확인 토큰이 아직 유효하므로
 * 무료인 수집을 다시 하지 않고 분석만 재시도할 수 있다.
 */
const TABLE = {
  FORBIDDEN: { message: '세션이 만료되었습니다. 다시 로그인해 주세요.', nextStep: 'login' },
  INVALID_CREDENTIALS: { message: '비밀번호가 올바르지 않습니다.', nextStep: null },
  RATE_LIMITED: { message: '요청이 많습니다. 잠시 후 다시 시도해 주세요.', nextStep: null },
  // message가 null인 항목은 서버 문구가 더 구체적이라 그것을 쓴다.
  BUDGET_EXCEEDED: { message: null, nextStep: 'search' },
  CONFIRMATION_REQUIRED: { message: '수집 결과가 변경되었습니다. 다시 수집해 주세요.', nextStep: 'search' },
  COLLECTION_FAILED: { message: null, nextStep: 'search' },
  INPUT_TOO_LARGE: { message: '요청이 너무 큽니다. 기사 수를 줄여 주세요.', nextStep: 'search' },
  PAYLOAD_TOO_LARGE: { message: '요청이 너무 큽니다.', nextStep: 'search' },
  INVALID_REQUEST: { message: null, nextStep: null },
  INSUFFICIENT_DATA: { message: '분석할 자료가 부족합니다.', nextStep: 'search' },
  TOO_MANY_CONCURRENT: { message: '동시 요청이 많습니다. 잠시 후 다시 시도해 주세요.', nextStep: null },
  UPSTREAM_TIMEOUT: { message: '분석 서버 응답이 지연되었습니다. 다시 시도해 주세요.', nextStep: 'review' },
  UPSTREAM_ERROR: { message: '분석 서버 호출에 실패했습니다. 다시 시도해 주세요.', nextStep: 'review' },
  CIRCUIT_OPEN: { message: '분석 서비스가 일시적으로 중단되었습니다. 잠시 후 다시 시도해 주세요.', nextStep: 'review' },
  PARSE_FAILED: { message: '분석 결과를 처리하지 못했습니다. 다시 시도해 주세요.', nextStep: 'review' },
  NETWORK_ERROR: { message: '서버에 연결하지 못했습니다. 연결을 확인해 주세요.', nextStep: null },
};

const FALLBACK = '오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';

export function messageForError(error) {
  if (!error) return { message: FALLBACK, nextStep: null, requestId: undefined };

  const entry = TABLE[error.code];
  if (!entry) {
    return { message: error.message || FALLBACK, nextStep: null, requestId: error.requestId };
  }

  return {
    message: entry.message ?? (error.message || FALLBACK),
    nextStep: entry.nextStep,
    requestId: error.requestId,
  };
}
