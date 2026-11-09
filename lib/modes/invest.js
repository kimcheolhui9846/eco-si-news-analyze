import { ApiError } from '../errors.js';
import { buildAnalyzeSchema } from '../validation.js';
import { normalizeNewsList } from '../normalize.js';
import { SYSTEM_PROMPT, buildUserPrompt } from '../prompt.js';
import { ANALYSIS_JSON_SCHEMA } from '../llm.js';
import { buildSources, buildExtraSources, collectUrlWhitelist } from '../postprocess.js';
import { assignResearchIds, assignExperimentIds } from '../sections.js';
import { relevanceName } from '../instruments.js';
import { CHECKS, buildQualityContext } from '../quality/index.js';

// ─── 투자 분석 프로필 ───
//
// 뉴스·시세·재무·논문·실험 자료로 투자 관점 보고서를 만든다.
// 비용 방어 흐름은 lib/analysis-runner.js가 맡고, 여기는 투자 전용 조립만 한다.

export const investProfile = Object.freeze({
  mode: 'invest',
  buildAnalyzeSchema,
  systemPrompt: SYSTEM_PROMPT,
  jsonSchema: ANALYSIS_JSON_SCHEMA,
  checks: CHECKS,

  normalize(data) {
    const { newsList, instruments, sector, analysisPeriod, research, experiments } = data;
    const { items, duplicatesRemoved } =
      normalizeNewsList(newsList, { assetName: relevanceName(instruments) });

    if (items.length === 0) {
      throw new ApiError(422, 'INSUFFICIENT_DATA', '중복 제거 후 분석할 자료가 남지 않았습니다.');
    }

    return {
      items, duplicatesRemoved, instruments, sector, analysisPeriod, research, experiments,
      // 출처 ID는 순서로 결정된다. collect와 analyze가 같은 배열을 보므로 같은 ID가 나온다.
      researchItems: assignResearchIds(research ?? []),
      experimentItems: assignExperimentIds(experiments ?? []),
    };
  },

  buildUserPrompt(n, { collectedAt }) {
    return buildUserPrompt({
      items: n.items, instruments: n.instruments, sector: n.sector, collectedAt,
      analysisPeriod: n.analysisPeriod, research: n.researchItems, experiments: n.experimentItems,
    });
  },

  // 캐시 키는 정규화된 자료 기준이다. 순서만 다른 요청도 같은 키가 된다.
  // 새 자료 필드를 넣지 않으면 작은 견적으로 큰 요청을 실행할 수 있다.
  hashInput(n) {
    return {
      // 모드가 다르면 같은 자료라도 다른 보고서다. 확인 토큰이 모드를 넘나들지 못한다.
      mode: 'invest',
      items: n.items, instruments: n.instruments, sector: n.sector,
      analysisPeriod: n.analysisPeriod, research: n.research, experiments: n.experiments,
    };
  },

  buildSources(n, collectedAt) {
    return [
      ...buildSources(n.items, collectedAt),
      ...buildExtraSources({
        research: n.researchItems, experiments: n.experimentItems,
        instruments: n.instruments, collectedAt,
      }),
    ];
  },

  // 논문·실험·재무 URL을 넣지 않으면 진짜 출처가 위조로 판정돼 지워진다.
  urlWhitelist(n) {
    return collectUrlWhitelist({
      items: n.items, research: n.researchItems, experiments: n.experimentItems, instruments: n.instruments,
    });
  },

  // 품질 검사 기준. 서버가 만든 출처 목록과 종목만 쓴다.
  qualityContext(n, sources) {
    return buildQualityContext({ sources, instruments: n.instruments, sector: n.sector });
  },

  baseMeta(n) {
    return {
      sourceCount: n.items.length,
      researchCount: n.researchItems.length,
      experimentCount: n.experimentItems.length,
      duplicatesRemoved: n.duplicatesRemoved,
    };
  },
});
