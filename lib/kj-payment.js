// 把下单返回的 payment 转成页面要展示的内容（C1 Payment）。

export const KNOWN_PAYMENT_TYPES = ['url', 'qrcode', 'url_qrcode', 'usdt', 'bank', 'app', 'form'];

const UNSUPPORTED = /** @type {const} */ ({ supported: false, message: '当前支付方式暂不支持，请换一种支付方式' });

/**
 * 是否为 allowed 中某个协议的绝对地址。javascript:、data:、相对地址等一律不认。
 * @param {unknown} s @param {string[]} allowed 如 ['https:']
 */
function isUrlWithProtocol(s, allowed) {
  if (typeof s !== 'string') return false;
  try {
    return allowed.includes(new URL(s).protocol);
  } catch {
    return false;
  }
}

/**
 * 二维码：qrcodeImage（只能 https）不为 null 时直接显示这张图片；否则把 qrcode 文本编码成二维码。都不可用时返回 null。
 * @param {Record<string, any>} content
 * @returns {{ qrcode: string, qrcodeImage: string | null } | null}
 */
function qrcodeContent(content) {
  const qrcode = typeof content.qrcode === 'string' ? content.qrcode : '';
  const image = content.qrcodeImage;
  if (image !== undefined && image !== null && image !== '') {
    // 图片地址只接受 https：http 图片会被浏览器拦截或被中间人替换成别人的收款码
    return isUrlWithProtocol(image, ['https:']) ? { qrcode, qrcodeImage: image } : null;
  }
  return qrcode !== '' ? { qrcode, qrcodeImage: null } : null;
}

/**
 * 以后可能增加新的 type：遇到不认识的 type 提示客户换一种支付方式，不要报错。
 * url、qrcode、url_qrcode 的地址不合规定（url 不是 http(s)、qrcodeImage 不是 https、二维码内容为空）时同样处理。
 * 这三种返回的 content 只含检查过的字段：url；qrcode、qrcodeImage（不为 null 时显示图片，否则编码 qrcode）。
 * @param {{ type: string, content: Record<string, any> } | null | undefined} payment
 * @returns {{ supported: true, type: string, content: Record<string, any> } | { supported: false, message: string }}
 */
export function describePayment(payment) {
  if (!payment || !KNOWN_PAYMENT_TYPES.includes(payment.type) || typeof payment.content !== 'object' || payment.content === null) {
    return UNSUPPORTED;
  }
  const { type, content } = payment;
  if (type === 'url' || type === 'url_qrcode') {
    if (!isUrlWithProtocol(content.url, ['http:', 'https:'])) return UNSUPPORTED;
  }
  if (type === 'url') return { supported: true, type, content: { url: content.url } };
  if (type === 'qrcode' || type === 'url_qrcode') {
    const qr = qrcodeContent(content);
    if (!qr) return UNSUPPORTED;
    return { supported: true, type, content: type === 'qrcode' ? qr : { url: content.url, ...qr } };
  }
  // usdt：客户必须按 content.amount（即订单的应付金额 payableAmount）精确支付，页面上要原样展示全部 6 位小数
  return { supported: true, type, content };
}
