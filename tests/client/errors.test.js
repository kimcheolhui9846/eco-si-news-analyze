import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageForError } from '../../client/src/api/errors.js';

test('세션 만료는 로그인 화면으로 보낸다', () => {
  const r = messageForError({ code: 'FORBIDDEN', message: '유효하지 않거나 만료된 세션입니다.' });

  assert.equal(r.nextStep, 'login');
  assert.match(r.message, /다시 로그인/);
});

test('비밀번호 오류는 화면을 옮기지 않는다', () => {
  const r = messageForError({ code: 'INVALID_CREDENTIALS' });

  assert.equal(r.nextStep, null);
  assert.match(r.message, /비밀번호/);
});

test('예산 초과는 서버 메시지를 그대로 쓴다', () => {
  const r = messageForError({
    code: 'BUDGET_EXCEEDED',
    message: '오늘 사용할 수 있는 분석 횟수를 모두 썼습니다.',
  });

  assert.equal(r.message, '오늘 사용할 수 있는 분석 횟수를 모두 썼습니다.');
  assert.equal(r.nextStep, 'search');
});

test('상류 오류는 검토 화면을 유지해 재시도할 수 있게 한다', () => {
  // 수집 결과와 확인 토큰이 아직 유효하므로 무료인 수집을 다시 할 이유가 없다.
  for (const code of ['UPSTREAM_TIMEOUT', 'UPSTREAM_ERROR', 'CIRCUIT_OPEN', 'PARSE_FAILED']) {
    assert.equal(messageForError({ code }).nextStep, 'review', `${code}가 검토 화면을 벗어났다`);
  }
});

test('확인 토큰 불일치는 검색 화면으로 되돌린다', () => {
  const r = messageForError({ code: 'CONFIRMATION_REQUIRED' });

  assert.equal(r.nextStep, 'search');
  assert.match(r.message, /다시 수집/);
});

test('수집 실패는 검색 화면을 유지한다', () => {
  const r = messageForError({
    code: 'COLLECTION_FAILED',
    message: '분석할 뉴스를 수집하지 못했습니다.',
  });

  assert.equal(r.nextStep, 'search');
});

test('requestId를 그대로 전달한다', () => {
  // 서버 로그와 대조할 수 있는 유일한 단서다.
  const r = messageForError({ code: 'INTERNAL', requestId: 'rq-42' });
  assert.equal(r.requestId, 'rq-42');
});

test('모르는 코드도 메시지를 준다', () => {
  const r = messageForError({ code: 'WEIRD_NEW_CODE' });

  assert.ok(r.message.length > 0);
  assert.equal(r.nextStep, null);
});

test('error가 없어도 죽지 않는다', () => {
  assert.ok(messageForError(null).message.length > 0);
  assert.ok(messageForError(undefined).message.length > 0);
});
