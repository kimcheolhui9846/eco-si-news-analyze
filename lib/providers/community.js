// ─── 커뮤니티 합치기 ───
//
// HN과 Lobsters를 한 목록으로 싣는다. 한쪽이 몫보다 적으면 다른 쪽 나머지로 채운다.

export const COMMUNITY_SHARE = Object.freeze({ hackernews: 6, lobsters: 4 });

export function mergeCommunity(hn = [], lobsters = [], max) {
  const head = [
    ...hn.slice(0, COMMUNITY_SHARE.hackernews),
    ...lobsters.slice(0, COMMUNITY_SHARE.lobsters),
  ];
  const rest = [
    ...hn.slice(COMMUNITY_SHARE.hackernews),
    ...lobsters.slice(COMMUNITY_SHARE.lobsters),
  ];
  const seen = new Set();
  const out = [];
  for (const item of [...head, ...rest]) {
    if (out.length >= max) break;
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}
