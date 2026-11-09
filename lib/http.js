import { ApiError } from './errors.js';

/**
 * 외부 호출의 단일 통로.
 *
 * 허용목록·리다이렉트 차단·크기 상한·타임아웃을 여기 한 곳에서 강제한다.
 * provider가 각자 지키게 두면 언젠가 빠뜨린다.
 */
export function createHttpClient({ allowlist, timeoutMs, maxBytes, fetchImpl = fetch }) {
  const allowed = new Set(allowlist.map((h) => h.toLowerCase()));

  const assertAllowed = (raw) => {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new ApiError(502, 'UPSTREAM_ERROR', '외부 자료 주소가 올바르지 않습니다.');
    }

    // https만 허용한다. 평문 통신을 막는다.
    if (parsed.protocol !== 'https:') {
      throw new ApiError(502, 'UPSTREAM_ERROR', '허용되지 않은 외부 요청입니다.');
    }
    // 정확히 일치해야 한다. endsWith로 비교하면 example.com.evil.com이 통과한다.
    if (!allowed.has(parsed.hostname.toLowerCase())) {
      throw new ApiError(502, 'UPSTREAM_ERROR', '허용되지 않은 외부 요청입니다.');
    }
    return parsed;
  };

  return {
    async get(rawUrl, { headers: extraHeaders } = {}) {
      const url = assertAllowed(rawUrl);

      let response;
      try {
        response = await fetchImpl(url.toString(), {
          method: 'GET',
          // 리다이렉트를 따라가면 허용목록이 무의미해진다.
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            'User-Agent': 'eco-si-news-analyze/1.0 (+research tool)',
            Accept: 'application/rss+xml, application/xml, application/json;q=0.9, */*;q=0.8',
            // GitHub처럼 고유 헤더가 필요한 API가 있다. 기본값 위에 얹는다.
            ...extraHeaders,
          },
        });
      } catch (err) {
        if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
          throw new ApiError(504, 'UPSTREAM_TIMEOUT', '외부 자료 응답이 지연되었습니다.');
        }
        // 원본 메시지에는 내부 경로가 섞일 수 있다. 사용자에게 전달하지 않는다.
        throw new ApiError(502, 'UPSTREAM_ERROR', '외부 자료를 가져오지 못했습니다.');
      }

      // 3xx는 따라가지 않고 실패로 만든다.
      if (response.status >= 300) {
        const err = new ApiError(502, 'UPSTREAM_ERROR', '외부 자료를 가져오지 못했습니다.');
        // 호출부가 한도 초과(403·429)를 구분할 수 있게 상태 코드만 남긴다. 메시지는 그대로다.
        err.upstreamStatus = response.status;
        throw err;
      }

      // 본문을 읽기 전에 선언된 크기부터 확인한다.
      const declared = Number(response.headers?.get?.('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new ApiError(502, 'UPSTREAM_ERROR', '외부 자료가 너무 큽니다.');
      }

      const text = await response.text();
      if (text.length > maxBytes) {
        throw new ApiError(502, 'UPSTREAM_ERROR', '외부 자료가 너무 큽니다.');
      }

      return { status: response.status, text, url: url.toString() };
    },
  };
}
