// 核对本项目 contracts/ 下的契约副本是否与 MANIFEST.json 一致。
// 由架构师分发，项目内不要修改。提交前由 .githooks/pre-commit 调用。
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const dir = 'contracts';
const manifestPath = join(dir, 'MANIFEST.json');
if (!existsSync(manifestPath)) {
  console.error('缺少 contracts/MANIFEST.json，请联系架构师重新分发契约');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

function listFiles(d) {
  return readdirSync(d).flatMap((name) => {
    const p = join(d, name);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

const problems = [];
const actual = listFiles(dir)
  .map((p) => relative(dir, p).split(sep).join('/'))
  .filter((p) => p !== 'MANIFEST.json');

for (const [file, hash] of Object.entries(manifest.files)) {
  const p = join(dir, file);
  if (!existsSync(p)) {
    problems.push(`缺少：${file}`);
    continue;
  }
  const h = createHash('sha256').update(readFileSync(p)).digest('hex');
  if (h !== hash) problems.push(`被修改：${file}`);
}
for (const file of actual) {
  if (!(file in manifest.files)) problems.push(`多出的文件：${file}`);
}

if (problems.length > 0) {
  console.error('契约副本与清单不一致（契约只能由架构师修改，有疑问请写到 issues/to-architect/）：');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`契约副本一致（版本 ${manifest.version}）`);
