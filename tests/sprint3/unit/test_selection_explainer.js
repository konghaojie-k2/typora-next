/**
 * TDD Tests for Selection Explainer
 * Tests text selection → AI explanation workflow
 *
 * Module: dist/scripts/learning/selection-explainer.js
 */

const T = require('../../unit/test-runner');

if (typeof T.assertEquals === 'undefined') {
  T.assertEquals = function(a, b, msg) {
    if (a !== b) throw new Error((msg || 'Assertion failed') + `: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  };
}
if (typeof T.assertExists === 'undefined') {
  T.assertExists = function(v, msg) { if (v === null || v === undefined) throw new Error(msg || 'Expected value to exist'); };
}

if (typeof global.window === 'undefined') global.window = {};
if (typeof global.document === 'undefined') {
  global.document = {
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      children: [],
      _classes: [],
      _attrs: {},
      _listeners: {},
      classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return this._attrs[k]; },
      appendChild(c) { this.children.push(c); return c; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
      removeEventListener() {},
      click() { (this._listeners.click || []).forEach(fn => fn({ target: this })); },
      get innerHTML() { return this._innerHTML; },
      set innerHTML(v) { this._innerHTML = v; },
      get textContent() { return this._textContent; },
      set textContent(v) { this._textContent = v; }
    }),
    body: { appendChild() {} }
  };
}

let SelectionExplainer;
try {
  SelectionExplainer = require('../../../dist/scripts/learning/selection-explainer');
} catch (e) {
  SelectionExplainer = null;
}

// ============================================
// Selection Detection Tests
// ============================================

T.test('detect: 提取选中文本', () => {
  if (!SelectionExplainer) throw new Error('SelectionExplainer not loaded');
  const explainer = new SelectionExplainer.SelectionExplainer();
  const sel = { toString: () => '梯度消失问题', rangeCount: 1 };
  const text = explainer.extractSelectedText(sel);
  T.assertEquals(text, '梯度消失问题', 'extracted text');
});

T.test('detect: 空选区返回空字符串', () => {
  if (!SelectionExplainer) throw new Error('SelectionExplainer not loaded');
  const explainer = new SelectionExplainer.SelectionExplainer();
  const sel = { toString: () => '', rangeCount: 0 };
  const text = explainer.extractSelectedText(sel);
  T.assertEquals(text, '', 'empty text');
});

T.test('detect: 限制最大选区长度（防滥用）', () => {
  if (!SelectionExplainer) throw new Error('SelectionExplainer not loaded');
  const explainer = new SelectionExplainer.SelectionExplainer();
  const longText = 'a'.repeat(500);
  const sel = { toString: () => longText, rangeCount: 1 };
  const text = explainer.extractSelectedText(sel);
  T.assert(text.length <= 200, 'should limit selection length');
});

T.test('isInLearningContent: 选区在学习文档内', () => {
  if (!SelectionExplainer) throw new Error('SelectionExplainer not loaded');
  const explainer = new SelectionExplainer.SelectionExplainer();
  // Create a mock anchorNode parent with learning class
  const parent = { classList: { contains: (c) => c === 'learning-content' } };
  const sel = {
    toString: () => 'X',
    rangeCount: 1,
    getRangeAt: () => ({ startContainer: { parentNode: parent } })
  };
  T.assertEquals(explainer.isInLearningContent(sel), true, 'detected in learning content');
});

T.test('isInLearningContent: 选区在 UI 元素内（toolbar/badge）', () => {
  if (!SelectionExplainer) throw new Error('SelectionExplainer not loaded');
  const explainer = new SelectionExplainer.SelectionExplainer();
  const parent = { classList: { contains: (c) => c === 'toolbar' } };
  const sel = {
    toString: () => 'X',
    rangeCount: 1,
    getRangeAt: () => ({ startContainer: { parentNode: parent } })
  };
  T.assertEquals(explainer.isInLearningContent(sel), false, 'toolbar excluded');
});

module.exports = T;
