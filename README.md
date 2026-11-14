# 示例商品站

一个按平台站点接口接入的最小商品站，演示完整的订单流程：选商品 → 下单 → 付款 → 收到通知后查单确认再开通 → 申请退款。代码只用 Next.js、React 和一个生成二维码的小库，可以直接照着改。

包含的页面：商品列表、登录（只输入账号名）、选支付方式、付款页、订单状态、我的订单、申请退款。包含的接口：下单、订单状态、退款，以及平台调用本站的两个地址（通知、校验客户账号）和存活检查。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `KJ_BASE_URL` | 是 | 平台提供的接口地址，如 `https://api.example.com`，不带路径 |
| `KJ_SITE_ID` | 是 | 站点编号，由平台提供 |
| `KJ_SECRET` | 是 | 接口密钥，由平台提供；只放在环境变量里，不要写进代码或日志 |
| `SHOP_SESSION_SECRET` | 是 | 签登录 cookie 用的随机字符串，自己生成 |
| `SHOP_DB_PATH` | 否 | SQLite 数据文件路径，默认 `./data/shop.db` |
| `PORT` | 否 | 监听端口，默认 `18120` |

## 用保密文件提供密钥

生产环境建议不把 `KJ_SECRET`、`SHOP_SESSION_SECRET` 放进环境变量（容器的环境变量会被写到磁盘上），而是写进一个只读文件，用 `KJ_SECRETS_FILE` 指向它：

```
# 每行 名称=值，值到行尾，不加引号，不转义
KJ_SECRET=<接口密钥>
SHOP_SESSION_SECRET=<随机字符串>
```

```bash
docker run --rm -p 18120:18120 -v shop-data:/data \
  -v /run/shop-secrets.env:/run/shop-secrets.env:ro -e KJ_SECRETS_FILE=/run/shop-secrets.env \
  -e KJ_BASE_URL=https://api.example.com -e KJ_SITE_ID=<站点编号> shop-site
```

规则：

- 文件里只能有这两项；`#` 开头的行和空行忽略。
- 以下情形启动失败，错误信息只写名称，不写值：读不到文件、某行没有 `=`、行尾有 CR（Windows 换行）、名称重复、名称不认识、文件里的变量在环境变量里也设置了。
- `NODE_ENV=production` 时，这两项只能来自文件（环境变量里出现就拒绝启动），并且文件权限不得宽于 `0400`；开发时两种方式都可以。
- 日志只记录读到了哪些名称。

## 本机运行

需要 Node.js 22。

```bash
npm ci
export KJ_BASE_URL=https://api.example.com KJ_SITE_ID=<站点编号> KJ_SECRET=<接口密钥> SHOP_SESSION_SECRET=<随机字符串>
npm run build
npm start
```

打开 `http://localhost:18120`，输入任意账号名登录后即可下单。开发时用 `npm run dev`。

运行测试：`npm test`（测试使用自带的模拟平台，不需要真实密钥）。

## 用 Docker 运行

```bash
docker build -t shop-site .
docker run --rm -p 18120:18120 -v shop-data:/data \
  -e KJ_BASE_URL=https://api.example.com -e KJ_SITE_ID=<站点编号> \
  -e KJ_SECRET=<接口密钥> -e SHOP_SESSION_SECRET=<随机字符串> shop-site
```

数据库文件在容器内的 `/data/shop.db`，挂载一个卷以保留数据。同一个数据文件只能由一个进程使用。

## 向平台登记的地址

通知地址和校验客户账号地址必须是 `https` 的公网地址。部署后，在平台的站点设置里填写（把 `<本站域名>` 换成你的域名）：

| 用途 | 地址 |
| --- | --- |
| 通知地址 | `https://<本站域名>/api/kj/notify` |
| 校验客户账号地址 | `https://<本站域名>/api/kj/verify-customer` |

存活检查：`GET /healthz`，正常返回 200。

## 代码导读

- `lib/kj-sign.js`：签名与验签。每次请求签名、回复验签；平台发来的请求验签后才处理。
- `lib/kj-client.js`：下单、查单、退款、退款查询。
- `lib/kj-notify.js`：处理通知——验签、按 `eventId` 去重、先查单确认已支付且金额相符，再开通。
- `lib/kj-verify-customer.js`：校验客户账号，回复要签名。
- `lib/kj-payment.js`：把下单返回的 `payment` 转成页面内容；不认识的类型提示客户换一种支付方式。
- `lib/db.js`：SQLite 存储。开通以平台订单号为唯一键插入，同一个事务里更新订单，保证同一笔订单只开通一次。
- `lib/orders.js`：下单、订单状态、退款的业务逻辑。金额和币种只取自 `lib/products.js` 的商品表，不使用浏览器提交的值。
- `app/`：页面和接口。

登录只输入账号名、没有密码，仅用于演示；接入自己的站点时请换成真实的账号体系。
