/**
 * TDD Tests for SDK install progress state machine (sdk-install-progress.js)
 * pi SDK 自动安装进度可视化：事件 → UI 状态 的纯决策模块
 */

const TestRunner = require('../../shared/test-runner');
const SdkInstall = require('../../../dist/scripts/sdk-install-progress');

// ============================================
// createInstallState
// ============================================
TestRunner.test('createInstallState: 初始为 installing 阶段，无错误无输出行', () => {
  const s = SdkInstall.createInstallState();
  TestRunner.assertEquals(s.phase, 'installing');
  TestRunner.assertEquals(s.stage, '开始安装…');
  TestRunner.assertEquals(s.lastLine, '');
  TestRunner.assertEquals(s.error, '');
});

// ============================================
// applyProgress — 阶段文案
// ============================================
TestRunner.test('applyProgress: prepare → 准备安装目录…', () => {
  const s = SdkInstall.applyProgress(SdkInstall.createInstallState(), { stage: 'prepare' });
  TestRunner.assertEquals(s.stage, '准备安装目录…');
});

TestRunner.test('applyProgress: download 带输出行 → 阶段文案 + lastLine 更新', () => {
  const s = SdkInstall.applyProgress(SdkInstall.createInstallState(), {
    stage: 'download',
    message: 'npm http fetch GET 200'
  });
  TestRunner.assertEquals(s.stage, '下载依赖中…');
  TestRunner.assertEquals(s.lastLine, 'npm http fetch GET 200');
});

TestRunner.test('applyProgress: verify → 校验安装结果…', () => {
  const s = SdkInstall.applyProgress(SdkInstall.createInstallState(), { stage: 'verify' });
  TestRunner.assertEquals(s.stage, '校验安装结果…');
});

TestRunner.test('applyProgress: 未知 stage → 保留原文案', () => {
  const before = SdkInstall.createInstallState();
  const s = SdkInstall.applyProgress(before, { stage: 'bogus' });
  TestRunner.assertEquals(s.stage, before.stage);
});

TestRunner.test('applyProgress: download 无 message → lastLine 保留', () => {
  let s = SdkInstall.applyProgress(SdkInstall.createInstallState(), {
    stage: 'download',
    message: 'line one'
  });
  s = SdkInstall.applyProgress(s, { stage: 'download' });
  TestRunner.assertEquals(s.lastLine, 'line one');
});

TestRunner.test('applyProgress: 空事件 → 状态不变', () => {
  const before = SdkInstall.createInstallState();
  const s = SdkInstall.applyProgress(before, null);
  TestRunner.assertEquals(s.stage, before.stage);
});

TestRunner.test('applyProgress: 终态（failed）后事件被忽略', () => {
  let s = SdkInstall.applyResult(SdkInstall.createInstallState(), {
    status: 'failed',
    error: '网络错误'
  });
  s = SdkInstall.applyProgress(s, { stage: 'download', message: 'late line' });
  TestRunner.assertEquals(s.phase, 'failed');
  TestRunner.assertEquals(s.lastLine, '');
});

TestRunner.test('applyProgress: 终态（success）后事件被忽略', () => {
  let s = SdkInstall.applyResult(SdkInstall.createInstallState(), { status: 'installed' });
  s = SdkInstall.applyProgress(s, { stage: 'download', message: 'late line' });
  TestRunner.assertEquals(s.phase, 'success');
  TestRunner.assertEquals(s.lastLine, '');
});

// ============================================
// applyResult — 终态
// ============================================
TestRunner.test('applyResult: installed → success', () => {
  const s = SdkInstall.applyResult(SdkInstall.createInstallState(), { status: 'installed' });
  TestRunner.assertEquals(s.phase, 'success');
});

TestRunner.test('applyResult: failed 带原因 → failed + 保留可读原因', () => {
  const s = SdkInstall.applyResult(SdkInstall.createInstallState(), {
    status: 'failed',
    error: '网络连接失败，无法访问 npm 仓库'
  });
  TestRunner.assertEquals(s.phase, 'failed');
  TestRunner.assertEquals(s.error, '网络连接失败，无法访问 npm 仓库');
});

TestRunner.test('applyResult: failed 无原因 → 兜底文案', () => {
  const s = SdkInstall.applyResult(SdkInstall.createInstallState(), { status: 'failed' });
  TestRunner.assertEquals(s.phase, 'failed');
  TestRunner.assertEquals(s.error.length > 0, true);
});

TestRunner.test('applyResult: null 结果 → 兜底失败', () => {
  const s = SdkInstall.applyResult(SdkInstall.createInstallState(), null);
  TestRunner.assertEquals(s.phase, 'failed');
  TestRunner.assertEquals(s.error.length > 0, true);
});

TestRunner.run();
