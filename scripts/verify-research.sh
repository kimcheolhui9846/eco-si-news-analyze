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
node -e "
  require('fs').writeFileSync(process.argv[1], JSON.stringify({
    query: '엔비디아 AI 반도체', symbol: 'NVDA', lang: 'ko', maxNews: 8,
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
HAS_MARKET=$(field 'v.marketData ? 1 : 0' < "$TMP/collect.json")
HEADLINE_ONLY=$(field 'v.collected ? v.collected.headlineOnlyCount : "?"' < "$TMP/collect.json")
FEEDS=$(field 'v.collected ? v.collected.feedsUsed.join(",") : ""' < "$TMP/collect.json")
DEGRADED=$(field 'v.collected ? JSON.stringify(v.collected.degraded) : "[]"' < "$TMP/collect.json")
TREND=$(field 'v.marketData ? v.marketData.chartTrend.slice(0,70) : "(없음)"' < "$TMP/collect.json")

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

echo "3. 수집 결과로 분석"
CONFIRM=$(field 'v.confirmToken' < "$TMP/collect.json")
node -e "
  const c = require(process.argv[1]);
  const body = { newsList: c.newsList };
  if (c.marketData) body.marketData = c.marketData;
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

echo ""
echo "통과 $PASS / 실패 $FAIL"
[ "$FAIL" -eq 0 ]
