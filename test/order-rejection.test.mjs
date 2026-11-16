// 订单页显示平台拒绝的错误码和说明（orders.last_error_code / last_error_text）。
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { after, beforeEach, test } from 'node:test';
import { jsonRequest, loginCookie, setupSite } from './fake-platform.mjs';

const fake = await setupSite();
const { POST: pay } = await import('../app/api/pay/route.js');
const { POST: retryPay } = await import('../app/api/pay/retry/route.js');
const { getSite } = await import('../lib/site.js');
const { notSubmittedText } = await import('../lib/orders.js');
const { openDb } = await import('../lib/db.js');

const { db } = getSite();
after(() => fake.close());
beforeEach(() => {
  fake.createOrderError = null;
  fake.dropReply = false;
  fake.badSignature = false;
});

async function buy(cookie) {
  const res = await pay(jsonRequest('/api/pay', { productId: 'p-200', payMethod: 'wechat' }, cookie));
  return res.json();
}

test('平台明确拒绝：记错误码和说明，订单页显示拒绝原因', async () => {
  const cookie = await loginCookie('erin');
  fake.createOrderError = { status: 422, code: 'PAY_METHOD_UNAVAILABLE' };
  const json = await buy(cookie);
  const local = db.getOrder(json.data.siteOrderNo);
  assert.equal(local.last_error_code, 'PAY_METHOD_UNAVAILABLE');
  assert.equal(local.last_error_text, '该支付方式当前不可用，请换一种支付方式');
  assert.equal(notSubmittedText(local), '平台拒绝了这笔订单：该支付方式当前不可用，请换一种支付方式（错误码 PAY_METHOD_UNAVAILABLE）');

  fake.createOrderError = { status: 422, code: 'SOME_NEW_CODE' };
  const other = db.getOrder((await buy(cookie)).data.siteOrderNo);
  assert.equal(other.last_error_code, 'SOME_NEW_CODE');
  assert.match(notSubmittedText(other), /错误码 SOME_NEW_CODE/);
});

test('结果未知不写错误码，订单页仍显示尚未提交', async () => {
  const cookie = await loginCookie('erin2');
  assert.equal(notSubmittedText({ last_error_code: null, last_error_text: null }), '订单尚未提交到平台。');
  for (const setup of [
    () => { fake.createOrderError = { status: 500, code: 'INTERNAL_ERROR' }; },
    () => { fake.badSignature = true; },
    () => { fake.dropReply = true; },
  ]) {
    fake.createOrderError = null;
    fake.badSignature = false;
    fake.dropReply = false;
    setup();
    const local = db.getOrder((await buy(cookie)).data.siteOrderNo);
    assert.equal(local.last_error_code, null);
    assert.equal(local.last_error_text, null);
    assert.equal(notSubmittedText(local), '订单尚未提交到平台。');
  }
});

test('再次提交成功后清空错误码和说明', async () => {
  const cookie = await loginCookie('erin3');
  fake.dropReply = true;
  const no = (await buy(cookie)).data.siteOrderNo;
  fake.dropReply = false;
  db.setLastError(no, 'PAY_METHOD_UNAVAILABLE', '旧的拒绝说明');
  assert.equal((await retryPay(jsonRequest('/api/pay/retry', { siteOrderNo: no }, cookie))).status, 200);
  const local = db.getOrder(no);
  assert.equal(local.last_error_code, null);
  assert.equal(local.last_error_text, null);
});

test('旧版 orders 表启动时补上两列，重复启动不报错', () => {
  mkdirSync('.tmp', { recursive: true });
  const dir = mkdtempSync('.tmp/old-db-');
  try {
    const path = `${dir}/old.db`;
    const old = new DatabaseSync(path);
    old.exec(
      'CREATE TABLE orders (site_order_no TEXT PRIMARY KEY, account TEXT NOT NULL, product_id TEXT, amount TEXT NOT NULL, currency TEXT NOT NULL, pay_method TEXT NOT NULL, payable_amount TEXT, order_no TEXT UNIQUE, status TEXT NOT NULL, payment_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)',
    );
    old.exec("INSERT INTO orders VALUES ('S1', 'a', 'p-200', '1.00', 'CNY', 'wechat', NULL, NULL, 'closed', NULL, 't', 't')");
    old.close();
    const upgraded = openDb(path);
    assert.equal(upgraded.getOrder('S1').last_error_code, null);
    upgraded.setLastError('S1', 'X', 'y');
    assert.equal(upgraded.getOrder('S1').last_error_text, 'y');
    openDb(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
