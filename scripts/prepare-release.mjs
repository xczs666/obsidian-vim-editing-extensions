import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.equal(manifest.version, pkg.version);
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
for (const file of ['LICENSE', 'README.md']) assert.ok(fs.statSync(file).size > 0);
const out = path.join('release', manifest.version);
fs.mkdirSync(out, { recursive: true });
const files = ['main.js', 'manifest.json'];
const sums = [];
for (const file of files) {
  const data = fs.readFileSync(file);
  fs.writeFileSync(path.join(out, file), data);
  sums.push(crypto.createHash('sha256').update(data).digest('hex') + '  ' + file);
}
fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
console.log(`Prepared ${manifest.id} ${manifest.version}: ${files.join(', ')} and SHA256SUMS.txt`);
