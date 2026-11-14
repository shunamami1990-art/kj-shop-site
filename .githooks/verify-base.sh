#!/bin/sh
# 基础检查，在容器中运行。由架构师分发，项目内不要修改；项目自己的额外检查写在项目根目录的 verify.sh。
# 输出的最后一行是 KJ-STATUS: no-code（还没有代码）或 KJ-STATUS: passed，全量验证据此区分"未开始"和"通过"。
set -e

required=$(cat .githooks/required-tests 2>/dev/null || true)

if command -v go >/dev/null 2>&1; then
  if [ ! -f go.mod ]; then
    echo "KJ-STATUS: no-code"
    exit 0
  fi
  unformatted=$(gofmt -l .)
  if [ -n "$unformatted" ]; then
    echo "以下文件未格式化："
    echo "$unformatted"
    exit 1
  fi
  go vet ./...
  # 按契约生成的代码必须与提交的一致（ADR-017）：在副本上重新生成后比较，不改动工作区
  if grep -q 'oapi-codegen' go.mod && [ -d internal/api ]; then
    rm -rf /tmp/kj-regen
    cp -r "$(pwd)" /tmp/kj-regen
    (cd /tmp/kj-regen && go generate ./...)
    if ! diff -r -q internal/api /tmp/kj-regen/internal/api; then
      echo "按契约生成的代码与提交的不一致：请在容器里运行 go generate ./... 后一起提交"
      exit 1
    fi
  fi
  # distribution.json 的 race 为 true 的项目（core、org，backlog B-05）全部测试带竞争检测
  if [ -f .githooks/race ]; then
    go test -race ./...
  else
    go test ./...
  fi
  # 必需的测试：名字以下列前缀开头的测试必须存在并且通过（见开发规范第 8 节）
  if [ -n "$required" ]; then
    pattern=$(echo $required | tr ' ' '|')
    go test ./... -count=1 -v -run "^(${pattern})" > /tmp/kj-required.log 2>&1 || {
      cat /tmp/kj-required.log
      exit 1
    }
    # 必需的测试里有任何一项被跳过都算失败，否则用 t.Skip 就能绕过验收
    if grep -q -- "--- SKIP:" /tmp/kj-required.log; then
      grep -- "--- SKIP:" /tmp/kj-required.log
      echo "必需的测试中有被跳过的项目"
      exit 1
    fi
    for name in $required; do
      if ! grep -q -- "--- PASS: ${name}" /tmp/kj-required.log; then
        echo "缺少必需的测试，或没有通过：${name}"
        exit 1
      fi
    done
  fi
else
  if [ ! -f package.json ]; then
    echo "KJ-STATUS: no-code"
    exit 0
  fi
  npm ci
  # 按契约生成的类型必须与提交的一致（ADR-017）
  if grep -q '"generate"' package.json && [ -d src/api/generated ]; then
    rm -rf /tmp/kj-regen
    cp -r "$(pwd)" /tmp/kj-regen
    (cd /tmp/kj-regen && npm run generate)
    if ! diff -r -q src/api/generated /tmp/kj-regen/src/api/generated; then
      echo "按契约生成的类型与提交的不一致：请在容器里运行 npm run generate 后一起提交"
      exit 1
    fi
  fi
  npm run lint
  npm run typecheck
  npm test
fi

if [ -f verify.sh ]; then
  sh verify.sh
fi
echo "KJ-STATUS: passed"
