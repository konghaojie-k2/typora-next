#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const TestRunner = require('../../shared/test-runner');

function loadUpdater(invoke) {
  const window = { __TAURI__: { core: { invoke, Channel: class {} } } };
  vm.runInNewContext(fs.readFileSync('dist/scripts/updater.js', 'utf8'), { window, console, DOMException });
  return window.Updater;
}

function fixture() {
  const calls = [];
  const downloads = [];
  let nextRid = 100;
  const updater = loadUpdater(async (command, args) => {
    calls.push({ command, args });
    if (command === 'get_proxy_config') return null;
    if (command === 'plugin:updater|check') return {
      rid: 42, version: '0.4.14', rawJson: { platforms: {
        'darwin-aarch64': { url: 'https://github.com/konghaojie-k2/typora-next/releases/download/nightly-20261111-abc1234/TyporaNext.app.tar.gz' }
      } }
    };
    if (command === 'create_update_download') return nextRid++;
    if (command === 'download_update') return new Promise((resolve, reject) => {
      downloads.push({ ...args, resolve, reject });
    });
    if (command === 'install_update' || command === 'plugin:resources|close') return;
    throw new Error('Unexpected command: ' + command);
  });
  return { updater, calls, downloads };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

TestRunner.test('更新内容链接指向下载包所属的发布版本（包含 nightly）', async () => {
  const { updater } = fixture();
  const update = await updater.check();
  assert.equal(update.releaseNotesUrl, 'https://github.com/konghaojie-k2/typora-next/releases/tag/nightly-20261111-abc1234');
});

TestRunner.test('缺少下载地址时更新内容链接使用版本号', async () => {
  const updater = loadUpdater(async command => command === 'plugin:updater|check'
    ? { rid: 42, version: '0.4.14' } : null);
  assert.equal((await updater.check()).releaseNotesUrl, 'https://github.com/konghaojie-k2/typora-next/releases/tag/v0.4.14');
});

TestRunner.test('取消会关闭原生下载资源，迟到的下载结果不能触发安装', async () => {
  const { updater, calls, downloads } = fixture();
  const update = await updater.check();
  const controller = new AbortController();
  const events = [];
  const promise = update.downloadAndInstall(event => events.push(event), { signal: controller.signal });
  await flush();
  controller.abort();
  await flush();
  assert(calls.some(call => call.command === 'plugin:resources|close' && call.args.rid === downloads[0].cancelRid));
  downloads[0].onEvent.onmessage({ event: 'Progress', data: { chunkLength: 10 } });
  downloads[0].resolve(200);
  await assert.rejects(promise, { name: 'AbortError' });
  assert.equal(events.length, 0);
  assert(!calls.some(call => call.command === 'install_update'));
  assert(calls.some(call => call.command === 'plugin:resources|close' && call.args.rid === 200));
});

TestRunner.test('已经取消的请求不会启动原生下载', async () => {
  const { updater, calls } = fixture();
  const update = await updater.check();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(update.downloadAndInstall(null, { signal: controller.signal }), { name: 'AbortError' });
  assert(!calls.some(call => call.command === 'download_update'));
});

TestRunner.test('下载完成并验证通过后才发出安装事件，安装后释放资源', async () => {
  const { updater, calls, downloads } = fixture();
  const update = await updater.check();
  const events = [];
  const promise = update.downloadAndInstall(event => events.push(event.event), { signal: new AbortController().signal });
  await flush();
  downloads[0].onEvent.onmessage({ event: 'Started', data: { contentLength: 10 } });
  downloads[0].onEvent.onmessage({ event: 'Progress', data: { chunkLength: 10 } });
  assert.deepEqual(events, ['Started', 'Progress']);
  downloads[0].resolve(200);
  await promise;
  assert.deepEqual(events, ['Started', 'Progress', 'Finished']);
  assert(calls.some(call => call.command === 'install_update' && call.args.bytesRid === 200));
  assert(calls.some(call => call.command === 'plugin:resources|close' && call.args.rid === 200));
});

TestRunner.test('失败后重试建立独立下载，原有 Update 资源可以继续使用', async () => {
  const { updater, calls, downloads } = fixture();
  const update = await updater.check();
  const first = update.downloadAndInstall(null, { signal: new AbortController().signal });
  await flush();
  downloads[0].reject(new Error('network unavailable'));
  await assert.rejects(first, /network unavailable/);
  const retry = update.downloadAndInstall(null, { signal: new AbortController().signal });
  await flush();
  assert.notEqual(downloads[0].cancelRid, downloads[1].cancelRid);
  downloads[1].resolve(201);
  await retry;
  assert.equal(calls.filter(call => call.command === 'install_update').length, 1);
});

TestRunner.run().then(({ failed }) => { if (failed) process.exitCode = 1; });
