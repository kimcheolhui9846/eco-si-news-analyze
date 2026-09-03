import { createHash } from 'node:crypto';

// ─── 자료 정규화 및 출처 ID 부여 ───

/**
 * 제어문자를 제거한다. 줄바꿈(\n)과 탭(\t)은 본문 구조라서 남긴다.
 * ANSI 이스케이프 시퀀스는 로그·터미널 출력을 오염시킬 수 있어 함께 제거한다.
 */
export function stripControlChars(text) {
  return String(text)
    // ANSI 이스케이프 시퀀스 (ESC [ ... 알파벳)
    .replace(/\u001B\[[0-9;]*[A-Za-z]/g, '')
    // 제어문자. 줄바꿈(000A)과 탭(0009)은 본문 구조라 남긴다.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

/** 연속 공백을 하나로 줄인다. 줄바꿈은 최대 2개까지 남겨 문단 구분을 보존한다. */
const collapseWhitespace = (text) =>
  text.replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

/** 중복 판정용 키. 공백·구두점·대소문자 차이를 무시한다. */
const dedupeKey = (title) =>
  createHash('sha256')
    .update(title.toLowerCase().replace(/[\s\p{P}]/gu, ''))
    .digest('hex');

/** assetName이 제목·본문에 몇 번 등장하는지 센다. 제목 가중치 3배. */
function scoreRelevance(item, assetName) {
  if (!assetName) return 0;
  const needle = assetName.toLowerCase();
  if (!needle) return 0;

  const count = (haystack) => {
    const lower = haystack.toLowerCase();
    let n = 0;
    let idx = lower.indexOf(needle);
    while (idx !== -1) { n += 1; idx = lower.indexOf(needle, idx + needle.length); }
    return n;
  };

  return count(item.title) * 3 + count(item.content);
}

export function normalizeNewsList(newsList, { assetName } = {}) {
  const cleaned = newsList.map((raw) => ({
    title: collapseWhitespace(stripControlChars(raw.title)),
    content: collapseWhitespace(stripControlChars(raw.content)),
    source: collapseWhitespace(stripControlChars(raw.source)),
    url: raw.url,
    publishedAt: new Date(raw.publishedAt).toISOString(),
  }));

  // 오래된 것부터 훑으면서, 같은 제목·URL이 다시 나오면 버린다.
  // 먼저 보도한 쪽을 남기기 위해 오름차순으로 순회한다.
  const ascending = [...cleaned].sort(
    (a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt),
  );
  const seenTitles = new Set();
  const seenUrls = new Set();
  const unique = [];
  let duplicatesRemoved = 0;

  for (const item of ascending) {
    const titleKey = dedupeKey(item.title);
    if (seenTitles.has(titleKey) || seenUrls.has(item.url)) {
      duplicatesRemoved += 1;
      continue;
    }
    seenTitles.add(titleKey);
    seenUrls.add(item.url);
    unique.push(item);
  }

  // 최신순으로 뒤집고, 정렬이 끝난 뒤에 출처 ID를 부여한다.
  const items = unique
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .map((item, i) => ({
      sourceId: `S${i + 1}`,
      ...item,
      relevance: scoreRelevance(item, assetName),
    }));

  return {
    items,
    duplicatesRemoved,
    // 위조 URL 제거 후처리가 이 집합을 기준으로 판정한다.
    urlWhitelist: new Set(items.map((i) => i.url)),
  };
}
