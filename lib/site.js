// 把配置、数据库、平台客户端组装起来。第一次使用时才读环境变量（构建镜像时不需要密钥）。
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createKjClient } from './kj-client.js';
import { accountFromCookieHeader } from './session.js';

/** Next.js 可能把各路由打成独立的包，用 globalThis 保证进程内只有一份 */
const KEY = Symbol.for('shop-site.instance');

export function getSite() {
  const g = /** @type {any} */ (globalThis);
  if (!g[KEY]) {
    const config = loadConfig();
    const db = openDb(config.dbPath);
    const client = createKjClient({ baseUrl: config.baseUrl, siteId: config.siteId, secret: config.secret });
    g[KEY] = { config, db, client };
  }
  return /** @type {{ config: ReturnType<typeof loadConfig>, db: import('./db.js').ShopDb, client: import('./kj-client.js').KjClient }} */ (g[KEY]);
}

/**
 * 请求里的登录账号；未登录返回 null。
 * @param {string | null | undefined} cookieHeader
 */
export function currentAccount(cookieHeader) {
  return accountFromCookieHeader(cookieHeader, getSite().config.sessionSecret);
}

/**
 * 本站接口的统一错误回复：{ code, message, data: null }。
 * @param {number} status @param {string} code @param {string} message
 */
export function jsonError(status, code, message) {
  return Response.json({ code, message, data: null }, { status });
}

/**
 * 解析请求体里的 JSON 对象，不是对象时返回 null。
 * @param {Request} request
 */
export async function readJsonObject(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}
