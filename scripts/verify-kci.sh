#!/usr/bin/env bash
# KCI OpenAPI 계약 확정. 스펙 §2.2.2의 4단계를 순서대로 돌린다.
#
# 사용법:  ./scripts/verify-kci.sh
# 사전조건: .env에 KCI_API_KEY가 채워져 있어야 한다 (또는 환경변수로 넘긴다).
#
# 이 스크립트는 서버를 거치지 않고 KCI를 직접 부른다. 키가 없어 확인하지
# 못한 두 가지를 확정하는 것이 목적이다.
#   (1) 한국어 질의가 동작하는지 — UTF-8인지 EUC-KR인지
#   (2) 정상 응답의 XML 요소 이름 — lib/providers/kci.js의 KCI_FIELD_NAMES
#
# 출력에 키가 남지 않도록 모든 응답과 URL에서 키를 가린다.
set -euo pipefail

ENV_FILE="${ENV_FILE:-.env}"
if [ -z "${KCI_API_KEY:-}" ] && [ -f "$ENV_FILE" ]; then
  KCI_API_KEY="$(grep -E '^KCI_API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
fi

if [ -z "${KCI_API_KEY:-}" ]; then
  echo "KCI_API_KEY가 비어 있습니다."
  echo "  open.kci.go.kr에서 발급한 뒤 .env의 KCI_API_KEY= 뒤에 넣어 주세요."
  echo "  .env는 .gitignore에 있어 커밋되지 않습니다."
  exit 1
fi

OUT="${OUT:-$(mktemp -d)}"
BASE='https://open.kci.go.kr/po/openapi/openApiSearch.kci?apiCode=articleSearch&displayCount=10&page=1'

# 키가 로그·화면에 남지 않게 가린다.
redact() { sed "s/${KCI_API_KEY}/[REDACTED]/g"; }

# 응답을 요약한다. 오류 메시지와 레코드 수를 함께 본다 —
# KCI는 실패를 HTTP 200 본문의 <resultMsg>로 알린다.
summarize() {
  node -e "
    const fs = require('fs');
    const { XMLParser } = require('fast-xml-parser');
    const raw = fs.readFileSync(process.argv[1], 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });

    let root;
    try { root = parser.parse(raw); }
    catch { console.log('  XML 파싱 실패'); process.exit(0); }

    const meta = root.MetaData ?? root ?? {};
    const asArray = (v) => (v === undefined || v === null) ? [] : (Array.isArray(v) ? v : [v]);
    const messages = asArray(meta?.outputData?.result?.resultMsg).map(String).filter(Boolean);

    if (messages.length > 0) {
      console.log('  실패 — resultMsg ' + messages.length + '개');
      for (const m of messages) console.log('    · ' + m);
      process.exit(0);
    }

    // 정상 응답이다. 요소 이름을 훑어 KCI_FIELD_NAMES를 확정할 근거를 만든다.
    const names = new Set();
    const walk = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 8) return;
      for (const [k, v] of Object.entries(node)) {
        if (!k.startsWith('@_') && k !== '#text') names.add(k);
        asArray(v).forEach((child) => walk(child, depth + 1));
      }
    };
    walk(meta.outputData ?? meta, 0);

    console.log('  성공 — 오류 메시지 없음');
    console.log('  응답에 나타난 요소 이름:');
    console.log('    ' + [...names].sort().join(', '));
  " "$1"
}

step() {
  local label="$1" url="$2" file="$3"
  echo ""
  echo "$label"
  local code
  code=$(curl -sS -o "$file" -w '%{http_code}' "$url" || echo '000')
  echo "  HTTP $code"
  summarize "$file"
}

echo "KCI OpenAPI 계약 확정 — 응답은 $OUT 에 저장된다"
echo "(저장된 파일에는 키가 반사돼 들어 있을 수 있다. 픽스처로 옮기기 전에 반드시 확인할 것)"

step "1. ASCII 질의 (title=battery) — API 자체가 도는지" \
  "$BASE&key=$KCI_API_KEY&title=battery" "$OUT/1-ascii.xml"

step "2. 한글 UTF-8 퍼센트 인코딩 (title=배터리)" \
  "$BASE&key=$KCI_API_KEY&title=%EB%B0%B0%ED%84%B0%EB%A6%AC" "$OUT/2-utf8.xml"

step "3. 한글 EUC-KR 퍼센트 인코딩 (title=배터리)" \
  "$BASE&key=$KCI_API_KEY&title=%B9%E8%C5%CD%B8%AE" "$OUT/3-euckr.xml"

echo ""
echo "─── 판정 ───"
echo "1이 실패      → 키 또는 IP 문제. resultMsg를 읽고 open.kci.go.kr에서 IP를 재등록한다"
echo "2가 성공      → 현재 구현 그대로 간다. 2번 응답을 픽스처로 저장한다"
echo "2 실패·3 성공 → buildKciUrl이 EUC-KR로 인코딩하도록 고친다 (iconv-lite 필요)"
echo "2·3 모두 실패 → 한계로 문서화하고 언어 가드에서 KCI를 뺀다"
echo ""
echo "성공한 응답을 픽스처로 옮기기 전에 키가 남아 있지 않은지 반드시 확인한다:"
echo "  grep -c \"\$KCI_API_KEY\" <파일>   # 0이어야 한다"
echo ""
echo "저장 위치: $OUT"
