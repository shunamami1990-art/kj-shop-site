// 必需的测试：签名函数通过契约标准用例（contracts/testdata/signature-cases.json）全部用例。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { hmacHex, requestStringToSign, responseStringToSign, verifyResponse } from '../lib/kj-sign.js';

const { cases } = JSON.parse(readFileSync(new URL('../contracts/testdata/signature-cases.json', import.meta.url), 'utf8'));

test('标准用例文件不为空', () => {
  assert.ok(cases.length > 0);
});

for (const c of cases) {
  test(`signature-cases: ${c.name}`, () => {
    const stringToSign =
      c.direction === 'request'
        ? requestStringToSign({ method: c.method, path: c.path, timestamp: c.timestamp, nonce: c.nonce, body: c.body })
        : responseStringToSign({ method: c.method, path: c.path, timestamp: c.timestamp, nonce: c.nonce, requestNonce: c.requestNonce, body: c.body });
    assert.equal(stringToSign, c.expected.stringToSign);
    assert.equal(hmacHex(c.secret, stringToSign), c.expected.signature);

    if (c.direction === 'response') {
      const headers = new Headers({ 'x-kj-timestamp': c.timestamp, 'x-kj-nonce': c.nonce, 'x-kj-signature': c.expected.signature });
      const base = { method: c.method, path: c.path, requestNonce: c.requestNonce, headers, body: c.body, secret: c.secret };
      assert.equal(verifyResponse(base), true);
      assert.equal(verifyResponse({ ...base, requestNonce: 'OtherRequestNonce1' }), false, '回答别的请求的随机串必须验不过');
      assert.equal(verifyResponse({ ...base, body: `${c.body} ` }), false, '正文改一个字符必须验不过');
    }
  });
}
