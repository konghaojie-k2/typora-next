/** Real check subprocesses with piped stdio, matching the Rust launcher. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import T from '../../shared/test-runner.js';

const execFileAsync = promisify(execFile);
const bridgePath = fileURLToPath(new URL('../../../agent-bridge.mjs', import.meta.url));

async function runCheck({ sdkFound = true, config = {}, timeoutMs = 5000 } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-check-')));
  try {
    const entry = path.join(dir, 'agent-bridge.mjs');
    fs.copyFileSync(bridgePath, entry);
    const sdkEntry = path.join(dir, 'sdk.mjs');
    if (sdkFound) fs.writeFileSync(sdkEntry, 'export {};\n');

    // beforeExit only fires when Node drains its event loop naturally. A
    // process.exit(0) regression fails this check even on non-Windows hosts.
    const marker = path.join(dir, 'natural-exit');
    const preload = path.join(dir, 'preload.mjs');
    fs.writeFileSync(preload, `
      import fs from 'node:fs';
      process.once('beforeExit', () => fs.writeFileSync(${JSON.stringify(marker)}, 'ok'));
    `);
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      '--no-warnings', '--import', pathToFileURL(preload).href,
      entry, 'check', JSON.stringify({ config, args: {} })
    ], {
      cwd: dir,
      env: {
        ...process.env,
        TYPORA_PI_SDK_ENTRY: sdkEntry,
        TYPORA_NEXT_LOG_DIR: dir,
        TYPORA_AGENT_PING_TIMEOUT_MS: String(timeoutMs)
      },
      timeout: 10000,
      windowsHide: true
    });
    const lines = stdout.trim().split(/\r?\n/);
    assert.equal(lines.length, 1, `expected one complete JSON result: ${stdout}`);
    assert.equal(fs.existsSync(marker), true, `bridge must exit naturally: ${stderr}`);
    return JSON.parse(lines[0]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function withProvider(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    await fn({
      ai_provider: 'openai',
      ai_base_url: `http://127.0.0.1:${server.address().port}`,
      api_key: 'test-key',
      model: 'test-model'
    });
  } finally {
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}

T.test('check: missing SDK returns unavailable and exits naturally', async () => {
  const result = await runCheck({ sdkFound: false });
  assert.equal(result.available, false);
  assert.match(result.error, /Pi SDK entry not found/);
  assert.equal(result.ping, null);
});

T.test('check: installed SDK without a key skips ping and exits naturally', async () => {
  assert.deepEqual(await runCheck(), { available: true, error: null, ping: null });
});

T.test('check: HTTP success returns complete JSON and exits naturally', async () => {
  await withProvider((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"choices":');
    setTimeout(() => res.end('[]}'), 30);
  }, async config => {
    const result = await runCheck({ config });
    assert.deepEqual(result, { available: true, error: null, ping: { ok: true } });
  });
});

T.test('check: authentication failure preserves installed SDK status', async () => {
  await withProvider((req, res) => {
    req.resume();
    res.writeHead(401);
    res.end('invalid api key');
  }, async config => {
    const result = await runCheck({ config });
    assert.equal(result.available, true);
    assert.equal(result.ping.ok, false);
    assert.equal(result.ping.code, 'AUTH_FAILED');
  });
});

T.test('check: stalled success body times out and exits naturally', async () => {
  await withProvider((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{');
  }, async config => {
    const result = await runCheck({ config, timeoutMs: 1000 });
    assert.equal(result.available, true);
    assert.equal(result.ping.ok, false);
    assert.equal(result.ping.code, 'NETWORK');
    assert.match(result.ping.message, /timeout/i);
  });
});

T.run().then(({ failed }) => { if (failed) process.exitCode = 1; });
