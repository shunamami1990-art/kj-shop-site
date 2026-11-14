#!/bin/sh
# 本项目额外的检查。基础检查（npm ci、lint、typecheck、test）由 .githooks/verify-base.sh 执行，跑完后才执行本文件。
# 在容器中运行；可以增加检查，不能用本文件跳过或削弱基础检查。
set -e

# 必需的测试：签名函数必须通过契约标准用例（T-001 起）
if [ -f test/signature-cases.test.mjs ]; then
  node --test test/signature-cases.test.mjs
fi

# 面向外部的内容不得出现"子平台""总平台"（common.md 第 17 节）
if [ -d app ] && grep -rnE "子平台|总平台" app lib README.md 2>/dev/null; then
  echo "app/、lib/、README.md 不得含\"子平台\"\"总平台\"" >&2
  exit 1
fi
