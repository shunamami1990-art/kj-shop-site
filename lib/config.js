// 配置。缺少必填项时直接报错，错误信息只写变量名，不写值。
// 两项保密内容（KJ_SECRET、SHOP_SESSION_SECRET）可以放在 KJ_SECRETS_FILE 指向的文件里，
// 这样部署时不必经环境变量传递（容器的环境变量会被写到磁盘上）。
import { readFileSync, statSync } from 'node:fs';

const SECRET_NAMES = ['KJ_SECRET', 'SHOP_SESSION_SECRET'];

/**
 * 读保密文件：每行 `名称=值`，值到行尾，不加引号；`#` 开头的行和空行忽略。
 * 任何不合规的情形都抛错，错误里只写名称或行号，不写值。
 * @param {string} path
 * @param {boolean} production
 * @returns {Record<string, string>}
 */
function readSecretsFile(path, production) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error('cannot read secrets file (KJ_SECRETS_FILE)');
  }
  if (production && (statSync(path).mode & 0o777 & ~0o400) !== 0) {
    throw new Error('secrets file permissions are wider than 0400 (KJ_SECRETS_FILE)');
  }
  /** @type {Record<string, string>} */
  const values = {};
  text.split('\n').forEach((line, index) => {
    if (line.endsWith('\r')) throw new Error(`secrets file line ${index + 1} ends with CR`);
    if (line === '' || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    if (eq < 0) throw new Error(`secrets file line ${index + 1} has no "="`);
    const name = line.slice(0, eq);
    if (!SECRET_NAMES.includes(name)) throw new Error(`secrets file has unknown name ${name}`);
    if (name in values) throw new Error(`secrets file has duplicate name ${name}`);
    values[name] = line.slice(eq + 1);
  });
  return values;
}

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  /** @type {Record<string, string | undefined>} */
  let merged = env;
  if (env.KJ_SECRETS_FILE) {
    const fromFile = readSecretsFile(env.KJ_SECRETS_FILE, production);
    for (const name of Object.keys(fromFile)) {
      if (env[name] !== undefined) throw new Error(`${name} is set in both the secrets file and the environment`);
    }
    merged = { ...env, ...fromFile };
    console.log(`secrets file: read ${Object.keys(fromFile).join(', ') || '(no names)'}`);
  }
  if (production) {
    for (const name of SECRET_NAMES) {
      if (env[name] !== undefined) throw new Error(`${name} must come from the secrets file in production, not the environment`);
    }
  }
  /** @param {string} name */
  const required = (name) => {
    const value = merged[name];
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
