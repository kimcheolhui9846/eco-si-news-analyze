export class ApiCallError extends Error {
  constructor({ code, message, requestId, status }) {
    super(message);
    this.name = 'ApiCallError';
    this.code = code;
    this.requestId = requestId;
    this.status = status;
  }
}

/** CS 분석 요청의 자료 키. 서버 lib/validation.js의 buildCsAnalyzeSchema와 같다. */
const CS_ANALYSIS_KEYS = ['newsList', 'papers', 'community', 'questions', 'blogs', 'repos'];

/**
 * 백엔드 호출을 감싼다.
 *
 * fetch를 주입받는 이유는 네트워크 없이 테스트하기 위해서다.
 * Phase 1의 clock·llm, Phase 2a의 http 주입과 같은 방식이다.
 */
export function createApiClient({ fetchImpl = fetch } = {}) {
  const call = async (path, { method = 'GET', body, headers = {} } = {}) => {
    let res;
    try {
      res = await fetchImpl(path, {
        method,
        // HttpOnly 쿠키가 실려야 인증이 유지된다. 토큰을 헤더에 넣지 않는다.
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiCallError({
        code: 'NETWORK_ERROR',
        message: '서버에 연결하지 못했습니다.',
        status: 0,
      });
    }

    let payload;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if (!res.ok) {
      const e = payload?.error ?? {};
      throw new ApiCallError({
        code: e.code ?? 'INTERNAL',
        message: e.message ?? '오류가 발생했습니다.',
        requestId: e.requestId,
        status: res.status,
      });
    }

    return payload;
  };

  return {
    login: (password) => call('/api/auth/login', { method: 'POST', body: { password } }),
    logout: () => call('/api/auth/logout', { method: 'POST' }),
    session: () => call('/api/auth/session'),
    budget: () => call('/api/budget'),

    collect: (form) => {
      // 논문 수집은 ID 하나만 보낸다. 서버 스키마가 strict다.
      if (form.mode === 'paper') {
        return call('/api/research/collect', { method: 'POST', body: { mode: 'paper', arxiv: form.arxiv } });
      }

      // CS 수집은 투자 전용 필드(symbol·range 등)를 보내지 않는다. 서버 스키마가 strict다.
      if (form.mode === 'cs') {
        const body = { mode: 'cs', query: form.query };
        if (form.lang) body.lang = form.lang;
        if (Array.isArray(form.include) && form.include.length > 0) body.include = form.include;
        return call('/api/research/collect', { method: 'POST', body });
      }

      const { query, symbol, assetType, lang, range, maxNews, include } = form;
      // 빈 문자열을 보내면 zod의 min(1)에서 400이 난다. 아예 뺀다.
      const body = { query };
      if (symbol) body.symbol = symbol;
      if (assetType) body.assetType = assetType;
      if (lang) body.lang = lang;
      if (range) body.range = range;
      if (typeof maxNews === 'number') body.maxNews = maxNews;
      if (Array.isArray(include) && include.length > 0) body.include = include;
      return call('/api/research/collect', { method: 'POST', body });
    },

    analyze: (payload) => {
      // 논문: 수집 응답의 paper를 손대지 않고 되돌려 보낸다. 한 글자만 바뀌어도 확인 토큰이 428로 거부된다.
      if (payload.mode === 'paper') {
        return call('/api/analyze/news', {
          method: 'POST',
          body: { mode: 'paper', paper: payload.paper },
          headers: { 'X-Confirm-Token': payload.confirmToken },
        });
      }

      // CS: 받은 배열을 그대로 되돌려 보낸다. 빈 배열은 넣지 않는다.
      // 서버 수집 라우트가 같은 규칙으로 cacheKey를 만든다.
      if (payload.mode === 'cs') {
        const body = { mode: 'cs' };
        for (const key of CS_ANALYSIS_KEYS) if (payload[key]?.length) body[key] = payload[key];
        return call('/api/analyze/news', {
          method: 'POST', body, headers: { 'X-Confirm-Token': payload.confirmToken },
        });
      }

      const { newsList, instruments, sector, research, experiments, confirmToken } = payload;
      // 받은 자료를 그대로 되돌려 보낸다. 서버 lib/instruments.js의 toAnalysisInstruments와
      // 같은 규칙이어야 cacheKey가 일치한다: 시세·재무가 모두 없는 종목은 빼고 series는 지운다.
      // 빈 자료는 필드를 아예 넣지 않는다.
      const body = { newsList };
      const analysisInstruments = (instruments ?? [])
        .filter((i) => i.marketData || i.financial)
        .map(({ series, ...rest }) => rest);
      if (analysisInstruments.length) body.instruments = analysisInstruments;
      if (sector) body.sector = sector;
      if (research?.length) body.research = research;
      if (experiments?.length) body.experiments = experiments;
      return call('/api/analyze/news', {
        method: 'POST',
        body,
        headers: { 'X-Confirm-Token': confirmToken },
      });
    },
  };
}
