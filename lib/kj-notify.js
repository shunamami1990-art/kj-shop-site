// 接收订单事件通知（C1 orderEvent）。
// 顺序：验签 -> 按 eventId 去重 -> order.paid 先查单确认 -> 开通 -> 记下 eventId -> 回复 success。
import { verifyRequest } from './kj-sign.js';

/**
 * 站点自己的存储。示例的内存实现见 site-store.js，正式使用时换成数据库。
 * @typedef {{
 *   isEventDone(eventId: string): boolean | Promise<boolean>,
 *   markEventDone(eventId: string): void | Promise<void>,
 *   findOrderBySiteOrderNo(siteOrderNo: string): { siteOrderNo: string, account: string, amount: string, currency: string } | null | undefined
 *     | Promise<{ siteOrderNo: string, account: string, amount: string, currency: string } | null | undefined>,
 *   fulfill(order: any): void | Promise<void>,
 *   recordRefundEvent(event: any): void | Promise<void>,
 * }} SiteStore
 * fulfill 给客户开通，必须按 orderNo 保证只开通一次：以 orderNo 为唯一键插入，冲突即视为已开通（写法见 site-store.js）。
 * 不能"先查有没有开通过、再写入"：同一通知并发送达两次时，两边都会查到"没有"。
 */

/**
 * 收到 order.paid 后调查单接口确认。只有 平台 回答这笔订单是 paid、并且订单金额和币种与站点自己记录的相符，
 * 才返回 ok。开通时使用查单返回的数据，不使用通知里的数据。
 * @param {{ client: import('./kj-client.js').KjClient, store: SiteStore, orderNo: unknown }} p
 * @returns {Promise<{ ok: true, order: any } | { ok: false, reason: string }>}
 */
export async function confirmPaidOrder({ client, store, orderNo }) {
  if (typeof orderNo !== 'string' || orderNo === '') return { ok: false, reason: 'missing orderNo' };

  // 查单的回复签名绑定了这次请求的随机串，验不过时 queryOrder 会抛出 KjSignatureError
  const res = await client.queryOrder({ orderNo });
  if (res.code !== 'OK') return { ok: false, reason: `query failed: ${res.code}` };
  const order = res.data;
  if (!order || order.orderNo !== orderNo) return { ok: false, reason: 'orderNo mismatch' };
  if (order.status !== 'paid') return { ok: false, reason: `status is ${order.status}` };

  if (order.source === 'api') {
    // 站点自己下的单：订单金额必须与下单时记录的完全相同（金额是固定小数位的字符串，直接比较）
    const local = await store.findOrderBySiteOrderNo(order.siteOrderNo);
    if (!local) return { ok: false, reason: 'unknown siteOrderNo' };
    if (local.amount !== order.amount || local.currency !== order.currency) {
      return { ok: false, reason: 'amount mismatch' };
    }
    // 开通给谁以查单返回的账号为准，必须与下单时记录的账号一致
    if (local.account !== order.customerAccount) return { ok: false, reason: 'customerAccount mismatch' };
    return { ok: true, order };
  }
  if (order.source === 'paycode' || order.source === 'shop') {
    // 站点事先没有记录，以查单返回的 customerAccount 和 amount 为准；没有账号就不知道给谁开通
    if (typeof order.customerAccount !== 'string' || order.customerAccount === '') return { ok: false, reason: 'missing customerAccount' };
    return { ok: true, order };
  }
  // 来源缺失或不认识（包括契约将来新增的）：不知道该按什么核对，不开通，交人工核对
  return { ok: false, reason: `unknown source ${order.source}` };
}

/**
 * @param {string} body
 * @param {number} status
 */
function text(body, status) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

/**
 * 处理一次通知请求，返回要回复给 平台 的 Response。
 * 只有回复 200 且正文正好是小写 success 时 平台 才认为送达；其他回复 平台 会按 0、30、60、300、600、1800、3600 秒重试。
 * @param {{
 *   request: Request,
 *   siteId: string,
 *   secret: string,
 *   nonceStore: import('./kj-sign.js').NonceStore,
 *   client: import('./kj-client.js').KjClient,
 *   store: SiteStore,
 *   now?: () => number,
 *   log?: (message: string) => void,
 * }} p
 */
export async function handleNotify({ request, siteId, secret, nonceStore, client, store, now = Date.now, log = console.error }) {
  // 必须用收到的原文验签，不能先 request.json() 再重新序列化
  const body = await request.text();
  const url = new URL(request.url);
  const verified = await verifyRequest({
    method: request.method,
    path: url.pathname + url.search,
    headers: request.headers,
    body,
    siteId,
    secret,
    nonceStore,
    now,
  });
  if (!verified.ok) {
    log(`kj notify rejected: ${verified.reason}`);
    return text('unauthorized', 401);
  }

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return text('bad request', 400);
  }
  if (typeof event?.eventId !== 'string' || event.eventId === '') return text('bad request', 400);

  // 同一事件会因为重试收到多次，处理过的直接回复 success
  if (await store.isEventDone(event.eventId)) return text('success', 200);

  try {
    if (event.event === 'order.paid') {
      const confirmed = await confirmPaidOrder({ client, store, orderNo: event.order?.orderNo });
      if (!confirmed.ok) {
        // 不开通，也不回复 success：交给人工核对（可能是伪造的通知，或站点记录有误）
        log(`kj order.paid not confirmed: eventId=${event.eventId} reason=${confirmed.reason}`);
        return text('not confirmed', 409);
      }
      await store.fulfill(confirmed.order);
    } else if (event.event === 'refund.succeeded' || event.event === 'refund.failed') {
      await store.recordRefundEvent(event);
    } else {
      // 不认识的事件（如契约将来新增的）：记下 eventId 并回复 success，否则 平台 会一直重试；同时告警，由人决定要不要处理
      log(`kj notify warning: unknown event ${event.event} eventId=${event.eventId}`);
    }
  } catch (err) {
    // 查单网络错误、查单回复验签失败、数据库错误等：不记 eventId，等 平台 重试
    log(`kj notify failed: eventId=${event.eventId} ${err instanceof Error ? err.message : String(err)}`);
    return text('error', 500);
  }

  await store.markEventDone(event.eventId);
  return text('success', 200);
}
