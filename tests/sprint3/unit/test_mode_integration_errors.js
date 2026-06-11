#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * Error Path Tests for mode-integration.js
 * Covers: quiz load failure, AI explain failure, teardown safety,
 *         save history skip on empty project path
 *
 * Lesson from Sprint 3: error paths were untested; failures surfaced
 * only during manual integration testing.
 */

const path = require('path');
const TestRunner = require('../../shared/test-runner');
const { buildMockDOM } = require('../../shared/mock-dom');

// ============================================
// Mock QuizPanel
// ============================================

let _lastQuizPanel = null;

function MockQuizPanel(opts) {
  _lastQuizPanel = this;
  this._chapterFile = opts.chapterFile;
  this._state = 'hidden';
  this._answers = {};
  this.onSaveHistory = null;
  this.onAdaptRequested = null;
}
MockQuizPanel.prototype.notifyScrollProgress = function(p) {
  this._state = p >= 0.8 ? 'loading' : 'hidden';
};
MockQuizPanel.prototype.getState = function() { return this._state; };
MockQuizPanel.prototype.getChapterFile = function() { return this._chapterFile; };
MockQuizPanel.prototype.setQuestions = function(qs) { this._state = 'ready'; };
MockQuizPanel.prototype.startAnswering = function() { this._state = 'answering'; };
MockQuizPanel.prototype.submit = function() { this._state = 'submitting'; };
MockQuizPanel.prototype.setResult = function(r) {
  this._state = 'graded';
  if (this.onSaveHistory) {
    this.onSaveHistory({
      chapter: this._chapterFile,
      result: r,
      answers: this._answers,
      questions: []
    });
  }
  if (this.onAdaptRequested && r.rating !== 'mastered') {
    this.onAdaptRequested({ rating: r.rating });
  }
};
MockQuizPanel.prototype.setAnswer = function(id, ans) { this._answers[id] = ans; };
MockQuizPanel.prototype.reset = function() { this._state = 'hidden'; this._answers = {}; };

function MockSelectionExplainer() {}
function MockElementRenderer() {}
MockElementRenderer.parseLearningElements = function() { return []; };

// ============================================
// Environment Setup
// ============================================

function setupEnv(opts = {}) {
  const { document, body } = buildMockDOM();
  global.document = document;
  global.window = {
    document,
    LearningProgress: {},
    QuizPanel: MockQuizPanel,
    SelectionExplainer: MockSelectionExplainer,
    ElementRenderer: MockElementRenderer,
    __TAURI__: {
      core: {
        invoke: opts.invokeFn || (() => Promise.resolve())
      }
    },
    showToast: opts.showToastFn || (() => {}),
    addEventListener() {},
    removeEventListener() {},
    getSelection() { return { toString: () => opts.selectedText || '' }; }
  };

  const mdBody = document.createElement('div');
  mdBody._attrs.id = 'markdownBody';
  body.appendChild(mdBody);

  const aiBtn = document.createElement('button');
  aiBtn._attrs.id = 'aiExplainBtn';
  body.appendChild(aiBtn);
}

function loadIntegration() {
  const miPath = path.join(__dirname, '../../../dist/scripts/learning/mode-integration.js');
  delete require.cache[require.resolve(miPath)];
  require(miPath);
  return window.LearningModeIntegration;
}

// ============================================
// Tests
// ============================================

TestRunner.test('onQuizStart error shows toast with error message', async () => {
  let toastMsg = null;
  let toastType = null;
  setupEnv({
    invokeFn: () => Promise.reject(new Error('network error')),
    showToastFn: (msg, type) => { toastMsg = msg; toastType = type; }
  });

  const LMI = loadIntegration();
  document.body.classList.add('learning-mode');
  LMI.setupQuizPanel('02-test.md', '/project');

  const startBtn = document.getElementById('learningQuizStartBtn');
  TestRunner.assertExists(startBtn, 'Start button should exist');
  startBtn.click();

  await new Promise(r => setTimeout(r, 50));

  TestRunner.assertExists(toastMsg, 'Toast should have been called');
  TestRunner.assert(
    toastMsg.includes('加载测验失败'),
    `Expected error toast about quiz load failure, got: ${toastMsg}`
  );
  TestRunner.assertEquals(toastType, 'error', 'Toast type should be error');
});

// NOTE: Sprint 6 replaced modal-based explain with Cornell sidebar.
// Error handling now updates sidebar cues instead of creating a modal.
// See test_explain_conversation.js for Sprint 6 explain tests.

TestRunner.test('teardown does not throw when DOM elements are missing', () => {
  setupEnv();
  const LMI = loadIntegration();

  // Remove elements that teardown expects to find
  const aiBtn = document.getElementById('aiExplainBtn');
  if (aiBtn) aiBtn.remove();

  try {
    LMI.teardown();
    TestRunner.assert(true, 'teardown succeeded without error');
  } catch (e) {
    throw new Error('teardown threw unexpectedly: ' + e.message);
  }
});

TestRunner.test('onQuizSaveHistory skips persistence when projectPath is empty', async () => {
  let invokeCalled = false;
  let invokeCommand = null;
  setupEnv({
    invokeFn: (cmd) => { invokeCalled = true; invokeCommand = cmd; return Promise.resolve(); }
  });

  const LMI = loadIntegration();
  document.body.classList.add('learning-mode');
  _lastQuizPanel = null;
  LMI.setupQuizPanel('02-test.md', ''); // empty project path

  TestRunner.assertExists(_lastQuizPanel, 'QuizPanel should have been created');

  // Trigger save history callback with minimal payload
  _lastQuizPanel.onSaveHistory({
    chapter: '02-test.md',
    result: { rating: 'mastered', score: 1.0, weak_concepts: [] },
    answers: {},
    questions: []
  });

  await new Promise(r => setTimeout(r, 50));

  TestRunner.assert(
    !invokeCalled,
    'persist_quiz_result should NOT be invoked when projectPath is empty'
  );
});

// ============================================
// Run
// ============================================

TestRunner.run().then(({ passed, failed }) => {
  if (failed > 0) process.exit(1);
});
