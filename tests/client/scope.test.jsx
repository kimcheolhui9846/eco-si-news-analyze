import 'global-jsdom/register';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import ScopePicker from '../../client/src/components/ScopePicker.jsx';
import SearchForm from '../../client/src/components/SearchForm.jsx';

afterEach(cleanup);

test('다섯 개의 범위 체크박스를 보여준다', () => {
  render(<ScopePicker value={['news', 'market']} onChange={() => {}} />);
  assert.equal(screen.getAllByRole('checkbox').length, 5);
});

test('news 체크박스는 켜져 있고 끌 수 없다', () => {
  // 뉴스가 없으면 분석이 성립하지 않는다. 화면과 실제 동작이 어긋나면 안 된다.
  render(<ScopePicker value={['news', 'market']} onChange={() => {}} />);
  const news = screen.getByLabelText(/뉴스/);
  assert.equal(news.checked, true);
  assert.equal(news.disabled, true);
});

test('체크를 켜면 onChange가 그 값을 포함해 불린다', () => {
  let received = null;
  render(<ScopePicker value={['news', 'market']} onChange={(v) => { received = v; }} />);
  fireEvent.click(screen.getByLabelText(/논문/));
  assert.ok(received.includes('research'));
  assert.ok(received.includes('news'));
});

test('체크를 끄면 그 값이 빠진다', () => {
  let received = null;
  render(<ScopePicker value={['news', 'market', 'research']} onChange={(v) => { received = v; }} />);
  fireEvent.click(screen.getByLabelText(/논문/));
  assert.ok(!received.includes('research'));
});

test('각 항목에 한 줄 설명이 붙는다', () => {
  render(<ScopePicker value={['news']} onChange={() => {}} />);
  assert.ok(screen.getByText(/미국 상장사만/));
  assert.ok(screen.getByText(/표본 수·연구 단계는 제공되지 않음/));
  assert.ok(screen.getByText(/ClinicalTrials\.gov/));
});

test('선택이 비용에 영향을 준다는 안내가 있다', () => {
  render(<ScopePicker value={['news']} onChange={() => {}} />);
  // <p>와 그 안의 <strong>이 함께 걸리지 않도록 정확히 일치시킨다.
  assert.ok(screen.getByText('예상 비용'));
});

test('검색 폼이 include를 함께 제출한다', () => {
  let submitted = null;
  render(<SearchForm onSubmit={(form) => { submitted = form; }} />);

  fireEvent.change(screen.getByLabelText('검색어'), { target: { value: '엔비디아' } });
  fireEvent.click(screen.getByLabelText(/논문/));
  fireEvent.click(screen.getByRole('button', { name: '자료 수집' }));

  assert.ok(Array.isArray(submitted.include));
  assert.ok(submitted.include.includes('research'));
  assert.ok(submitted.include.includes('news'));
});
