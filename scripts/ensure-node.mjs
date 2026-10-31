import { existsSync, mkdirSync, createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '22.20.0';
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const platform = process.platform === 'darwin' ? 'darwin' : process.platform;
const archive = `node-v${version}-${platform}-${arch}.tar.gz`;
const tools = path.join(root, '.tools');
const target = path.join(tools, `node-v${version}-${platform}-${arch}`);
const link = path.join(tools, 'node');
const binary = path.join(link, 'bin', 'node');

if (existsSync(binary)) process.exit(0);
if (platform !== 'darwin') {
  console.log('[ensure-node] Non-macOS build: using Node from PATH.');
  process.exit(0);
}

mkdirSync(tools, { recursive: true });
const tmp = path.join(tools, `${archive}.download`);
const url = `https://nodejs.org/dist/v${version}/${archive}`;
console.log(`[ensure-node] Downloading ${url}`);

await new Promise((resolve, reject) => {
  const request = https.get(url, response => {
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      response.resume();
      https.get(response.headers.location, next => next.pipe(createWriteStream(tmp)).on('finish', resolve)).on('error', reject);
      return;
    }
    if (response.statusCode !== 200) return reject(new Error(`Node download failed: HTTP ${response.statusCode}`));
    response.pipe(createWriteStream(tmp)).on('finish', resolve);
  });
  request.on('error', reject);
});

execFileSync('tar', ['-xzf', tmp, '-C', tools]);
execFileSync('ln', ['-sfn', path.basename(target), link]);
await rm(tmp, { force: true });
console.log(`[ensure-node] Ready: ${binary}`);
