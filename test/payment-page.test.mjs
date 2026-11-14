// 付款页对 payment 各 type 的处理（lib/kj-payment.js）。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describePayment } from '../lib/kj-payment.js';

const unsupported = (payment) => assert.equal(describePayment(payment).supported, false);

test('url：只接受 http 和 https', () => {
  assert.deepEqual(describePayment({ type: 'url', content: { url: 'https://pay.example.com/p/1' } }), {
    supported: true,
    type: 'url',
    content: { url: 'https://pay.example.com/p/1' },
  });
  assert.equal(describePayment({ type: 'url', content: { url: 'http://pay.example.com/p/1' } }).supported, true);
  for (const url of ['javascript:alert(1)', 'data:text/html,x', '/relative', 'ftp://x.example.com', '', null, 5]) {
    unsupported({ type: 'url', content: { url } });
  }
});

test('qrcode：文本编码成二维码，qrcodeImage 只接受 https', () => {
  const text = describePayment({ type: 'qrcode', content: { qrcode: 'weixin://wxpay/x' } });
  assert.deepEqual(text, { supported: true, type: 'qrcode', content: { qrcode: 'weixin://wxpay/x', qrcodeImage: null } });

  const image = describePayment({ type: 'qrcode', content: { qrcode: '', qrcodeImage: 'https://img.example.com/a.png' } });
  assert.equal(image.supported, true);
  assert.equal(image.content.qrcodeImage, 'https://img.example.com/a.png');

  unsupported({ type: 'qrcode', content: { qrcode: '', qrcodeImage: 'http://img.example.com/a.png' } });
  unsupported({ type: 'qrcode', content: { qrcode: 'x', qrcodeImage: 'data:image/png;base64,AAAA' } });
  unsupported({ type: 'qrcode', content: { qrcode: '' } });
});

test('url_qrcode：地址和二维码都要合格，只保留检查过的字段', () => {
  const ok = describePayment({ type: 'url_qrcode', content: { url: 'https://p.example.com/1', qrcode: 'weixin://x', extra: '<script>' } });
  assert.deepEqual(ok, { supported: true, type: 'url_qrcode', content: { url: 'https://p.example.com/1', qrcode: 'weixin://x', qrcodeImage: null } });
  unsupported({ type: 'url_qrcode', content: { url: 'javascript:alert(1)', qrcode: 'weixin://x' } });
  unsupported({ type: 'url_qrcode', content: { url: 'https://p.example.com/1', qrcode: '' } });
});

test('usdt：原样给出网络、地址和应付金额', () => {
  const view = describePayment({ type: 'usdt', content: { network: 'TRC20', address: 'TXexample', amount: '8.300417', note: 'x' } });
  assert.deepEqual(view, { supported: true, type: 'usdt', content: { network: 'TRC20', address: 'TXexample', amount: '8.300417' } });
  unsupported({ type: 'usdt', content: { network: 'TRC20', address: 'TXexample' } });
});

test('不认识的 type 和空 payment：提示换支付方式，不报错', () => {
  for (const payment of [{ type: 'bank', content: { cardNumber: '1' } }, { type: 'form', content: { html: '<form>' } }, { type: 'new-type', content: {} }, null, undefined, { type: 'url' }]) {
    const view = describePayment(payment);
    assert.equal(view.supported, false);
    assert.match(view.message, /换一种支付方式/);
  }
});
