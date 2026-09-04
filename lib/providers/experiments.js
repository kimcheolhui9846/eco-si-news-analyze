import { routeForQuery } from './language.js';

// ─── ClinicalTrials.gov v2 ───
//
// 원본 요구사항 §9.4가 요구하는 항목이 대부분 구조화되어 있다. 초록에서
// 추론할 필요가 없으므로 논문보다 훨씬 안전하게 다룰 수 있다.

const asArray = (v) => {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
};

const collapse = (raw) => String(raw ?? '').replace(/\s+/g, ' ').trim();

export function parseClinicalTrials(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return [];
  }

  return asArray(body?.studies).map((study) => {
    const p = study?.protocolSection ?? {};
    const enrollment = p.designModule?.enrollmentInfo;
    const nctId = collapse(p.identificationModule?.nctId);

    return {
      nctId,
      title: collapse(p.identificationModule?.briefTitle),
      organization: collapse(p.identificationModule?.organization?.fullName) || null,
      url: nctId ? `https://clinicaltrials.gov/study/${nctId}` : null,
      // 단계가 여러 개면 첫 값을 쓴다. 'NA'는 지우지 않는다 —
      // "단계 구분이 없는 연구"라는 사실이기 때문이다.
      phase: asArray(p.designModule?.phases)[0] ?? null,
      status: collapse(p.statusModule?.overallStatus) || null,
      enrollmentCount: typeof enrollment?.count === 'number' ? enrollment.count : null,
      // ESTIMATED는 모집 목표일 뿐 실제 등록 수가 아니다. 반드시 함께 싣는다.
      enrollmentType: enrollment?.type ?? null,
      conditions: asArray(p.conditionsModule?.conditions).map((c) => collapse(c)).filter(Boolean),
      startDate: collapse(p.statusModule?.startDateStruct?.date) || null,
      hasResults: study?.hasResults === true,
    };
  }).filter((i) => i.nctId && i.title);
}

export function createExperimentProvider({ http, cache, clock, makeBreaker }) {
  const breaker = makeBreaker();

  return {
    async search({ query, limit }) {
      const languageRoute = routeForQuery(query);

      if (!languageRoute.useTrials) {
        return {
          items: [],
          degraded: [{
            source: 'ClinicalTrials.gov',
            reason: '임상시험 자료는 영어 검색어에서만 제공됩니다. 국내 대체 소스를 찾지 못했습니다.',
          }],
          languageRoute,
        };
      }

      const cacheKey = `${limit}:${query}`;
      const cached = cache.get(cacheKey);
      if (cached) return { ...cached, languageRoute };

      if (!breaker.canPass()) {
        return {
          items: [],
          degraded: [{ source: 'ClinicalTrials.gov', reason: '일시적으로 사용할 수 없습니다.' }],
          languageRoute,
        };
      }

      const url = `https://clinicaltrials.gov/api/v2/studies?query.term=${encodeURIComponent(query)}&pageSize=${limit}&format=json`;
      try {
        const { text } = await http.get(url);
        breaker.recordSuccess();
        const payload = { items: parseClinicalTrials(text).slice(0, limit), degraded: [] };
        cache.set(cacheKey, payload);
        return { ...payload, languageRoute };
      } catch {
        breaker.recordFailure();
        // 실험 자료는 선택 사항이다. 없어도 분석은 성립한다.
        return {
          items: [],
          degraded: [{ source: 'ClinicalTrials.gov', reason: '자료를 가져오지 못했습니다.' }],
          languageRoute,
        };
      }
    },
  };
}
