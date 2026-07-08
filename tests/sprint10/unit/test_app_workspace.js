#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for AppWorkspace state machine (Phase 1)
 *
 * This file verifies the contract and behavior of the unified workspace
 * state machine. The implementation below mirrors the algorithm in
 * dist/scripts/main.js so that logic changes can be validated in Node.
 */

const TestRunner = require('../../shared/test-runner');

// ============================================
// Minimal mirrored implementation
// ============================================
function createAppWorkspace() {
  const state = {
    current: 'normal',
    context: {
      projectPath: null,
      activePaperPath: null,
      paperProjectPath: null
    }
  };

  const registry = new Map();
  let switching = false;

  const transitionRules = [
    { from: 'normal', to: 'course', confirm: 'enter course' },
    { from: 'course', to: 'normal', confirm: 'exit course' },
    { from: 'normal', to: 'paper', confirm: 'enter paper' },
    { from: 'paper', to: 'normal', confirm: 'exit paper' },
    { from: 'course', to: 'paper', confirm: 'course->paper' },
    { from: 'paper', to: 'course', confirm: 'paper->course' }
  ];

  function getRule(from, to) {
    return transitionRules.find(r => r.from === from && r.to === to) || null;
  }

  let lastConfirmResult = true;
  let lastConfirmMessage = null;
  const logs = [];

  const AppWorkspace = {
    register(spec) {
      if (!spec || !spec.id) throw new Error('Workspace spec must have an id');
      registry.set(spec.id, spec);
    },

    getCurrent() { return state.current; },
    isIn(id) { return state.current === id; },
    getContext() { return state.context; },
    setContext(patch) { Object.assign(state.context, patch); },

    _setConfirmResult(value) { lastConfirmResult = value; },
    _getLastConfirmMessage() { return lastConfirmMessage; },
    _getLogs() { return logs; },

    async switchTo(targetId, options = {}) {
      if (switching) return false;
      const fromId = state.current;
      if (fromId === targetId) return true;

      const spec = registry.get(targetId);
      if (!spec) throw new Error('Unknown workspace: ' + targetId);

      const context = options.context || {};
      if (spec.canEnter && !spec.canEnter(context)) {
        return false;
      }

      const rule = getRule(fromId, targetId);
      if (rule && rule.confirm && !options.skipConfirm) {
        lastConfirmMessage = rule.confirm;
        if (!lastConfirmResult) return false;
      }

      switching = true;
      try {
        const fromSpec = registry.get(fromId);
        if (fromSpec && fromSpec.onExit) {
          await fromSpec.onExit(targetId);
        }

        logs.push(`close-tabs:${fromId}->${targetId}`);
        state.current = targetId;
        state.context = { ...context };

        if (spec.onEnter) {
          await spec.onEnter(fromId, options);
        }
        return true;
      } finally {
        switching = false;
      }
    }
  };

  return { AppWorkspace, state };
}

// ============================================
// Tests
// ============================================
TestRunner.test('registers three workspaces', () => {
  const { AppWorkspace } = createAppWorkspace();
  AppWorkspace.register({ id: 'normal', displayName: '常规模式' });
  AppWorkspace.register({ id: 'course', displayName: '课程模式' });
  AppWorkspace.register({ id: 'paper', displayName: '论文导读' });
  TestRunner.assert(AppWorkspace.isIn('normal'), 'should start in normal');
});

TestRunner.test('switchTo changes workspace and runs lifecycle hooks', async () => {
  const { AppWorkspace, state } = createAppWorkspace();
  const events = [];

  AppWorkspace.register({
    id: 'normal',
    onExit(to) { events.push(`normal-exit-${to}`); }
  });
  AppWorkspace.register({
    id: 'course',
    canEnter(ctx) { return !!ctx.projectPath; },
    onEnter(from, options) {
      events.push(`course-enter-${from}-${options.context.projectPath}`);
    }
  });

  const ok = await AppWorkspace.switchTo('course', { context: { projectPath: '/course/proj' } });
  TestRunner.assert(ok, 'switch should succeed');
  TestRunner.assert(AppWorkspace.isIn('course'), 'should be in course');
  TestRunner.assertEquals(state.context.projectPath, '/course/proj', 'context should be set');
  TestRunner.assertEquals(events[0], 'normal-exit-course', 'normal onExit should fire');
  TestRunner.assertEquals(events[1], 'course-enter-normal-/course/proj', 'course onEnter should fire');
});

TestRunner.test('switchTo rejects when canEnter returns false', async () => {
  const { AppWorkspace } = createAppWorkspace();
  AppWorkspace.register({ id: 'course', canEnter: () => false });
  const ok = await AppWorkspace.switchTo('course', { context: {} });
  TestRunner.assert(!ok, 'switch should fail');
  TestRunner.assert(AppWorkspace.isIn('normal'), 'should remain in normal');
});

TestRunner.test('switchTo shows confirmation and can be cancelled', async () => {
  const { AppWorkspace } = createAppWorkspace();
  AppWorkspace.register({ id: 'course' });
  AppWorkspace._setConfirmResult(false);

  const ok = await AppWorkspace.switchTo('course');
  TestRunner.assert(!ok, 'switch should be cancelled');
  TestRunner.assertEquals(AppWorkspace._getLastConfirmMessage(), 'enter course', 'confirm message should match');
  TestRunner.assert(AppWorkspace.isIn('normal'), 'should stay in normal after cancel');
});

TestRunner.test('switchTo to same workspace is no-op', async () => {
  const { AppWorkspace } = createAppWorkspace();
  const events = [];
  AppWorkspace.register({ id: 'normal', onExit: () => events.push('exit') });
  const ok = await AppWorkspace.switchTo('normal');
  TestRunner.assert(ok, 'same-workspace switch should return true');
  TestRunner.assertEquals(events.length, 0, 'no exit should fire');
});

TestRunner.test('switchTo is reentrant-safe', async () => {
  const { AppWorkspace } = createAppWorkspace();
  AppWorkspace.register({ id: 'course', onEnter: async () => { await new Promise(r => setTimeout(r, 10)); } });

  const p1 = AppWorkspace.switchTo('course');
  const p2 = AppWorkspace.switchTo('course');
  const [r1, r2] = await Promise.all([p1, p2]);
  TestRunner.assert(r1, 'first switch should succeed');
  TestRunner.assert(!r2, 'second concurrent switch should be rejected');
});

TestRunner.test('context can be updated after switch', () => {
  const { AppWorkspace, state } = createAppWorkspace();
  AppWorkspace.register({ id: 'course' });
  AppWorkspace.setContext({ projectPath: '/p' });
  TestRunner.assertEquals(state.context.projectPath, '/p', 'context should be patched');
});

TestRunner.test('switchTo skips confirmation when skipConfirm is true', async () => {
  const { AppWorkspace } = createAppWorkspace();
  AppWorkspace.register({ id: 'paper' });
  AppWorkspace._setConfirmResult(false);

  const ok = await AppWorkspace.switchTo('paper', { skipConfirm: true });
  TestRunner.assert(ok, 'switch should succeed with skipConfirm');
  TestRunner.assert(AppWorkspace.isIn('paper'), 'should be in paper workspace');
  TestRunner.assertEquals(
    AppWorkspace._getLastConfirmMessage(),
    null,
    'confirm message should not be recorded when skipped'
  );
});

TestRunner.test('switchTo still confirms when skipConfirm is false', async () => {
  const { AppWorkspace } = createAppWorkspace();
  AppWorkspace.register({ id: 'paper' });
  AppWorkspace._setConfirmResult(false);

  const ok = await AppWorkspace.switchTo('paper', { skipConfirm: false });
  TestRunner.assert(!ok, 'switch should be cancelled');
  TestRunner.assert(AppWorkspace.isIn('normal'), 'should stay in normal');
});

TestRunner.test('closing last specialized tab exits workspace without confirmation', async () => {
  const { AppWorkspace, state } = createAppWorkspace();
  const events = [];

  AppWorkspace.register({
    id: 'paper',
    async onExit(to) { events.push(`paper-exit-${to}`); }
  });
  AppWorkspace.register({
    id: 'normal',
    async onEnter(from) { events.push(`normal-enter-${from}`); }
  });

  // Simulate entering paper workspace and opening one tab.
  await AppWorkspace.switchTo('paper');
  const tabs = [{ path: '/paper.md', mode: 'paper' }];

  // Simulate closeTab: last tab removed, then silent switch to normal.
  tabs.splice(0, 1);
  const ok = await AppWorkspace.switchTo('normal', { skipConfirm: true });

  TestRunner.assert(ok, 'silent exit should succeed');
  TestRunner.assert(AppWorkspace.isIn('normal'), 'should return to normal workspace');
  TestRunner.assertEquals(events[0], 'paper-exit-normal', 'paper onExit should fire');
  TestRunner.assertEquals(events[1], 'normal-enter-paper', 'normal onEnter should fire');
  TestRunner.assert(
    state.context.activePaperPath === undefined || state.context.activePaperPath === null,
    'paper context should be cleared'
  );
});

TestRunner.test('all six transition rules trigger confirmation', async () => {
  const { AppWorkspace } = createAppWorkspace();
  AppWorkspace.register({ id: 'normal' });
  AppWorkspace.register({ id: 'course' });
  AppWorkspace.register({ id: 'paper' });

  const transitions = [
    ['normal', 'course', 'enter course'],
    ['course', 'normal', 'exit course'],
    ['normal', 'paper', 'enter paper'],
    ['paper', 'normal', 'exit paper'],
    ['course', 'paper', 'course->paper'],
    ['paper', 'course', 'paper->course']
  ];

  for (const [from, to, expectedMsg] of transitions) {
    // Drive the state machine to the source workspace.
    if (from !== AppWorkspace.getCurrent()) {
      await AppWorkspace.switchTo(from);
    }
    await AppWorkspace.switchTo(to);
    TestRunner.assert(
      AppWorkspace.isIn(to),
      `should end in ${to} after ${from}->${to}`
    );
    TestRunner.assertEquals(
      AppWorkspace._getLastConfirmMessage(),
      expectedMsg,
      `confirm message for ${from}->${to}`
    );
  }
});

// ============================================
// Run
// ============================================
(async () => {
  const result = await TestRunner.run();
  process.exit(result.failed > 0 ? 1 : 0);
})();
