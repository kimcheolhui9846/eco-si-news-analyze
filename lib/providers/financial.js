// ─── SEC XBRL 재무지표 ───
//
// companyfacts가 아니라 companyconcept를 쓴다. companyfacts는 회사 전체를
// 한 번에 주는데 NVDA가 4MB로 응답 상한(2MB)을 넘는다. 개념별로는 42KB다.

/** 원본 요구사항 §9.2의 항목에 대응한다. 코드 상수로 고정한다. */
export const FINANCIAL_CONCEPTS = [
  { concept: 'Revenues', label: '매출', fallback: 'RevenueFromContractWithCustomerExcludingAssessedTax' },
  { concept: 'OperatingIncomeLoss', label: '영업이익' },
  { concept: 'NetIncomeLoss', label: '순이익' },
  { concept: 'EarningsPerShareDiluted', label: '희석 주당순이익' },
  { concept: 'Assets', label: '자산' },
  { concept: 'Liabilities', label: '부채' },
];

/** 단위가 여러 개면 이 순서로 고른다. EPS는 USD/shares로 온다. */
const UNIT_PREFERENCE = ['USD', 'USD/shares'];

const daysBetween = (from, to) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

/** 기간 길이(일). 시점 개념(자산·부채)은 start가 없어 0이 된다. */
const durationDays = (fact) => (fact.start ? daysBetween(fact.start, fact.end) : 0);

/**
 * 최근 값 하나를 고른다.
 *
 * 같은 end에 누적치와 분기치가 함께 온다. 누적치를 분기 실적으로 소개하면
 * 숫자가 부풀려지므로 기간이 짧은 쪽을 고른다.
 */
export function pickLatestFact(facts) {
  if (!Array.isArray(facts) || facts.length === 0) return null;

  const sorted = [...facts].sort((a, b) => {
    const byEnd = Date.parse(b.end) - Date.parse(a.end);
    if (byEnd !== 0) return byEnd;
    const byDuration = durationDays(a) - durationDays(b);
    if (byDuration !== 0) return byDuration;
    return Date.parse(b.filed ?? 0) - Date.parse(a.filed ?? 0);
  });
  return sorted[0];
}

/**
 * 전년 동기를 찾는다.
 *
 * fy·fp로 찾으면 안 된다. 최신 보고서에 실린 전년 비교치가 그 보고서의
 * fy를 달고 오기 때문이다. 달력상 1년 전, 같은 길이의 기간을 찾는다.
 */
export function findYearAgoFact(facts, chosen) {
  if (!Array.isArray(facts) || !chosen) return null;

  const targetEnd = Date.parse(chosen.end) - 365 * 86_400_000;
  const targetDuration = durationDays(chosen);

  const candidates = facts.filter((f) => {
    const endGap = Math.abs(Date.parse(f.end) - targetEnd) / 86_400_000;
    const durationGap = Math.abs(durationDays(f) - targetDuration);
    return endGap <= 45 && durationGap <= 20;
  });
  if (candidates.length === 0) return null;

  // 같은 기간을 여러 보고서가 다르게 적었으면 최근 제출본을 쓴다.
  candidates.sort((a, b) => Date.parse(b.filed ?? 0) - Date.parse(a.filed ?? 0));
  return candidates[0];
}

/** accn "0001045810-26-000075" → EDGAR 제출 서류 색인 주소. */
function filingUrlFor(cik, accn) {
  if (!accn) return null;
  const cikNumber = String(Number(cik));   // 앞자리 0을 뗀다
  return `https://www.sec.gov/Archives/edgar/data/${cikNumber}/${accn.replace(/-/g, '')}/${accn}-index.htm`;
}

const round2 = (n) => Math.round(n * 100) / 100;

export function createFinancialProvider({ http, cache, clock, makeBreaker }) {
  const breaker = makeBreaker();

  /** 개념 하나를 가져온다. 실패는 예외 대신 null이다. */
  const fetchConcept = async (cik, concept) => {
    const cacheKey = `${cik}:${concept}`;
    const cached = cache.get(cacheKey);
    if (cached !== undefined) return cached;

    if (!breaker.canPass()) return null;

    const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${concept}.json`;
    try {
      const { text } = await http.get(url);
      const body = JSON.parse(text);
      breaker.recordSuccess();

      const unitKey = UNIT_PREFERENCE.find((u) => body?.units?.[u])
        ?? Object.keys(body?.units ?? {})[0];
      const result = unitKey
        ? { facts: body.units[unitKey], unit: unitKey, entityName: body.entityName ?? null }
        : null;

      cache.set(cacheKey, result);
      return result;
    } catch {
      // 개념이 없는 회사에는 SEC가 404를 준다. 오류가 아니라 흔한 일이다.
      breaker.recordFailure();
      return null;
    }
  };

  return {
    async fetch({ cik, symbol }) {
      // CIK를 모르면 SEC를 부를 방법이 없다. 부르지 않는다.
      if (!cik) return null;

      const loaded = await Promise.all(FINANCIAL_CONCEPTS.map(async (spec) => {
        let data = await fetchConcept(cik, spec.concept);
        if (!data && spec.fallback) data = await fetchConcept(cik, spec.fallback);
        return { spec, data };
      }));

      const metrics = [];
      const degraded = [];
      const byConcept = new Map();
      let entityName = null;
      let latestAccn = null;
      let latestFiled = 0;

      for (const { spec, data } of loaded) {
        if (!data) {
          degraded.push({ concept: spec.concept, reason: '이 회사의 제출 서류에 해당 개념이 없습니다.' });
          continue;
        }
        const fact = pickLatestFact(data.facts);
        if (!fact) {
          degraded.push({ concept: spec.concept, reason: '값이 비어 있습니다.' });
          continue;
        }

        entityName ??= data.entityName;
        if (Date.parse(fact.filed ?? 0) > latestFiled) {
          latestFiled = Date.parse(fact.filed ?? 0);
          latestAccn = fact.accn ?? null;
        }

        byConcept.set(spec.concept, { fact, facts: data.facts, unit: data.unit });
        metrics.push({
          concept: spec.concept,
          label: spec.label,
          value: fact.val,
          unit: data.unit,
          periodStart: fact.start ?? null,
          periodEnd: fact.end ?? null,
          fiscalYear: fact.fy ?? null,
          fiscalPeriod: fact.fp ?? null,
          form: fact.form ?? null,
          filed: fact.filed ?? null,
        });
      }

      // 하나도 못 가져왔으면 재무 자료가 없는 것이다.
      if (metrics.length === 0) return null;

      // 부채비율·성장률은 코드가 계산한다. LLM에게 산수를 맡기지 않는다.
      const derived = [];

      const assets = byConcept.get('Assets');
      const liabilities = byConcept.get('Liabilities');
      if (assets && liabilities && assets.fact.val) {
        derived.push({
          label: '부채비율',
          value: round2((liabilities.fact.val / assets.fact.val) * 100),
          unit: '%',
          basis: `${assets.fact.end} 기준`,
          formula: '부채 / 자산',
        });
      }

      const revenue = byConcept.get('Revenues');
      if (revenue) {
        const prior = findYearAgoFact(revenue.facts, revenue.fact);
        if (prior && prior.val) {
          derived.push({
            label: '매출 성장률(전년 동기 대비)',
            value: round2(((revenue.fact.val - prior.val) / Math.abs(prior.val)) * 100),
            unit: '%',
            basis: `FY${revenue.fact.fy} ${revenue.fact.fp} 대 ${prior.end} 종료 기간`,
            formula: '(당기 - 전년 동기) / 전년 동기',
          });
        }
      }

      return {
        symbol: symbol ?? null,
        cik,
        entityName,
        filingUrl: filingUrlFor(cik, latestAccn),
        metrics,
        derived,
        degraded,
      };
    },
  };
}
