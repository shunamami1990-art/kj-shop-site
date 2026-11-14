// 调用站点接口（C1）：下单、查单、退款、退款查询。只用 Node 内置的 fetch 和 crypto。
import { hmacHex, newNonce, requestStringToSign, verifyResponse } from './kj-sign.js';

/**
 * 回复的签名不符或缺失。按调用失败处理，不能使用回复内容。
 * 请求本身验签失败时（时间戳超出范围、随机串重复、签名不符），平台 的错误回复不签名，也会走到这里；
 * 这时 status 通常为 401，请检查自己的签名写法、密钥和服务器时间。
 */
export class KjSignatureError extends Error {
  /** @param {number} status @param {string} body */
  constructor(status, body) {
    super(`response signature invalid (HTTP ${status})`);
    this.name = 'KjSignatureError';
    this.status = status;
    this.body = body;
  }
}

/**
 * @typedef {{ code: string, message: string, data: any, status: number }} KjResult
 * code 为 OK 时成功；其他为错误码（如 NOT_FOUND、CONFLICT、REFUND_EXCEEDS）。
 */

/**
 * @param {{
 *   baseUrl: string,          // 接口地址，由平台提供，如 https://api.example.com
 *   siteId: string,           // 站点编号
 *   secret: string,           // 接口密钥
 *   fetch?: typeof fetch,
 *   now?: () => number,
 *   timeoutMs?: number,
 * }} options
 */
export function createKjClient({ baseUrl, siteId, secret, fetch = globalThis.fetch, now = Date.now, timeoutMs = 10000 }) {
  const origin = baseUrl.replace(/\/+$/, '');

  /**
   * @param {string} path
   * @param {object} payload
   * @returns {Promise<KjResult>}
   */
  async function post(path, payload) {
    // 只序列化一次：签名用的和实际发送的必须是同一个字符串
    const body = JSON.stringify(payload);
    const timestamp = String(now());
    const nonce = newNonce();
    const signature = hmacHex(secret, requestStringToSign({ method: 'POST', path, timestamp, nonce, body }));

    const res = await fetch(origin + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-KJ-Key-Id': siteId,
        'X-KJ-Timestamp': timestamp,
        'X-KJ-Nonce': nonce,
        'X-KJ-Signature': signature,
      },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();

    // 用自己这次发出的随机串验回复的签名，验过之后才解析内容
    if (!verifyResponse({ method: 'POST', path, requestNonce: nonce, headers: res.headers, body: text, secret })) {
      throw new KjSignatureError(res.status, text);
    }
    const parsed = JSON.parse(text);
    return { code: parsed.code, message: parsed.message ?? '', data: parsed.data ?? null, status: res.status };
  }

  return {
    /**
     * 下单。同一 siteOrderNo 同样参数重复提交返回同一订单，参数不同返回 CONFLICT。
     * @param {{ siteOrderNo: string, amount: string, currency: 'CNY' | 'USDT', payMethod: 'wechat' | 'alipay' | 'usdt',
     *   customerAccount: string, agentCode?: string | null, notifyUrl?: string | null, returnUrl?: string | null,
     *   subject?: string | null, clientIp?: string | null, extParam?: string | null }} req
     */
    createOrder: (req) => post('/v1/orders', req),

    /**
     * 查单。siteOrderNo 与 orderNo 只传一个。
     * @param {{ siteOrderNo: string } | { orderNo: string }} req
     */
    queryOrder: (req) => post('/v1/orders/query', req),

    /**
     * 申请退款。siteOrderNo 与 orderNo 只传一个；同一 siteRefundNo 重复提交同样参数返回同一退款。
     * @param {{ siteRefundNo: string, amount: string, reason?: string } & ({ siteOrderNo: string } | { orderNo: string })} req
     */
    createRefund: (req) => post('/v1/refunds', req),

    /**
     * 退款查询。siteRefundNo 与 refundNo 只传一个。
     * @param {{ siteRefundNo: string } | { refundNo: string }} req
     */
    queryRefund: (req) => post('/v1/refunds/query', req),
  };
}

/** @typedef {ReturnType<typeof createKjClient>} KjClient */
