// 校验客户账号（C1 verifyCustomer）：由站点提供，平台 在生成付款码前调用。
// 请求要验签；回复也要签名，平台 验不过回复的签名时按校验失败处理。
import { signResponseHeaders, verifyRequest } from './kj-sign.js';

/**
 * C1 规定 displayName 最长 64 个字符。按字符（Unicode 码点）截取，不按字节，也不按 UTF-16 单元，避免把汉字或 emoji 截成半个。
 * @param {string | null | undefined} name
 */
export function truncateDisplayName(name) {
  if (typeof name !== 'string') return null;
  return [...name].slice(0, 64).join('');
}

/**
 * @param {{
 *   request: Request,
 *   siteId: string,
 *   secret: string,
 *   nonceStore: import('./kj-sign.js').NonceStore,
 *   findCustomer: (customerAccount: string) => { displayName?: string | null } | null | undefined
 *     | Promise<{ displayName?: string | null } | null | undefined>,
 *   now?: () => number,
 * }} p
 */
export async function handleVerifyCustomer({ request, siteId, secret, nonceStore, findCustomer, now = Date.now }) {
  const body = await request.text();
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname + url.search;

  const verified = await verifyRequest({ method, path, headers: request.headers, body, siteId, secret, nonceStore, now });
  if (!verified.ok) {
    // 请求验签失败时的错误回复不签名
    return Response.json({ code: 'UNAUTHORIZED', message: 'signature invalid', data: null }, { status: 401 });
  }

  /**
   * @param {object} payload
   * @param {number} status
   */
  const signed = (payload, status) => {
    const out = JSON.stringify(payload);
    const headers = signResponseHeaders({ method, path, requestNonce: verified.nonce, body: out, siteId, secret, now });
    return new Response(out, { status, headers: { 'Content-Type': 'application/json', ...headers } });
  };

  let customerAccount;
  try {
    customerAccount = JSON.parse(body)?.customerAccount;
  } catch {
    customerAccount = undefined;
  }
  if (typeof customerAccount !== 'string' || customerAccount === '' || customerAccount.length > 64) {
    return signed({ code: 'INVALID_PARAM', message: 'customerAccount', data: null }, 400);
  }

  const customer = await findCustomer(customerAccount);
  return signed(
    // displayName 只用于操作人员核对，请脱敏（如 "张*"），可以为 null
    { code: 'OK', message: '', data: { exists: Boolean(customer), displayName: truncateDisplayName(customer?.displayName) } },
    200,
  );
}
