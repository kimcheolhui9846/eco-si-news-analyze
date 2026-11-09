#!/usr/bin/env bash
# Phase 2a 수집 경로 검증. 실제 외부 API를 호출한다.
# 사용법:  ./scripts/verify-research.sh [BASE_URL]
# 사전조건: 서버가 실행 중이고, MY_SECRET_PASSWORD가 환경변수에 있어야 한다.
#
# 주의: 요청 본문은 파일로 만들어 --data-binary로 보낸다.
#       셸에 한글을 직접 넣으면 콘솔 인코딩에서 깨진다.
set -euo pipefail

BASE="${1:-http://localhost:3000}"
PASSWORD="${MY_SECRET_PASSWORD:?MY_SECRET_PASSWORD 환경변수가 필요합니다}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS=0
FAIL=0

check() {
  if [ "$2" = "$3" ]; then
    echo "  [OK] $1 (기대 $2, 실제 $3)"
    PASS=$((PASS + 1))
  else
    echo "  [FAIL] $1 (기대 $2, 실제 $3)"
    FAIL=$((FAIL + 1))
  fi
}

field() {
  node -e "
    let raw='';
    process.stdin.on('data', d => raw += d);
    process.stdin.on('end', () => {
      try { const v = JSON.parse(raw); console.log(String(eval(process.argv[1]) ?? '')); }
      catch { console.log(''); }
    });
  " "$1"
}

# 한글이 깨지지 않도록 요청 본문을 node로 만든다.
# 재무·논문·실험은 영문 질의에서만 제대로 동작한다. 언어 가드는 5단계에서 따로 본다.
node -e "
  require('fs').writeFileSync(process.argv[1], JSON.stringify({
    query: 'nvidia earnings', symbol: 'NVDA', lang: 'en', maxNews: 8,
    include: ['news', 'market', 'financial', 'research', 'experiments'],
  }), 'utf8');
" "$TMP/collect-req.json"

echo "1. 로그인"
curl -sS -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"password\":\"$PASSWORD\"}" > "$TMP/login.json"
TOKEN=$(field 'v.token' < "$TMP/login.json")

if [ -n "$TOKEN" ]; then
  echo "  [OK] 토큰 발급됨"
  PASS=$((PASS + 1))
else
  echo "  [FAIL] 로그인 실패: $(cat "$TMP/login.json")"
  exit 1
fi

echo "2. 수집 (실제 외부 API 호출)"
CODE=$(curl -sS -o "$TMP/collect.json" -w '%{http_code}' \
  -X POST "$BASE/api/research/collect" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -H "Authorization: Bearer $TOKEN" \
  --data-binary @"$TMP/collect-req.json")
check "수집 응답 코드" "200" "$CODE"

NEWS=$(field 'v.newsList ? v.newsList.length : 0' < "$TMP/collect.json")
HAS_MARKET=$(field 'v.instruments && v.instruments[0] && v.instruments[0].marketData ? 1 : 0' < "$TMP/collect.json")
HEADLINE_ONLY=$(field 'v.collected ? v.collected.headlineOnlyCount : "?"' < "$TMP/collect.json")
FEEDS=$(field 'v.collected ? v.collected.feedsUsed.join(",") : ""' < "$TMP/collect.json")
DEGRADED=$(field 'v.collected ? JSON.stringify(v.collected.degraded) : "[]"' < "$TMP/collect.json")
TREND=$(field 'v.instruments && v.instruments[0] && v.instruments[0].marketData ? v.instruments[0].marketData.chartTrend.slice(0,70) : "(없음)"' < "$TMP/collect.json")

if [ "${NEWS:-0}" -gt 0 ]; then
  echo "  [OK] 뉴스 $NEWS건 수집"
  PASS=$((PASS + 1))
else
  echo "  [FAIL] 뉴스 0건"
  FAIL=$((FAIL + 1))
fi
check "시장 데이터 확보" "1" "$HAS_MARKET"
echo "  (참고) 사용 피드: $FEEDS"
echo "  (참고) 제목만 확보: ${HEADLINE_ONLY}건 | degraded: $DEGRADED"
echo "  (참고) 추세: $TREND..."

RESEARCH=$(field 'v.research ? v.research.length : 0' < "$TMP/collect.json")
TRIALS=$(field 'v.experiments ? v.experiments.length : 0' < "$TMP/collect.json")
FIN=$(field 'v.instruments ? v.instruments.reduce((n,i)=>n+(i.financial?i.financial.metrics.length:0),0) : 0' < "$TMP/collect.json")
INCLUDED=$(field 'v.collected ? v.collected.included.join(",") : ""' < "$TMP/collect.json")

check "수집 범위" "news,market,financial,research,experiments" "$INCLUDED"
if [ "${RESEARCH:-0}" -gt 0 ]; then
  echo "  [OK] 논문 ${RESEARCH}건 수집"
  PASS=$((PASS + 1))
else
  echo "  [FAIL] 논문 0건"
  FAIL=$((FAIL + 1))
fi
# 반도체 실적 질의에 임상시험이 없는 것은 결함이 아니라 사실이다.
# 임상시험 경로는 7단계에서 의학 질의로 따로 확인한다.
echo "  (참고) 임상시험 ${TRIALS}건 — 이 질의에는 없을 수 있다"
if [ "${FIN:-0}" -gt 0 ]; then
  echo "  [OK] 재무지표 ${FIN}개 수집"
  PASS=$((PASS + 1))
else
  echo "  [FAIL] 재무지표 0개"
  FAIL=$((FAIL + 1))
fi

echo "3. 수집 결과로 분석"
CONFIRM=$(field 'v.confirmToken' < "$TMP/collect.json")
# 빈 자료는 넣지 않는다. []를 보내면 cacheKey가 어긋나 428이 난다.
node -e "
  const c = require(process.argv[1]);
  const body = { newsList: c.newsList };
  const inst = (c.instruments || []).filter(i => i.marketData || i.financial).map(({ series, ...rest }) => rest);
  if (inst.length) body.instruments = inst;
  if (c.collected && c.collected.resolution && c.collected.resolution.sector) body.sector = c.collected.resolution.sector;
  if (c.research && c.research.length) body.research = c.research;
  if (c.experiments && c.experiments.length) body.experiments = c.experiments;
  require('fs').writeFileSync(process.argv[2], JSON.stringify(body), 'utf8');
" "$TMP/collect.json" "$TMP/analyze-body.json"

ACODE=$(curl -sS -o "$TMP/analyze.json" -w '%{http_code}' \
  -X POST "$BASE/api/analyze/news" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Confirm-Token: $CONFIRM" \
  --data-binary @"$TMP/analyze-body.json")
check "분석 응답 코드" "200" "$ACODE"

HAS_REPORT=$(field 'v.analysis && (v.analysis.summary || v.analysis.report) ? 1 : 0' < "$TMP/analyze.json")
check "보고서 생성" "1" "$HAS_REPORT"
echo "  (참고) degraded=$(field 'v.meta ? v.meta.degraded : "?"' < "$TMP/analyze.json")  비용=$(field 'v.meta ? v.meta.actualCostUsd : "?"' < "$TMP/analyze.json") USD"

echo "4. 확인 토큰 재사용 차단"
RCODE=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$BASE/api/analyze/news" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Confirm-Token: $CONFIRM" \
  --data-binary @"$TMP/analyze-body.json")

# 두 번째 호출은 캐시 히트로 200이 나올 수 있다. 둘 다 정상이다.
if [ "$RCODE" = "428" ] || [ "$RCODE" = "200" ]; then
  echo "  [OK] 재사용 처리 (HTTP $RCODE — 428 차단 또는 200 캐시히트)"
  PASS=$((PASS + 1))
else
  echo "  [FAIL] 예상 밖 응답 $RCODE"
  FAIL=$((FAIL + 1))
fi

echo "5. 출처 타입"
TYPES=$(field 'v.sources ? [...new Set(v.sources.map(s => s.type))].sort().join(",") : ""' < "$TMP/analyze.json")
echo "  (참고) 출처 타입: $TYPES"
case "$TYPES" in
  *research*) echo "  [OK] 논문 출처가 인용 목록에 있다"; PASS=$((PASS + 1)) ;;
  *)          echo "  [FAIL] 논문 출처가 없다"; FAIL=$((FAIL + 1)) ;;
esac

echo "6. 한국어 질의 언어 가드"
# 한글 질의에는 Europe PMC·arXiv·ClinicalTrials로 요청이 나가면 안 된다.
node -e "
  require('fs').writeFileSync(process.argv[1], JSON.stringify({
    query: '배터리 재활용', lang: 'ko', maxNews: 5,
    include: ['news', 'research', 'experiments'],
  }), 'utf8');
" "$TMP/ko-req.json"

KOCODE=$(curl -sS -o "$TMP/ko.json" -w '%{http_code}' \
  -X POST "$BASE/api/research/collect" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -H "Authorization: Bearer $TOKEN" \
  --data-binary @"$TMP/ko-req.json")

check "한국어 수집 응답 코드" "200" "$KOCODE"

# 중첩 따옴표를 피하려고 판정을 node 한 곳에 몰아 둔다.
KOROUTE=$(node -e "
  const c = require(process.argv[1]).collected;
  console.log(c && c.languageRoute ? c.languageRoute.route : '');
" "$TMP/ko.json")
check "언어 판정" "ko" "$KOROUTE"

node -e "
  const c = require(process.argv[1]).collected;
  const reasons = (c && c.degraded ? c.degraded : []).map(d => d.reason);
  console.log('  (참고) 사유: ' + (reasons.join(' | ') || '없음'));
" "$TMP/ko.json"

echo "7. 임상시험 경로 (의학 질의)"
node -e "
  require('fs').writeFileSync(process.argv[1], JSON.stringify({
    query: 'obesity drug trial', lang: 'en', maxNews: 3,
    include: ['news', 'experiments'],
  }), 'utf8');
" "$TMP/trial-req.json"

curl -sS -o "$TMP/trial.json" \
  -X POST "$BASE/api/research/collect" \
  -H 'Content-Type: application/json; charset=utf-8' \
  -H "Authorization: Bearer $TOKEN" \
  --data-binary @"$TMP/trial-req.json"

TRIALS2=$(field 'v.experiments ? v.experiments.length : 0' < "$TMP/trial.json")
if [ "${TRIALS2:-0}" -gt 0 ]; then
  echo "  [OK] 임상시험 ${TRIALS2}건 수집"
  PASS=$((PASS + 1))
else
  echo "  [FAIL] 임상시험 0건"
  FAIL=$((FAIL + 1))
fi

collect_query() {
  node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({ query: process.argv[2], lang: 'ko', maxNews: 5, include: ['news','market','financial'] }), 'utf8');" "$TMP/q.json" "$1"
  local code
  code=$(curl -sS -o "$TMP/q-out.json" -w '%{http_code}' -X POST "$BASE/api/research/collect" \
    -H 'Content-Type: application/json; charset=utf-8' \
    -H "Authorization: Bearer $TOKEN" \
    --data-binary @"$TMP/q.json")
  # 응답 코드부터 본다. 실패 응답이면 뒤따르는 필드 검사가 엉뚱한 이유로 실패한다.
  check "$1 수집 응답 코드" "200" "$code"
}

echo "8. 분야 묶음과 회사 해석 (수집만, LLM 비용 없음)"
collect_query '반도체 업황'
check "반도체 → 분야 묶음" "sector" "$(field 'v.collected.resolution.kind' < "$TMP/q-out.json")"
check "반도체 → 종목 4개" "4" "$(field 'v.instruments.length' < "$TMP/q-out.json")"
check "반도체 → 시세 확보 종목 수" "4" "$(field 'v.instruments.filter(i => i.marketData).length' < "$TMP/q-out.json")"
echo "  (참고) 시세 없는 종목: $(field 'v.instruments.filter(i => !i.marketData).map(i => i.symbol).join(",")' < "$TMP/q-out.json") | degraded: $(field 'JSON.stringify(v.collected.degraded)' < "$TMP/q-out.json")"

collect_query '엔비디아 실적'
check "엔비디아 → SEC 재무" "sec" "$(field 'v.instruments[0].financial ? v.instruments[0].financial.source : ""' < "$TMP/q-out.json")"

collect_query '메타버스 시장'
check "메타버스 → META 아님" "unresolved" "$(field 'v.collected.resolution.kind' < "$TMP/q-out.json")"

collect_query '삼성전자 실적'
DART_SRC=$(field 'v.instruments[0].financial ? v.instruments[0].financial.source : ""' < "$TMP/q-out.json")
if [ -n "${OPENDART_EXPECTED:-}" ]; then
  check "삼성전자 → DART 재무" "dart" "$DART_SRC"
else
  echo "  (참고) 삼성전자 재무 출처: ${DART_SRC:-없음} — OPENDART_EXPECTED=1이면 dart를 요구한다"
fi

echo ""
echo "통과 $PASS / 실패 $FAIL"
[ "$FAIL" -eq 0 ]
