import { createHash } from 'node:crypto';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

// ─── 비용 방어: 캐시 / 세마포어 / 중복 병합 / rate limit ───

/** TTL + LRU. Map은 삽입 순서를 유지하므로 재삽입으로 최근 사용을 표현한다. */
export function createTtlCache({ ttlMs, maxEntries, clock }) {
  const entries = new Map();

  return {
    get(key) {
      const hit = entries.get(key);
      if (!hit) return undefined;

      if (clock.now() >= hit.expiresAt) {
        entries.delete(key);
        return undefined;
      }
      // 최근 사용으로 올린다.
      entries.delete(key);
      entries.set(key, hit);
      return hit.value;
    },

    set(key, value) {
      entries.delete(key);
      entries.set(key, { value, expiresAt: clock.now() + ttlMs });

      while (entries.size > maxEntries) {
        // Map의 첫 항목이 가장 오래 안 쓴 것이다.
        entries.delete(entries.keys().next().value);
      }
    },

    delete: (key) => entries.delete(key),
    size: () => entries.size,
    clear: () => entries.clear(),
  };
}

/** 동시 실행 수를 제한한다. 대기열은 두지 않는다 — 넘치면 즉시 거절한다. */
export function createSemaphore(max) {
  let count = 0;

  return {
    tryAcquire() {
      if (count >= max) return null;
      count += 1;

      let released = false;
      return () => {
        // 중복 반납이 카운터를 음수로 만들지 않게 막는다.
        if (released) return;
        released = true;
        count -= 1;
      };
    },
    inUse: () => count,
  };
}

/** 같은 키로 들어온 동시 요청이 하나의 실행을 공유하게 한다. */
export function createInflightMap() {
  const pending = new Map();

  return {
    run(key, factory) {
      const existing = pending.get(key);
      if (existing) return existing;

      // 성공하든 실패하든 키를 비워야 다음 요청이 새로 돈다.
      const promise = (async () => factory())().finally(() => pending.delete(key));
      pending.set(key, promise);
      return promise;
    },
    size: () => pending.size,
  };
}

/** 키 순서에 영향받지 않는 안정적 해시. 캐시 키와 중복 병합 키로 쓴다. */
export function hashRequest(input) {
  const stable = (node) => {
    if (Array.isArray(node)) return node.map(stable);
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.keys(node).sort().map((k) => [k, stable(node[k])]));
    }
    return node;
  };

  return createHash('sha256').update(JSON.stringify(stable(input))).digest('hex');
}

/** rate limit 위반도 다른 에러와 같은 형식으로 응답한다. */
const rateLimitHandler = (req, res) => {
  res.status(429).json({
    error: {
      code: 'RATE_LIMITED',
      message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      requestId: req.requestId,
    },
  });
};

const limiterBase = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: rateLimitHandler,
};

export function makeLoginLimiter(config) {
  return rateLimit({
    ...limiterBase,
    windowMs: config.loginRateWindowMs,
    limit: config.loginRateMax,
  });
}

export function makeAnalyzeLimiter(config) {
  return rateLimit({
    ...limiterBase,
    windowMs: config.analyzeRateWindowMs,
    limit: config.analyzeRateMax,
  });
}

/**
 * 세션별 한도. IP 한도와 별개로 건다 — 한 IP 뒤의 여러 세션,
 * 여러 IP를 도는 한 세션 양쪽을 막기 위함이다.
 */
export function makeSessionLimiter(config) {
  return rateLimit({
    ...limiterBase,
    windowMs: config.sessionRateWindowMs,
    limit: config.sessionRateMax,
    keyGenerator: (req) => {
      // 인증된 요청은 세션 토큰으로, 아니면 IP로 센다.
      // IPv6는 /56 서브넷으로 묶지 않으면 주소를 바꿔가며 한도를 우회할 수 있다.
      if (req.session?.token) return `session:${req.session.token}`;
      return ipKeyGenerator(req.ip, 56);
    },
  });
}
