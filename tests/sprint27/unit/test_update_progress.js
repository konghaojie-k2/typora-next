#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for update-progress.js（Sprint 27）
 *
 * 更新下载进度的状态折叠契约：
 * - createDownloadState：初始 downloading 态
 * - applyDownloadEvent：Started 记总量 / Progress 累计并算百分比 / Finished 转安装中
 *   终态（installing/restart/failed）后迟到的 Progress 事件被忽略
 * - applySuccess → restart；applyFailure → failed + 错误
 * - statusText：各阶段文案；无总大小时降级为仅已下载 MB，不显示百分比
 */

const TestRunner = require('../../shared/test-runner');
const UpdateProgress = require('../../../dist/scripts/update-progress.js');

// ---------- createDownloadState ----------

TestRunner.test('初始状态为 downloading，计数清零', () => {
  const s = UpdateProgress.createDownloadState('0.4.3');
  TestRunner.assertEquals(s.phase, 'downloading');
  TestRunner.assertEquals(s.version, '0.4.3');
  TestRunner.assertEquals(s.downloadedBytes, 0);
  TestRunner.assertEquals(s.totalBytes, 0);
  TestRunner.assertEquals(s.percent, 0);
  TestRunner.assertEquals(s.error, '');
});

// ---------- applyDownloadEvent: Started ----------

TestRunner.test('Started 事件记录总大小', () => {
  let s = UpdateProgress.createDownloadState('0.4.3');
  s = UpdateProgress.applyDownloadEvent(s, { event: 'Started', data: { contentLength: 37748736 } });
  TestRunner.assertEquals(s.totalBytes, 37748736);
  TestRunner.assertEquals(s.phase, 'downloading');
});

TestRunner.test('Started 缺 contentLength 时总量为 0', () => {
  let s = UpdateProgress.createDownloadState('0.4.3');
  s = UpdateProgress.applyDownloadEvent(s, { event: 'Started', data: {} });
  TestRunner.assertEquals(s.totalBytes, 0);
});

// ---------- applyDownloadEvent: Progress ----------

TestRunner.test('Progress 事件累计已下载字节并计算百分比', () => {
  let s = UpdateProgress.createDownloadState('0.4.3');
  s = UpdateProgress.applyDownloadEvent(s, { event: 'Started', data: { contentLength: 200 } });
  s = UpdateProgress.applyDownloadEvent(s, { event: 'Progress', data: { chunkLength: 50 } });
  TestRunner.assertEquals(s.downloadedBytes, 50);
  TestRunner.assertEquals(s.percent, 25);
  s = UpdateProgress.applyDownloadEvent(s, { event: 'Progress', data: { chunkLength: 150 } });
  TestRunner.assertEquals(s.downloadedBytes, 200);
  TestRunner.assertEquals(s.percent, 100);
});

TestRunner.test('百分比四舍五入', () => {
  let s = UpdateProgress.createDownloadState('0.4.3');
  s = UpdateProgress.applyDownloadEvent(s, { event: 'Started', data: { contentLength: 3 } });
  s = UpdateProgress.applyDownloadEvent(s, { event: 'Progress', data: { chunkLength: 1 } });
  TestRunner.assertEquals(s.percent, 33);
});

TestRunner.test('百分比封顶 100（超出总量防御）', () => {
  let s = UpdateProgress.createDownloadState('0.4.3');
  s = UpdateProgress.applyDownloadEvent(s, { event: 'Started', data: { contentLength: 10 } });
  s = UpdateProgress.applyDownloadEvent(s, { event: 'Progress', data: { chunkLength: 20 } });
  TestRunner.assertEquals(s.percent, 100);
});

TestRunner.test('无总大小时 percent 恒为 0', () => {
  let s = UpdateProgress.createDownloadState('0.4.3');
  s = UpdateProgress.applyDownloadEvent(s, { event: 'Progress', data: { chunkLength: 5242880 } });
  TestRunner.assertEquals(s.downloadedBytes, 5242880);
  TestRunner.assertEquals(s.percent, 0);
});

// ---------- Finished / 终态 ----------

TestRunner.test('Finished 事件转入安装中', () => {
  let s = UpdateProgress.createDownloadState('0.4.3');
  s = UpdateProgress.applyDownloadEvent(s, { event: 'Started', data: { contentLength: 10 } });
  s = UpdateProgress.applyDownloadEvent(s, { event: 'Finished', data: {} });
  TestRunner.assertEquals(s.phase, 'installing');
});

TestRunner.test('安装中之后迟到的 Progress 被忽略', () => {
  let s = UpdateProgress.createDownloadState('0.4.3');
  s = UpdateProgress.applyDownloadEvent(s, { event: 'Started', data: { contentLength: 10 } });
  s = UpdateProgress.applyDownloadEvent(s, { event: 'Finished', data: {} });
  const late = UpdateProgress.applyDownloadEvent(s, { event: 'Progress', data: { chunkLength: 5 } });
  TestRunner.assertEquals(late.downloadedBytes, 0);
  TestRunner.assertEquals(late.phase, 'installing');
});

TestRunner.test('applySuccess 进入重启阶段', () => {
  let s = UpdateProgress.createDownloadState('0.4.3');
  s = UpdateProgress.applySuccess(s);
  TestRunner.assertEquals(s.phase, 'restart');
});

TestRunner.test('applyFailure 进入失败终态并记录错误', () => {
  let s = UpdateProgress.createDownloadState('0.4.3');
  s = UpdateProgress.applyFailure(s, new Error('network unreachable'));
  TestRunner.assertEquals(s.phase, 'failed');
  TestRunner.assert(s.error.includes('network unreachable'));
});

TestRunner.test('失败终态后迟到事件被忽略', () => {
  let s = UpdateProgress.createDownloadState('0.4.3');
  s = UpdateProgress.applyFailure(s, new Error('x'));
  const late = UpdateProgress.applyDownloadEvent(s, { event: 'Progress', data: { chunkLength: 5 } });
  TestRunner.assertEquals(late.phase, 'failed');
  TestRunner.assertEquals(late.downloadedBytes, 0);
});

TestRunner.test('空 state / 空事件不崩溃', () => {
  TestRunner.assertEquals(UpdateProgress.applyDownloadEvent(null, { event: 'Progress' }), null);
  const s = UpdateProgress.createDownloadState('0.4.3');
  TestRunner.assertEquals(UpdateProgress.applyDownloadEvent(s, null), s);
});

// ---------- statusText ----------

TestRunner.test('下载中文案含 GitHub 来源 + 已下载/总量/百分比', () => {
  let s = UpdateProgress.createDownloadState('0.4.3');
  s = UpdateProgress.applyDownloadEvent(s, { event: 'Started', data: { contentLength: 37748736 } });
  s = UpdateProgress.applyDownloadEvent(s, { event: 'Progress', data: { chunkLength: 18874368 } });
  const text = UpdateProgress.statusText(s);
  TestRunner.assert(text.includes('正在从 GitHub 下载更新'), text);
  TestRunner.assert(text.includes('18.0/36.0 MB'), text);
  TestRunner.assert(text.includes('50%'), text);
});

TestRunner.test('无总大小时文案只显示已下载量且无百分比', () => {
  let s = UpdateProgress.createDownloadState('0.4.3');
  s = UpdateProgress.applyDownloadEvent(s, { event: 'Progress', data: { chunkLength: 5242880 } });
  const text = UpdateProgress.statusText(s);
  TestRunner.assert(text.includes('正在从 GitHub 下载更新'), text);
  TestRunner.assert(text.includes('5.0 MB'), text);
  TestRunner.assert(!text.includes('%'), text);
});

TestRunner.test('安装中/重启/失败各阶段文案', () => {
  let s = UpdateProgress.createDownloadState('0.4.3');
  s = UpdateProgress.applyDownloadEvent(s, { event: 'Finished', data: {} });
  TestRunner.assert(UpdateProgress.statusText(s).includes('正在安装'));
  s = UpdateProgress.applySuccess(s);
  TestRunner.assert(UpdateProgress.statusText(s).includes('正在重启'));
  s = UpdateProgress.applyFailure(s, new Error('boom'));
  const failed = UpdateProgress.statusText(s);
  TestRunner.assert(failed.includes('更新失败'), failed);
  TestRunner.assert(failed.includes('boom'), failed);
});

// ---------- formatMB ----------

TestRunner.test('取消下载进入可重试的取消状态，并忽略迟到的成功与失败', () => {
  const s = UpdateProgress.applyCancellation(UpdateProgress.createDownloadState('0.4.14'));
  TestRunner.assertEquals(s.phase, 'cancelled');
  TestRunner.assertEquals(UpdateProgress.statusText(s), '更新已取消');
  TestRunner.assertEquals(UpdateProgress.applySuccess(s), s);
  TestRunner.assertEquals(UpdateProgress.applyFailure(s, new Error('late')), s);
  TestRunner.assertEquals(UpdateProgress.applyDownloadEvent(s, { event: 'Finished' }), s);
});

TestRunner.test('进入安装阶段后不能取消', () => {
  const s = UpdateProgress.applyDownloadEvent(UpdateProgress.createDownloadState('0.4.14'), { event: 'Finished' });
  TestRunner.assertEquals(UpdateProgress.applyCancellation(s), s);
});

TestRunner.test('formatMB 保留一位小数', () => {
  TestRunner.assertEquals(UpdateProgress.formatMB(0), '0.0');
  TestRunner.assertEquals(UpdateProgress.formatMB(5242880), '5.0');
  TestRunner.assertEquals(UpdateProgress.formatMB(37748736), '36.0');
});

TestRunner.run();
