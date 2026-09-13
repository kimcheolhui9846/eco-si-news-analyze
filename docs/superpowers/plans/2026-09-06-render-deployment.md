# Render 무료 인스턴스 배포 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이 앱을 Render 무료 인스턴스에 올려 인터넷에서 접속 가능한 주소로 만든다.

**Architecture:** 애플리케이션 코드는 바꾸지 않는다. `render.yaml`로 배포 정의를 저장소에 남기고, 빌드가 깨지는 함정 하나(`--include=dev`)를 회귀 테스트로 고정하며, 무료 티어의 한계 여섯 가지를 문서에 적는다.

**Tech Stack:** Render(무료 웹 서비스), Node.js 22+, 기존 `node:test`

**설계 문서:** `docs/superpowers/specs/2026-09-06-deployment-design.md` — 이 계획의 근거다. 충돌하면 스펙이 이긴다.

## Global Constraints

- 기존 523개 테스트가 전부 통과해야 한다. 실행: `npm test`
- **애플리케이션 코드(`lib/`, `server.js`, `client/src/`)를 수정하지 않는다.** 이번 범위는 설정·문서·배포 정의다
- 커밋 메시지 마지막 줄: `Claude-Session: https://claude.ai/code/session_013RZNuJYHFTQ6M3HHXAPwJW`
- `Co-Authored-By`, Anthropic 트레일러, "Generated with Claude Code" 문구를 넣지 않는다
- 커밋 저자: `kim cheol hui <144594976+kimcheolhui9846@users.noreply.github.com>`
- 브랜치: `feature/deployment` (이미 체크아웃되어 있고 `main` 위로 리베이스되어 있다)
- **비밀값을 저장소에 넣지 않는다.** `MY_SECRET_PASSWORD`와 `OPENAI_API_KEY`는 Render 대시보드에서만 입력한다
- **인스턴스는 하나여야 한다.** 늘리면 세션·확인 토큰·rate limit·회로차단기가 갈라진다 (스펙 §4)
- 주석과 사용자 노출 문구는 한국어로 쓴다

## File Structure

**새로 만드는 파일**

| 파일 | 책임 |
|---|---|
| `render.yaml` | 배포 정의. 대시보드 클릭 설정은 재현되지 않고 기록도 남지 않는다 |
| `tests/deployment.test.js` | 배포 정의가 조용히 망가지는 것을 막는 회귀 테스트 |

**수정하는 파일**

| 파일 | 변경 |
|---|---|
| `package.json` | `engines.node` 추가 |
| `README.md` | 배포 절차와 배포용 환경변수 표 |
| `docs/architecture.md` | "인스턴스 1개" 제약과 상태가 어디 사는지 |
| `docs/SESSION-HANDOFF.md` | 배포 URL, 확인된 사실, 한계 |

---

## Task 1: 배포 정의와 회귀 테스트

**Files:**
- Create: `render.yaml`
- Create: `tests/deployment.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: 없음
- Produces: `render.yaml` (Render Blueprint), `package.json`의 `engines.node`

**왜 테스트를 쓰는가**

`render.yaml`은 코드가 아니라 설정이라 "테스트할 게 없다"고 느끼기 쉽다. 그런데 이 파일에는 **지우면 조용히 깨지는 것**이 둘 있다.

1. `--include=dev` — 지우면 빌드가 `vite: not found`로 실패한다. "production 빌드에 devDependencies가 왜 필요하지"라며 지우기 쉽다
2. `sync: false` — 실수로 값을 적으면 **비밀번호와 API 키가 저장소에 올라간다**

테스트가 이 둘을 고정한다. YAML 파서를 새로 넣지 않고 텍스트로 검사한다 — 위 두 가지는 문자열 존재 여부로 충분히 잡히고, 문법 오류는 실제 배포(Task 3)에서 드러난다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`tests/deployment.test.js`를 새로 만든다.

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ─── 배포 정의 회귀 테스트 ───
//
// render.yaml은 설정 파일이지만 조용히 깨지는 지점이 있다.
// YAML 파서를 새로 넣지 않고 텍스트로 검사한다. 문법 오류는 실제 배포에서 드러난다.

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const renderYaml = read('render.yaml');
const packageJson = JSON.parse(read('package.json'));

test('빌드 명령이 devDependencies를 포함해 설치한다', () => {
  // vite와 @vitejs/plugin-react는 client의 devDependencies다.
  // NODE_ENV=production은 빌드 단계에도 적용되므로 --include=dev가 없으면
  // npm ci가 이들을 건너뛰고 빌드가 'vite: not found'로 실패한다.
  assert.match(renderYaml, /npm ci --include=dev/);
});

test('빌드 명령이 클라이언트를 빌드한다', () => {
  // client/dist는 .gitignore에 있어 저장소에 산출물이 없다.
  assert.match(renderYaml, /npm run build:client/);
});

test('비밀값을 저장소에 넣지 않는다', () => {
  // sync: false면 Render 대시보드에서 입력받는다.
  for (const key of ['MY_SECRET_PASSWORD', 'OPENAI_API_KEY']) {
    const block = renderYaml.slice(renderYaml.indexOf(key));
    assert.match(
      block.slice(0, 120),
      /sync:\s*false/,
      `${key}에 sync: false가 없다 — 값이 저장소에 올라갈 수 있다`,
    );
  }
  // 실제 키 형태가 파일에 들어 있으면 즉시 실패시킨다.
  assert.ok(!/sk-[A-Za-z0-9_-]{20}/.test(renderYaml), 'OpenAI 키로 보이는 문자열이 있다');
});

test('프로덕션 설정이 들어 있다', () => {
  // NODE_ENV=production이라야 세션 쿠키에 Secure가 붙는다.
  assert.match(renderYaml, /key:\s*NODE_ENV\s*\n\s*value:\s*production/);
  // TRUST_PROXY를 켜지 않으면 req.ip가 프록시 주소가 되어
  // rate limit이 전체 트래픽을 한 통으로 센다.
  assert.match(renderYaml, /key:\s*TRUST_PROXY\s*\n\s*value:\s*"true"/);
});

test('인스턴스를 하나로 고정한다', () => {
  // 늘리면 세션·확인 토큰·회로차단기가 인스턴스별로 갈라진다.
  assert.match(renderYaml, /numInstances:\s*1/);
});

test('무료 플랜을 명시한다', () => {
  assert.match(renderYaml, /plan:\s*free/);
});

test('Node 버전을 고정한다', () => {
  // 안 적으면 플랫폼이 임의로 고르고 어느 날 조용히 바뀐다.
  assert.ok(packageJson.engines?.node, 'package.json에 engines.node가 없다');
  assert.match(packageJson.engines.node, /\d/);
});
```

- [ ] **Step 2: 실패를 확인한다**

실행: `node --import tsx --test tests/deployment.test.js`
기대: FAIL — `ENOENT: no such file or directory ... render.yaml`

- [ ] **Step 3: `render.yaml`을 만든다**

```yaml
# Render 배포 정의. 설계: docs/superpowers/specs/2026-09-06-deployment-design.md
#
# 대시보드에서 클릭으로 설정하면 재현되지 않고 기록도 남지 않는다.
# 이 파일이 설정의 단일 출처다.
services:
  - type: web
    name: eco-si-news-analyze
    runtime: node
    plan: free

    # 인스턴스는 하나여야 한다.
    # 세션(lib/session.js의 Map), 확인 토큰, rate limit, 회로차단기가 전부
    # 프로세스 메모리에 있다. 늘리면 견적 낸 인스턴스와 분석하는 인스턴스가
    # 달라져 정상 요청이 428로 막힌다. 설계 §4 참고.
    numInstances: 1

    # --include=dev 를 지우지 말 것.
    # vite와 @vitejs/plugin-react가 client의 devDependencies인데
    # NODE_ENV=production은 빌드 단계에도 적용된다. 플래그가 없으면
    # npm ci가 이들을 건너뛰어 'vite: not found'로 빌드가 깨진다.
    # client/dist는 .gitignore에 있어 미리 만들어 둔 산출물도 없다. 설계 §8 참고.
    buildCommand: npm ci --include=dev && npm run build:client
    startCommand: npm start

    healthCheckPath: /api/health

    envVars:
      # 세션 쿠키에 Secure가 붙는다. Render가 HTTPS를 준다.
      - key: NODE_ENV
        value: production

      # 켜지 않으면 req.ip가 프록시 주소가 되어 rate limit이
      # 전체 트래픽을 한 통으로 센다.
      - key: TRUST_PROXY
        value: "true"

      # Render 무료는 고정 아웃바운드 IP를 주지 않아 KCI 허용목록에
      # 등록할 수 없다. 비워 두면 국내 논문만 사유와 함께 비어 나가고
      # 나머지는 전부 동작한다. 설계 §6 참고.
      - key: KCI_API_KEY
        value: ""

      # 아래 둘은 Render 대시보드에서 입력한다. 저장소에 넣지 않는다.
      - key: MY_SECRET_PASSWORD
        sync: false
      - key: OPENAI_API_KEY
        sync: false

    # PORT는 설정하지 않는다. Render가 주입하고 config.port가 읽는다.
```

- [ ] **Step 4: `package.json`에 `engines`를 넣는다**

`"type": "module",` 줄 다음에 추가한다.

```json
  "engines": {
    "node": ">=22"
  },
```

로컬은 Node 24.18.0이다. 이 앱은 Node 24 전용 기능을 쓰지 않으므로 22 이상이면 동작한다.

- [ ] **Step 5: 통과를 확인한다**

실행: `node --import tsx --test tests/deployment.test.js`
기대: 7건 전부 PASS

- [ ] **Step 6: 빌드 명령이 실제로 도는지 확인한다**

계획서만 보고 넘어가지 말 것. 명령을 그대로 실행한다.

```bash
rm -rf client/dist
npm run build:client
ls client/dist/index.html
```

기대: `client/dist/index.html`이 생긴다.

`npm ci`는 `node_modules`를 지우고 다시 받느라 몇 분 걸리므로 로컬에서 돌리지 않는다.
`--include=dev`의 실효는 Task 3의 실제 배포에서 확인된다.

- [ ] **Step 7: 전체 테스트**

실행: `npm test`
기대: 530 tests / 529 pass / 0 fail / 1 skip

- [ ] **Step 8: 커밋**

```bash
git add render.yaml package.json tests/deployment.test.js
git commit -m "feat(deploy): add Render blueprint and deployment guards

설정 파일이라 테스트할 게 없어 보이지만, 지우면 조용히 깨지는 지점이
둘 있다. --include=dev를 지우면 vite가 설치되지 않아 빌드가 실패하고,
sync: false를 지우면 비밀번호와 API 키가 저장소에 올라간다.

인스턴스를 1로 고정한다. 세션과 확인 토큰이 프로세스 메모리에 있어
늘리면 정상 요청이 428로 막힌다.

Claude-Session: https://claude.ai/code/session_013RZNuJYHFTQ6M3HHXAPwJW"
```

---

## Task 2: 문서

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`

**Interfaces:**
- Consumes: Task 1의 `render.yaml`
- Produces: 배포 절차 문서. Task 3의 사용자가 이것을 보고 따라 한다

- [ ] **Step 1: `README.md`에 배포 절을 추가한다**

"## 실행" 절 뒤에 넣는다.

```markdown
## 배포

Render 무료 인스턴스에 올린다. 설정은 저장소의 `render.yaml`이 단일 출처다.
설계 근거는 `docs/superpowers/specs/2026-09-06-deployment-design.md`에 있다.

### 절차

1. [render.com](https://render.com)에서 GitHub 저장소를 연결한다 (비공개 저장소도 된다)
2. Blueprint로 `render.yaml`을 읽히거나, 안 되면 대시보드에 같은 값을 넣는다
3. 대시보드 Environment에 비밀값 둘을 넣는다 — 저장소에는 없다

   | 변수 | 값 |
   |---|---|
   | `MY_SECRET_PASSWORD` | 로그인 비밀번호. **공개 인터넷이므로 길게 잡는다** |
   | `OPENAI_API_KEY` | OpenAI 키 |

4. 배포 후 확인한다

   ```bash
   curl https://<앱이름>.onrender.com/api/health          # llmMode: live
   ./scripts/verify-research.sh https://<앱이름>.onrender.com
   MY_SECRET_PASSWORD=<값> ./scripts/verify.sh https://<앱이름>.onrender.com
   ```

**첫 요청은 약 1분 걸린다.** 정지 상태에서 깨어나는 시간이다. 검증 스크립트가
타임아웃으로 실패하면 결함이 아니므로, 먼저 `/api/health`를 한 번 불러 깨워 두고 시작한다.

### 무료 인스턴스의 한계

1. **예산 파일이 휘발한다.** 정지·재배포마다 `.budget.json`이 사라져 하루 50회·월 상한
   카운터가 0으로 돌아간다. **실제 지출 상한은 OpenAI 계정 Billing에서 걸어야 한다.**
   앱 예산은 한 세션 안에서만 유효하다
2. **15분 유휴 후 정지한다.** 다시 깨우는 데 약 1분
3. **KCI를 쓸 수 없다.** 아웃바운드 IP가 유동이라 허용목록에 등록할 수 없다.
   한국어 검색어의 논문은 사유와 함께 비어 나간다
4. **월 750 instance-hours.** 개인 사용에는 넉넉하지만 계속 깨워 두면 한도에 붙는다
5. **인스턴스를 늘리면 안 된다.** 이유는 `docs/architecture.md` 참고
6. **비밀번호 하나가 유일한 인증이고 공개 인터넷에 노출된다**

1·2·3이 거슬리면 Fly.io로 옮긴다. 항상 켜진 소형 머신 월 $2~3, 볼륨 $0.15/GB,
전용 IPv4 $2로 세 가지를 모두 푼다.
```

또한 환경변수 표의 `TRUST_PROXY` 행 설명을 고친다.

```markdown
| `TRUST_PROXY` | `false` | 프록시·로드밸런서 뒤에 두면 `true`. **배포 시 반드시 켠다** — 안 켜면 `req.ip`가 프록시 주소가 되어 rate limit이 전체 트래픽을 한 통으로 센다 |
```

- [ ] **Step 2: `docs/architecture.md`에 상태와 인스턴스 제약을 적는다**

파일 끝에 추가한다.

```markdown
---

## 상태는 어디에 사는가 — 인스턴스는 하나여야 한다

이 서버는 다음을 **프로세스 메모리와 로컬 파일**에 들고 있다.

| 무엇 | 어디에 |
|---|---|
| 세션 | `lib/session.js`의 `Map` |
| 확인 토큰 | `createTtlCache` (메모리) |
| rate limit 카운터 | express-rate-limit의 기본 MemoryStore |
| 분석 캐시·수집 캐시 | `createTtlCache` (메모리) |
| 회로차단기·세마포어·중복 병합 | 클로저 변수 |
| 예산 사용량 | `.budget.json` (로컬 파일) |

**따라서 인스턴스를 하나로 유지해야 한다.** 늘리면 이런 일이 벌어진다.

- 견적을 낸 인스턴스와 분석을 처리하는 인스턴스가 달라 **확인 토큰이 `428`로 거부된다.**
  비용 방어가 정상 요청을 막는 방향으로 고장 난다
- 로그인이 임의로 풀린다
- rate limit이 인스턴스마다 따로 세어 실효 한도가 몇 배가 된다
- 회로차단기가 상류 장애를 인스턴스별로 따로 학습한다

이것은 성능 문제가 아니라 **정확성 문제**다. Render 무료는 오토스케일링이 Pro 이상이라
기본적으로 하나지만, 수동 확장은 모든 요금제에서 가능하므로 **실수로 늘릴 수 있다.**

확장이 필요해지면 세션·확인 토큰·rate limit·예산을 외부 저장소로 옮기는 작업이 선행되어야 한다.
그 전에는 인스턴스를 늘리지 않는다.
```

- [ ] **Step 3: 문서에 깨진 링크가 없는지 확인한다**

```bash
grep -o 'docs/[a-z0-9./-]*\.md' README.md docs/architecture.md | cut -d: -f2 | sort -u | while read -r f; do
  [ -f "$f" ] || echo "없는 파일: $f"
done
echo "확인 끝"
```

기대: "없는 파일" 줄이 나오지 않는다.

- [ ] **Step 4: 전체 테스트**

실행: `npm test`
기대: 530 tests / 529 pass / 0 fail / 1 skip

- [ ] **Step 5: 커밋**

```bash
git add README.md docs/architecture.md
git commit -m "docs: document deployment procedure and single-instance constraint

인스턴스를 늘리면 안 되는 이유를 architecture.md에 남긴다. 성능 문제가
아니라 정확성 문제다 — 확인 토큰이 428로 정상 요청을 막게 된다.

무료 인스턴스의 한계 여섯 가지를 README에 적는다. 특히 예산 카운터가
재시작마다 리셋되므로 실제 상한은 OpenAI 계정에서 걸어야 한다.

Claude-Session: https://claude.ai/code/session_013RZNuJYHFTQ6M3HHXAPwJW"
```

---

## Task 3: 실제 배포와 검증 — 사용자 행동이 필요하다

**Files:**
- 없음 (플랫폼 작업)

**Interfaces:**
- Consumes: Task 1의 `render.yaml`, Task 2의 README 절차
- Produces: 배포 URL, 확인된 사실 3가지 (Blueprint 지원 여부, `numInstances` 허용 여부, 실제 Node 버전)

**이 태스크는 코드로 끝나지 않는다.** Render 계정 연결과 비밀값 입력은 사용자가 직접 한다.

- [ ] **Step 1: 브랜치를 푸시한다**

```bash
git push -u origin feature/deployment
```

Render가 저장소에서 `render.yaml`을 읽어야 하므로 원격에 있어야 한다.

- [ ] **Step 2: 사용자가 Render에 저장소를 연결한다**

1. [render.com](https://render.com) 로그인
2. New → Blueprint → GitHub 저장소 `kimcheolhui9846/eco-si-news-analyze` 선택
3. 브랜치를 `feature/deployment`로 지정 (병합 전에 먼저 확인하기 위함)

**Blueprint가 무료 플랜에서 안 되거나 `numInstances`가 거부되면** New → Web Service로
만들고 `render.yaml`의 값을 대시보드에 직접 넣는다. 어느 쪽이었는지 기록한다 — Task 4에서 문서에 남긴다.

- [ ] **Step 3: 사용자가 비밀값 둘을 입력한다**

Render 대시보드 → Environment

| 변수 | 값 |
|---|---|
| `MY_SECRET_PASSWORD` | 로그인 비밀번호. 로컬의 8자보다 길게 잡는다 |
| `OPENAI_API_KEY` | `.env`에 넣은 것과 같은 키 |

**이 값들을 대화창에 붙여넣지 않는다.** 대시보드에만 입력한다.

- [ ] **Step 4: 빌드 로그를 확인한다**

배포가 끝나면 로그에서 두 가지를 본다.

1. `vite build`가 성공했는가 — 실패하면 `--include=dev`가 빠진 것이다
2. Node 버전이 몇인가 — `engines`가 먹혔는지 확인하고 기록한다

빌드가 `vite: not found`로 실패하면 `render.yaml`의 `buildCommand`를 확인한다.

- [ ] **Step 5: health 확인 (비용 0)**

```bash
curl -sS --max-time 120 https://<앱이름>.onrender.com/api/health
```

기대: `{"status":"ok","llmMode":"live","time":"..."}`

**첫 요청은 약 1분 걸린다.** `--max-time 120`을 준 이유다.

- [ ] **Step 6: 수집·분석 경로 검증 (live 서버에서는 유료 분석 1회 포함, 비용 가변)**

```bash
./scripts/verify-research.sh https://<앱이름>.onrender.com
```

기대: 통과 14 / 실패 0

한국어 질의 단계에서 KCI 사유가 "국내 논문 검색에는 KCI API 키가 필요합니다"로 나오면
정상이다 — 키를 비워 뒀기 때문이다.

- [ ] **Step 7: 실호출 검증 (약 $0.005)**

```bash
MY_SECRET_PASSWORD=<대시보드에 넣은 값> ./scripts/verify.sh https://<앱이름>.onrender.com
```

기대: 통과 9 / 실패 0, `degraded=false`

- [ ] **Step 8: 브라우저 확인**

`https://<앱이름>.onrender.com`에 접속해 로그인 → 수집 → 승인 → 보고서까지 한 번 돈다.
분석 버튼을 누르면 약 $0.005가 든다.

**어느 단계든 실패하면 여기서 멈추고 고친다.** 원본 요구사항 §1-7 — 동작하지 않는 기능을
완료로 보고하지 않는다.

---

## Task 4: 결과 기록과 PR

**Files:**
- Modify: `docs/SESSION-HANDOFF.md`
- Modify: `render.yaml` (Task 3에서 대시보드로 우회했다면 그 사실을 주석으로)

**Interfaces:**
- Consumes: Task 3의 배포 URL과 확인된 사실 3가지
- Produces: PR

- [ ] **Step 1: `docs/SESSION-HANDOFF.md`를 갱신한다**

§1 표에 행을 더한다.

```markdown
| 배포 (Render 무료) | ✅ 완료 — <URL> |
```

그리고 §6 환경 정보에 배포 정보를 더한다. **아래 대괄호 값은 Task 3에서 실제로 확인한 것으로 채운다.**

```markdown
### 배포

- URL: `https://<앱이름>.onrender.com`
- 플랫폼: Render 무료 웹 서비스, 리전 [확인값]
- 설정 출처: `render.yaml` (Blueprint 사용 [됨/안 됨 — 안 되면 대시보드 수동 설정])
- `numInstances: 1` [적용됨 / 무료 플랜에서 거부되어 문서로만 제약]
- 배포된 Node 버전: [확인값]
- 비밀값 2개(`MY_SECRET_PASSWORD`, `OPENAI_API_KEY`)는 대시보드에만 있다

**인스턴스를 늘리지 말 것.** 이유는 `docs/architecture.md` 참고.
```

§8 미해결 항목에 더한다.

```markdown
- **배포 환경에서 예산 카운터가 재시작마다 리셋된다.** Render 무료는 파일시스템이
  휘발성이다. 실제 지출 상한은 OpenAI 계정 Billing에서 걸어야 하며, 앱의 월 상한
  (`MONTHLY_COST_LIMIT_USD`, 현재 5)과 계정 한도를 같은 값으로 맞춰 두는 편이 헷갈리지 않는다
- **배포 환경에서 KCI를 쓸 수 없다.** 아웃바운드 IP가 유동이다. 필요해지면 Fly.io
  전용 IPv4($2/월)로 옮긴다. `scripts/verify-kci.sh`는 그때 그 서버에서 돌린다
```

- [ ] **Step 2: Blueprint를 못 썼다면 `render.yaml`에 기록한다**

Task 3에서 대시보드로 우회했다면 파일 맨 위 주석에 한 줄 더한다.

```yaml
# 주의: Render 무료 플랜에서 Blueprint가 동작하지 않아 대시보드로 설정했다(2026-09-06 확인).
# 이 파일은 그 설정의 기록이다. 값을 바꾸면 대시보드도 함께 바꿔야 한다.
```

Blueprint가 잘 동작했다면 이 단계를 건너뛴다.

- [ ] **Step 3: 전체 테스트**

실행: `npm test`
기대: 530 tests / 529 pass / 0 fail / 1 skip

- [ ] **Step 4: 커밋과 푸시**

```bash
git add docs/SESSION-HANDOFF.md render.yaml
git commit -m "docs: record deployment result

Claude-Session: https://claude.ai/code/session_013RZNuJYHFTQ6M3HHXAPwJW"
git push
```

- [ ] **Step 5: PR 생성**

```bash
gh pr create --base main --head feature/deployment \
  --title "배포: Render 무료 인스턴스" \
  --body-file "$SCRATCH/pr-body.md"
```

`$SCRATCH`는 이 세션의 스크래치패드 디렉터리다. 본문을 파일로 쓰고 넘긴다 —
셸에 긴 한글을 직접 넣으면 콘솔 인코딩(CP949)에서 깨진다.

본문에 담을 것:

- Vercel을 쓰지 않은 이유 (세션·확인 토큰이 메모리에 있어 인스턴스가 갈리면 정상 요청이 428)
- Render를 고른 근거 (오토스케일링이 Pro 이상이라 인스턴스가 하나로 유지된다)
- 빌드 함정 (`--include=dev`)과 그것을 고정한 테스트
- 배포 URL과 검증 결과 (health / verify-research 14 / verify 9, `degraded=false`)
- 한계 6가지
- 확인된 사실 3가지 (Blueprint 지원, `numInstances` 허용, Node 버전)
- 마지막 줄: `https://claude.ai/code/session_013RZNuJYHFTQ6M3HHXAPwJW`

---

## 완료 기준 점검 (스펙 §12)

Task 4까지 끝난 뒤 하나씩 확인한다. 하나라도 어긋나면 완료로 보고하지 않는다.

- [ ] `render.yaml`이 저장소에 있고 실제 배포가 그 정의로 이루어졌다 (또는 대시보드 우회 사실이 기록됐다)
- [ ] 배포 URL에서 `/api/health`가 `llmMode: live`를 반환한다
- [ ] `verify-research.sh`가 배포 URL 대상으로 전부 통과한다
- [ ] `verify.sh`가 배포 URL 대상으로 전부 통과하고 `degraded=false`다
- [ ] 브라우저에서 로그인부터 보고서까지 한 번 성공한다
- [ ] 배포된 Node 버전을 로그로 확인해 기록했다
- [ ] `README.md`에 배포 절차와 환경변수 표가 있다
- [ ] `docs/architecture.md`에 "인스턴스 1개" 제약과 이유가 있다
- [ ] `docs/SESSION-HANDOFF.md`에 배포 URL과 한계가 기록됐다
- [ ] 기존 523개 + 신규 7개 테스트가 전부 통과한다
- [ ] PR 생성
