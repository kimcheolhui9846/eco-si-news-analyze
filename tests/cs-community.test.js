import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCommunity, COMMUNITY_SHARE } from '../lib/providers/community.js';

const item = (site, i) => ({
  site, title: `${site} ${i}`, url: `https://example.com/${site}/${i}`,
  discussionUrl: `https://d.example.com/${site}/${i}`, points: 1, numComments: 0,
  publishedAt: '2026-11-01T00:00:00.000Z', text: '',
});
const many = (site, n) => Array.from({ length: n }, (_, i) => item(site, i + 1));

test('기본 몫은 HN 6, Lobsters 4', () => {
  assert.deepEqual(COMMUNITY_SHARE, { hackernews: 6, lobsters: 4 });
  const merged = mergeCommunity(many('hackernews', 10), many('lobsters', 10), 10);
  assert.deepEqual(merged.map((m) => m.title), [
    'hackernews 1', 'hackernews 2', 'hackernews 3', 'hackernews 4', 'hackernews 5', 'hackernews 6',
    'lobsters 1', 'lobsters 2', 'lobsters 3', 'lobsters 4',
  ]);
});

test('한쪽이 모자라면 다른 쪽 나머지로 채운다', () => {
  assert.deepEqual(
    mergeCommunity(many('hackernews', 10), many('lobsters', 1), 10).map((m) => m.title),
    [...many('hackernews', 6).map((m) => m.title), 'lobsters 1', 'hackernews 7', 'hackernews 8', 'hackernews 9'],
  );
  assert.equal(mergeCommunity([], many('lobsters', 10), 10).length, 10);
});

test('같은 url은 먼저 온 것만 남긴다', () => {
  const dup = { ...item('lobsters', 1), url: 'https://example.com/hackernews/1' };
  const merged = mergeCommunity(many('hackernews', 2), [dup, item('lobsters', 2)], 10);
  assert.deepEqual(merged.map((m) => m.title), ['hackernews 1', 'hackernews 2', 'lobsters 2']);
});
