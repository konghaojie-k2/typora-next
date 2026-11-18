#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD: quiz explanation panel item building / merging (Sprint 33).
 *
 * Pure module under test: dist/scripts/learning/quiz-explanations.js
 * Route B: explanations are generated on demand after submission and cached;
 * the panel must always render correct answers locally even when AI fails.
 */

const TestRunner = require('../shared/test-runner');
const QuizExplanations = require('../../dist/scripts/learning/quiz-explanations');

const assert = TestRunner.assert.bind(TestRunner);
const assertEquals = TestRunner.assertEquals.bind(TestRunner);
const test = TestRunner.test.bind(TestRunner);

function single(id, correctText, extraOptions) {
  return {
    id,
    qtype: 'single',
    question: `题干 ${id}`,
    options: [
      { label: 'A', text: correctText },
      ...(extraOptions || [{ label: 'B', text: '干扰项' }, { label: 'C', text: '干扰项 2' }])
    ],
    correct: 'A',
    weak_concepts: []
  };
}

function rec(id, userAnswer, isCorrect, qtype) {
  return {
    question_id: id,
    qtype: qtype || 'single',
    user_answer: userAnswer,
    is_correct: isCorrect
  };
}

// ============================================
// buildItems
// ============================================

test('buildItems 按 answerRecords 顺序产出条目', () => {
  const items = QuizExplanations.buildItems(
    [single('q1', '甲'), single('q2', '乙')],
    [rec('q2', 'A', true), rec('q1', 'B', false)]
  );
  assertEquals(items.length, 2, '两条记录');
  assertEquals(items[0].questionId, 'q2', '顺序跟随 answerRecords');
  assertEquals(items[1].questionId, 'q1', '顺序跟随 answerRecords');
});

test('buildItems 解析单选正确答案文本', () => {
  const items = QuizExplanations.buildItems([single('q1', '甲')], [rec('q1', 'B', false)]);
  assertEquals(items[0].correctLabel, 'A', 'correct label');
  assertEquals(items[0].correctText, '甲', 'correct text');
  assertEquals(items[0].userAnswer, 'B', 'user answer');
  assertEquals(items[0].userAnswerText, 'B', 'user answer text');
});

test('buildItems 解析多选正确答案文本', () => {
  const q = {
    id: 'q1',
    qtype: 'multiple',
    question: '多选',
    options: [
      { label: 'A', text: '甲' },
      { label: 'B', text: '乙' },
      { label: 'C', text: '丙' }
    ],
    correct: ['A', 'C'],
    weak_concepts: []
  };
  const items = QuizExplanations.buildItems([q], [rec('q1', ['A', 'B'], false, 'multiple')]);
  assertEquals(items[0].correctText, '甲 / 丙', '多选正确答案拼接');
  assertEquals(items[0].userAnswerText, 'A, B', '多选用户答案拼接');
});

test('buildItems 对未作答记录输出未作答', () => {
  const items = QuizExplanations.buildItems([single('q1', '甲')], [rec('q1', null, null)]);
  assertEquals(items[0].userAnswerText, '未作答', 'null 视为未作答');
  assertEquals(items[0].isCorrect, null, '待定保持 null');
});

test('buildItems 容忍题目缺失的记录', () => {
  const items = QuizExplanations.buildItems([], [rec('ghost', 'A', false)]);
  assertEquals(items.length, 1, '记录仍保留');
  assertEquals(items[0].correctText, null, '缺失题目时无正确答案');
  assertEquals(items[0].userAnswerText, 'A', '用户答案仍可展示');
});

test('buildItems 忽略未知 qtype 的 correct 解析错误', () => {
  const items = QuizExplanations.buildItems(
    [{ id: 'q1', qtype: 'short', question: '开放题', options: [], correct: null }],
    [rec('q1', '自由回答', null, 'short')]
  );
  assertEquals(items[0].correctText, null, '开放题无正确选项');
  assertEquals(items[0].userAnswerText, '自由回答', '开放题保留文字答案');
});

// ============================================
// defaultExpanded
// ============================================

test('defaultExpanded 仅错题默认展开', () => {
  const items = QuizExplanations.buildItems(
    [single('q1', '甲'), single('q2', '乙'), single('q3', '丙')],
    [rec('q1', 'B', false), rec('q2', 'A', true), rec('q3', null, null)]
  );
  assert(QuizExplanations.defaultExpanded(items[0]), '错题展开');
  assert(!QuizExplanations.defaultExpanded(items[1]), '对题折叠');
  assert(!QuizExplanations.defaultExpanded(items[2]), '待定折叠');
});

// ============================================
// mergeExplanations
// ============================================

test('mergeExplanations 按 question_id 合并', () => {
  const items = QuizExplanations.buildItems(
    [single('q1', '甲'), single('q2', '乙')],
    [rec('q1', 'B', false), rec('q2', 'A', true)]
  );
  const merged = QuizExplanations.mergeExplanations(items, [
    { question_id: 'q1', explanation: '解析一' },
    { question_id: 'q2', explanation: '解析二' }
  ]);
  assertEquals(merged[0].explanation, '解析一', 'q1 解析');
  assertEquals(merged[1].explanation, '解析二', 'q2 解析');
});

test('mergeExplanations 丢弃未知 id 与空解析', () => {
  const items = QuizExplanations.buildItems([single('q1', '甲')], [rec('q1', 'B', false)]);
  const merged = QuizExplanations.mergeExplanations(items, [
    { question_id: 'q404', explanation: '不该出现' },
    { question_id: 'q1', explanation: '   ' }
  ]);
  assertEquals(merged.length, 1, '条目不增不减');
  assertEquals(merged[0].explanation, null, '空白解析视为缺失');
});

test('mergeExplanations 不修改原数组', () => {
  const items = QuizExplanations.buildItems([single('q1', '甲')], [rec('q1', 'B', false)]);
  QuizExplanations.mergeExplanations(items, [{ question_id: 'q1', explanation: '解析' }]);
  assertEquals(items[0].explanation, null, '原条目保持未合并状态');
});

test('missingExplanationCount 统计缺失数量', () => {
  const items = QuizExplanations.buildItems(
    [single('q1', '甲'), single('q2', '乙')],
    [rec('q1', 'B', false), rec('q2', 'A', true)]
  );
  assertEquals(QuizExplanations.missingExplanationCount(items), 2, '初始两条都缺');
  const merged = QuizExplanations.mergeExplanations(items, [{ question_id: 'q1', explanation: '解析' }]);
  assertEquals(QuizExplanations.missingExplanationCount(merged), 1, '合并后剩一条缺失');
});

// ============================================
// cacheFileName
// ============================================

test('cacheFileName 保留章节名并加解释后缀', () => {
  assertEquals(
    QuizExplanations.cacheFileName('03-mechanics.md'),
    '03-mechanics.md.explanations.json',
    '普通文件名'
  );
  assertEquals(
    QuizExplanations.cacheFileName('/a/b/04-wave.md'),
    '04-wave.md.explanations.json',
    '去掉目录'
  );
  assertEquals(
    QuizExplanations.cacheFileName('C:\\course\\05-optics.md'),
    '05-optics.md.explanations.json',
    '兼容反斜杠路径'
  );
});

// ============================================
// 运行
// ============================================

TestRunner.run().then(({ failed }) => {
  if (failed > 0) process.exit(1);
});
