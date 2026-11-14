// 环境变量配置。缺少必填项时直接报错，错误信息只写变量名，不写值。

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function loadConfig(env = process.env) {
  /** @param {string} name */
  const required = (name) => {
    const value = env[name];
    if (!value) throw new Error(`missing environment variable ${name}`);
    return value;
  };
  return {
    baseUrl: required('KJ_BASE_URL'),
    siteId: required('KJ_SITE_ID'),
    secret: required('KJ_SECRET'),
    sessionSecret: required('SHOP_SESSION_SECRET'),
    dbPath: env.SHOP_DB_PATH || './data/shop.db',
    port: Number(env.PORT) || 18120,
  };
}
