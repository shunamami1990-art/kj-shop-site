// 登录 cookie：账号名 + HMAC 签名。示例用，没有密码。
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'shop_session';
const MAX_ACCOUNT_LENGTH = 64;

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

/** @param {string} account @param {string} secret */
export function signSession(account, secret) {
  const payload = Buffer.from(account, 'utf8').toString('base64url');
  return `${payload}.${mac(secret, payload)}`;
}

/**
 * @param {string | undefined | null} value cookie 的值
 * @param {string} secret
 * @returns {string | null} 账号名；签名不符返回 null
 */
export function readSession(value, secret) {
  if (!value) return null;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(mac(secret, payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return normalizeAccount(Buffer.from(payload, 'base64url').toString('utf8'));
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

/** @param {string} account @param {string} secret */
export function sessionCookie(account, secret) {
  return `${SESSION_COOKIE}=${signSession(account, secret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`;
}
