import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDirectory, loadDirectory, normalizeUsName } from '../lib/providers/directory.js';

const rows = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')).rows;
const dir = () => createDirectory({ us: rows('directory-us.json'), kr: rows('directory-kr.json') });

test('bySymbol: 미국 티커로 CIK를 찾는다', () => {
  assert.deepEqual(dir().bySymbol('nvda'), {
    symbol: 'NVDA', name: 'NVIDIA CORP', assetType: 'stock', market: 'US', cik: '0001045810',
  });
});

test('bySymbol: 한국 종목코드는 접미사가 있든 없든 찾는다', () => {
  assert.equal(dir().bySymbol('005930.KS').corpCode, '00126380');
  assert.equal(dir().bySymbol('005930').corpCode, '00126380');
  assert.equal(dir().bySymbol('247540.KQ').name, '에코프로비엠');
});

test('bySymbol: 없으면 null', () => {
  assert.equal(dir().bySymbol('ZZZZ'), null);
  assert.equal(dir().bySymbol('999999.KS'), null);
});

test('findInQuery: 한국 회사명(3자 이상)을 찾는다', () => {
  assert.equal(dir().findInQuery('한화에어로스페이스 수주')?.corpCode, '00126566');
});

test('findInQuery: 2자 한국 회사명은 오탐 위험 때문에 보지 않는다', () => {
  assert.equal(dir().findInQuery('투자 대상 기업'), null);
});

test('findInQuery: 대문자 단어만 미국 티커로 본다', () => {
  assert.equal(dir().findInQuery('PLTR 실적')?.symbol, 'PLTR');
  assert.equal(dir().findInQuery('pltr 실적'), null);
});

test('findInQuery: 예약어(분야 키워드)는 티커로 보지 않는다', () => {
  assert.equal(dir().findInQuery('AI 전망', { reserved: new Set(['ai']) }), null);
});

test('findInQuery: 미국 영문 회사명으로 찾는다', () => {
  assert.equal(dir().findInQuery('palantir technologies 계약')?.symbol, 'PLTR');
  assert.equal(dir().findInQuery('General Motors 판매')?.symbol, 'GM');
});

test('normalizeUsName은 법인 접미사를 뗀다', () => {
  assert.equal(normalizeUsName('NVIDIA CORP'), 'nvidia');
  assert.equal(normalizeUsName('Apple Inc.'), 'apple');
  assert.equal(normalizeUsName('General Motors Co'), 'general motors');
});

test('loadDirectory: 파일이 없으면 경고하고 빈 디렉터리', () => {
  const warnings = [];
  const d = loadDirectory({ dataDir: mkdtempSync(join(tmpdir(), 'dir-')), log: { warn: (...a) => warnings.push(a) } });
  assert.deepEqual(d.size, { us: 0, kr: 0 });
  assert.equal(warnings.length, 2);
});

test('loadDirectory: 형식이 틀리면 경고하고 그 목록만 비운다', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dir-'));
  writeFileSync(join(dataDir, 'us-tickers.json'), JSON.stringify({ rows: [['NVDA', '0001045810', 'NVIDIA CORP']] }));
  writeFileSync(join(dataDir, 'kr-listed.json'), '{"rows": "깨짐"}');
  const warnings = [];
  const d = loadDirectory({ dataDir, log: { warn: (...a) => warnings.push(a) } });
  assert.deepEqual(d.size, { us: 1, kr: 0 });
  assert.equal(warnings.length, 1);
});
