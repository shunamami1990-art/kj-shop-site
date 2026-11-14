import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../lib/config.js';

mkdirSync('.tmp', { recursive: true });
const dir = mkdtempSync('.tmp/config-test-');
let counter = 0;
test.after(() => rmSync(dir, { recursive: true, force: true }));

/** 写一个保密文件，返回路径 */
function secretsFile(content, mode = 0o400) {
  const path = join(dir, `s${counter++}.env`);
  writeFileSync(path, content);
  chmodSync(path, mode);
  return path;
}

const base = { KJ_BASE_URL: 'https://api.example.com', KJ_SITE_ID: 'site-1' };
const goodContent = '# 注释\n\nKJ_SECRET=file-secret=with-equals\nSHOP_SESSION_SECRET=file-session\n';

/** 拒绝时错误信息必须包含 mention，且不含任何值 */
function rejects(env, mention) {
  assert.throws(
    () => loadConfig(env),
    (e) => e.message.includes(mention) && !/file-secret|file-session|env-secret|env-session/.test(e.message),
  );
}

test('从保密文件读到两项，值到行尾', () => {
  const config = loadConfig({ ...base, KJ_SECRETS_FILE: secretsFile(goodContent) });
  assert.equal(config.secret, 'file-secret=with-equals');
  assert.equal(config.sessionSecret, 'file-session');
});

test('开发下只有环境变量也可以', () => {
  const config = loadConfig({ ...base, KJ_SECRET: 'env-secret', SHOP_SESSION_SECRET: 'env-session' });
  assert.equal(config.secret, 'env-secret');
  assert.equal(config.sessionSecret, 'env-session');
});

test('开发下可以文件和环境变量各提供一项', () => {
  const file = secretsFile('KJ_SECRET=file-secret\n');
  const config = loadConfig({ ...base, KJ_SECRETS_FILE: file, SHOP_SESSION_SECRET: 'env-session' });
  assert.equal(config.secret, 'file-secret');
  assert.equal(config.sessionSecret, 'env-session');
});

test('拒绝：读不到文件', () => {
  rejects({ ...base, KJ_SECRETS_FILE: join(dir, 'missing.env') }, 'KJ_SECRETS_FILE');
});

test('拒绝：某行没有 =', () => {
  rejects({ ...base, KJ_SECRETS_FILE: secretsFile('KJ_SECRET=file-secret\nfile-session\n') }, 'line 2');
});

test('拒绝：行尾有 CR', () => {
  rejects({ ...base, KJ_SECRETS_FILE: secretsFile('KJ_SECRET=file-secret\r\nSHOP_SESSION_SECRET=file-session\n') }, 'line 1');
});

test('拒绝：名称重复', () => {
  rejects({ ...base, KJ_SECRETS_FILE: secretsFile('KJ_SECRET=file-secret\nKJ_SECRET=file-session\n') }, 'KJ_SECRET');
});

test('拒绝：名称不认识', () => {
  rejects({ ...base, KJ_SECRETS_FILE: secretsFile('KJ_SECRET=file-secret\nKJ_ENV=file-session\n') }, 'KJ_ENV');
});

test('拒绝：文件里的变量与环境变量同名', () => {
  rejects({ ...base, KJ_SECRETS_FILE: secretsFile(goodContent), KJ_SECRET: 'env-secret' }, 'KJ_SECRET');
});

test('production 下：从文件读取成功', () => {
  const config = loadConfig({ ...base, NODE_ENV: 'production', KJ_SECRETS_FILE: secretsFile(goodContent) });
  assert.equal(config.secret, 'file-secret=with-equals');
});

test('production 下：环境变量里有 KJ_SECRET 被拒', () => {
  rejects({ ...base, NODE_ENV: 'production', KJ_SECRETS_FILE: secretsFile('SHOP_SESSION_SECRET=file-session\n'), KJ_SECRET: 'env-secret' }, 'KJ_SECRET');
  rejects({ ...base, NODE_ENV: 'production', KJ_SECRET: 'env-secret', SHOP_SESSION_SECRET: 'env-session' }, 'KJ_SECRET');
});

test('production 下：文件权限宽于 0400 被拒', () => {
  rejects({ ...base, NODE_ENV: 'production', KJ_SECRETS_FILE: secretsFile(goodContent, 0o440) }, '0400');
  rejects({ ...base, NODE_ENV: 'production', KJ_SECRETS_FILE: secretsFile(goodContent, 0o600) }, '0400');
});

test('开发下文件权限不限制', () => {
  const config = loadConfig({ ...base, KJ_SECRETS_FILE: secretsFile(goodContent, 0o644) });
  assert.equal(config.sessionSecret, 'file-session');
});

test('日志只写名称，不写值', () => {
  const logs = [];
  const original = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    loadConfig({ ...base, KJ_SECRETS_FILE: secretsFile(goodContent) });
  } finally {
    console.log = original;
  }
  const text = logs.join('\n');
  assert.match(text, /KJ_SECRET/);
  assert.match(text, /SHOP_SESSION_SECRET/);
  assert.doesNotMatch(text, /file-secret|file-session/);
});
