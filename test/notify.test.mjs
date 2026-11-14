// 通知 /api/kj/notify：验签、去重、先查单确认再开通、并发只开通一次、退款通知。
import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { jsonRequest, loginCookie, platformRequest, setupSite } from './fake-platform.mjs';

const fake = await setupSite();
const { POST: notify } = await import('../app/api/kj/notify/route.js');
const { POST: pay } = await import('../app/api/pay/route.js');
const { getSite } = await import('../lib/site.js');

const { db } = getSite();
after(() => fake.close());
beforeEach(() => {
  fake.down = false;
  fake.badSignature = false;
  fake.dropReply = false;
  fake.rewriteQuery = null;
});

// 统计 fulfill 返回 true（第一次开通）的次数
const grants = [];
const realFulfill = db.fulfill;
db.fulfill = (order) => {
  const first = realFulfill(order);
  if (first) grants.push(order.orderNo);
  return first;
};
const grantsOf = (orderNo) => grants.filter((n) => n === orderNo).length;

let eventCounter = 0;
const eventId = () => `EV${++eventCounter}`;
const paidEvent = (order, id = eventId()) => ({ eventId: id, event: 'order.paid', occurredAt: '2026-10-13T08:01:12Z', order, refund: null });

async function send(event, options) {
  const res = await notify(platformRequest('/api/kj/notify', event, options).request);
  return { status: res.status, text: await res.text() };
}

/** 站点下一笔单并在假平台标为已支付，返回平台订单 */
async function placeOrder(account = 'user1', productId = 'p-200', payMethod = 'wechat') {
  const cookie = await loginCookie(account);
  const res = await pay(jsonRequest('/api/pay', { productId, payMethod }, cookie));
  const { data } = await res.json();
  const local = db.getOrder(data.siteOrderNo);
  return { local, remote: fake.orders.get(local.order_no) };
}

test('验签失败回 401，不查单也不开通', async () => {
  const { remote } = await placeOrder();
  fake.setPaid(remote.orderNo);
  const queries = fake.callsTo('/v1/orders/query').length;
  const body = JSON.stringify(paidEvent(remote));

  const cases = {
    签名密钥不对: platformRequest('/api/kj/notify', body, { secret: 'wrong-secret' }),
    站点编号不对: platformRequest('/api/kj/notify', body, { siteId: 'other-site' }),
    时间戳过期: platformRequest('/api/kj/notify', body, { timestamp: Date.now() - 6 * 60 * 1000 }),
    随机串格式不对: platformRequest('/api/kj/notify', body, { nonce: 'short' }),
  };
  for (const [name, { request }] of Object.entries(cases)) {
    const res = await notify(request);
    assert.equal(res.status, 401, name);
    assert.notEqual(await res.text(), 'success', name);
  }
  // 签名对但正文被改过
  const tampered = platformRequest('/api/kj/notify', body);
  const forged = new Request(tampered.request.url, { method: 'POST', headers: tampered.request.headers, body: body.replace('60.00', '1.00') });
  assert.equal((await notify(forged)).status, 401);

  assert.equal(fake.callsTo('/v1/orders/query').length, queries);
  assert.equal(grantsOf(remote.orderNo), 0);
  assert.equal(db.isEventDone(JSON.parse(body).eventId), false);
});

test('随机串 10 分钟内重复使用回 401', async () => {
  const { remote } = await placeOrder();
  fake.setPaid(remote.orderNo);
  const nonce = 'ReusedNonce123456';
  assert.equal((await send(paidEvent(remote), { nonce })).text, 'success');
  assert.equal((await send(paidEvent(remote, 'EV-other'), { nonce })).status, 401);
});

test('order.paid：查单确认后开通并回复 success', async () => {
  const { local, remote } = await placeOrder('user2');
  fake.setPaid(remote.orderNo);
  const res = await send(paidEvent(remote));
  assert.deepEqual(res, { status: 200, text: 'success' });
  assert.equal(grantsOf(remote.orderNo), 1);
  assert.equal(db.getOrder(local.site_order_no).status, 'paid');
  assert.equal(db.isFulfilled(remote.orderNo), true);
  const query = fake.callsTo('/v1/orders/query').at(-1).payload;
  assert.deepEqual(query, { orderNo: remote.orderNo }, '按 orderNo 查单');
});

test('eventId 重复只开通一次，第二次不再查单', async () => {
  const { remote } = await placeOrder();
  fake.setPaid(remote.orderNo);
  const id = eventId();
  assert.equal((await send(paidEvent(remote, id))).text, 'success');
  const queries = fake.callsTo('/v1/orders/query').length;
  assert.deepEqual(await send(paidEvent(remote, id)), { status: 200, text: 'success' });
  assert.equal(fake.callsTo('/v1/orders/query').length, queries);
  assert.equal(grantsOf(remote.orderNo), 1);
});

test('并发两次同一订单（不同 eventId、同一 eventId）只开通一次', async () => {
  const { remote } = await placeOrder();
  fake.setPaid(remote.orderNo);
  const same = eventId();
  const results = await Promise.all([
    send(paidEvent(remote, eventId())),
    send(paidEvent(remote, eventId())),
    send(paidEvent(remote, same)),
    send(paidEvent(remote, same)),
  ]);
  assert.ok(results.every((r) => r.status === 200 && r.text === 'success'), JSON.stringify(results));
  assert.equal(grantsOf(remote.orderNo), 1);
});

test('查单不是 paid：不开通，不回 success，不记 eventId，之后可重试', async () => {
  const { local, remote } = await placeOrder();
  const id = eventId();
  const res = await send(paidEvent({ ...remote, status: 'paid' }, id)); // 通知说 paid，但平台查单是 pending
  assert.notEqual(res.text, 'success');
  assert.equal(res.status, 409);
  assert.equal(grantsOf(remote.orderNo), 0);
  assert.equal(db.getOrder(local.site_order_no).status, 'created');
  assert.equal(db.isEventDone(id), false);

  fake.setPaid(remote.orderNo);
  assert.equal((await send(paidEvent(remote, id))).text, 'success');
  assert.equal(grantsOf(remote.orderNo), 1);
});

test('查单金额与本地记录不符：不开通，不回 success', async () => {
  const { remote } = await placeOrder();
  fake.setPaid(remote.orderNo);
  remote.amount = '1.00';
  const res = await send(paidEvent(remote));
  assert.equal(res.status, 409);
  assert.notEqual(res.text, 'success');
  assert.equal(grantsOf(remote.orderNo), 0);

  remote.amount = '60.00';
  remote.currency = 'USDT';
  assert.equal((await send(paidEvent(remote))).status, 409, '币种不符同样不开通');
  assert.equal(grantsOf(remote.orderNo), 0);
});

test('本地没有的 siteOrderNo（来源为 api）：不开通', async () => {
  const stray = fake.addOrder({ siteOrderNo: 'S-unknown-1', source: 'api', amount: '60.00', currency: 'CNY', payMethod: 'wechat', customerAccount: 'x' });
  fake.setPaid(stray.orderNo);
  const res = await send(paidEvent(stray));
  assert.equal(res.status, 409);
  assert.equal(db.isFulfilled(stray.orderNo), false);
});

test('查单失败（平台不可用、回复验签失败）：回 500 让平台重试，不记 eventId', async () => {
  const { remote } = await placeOrder();
  fake.setPaid(remote.orderNo);
  const id = eventId();

  fake.badSignature = true;
  assert.equal((await send(paidEvent(remote, id))).status, 500);
  fake.badSignature = false;
  fake.down = true;
  assert.equal((await send(paidEvent(remote, id))).status, 500);
  fake.down = false;

  assert.equal(grantsOf(remote.orderNo), 0);
  assert.equal(db.isEventDone(id), false);
  assert.equal((await send(paidEvent(remote, id))).text, 'success');
});

test('paycode 来源：按查单返回的账号和金额建单并开通', async () => {
  const order = fake.addOrder({ siteOrderNo: null, source: 'paycode', amount: '30.00', currency: 'CNY', payMethod: 'wechat', customerAccount: 'walk-in-customer' });
  fake.setPaid(order.orderNo);
  // 通知里的账号和金额被篡改也不影响：以查单结果为准
  const res = await send(paidEvent({ ...order, customerAccount: 'someone-else', amount: '999.00' }));
  assert.equal(res.text, 'success');

  const local = db.getOrderByOrderNo(order.orderNo);
  assert.equal(local.account, 'walk-in-customer');
  assert.equal(local.amount, '30.00');
  assert.equal(local.status, 'paid');
  assert.equal(grantsOf(order.orderNo), 1);

  assert.equal((await send(paidEvent(order))).text, 'success');
  assert.equal(grantsOf(order.orderNo), 1, '同一笔订单再来通知不重复开通');
});

test('refund.succeeded / refund.failed：更新本站申请的退款，补记后台发起的退款', async () => {
  const { local, remote } = await placeOrder('user3');
  fake.setPaid(remote.orderNo);
  await send(paidEvent(remote));
  db.insertRefund({ siteRefundNo: 'R-mine-1', siteOrderNo: local.site_order_no, refundNo: 'KR-mine-1', amount: '10.00', status: 'processing' });

  const refundEvent = (name, refund) => ({ eventId: eventId(), event: name, occurredAt: '2026-10-13T09:00:00Z', order: remote, refund });
  const base = { orderNo: remote.orderNo, currency: 'CNY', createdAt: '2026-10-13T09:00:00Z', finishedAt: '2026-10-13T09:05:00Z' };

  let res = await send(refundEvent('refund.succeeded', { ...base, refundNo: 'KR-mine-1', source: 'site', siteRefundNo: 'R-mine-1', amount: '10.00', status: 'succeeded' }));
  assert.equal(res.text, 'success');
  assert.equal(db.getRefund('R-mine-1').status, 'succeeded');

  res = await send(refundEvent('refund.succeeded', { ...base, refundNo: 'KR-admin-1', source: 'admin', siteRefundNo: null, amount: '5.00', status: 'succeeded' }));
  assert.equal(res.text, 'success');
  const admin = db.getRefundByNo('KR-admin-1');
  assert.equal(admin.status, 'succeeded');
  assert.equal(admin.site_order_no, local.site_order_no);
  assert.equal(db.listRefunds(local.site_order_no).length, 2);

  res = await send(refundEvent('refund.failed', { ...base, refundNo: 'KR-mine-1', source: 'site', siteRefundNo: 'R-mine-1', amount: '10.00', status: 'failed' }));
  assert.equal(db.getRefund('R-mine-1').status, 'failed');
});

test('下单超时（结果未知）后通知到达：本地订单保留 created，通知能开通', async () => {
  const cookie = await loginCookie('user-timeout');
  fake.dropReply = true;
  const res = await pay(jsonRequest('/api/pay', { productId: 'p-200', payMethod: 'wechat' }, cookie));
  fake.dropReply = false;
  assert.equal(res.status, 502);
  const { siteOrderNo } = (await res.json()).data;
  assert.equal(db.getOrder(siteOrderNo).status, 'created');
  assert.equal(db.getOrder(siteOrderNo).order_no, null);

  const remote = [...fake.orders.values()].find((o) => o.siteOrderNo === siteOrderNo);
  fake.setPaid(remote.orderNo);
  assert.equal((await send(paidEvent(remote))).text, 'success');
  const local = db.getOrder(siteOrderNo);
  assert.equal(local.status, 'paid');
  assert.equal(local.order_no, remote.orderNo);
  assert.equal(grantsOf(remote.orderNo), 1);
});

test('closed 的订单收到 paid 通知：超时后到账也能开通', async () => {
  const { local, remote } = await placeOrder('user-closed');
  db.setOrderStatus(local.site_order_no, 'closed');
  fake.setPaid(remote.orderNo);
  assert.equal((await send(paidEvent(remote))).text, 'success');
  assert.equal(db.getOrder(local.site_order_no).status, 'paid');
  assert.equal(grantsOf(remote.orderNo), 1);
});

test('api 来源：查单账号与本地订单账号不一致，不开通', async () => {
  const { local, remote } = await placeOrder('user-owner');
  fake.setPaid(remote.orderNo);
  remote.customerAccount = 'user-other';
  const res = await send(paidEvent(remote));
  assert.equal(res.status, 409);
  assert.notEqual(res.text, 'success');
  assert.equal(grantsOf(remote.orderNo), 0);
  assert.equal(db.getOrder(local.site_order_no).status, 'created');
});

test('shop 来源：按查单返回的账号和金额建单并开通', async () => {
  const order = fake.addOrder({ siteOrderNo: null, source: 'shop', amount: '88.00', currency: 'CNY', payMethod: 'shop', customerAccount: 'shop-customer' });
  fake.setPaid(order.orderNo);
  const res = await send(paidEvent({ ...order, customerAccount: 'someone-else', amount: '1.00' }));
  assert.equal(res.text, 'success');
  const local = db.getOrderByOrderNo(order.orderNo);
  assert.equal(local.account, 'shop-customer');
  assert.equal(local.amount, '88.00');
  assert.equal(local.status, 'paid');
  assert.equal(grantsOf(order.orderNo), 1);
});

test('来源缺失或不认识：不开通，不回 success', async () => {
  for (const source of [undefined, null, 'something-new']) {
    const order = fake.addOrder({ siteOrderNo: null, source, amount: '30.00', currency: 'CNY', payMethod: 'wechat', customerAccount: 'x' });
    fake.setPaid(order.orderNo);
    const res = await send(paidEvent(order));
    assert.equal(res.status, 409, String(source));
    assert.notEqual(res.text, 'success');
    assert.equal(db.isFulfilled(order.orderNo), false);
    assert.equal(db.getOrderByOrderNo(order.orderNo), null);
  }
});

test('查单返回的 orderNo 与通知不一致：不开通', async () => {
  const { remote } = await placeOrder('user-mismatch');
  fake.setPaid(remote.orderNo);
  fake.rewriteQuery = (order) => ({ ...order, orderNo: 'KJ-OTHER' });
  const res = await send(paidEvent(remote));
  assert.equal(res.status, 409);
  assert.equal(grantsOf(remote.orderNo), 0);
  assert.equal(grantsOf('KJ-OTHER'), 0);
});

test('paycode 来源：查单没有 customerAccount 时不开通', async () => {
  for (const customerAccount of [undefined, null, '']) {
    const order = fake.addOrder({ siteOrderNo: null, source: 'paycode', amount: '30.00', currency: 'CNY', payMethod: 'wechat', customerAccount });
    fake.setPaid(order.orderNo);
    const res = await send(paidEvent(order));
    assert.equal(res.status, 409, String(customerAccount));
    assert.equal(db.isFulfilled(order.orderNo), false);
    assert.equal(db.getOrderByOrderNo(order.orderNo), null);
  }
});

test('重复的退款通知（不同 eventId）幂等：只有一条退款记录', async () => {
  const { local, remote } = await placeOrder('user-refund-dup');
  fake.setPaid(remote.orderNo);
  await send(paidEvent(remote));
  const refund = { orderNo: remote.orderNo, refundNo: 'KR-dup-1', source: 'admin', siteRefundNo: null, amount: '5.00', currency: 'CNY', status: 'succeeded', createdAt: '2026-10-13T09:00:00Z', finishedAt: '2026-10-13T09:05:00Z' };
  const event = () => ({ eventId: eventId(), event: 'refund.succeeded', occurredAt: '2026-10-13T09:05:00Z', order: remote, refund });
  assert.equal((await send(event())).text, 'success');
  assert.equal((await send(event())).text, 'success');
  assert.equal(db.listRefunds(local.site_order_no).length, 1);
  assert.equal(db.getRefundByNo('KR-dup-1').status, 'succeeded');
});

test('不认识的事件：记下并回复 success', async () => {
  const res = await send({ eventId: eventId(), event: 'order.something-new', occurredAt: '2026-10-13T09:00:00Z', order: {} });
  assert.equal(res.text, 'success');
});

test('正文不是 JSON 或没有 eventId：回 400', async () => {
  assert.equal((await notify(platformRequest('/api/kj/notify', 'not json').request)).status, 400);
  assert.equal((await send({ event: 'order.paid' })).status, 400);
});
