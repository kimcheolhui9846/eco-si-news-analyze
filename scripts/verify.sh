#!/usr/bin/env bash
# 원본 요구사항 §22 검증 시나리오.
# 사용법:  ./scripts/verify.sh [BASE_URL]
# 사전조건: 서버가 실행 중이고, MY_SECRET_PASSWORD가 환경변수에 있어야 한다.
set -euo pipefail

BASE="${1:-http://localhost:3000}"
PASSWORD="${MY_SECRET_PASSWORD:?MY_SECRET_PASSWORD 환경변수가 필요합니다}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  [OK] $label (기대 $expected, 실제 $actual)"
    PASS=$((PASS + 1))
  else
    echo "  [FAIL] $label (기대 $expected, 실제 $actual)"
    FAIL=$((FAIL + 1))
  fi
}

# JSON에서 한 필드를 뽑는다. jq 의존을 피해 node를 쓴다.
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

NEWS_BODY='{
  "newsList": [{
    "title": "엔비디아 3분기 실적 발표",
    "content": "데이터센터 부문 매출이 전년 대비 증가했다고 발표했다.",
    "source": "연합뉴스",
    "url": "https://example.com/article/1",
    "publishedAt": "2026-08-30T09:00:00Z"
  }],
  "marketData": {
    "assetName": "엔비디아",
    "currentPrice": "182.50",
    "priceChange": "+2.3%",
    "chartTrend": "20일 이동평균 상회"
  }
}'

echo "1. 로그인"
curl -sS -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"password\":\"$PASSWORD\"}" > "$TMP/login.json"

TOKEN=$(field 'v.token' < "$TMP/login.json")
EXPIRES_1=$(field 'v.expiresAt' < "$TMP/login.json")

if [ -n "$TOKEN" ]; then
  echo "  [OK] 토큰 발급됨"
  PASS=$((PASS + 1))
else
  echo "  [FAIL] 토큰 발급 실패: $(cat "$TMP/login.json")"
  exit 1
fi

echo "2. 확인 토큰 없이 분석 시도 -> 428이어야 한다"
NO_CONFIRM=$(curl -sS -o /dev/null -w '%{http_code}'   -X POST "$BASE/api/analyze/news"   -H 'Content-Type: application/json'   -H "Authorization: Bearer $TOKEN"   -d "$NEWS_BODY")
check "확인 없는 호출 차단" "428" "$NO_CONFIRM"

echo "3. 견적 요청 (LLM 미호출)"
curl -sS -X POST "$BASE/api/analyze/estimate"   -H 'Content-Type: application/json'   -H "Authorization: Bearer $TOKEN"   -d "$NEWS_BODY" > "$TMP/estimate.json"

CONFIRM=$(field 'v.confirmToken' < "$TMP/estimate.json")
EST_COST=$(field 'v.estimatedCostUsd' < "$TMP/estimate.json")
BUDGET_LEFT=$(field 'v.budget.calls.remaining' < "$TMP/estimate.json")

if [ -n "$CONFIRM" ]; then
  echo "  [OK] 확인 토큰 발급됨 (예상 비용 $EST_COST USD, 남은 호출 $BUDGET_LEFT회)"
  PASS=$((PASS + 1))
else
  echo "  [FAIL] 견적 실패: $(cat "$TMP/estimate.json")"
  exit 1
fi

echo "4. 확인 토큰으로 분석 요청"
sleep 1   # 만료 시각 변화를 관찰하기 위한 최소 간격
ANALYZE_CODE=$(curl -sS -o "$TMP/analyze.json" -w '%{http_code}'   -X POST "$BASE/api/analyze/news"   -H 'Content-Type: application/json'   -H "Authorization: Bearer $TOKEN"   -H "X-Confirm-Token: $CONFIRM"   -d "$NEWS_BODY")

echo "5. 분석 성공 확인"
check "분석 응답 코드" "200" "$ANALYZE_CODE"

HAS_REPORT=$(field 'v.analysis && (v.analysis.summary || v.analysis.report) ? 1 : 0' < "$TMP/analyze.json")
check "보고서 본문 존재" "1" "$HAS_REPORT"

HAS_SOURCES=$(field 'v.sources && v.sources.length > 0 ? 1 : 0' < "$TMP/analyze.json")
check "출처 목록 존재" "1" "$HAS_SOURCES"

ACTUAL_COST=$(field 'v.meta.actualCostUsd' < "$TMP/analyze.json")
BUDGET_USED=$(field 'v.meta.budget.calls.used' < "$TMP/analyze.json")
DEGRADED=$(field 'v.meta.degraded' < "$TMP/analyze.json")
FABRICATED=$(field 'v.meta.fabricatedUrlsRemoved' < "$TMP/analyze.json")
MODEL=$(field 'v.meta.model' < "$TMP/analyze.json")
echo "  (참고) degraded=$DEGRADED  위조URL제거=$FABRICATED  model=$MODEL"
echo "  (참고) 실제 비용=\$$ACTUAL_COST  예산 사용=$BUDGET_USED회"

echo "6. 세션 만료 시각 연장 확인"
curl -sS "$BASE/api/auth/session" -H "Authorization: Bearer $TOKEN" > "$TMP/session.json"
EXPIRES_2=$(field 'v.expiresAt' < "$TMP/session.json")
EXTENDED=$(node -e "console.log(Date.parse('$EXPIRES_2') > Date.parse('$EXPIRES_1') ? 'true' : 'false')")
check "만료 시각 연장됨" "true" "$EXTENDED"

echo "7. 로그아웃"
LOGOUT_CODE=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$BASE/api/auth/logout" -H "Authorization: Bearer $TOKEN")
check "로그아웃 응답 코드" "200" "$LOGOUT_CODE"

echo "8. 같은 토큰으로 재분석 요청 -> 403이어야 한다"
AFTER_CODE=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST "$BASE/api/analyze/news" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d "$NEWS_BODY")
check "로그아웃된 토큰 차단" "403" "$AFTER_CODE"

echo ""
echo "통과 $PASS / 실패 $FAIL"
[ "$FAIL" -eq 0 ]
