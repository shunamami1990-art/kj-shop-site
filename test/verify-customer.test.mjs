// 校验客户账号 /api/kj/verify-customer：验签、exists 真假、回复签名能被平台验证。
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { loginCookie, platformRequest, responseSignatureValid, setupSite } from './fake-platform.mjs';

const fake = await setupSite();
const { POST: verifyCustomer } = await import('../app/api/kj/verify-customer/route.js');
after(() => fake.close());

const PATH = '/api/kj/verify-customer';

async function ask(payload, options) {
  const { request, nonce } = platformRequest(PATH, payload, options);
  const res = await verifyCustomer(request);
  const text = await res.text();
  return { res, text, json: JSON.parse(text), nonce };
}

test('登录过的账号 exists 为 true，回复签名能被验证', async () => {
  await loginCookie('known-user');
  const { res, text, json, nonce } = await ask({ customerAccount: 'known-user' });
  assert.equal(res.status, 200);
  assert.deepEqual(json, { code: 'OK', message: '', data: { exists: true, displayName: null } });
  assert.equal(responseSignatureValid({ path: PATH, requestNonce: nonce, headers: res.headers, body: text }), true);
});

test('没登录过的账号 exists 为 false', async () => {
  const { res, text, json, nonce } = await ask({ customerAccount: 'stranger' });
  assert.equal(res.status, 200);
  assert.equal(json.data.exists, false);
  assert.equal(responseSignatureValid({ path: PATH, requestNonce: nonce, headers: res.headers, body: text }), true);
});

test('回复签名绑定请求的随机串：换一个随机串就验不过', async () => {
  const { res, text } = await ask({ customerAccount: 'known-user' });
  assert.equal(responseSignatureValid({ path: PATH, requestNonce: 'AnotherRequestNonce', headers: res.headers, body: text }), false);
});

test('验签失败回 401，回复不带签名', async () => {
  const wrongSecret = await ask({ customerAccount: 'known-user' }, { secret: 'wrong' });
  assert.equal(wrongSecret.res.status, 401);
  assert.equal(wrongSecret.res.headers.get('x-kj-signature'), null);
  assert.equal((await ask({ customerAccount: 'known-user' }, { siteId: 'other' })).res.status, 401);
  assert.equal((await ask({ customerAccount: 'known-user' }, { timestamp: Date.now() - 10 * 60 * 1000 })).res.status, 401);

  const nonce = 'ReplayedNonce12345';
  assert.equal((await ask({ customerAccount: 'known-user' }, { nonce })).res.status, 200);
  assert.equal((await ask({ customerAccount: 'known-user' }, { nonce })).res.status, 401, '随机串重复');
});

test('customerAccount 缺失、为空或超过 64 个字符：400，回复同样签名', async () => {
  for (const payload of [{}, { customerAccount: '' }, { customerAccount: 5 }, { customerAccount: 'a'.repeat(65) }, 'not json']) {
    const { res, text, json, nonce } = await ask(payload);
    assert.equal(res.status, 400);
    assert.equal(json.code, 'INVALID_PARAM');
    assert.equal(responseSignatureValid({ path: PATH, requestNonce: nonce, headers: res.headers, body: text }), true);
  }
});
