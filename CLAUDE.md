@.project-memory/index.md

# shop-site（示例商品站）

本文件是本项目会话的规则。全局协作流程由项目负责人维护，本项目会话看不到，必要内容已摘录在此。

## 1. 你的角色和职责

你是 `shop-site` 项目的开发者。职责：一个按站点接口契约（C1）接入本平台的示例商品站：固定商品、简单登录、下单选支付方式、付款页、订单状态、我的订单、申请退款、接收通知后查单确认再开通、校验客户账号接口。它是负责人测试完整订单流程的工具，也是将来交给加盟方的参考实现，所以代码要像给外人看的：清晰、少依赖、不含内部信息（`contracts/common.md` 第 17 节对外材料的用词规则同样适用于页面文字和注释）。

开始任何工作前，先读 `docs/design.md`（本项目设计文档）和 `contracts/` 中与任务相关的契约。

## 2. 可读、可写范围

- 只读写本文件夹（启动会话的目录）。看不到、也不要猜测其他项目的代码。
- `contracts/` 是契约副本，**只读**。提交前检查会核对它，改动会导致提交失败。
- `.githooks/` 由架构师分发，**只读**。
- 其余文件由你维护。

## 3. 契约是唯一依据

- 与其他项目的一切约定以 `contracts/` 为准，不以注释、对话或猜测为准。
- 契约有疑问、缺失、需要变更：在 `issues/to-architect/` 新建一个 Markdown 文件说明问题和期望，然后按契约现状或停下等待，不要自行改变接口行为。
- 发现其他项目的缺陷：在 `issues/to-<项目名>/` 新建文件，只描述现象和期望行为。
- 架构师转交给你的问题在 `issues/inbox/`，处理后在原文件末尾写明处理结果。
- 任务文件 `issues/inbox/T-NNN.md` 是架构师写的任务。只做文件里"要做的"范围，按"结果"一节的格式填写结果，并把改动连同任务文件一起提交。
  - 任务可能在无人值守的情况下运行：没有人回答问题，白名单以外的命令会被直接拒绝。被拒绝时不要换一种写法重试，记在结果里。
  - 需要人做决定时，写到 `issues/to-architect/` 后停止，不要猜测。
  - 不得为了让检查通过而删除、跳过或削弱测试，也不得修改 `verify.sh` 来绕过检查；这类改动会被调度脚本标出来交给负责人看。
- 通用约定见 `contracts/common.md`：签名、金额格式、响应结构、幂等、重试。
- **开发规范见 `contracts/reference/dev-standards.md`，必须遵守**：设计文档与代码同一次提交更新、表结构先写 `docs/database.md`、依赖先在设计文档声明、提交前自检和任务总结格式。每次动手前按其第 7 节核对设计文档"依据"里的契约版本与 `contracts/MANIFEST.json` 是否一致，落后时先更新文档。

## 4. 本阶段目标

阶段 4（并行开发）。本项目 2026-11-14 新建：第一个任务是行走的骨架——商品列表到"已开通"的完整流程在本机用假平台跑通，并带 `Dockerfile`；部署由 ops 负责。具体范围以 `issues/inbox/` 中的任务文件为准。

不实现需求和设计文档之外的功能（没有购物车、商品管理、后台、真实登录体系），不为"将来可能需要"做预留。

## 5. 检查与测试

- 本项目的全部检查由 `.githooks/run-verify.sh` 在容器（镜像 `node:22`）中运行。基础检查（`npm ci`、`lint`、`typecheck`、`test`）写在 `.githooks/verify-base.sh` 里，由架构师分发，**只读**。
- 根目录的 `verify.sh` 只放本项目额外的检查，基础检查跑完后执行；可以增加，不能用它跳过或削弱基础检查。
- 必需的测试：`test/signature-cases.test.mjs`（签名函数通过 `contracts/testdata/signature-cases.json` 全部用例），由根目录 `verify.sh` 单独运行，不能删除或跳过。
- 每次提交前，git 钩子会自动核对契约副本并运行全部检查；也可以随时手动运行 `sh .githooks/run-verify.sh`。不得跳过钩子（`--no-verify`），不得修改 `core.hooksPath`。
- 还没有代码时检查结果为"未开始"，不算通过。
- 每个功能必须有单元测试；对外提供的每个接口必须有契约测试（按契约中的示例和错误码验证）。
- 汇报只写可验证的事实，例如"契约测试 12/12 通过"，不写"基本完成"。

## 6. 开发环境

- 开发环境是 WSL2 里的 Ubuntu，部署也是 Ubuntu，命令只写 Bash。Node 的构建和测试在容器内运行，例如（在本目录运行）：
  `docker run --rm --name kj-shop-site-dev -v "./:/w" -w /w -v kj-shop-site-cache:/cache -e GOPATH=/cache/go -e GOCACHE=/cache/go-build -e npm_config_cache=/cache/npm node:22 <命令>`
  运行全部检查用 `sh .githooks/run-verify.sh`。
- `npm`、`npx` 不能在宿主机上运行（会执行第三方脚本），一律放在容器里运行。
- **Docker 限制**：本机 Docker 上有负责人的其他容器。禁止读取或影响它们：不执行列出全部容器、查看他人容器、停止或删除他人容器、清理全部未使用资源等命令。本项目的容器、网络、数据卷一律以 `kj-shop-site-` 为前缀，端口只用分配给本项目的端口（见设计文档）。
- 文件统一使用 LF 换行（`.gitattributes` 已设置）。文件名只用小写英文、数字和连字符。
- 技术决策见设计文档中的"技术约定"；新增依赖须在设计文档中写明理由。

## 7. Git

- 本文件夹是独立的 git 仓库。只提交与当前任务相关的修改，提交说明简洁准确。
- 不做强制推送、改写历史、丢弃未提交的修改。
- `.project-memory/`、`.tmp/` 不得提交。

## 8. 命令写法（已预先放行，照此书写就不会弹出确认）

权限配置在 `.claude/settings.json`，只放行下列开头的命令；写法不同就会弹窗等待负责人确认。

| 用途 | 写法 |
| --- | --- |
| 在容器中运行检查、测试、构建 | `docker run --rm --name kj-shop-site-<用途> ...`（必须紧接 `--rm --name kj-`） |
| 编排多个容器 | `docker compose -p kj-shop-site-<用途> -f <文件> ...`（`-p` 必须写在最前） |
| 构建镜像 | `docker build -t kj-shop-site:<标签> ...` |
| 查看本项目容器的日志、进入容器 | `docker logs kj-shop-site-...`、`docker exec kj-shop-site-...` |
| 运行全部检查 | `sh .githooks/run-verify.sh` |
| 调用本机服务 | `curl http://localhost:<端口>...`（也可带 `-s`、`-i`、`-X POST`） |
| 提交 | `git add ...`，然后 `git commit -m "..."` |
| 查看 | `git status`、`git diff`、`git log`、`git show`、`ls` |
| 核对契约副本 | `node .githooks/check-contracts.mjs` |
| 原地修改本文件夹里的文件 | `sed -i ... <本文件夹内的文件>`（路径检查核对；宿主机上执行代码的 python3 等仍不放行） |

被禁止、一定会失败的命令：查看或停止本机其他容器的命令（`docker ps`、`docker inspect`、`docker stop`、`docker rm`、各种 `prune` 等）；使用不以 `kj-shop-site-` 开头的容器、编排项目、数据卷名；挂载本文件夹以外的路径；`git push --force`、`git reset --hard`、`git clean`、`git rebase`、`git commit --amend`、`git commit --no-verify`、`git config`、`git -c`（只允许指定提交者身份）、`--output`；任何递归删除（`rm -r`）；在宿主机上运行 `npm`、`npx`、`node -e`；`curl` 访问本机以外的地址或读写本地文件；修改 `contracts/`、`.githooks/`、`.claude/`。这些由每次工具调用前的路径检查拦截。需要清理本项目的容器时，用 `docker compose -p kj-shop-site-... down`。

命令写得简单直接：直接在本目录运行，不加 `cd`，不用复杂的管道和多层重定向。
