/**
 * TDD Tests for quiz-shuffle.js（选项 shuffle + 正确答案 remap）
 */

const TestRunner = require('../../shared/test-runner');
const QuizShuffle = require('../../../dist/scripts/quiz-shuffle');

// 确定性 rng：mulberry32
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LABEL_Q = {
  id: 'q1',
  qtype: 'single',
  question: 't',
  options: [
    { label: 'A', text: '正确项文本' },
    { label: 'B', text: '干扰一' },
    { label: 'C', text: '干扰二' },
    { label: 'D', text: '干扰三' }
  ],
  correct: 'A'
};

const INDEX_Q = {
  type: 'choice',
  question: 't',
  options: ['正确项文本', '干扰一', '干扰二', '干扰三'],
  answer: 0
};

// ============================================
// 不变量：正确项内容随走
// ============================================
TestRunner.test('label 型：shuffle 后 correct 指向原文本', () => {
  const s = QuizShuffle.shuffleLabelQuestion(LABEL_Q, mulberry32(7));
  const hit = s.options.find((o) => o.label === s.correct);
  TestRunner.assertEquals(hit.text, '正确项文本');
});

TestRunner.test('index 型：shuffle 后 answer 指向原文本', () => {
  const s = QuizShuffle.shuffleIndexQuestion(INDEX_Q, mulberry32(7));
  TestRunner.assertEquals(s.options[s.answer], '正确项文本');
});

TestRunner.test('label 型：选项文本是多选排列（不丢不重）', () => {
  const s = QuizShuffle.shuffleLabelQuestion(LABEL_Q, mulberry32(11));
  const texts = s.options.map((o) => o.text).sort().join('|');
  TestRunner.assertEquals(texts, ['正确项文本', '干扰一', '干扰二', '干扰三'].sort().join('|'));
});

TestRunner.test('label 型：label 重标为连续 A-D', () => {
  const s = QuizShuffle.shuffleLabelQuestion(LABEL_Q, mulberry32(11));
  TestRunner.assertEquals(s.options.map((o) => o.label).join(''), 'ABCD');
});

// ============================================
// 确定性与防御
// ============================================
TestRunner.test('同种子结果相同（可复现）', () => {
  const a = QuizShuffle.shuffleLabelQuestion(LABEL_Q, mulberry32(42));
  const b = QuizShuffle.shuffleLabelQuestion(LABEL_Q, mulberry32(42));
  TestRunner.assertEquals(JSON.stringify(a), JSON.stringify(b));
});

TestRunner.test('非 single 原样返回', () => {
  const q = { id: 'x', qtype: 'short', question: 'q', options: [], correct: null };
  TestRunner.assertEquals(QuizShuffle.shuffleLabelQuestion(q, mulberry32(1)), q);
});

TestRunner.test('correct 找不到原样返回（脏数据防御）', () => {
  const q = Object.assign({}, LABEL_Q, { correct: 'Z' });
  TestRunner.assertEquals(QuizShuffle.shuffleLabelQuestion(q, mulberry32(1)), q);
});

TestRunner.test('不修改入参（纯函数）', () => {
  const before = JSON.stringify(LABEL_Q);
  QuizShuffle.shuffleLabelQuestion(LABEL_Q, mulberry32(3));
  TestRunner.assertEquals(JSON.stringify(LABEL_Q), before);
});

// ============================================
// 位置偏差救回（存量 91.5% 在 0 位 → 洗匀）
// ============================================
TestRunner.test('200 次洗牌后正确项位置分布覆盖全部 4 位', () => {
  const dist = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (let seed = 1; seed <= 200; seed++) {
    const s = QuizShuffle.shuffleIndexQuestion(INDEX_Q, mulberry32(seed));
    dist[s.answer]++;
  }
  for (const k of Object.keys(dist)) {
    TestRunner.assertEquals(dist[k] > 20, true, 'position ' + k + ' underrepresented: ' + dist[k]);
  }
});

TestRunner.test('批量 shuffle：每题独立洗', () => {
  const qs = [LABEL_Q, Object.assign({}, LABEL_Q, { id: 'q2' })];
  const s = QuizShuffle.shuffleLabelQuestions(qs, mulberry32(5));
  TestRunner.assertEquals(s.length, 2);
  for (const q of s) {
    TestRunner.assertEquals(q.options.find((o) => o.label === q.correct).text, '正确项文本');
  }
});

TestRunner.run();
