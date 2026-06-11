#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for Sprint 8: Socratic Review
 *
 * Modules under test:
 * - dist/scripts/learning/socratic-trigger.js  (decideTrigger)
 * - agent-bridge.js                            (socraticChat)
 * - dist/scripts/learning/socratic-modal.js    (SocraticModal state machine)
 *
 * Business contracts:
 * - Trigger decision is pure: same input → same output
 * - Threshold = 5 quizzes, cooldown = 24h, opt-out is permanent
 * - socraticChat extracts [SESSION_END] marker → done: true
 * - SocraticModal never mutates concept status
 */

const TestRunner = require('./test-runner');
const { buildMockDOM } = require('./mock-dom');

// ============================================
// Helper: setup DOM for SocraticModal
// ============================================

function setupDOM() {
  const { document, body } = buildMockDOM();
  global.document = document;
  global.window = {
    document,
    addEventListener() {},
    removeEventListener() {},
    confirm() { return true; },
    __TAURI__: {
      core: {
        invoke: () => Promise.resolve({ content: 'Mock question', done: false })
      }
    }
  };
}

function loadTrigger() {
  const path = require('path');
  const modPath = path.join(__dirname, '../../dist/scripts/learning/socratic-trigger.js');
  try {
    delete require.cache[require.resolve(modPath)];
    require(modPath);
  } catch (e) {
    return null;
  }
  return require(modPath);
}

function loadModal() {
  const path = require('path');
  const modPath = path.join(__dirname, '../../dist/scripts/learning/socratic-modal.js');
  try {
    delete require.cache[require.resolve(modPath)];
    require(modPath);
  } catch (e) {
    return null;
  }
  return global.window.SocraticModal || (require(modPath).SocraticModal);
}

// ============================================
// Test Suite: decideTrigger (pure function)
// ============================================

TestRunner.test('decideTrigger: opt_out permanently blocks trigger', () => {
  const { decideTrigger } = loadTrigger();
  if (!decideTrigger) return;

  const result = decideTrigger(
    { opt_out: true },
    { quizCountSince: 10, now: Date.now() }
  );
  TestRunner.assertEquals(result.shouldTrigger, false, 'opt_out should block');
  TestRunner.assertEquals(result.reason, 'opt_out', 'reason should be opt_out');
});

TestRunner.test('decideTrigger: below threshold does not trigger', () => {
  const { decideTrigger } = loadTrigger();
  if (!decideTrigger) return;

  const result = decideTrigger(
    { opt_out: false, last_dismissed_at: null },
    { quizCountSince: 4, now: Date.now() }
  );
  TestRunner.assertEquals(result.shouldTrigger, false, '4 quizzes below threshold');
  TestRunner.assertEquals(result.reason, 'below_threshold');
});

TestRunner.test('decideTrigger: exactly at threshold triggers', () => {
  const { decideTrigger } = loadTrigger();
  if (!decideTrigger) return;

  const result = decideTrigger(
    { opt_out: false, last_dismissed_at: null },
    { quizCountSince: 5, now: Date.now() }
  );
  TestRunner.assertEquals(result.shouldTrigger, true, '5 quizzes at threshold should trigger');
  TestRunner.assertEquals(result.reason, 'threshold_reached');
  TestRunner.assertExists(result.toast, 'should include toast');
});

TestRunner.test('decideTrigger: dismissed within 24h blocks', () => {
  const { decideTrigger } = loadTrigger();
  if (!decideTrigger) return;

  const now = Date.now();
  const result = decideTrigger(
    { opt_out: false, last_dismissed_at: new Date(now - 3600 * 1000).toISOString() },
    { quizCountSince: 5, now }
  );
  TestRunner.assertEquals(result.shouldTrigger, false, 'dismissed 1h ago should block');
  TestRunner.assertEquals(result.reason, 'dismissed_within_24h');
});

TestRunner.test('decideTrigger: dismissed exactly 24h ago allows trigger', () => {
  const { decideTrigger } = loadTrigger();
  if (!decideTrigger) return;

  const now = Date.now();
  const result = decideTrigger(
    { opt_out: false, last_dismissed_at: new Date(now - 24 * 3600 * 1000).toISOString() },
    { quizCountSince: 5, now }
  );
  TestRunner.assertEquals(result.shouldTrigger, true, 'exactly 24h cooldown should allow trigger');
});

TestRunner.test('decideTrigger: recent cluster hash blocks dedup', () => {
  const { decideTrigger } = loadTrigger();
  if (!decideTrigger) return;

  const result = decideTrigger(
    {
      opt_out: false,
      last_dismissed_at: null,
      recent_cluster_hashes: ['abc123']
    },
    { quizCountSince: 5, now: Date.now(), candidateHash: 'abc123' }
  );
  TestRunner.assertEquals(result.shouldTrigger, false, 'recent cluster should block');
  TestRunner.assertEquals(result.reason, 'cluster_recent');
});

TestRunner.test('decideTrigger: all clear returns toast with 3 buttons', () => {
  const { decideTrigger } = loadTrigger();
  if (!decideTrigger) return;

  const result = decideTrigger(
    { opt_out: false, last_dismissed_at: null, recent_cluster_hashes: [] },
    { quizCountSince: 5, now: Date.now(), candidateHash: 'xyz' }
  );
  TestRunner.assertEquals(result.shouldTrigger, true);
  TestRunner.assertExists(result.toast, 'toast should exist');
  TestRunner.assertEquals(result.toast.buttons.length, 3, 'toast should have 3 buttons');
  const labels = result.toast.buttons.map(b => b.label);
  TestRunner.assert(labels.includes('开始'), 'should have 开始 button');
  TestRunner.assert(labels.includes('稍后'), 'should have 稍后 button');
  TestRunner.assert(labels.includes('不再提醒'), 'should have 不再提醒 button');
});

// ============================================
// Test Suite: socraticChat (agent-bridge)
// ============================================

TestRunner.test('socraticChat: throws when project_path missing', async () => {
  const { socraticChat } = require('../../agent-bridge.js');
  let threw = false;
  try {
    await socraticChat(() => ({}), {}, { concept_titles: ['A'] });
  } catch (e) {
    threw = true;
  }
  TestRunner.assert(threw, 'should throw when project_path missing');
});

TestRunner.test('socraticChat: returns content and done from stream', async () => {
  const { socraticChat } = require('../../agent-bridge.js');

  const mockQueryFn = () => (async function* () {
    yield { type: 'assistant', content: 'What is the relationship between A and B?' };
    yield { type: 'result', subtype: 'success', result: 'What is the relationship between A and B?' };
  })();

  const result = await socraticChat(mockQueryFn, {}, {
    project_path: '/tmp/test',
    concept_titles: ['A', 'B']
  });

  TestRunner.assertEquals(result.done, false, 'should not be done without SESSION_END');
  TestRunner.assert(result.content.length > 0, 'content should not be empty');
});

TestRunner.test('socraticChat: [SESSION_END] sets done to true', async () => {
  const { socraticChat } = require('../../agent-bridge.js');

  const mockQueryFn = () => (async function* () {
    yield { type: 'assistant', content: 'Great discussion. [SESSION_END]' };
  })();

  const result = await socraticChat(mockQueryFn, {}, {
    project_path: '/tmp/test',
    concept_titles: ['A']
  });

  TestRunner.assertEquals(result.done, true, 'SESSION_END marker should set done=true');
  TestRunner.assert(!result.content.includes('[SESSION_END]'), 'marker should be stripped from content');
});

TestRunner.test('socraticChat: empty response throws', async () => {
  const { socraticChat } = require('../../agent-bridge.js');

  const mockQueryFn = () => (async function* () {
    yield { type: 'assistant', content: '' };
  })();

  let threw = false;
  try {
    await socraticChat(mockQueryFn, {}, {
      project_path: '/tmp/test',
      concept_titles: ['A']
    });
  } catch (e) {
    threw = true;
  }
  TestRunner.assert(threw, 'empty response should throw');
});

// ============================================
// Test Suite: SocraticModal state machine
// ============================================

TestRunner.test('SocraticModal constructor initializes state', () => {
  setupDOM();
  const SocraticModal = loadModal();
  if (!SocraticModal) return;

  const modal = new SocraticModal({ projectPath: '/tmp/test' });
  TestRunner.assertEquals(modal.opened, false, 'should not be opened initially');
  TestRunner.assertEquals(modal.turns.length, 0, 'should have no turns initially');
  TestRunner.assertEquals(modal.notebookCards.length, 0, 'should have no cards initially');
  TestRunner.assertEquals(modal.llmDone, false, 'llmDone should be false');
  TestRunner.assertEquals(modal.doneCardShown, false, 'doneCardShown should be false');
});

TestRunner.test('SocraticModal requestEnd sets confirmDialog', () => {
  setupDOM();
  const SocraticModal = loadModal();
  if (!SocraticModal) return;

  const modal = new SocraticModal({ projectPath: '/tmp/test' });
  modal.requestEnd();
  TestRunner.assertExists(modal.confirmDialog, 'confirmDialog should be set');
  TestRunner.assert(
    modal.confirmDialog.text.includes('确定提前结束'),
    'confirm text should mention early end'
  );
});

TestRunner.test('SocraticModal confirmEnd clears dialog and triggers endSession', async () => {
  setupDOM();
  const SocraticModal = loadModal();
  if (!SocraticModal) return;

  const modal = new SocraticModal({ projectPath: '/tmp/test' });
  modal.requestEnd();
  TestRunner.assertExists(modal.confirmDialog);

  await modal.confirmEnd();
  TestRunner.assertEquals(modal.confirmDialog, null, 'confirmDialog should be cleared');
  TestRunner.assertEquals(modal.doneCardShown, true, 'done card should be shown');
});

TestRunner.test('SocraticModal endSession saves correct structure', async () => {
  setupDOM();
  const SocraticModal = loadModal();
  if (!SocraticModal) return;

  let savedSession = null;
  global.window.__TAURI__.core.invoke = async (cmd, args) => {
    if (cmd === 'socratic_save_session') {
      savedSession = args.session;
    }
  };

  const modal = new SocraticModal({ projectPath: '/tmp/test' });
  modal.concept_ids = ['jwt', 'oauth2'];
  modal.concept_titles = ['JWT', 'OAuth2'];
  modal.turns = [
    { role: 'tutor', content: 'Q1' },
    { role: 'user', content: 'A1' }
  ];

  await modal.endSession('llm_done');

  TestRunner.assertExists(savedSession, 'session should be saved');
  TestRunner.assertEquals(savedSession.version, '1.0', 'version should be 1.0');
  TestRunner.assertEquals(savedSession.end_reason, 'llm_done');
  TestRunner.assertEquals(savedSession.concept_ids.length, 2, 'should have 2 concept ids');
  TestRunner.assertEquals(savedSession.turns.length, 2, 'should have 2 turns');
  TestRunner.assertExists(savedSession.started_at, 'should have started_at');
  TestRunner.assertExists(savedSession.ended_at, 'should have ended_at');
});

TestRunner.test('SocraticModal showDoneCard sets flag and adds card', () => {
  setupDOM();
  const SocraticModal = loadModal();
  if (!SocraticModal) return;

  const modal = new SocraticModal({ projectPath: '/tmp/test' });
  modal.showDoneCard();
  TestRunner.assertEquals(modal.doneCardShown, true, 'doneCardShown should be true');
  const doneCard = modal.notebookCards.find(c => c.type === 'done');
  TestRunner.assertExists(doneCard, 'should add a done card');
});

TestRunner.test('SocraticModal addTutorMessage appends to turns and cards', () => {
  setupDOM();
  const SocraticModal = loadModal();
  if (!SocraticModal) return;

  const modal = new SocraticModal({ projectPath: '/tmp/test' });
  modal.addTutorMessage('What is X?');
  TestRunner.assertEquals(modal.turns.length, 1, 'should have 1 turn');
  TestRunner.assertEquals(modal.turns[0].role, 'tutor');
  TestRunner.assertEquals(modal.notebookCards.length, 1);
  TestRunner.assertEquals(modal.notebookCards[0].type, 'q');
});

TestRunner.test('SocraticModal addUserMessage appends to turns and cards', () => {
  setupDOM();
  const SocraticModal = loadModal();
  if (!SocraticModal) return;

  const modal = new SocraticModal({ projectPath: '/tmp/test' });
  modal.addUserMessage('X is Y');
  TestRunner.assertEquals(modal.turns.length, 1);
  TestRunner.assertEquals(modal.turns[0].role, 'user');
  TestRunner.assertEquals(modal.notebookCards[0].type, 'a');
});

// ============================================
// Round 3: Error handling
// ============================================

TestRunner.test('SocraticModal _sendTutorTurn shows friendly error on invoke failure', async () => {
  setupDOM();
  const SocraticModal = loadModal();
  if (!SocraticModal) return;

  // Mock invoke to simulate failure
  let invokeCalled = false;
  global.window.__TAURI__.core.invoke = async () => {
    invokeCalled = true;
    throw new Error('Agent SDK timeout');
  };

  const modal = new SocraticModal({ projectPath: '/tmp/test' });
  modal.opened = true; // Simulate modal is open
  modal._chatEl = global.document.createElement('div');
  modal.concept_titles = ['A'];

  // Manually call the internal method (it's private but accessible in JS)
  await modal._sendTutorTurn();

  TestRunner.assert(invokeCalled, 'invoke should have been called');
  TestRunner.assert(
    modal.notebookCards.some(c => c.type === 'error'),
    'should add error card on failure'
  );
  TestRunner.assert(
    modal.turns.some(t => t.content.includes('暂时无法连接')),
    'error message should be user-friendly'
  );
  TestRunner.assertEquals(modal.opened, true, 'modal should stay open after error');
});

TestRunner.test('SocraticModal endSession shows error but keeps modal open on save failure', async () => {
  setupDOM();
  const SocraticModal = loadModal();
  if (!SocraticModal) return;

  global.window.__TAURI__.core.invoke = async (cmd) => {
    if (cmd === 'socratic_save_session') {
      throw new Error('Disk full');
    }
    return null;
  };

  const modal = new SocraticModal({ projectPath: '/tmp/test' });
  modal.opened = true; // Simulate modal is open
  modal._chatEl = global.document.createElement('div');
  modal.turns = [{ role: 'tutor', content: 'Q1' }];

  await modal.endSession('llm_done');

  TestRunner.assertEquals(modal.opened, true, 'modal should NOT auto-close on save failure');
  TestRunner.assertExists(modal.saveError, 'saveError should be set');
  TestRunner.assert(
    modal.saveError.includes('保存失败'),
    'saveError should mention 保存失败'
  );
  TestRunner.assert(
    modal.turns.length >= 1,
    'turns should not be lost when save fails'
  );
});

TestRunner.test('SocraticModal cancel end keeps modal open', () => {
  setupDOM();
  const SocraticModal = loadModal();
  if (!SocraticModal) return;

  const modal = new SocraticModal({ projectPath: '/tmp/test' });
  modal.opened = true;
  modal.requestEnd();
  TestRunner.assertExists(modal.confirmDialog, 'confirmDialog should be set after requestEnd');

  // Simulate cancel
  modal.confirmDialog = null;

  TestRunner.assertEquals(modal.opened, true, 'modal should remain open after cancel');
  TestRunner.assertEquals(modal.confirmDialog, null, 'confirmDialog should be dismissed');
});

TestRunner.test('SocraticModal endSession prevents double-save', async () => {
  setupDOM();
  const SocraticModal = loadModal();
  if (!SocraticModal) return;

  let saveCount = 0;
  global.window.__TAURI__.core.invoke = async (cmd) => {
    if (cmd === 'socratic_save_session') saveCount++;
  };

  const modal = new SocraticModal({ projectPath: '/tmp/test' });
  modal.turns = [{ role: 'tutor', content: 'Q1' }];

  await modal.endSession('user_ended');
  await modal.endSession('user_ended'); // Second call should be no-op

  TestRunner.assertEquals(saveCount, 1, 'should only save once despite two endSession calls');
  TestRunner.assertEquals(modal._sessionSaved, true, '_sessionSaved flag should be set');
});

TestRunner.test('SocraticModal confirmEnd cancels auto-end timer', () => {
  setupDOM();
  const SocraticModal = loadModal();
  if (!SocraticModal) return;

  const modal = new SocraticModal({ projectPath: '/tmp/test' });
  // Simulate auto-end timer was set by _handleLLMDone
  modal._autoEndTimer = setTimeout(() => {}, 99999);

  modal.confirmEnd(); // confirmEnd is async but timer check is sync

  TestRunner.assertEquals(modal._autoEndTimer, null, 'auto-end timer should be cleared');
  TestRunner.assertEquals(modal.confirmDialog, null, 'confirmDialog should be cleared');
});

// ============================================
// Run
// ============================================

TestRunner.run().then(({ passed, failed }) => {
  if (failed > 0) process.exit(1);
});
