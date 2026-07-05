/**
 * TDD Tests for QuizPanel State Machine
 * Covers submit/setResult ordering, reset/retake flow, and callback contracts
 */

const TestRunner = require('../../shared/test-runner');

// Provide minimal browser globals for quiz-panel.js
if (typeof window === 'undefined') global.window = {};
if (typeof document === 'undefined') {
  global.document = {
    createElement: () => ({
      classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
      setAttribute() {},
      getAttribute() { return null; },
      appendChild() { return {}; },
      addEventListener() {},
    }),
  };
}

require('../../../dist/scripts/learning/quiz-panel.js');
const { QuizPanel, VALID_STATES, VALID_RATINGS } = window;

// ============================================
// Helpers
// ============================================
function makePanel() {
  return new QuizPanel({ chapterFile: '02-test.md' });
}

function makeQuestions() {
  return [
    { id: 'q1', qtype: 'single', question: 'Q1', options: [{ label: 'A', text: 'a' }, { label: 'B', text: 'b' }], correct: 'B', weak_concepts: ['c1'] },
    { id: 'q2', qtype: 'multiple', question: 'Q2', options: [{ label: 'A', text: 'a' }, { label: 'B', text: 'b' }], correct: ['A', 'B'], weak_concepts: ['c2'] },
    { id: 'q3', qtype: 'short', question: 'Q3', weak_concepts: ['c3'] },
  ];
}

// ============================================
// Test: State machine basics
// ============================================

TestRunner.test('QuizPanel transitions hidden -> loading -> ready -> answering -> submitting -> graded', () => {
  const panel = makePanel();
  panel.notifyScrollProgress(1.0); // hidden -> loading
  TestRunner.assertEquals(panel.getState(), 'loading', 'scroll should move to loading');

  panel.setQuestions(makeQuestions()); // loading -> ready
  TestRunner.assertEquals(panel.getState(), 'ready', 'setQuestions should move to ready');

  panel.startAnswering(); // ready -> answering
  TestRunner.assertEquals(panel.getState(), 'answering', 'startAnswering should move to answering');

  panel.submit(); // answering -> submitting
  TestRunner.assertEquals(panel.getState(), 'submitting', 'submit should move to submitting');

  panel.setResult({ rating: 'mastered', score: 1.0, weak_concepts: [] }); // submitting -> graded
  TestRunner.assertEquals(panel.getState(), 'graded', 'setResult should move to graded');
});

TestRunner.test('QuizPanel rejects setResult then submit ordering bug', () => {
  // This regression caused: onQuizModalSubmit called setResult() then submit(),
  // which threw because state was already graded.
  const panel = makePanel();
  panel.setQuestions(makeQuestions());
  panel.startAnswering();
  panel.submit();
  panel.setResult({ rating: 'mastered', score: 1.0, weak_concepts: [] });

  let threw = false;
  try {
    panel.submit(); // ❌ graded -> ? is invalid
  } catch (e) {
    threw = true;
  }
  TestRunner.assert(threw, 'submit from graded state should throw');
});

TestRunner.test('QuizPanel reset allows retake after graded', () => {
  const panel = makePanel();
  panel.setQuestions(makeQuestions());
  panel.startAnswering();
  panel.submit();
  panel.setResult({ rating: 'mastered', score: 1.0, weak_concepts: [] });
  TestRunner.assertEquals(panel.getState(), 'graded');

  panel.reset();
  TestRunner.assertEquals(panel.getState(), 'hidden', 'reset should return to hidden');

  panel.setQuestions(makeQuestions());
  TestRunner.assertEquals(panel.getState(), 'ready', 'after reset, setQuestions should move to ready');

  panel.startAnswering();
  TestRunner.assertEquals(panel.getState(), 'answering', 'after reset, startAnswering should work');
});

TestRunner.test('QuizPanel reset allows restart after closing mid-answering', () => {
  // Regression: user closed modal before submitting, then clicked "开始测验" again.
  // State was stuck in answering and setQuestions(ready) threw.
  const panel = makePanel();
  panel.setQuestions(makeQuestions());
  panel.startAnswering();
  TestRunner.assertEquals(panel.getState(), 'answering');

  // Simulate close-modal reset (mode-integration.js calls panel.reset())
  panel.reset();
  TestRunner.assertEquals(panel.getState(), 'hidden');

  panel.setQuestions(makeQuestions());
  panel.startAnswering();
  TestRunner.assertEquals(panel.getState(), 'answering', 'should be able to restart after reset');
});

// ============================================
// Test: Callbacks
// ============================================

TestRunner.test('QuizPanel triggers onSaveHistory when setResult reaches graded', () => {
  const panel = makePanel();
  let called = false;
  panel.onSaveHistory = (payload) => {
    called = true;
    TestRunner.assertExists(payload.chapter, 'payload should have chapter');
    TestRunner.assertExists(payload.timestamp, 'payload should have timestamp');
    TestRunner.assertExists(payload.result, 'payload should have result');
    TestRunner.assertEquals(payload.result.rating, 'learning');
  };

  panel.setQuestions(makeQuestions());
  panel.startAnswering();
  panel.submit();
  panel.setResult({ rating: 'learning', score: 0.6, weak_concepts: ['c1'] });

  TestRunner.assert(called, 'onSaveHistory should be called');
});

TestRunner.test('QuizPanel triggers onAdaptRequested for non-mastered ratings', () => {
  const panel = makePanel();
  let called = false;
  panel.onAdaptRequested = (payload) => {
    called = true;
    TestRunner.assertEquals(payload.rating, 'struggling');
  };

  panel.setQuestions(makeQuestions());
  panel.startAnswering();
  panel.submit();
  panel.setResult({ rating: 'struggling', score: 0.2, weak_concepts: ['c1'] });

  TestRunner.assert(called, 'onAdaptRequested should be called for struggling');
});

TestRunner.test('QuizPanel does NOT trigger onAdaptRequested for mastered', () => {
  const panel = makePanel();
  let called = false;
  panel.onAdaptRequested = () => { called = true; };

  panel.setQuestions(makeQuestions());
  panel.startAnswering();
  panel.submit();
  panel.setResult({ rating: 'mastered', score: 1.0, weak_concepts: [] });

  TestRunner.assert(!called, 'onAdaptRequested should NOT be called for mastered');
});

// ============================================
// Run (only when invoked directly, not via run_all.js)
// ============================================
module.exports = TestRunner;

if (require.main === module) {
  TestRunner.run().then(({ passed, failed }) => {
    if (failed > 0) process.exit(1);
  });
}
