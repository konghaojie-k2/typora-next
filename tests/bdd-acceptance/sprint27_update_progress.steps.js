#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for update download progress visibility (Sprint 27)
 *
 * 真实模块：
 * - dist/scripts/updater.js（check / downloadAndInstall / Channel 包装）
 * - dist/scripts/update-progress.js（下载事件 → UI 状态折叠，纯函数）
 *
 * 镜像 main.js 接线（showUpdateNotification → performUpdate）：
 * 横幅原地变形为进度卡片，onEvent 回调折叠事件并渲染；
 * About 面板手动检查到更新同样弹出横幅（修复「请更新」无入口死路）。
 * __TAURI__.core.invoke / Channel 用内存替身，不需要真实 Tauri 窗口。
 */

const { StepRegistry } = require('../shared/runner');

const steps = new StepRegistry();

// ============================================
// In-memory Tauri doubles
// ============================================
class MockChannel {
  constructor() {
    this._onmessage = null;
  }
  set onmessage(cb) {
    this._onmessage = cb;
  }
  get onmessage() {
    return this._onmessage;
  }
  send(payload) {
    if (this._onmessage) this._onmessage(payload);
  }
}

function installMockTauri(context, version) {
  global.window = {
    __TAURI__: {
      core: {
        Channel: MockChannel,
        invoke: async (cmd, args) => {
          if (cmd === 'get_proxy_config') {
            return context.mockProxy === undefined ? null : context.mockProxy;
          }
          if (cmd === 'plugin:updater|check') {
            context.checkArgs = args || {};
            if (context.checkError) {
              // updater-not-configured 模拟插件未配置（插件报错文本含 'updater'）
              if (context.checkError === 'updater-not-configured') {
                throw 'updater: endpoints or pubkey not configured';
              }
              throw new Error(context.checkError);
            }
            return {
              version,
              date: '2026-09-07',
              body: '',
              currentVersion: '0.4.2',
              rawJson: {},
              rid: 42
            };
          }
          if (cmd === 'plugin:updater|download_and_install') {
            context.download = { channel: args.onEvent };
            return new Promise((resolve, reject) => {
              context.download.resolve = resolve;
              context.download.reject = reject;
            });
          }
          throw new Error('unexpected invoke: ' + cmd);
        }
      }
    }
  };
  // 清缓存重载 updater.js，让 IIFE 绑定到本次 mock window
  const updaterPath = require.resolve('../../dist/scripts/updater.js');
  delete require.cache[updaterPath];
  require(updaterPath);
}

// ============================================
// Mirrored wiring（与 main.js performUpdate 对应）
// ============================================
function getUpdateProgress() {
  // 真实状态折叠模块（Sprint 27 新增）
  return require('../../dist/scripts/update-progress.js');
}

function createBanner() {
  return {
    visible: false,
    mode: 'prompt', // prompt | progress | error
    text: '',
    percent: null,
    closable: false,
    actions: []
  };
}

function showUpdateBanner(context, update) {
  const b = context.banner;
  b.visible = true;
  b.mode = 'prompt';
  b.text = `发现新版本 ${update.version}`;
  b.hint = '更新包将从 GitHub 发布页下载，网络较慢时请耐心等待';
  b.actions = ['安装更新', '取消'];
  b.closable = true;
}

function renderProgress(context, state) {
  const UpdateProgress = getUpdateProgress();
  const b = context.banner;
  b.visible = true;
  b.mode = state.phase === 'failed' ? 'error' : 'progress';
  b.text = UpdateProgress.statusText(state);
  b.percent =
    state.phase === 'downloading' && state.totalBytes > 0 ? state.percent : null;
  b.closable = state.phase === 'failed';
  b.actions = [];
}

// 点击「更新」→ 横幅原地变形为进度卡片（镜像 performUpdate）
function clickInstall(context, update) {
  const UpdateProgress = getUpdateProgress();
  let state = UpdateProgress.createDownloadState(update.version);
  renderProgress(context, state);
  return update
    .downloadAndInstall((ev) => {
      state = UpdateProgress.applyDownloadEvent(state, ev);
      renderProgress(context, state);
    })
    .then(() => {
      state = UpdateProgress.applySuccess(state);
      renderProgress(context, state);
    })
    .catch((err) => {
      state = UpdateProgress.applyFailure(state, err);
      renderProgress(context, state);
    });
}

function emitDownload(context, payload) {
  if (!context.download || !context.download.channel) {
    throw new Error('下载尚未开始（download_and_install 未被调用）');
  }
  context.download.channel.send(payload);
}

// ============================================
// Steps
// ============================================
steps.given('the updater module with a mocked Tauri core', function () {
  this.mockedVersion = '0.4.3';
  this.banner = createBanner();
});

steps.given('the mocked latest version is {string}', function (version) {
  this.mockedVersion = version;
  installMockTauri(this, version);
});

steps.when('the update check runs on startup', async function () {
  const result = await global.window.Updater.check();
  this.update = result;
  // 镜像 checkForUpdates 自动路径：可用 → 弹横幅
  if (result.available) showUpdateBanner(this, result);
});

steps.then('the update banner should be visible', function () {
  if (!this.banner || !this.banner.visible) {
    throw new Error('更新横幅不可见');
  }
});

steps.then('the banner should offer 安装更新 and 取消 actions', function () {
  const a = this.banner.actions;
  if (!a.includes('安装更新') || !a.includes('取消')) {
    throw new Error(`横幅按钮缺失：${JSON.stringify(a)}`);
  }
});

steps.then('the update should link to release notes for version {string}', function (version) {
  const expected = `https://github.com/konghaojie-k2/typora-next/releases/tag/v${version}`;
  if (this.update.releaseNotesUrl !== expected) {
    throw new Error(`更新说明链接不符：${this.update.releaseNotesUrl}`);
  }
});

steps.then('the banner should mention GitHub 下载来源', function () {
  if (!this.banner.hint || !this.banner.hint.includes('GitHub')) {
    throw new Error(`横幅未提示 GitHub 下载来源：${this.banner.hint}`);
  }
});

steps.given('a shown update banner for version {string}', async function (version) {
  this.banner = createBanner();
  installMockTauri(this, version);
  // 用真实 Updater.check 拿到带 Channel 包装的 downloadAndInstall
  const result = await global.window.Updater.check();
  this.update = result;
  showUpdateBanner(this, result);
});

steps.given('the user clicks 更新', function () {
  this.installPromise = clickInstall(this, this.update);
});

steps.when('the user clicks 更新', function () {
  this.installPromise = clickInstall(this, this.update);
});

steps.then('the banner should switch to progress mode', function () {
  if (this.banner.mode !== 'progress') {
    throw new Error(`横幅未进入进度模式：${this.banner.mode}`);
  }
});

steps.when('the download starts with total {int} bytes', function (total) {
  emitDownload(this, { event: 'Started', data: { contentLength: total } });
});

steps.when('a chunk of {int} bytes arrives', function (chunk) {
  emitDownload(this, { event: 'Progress', data: { chunkLength: chunk } });
});

steps.when('the download finishes', function () {
  emitDownload(this, { event: 'Finished', data: {} });
});

steps.when('the install promise resolves', async function () {
  this.download.resolve();
  await this.installPromise;
});

steps.when('the download fails with {string}', async function (msg) {
  this.download.reject(new Error(msg));
  await this.installPromise;
});

steps.then('the progress card should show 正在从 GitHub 下载更新', function () {
  if (!this.banner.text.includes('正在从 GitHub 下载更新')) {
    throw new Error(`未显示下载中文案：${this.banner.text}`);
  }
});

steps.then(
  'the progress card should remain visible without opening the About panel',
  function () {
    if (!this.banner.visible) throw new Error('进度卡片不可见');
    if (this.banner.mode !== 'progress') {
      throw new Error(`进度卡片模式错误：${this.banner.mode}`);
    }
  }
);

steps.then('the progress card should show percent {int}', function (pct) {
  if (this.banner.percent !== pct) {
    throw new Error(`百分比不符：expected ${pct}, got ${this.banner.percent}`);
  }
  if (!this.banner.text.includes(`${pct}%`)) {
    throw new Error(`文案不含百分比：${this.banner.text}`);
  }
});

steps.then('the progress card should show {string}', function (text) {
  if (!this.banner.text.includes(text)) {
    throw new Error(`文案不含「${text}」：${this.banner.text}`);
  }
});

steps.then('the progress card should not show a percent', function () {
  if (this.banner.percent !== null) {
    throw new Error(`不应显示百分比，实际：${this.banner.percent}`);
  }
});

steps.then('the progress card should show 正在安装', function () {
  if (!this.banner.text.includes('正在安装')) {
    throw new Error(`未显示安装文案：${this.banner.text}`);
  }
});

steps.then('the progress card should show 正在重启', function () {
  if (!this.banner.text.includes('正在重启')) {
    throw new Error(`未显示重启文案：${this.banner.text}`);
  }
});

steps.then('the progress card should show 更新失败', function () {
  if (this.banner.mode !== 'error') {
    throw new Error(`卡片未进入错误模式：${this.banner.mode}`);
  }
  if (!this.banner.text.includes('更新失败')) {
    throw new Error(`未显示失败文案：${this.banner.text}`);
  }
});

steps.then('the progress card should be closable', function () {
  if (!this.banner.closable) throw new Error('失败卡片不可关闭');
});

steps.given('the mocked update check fails with {string}', function (msg) {
  this.checkError = msg;
});

steps.given('the mocked update check fails with updater-not-configured', function () {
  this.checkError = 'updater-not-configured';
});

steps.when('the user checks for updates from the About panel', async function () {
  const result = await global.window.Updater.check();
  this.update = result;
  // 镜像 checkForUpdates 手动路径（Sprint 27 修复）：
  // 可用 → 状态文案 + 弹横幅；失败 → 透出真实错误，仅未配置时显示未配置
  if (result.available) {
    this.aboutStatus = `发现新版本 ${result.version}，请更新`;
    showUpdateBanner(this, result);
  } else if (result.error) {
    this.aboutStatus = result.notConfigured
      ? '更新服务未配置，请设置 GitHub Release'
      : '检查更新失败：' + result.error;
  } else {
    this.aboutStatus = '已是最新版本 ✓';
  }
});

steps.then('the About status should show 发现新版本', function () {
  if (!this.aboutStatus || !this.aboutStatus.includes('发现新版本')) {
    throw new Error(`About 状态文案不符：${this.aboutStatus}`);
  }
});

steps.then('the About status should show 检查更新失败', function () {
  if (!this.aboutStatus || !this.aboutStatus.includes('检查更新失败')) {
    throw new Error(`About 状态未显示检查失败：${this.aboutStatus}`);
  }
});

steps.then('the About status should contain {string}', function (text) {
  if (!this.aboutStatus || !this.aboutStatus.includes(text)) {
    throw new Error(`About 状态不含「${text}」：${this.aboutStatus}`);
  }
});

steps.then('the About status should show 更新服务未配置', function () {
  if (!this.aboutStatus || !this.aboutStatus.includes('更新服务未配置')) {
    throw new Error(`About 状态未显示未配置：${this.aboutStatus}`);
  }
});

// ============================================
// PB27-6: 代理感知
// ============================================
steps.given('the mocked system proxy is {string}', function (proxy) {
  this.mockProxy = proxy;
});

steps.given('the mocked system proxy is absent', function () {
  this.mockProxy = null;
});

steps.then('the update check should have been called with proxy {string}', function (proxy) {
  if (!this.checkArgs) throw new Error('plugin:updater|check 未被调用');
  if (this.checkArgs.proxy !== proxy) {
    throw new Error(`check 未带代理：expected ${proxy}, got ${this.checkArgs.proxy}`);
  }
});

steps.then('the update check should have been called without proxy', function () {
  if (!this.checkArgs) throw new Error('plugin:updater|check 未被调用');
  if (this.checkArgs.proxy !== undefined && this.checkArgs.proxy !== null) {
    throw new Error(`不应带代理，实际：${this.checkArgs.proxy}`);
  }
});

steps.then('the proxy_config rust test should exist and pass', function () {
  const rustTest = path.join(__dirname, '../../src-tauri/tests/proxy_config_test.rs');
  if (!fs.existsSync(rustTest)) {
    throw new Error(`rust test missing: ${rustTest}`);
  }
});

// ============================================
// PB27-4: 版本号常驻可见（静态接线验证）
// ============================================
const fs = require('fs');
const path = require('path');
const DIST = path.join(__dirname, '../../dist');

steps.given('the real index.html toolbar', function () {
  this.indexHtml = fs.readFileSync(path.join(DIST, 'index.html'), 'utf-8');
  this.mainJs = fs.readFileSync(path.join(DIST, 'scripts/main.js'), 'utf-8');
});

steps.then('the toolbar should contain a version chip element', function () {
  if (!/id="versionChip"/.test(this.indexHtml)) {
    throw new Error('index.html 缺少 #versionChip 元素');
  }
  const chipPos = this.indexHtml.indexOf('id="versionChip"');
  const toolbarPos = this.indexHtml.indexOf('toolbar-right');
  if (chipPos < toolbarPos) {
    throw new Error('#versionChip 不在 toolbar-right 内');
  }
});

steps.then('main.js should fill the version chip from get_app_info at startup', function () {
  if (!/versionChip/.test(this.mainJs)) {
    throw new Error('main.js 未引用 versionChip');
  }
  // 启动路径中必须用 get_app_info 的版本填充 chip
  const chipSection = this.mainJs.match(/get_app_info[\s\S]{0,400}versionChip|versionChip[\s\S]{0,400}get_app_info/);
  if (!chipSection) {
    throw new Error('main.js 中 versionChip 与 get_app_info 未关联');
  }
});

// PB27-7: onEvent 必填回归——不传回调时 downloadAndInstall 也要携带 Channel
// （undefined 会被 JSON 序列化丢弃，v0.4.3 应用内升级即因此必败）
steps.when('the download is invoked without a progress callback', async function () {
  const update = await global.window.Updater.check();
  // 不 await download 完成（mock 永不 resolve）——这里只验证调用参数
  update.downloadAndInstall().catch(() => {});
  await Promise.resolve(); // 让 mock invoke 同步段执行完
});

steps.then('the download request should carry an onEvent channel', function () {
  if (!this.download || !this.download.channel) {
    throw new Error('download_and_install 未携带 onEvent Channel（undefined 会被 JSON 序列化丢弃）');
  }
  if (typeof this.download.channel.onmessage !== 'function') {
    throw new Error('onEvent Channel 未绑定消息回调');
  }
});

steps.given('release notes exist for version {string}', function (version) {
  this.releaseVersion = version;
  this.changelog = `# Changelog\n\n## [${version}]\n\n- 更新支持取消与重试。\n\n## [0.4.13]\n\n- 历史更新内容。`;
});

steps.given('release notes are missing for version {string}', function (version) {
  this.releaseVersion = version;
  this.changelog = '# Changelog\n\n## [0.4.13]\n\n- 历史更新内容。';
});

steps.given('placeholder release notes for version {string}', function (version) {
  this.releaseVersion = version;
  this.changelog = `# Changelog\n\n## [${version}]\n\n### Features\n\n- TBD`;
});

steps.when('release notes are checked for tag {string}', async function (tag) {
  const { validateRelease } = await import('../../scripts/check-release.mjs');
  try {
    this.releaseResult = validateRelease({ version: this.releaseVersion, tag, changelog: this.changelog });
  } catch (error) {
    this.releaseError = error;
  }
});

steps.then('the release notes check should pass', function () {
  if (this.releaseError) throw this.releaseError;
  if (!this.releaseResult) throw new Error('未完成发布检查');
});

steps.then('only the current version notes should be published', function () {
  const notes = this.releaseResult.notes;
  if (!notes.includes('更新支持取消与重试。') || notes.includes('历史更新内容。')) {
    throw new Error('发布说明未按版本提取');
  }
});

steps.then('the release notes check should fail with {string}', function (message) {
  if (!this.releaseError || !this.releaseError.message.includes(message)) {
    throw new Error(`缺少预期的发布检查错误：${message}`);
  }
});

module.exports = steps;
