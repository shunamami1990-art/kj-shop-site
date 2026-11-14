// 登录 cookie：账号名 + 过期时间（7 天）+ HMAC 签名。示例用，没有密码。
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'shop_session';
const MAX_ACCOUNT_LENGTH = 64;
const SESSION_SECONDS = 7 * 24 * 3600;

/** @param {string} secret @param {string} payload */
function mac(secret, payload) {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('base64url');
}

/**
 * 账号名 1～64 个字符，不含控制字符；返回去掉首尾空白后的账号，不合格返回 null。
 * @param {unknown} input
 */
export function normalizeAccount(input) {
  if (typeof input !== 'string') return null;
  const account = input.trim();
  if (account === '' || [...account].length > MAX_ACCOUNT_LENGTH) return null;
  if (/[\u0000-\u001f\u007f]/.test(account)) return null;
  return account;
}

/**
 * 签名内容是"账号名 + 过期时间"，改了过期时间签名就对不上。
 * @param {string} account @param {string} secret @param {number} [nowSeconds] 当前 Unix 秒，测试用
 */
export function signSession(account, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const payload = `${Buffer.from(account, 'utf8').toString('base64url')}.${nowSeconds + SESSION_SECONDS}`;
  return `${payload}.${mac(secret, payload)}`;
}

/**
 * @param {string | undefined | null} value cookie 的值
 * @param {string} secret
 * @param {number} [nowSeconds] 当前 Unix 秒，测试用
 * @returns {string | null} 账号名；签名不符或已过期返回 null
 */
export function readSession(value, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!value) return null;
  const [name, expires, signature, extra] = value.split('.');
  if (!name || !expires || !signature || extra !== undefined) return null;
  const expected = Buffer.from(mac(secret, `${name}.${expires}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (!/^[0-9]+$/.test(expires) || Number(expires) <= nowSeconds) return null;
  return normalizeAccount(Buffer.from(name, 'base64url').toString('utf8'));
}

/**
 * 从请求头 Cookie 里取登录账号。
 * @param {string | null | undefined} cookieHeader
 * @param {string} secret
 */
export function accountFromCookieHeader(cookieHeader, secret) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === SESSION_COOKIE) {
      return readSession(part.slice(index + 1).trim(), secret);
    }
  }
  return null;
}

/**
 * @param {string} account @param {string} secret
 * @param {boolean} secure 经 HTTPS 访问（或生产环境）时加 Secure
 */
export function sessionCookie(account, secret, secure) {
  return `${SESSION_COOKIE}=${signSession(account, secret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure ? '; Secure' : ''}`;
}

/** 请求经 HTTPS 到达（反向代理带 x-forwarded-proto: https）或运行在生产环境时，cookie 加 Secure */
export function isSecureRequest(/** @type {Headers} */ headers) {
  return headers.get('x-forwarded-proto') === 'https' || process.env.NODE_ENV === 'production';
}
