import { existsSync, mkdirSync, copyFileSync, chmodSync, renameSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
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

mkdirSync(tools, { recursive: true });
if (platform !== 'darwin') {
  // The resource list is shared by platforms; keep the directory present so
  // Tauri can bundle on Windows, while Windows continues using PATH Node.
  mkdirSync(link, { recursive: true });
  process.exit(0);
}
// curl fails on incomplete transfers; tar must finish before binaries are published.
async function installArchive(url, name, install) {
  const staging = path.join(tools, `.prepare-${name}-${process.pid}`);
  mkdirSync(staging, { recursive: true });
  const archivePath = path.join(staging, 'archive.tar.gz');
  try {
    console.log(`[ensure-node] Downloading ${url}`);
    execFileSync('/usr/bin/curl', ['-fL', '--retry', '3', '--connect-timeout', '15',
      '--max-time', '300', '-o', archivePath, url], { stdio: 'inherit' });
    execFileSync('/usr/bin/tar', ['-xzf', archivePath, '-C', staging]);
    install(staging);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (!existsSync(binary)) {
  await installArchive(`https://nodejs.org/dist/v${version}/${archive}`, 'node', staging => {
    execFileSync(path.join(staging, path.basename(target), 'bin/node'), ['--version']);
    renameSync(path.join(staging, path.basename(target)), target);
    execFileSync('ln', ['-sfn', path.basename(target), link]);
  });
}

const rustArch = arch === 'arm64' ? 'aarch64' : 'x86_64';
// Versions supporting both Intel and Apple Silicon Macs.
for (const tool of [
  { name: 'fd', repo: 'sharkdp/fd', tag: 'v10.3.0', dir: `fd-v10.3.0-${rustArch}-apple-darwin` },
  { name: 'rg', repo: 'BurntSushi/ripgrep', tag: '14.1.1', dir: `ripgrep-14.1.1-${rustArch}-apple-darwin` },
]) {
  const dest = path.join(link, 'bin', tool.name);
  if (existsSync(dest)) {
    execFileSync(dest, ['--version']);
    continue;
  }
  await installArchive(`https://github.com/${tool.repo}/releases/download/${tool.tag}/${tool.dir}.tar.gz`, tool.name, staging => {
    const src = path.join(staging, tool.dir, tool.name);
    execFileSync(src, ['--version']);
    copyFileSync(src, `${dest}.tmp`);
    chmodSync(`${dest}.tmp`, 0o755);
    renameSync(`${dest}.tmp`, dest);
  });
}
console.log(`[ensure-node] Node, fd and rg ready: ${path.join(link, 'bin')}`);
