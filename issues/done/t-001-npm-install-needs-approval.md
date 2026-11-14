# T-001 被阻塞：容器里的 `npm install` 需要人工批准

- 来源：shop-site 会话，任务 T-001
- 现象：任务第 1 项要求在容器里 `npm install` 生成 `package-lock.json`。无人值守运行时，下面两条命令都返回"This command requires approval"（等于被拒绝），没有执行：
  1. `docker run --rm --name kj-shop-site-install -v "./:/w" -w /w -v kj-shop-site-cache:/cache -e npm_config_cache=/cache/npm node:22 npm install next@15 react@19 react-dom@19 qrcode`
  2. CLAUDE.md 第 6 节给出的写法：`docker run --rm --name kj-shop-site-dev -v "./:/w" -w /w -v kj-shop-site-cache:/cache -e GOPATH=/cache/go -e GOCACHE=/cache/go-build -e npm_config_cache=/cache/npm node:22 npm install ...`
- 影响：没有 `package-lock.json`，`.githooks/verify-base.sh` 的 `npm ci` 必然失败，提交钩子无法通过；容器内的构建、测试也都跑不了。没有任何可验证的结果，所以没有写代码。
- 期望：请在 `.claude/settings.json` 里确认放行 `docker run --rm --name kj-shop-site-* ...` 的写法（可能是 `-v "./:/w"` 相对路径挂载、或 `npm install` 子命令触发了路径检查），或由负责人批准后重新运行本任务。
- 已确认的前提（无需再查）：契约版本 `contracts/MANIFEST.json` 为 0.15.3，与 `docs/design.md` 依据一致。
- 另外发现设计初稿的一处与契约不符（不阻塞，下次实现时按此修改设计文档）：`docs/design.md` 第 3 节写"支付方式 `wechat`、`alipay`、`usdt`、`shop`"，但 `site-api.yaml` 的 `CreateOrderRequest.payMethod` 只允许 `wechat`、`alipay`、`usdt`；`shop` 只出现在订单的返回值里（店铺码按金额档自动分配）。实现时下单页只提供前三种，CNY 商品用 `wechat`/`alipay`，USDT 商品用 `usdt`。

## 处理结果（架构师 2026-11-14）

- 根本原因不是放行规则：调度日志报"projects/shop-site 还没有被信任，项目的放行规则没有生效"，新文件夹要负责人交互打开一次 claude 并选择信任；之后 .claude/settings.json 里以 kj-shop-site- 为前缀的容器命令写法即生效。已请负责人处理，T-001 重跑。
- 设计第 3 节的支付方式已按契约改为 `wechat`、`alipay`、`usdt`（第 9 节记了变更）。
