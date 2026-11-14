// 下单、查单、退款、退款通知的业务逻辑。页面和接口都只调用这里，数据库和平台客户端由调用方传入（deps）。
import { randomBytes } from 'node:crypto';
import { findProduct, isPayMethodAllowed } from './products.js';

/** @typedef {{ db: import('./db.js').ShopDb, client: import('./kj-client.js').KjClient }} Deps */

const DECIMALS = { CNY: 2, USDT: 6 };
const AMOUNT_PATTERN = /^(0|[1-9][0-9]{0,11})\.[0-9]{2,6}$/;

/** 平台业务错误码的中文说明；不在表里的原样显示错误码 */
const ERROR_TEXT = {
  SITE_DISABLED: '本站暂停收款，请稍后再试',
  PAY_METHOD_UNAVAILABLE: '该支付方式当前不可用，请换一种支付方式',
  RATE_LIMITED: '未支付的订单过多，请稍后再试',
  AMOUNT_OUT_OF_RANGE: '金额超出限额',
  ORDER_NOT_PAID: '订单未支付，不能退款',
  REFUND_EXCEEDS: '退款金额超过可退金额',
};

/** @param {string} code @param {string} message */
function errorText(code, message) {
  return /** @type {Record<string, string>} */ (ERROR_TEXT)[code] ?? `${code}${message ? `：${message}` : ''}`;
}

/** 平台暂时不可用的错误码：回 503，客户可以稍后重试 */
const UNAVAILABLE_CODES = ['INTERNAL_ERROR', 'UNAVAILABLE'];

function stamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

/** @param {string} prefix */
export function newNo(prefix) {
  return `${prefix}${stamp()}${randomBytes(4).toString('hex')}`;
}

/** 金额字符串换算成最小单位（6 位小数）的整数，只用 BigInt，不做浮点运算 */
function toMicro(/** @type {string} */ amount) {
  const [int, frac = ''] = amount.split('.');
  return BigInt(int + frac.padEnd(6, '0'));
}

/**
 * 可退金额 = 订单金额 - 已退金额，返回与订单金额相同小数位的字符串。
 * @param {string} amount @param {string} refunded
 */
export function refundableAmount(amount, refunded) {
  const scale = amount.split('.')[1]?.length ?? 0;
  const left = toMicro(amount) - toMicro(refunded);
  const value = (left < 0n ? 0n : left).toString().padStart(7, '0');
  const int = value.slice(0, -6);
  const frac = value.slice(-6).slice(0, scale);
  return scale > 0 ? `${int}.${frac}` : int;
}

/**
 * 调用平台，把异常（网络错误、回复验签失败）统一成 502。
 * @template T @param {() => Promise<T>} call
 */
async function callPlatform(call) {
  try {
    return { ok: /** @type {const} */ (true), res: await call() };
  } catch (err) {
    console.error(`platform call failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: /** @type {const} */ (false) };
  }
}

/**
 * 下单：金额和币种只看商品表。
 * @param {Deps} deps
 * @param {{ account: string, productId: unknown, payMethod: unknown }} req
 * @returns {Promise<{ ok: true, siteOrderNo: string } | { ok: false, status: number, code: string, message: string }>}
 */
export async function createPayOrder({ db, client }, { account, productId, payMethod }) {
  const product = findProduct(productId);
  if (!product) return { ok: false, status: 404, code: 'PRODUCT_NOT_FOUND', message: '商品不存在' };
  if (!isPayMethodAllowed(product.currency, payMethod)) {
    return { ok: false, status: 400, code: 'INVALID_PARAM', message: '该商品不支持这种支付方式' };
  }

  const siteOrderNo = newNo('S');
  db.insertOrder({
    siteOrderNo,
    account,
    productId: product.id,
    amount: product.price,
    currency: product.currency,
    payMethod: /** @type {string} */ (payMethod),
    status: 'created',
  });

  const called = await callPlatform(() =>
    client.createOrder({
      siteOrderNo,
      amount: product.price,
      currency: /** @type {'CNY' | 'USDT'} */ (product.currency),
      payMethod: /** @type {'wechat' | 'alipay' | 'usdt'} */ (payMethod),
      customerAccount: account,
      subject: product.name,
    }),
  );
  if (!called.ok) {
    db.setOrderStatus(siteOrderNo, 'closed');
    return { ok: false, status: 502, code: 'PLATFORM_ERROR', message: '暂时无法连接支付平台，请稍后再试' };
  }
  const { res } = called;
  if (res.code !== 'OK') {
    db.setOrderStatus(siteOrderNo, 'closed');
    const status = UNAVAILABLE_CODES.includes(res.code) ? 503 : res.status >= 400 && res.status < 500 ? res.status : 422;
    return { ok: false, status, code: res.code, message: errorText(res.code, res.message) };
  }
  db.saveCreated(siteOrderNo, res.data.orderNo, res.data.payableAmount ?? null, res.data.payment);
  return { ok: true, siteOrderNo };
}

/**
 * 订单状态：本地记录加平台查单。本地订单未到终态（或 force）时查单；
 * 查单结果未知（网络错误、验签失败、平台 5xx）时返回本地状态并标 stale，不当作未支付。
 * 已开通以本地记录为准（开通只在收到通知并查单确认后发生）。
 * @param {Deps} deps
 * @param {{ account: string, siteOrderNo: string, force?: boolean }} req
 */
export async function getOrderStatus({ db, client }, { account, siteOrderNo, force = false }) {
  const local = db.getOrder(siteOrderNo);
  if (!local || local.account !== account) return null;

  let remote = null;
  let stale = false;
  if (local.order_no && (force || local.status === 'created')) {
    const called = await callPlatform(() => client.queryOrder({ orderNo: local.order_no }));
    if (called.ok && called.res.code === 'OK') {
      remote = called.res.data;
      if (remote.status === 'closed' && local.status === 'created') db.setOrderStatus(siteOrderNo, 'closed');
    } else {
      stale = true;
    }
  }
  const status = remote?.status === 'closed' && local.status === 'created' ? 'closed' : local.status;
  return {
    siteOrderNo,
    status,
    fulfilled: local.status === 'paid',
    stale,
    remote: remote && {
      orderNo: remote.orderNo,
      status: remote.status,
      paidAmount: remote.paidAmount ?? null,
      refundedAmount: remote.refundedAmount,
      expireAt: remote.expireAt ?? null,
    },
  };
}

/**
 * 申请退款。
 * @param {Deps} deps
 * @param {{ account: string, siteOrderNo: unknown, amount: unknown, reason: unknown }} req
 * @returns {Promise<{ ok: true, siteRefundNo: string, status: string } | { ok: false, status: number, code: string, message: string }>}
 */
export async function createRefund({ db, client }, { account, siteOrderNo, amount, reason }) {
  const local = typeof siteOrderNo === 'string' ? db.getOrder(siteOrderNo) : null;
  if (!local || local.account !== account) return { ok: false, status: 404, code: 'NOT_FOUND', message: '订单不存在' };
  if (local.status !== 'paid') return { ok: false, status: 422, code: 'ORDER_NOT_PAID', message: errorText('ORDER_NOT_PAID', '') };

  const scale = /** @type {Record<string, number>} */ (DECIMALS)[local.currency];
  if (typeof amount !== 'string' || !AMOUNT_PATTERN.test(amount) || amount.split('.')[1].length !== scale) {
    return { ok: false, status: 400, code: 'INVALID_PARAM', message: `退款金额格式不对，应为 ${scale} 位小数` };
  }
  const reasonText = typeof reason === 'string' ? reason.trim() : '';
  if ([...reasonText].length > 200) return { ok: false, status: 400, code: 'INVALID_PARAM', message: '退款原因最长 200 个字符' };

  const siteRefundNo = newNo('R');
  db.insertRefund({ siteRefundNo, siteOrderNo: local.site_order_no, amount, status: 'created', reason: reasonText || null });
  const called = await callPlatform(() =>
    client.createRefund({ siteRefundNo, orderNo: local.order_no, amount, ...(reasonText ? { reason: reasonText } : {}) }),
  );
  if (!called.ok) return { ok: false, status: 502, code: 'PLATFORM_ERROR', message: '暂时无法连接支付平台，退款结果未知，请稍后查看订单' };
  const { res } = called;
  if (res.code !== 'OK') {
    db.updateRefund(siteRefundNo, null, 'failed');
    const status = UNAVAILABLE_CODES.includes(res.code) ? 503 : res.status >= 400 && res.status < 500 ? res.status : 422;
    return { ok: false, status, code: res.code, message: errorText(res.code, res.message) };
  }
  db.updateRefund(siteRefundNo, res.data.refundNo, res.data.status);
  return { ok: true, siteRefundNo, status: res.data.status };
}

/**
 * 退款通知：更新本站申请的退款；后台发起（admin）或通道退回（upstream）的退款本地没有记录，补记一条。
 * @param {import('./db.js').ShopDb} db
 * @param {any} event
 */
export function recordRefundEvent(db, event) {
  const r = event?.refund;
  if (!r || typeof r.refundNo !== 'string') return;
  const known = (r.siteRefundNo && db.getRefund(r.siteRefundNo)) || db.getRefundByNo(r.refundNo);
  if (known) {
    db.updateRefund(known.site_refund_no, r.refundNo, r.status);
    return;
  }
  const order = db.getOrderByOrderNo(r.orderNo);
  db.insertRefund({
    siteRefundNo: r.siteRefundNo || `X-${r.refundNo}`,
    siteOrderNo: order?.site_order_no ?? r.orderNo,
    refundNo: r.refundNo,
    amount: r.amount,
    status: r.status,
  });
}

/**
 * 通知处理用的存储（kj-notify.js 的 SiteStore）。
 * @param {import('./db.js').ShopDb} db
 */
export function createNotifyStore(db) {
  return {
    isEventDone: (/** @type {string} */ eventId) => db.isEventDone(eventId),
    markEventDone: (/** @type {string} */ eventId) => db.markEventDone(eventId),
    findOrderBySiteOrderNo(/** @type {string} */ siteOrderNo) {
      const o = db.getOrder(siteOrderNo);
      return o && { siteOrderNo: o.site_order_no, amount: o.amount, currency: o.currency };
    },
    fulfill: (/** @type {any} */ order) => void db.fulfill(order),
    recordRefundEvent: (/** @type {any} */ event) => recordRefundEvent(db, event),
  };
}
