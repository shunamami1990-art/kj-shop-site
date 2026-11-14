// 登录、/api/pay、订单状态、/api/refund、金额与会话工具。
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { jsonRequest, loginCookie, setupSite } from './fake-platform.mjs';

const fake = await setupSite();
const { POST: pay } = await import('../app/api/pay/route.js');
const { POST: refund } = await import('../app/api/refund/route.js');
const { GET: orderStatus } = await import('../app/api/orders/[no]/route.js');
const { getSite } = await import('../lib/site.js');
const { refundableAmount } = await import('../lib/orders.js');
const { readSession, signSession } = await import('../lib/session.js');
const { loadConfig } = await import('../lib/config.js');

const { db } = getSite();
after(() => fake.close());
beforeEach(() => {
  fake.createOrderError = null;
  fake.badSignature = false;
  fake.down = false;
});

const body = (res) => res.json();
const status = (cookie, no) => orderStatus(new Request(`http://shop.test/api/orders/${no}`, { headers: cookie ? { Cookie: cookie } : {} }), { params: Promise.resolve({ no }) });

async function buy(cookie, productId = 'p-200', payMethod = 'wechat') {
  const res = await pay(jsonRequest('/api/pay', { productId, payMethod }, cookie));
  return { res, json: await body(res) };
}

test('登录：账号记入 customers，cookie 带 HttpOnly', async () => {
  const res = await (await import('../app/api/login/route.js')).POST(
    new Request('http://shop.test/api/login', { method: 'POST', body: new URLSearchParams({ account: '  alice  ' }) }),
  );
  assert.equal(res.status, 303);
  assert.match(res.headers.get('set-cookie'), /HttpOnly/);
  assert.ok(db.findCustomer('alice'));
  assert.equal(db.findCustomer('nobody'), null);

  const empty = await (await import('../app/api/login/route.js')).POST(
    new Request('http://shop.test/api/login', { method: 'POST', body: new URLSearchParams({ account: '   ' }) }),
  );
  assert.equal(empty.headers.get('location'), '/login?error=1');
});

test('/api/pay：未登录 401，伪造的 cookie 也是 401', async () => {
  assert.equal((await buy(undefined)).res.status, 401);
  const cookie = await loginCookie('bob');
  const forged = cookie.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
  assert.equal((await buy(forged)).res.status, 401);
  assert.equal(fake.callsTo('/v1/orders').length, 0);
});

test('/api/pay：金额和币种只看商品表，忽略请求体里的金额', async () => {
  const cookie = await loginCookie('carol');
  const res = await pay(jsonRequest('/api/pay', { productId: 'p-200', payMethod: 'wechat', amount: '0.01', currency: 'USDT', siteOrderNo: 'X1' }, cookie));
  const json = await body(res);
  assert.equal(res.status, 200);
  assert.equal(json.code, 'OK');

  const sent = fake.callsTo('/v1/orders').at(-1).payload;
  assert.equal(sent.amount, '60.00');
  assert.equal(sent.currency, 'CNY');
  assert.equal(sent.payMethod, 'wechat');
  assert.equal(sent.customerAccount, 'carol');
  assert.match(sent.siteOrderNo, /^S[0-9]{14}[0-9a-f]{8}$/);
  assert.notEqual(sent.siteOrderNo, 'X1');

  const local = db.getOrder(json.data.siteOrderNo);
  assert.equal(local.amount, '60.00');
  assert.equal(local.status, 'created');
  assert.ok(local.order_no);
  assert.equal(JSON.parse(local.payment_json).type, 'url_qrcode');
});

test('/api/pay：USDT 商品只能用 usdt，保存应付金额', async () => {
  const cookie = await loginCookie('carol');
  assert.equal((await buy(cookie, 'u-100', 'wechat')).res.status, 400);
  assert.equal((await buy(cookie, 'p-200', 'usdt')).res.status, 400);
  assert.equal((await buy(cookie, 'nope', 'wechat')).res.status, 404);
  const { res, json } = await buy(cookie, 'u-100', 'usdt');
  assert.equal(res.status, 200);
  const local = db.getOrder(json.data.siteOrderNo);
  assert.equal(local.amount, '8.300000');
  assert.equal(local.payable_amount, '8.300417');
});

test('/api/pay：平台错误按类别返回', async () => {
  const cookie = await loginCookie('dave');
  fake.createOrderError = { status: 422, code: 'PAY_METHOD_UNAVAILABLE' };
  let r = await buy(cookie);
  assert.equal(r.res.status, 422);
  assert.equal(r.json.code, 'PAY_METHOD_UNAVAILABLE');
  assert.match(r.json.message, /不可用/);

  fake.createOrderError = { status: 500, code: 'INTERNAL_ERROR' };
  assert.equal((await buy(cookie)).res.status, 503);

  fake.createOrderError = null;
  fake.badSignature = true;
  assert.equal((await buy(cookie)).res.status, 502, '回复验签失败不能当作成功');

  fake.badSignature = false;
  fake.down = true;
  assert.equal((await buy(cookie)).res.status, 502, '回复验不过签名（平台 5xx 不签名）按调用失败处理');

  const closed = db.listOrders('dave');
  assert.ok(closed.length >= 4);
  assert.ok(closed.every((o) => o.status === 'closed'));
});

test('订单状态：只能看自己的订单；未支付时查单，结果未知标 stale', async () => {
  const cookie = await loginCookie('erin');
  const { json } = await buy(cookie);
  const no = json.data.siteOrderNo;

  assert.equal((await status(undefined, no)).status, 401);
  assert.equal((await status(await loginCookie('mallory'), no)).status, 404);
  assert.equal((await status(cookie, 'S-not-exist')).status, 404);

  let res = await status(cookie, no);
  let data = (await body(res)).data;
  assert.equal(data.status, 'created');
  assert.equal(data.fulfilled, false);
  assert.equal(data.stale, false);
  assert.equal(data.remote.status, 'pending');

  fake.down = true;
  data = (await body(await status(cookie, no))).data;
  assert.equal(data.stale, true);
  assert.equal(data.status, 'created', '查单失败不能当作已支付或已关闭');
  assert.equal(data.remote, null);
  fake.down = false;

  fake.orders.get(db.getOrder(no).order_no).status = 'closed';
  data = (await body(await status(cookie, no))).data;
  assert.equal(data.status, 'closed');
  assert.equal(db.getOrder(no).status, 'closed');
});

async function paidOrder(account) {
  const cookie = await loginCookie(account);
  const { json } = await buy(cookie);
  const no = json.data.siteOrderNo;
  const order = db.getOrder(no);
  fake.setPaid(order.order_no);
  db.fulfill(fake.orders.get(order.order_no));
  return { cookie, no, orderNo: order.order_no };
}

test('/api/refund：已开通订单可部分退款，记录退款号', async () => {
  const { cookie, no, orderNo } = await paidOrder('frank');
  const res = await refund(jsonRequest('/api/refund', { siteOrderNo: no, amount: '20.00', reason: '客户申请' }, cookie));
  const json = await body(res);
  assert.equal(res.status, 200);
  assert.equal(json.data.status, 'processing');

  const sent = fake.callsTo('/v1/refunds').at(-1).payload;
  assert.deepEqual(Object.keys(sent).sort(), ['amount', 'orderNo', 'reason', 'siteRefundNo']);
  assert.equal(sent.orderNo, orderNo);
  assert.equal(sent.reason, '客户申请');
  const row = db.getRefund(json.data.siteRefundNo);
  assert.equal(row.status, 'processing');
  assert.match(row.refund_no, /^KR/);

  const detail = (await body(await status(cookie, no))).data;
  assert.equal(detail.fulfilled, true);
  assert.equal(detail.status, 'paid');
});

test('/api/refund：校验与平台错误', async () => {
  const { cookie, no } = await paidOrder('gina');
  const before = fake.callsTo('/v1/refunds').length;
  const ask = async (payload, c = cookie) => {
    const res = await refund(jsonRequest('/api/refund', payload, c));
    return { status: res.status, json: await body(res) };
  };
  assert.equal((await ask({ siteOrderNo: no, amount: '1.00' }, null)).status, 401);
  assert.equal((await ask({ siteOrderNo: no, amount: '1.00' }, await loginCookie('mallory'))).status, 404);
  assert.equal((await ask({ siteOrderNo: no, amount: '1' })).status, 400);
  assert.equal((await ask({ siteOrderNo: no, amount: '1.000' })).status, 400);
  assert.equal((await ask({ siteOrderNo: no, amount: 1 })).status, 400);
  assert.equal((await ask({ siteOrderNo: no, amount: '1.00', reason: 'x'.repeat(201) })).status, 400);
  const over = await ask({ siteOrderNo: no, amount: '60.01' });
  assert.equal(over.status, 422);
  assert.equal(over.json.code, 'REFUND_EXCEEDS');
  assert.equal(fake.callsTo('/v1/refunds').length, before + 1, '格式和归属不对的请求不传到平台，只有超额的那一次');

  const unpaid = await buy(cookie);
  const notPaid = await ask({ siteOrderNo: unpaid.json.data.siteOrderNo, amount: '1.00' });
  assert.equal(notPaid.status, 422);
  assert.equal(notPaid.json.code, 'ORDER_NOT_PAID');
});

test('可退金额按字符串十进制计算', () => {
  assert.equal(refundableAmount('60.00', '20.00'), '40.00');
  assert.equal(refundableAmount('60.00', '0.00'), '60.00');
  assert.equal(refundableAmount('0.50', '0.01'), '0.49');
  assert.equal(refundableAmount('8.300000', '0.000001'), '8.299999');
  assert.equal(refundableAmount('10.00', '10.00'), '0.00');
  assert.equal(refundableAmount('999999999999.99', '0.01'), '999999999999.98');
});

test('会话 cookie：签名不符、格式不对都读不出账号', () => {
  const value = signSession('alice', 'secret-a');
  assert.equal(readSession(value, 'secret-a'), 'alice');
  assert.equal(readSession(value, 'secret-b'), null);
  assert.equal(readSession(`${value}.x`, 'secret-a'), null);
  assert.equal(readSession('', 'secret-a'), null);
  assert.equal(readSession('abc', 'secret-a'), null);
});

test('配置：缺少必填变量时报错，只写变量名', () => {
  const env = { KJ_BASE_URL: 'https://api.example.com', KJ_SITE_ID: 's', KJ_SECRET: 'top-secret', SHOP_SESSION_SECRET: 'x' };
  assert.equal(loadConfig(env).port, 18120);
  assert.equal(loadConfig(env).dbPath, './data/shop.db');
  assert.throws(() => loadConfig({ ...env, KJ_SECRET: '' }), (e) => /KJ_SECRET/.test(e.message) && !/top-secret/.test(e.message));
});
