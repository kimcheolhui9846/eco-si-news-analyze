import { redactKey } from './kci.js';

// ─── OpenDART 단일회사 주요계정 ───
//
// 결과는 SEC provider와 같은 형태다. 화면·프롬프트가 출처를 가리지 않고 다룬다.

const DART_ACCOUNTS = [
  { account: '매출액', label: '매출' },
  { account: '영업이익', label: '영업이익' },
  { account: '당기순이익', label: '순이익' },
  { account: '자산총계', label: '자산' },
  { account: '부채총계', label: '부채' },
];

// 기간 끝이 늦은 순서. reportCandidates가 이 순서로 훑는다.
const REPORTS = [
  { code: '11011', period: 'FY', form: '사업보고서', endMonthDay: '12-31' },
  { code: '11014', period: 'Q3', form: '3분기보고서', endMonthDay: '09-30' },
  { code: '11012', period: 'H1', form: '반기보고서', endMonthDay: '06-30' },
  { code: '11013', period: 'Q1', form: '1분기보고서', endMonthDay: '03-31' },
];

const STATUS_REASON = {
  '010': '한국 재무: OpenDART 키가 등록되지 않았습니다.',
  '011': '한국 재무: OpenDART 키 사용이 중지됐습니다.',
  '012': '한국 재무: OpenDART 키에 허용되지 않은 IP입니다.',
  '020': '한국 재무: OpenDART 호출 한도를 초과했습니다.',
};
const KEY_ERRORS = new Set(['010', '011', '012', '901']);

const dartReason = (status) => STATUS_REASON[status] ?? `한국 재무: OpenDART 오류(${status}).`;

/** 기간이 이미 끝난 보고서 후보를 최신순으로. 아직 안 끝난 기간은 공시가 있을 수 없다. */
export function reportCandidates(nowMs, limit = 4) {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  const out = [];
  for (const y of [year, year - 1, year - 2]) {
    for (const r of REPORTS) {
      const end = `${y}-${r.endMonthDay}`;
      if (end < today) out.push({ year: y, code: r.code, period: r.period, form: r.form, end });
    }
  }
  return out.slice(0, limit);
}

const parseAmount = (raw) => {
  const s = String(raw ?? '').replaceAll(',', '').trim();
  return /^-?\d+$/.test(s) ? Number(s) : null;
};

const iso = (y, m, d) => `${y}-${m}-${d}`;

/** "2026.07.01 ~ 2026.09.30" 또는 "2026.09.30 현재" */
function parsePeriod(dt) {
  const s = String(dt ?? '');
  const range = s.match(/(\d{4})\.(\d{2})\.(\d{2})\s*~\s*(\d{4})\.(\d{2})\.(\d{2})/);
  if (range) return { start: iso(range[1], range[2], range[3]), end: iso(range[4], range[5], range[6]) };
  const point = s.match(/(\d{4})\.(\d{2})\.(\d{2})/);
  return { start: null, end: point ? iso(point[1], point[2], point[3]) : null };
}

const filedFromRcept = (rceptNo) => {
  const m = String(rceptNo ?? '').match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? iso(m[1], m[2], m[3]) : null;
};

// 실제 공시는 같은 계정을 "당기순이익(손실)"처럼 '(손실)'을 붙여 싣기도 한다.
const accountName = (nm) => String(nm ?? '').replace(/\s*\(손실\)$/, '').trim();

const round2 = (n) => Math.round(n * 100) / 100;
const DAY = 86_400_000;

export function parseDartAccounts(body, { report, year }) {
  const list = Array.isArray(body?.list) ? body.list : [];
  const cfs = list.filter((r) => r.fs_div === 'CFS');
  const rows = cfs.length ? cfs : list.filter((r) => r.fs_div === 'OFS');
  if (rows.length === 0) return null;
  const basis = cfs.length ? '연결' : '개별';

  const metrics = [];
  const degraded = [];
  const byLabel = new Map();
  let rceptNo = null;

  for (const spec of DART_ACCOUNTS) {
    const row = rows.find((r) => accountName(r.account_nm) === spec.account);
    const value = parseAmount(row?.thstrm_amount);
    if (!row || value === null) {
      degraded.push({ concept: spec.account, reason: '이 보고서에 해당 계정이 없습니다.' });
      continue;
    }
    rceptNo ??= row.rcept_no ?? null;
    const period = parsePeriod(row.thstrm_dt);
    metrics.push({
      concept: `${spec.account} (${basis})`,
      label: spec.label,
      value,
      unit: row.currency || 'KRW',
      periodStart: period.start,
      periodEnd: period.end ?? report.end,
      fiscalYear: year,
      fiscalPeriod: report.period,
      form: report.form,
      filed: filedFromRcept(row.rcept_no),
    });
    byLabel.set(spec.label, row);
  }

  if (metrics.length === 0) return null;

  // 부채비율·성장률은 코드가 계산한다. LLM에게 산수를 맡기지 않는다.
  const derived = [];
  const assets = parseAmount(byLabel.get('자산')?.thstrm_amount);
  const liabilities = parseAmount(byLabel.get('부채')?.thstrm_amount);
  if (assets && liabilities !== null) {
    derived.push({
      label: '부채비율',
      value: round2((liabilities / assets) * 100),
      unit: '%',
      basis: `${parsePeriod(byLabel.get('자산').thstrm_dt).end ?? report.end} 기준`,
      formula: '부채 / 자산',
    });
  }

  // 전기 기간이 정확히 1년 전 같은 길이일 때만 성장률을 낸다(SEC findYearAgoFact와 같은 기준).
  const revenueRow = byLabel.get('매출');
  if (revenueRow) {
    const cur = parsePeriod(revenueRow.thstrm_dt);
    const prev = parsePeriod(revenueRow.frmtrm_dt);
    const now = parseAmount(revenueRow.thstrm_amount);
    const before = parseAmount(revenueRow.frmtrm_amount);
    const sameShape = cur.start && cur.end && prev.start && prev.end
      && Math.abs(Date.parse(cur.end) - Date.parse(prev.end) - 365 * DAY) <= 45 * DAY
      && Math.abs((Date.parse(cur.end) - Date.parse(cur.start)) - (Date.parse(prev.end) - Date.parse(prev.start))) <= 20 * DAY;
    if (sameShape && now !== null && before) {
      derived.push({
        label: '매출 성장률(전년 동기 대비)',
        value: round2(((now - before) / Math.abs(before)) * 100),
        unit: '%',
        basis: `${year} ${report.period} 대 ${prev.end} 종료 기간`,
        formula: '(당기 - 전년 동기) / 전년 동기',
      });
    }
  }

  return { metrics, derived, degraded, rceptNo };
}

export function createDartFinancialProvider({ http, cache, clock, makeBreaker, apiKey, log }) {
  const breaker = makeBreaker();
  const configured = Boolean(apiKey);

  return {
    configured,

    async fetch({ corpCode, symbol, name }) {
      if (!configured) return { financial: null, reason: '한국 재무: OPENDART_API_KEY가 설정되지 않았습니다.' };
      if (!/^\d{8}$/.test(String(corpCode ?? ''))) {
        return { financial: null, reason: '한국 재무: 고유번호(corp_code)가 올바르지 않습니다.' };
      }

      const cached = cache.get(corpCode);
      if (cached !== undefined) return cached;

      for (const cand of reportCandidates(clock.now())) {
        if (!breaker.canPass()) {
          return { financial: null, reason: '한국 재무: OpenDART 연속 실패로 잠시 호출을 멈췄습니다.' };
        }
        const url = `https://opendart.fss.or.kr/api/fnlttSinglAcnt.json?crtfc_key=${encodeURIComponent(apiKey)}`
          + `&corp_code=${corpCode}&bsns_year=${cand.year}&reprt_code=${cand.code}`;

        let body;
        try {
          body = JSON.parse((await http.get(url)).text);
        } catch (error) {
          breaker.recordFailure();
          // 오류 메시지에 URL이 섞일 수 있다. URL에는 키가 있다.
          log?.warn?.({ err: redactKey(error?.message ?? error, apiKey) }, 'OpenDART 호출 실패');
          return { financial: null, reason: '한국 재무: OpenDART 응답을 받지 못했습니다.' };
        }

        const status = String(body?.status ?? '');
        if (status === '013') {
          breaker.recordSuccess();
          continue;
        }
        if (status !== '000') {
          if (KEY_ERRORS.has(status)) log?.warn?.({ status }, 'OpenDART 키 오류');
          else breaker.recordFailure();
          return { financial: null, reason: dartReason(status) };   // 오류는 캐시하지 않는다
        }

        breaker.recordSuccess();
        const parsed = parseDartAccounts(body, { report: cand, year: cand.year });
        if (!parsed) continue;

        const result = {
          financial: {
            source: 'dart',
            symbol: symbol ?? null,
            cik: null,
            corpCode,
            entityName: name ?? null,
            filingUrl: parsed.rceptNo ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${parsed.rceptNo}` : null,
            metrics: parsed.metrics,
            derived: parsed.derived,
            degraded: parsed.degraded,
          },
          reason: null,
        };
        cache.set(corpCode, result);
        return result;
      }

      const none = { financial: null, reason: '한국 재무: 최근 보고서에서 주요 계정을 찾지 못했습니다.' };
      cache.set(corpCode, none);
      return none;
    },
  };
}
