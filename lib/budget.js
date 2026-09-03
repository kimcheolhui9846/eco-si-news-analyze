import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

// ─── 비용 예산: 추정 · 추적 · 영속화 ───

/**
 * 토큰 수와 단가로 비용을 계산한다.
 * 단가는 환경변수로 주입한다 — 모델 가격은 바뀌므로 코드에 박아두지 않는다.
 */
export function estimateCostUsd({ inputTokens, outputTokens }, { inputPer1M, outputPer1M }) {
  return (inputTokens / 1_000_000) * inputPer1M + (outputTokens / 1_000_000) * outputPer1M;
}

const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);    // YYYY-MM-DD (UTC)
const monthKey = (ms) => new Date(ms).toISOString().slice(0, 7);   // YYYY-MM (UTC)

/**
 * 호출 수와 비용을 추적하는 예산 관리자.
 *
 * 목적은 속도 제한이 아니라 **비용 상한**이다. rate limit은 시간 창이 지나면
 * 리셋되므로 총량을 막지 못한다.
 *
 * 상태를 파일에 영속화한다. 메모리에만 두면 서버 재시작이 곧 예산 리셋이 되어
 * 상한이 무의미해진다.
 */
export function createBudgetTracker({
  clock, filePath, dailyCallLimit, monthlyCostLimitUsd, log,
}) {
  let state = { day: dayKey(clock.now()), dailyCalls: 0, month: monthKey(clock.now()), monthlyCostUsd: 0 };

  if (filePath && existsSync(filePath)) {
    try {
      const loaded = JSON.parse(readFileSync(filePath, 'utf8'));
      if (loaded && typeof loaded === 'object') state = { ...state, ...loaded };
    } catch {
      // 파일이 깨져 있으면 0에서 시작한다. 여기서 죽으면 서버가 아예 뜨지 않는다.
      log?.warn('예산 파일을 읽지 못해 0에서 시작합니다');
    }
  }

  const persist = () => {
    if (!filePath) return;
    try {
      // 같은 디렉터리에 임시 파일을 쓰고 rename한다. 쓰다가 죽어도 파일이 깨지지 않는다.
      const tmp = `${filePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
      renameSync(tmp, filePath);
    } catch {
      log?.warn('예산 파일을 저장하지 못했습니다');
    }
  };

  /** 날짜·월이 바뀌었으면 해당 카운터를 초기화한다. 조회와 기록 양쪽에서 먼저 부른다. */
  const roll = () => {
    const now = clock.now();
    const d = dayKey(now);
    const m = monthKey(now);
    let changed = false;

    if (state.day !== d) { state.day = d; state.dailyCalls = 0; changed = true; }
    if (state.month !== m) { state.month = m; state.monthlyCostUsd = 0; changed = true; }
    if (changed) persist();
  };

  /** 다음 UTC 자정. */
  const nextDayReset = () => {
    const d = new Date(clock.now());
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
  };

  /** 다음 달 1일 UTC 0시. */
  const nextMonthReset = () => {
    const d = new Date(clock.now());
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
  };

  return {
    snapshot() {
      roll();
      return {
        calls: {
          used: state.dailyCalls,
          limit: dailyCallLimit,
          remaining: Math.max(0, dailyCallLimit - state.dailyCalls),
          resetsAt: nextDayReset(),
        },
        cost: {
          usedUsd: state.monthlyCostUsd,
          limitUsd: monthlyCostLimitUsd,
          remainingUsd: Math.max(0, monthlyCostLimitUsd - state.monthlyCostUsd),
          resetsAt: nextMonthReset(),
        },
      };
    },

    /** 이 비용을 쓰면 한도를 넘는지 **미리** 판정한다. 넘긴 뒤가 아니라 넘기기 전이다. */
    canSpend(estimatedCostUsd) {
      roll();
      if (state.dailyCalls >= dailyCallLimit) {
        return { ok: false, reason: 'DAILY_CALL_LIMIT' };
      }
      if (state.monthlyCostUsd + estimatedCostUsd > monthlyCostLimitUsd) {
        return { ok: false, reason: 'COST_LIMIT' };
      }
      return { ok: true };
    },

    record({ costUsd }) {
      roll();
      state.dailyCalls += 1;
      state.monthlyCostUsd += costUsd;
      persist();
    },
  };
}
