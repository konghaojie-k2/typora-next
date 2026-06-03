/**
 * TDD Tests for Quiz Panel
 * Tests chapter-end mastery check, state machine, and adaptive feedback
 *
 * Module: dist/scripts/learning/quiz-panel.js
 */

const T = require('../../unit/test-runner');

// Ensure assertEquals/assertExists are available
if (typeof T.assertEquals === 'undefined') {
  T.assertEquals = function(a, b, msg) {
    if (a !== b) throw new Error((msg || 'Assertion failed') + `: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  };
}
if (typeof T.assertExists === 'undefined') {
  T.assertExists = function(v, msg) { if (v === null || v === undefined) throw new Error(msg || 'Expected value to exist'); };
}

// ============================================
// Setup
// ============================================

if (typeof global.window === 'undefined') global.window = {};
if (typeof global.document === 'undefined') {
  global.document = {
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      children: [],
      _classes: [],
      _attrs: {},
      _listeners: {},
      classList: {
        add() {}, remove() {}, contains() { return false; }, toggle() {}
      },
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

let QuizPanel;
try {
  QuizPanel = require('../../../dist/scripts/learning/quiz-panel');
} catch (e) {
  QuizPanel = null;
}

// ============================================
// State Machine Tests
// ============================================

T.test('state: 初始状态为 hidden', () => {
  if (!QuizPanel) throw new Error('QuizPanel not loaded');
  const panel = new QuizPanel.QuizPanel({ chapterFile: 'fake.md' });
  T.assertEquals(panel.getState(), 'hidden', 'initial state');
});

T.test('state: hidden → loading（滚动到 80%）', () => {
  if (!QuizPanel) throw new Error('QuizPanel not loaded');
  const panel = new QuizPanel.QuizPanel({ chapterFile: 'fake.md' });
  panel.notifyScrollProgress(0.85);
  // State should transition; allow either loading or generating
  T.assert(['loading', 'generating', 'loading'].includes(panel.getState()),
    `expected loading, got ${panel.getState()}`);
});

T.test('state: loading → ready（quiz 生成完成）', () => {
  if (!QuizPanel) throw new Error('QuizPanel not loaded');
  const panel = new QuizPanel.QuizPanel({ chapterFile: 'fake.md' });
  panel.setQuestions([{ id: 'q1', type: 'single', question: '?', options: [], correct: 'A' }]);
  T.assertEquals(panel.getState(), 'ready', 'state after questions set');
});

T.test('state: ready → answering（用户开始作答）', () => {
  if (!QuizPanel) throw new Error('QuizPanel not loaded');
  const panel = new QuizPanel.QuizPanel({ chapterFile: 'fake.md' });
  panel.setQuestions([{ id: 'q1', type: 'single', question: '?', options: [], correct: 'A' }]);
  panel.startAnswering();
  T.assertEquals(panel.getState(), 'answering', 'state after startAnswering');
});

T.test('state: answering → submitting（提交答案）', () => {
  if (!QuizPanel) throw new Error('QuizPanel not loaded');
  const panel = new QuizPanel.QuizPanel({ chapterFile: 'fake.md' });
  panel.setQuestions([{ id: 'q1' }]);
  panel.startAnswering();
  panel.submit();
  T.assertEquals(panel.getState(), 'submitting', 'state after submit');
});

T.test('state: submitting → graded（评估完成）', () => {
  if (!QuizPanel) throw new Error('QuizPanel not loaded');
  const panel = new QuizPanel.QuizPanel({ chapterFile: 'fake.md' });
  panel.setQuestions([{ id: 'q1' }]);
  panel.startAnswering();
  panel.submit();
  panel.setResult({ rating: 'mastered', score: 1.0, weak_concepts: [] });
  T.assertEquals(panel.getState(), 'graded', 'state after grading');
});

T.test('state: 非法状态转换抛错', () => {
  if (!QuizPanel) throw new Error('QuizPanel not loaded');
  const panel = new QuizPanel.QuizPanel({ chapterFile: 'fake.md' });
  // hidden → graded 不允许
  T.assertThrows(() => panel.setResult({ rating: 'mastered' }),
    'should throw on invalid transition');
});

// ============================================
// Question Management Tests
// ============================================

T.test('questions: 存储 3-5 道题', () => {
  if (!QuizPanel) throw new Error('QuizPanel not loaded');
  const panel = new QuizPanel.QuizPanel({ chapterFile: 'fake.md' });
  const questions = [
    { id: 'q1', type: 'single', question: 'Q1', options: [{label:'A',text:'1'},{label:'B',text:'2'}], correct: 'A' },
    { id: 'q2', type: 'single', question: 'Q2', options: [{label:'A',text:'1'},{label:'B',text:'2'}], correct: 'B' },
    { id: 'q3', type: 'multiple', question: 'Q3', options: [{label:'A',text:'1'},{label:'B',text:'2'}], correct: ['A','B'] }
  ];
  panel.setQuestions(questions);
  T.assertEquals(panel.getQuestions().length, 3, 'questions stored');
});

T.test('answers: 记录用户答案', () => {
  if (!QuizPanel) throw new Error('QuizPanel not loaded');
  const panel = new QuizPanel.QuizPanel({ chapterFile: 'fake.md' });
  panel.setQuestions([{ id: 'q1' }, { id: 'q2' }]);
  panel.startAnswering();
  panel.setAnswer('q1', 'A');
  panel.setAnswer('q2', 'B');
  T.assertEquals(panel.getAnswer('q1'), 'A', 'answer q1');
  T.assertEquals(panel.getAnswer('q2'), 'B', 'answer q2');
});

T.test('result: 存储评估结果', () => {
  if (!QuizPanel) throw new Error('QuizPanel not loaded');
  const panel = new QuizPanel.QuizPanel({ chapterFile: 'fake.md' });
  panel.setQuestions([{ id: 'q1' }]);
  panel.startAnswering();
  panel.submit();
  const result = { rating: 'learning', score: 0.5, weak_concepts: ['X'], suggestions: ['复习 X'] };
  panel.setResult(result);
  const stored = panel.getResult();
  T.assertEquals(stored.rating, 'learning', 'rating stored');
  T.assertEquals(stored.weak_concepts.length, 1, 'weak concepts stored');
});

T.test('result: rating 必须是 mastered/learning/struggling', () => {
  if (!QuizPanel) throw new Error('QuizPanel not loaded');
  const panel = new QuizPanel.QuizPanel({ chapterFile: 'fake.md' });
  panel.setQuestions([{ id: 'q1' }]);
  panel.startAnswering();
  panel.submit();
  T.assertThrows(() => panel.setResult({ rating: 'invalid_rating' }),
    'should reject invalid rating');
});

// ============================================
// Adaptive Feedback Tests
// ============================================

T.test('adaptive: mastered 不触发 adaptSubsequent', () => {
  if (!QuizPanel) throw new Error('QuizPanel not loaded');
  const panel = new QuizPanel.QuizPanel({ chapterFile: 'fake.md' });
  panel.setQuestions([{ id: 'q1' }]);
  panel.startAnswering();
  panel.submit();
  let adaptCalled = false;
  panel.onAdaptRequested = () => { adaptCalled = true; };
  panel.setResult({ rating: 'mastered', score: 1.0, weak_concepts: [] });
  T.assertEquals(adaptCalled, false, 'mastered should not trigger adapt');
});

T.test('adaptive: struggling 触发 adaptSubsequent', () => {
  if (!QuizPanel) throw new Error('QuizPanel not loaded');
  const panel = new QuizPanel.QuizPanel({ chapterFile: 'fake.md' });
  panel.setQuestions([{ id: 'q1' }]);
  panel.startAnswering();
  panel.submit();
  let adaptCalled = false;
  let adaptPayload = null;
  panel.onAdaptRequested = (payload) => {
    adaptCalled = true;
    adaptPayload = payload;
  };
  panel.setResult({ rating: 'struggling', score: 0.2, weak_concepts: ['A', 'B'] });
  T.assertEquals(adaptCalled, true, 'struggling should trigger adapt');
  T.assertEquals(adaptPayload.weak_concepts.length, 2, 'weak concepts passed');
});

T.test('adaptive: learning 触发 adaptSubsequent', () => {
  if (!QuizPanel) throw new Error('QuizPanel not loaded');
  const panel = new QuizPanel.QuizPanel({ chapterFile: 'fake.md' });
  panel.setQuestions([{ id: 'q1' }]);
  panel.startAnswering();
  panel.submit();
  let adaptCalled = false;
  panel.onAdaptRequested = () => { adaptCalled = true; };
  panel.setResult({ rating: 'learning', score: 0.5, weak_concepts: ['X'] });
  T.assertEquals(adaptCalled, true, 'learning should trigger adapt');
});

// ============================================
// History Persistence Tests
// ============================================

T.test('history: 测验完成后调用 onSaveHistory 回调', () => {
  if (!QuizPanel) throw new Error('QuizPanel not loaded');
  const panel = new QuizPanel.QuizPanel({ chapterFile: 'fake.md' });
  let saveCalled = false;
  let savedEntry = null;
  panel.onSaveHistory = (entry) => {
    saveCalled = true;
    savedEntry = entry;
  };
  panel.setQuestions([{ id: 'q1' }]);
  panel.startAnswering();
  panel.setAnswer('q1', 'A');
  panel.submit();
  panel.setResult({ rating: 'mastered', score: 1.0, weak_concepts: [] });
  T.assertEquals(saveCalled, true, 'save called');
  T.assertExists(savedEntry, 'entry saved');
  T.assertEquals(savedEntry.chapter, 'fake.md', 'chapter in entry');
  T.assertExists(savedEntry.timestamp, 'timestamp in entry');
});

T.test('history: entry 包含 questions/answers/result', () => {
  if (!QuizPanel) throw new Error('QuizPanel not loaded');
  const panel = new QuizPanel.QuizPanel({ chapterFile: 'ch1.md' });
  let saved = null;
  panel.onSaveHistory = (e) => { saved = e; };
  panel.setQuestions([{ id: 'q1', question: 'Q?' }]);
  panel.startAnswering();
  panel.setAnswer('q1', 'A');
  panel.submit();
  panel.setResult({ rating: 'mastered', score: 1.0, weak_concepts: [] });
  T.assertExists(saved.questions, 'has questions');
  T.assertExists(saved.answers, 'has answers');
  T.assertExists(saved.result, 'has result');
});

// Expose T for test-runner
module.exports = T;
