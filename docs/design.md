# shop-site（示例商品站）设计文档

- 用途：本项目的职责、页面与接口、模块划分、关键流程、技术约定、测试清单。代码必须与本文件一致（开发规范第 1 节）。
- 状态：初稿（架构师 2026-11-14 写；项目会话接手后由项目会话维护）
- 依据：契约 v0.15.3（`contracts/site-api.yaml`、`contracts/common.md` 第 1～9、17 节、`contracts/testdata/signature-cases.json`；每次动手前与 `contracts/MANIFEST.json` 核对，落后时先按开发规范第 7 节更新）

## 1. 职责与边界

一个按站点接口（C1）接入本平台的**示例商品站**：负责人用它在沙箱和正式环境走完整的订单流程（下单 → 付款 → 通知 → 查单确认 → 开通 → 退款），将来作为参考实现交给加盟方的开发者。

- 依赖：只调用平台的站点接口（`POST /v1/orders`、`/v1/orders/query`、`/v1/refunds`、`/v1/refunds/query`），只接收平台的通知和校验客户账号请求。不调用任何内部接口，不读其他项目的代码。
- 被谁依赖：负责人（测试）、ops（部署：本项目只提供 `Dockerfile` 和环境变量清单）、将来的加盟方。
- 不做：购物车、商品管理、后台、真实的账号体系（登录只输入账号名）、多语言、支付以外的业务。
- 对外性：页面文字、代码、注释按 `common.md` 第 17 节对外材料的规则写（只说"平台"，不出现内部岗位、流程、项目名）。

## 2. 对外接口

| 方向 | 接口 | 说明 |
| --- | --- | --- |
| 本站 → 平台 | C1 `createOrder`、`queryOrder`、`createRefund`、`queryRefund` | `lib/kj-client.js`，每次请求签名、回复验签 |
| 平台 → 本站 | C1 `orderEvent`（通知地址 `/api/kj/notify`） | 验签、按 `eventId` 去重、`order.paid` 先查单确认再开通、回复 `success` |
| 平台 → 本站 | C1 `verifyCustomer`（校验客户账号地址 `/api/kj/verify-customer`） | 验签、查本地客户、签名回复 |

通知地址和校验客户账号地址由平台在后台为站点配置为 `https://<本站域名>/api/kj/notify`、`https://<本站域名>/api/kj/verify-customer`。

## 3. 页面与路由

| 路径 | 内容 |
| --- | --- |
| `/` | 商品列表：固定商品表（服务端常量，至少 3 个 CNY、1 个 USDT），每个商品一个"购买"按钮；未登录时先跳转登录 |
| `/login` | 输入账号名（即客户账号 `customerAccount`，1～64 个字符）即登录，写 HttpOnly cookie；无密码（示例用） |
| `/buy/<商品编号>` | 选支付方式（`wechat`、`alipay`、`usdt`、`shop`），提交后服务端按商品表定价、记本地订单、调用 `createOrder`，跳到付款页 |
| `/pay/<siteOrderNo>` | 付款页：按 `payment.type` 展示（`qrcode` 用本地生成二维码图片；`url`/`url_qrcode` 给跳转按钮和二维码；`usdt` 显示网络、地址、应付金额并提示精确转账；`qrcodeImage` 直接显示；其他 `type` 提示换支付方式）；显示订单金额与应付金额；每 3 秒调用本站 `/api/orders/<siteOrderNo>` 刷新状态，`paid` 且已开通时显示"已开通" |
| `/orders` | 我的订单：当前账号的订单（站点订单号、商品、金额、币种、支付方式、状态、是否已开通、时间），每行"查看"和"申请退款"（已支付且可退金额大于 0 时） |
| `/orders/<siteOrderNo>` | 订单详情：本地记录 + 调用 `queryOrder` 的最新结果（`orderNo`、`status`、`paidAmount`、`refundedAmount`、`expireAt`）、退款记录、"申请退款"（金额、原因） |
| `/api/pay` | POST `{ productId, payMethod }`，金额和币种只看服务端商品表（来自接入文档 Next.js 示例的"去支付"） |
| `/api/orders/<siteOrderNo>` | GET，本站订单状态（本地 + 查单）；只返回当前账号自己的订单 |
| `/api/refund` | POST `{ siteOrderNo, amount, reason }`，生成 `siteRefundNo`，调用 `createRefund` |
| `/api/kj/notify` | 平台通知地址（第 2 节） |
| `/api/kj/verify-customer` | 校验客户账号地址（第 2 节）；账号存在的定义：本地 `customers` 表里有（登录过一次即有） |
| `/healthz` | 存活检查，200 |

## 4. 模块划分

| 目录 | 内容 |
| --- | --- |
| `lib/kj-sign.js`、`kj-client.js`、`kj-notify.js`、`kj-payment.js`、`kj-verify-customer.js` | 来自接入文档的 Next.js 示例（2026-11-14 复制，已通过标准用例），按需小改；改动记在本文件第 9 节 |
| `lib/config.js` | 环境变量：`KJ_BASE_URL`（接口地址，`https://<平台域名>`，不带路径）、`KJ_SITE_ID`、`KJ_SECRET`、`SHOP_DB_PATH`（SQLite 文件路径，默认 `./data/shop.db`）、`SHOP_SESSION_SECRET`（签 cookie）、`PORT`（默认 18120） |
| `lib/db.js` | SQLite（`node:sqlite`，Node 22 内置，不加原生依赖）：建表、本地订单、退款、开通记录、事件去重、随机串、客户 |
| `lib/products.js` | 固定商品表（编号、名称、价格字符串、币种） |
| `lib/session.js` | 登录 cookie（HMAC 签名的账号名） |
| `app/` | Next.js App Router 页面与路由（第 3 节） |
| `test/` | `node --test`：签名标准用例（必需测试 `signature-cases`）、通知处理（查单不是 `paid`/金额不符/重复 `eventId`/并发只开通一次）、`/api/pay` 定价不信任浏览器、校验客户账号验签与回复签名、付款页对 `payment` 的处理；用独立实现的假平台（不复用 `lib/kj-sign.js`） |
| `Dockerfile` | 多阶段：`node:22@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8` 构建（`next build`），`node:22-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d` 运行（`next start`，`USER node`，`HEALTHCHECK` 请求 `/healthz`）；数据目录 `/data` 由编排挂卷 |

## 5. 表结构（SQLite，`lib/db.js` 建表）

| 表 | 列 | 说明 |
| --- | --- | --- |
| `customers` | `account`（主键）、`created_at` | 登录过的账号 |
| `orders` | `site_order_no`（主键）、`account`、`product_id`、`amount`、`currency`、`pay_method`、`order_no`、`status`（本地：`created`、`paid`、`closed`）、`payment_json`、`created_at`、`updated_at` | 本地订单；`amount`、`currency` 下单前写入，通知核对用 |
| `fulfillments` | `order_no`（主键）、`site_order_no`、`account`、`amount`、`currency`、`created_at` | 开通记录；唯一键插入 + 同一事务写业务，保证只开通一次（接入文档《开通的原子写法》） |
| `events` | `event_id`（主键）、`received_at` | 通知去重，开通事务提交后写入 |
| `nonces` | `nonce`（主键）、`seen_at` | 平台请求的随机串，10 分钟内重复拒绝；定期清理 |
| `refunds` | `site_refund_no`（主键）、`site_order_no`、`refund_no`、`amount`、`status`、`reason`、`created_at`、`updated_at` | 本站申请的退款；`refund.*` 通知更新状态 |

## 6. 关键流程

1. 购买：登录态取账号 → `/api/pay` 按商品表定价 → 写 `orders`（`created`） → `createOrder`（`siteOrderNo` 为 `S` + 时间 + 随机）→ 保存 `orderNo`、`payment` → 跳付款页。`createOrder` 网络错误或回复验签失败回 502，平台 `INTERNAL_ERROR`/`UNAVAILABLE` 回 503，业务错误码原样显示给用户（`PAY_METHOD_UNAVAILABLE`、`AMOUNT_OUT_OF_RANGE` 等有中文说明）。
2. 通知：验签（站点编号、5 分钟、随机串 10 分钟、签名）→ `eventId` 已有则直接 `success` → `order.paid`：`queryOrder` 确认 `paid`、`amount`/`currency` 与本地相同（`source` 为 `paycode`/`shop` 时本地无记录，按查单返回的 `customerAccount`、`amount` 建一条订单并开通）→ 事务里插 `fulfillments` + 更新 `orders.status` → 记 `eventId` → `success`；不通过时记日志、不回 `success`。`refund.succeeded`/`refund.failed` 更新 `refunds`（没有本地记录的退款也记一条，`source` 可能是 `admin`、`upstream`）。
3. 付款页刷新：`/api/orders/<no>` 先看本地，本地不是终态时调用 `queryOrder`；结果未知（5xx、网络错误、验签失败）时返回上次本地状态并标 `stale: true`，不当作未支付。

## 7. 技术约定

- Node 22、Next.js（App Router，JavaScript，不用 TypeScript，便于加盟方照抄）、React。依赖只有 `next`、`react`、`react-dom` 和生成二维码的 `qrcode`（纯 JS）；新增依赖先在这里写明理由。
- 数据库 `node:sqlite`（内置；运行时会打印实验性提示，可接受；换成 `better-sqlite3` 需要原生构建，不用）。
- 测试用 `node --test`，不引入测试框架。
- `npm`、`npx` 只在容器里运行；端口 18120（`docs/architecture/ports-and-names.md`）。
- 金额一律字符串，比较用字符串相等；不做浮点运算。
- 页面文字中文、简洁；不写平台的内部信息。
- 保密：`KJ_SECRET`、`SHOP_SESSION_SECRET` 只从环境变量读，不写日志，不进仓库。

## 8. 部署（由 ops 做，本项目提供）

- `Dockerfile`（第 4 节）、监听 `PORT`、`/healthz` 返回 200。
- 环境变量清单（第 4 节 `lib/config.js`），`SHOP_DB_PATH=/data/shop.db`。
- 正式环境：ops 把它作为独立服务挂在反向代理后面、单独域名；通知地址和校验客户账号地址在平台后台配置。

## 9. 允许的预留与变更记录

- 允许的预留：无。
- 变更记录：2026-11-14 初稿（架构师）。
