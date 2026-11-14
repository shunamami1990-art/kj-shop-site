// 测试用的假平台：独立实现签名与验签（不引用 lib/kj-sign.js），按契约回复下单、查单、退款。
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

export const SITE_ID = 'site-test';
export const SECRET = 'test-secret-for-shop-site';

const hex = (secret, text) => createHmac('sha256', secret).update(text, 'utf8').digest('hex');
const randomNonce = () => randomBytes(12).toString('hex');

/**
 * 站点收到的请求要带的签名头（平台发给站点的请求）。
 * @param {{ path: string, body: string, secret?: string, siteId?: string, timestamp?: number, nonce?: string }} p
 */
export function signedHeaders({ path, body, secret = SECRET, siteId = SITE_ID, timestamp = Date.now(), nonce = randomNonce() }) {
  const ts = String(timestamp);
  return {
    'Content-Type': 'application/json',
    'X-KJ-Key-Id': siteId,
    'X-KJ-Timestamp': ts,
    'X-KJ-Nonce': nonce,
    'X-KJ-Signature': hex(secret, ['KJ-REQ', 'POST', path, ts, nonce, body].join('\n')),
  };
}

/** 平台发给站点的已签名请求 */
export function platformRequest(path, payload, options = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const headers = signedHeaders({ path, body, ...options });
  return { request: new Request(`http://shop.test${path}`, { method: 'POST', headers, body }), nonce: headers['X-KJ-Nonce'] };
}

/** 验证站点对平台请求的回复签名 */
export function responseSignatureValid({ path, requestNonce, headers, body, secret = SECRET }) {
  const ts = headers.get('x-kj-timestamp');
  const nonce = headers.get('x-kj-nonce');
  const signature = headers.get('x-kj-signature');
  if (!ts || !nonce || !signature || headers.get('x-kj-key-id') !== SITE_ID) return false;
  return signature === hex(secret, ['KJ-RESP', 'POST', path, ts, nonce, requestNonce, body].join('\n'));
}

const ok = (data) => ({ status: 200, body: { code: 'OK', message: '', data } });
const fail = (status, code, message = '') => ({ status, body: { code, message, data: null } });

export async function startFakePlatform() {
  let counter = 0;
  const fake = {
    url: '',
    orders: new Map(),
    refunds: new Map(),
    /** 收到的已验签请求：{ path, payload } */
    calls: [],
    /** 下单返回的 payment */
    payment: { type: 'url_qrcode', content: { url: 'https://pay.example.com/p/abc', qrcode: 'weixin://wxpay/bizpayurl?pr=abc' } },
    /** 设置后下单直接返回该错误 */
    createOrderError: null,
    /** 设置后查单直接返回该错误 */
    queryError: null,
    /** 设置后退款直接返回该错误 */
    refundError: null,
    /** 设置后查单返回的订单经过该函数改写（模拟平台回复与通知不一致） */
    rewriteQuery: null,
    /** 设置后平台照常处理请求，但不回复就断开连接（模拟超时：结果未知） */
    dropReply: false,
    /** 设置后所有回复的签名都是错的 */
    badSignature: false,
    /** 设置后所有请求直接返回 500（回复不签名） */
    down: false,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
    /** 登记一笔平台订单（用于 paycode 等站点事先不知道的订单） */
    addOrder(order) {
      const full = {
        orderNo: `KJ${String(++counter).padStart(6, '0')}`,
        siteOrderNo: null,
        source: 'api',
        status: 'pending',
        payableAmount: order.amount,
        paidAmount: null,
        refundedAmount: order.currency === 'USDT' ? '0.000000' : '0.00',
        agentCode: null,
        payment: null,
        expireAt: '2026-10-13T08:30:00Z',
        paidAt: null,
        createdAt: '2026-10-13T08:00:00Z',
        ...order,
      };
      fake.orders.set(full.orderNo, full);
      return full;
    },
    setPaid(orderNo) {
      const o = fake.orders.get(orderNo);
      o.status = 'paid';
      o.paidAmount = o.amount;
      o.payment = null;
    },
    callsTo: (path) => fake.calls.filter((c) => c.path === path),
  };

  function handle(path, payload) {
    if (path === '/v1/orders') {
      if (fake.createOrderError) return fail(fake.createOrderError.status, fake.createOrderError.code, '错误');
      const existing = [...fake.orders.values()].find((o) => o.siteOrderNo === payload.siteOrderNo);
      if (existing) return ok(existing);
      const payable = payload.currency === 'USDT' ? '8.300417' : payload.amount;
      const order = fake.addOrder({
        siteOrderNo: payload.siteOrderNo,
        amount: payload.amount,
        currency: payload.currency,
        payMethod: payload.payMethod,
        customerAccount: payload.customerAccount,
        payableAmount: payable,
        payment: payload.currency === 'USDT' ? { type: 'usdt', content: { network: 'TRC20', address: 'TXexample', amount: payable } } : fake.payment,
      });
      return ok(order);
    }
    if (path === '/v1/orders/query') {
      if (fake.queryError) return fail(fake.queryError.status, fake.queryError.code);
      const order = [...fake.orders.values()].find((o) => (payload.orderNo ? o.orderNo === payload.orderNo : o.siteOrderNo === payload.siteOrderNo));
      if (!order) return fail(404, 'NOT_FOUND');
      return ok(fake.rewriteQuery ? fake.rewriteQuery(order) : order);
    }
    if (path === '/v1/refunds') {
      if (fake.refundError) return fail(fake.refundError.status, fake.refundError.code);
      const order = [...fake.orders.values()].find((o) => (payload.orderNo ? o.orderNo === payload.orderNo : o.siteOrderNo === payload.siteOrderNo));
      if (!order) return fail(404, 'NOT_FOUND');
      if (order.status !== 'paid') return fail(422, 'ORDER_NOT_PAID');
      if (Math.round(Number(payload.amount) * 100) > Math.round((Number(order.amount) - Number(order.refundedAmount)) * 100)) {
        return fail(422, 'REFUND_EXCEEDS');
      }
      order.refundedAmount = (Number(order.refundedAmount) + Number(payload.amount)).toFixed(2);
      const refund = {
        refundNo: `KR${String(++counter).padStart(6, '0')}`,
        source: 'site',
        siteRefundNo: payload.siteRefundNo,
        orderNo: order.orderNo,
        amount: payload.amount,
        currency: order.currency,
        status: 'processing',
        createdAt: '2026-10-13T09:00:00Z',
        finishedAt: null,
      };
      fake.refunds.set(refund.refundNo, refund);
      return ok(refund);
    }
    return fail(404, 'NOT_FOUND');
  }

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const path = req.url;
      if (fake.down) {
        res.writeHead(500).end('down');
        return;
      }
      const ts = req.headers['x-kj-timestamp'];
      const nonce = req.headers['x-kj-nonce'];
      const expected = hex(SECRET, ['KJ-REQ', req.method, path, ts, nonce, body].join('\n'));
      if (req.headers['x-kj-key-id'] !== SITE_ID || req.headers['x-kj-signature'] !== expected) {
        res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ code: 'UNAUTHORIZED', message: 'bad signature', data: null }));
        return;
      }
      const payload = JSON.parse(body);
      fake.calls.push({ path, payload });
      const out = handle(path, payload);
      if (fake.dropReply) {
        req.socket.destroy();
        return;
      }
      const text = JSON.stringify(out.body);
      const respTs = String(Date.now());
      const respNonce = randomNonce();
      const signature = hex(fake.badSignature ? 'wrong-secret' : SECRET, ['KJ-RESP', req.method, path, respTs, respNonce, nonce, text].join('\n'));
      res.writeHead(out.status, {
        'Content-Type': 'application/json',
        'X-KJ-Timestamp': respTs,
        'X-KJ-Nonce': respNonce,
        'X-KJ-Signature': signature,
      });
      res.end(text);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.url = `http://127.0.0.1:${server.address().port}`;
  return fake;
}

/** 设置环境变量并启动假平台；各测试文件在动态导入站点代码之前调用 */
export async function setupSite() {
  const fake = await startFakePlatform();
  process.env.KJ_BASE_URL = fake.url;
  process.env.KJ_SITE_ID = SITE_ID;
  process.env.KJ_SECRET = SECRET;
  process.env.SHOP_SESSION_SECRET = 'test-session-secret';
  process.env.SHOP_DB_PATH = ':memory:';
  return fake;
}

/** 通过登录接口登录，返回之后请求要带的 Cookie 头 */
export async function loginCookie(account) {
  const { POST } = await import('../app/api/login/route.js');
  const res = await POST(new Request('http://shop.test/api/login', { method: 'POST', body: new URLSearchParams({ account }) }));
  if (res.status !== 303) throw new Error(`login failed: ${res.status}`);
  return res.headers.get('set-cookie').split(';')[0];
}

/** 带 Cookie 的 JSON 请求 */
export function jsonRequest(path, payload, cookie) {
  return new Request(`http://shop.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(payload),
  });
}
