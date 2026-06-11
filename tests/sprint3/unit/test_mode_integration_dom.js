#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * DOM State Machine Tests for mode-integration.js
 * Covers: learning mode body class, callout enhancement, quiz area lifecycle,
 *         scroll trigger, explanation modal, teardown cleanup
 *
 * Lesson from Sprint 3: BDD acceptance only tested logic flags, not actual
 * DOM mutations. "掌握了吗" area and AI toolbar were invisible in the app.
 */

const path = require('path');
const TestRunner = require('../../shared/test-runner');
const { buildMockDOM } = require('../../shared/mock-dom');

// ============================================
// Mock Implementations
// ============================================

function MockQuizPanel(opts) {
  this._chapterFile = opts.chapterFile;
  this._state = 'hidden';
  this._answers = {};
}
MockQuizPanel.prototype.notifyScrollProgress = function(p) {
  this._state = p >= 0.8 ? 'loading' : 'hidden';
};
MockQuizPanel.prototype.getState = function() { return this._state; };
MockQuizPanel.prototype.getChapterFile = function() { return this._chapterFile; };
MockQuizPanel.prototype.setQuestions = function(qs) { this._state = 'ready'; };
MockQuizPanel.prototype.startAnswering = function() { this._state = 'answering'; };
MockQuizPanel.prototype.submit = function() { this._state = 'submitting'; };
MockQuizPanel.prototype.setResult = function(r) { this._state = 'graded'; };
MockQuizPanel.prototype.setAnswer = function(id, ans) { this._answers[id] = ans; };
MockQuizPanel.prototype.reset = function() { this._state = 'hidden'; this._answers = {}; };

function MockSelectionExplainer() {}
function MockElementRenderer() {}
MockElementRenderer.parseLearningElements = function() { return []; };

// ============================================
// Environment Setup
// ============================================

function setupEnv() {
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
        invoke: () => Promise.resolve()
      }
    },
    showToast: () => {},
    addEventListener() {},
    removeEventListener() {},
    getSelection() { return { toString: () => '' }; }
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

function createCallout(document, icon, title, content) {
  const bq = document.createElement('blockquote');
  bq._textContent = `${icon} ${title} ${content}`;

  const iconEl = document.createElement('span');
  iconEl.classList.add('obsidian-callout-icon');
  iconEl.textContent = icon;
  bq.appendChild(iconEl);

  const titleEl = document.createElement('div');
  titleEl.classList.add('obsidian-callout-title-text');
  titleEl.textContent = title;
  bq.appendChild(titleEl);

  const contentEl = document.createElement('p');
  contentEl.textContent = content;
  bq.appendChild(contentEl);

  return bq;
}

// ============================================
// Tests
// ============================================

TestRunner.test('enhanceLearningElements skips when not in learning mode', () => {
  setupEnv();
  const LMI = loadIntegration();

  const mdBody = document.getElementById('markdownBody');
  const bq = createCallout(document, '💡', 'Concept', 'Test');
  mdBody.appendChild(bq);

  LMI.enhanceLearningElements();

  TestRunner.assert(
    !bq._dataset.sprint3Enhanced,
    'Should not mark blockquote when not in learning mode'
  );
});

TestRunner.test('enhanceLearningElements marks concept callout in learning mode', () => {
  setupEnv();
  const LMI = loadIntegration();
  document.body.classList.add('learning-mode');

  const mdBody = document.getElementById('markdownBody');
  const bq = createCallout(document, 'ℹ️', 'Concept', 'Test content');
  mdBody.appendChild(bq);

  LMI.enhanceLearningElements();

  TestRunner.assertEquals(bq._dataset.sprint3Enhanced, 'true', 'Should mark as enhanced');
  TestRunner.assertEquals(bq._dataset.sprint3Type, 'concept', 'Should detect concept type');
});

TestRunner.test('enhanceLearningElements marks question callout in learning mode', () => {
  setupEnv();
  const LMI = loadIntegration();
  document.body.classList.add('learning-mode');

  const mdBody = document.getElementById('markdownBody');
  const bq = createCallout(document, '❓', 'Question', 'Why?');
  mdBody.appendChild(bq);

  LMI.enhanceLearningElements();

  TestRunner.assertEquals(bq._dataset.sprint3Type, 'question', 'Should detect question type');
});

TestRunner.test('enhanceLearningElements cleans checkmarks from quiz callout', () => {
  setupEnv();
  const LMI = loadIntegration();
  document.body.classList.add('learning-mode');

  const mdBody = document.getElementById('markdownBody');
  const bq = createCallout(document, '📝', 'Quiz', 'Test');

  const ul = document.createElement('ul');
  const li1 = document.createElement('li');
  li1._innerHTML = 'Option A ✓';
  ul.appendChild(li1);
  const li2 = document.createElement('li');
  li2._innerHTML = 'Option B ✅';
  ul.appendChild(li2);
  bq.appendChild(ul);

  mdBody.appendChild(bq);

  LMI.enhanceLearningElements();

  TestRunner.assert(!li1._innerHTML.includes('✓'), 'Should remove ✓ from li');
  TestRunner.assert(!li2._innerHTML.includes('✅'), 'Should remove ✅ from li');
});

TestRunner.test('setupQuizPanel injects quiz area with display:none', () => {
  setupEnv();
  const LMI = loadIntegration();
  document.body.classList.add('learning-mode');

  LMI.setupQuizPanel('02-test.md', '/project');

  const quizArea = document.getElementById('learningQuizArea');
  TestRunner.assertExists(quizArea, 'Quiz area should exist');
  TestRunner.assertEquals(quizArea.style.display, 'none', 'Quiz area should be initially hidden');
});

TestRunner.test('scroll progress >= 0.8 shows quiz area', () => {
  setupEnv();
  const LMI = loadIntegration();
  document.body.classList.add('learning-mode');

  const mdBody = document.getElementById('markdownBody');
  mdBody.scrollHeight = 1000;
  mdBody.clientHeight = 200;
  mdBody.scrollTop = 800; // progress = 1.0

  LMI.setupQuizPanel('02-test.md', '/project');

  const quizArea = document.getElementById('learningQuizArea');
  TestRunner.assertExists(quizArea, 'Quiz area should exist');
  TestRunner.assertEquals(quizArea.style.display, 'none', 'Initially hidden');

  // Trigger the bound scroll handler directly
  const listeners = mdBody._listeners.scroll || [];
  TestRunner.assert(listeners.length > 0, 'Scroll listener should be bound');
  listeners.forEach(fn => fn());

  TestRunner.assertEquals(quizArea.style.display, 'block', 'Quiz area should be visible after scroll');
});

// NOTE: Sprint 6 replaced modal-based explain with Cornell sidebar.
// Sidebar tests are covered by test_explain_conversation.js (Sprint 6).
// The old modal tests are removed because the modal no longer exists.

TestRunner.test('teardown removes quiz area, hides AI button, and removes modal', () => {
  setupEnv();
  const LMI = loadIntegration();
  document.body.classList.add('learning-mode');

  LMI.setupQuizPanel('02-test.md', '/project');

  TestRunner.assertExists(
    document.getElementById('learningQuizArea'),
    'Quiz area should exist before teardown'
  );

  LMI.teardown();

  TestRunner.assert(
    document.getElementById('learningQuizArea') === null,
    'Quiz area should be removed'
  );
});

// ============================================
// Run
// ============================================

TestRunner.run().then(({ passed, failed }) => {
  if (failed > 0) process.exit(1);
});
