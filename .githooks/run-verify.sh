#!/bin/sh
# 在容器中运行本项目的全部检查。由架构师分发，项目内不要修改。
# 由提交前检查和根目录的全量验证调用，在项目根目录运行。有数据库的项目附带一个临时的 PostgreSQL。
set -e

project=$(cat .githooks/project)
image=$(cat .githooks/image)
run="${KJ_RUN_ID:-$$}"
name="kj-$project-verify-$run"
cache="kj-$project-cache"

if [ ! -f go.mod ] && [ ! -f package.json ]; then
  echo "KJ-STATUS: no-code"
  exit 0
fi

docker volume create "$cache" >/dev/null

if [ -f .githooks/verify-compose.yaml ]; then
  export KJ_IMAGE="$image" KJ_CACHE="$cache"
  set +e
  docker compose -p "$name" -f .githooks/verify-compose.yaml run --rm check
  status=$?
  docker compose -p "$name" -f .githooks/verify-compose.yaml down -v >/dev/null 2>&1
  exit $status
fi

exec docker run --rm --name "$name" -v "$(pwd):/w" -v "$cache:/cache" -w /w \
  -e GOPATH=/cache/go -e GOCACHE=/cache/go-build -e npm_config_cache=/cache/npm -e GOFLAGS="${KJ_GOFLAGS:-}" \
  "$image" sh .githooks/verify-base.sh
