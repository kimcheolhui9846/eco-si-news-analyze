import { randomBytes } from 'node:crypto';

import { ApiError } from './errors.js';
import { formatZodError } from './validation.js';
import { estimateTokens } from './prompt.js';
import { callWithResilience } from './llm.js';
import { stripFabricatedUrls, parseAnalysis } from './postprocess.js';
import { hashRequest } from './cost-defense.js';
import { estimateCostUsd } from './budget.js';
import { assessQuality } from './quality/index.js';

// ─── 분석 실행부 ───
//
// 견적·확인 토큰·예산·동시 실행 제한·요청 병합·LLM 호출·품질 게이트·캐시를 한 곳에 둔다.
// 모드마다 다른 부분(검증·정규화·프롬프트·출처·품질 검사)은 프로필이 맡는다.

const budgetError = (verdict) => new ApiError(429, 'BUDGET_EXCEEDED',
  verdict.reason === 'DAILY_CALL_LIMIT'
    ? '오늘 사용할 수 있는 분석 횟수를 모두 썼습니다.'
    : '이번 달 비용 한도에 도달했습니다.');

export function createAnalysisRunner({
  config, now, llmClient, breaker, analysisCache, analysisSemaphore, inflight,
  budget, confirmTokens, sessions,
}) {
  // 스키마는 config에 따라 상한이 정해진다. 프로필마다 한 번만 만든다.
  const schemas = new Map();
  const schemaFor = (profile) => {
    if (!schemas.has(profile.mode)) schemas.set(profile.mode, profile.buildAnalyzeSchema(config));
    return schemas.get(profile.mode);
  };

  /**
   * 정규화된 자료로 프롬프트·견적·cacheKey를 만든다.
   * 수집 라우트도 이 함수로 견적을 낸다. 같은 계산이어야 확인 토큰이 통한다.
   */
  const quote = (profile, normalized) => {
    const collectedAt = new Date(now.now()).toISOString();
    const userPrompt = profile.buildUserPrompt(normalized, { collectedAt });
    const estimatedInputTokens = estimateTokens(profile.systemPrompt) + estimateTokens(userPrompt);
    const estimatedCostUsd = estimateCostUsd(
      { inputTokens: estimatedInputTokens, outputTokens: config.assumedOutputTokens },
      { inputPer1M: config.priceInputPer1M, outputPer1M: config.priceOutputPer1M },
    );
    const cacheKey = hashRequest({ ...profile.hashInput(normalized), model: config.openaiModel });
    return { collectedAt, userPrompt, estimatedInputTokens, estimatedCostUsd, cacheKey };
  };

  /** 견적을 본 사용자가 명시적으로 승인했음을 증명하는 토큰. 세션과 요청 내용에 묶이고 일회용이다. */
  const issueConfirmToken = (cacheKey, sessionToken) => {
    const confirmToken = `ct_${randomBytes(24).toString('base64url')}`;
    confirmTokens.set(confirmToken, { cacheKey, sessionToken });
    return {
      confirmToken,
      confirmTokenExpiresAt: new Date(now.now() + config.confirmTokenTtlMs).toISOString(),
    };
  };

  /**
   * 검증부터 프롬프트 조립·비용 추정까지, 견적과 실행이 똑같이 밟는 단계.
   * 두 경로가 같은 계산을 하므로 견적과 실제 요청이 어긋날 수 없다.
   */
  const prepare = (profile, body) => {
    const parsed = schemaFor(profile).safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, 'INVALID_REQUEST', formatZodError(parsed.error));
    }

    const normalized = profile.normalize(parsed.data);
    const quoted = quote(profile, normalized);

    // 프롬프트 길이와 토큰 예산을 LLM 호출 전에 확인한다.
    if (quoted.userPrompt.length > config.maxPromptChars || quoted.estimatedInputTokens > config.maxInputTokens) {
      throw new ApiError(413, 'INPUT_TOO_LARGE', '분석 요청이 너무 큽니다. 기사 수나 본문 길이를 줄여 주세요.');
    }

    const sources = profile.buildSources(normalized, quoted.collectedAt);
    return {
      ...quoted,
      normalized,
      sources,
      urlWhitelist: profile.urlWhitelist(normalized),
      qualityContext: profile.qualityContext(normalized, sources),
      baseMeta: {
        collectedAt: quoted.collectedAt,
        ...profile.baseMeta(normalized),
        estimatedInputTokens: quoted.estimatedInputTokens,
      },
    };
  };

  /**
   * 견적. LLM을 호출하지 않으므로 비용이 들지 않는다.
   * 예산이 부족하면 여기서 막아 사용자가 확인 단계로 넘어가지 못하게 한다.
   */
  const estimate = (profile, body, req) => {
    const prepared = prepare(profile, body);
    const cached = Boolean(analysisCache.get(prepared.cacheKey));

    // 캐시 히트는 LLM을 부르지 않으므로 예산을 쓰지 않는다.
    if (!cached) {
      const verdict = budget.canSpend(prepared.estimatedCostUsd);
      if (!verdict.ok) {
        req.log.warn({ reason: verdict.reason }, '예산 한도로 분석을 거부했다');
        throw budgetError(verdict);
      }
    }

    return {
      estimatedInputTokens: prepared.estimatedInputTokens,
      assumedOutputTokens: config.assumedOutputTokens,
      estimatedCostUsd: Number(prepared.estimatedCostUsd.toFixed(6)),
      sourceCount: prepared.baseMeta.sourceCount,
      duplicatesRemoved: prepared.baseMeta.duplicatesRemoved,
      cached,
      budget: budget.snapshot(),
      ...issueConfirmToken(prepared.cacheKey, req.session.token),
      model: config.openaiModel,
      note: cached
        ? '이 요청은 캐시된 결과가 있어 추가 비용이 발생하지 않습니다.'
        : '실제 비용은 응답 길이에 따라 추정치와 달라질 수 있습니다.',
    };
  };

  const run = async (profile, body, req) => {
    const {
      userPrompt, estimatedInputTokens, estimatedCostUsd, cacheKey,
      sources, urlWhitelist, qualityContext, baseMeta,
    } = prepare(profile, body);

    // 캐시 히트는 LLM을 부르지 않는다. 비용이 0이므로 확인도 예산 차감도 필요 없다.
    const cached = analysisCache.get(cacheKey);
    if (cached) {
      sessions.touch(req.session);
      return {
        requestId: req.requestId,
        analysis: cached.analysis,
        sources,
        meta: { ...baseMeta, ...cached.meta, cached: true, actualCostUsd: 0, budget: budget.snapshot() },
      };
    }

    // 여기부터는 실제 비용이 발생한다. 사용자의 명시적 승인을 요구한다.
    const confirmToken = req.get('x-confirm-token');
    const grant = confirmToken ? confirmTokens.get(confirmToken) : undefined;

    // 토큰은 이 세션의 것이어야 하고, 견적을 낸 그 요청 내용이어야 한다.
    // 그렇지 않으면 작은 요청으로 견적을 받고 큰 요청을 실행할 수 있다.
    if (!grant || grant.sessionToken !== req.session.token || grant.cacheKey !== cacheKey) {
      throw new ApiError(428, 'CONFIRMATION_REQUIRED',
        '먼저 /api/analyze/estimate로 예상 비용을 확인한 뒤, 발급된 확인 토큰을 X-Confirm-Token 헤더에 담아 다시 요청해 주세요.');
    }
    confirmTokens.delete(confirmToken);   // 일회용

    const verdict = budget.canSpend(estimatedCostUsd);
    if (!verdict.ok) {
      req.log.warn({ reason: verdict.reason }, '예산 한도로 분석을 거부했다');
      throw budgetError(verdict);
    }

    const release = analysisSemaphore.tryAcquire();
    if (!release) {
      throw new ApiError(429, 'TOO_MANY_CONCURRENT', '동시 분석 요청이 많습니다. 잠시 후 다시 시도해 주세요.');
    }

    let produced;
    try {
      // 같은 키로 동시에 들어온 요청은 하나의 LLM 호출을 공유한다.
      produced = await inflight.run(cacheKey, async () => {
        const call = (useJsonSchema) => callWithResilience(
          llmClient,
          { system: profile.systemPrompt, user: userPrompt, useJsonSchema, jsonSchema: profile.jsonSchema },
          { config, breaker, clock: now, log: req.log },
        );

        let outputTokens = 0;
        // 구조화 출력 2회 시도 → Markdown 폴백 1회.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const result = await call(true);
          outputTokens += estimateTokens(result.content);
          const analysis = parseAnalysis(result.content);
          if (analysis) return { analysis, model: result.model, degraded: false, outputTokens };
          req.log.warn({ attempt: attempt + 1 }, '구조화 응답 파싱 실패');
        }

        const fallback = await call(false);
        outputTokens += estimateTokens(fallback.content);
        if (!fallback.content?.trim()) {
          throw new ApiError(502, 'PARSE_FAILED', '분석 결과를 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
        }
        return {
          analysis: { report: fallback.content },
          model: fallback.model, degraded: true, outputTokens,
        };
      });
    } finally {
      release();
    }

    // 실제 응답 길이로 비용을 다시 계산해 기록한다. 견적은 가정치일 뿐이다.
    const actualCostUsd = estimateCostUsd(
      { inputTokens: estimatedInputTokens, outputTokens: produced.outputTokens },
      { inputPer1M: config.priceInputPer1M, outputPer1M: config.priceOutputPer1M },
    );
    budget.record({ costUsd: actualCostUsd });

    // 결정적 품질 게이트. 검사 목록은 프로필이 정한다.
    const assessed = assessQuality(produced.analysis, qualityContext, {
      degraded: produced.degraded, checks: profile.checks,
    });
    const { quality } = assessed;
    // 로그에는 개수와 검사 이름만 남긴다. 모델 출력 본문은 남기지 않는다.
    req.log.info({
      mode: profile.mode,
      qualityScore: quality.score, fixed: quality.fixed, warnings: quality.warnings,
      checks: [...new Set(quality.issues.map((i) => i.check))],
    }, '분석 품질 검사');

    // LLM이 지어낸 URL을 제거한다. 프롬프트 지시만으로는 보장되지 않는다.
    const { value: analysis, removed: fabricatedUrlsRemoved } =
      stripFabricatedUrls(assessed.analysis, urlWhitelist);

    if (fabricatedUrlsRemoved > 0) {
      req.log.warn({ fabricatedUrlsRemoved }, '출처에 없는 URL을 제거했다');
    }

    analysisCache.set(cacheKey, {
      analysis,
      meta: { fabricatedUrlsRemoved, quality, degraded: produced.degraded, model: produced.model },
    });

    // 여기가 세션을 연장하는 유일한 지점이다.
    // 위의 어떤 실패 경로도 여기에 도달하지 못한다.
    sessions.touch(req.session);

    return {
      requestId: req.requestId,
      analysis,
      sources,
      meta: {
        ...baseMeta,
        fabricatedUrlsRemoved,
        quality,
        cached: false,
        degraded: produced.degraded,
        model: produced.model,
        actualCostUsd: Number(actualCostUsd.toFixed(6)),
        budget: budget.snapshot(),
      },
    };
  };

  return { quote, prepare, issueConfirmToken, estimate, run };
}
