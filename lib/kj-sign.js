// 签名与验签（common.md 第 3 节）。只用 Node 内置的 crypto。
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const HEADER_KEY_ID = 'x-kj-key-id';
export const HEADER_TIMESTAMP = 'x-kj-timestamp';
export const HEADER_NONCE = 'x-kj-nonce';
export const HEADER_SIGNATURE = 'x-kj-signature';

/** 时间戳与本机时间最多相差 5 分钟 */
export const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
/** 同一密钥下 10 分钟内的随机串不能重复 */
export const NONCE_TTL_MS = 10 * 60 * 1000;

const NONCE_PATTERN = /^[A-Za-z0-9]{16,64}$/;
const TIMESTAMP_PATTERN = /^[0-9]{1,16}$/;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;

/**
 * 请求的待签字符串。body 必须是实际发送或收到的原文，不能先解析再重新序列化。
 * @param {{ method: string, path: string, timestamp: string, nonce: string, body: string }} p
 */
export function requestStringToSign({ method, path, timestamp, nonce, body }) {
  return ['KJ-REQ', method.toUpperCase(), path, timestamp, nonce, body].join('\n');
}

/**
 * 响应的待签字符串。method、path、requestNonce 取它所回答的那次请求的值。
 * @param {{ method: string, path: string, timestamp: string, nonce: string, requestNonce: string, body: string }} p
 */
export function responseStringToSign({ method, path, timestamp, nonce, requestNonce, body }) {
  return ['KJ-RESP', method.toUpperCase(), path, timestamp, nonce, requestNonce, body].join('\n');
}

/**
 * HMAC-SHA256，输出小写十六进制。字符串按 UTF-8 字节计算。
 * @param {string} secret
 * @param {string} stringToSign
 */
export function hmacHex(secret, stringToSign) {
  return createHmac('sha256', secret).update(stringToSign, 'utf8').digest('hex');
}

/** 32 位十六进制随机串（只含字母和数字） */
export function newNonce() {
  return randomBytes(16).toString('hex');
}

/**
 * 按常量时间比较两个签名，避免按耗时猜出签名。
 * @param {string} expected
 * @param {string} actual
 */
export function signatureEquals(expected, actual) {
  if (!SIGNATURE_PATTERN.test(actual)) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(actual, 'utf8'));
}

/**
 * 记录用过的随机串。示例保存在内存里，只适用于单个进程；
 * 站点程序多实例运行时必须换成各实例共享的存储（如 Redis 的 SET NX PX）。
 */
export class MemoryNonceStore {
  /** @param {() => number} [now] */
  constructor(now = Date.now) {
    this.now = now;
    /** @type {Map<string, number>} 键 -> 过期时刻 */
    this.seen = new Map();
  }

  /**
   * 随机串没用过时记下并返回 true；10 分钟内用过返回 false。
   * @param {string} keyId
   * @param {string} nonce
   */
  remember(keyId, nonce) {
    // 过期时刻从记下的这一刻算起
    const now = this.now();
    for (const [k, expireAt] of this.seen) {
      if (expireAt <= now) this.seen.delete(k);
    }
    const key = `${keyId}\n${nonce}`;
    if (this.seen.has(key)) return false;
    this.seen.set(key, now + NONCE_TTL_MS);
    return true;
  }
}

/**
 * @typedef {{ get(name: string): string | null }} HeaderReader
 * @typedef {{ remember(keyId: string, nonce: string): boolean | Promise<boolean> }} NonceStore
 */

/**
 * 验证 平台 发来的请求（通知、校验客户账号）。
 * 返回 { ok: true, nonce } 或 { ok: false, reason }；验签失败时回复 401，回复不签名。
 * @param {{
 *   method: string,
 *   path: string,
 *   headers: HeaderReader,
 *   body: string,
 *   siteId: string,
 *   secret: string,
 *   nonceStore: NonceStore,
 *   now?: () => number,
 * }} p
 * @returns {Promise<{ ok: true, nonce: string } | { ok: false, reason: string }>}
 */
export async function verifyRequest({ method, path, headers, body, siteId, secret, nonceStore, now = Date.now }) {
  const keyId = headers.get(HEADER_KEY_ID);
  const timestamp = headers.get(HEADER_TIMESTAMP);
  const nonce = headers.get(HEADER_NONCE);
  const signature = headers.get(HEADER_SIGNATURE);

  if (keyId !== siteId) return { ok: false, reason: 'key id mismatch' };
  if (!timestamp || !TIMESTAMP_PATTERN.test(timestamp)) return { ok: false, reason: 'bad timestamp' };
  if (Math.abs(now() - Number(timestamp)) > TIMESTAMP_TOLERANCE_MS) return { ok: false, reason: 'timestamp out of range' };
  if (!nonce || !NONCE_PATTERN.test(nonce)) return { ok: false, reason: 'bad nonce' };
  if (!signature) return { ok: false, reason: 'missing signature' };

  const expected = hmacHex(secret, requestStringToSign({ method, path, timestamp, nonce, body }));
  if (!signatureEquals(expected, signature)) return { ok: false, reason: 'bad signature' };

  // 签名通过后再记随机串，免得别人用乱签的请求占掉随机串
  if (!(await nonceStore.remember(keyId, nonce))) return { ok: false, reason: 'nonce reused' };
  return { ok: true, nonce };
}

/**
 * 为自己的回复生成签名请求头（校验客户账号的回复需要签名，通知的 success 回复不需要）。
 * @param {{ method: string, path: string, requestNonce: string, body: string, siteId: string, secret: string, now?: () => number }} p
 * @returns {Record<string, string>}
 */
export function signResponseHeaders({ method, path, requestNonce, body, siteId, secret, now = Date.now }) {
  const timestamp = String(now());
  const nonce = newNonce();
  const signature = hmacHex(secret, responseStringToSign({ method, path, timestamp, nonce, requestNonce, body }));
  return {
    'X-KJ-Key-Id': siteId,
    'X-KJ-Timestamp': timestamp,
    'X-KJ-Nonce': nonce,
    'X-KJ-Signature': signature,
  };
}

/**
 * 验证 平台 对自己请求的回复。requestNonce 是自己这次请求发出的随机串，
 * 所以旧回复不能拿来回答新请求。不需要检查回复的时间戳和随机串是否重复。
 * @param {{ method: string, path: string, requestNonce: string, headers: HeaderReader, body: string, secret: string }} p
 */
export function verifyResponse({ method, path, requestNonce, headers, body, secret }) {
  const timestamp = headers.get(HEADER_TIMESTAMP);
  const nonce = headers.get(HEADER_NONCE);
  const signature = headers.get(HEADER_SIGNATURE);
  if (!timestamp || !nonce || !signature) return false;
  const expected = hmacHex(secret, responseStringToSign({ method, path, timestamp, nonce, requestNonce, body }));
  return signatureEquals(expected, signature);
}
