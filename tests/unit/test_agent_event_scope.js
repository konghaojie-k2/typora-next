#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for agent-event project scoping
 *
 * Bug (2026-10-29 实爆): chapter_complete 事件没有项目身份，每个存活的
 * AgentEventBridge 都用自己 ui.projectPath 持久化——后台 A 课程生成完成时，
 * 前台 B 课程的 bridge 把 A 的文件名写进 B 的 project.json（头 2 章「被重置」）。
 *
 * Fix: AgentEventBridge.handleEvent 只处理 data.projectPath 与本 bridge
 * 项目一致的事件；无 projectPath 的旧事件兼容放行。
 */

const TestRunner = require('../shared/test-runner');
const { ChapterStatusManager, AgentEventBridge } =
  require('../../dist/scripts/learning/progress-tracker.js');

const assert = TestRunner.assert.bind(TestRunner);
const assertEquals = TestRunner.assertEquals.bind(TestRunner);
const test = TestRunner.test.bind(TestRunner);

const PROJECT_B = 'C:/proj-b';

function setup(chapter0Status) {
  const invokes = [];
  global.window.__TAURI__ = {
    core: {
      invoke: (cmd, args) => {
        invokes.push({ cmd, args });
        return Promise.resolve();
      }
    }
  };
  const manager = new ChapterStatusManager([{ title: 't0' }, { title: 't1' }]);
  if (chapter0Status) manager.chapters[0].status = chapter0Status;
  const ui = { projectPath: PROJECT_B, updateChapter() {}, render() {} };
  const bridge = new AgentEventBridge(manager, ui, null);
  return { manager, ui, bridge, invokes };
}

function persistCalls(invokes) {
  return invokes.filter(c => c.cmd === 'persist_chapter_file');
}

// ============================================
// Cross-project events are ignored
// ============================================

test('其他课程的 chapter_complete 不改本课程章节状态', () => {
  // 用 generating 章节：不过滤的话 chapter_complete 会合法转成 ready，
  // 断言才不是空转（completed → ready 本来就会被状态机拒掉）
  const { manager, bridge } = setup('generating');
  bridge.handleEvent({ type: 'chapter_complete', data: { index: 0, file: '00-a.md', projectPath: 'C:/proj-a' } });
  assertEquals(manager.chapters[0].status, 'generating', 'A 课程事件不得改写 B 课程章节状态');
});

test('其他课程的 chapter_complete 不触发本课程持久化', () => {
  const { bridge, invokes } = setup('generating');
  bridge.handleEvent({ type: 'chapter_complete', data: { index: 0, file: '00-a.md', projectPath: 'C:/proj-a' } });
  assertEquals(persistCalls(invokes).length, 0, 'A 课程事件不得写入 B 课程 project.json');
});

test('其他课程的 progress 事件被忽略', () => {
  const { manager, bridge } = setup(null);
  bridge.handleEvent({ type: 'progress', data: { current: 1, status: 'generating', projectPath: 'C:/proj-a' } });
  assertEquals(manager.chapters[0].status, 'not_generated', 'A 课程 progress 不得把 B 章节标成 generating');
});

// ============================================
// Own-project events pass through
// ============================================

test('本课程的 chapter_complete 正常更新状态并持久化', () => {
  const { manager, bridge, invokes } = setup('generating');
  bridge.handleEvent({ type: 'chapter_complete', data: { index: 0, file: '00-b.md', projectPath: PROJECT_B } });
  assertEquals(manager.chapters[0].status, 'ready');
  const calls = persistCalls(invokes);
  assertEquals(calls.length, 1, '本课程事件应触发一次 persist_chapter_file');
  assertEquals(calls[0].args.projectPath, PROJECT_B);
  assertEquals(calls[0].args.fileBasename, '00-b.md');
});

test('路径分隔符差异（\\ vs /）不影响归属判定', () => {
  const { manager, bridge } = setup('generating');
  bridge.handleEvent({ type: 'chapter_complete', data: { index: 0, file: '00-b.md', projectPath: 'C:\\proj-b' } });
  assertEquals(manager.chapters[0].status, 'ready', '同一项目的反斜杠路径应判定为本项目');
});

// ============================================
// Legacy events (no projectPath) stay compatible
// ============================================

test('不带 projectPath 的旧事件兼容放行', () => {
  const { manager, bridge } = setup('generating');
  bridge.handleEvent({ type: 'chapter_complete', data: { index: 0, file: '00-b.md' } });
  assertEquals(manager.chapters[0].status, 'ready');
});

test('data 缺失或不含 projectPath 的边界事件不抛异常', () => {
  const { bridge } = setup(null);
  bridge.handleEvent({ type: 'status', data: { message: 'x' } });
  bridge.handleEvent({ type: 'complete', data: {} });
  bridge.handleEvent(null);
  // 不抛异常即通过
});

// ============================================
// Run
// ============================================

if (require.main === module) {
  console.log('Running agent-event project scoping tests...\n');
  TestRunner.run();
}
