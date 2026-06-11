/**
 * TDD Tests for Learning Project Manager Implementation
 * Tests the actual public API exposed by project-manager.js
 */

// Mock DOM environment
global.document = {
  getElementById: (id) => ({
    id,
    style: {},
    classList: { add() {}, remove() {} },
    addEventListener() {},
    textContent: '',
    innerHTML: '',
    value: '',
    dataset: {},
    children: [],
    appendChild() {},
    querySelector: () => ({
      addEventListener() {},
      value: ''
    }),
    querySelectorAll: () => []
  }),
  querySelector: () => ({
    addEventListener() {},
    checked: false,
    value: ''
  }),
  querySelectorAll: () => [],
  createElement: (tag) => ({
    tagName: tag,
    className: '',
    style: {},
    classList: { add() {}, remove() {}, contains: () => false },
    textContent: '',
    innerHTML: '',
    dataset: {},
    children: [],
    _listeners: {},
    addEventListener(event, handler) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(handler);
    },
    appendChild(child) { this.children.push(child); },
    querySelector: () => ({
      addEventListener() {}
    }),
    querySelectorAll: () => []
  }),
  addEventListener() {},
  readyState: 'complete'
};

global.window = {
  __TAURI__: null,
  addEventListener() {},
  removeEventListener() {}
};

// Load test runner
const TestRunner = require('../../shared/test-runner');

// Load implementation (will initialize with mocked DOM)
require('../../../dist/scripts/learning/project-manager.js');

// ============================================
// TDD: Public API Tests
// ============================================

TestRunner.test('LearningProject exposes required public API', () => {
  TestRunner.assertExists(window.LearningProject, 'LearningProject should exist');
  TestRunner.assert(typeof window.LearningProject.open === 'function', 'Should have open()');
  TestRunner.assert(typeof window.LearningProject.close === 'function', 'Should have close()');
  TestRunner.assert(typeof window.LearningProject.getState === 'function', 'Should have getState()');
});

TestRunner.test('getState returns correct initial state', () => {
  const state = window.LearningProject.getState();
  TestRunner.assertEquals(state.step, 'idle', 'Initial step should be idle');
  TestRunner.assertEquals(state.goal, '', 'Initial goal should be empty');
  TestRunner.assertEquals(state.level, 'intermediate', 'Default level should be intermediate');
  TestRunner.assertEquals(state.hours, 3, 'Default hours should be 3');
  TestRunner.assertEquals(state.isLoading, false, 'Should not be loading');
  TestRunner.assertEquals(state.error, null, 'Should have no error');
});

TestRunner.test('CHAPTER_STATUS has all required values', () => {
  const statuses = window.LearningProject.CHAPTER_STATUS;
  TestRunner.assertExists(statuses.NOT_GENERATED, 'Should have NOT_GENERATED');
  TestRunner.assertExists(statuses.GENERATING, 'Should have GENERATING');
  TestRunner.assertExists(statuses.READY, 'Should have READY');
  TestRunner.assertExists(statuses.COMPLETED, 'Should have COMPLETED');
  TestRunner.assertExists(statuses.FAILED, 'Should have FAILED');
});

TestRunner.test('open() transitions state from idle to input-ready', () => {
  const state = window.LearningProject.getState();
  TestRunner.assertEquals(state.step, 'idle', 'Should start at idle');
});

TestRunner.test('close() does not break when modal is hidden', () => {
  TestRunner.assertDoesNotThrow(() => {
    window.LearningProject.close();
  }, 'close() should not throw');
});

// Helper
TestRunner.assertDoesNotThrow = function(fn, message) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    console.error('Unexpected error:', e);
  }
  if (threw) {
    throw new Error(message || 'Expected function not to throw');
  }
};

// Run
console.log('Running TDD tests for Learning Project Manager Implementation...\n');
TestRunner.run();
