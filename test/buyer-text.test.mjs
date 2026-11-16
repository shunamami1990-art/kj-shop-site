// 买家可见文字：错误码映射、501 处理、状态中文、付款页和退款表单文案（T-005）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  LOCAL_STATUS_TEXT,
  PAY_METHOD_TEXT,
  REFUND_STATUS_TEXT,
  REMOTE_STATUS_TEXT,
  createPayOrder,
  createRefund,
  isUnknownResult,
  localRefundable,
  textOf,
} from '../lib/orders.js';
import { openDb } from '../lib/db.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** 假平台客户端：createOrder、createRefund 都返回同一个回复 */
function clientReplying(res) {
  return { createOrder: async () => res, createRefund: async () => res };
}
const failure = (status, code) => ({ status, code, message: 'platform original text', data: null });

async function buy(res) {
  const db = openDb(':memory:');
  const result = await createPayOrder({ db, client: clientReplying(res) }, { account: 'u1', productId: 'p-200', payMethod: 'wechat' });
  return { db, result };
}

test('通用错误码不显示给买家，平台原文不出现在回复里', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const [status, code] of [[400, 'INVALID_PARAM'], [401, 'UNAUTHORIZED'], [409, 'CONFLICT'], [404, 'NOT_FOUND'], [501, 'NOT_IMPLEMENTED'], [422, 'SOME_NEW_CODE']]) {
    const { result } = await buy(failure(status, code));
    assert.equal(result.ok, false);
    assert.equal(result.message, '下单失败，请稍后再试', code);
    assert.doesNotMatch(result.message, /platform original text/);
  }
});

test('RATE_LIMITED：通用含义，下单场景附未支付订单过多', async () => {
  const { result } = await buy(failure(429, 'RATE_LIMITED'));
  assert.equal(result.message, '请求过于频繁，请稍后再试（未支付的订单过多）');
});

test('退款：通用错误码显示"退款失败"，业务码有中文说明', async (t) => {
  t.mock.method(console, 'error', () => {});
  const db = openDb(':memory:');
  const created = await createPayOrder({ db, client: { createOrder: async () => ({ code: 'OK', data: { orderNo: 'O1', payment: null } }) } }, { account: 'u1', productId: 'p-200', payMethod: 'wechat' });
  db.fulfill({ siteOrderNo: created.siteOrderNo, orderNo: 'O1', customerAccount: 'u1', amount: '60.00', currency: 'CNY', payMethod: 'wechat' });
  const refund = (res) => createRefund({ db, client: clientReplying(res) }, { account: 'u1', siteOrderNo: created.siteOrderNo, amount: '1.00', reason: '' });
  assert.equal((await refund(failure(409, 'CONFLICT'))).message, '退款失败，请稍后再试');
  assert.equal((await refund(failure(422, 'REFUND_EXCEEDS'))).message, '退款金额超过可退金额');
});

test('501 NOT_IMPLEMENTED 不是结果未知：订单关闭，不提示不要重复下单', async (t) => {
  t.mock.method(console, 'error', () => {});
  assert.equal(isUnknownResult({ status: 501, code: 'NOT_IMPLEMENTED' }), false);
  assert.equal(isUnknownResult({ status: 500, code: 'INTERNAL_ERROR' }), true);
  assert.equal(isUnknownResult({ status: 503, code: 'UNAVAILABLE' }), true);
  const { db, result } = await buy(failure(501, 'NOT_IMPLEMENTED'));
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.message, /不要重复下单/);
  assert.equal(db.getOrder(result.siteOrderNo).status, 'closed');
});

test('状态与支付方式中文映射，覆盖契约枚举', () => {
  assert.deepEqual(['wechat', 'alipay', 'usdt', 'shop'].map((k) => textOf(PAY_METHOD_TEXT, k)), ['微信', '支付宝', 'USDT', '店铺码']);
  assert.deepEqual(['created', 'paid', 'closed'].map((k) => textOf(LOCAL_STATUS_TEXT, k)), ['待支付', '已支付', '已关闭']);
  assert.deepEqual(['pending', 'paid', 'closed'].map((k) => textOf(REMOTE_STATUS_TEXT, k)), ['待支付', '已支付', '已关闭']);
  for (const k of ['reviewing', 'processing', 'succeeded', 'failed', 'manual']) assert.ok(REFUND_STATUS_TEXT[k], k);
  assert.equal(textOf(REFUND_STATUS_TEXT, 'manual'), '人工处理中');
  assert.equal(textOf(REFUND_STATUS_TEXT, 'new-status'), 'new-status');
});

test('订单列表的可退金额：已退完为 0，失败的退款不占用', () => {
  assert.equal(localRefundable('200.00', []), '200.00');
  assert.equal(localRefundable('200.00', [{ amount: '50.00', status: 'succeeded' }]), '150.00');
  assert.equal(localRefundable('200.00', [{ amount: '200.00', status: 'processing' }]), '0.00');
  assert.equal(localRefundable('200.00', [{ amount: '200.00', status: 'failed' }]), '200.00');
});

test('页面文案：付款页提示、关闭文案、订单页不再写"本地状态"', () => {
  assert.match(read('app/pay/[no]/page.jsx'), /付款后由平台核对，可能需要几分钟/);
  assert.match(read('app/pay/[no]/pay-status.jsx'), /若已付款请勿重复下单，开通后自动显示；未付款请重新下单/);
  assert.doesNotMatch(read('app/orders/[no]/page.jsx'), /本地状态/);
  assert.doesNotMatch(read('app/orders/[no]/refund-form.jsx'), /body\.message \|\|/);
});
