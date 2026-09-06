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
