#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for Explain Conversation — Sprint 6 PB1
 *
 * 纯函数模块：dist/scripts/explain-conversation.js
 * 尚未实现，当前应全部失败（Red phase）
 *
 * 函数清单：
 * - buildExplainPrompt(text, context, learnedConcepts, previousQA)
 * - parseExplainResponse(llmOutput) → {explanation, suggestedQuestions}
 * - computeConceptHash(text) → string
 */

const TestRunner = require('../../shared/test-runner');

// ============================================
// Mock: require the module (to be implemented)
// ============================================
function getModule() {
  try {
    return require('../../../dist/scripts/explain-conversation');
  } catch (e) {
    // Module not yet implemented — return null so tests fail with clear message
    return null;
  }
}

// ============================================
// buildExplainPrompt tests
// ============================================

TestRunner.test('buildExplainPrompt_normal: 完整参数生成 prompt 包含所有字段', () => {
  const mod = getModule();
  if (!mod) throw new Error('explain-conversation.js 尚未实现');
  const prompt = mod.buildExplainPrompt(
    '位置编码',
    { courseGoal: '理解 Transformer', chapterTitle: '位置编码' },
    ['注意力', 'Self-Attention'],
    []
  );
  TestRunner.assert(typeof prompt === 'string', 'prompt 应为字符串');
  TestRunner.assert(prompt.includes('位置编码'), 'prompt 应包含选中文字');
  TestRunner.assert(prompt.includes('理解 Transformer'), 'prompt 应包含课程目标');
  TestRunner.assert(prompt.includes('位置编码'), 'prompt 应包含章节标题');
  TestRunner.assert(prompt.includes('注意力'), 'prompt 应包含已掌握概念');
});

TestRunner.test('buildExplainPrompt_no_goal: 缺 courseGoal 时优雅降级', () => {
  const mod = getModule();
  if (!mod) throw new Error('explain-conversation.js 尚未实现');
  const prompt = mod.buildExplainPrompt(
    '位置编码',
    { chapterTitle: '位置编码' },
    [],
    []
  );
  TestRunner.assert(typeof prompt === 'string', 'prompt 应为字符串');
  TestRunner.assert(prompt.length > 0, 'prompt 不应为空');
  // 不应抛异常
});

TestRunner.test('buildExplainPrompt_no_concepts: 缺 learnedConcepts 时跳过', () => {
  const mod = getModule();
  if (!mod) throw new Error('explain-conversation.js 尚未实现');
  const prompt = mod.buildExplainPrompt(
    '位置编码',
    { courseGoal: '理解 Transformer', chapterTitle: '位置编码' },
    null,
    []
  );
  TestRunner.assert(typeof prompt === 'string', 'prompt 应为字符串');
  TestRunner.assert(prompt.length > 0, 'prompt 不应为空');
});

TestRunner.test('buildExplainPrompt_with_previous_qa: previousQA 拼接到 prompt', () => {
  const mod = getModule();
  if (!mod) throw new Error('explain-conversation.js 尚未实现');
  const prompt = mod.buildExplainPrompt(
    '和词嵌入区别？',
    { courseGoal: '理解 Transformer', chapterTitle: '位置编码' },
    [],
    [{ q: '位置编码是什么', a: '给每个 token 加位置向量' }]
  );
  TestRunner.assert(prompt.includes('位置编码是什么'), 'prompt 应包含 previousQA 的 q');
  TestRunner.assert(prompt.includes('给每个 token 加位置向量'), 'prompt 应包含 previousQA 的 a');
});

TestRunner.test('buildExplainPrompt_truncate_text: 文本超 200 字截断', () => {
  const mod = getModule();
  if (!mod) throw new Error('explain-conversation.js 尚未实现');
  const longText = 'x'.repeat(300);
  const prompt = mod.buildExplainPrompt(
    longText,
    { courseGoal: 'test', chapterTitle: 'test' },
    [],
    []
  );
  // prompt 中的 text 部分应被截断到 200 字以内
  TestRunner.assert(typeof prompt === 'string', 'prompt 应为字符串');
});

// ============================================
// parseExplainResponse tests
// ============================================

TestRunner.test('parseExplainResponse_legal_json: 合法 JSON 解析出 explanation + suggestedQuestions', () => {
  const mod = getModule();
  if (!mod) throw new Error('explain-conversation.js 尚未实现');
  const result = mod.parseExplainResponse(JSON.stringify({
    explanation: '位置编码给每个 token 加位置向量...',
    suggestedQuestions: ['为啥用正弦？', '和词嵌入区别？', '代码示例']
  }));
  TestRunner.assertEquals(result.explanation, '位置编码给每个 token 加位置向量...', 'explanation 应匹配');
  TestRunner.assert(Array.isArray(result.suggestedQuestions), 'suggestedQuestions 应为数组');
  TestRunner.assertEquals(result.suggestedQuestions.length, 3, '应有 3 个追问');
});

TestRunner.test('parseExplainResponse_missing_suggested: JSON 缺 suggestedQuestions 字段降级', () => {
  const mod = getModule();
  if (!mod) throw new Error('explain-conversation.js 尚未实现');
  const result = mod.parseExplainResponse(JSON.stringify({
    explanation: '位置编码给每个 token 加位置向量...'
  }));
  TestRunner.assert(result.explanation.length > 0, 'explanation 应存在');
  TestRunner.assert(Array.isArray(result.suggestedQuestions), 'suggestedQuestions 应为数组');
  // BDD 场景: "降级为硬编码模板数组"
  TestRunner.assert(result.suggestedQuestions.length > 0, '降级后应有硬编码追问模板');
});

TestRunner.test('parseExplainResponse_illegal_json: 非 JSON 返回 explanation + 空数组 + 错误标记', () => {
  const mod = getModule();
  if (!mod) throw new Error('explain-conversation.js 尚未实现');
  const result = mod.parseExplainResponse('This is not JSON');
  TestRunner.assertEquals(result.explanation, 'This is not JSON', 'explanation 应为原始文本');
  TestRunner.assert(Array.isArray(result.suggestedQuestions), 'suggestedQuestions 应为数组');
  TestRunner.assert(result.degraded === true || result.error, '应标记为降级');
});

TestRunner.test('parseExplainResponse_truncate_explanation: explanation 超 500 字截断', () => {
  const mod = getModule();
  if (!mod) throw new Error('explain-conversation.js 尚未实现');
  const longExplanation = 'x'.repeat(600);
  const result = mod.parseExplainResponse(JSON.stringify({
    explanation: longExplanation,
    suggestedQuestions: []
  }));
  TestRunner.assert(result.explanation.length <= 500, `explanation 应截断到 500 字以内，实际 ${result.explanation.length}`);
});

TestRunner.test('parseExplainResponse_truncate_questions: suggestedQuestions 超 4 截断', () => {
  const mod = getModule();
  if (!mod) throw new Error('explain-conversation.js 尚未实现');
  const result = mod.parseExplainResponse(JSON.stringify({
    explanation: 'test',
    suggestedQuestions: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']
  }));
  TestRunner.assert(result.suggestedQuestions.length <= 4, `suggestedQuestions 应截断到 4 个，实际 ${result.suggestedQuestions.length}`);
});

// ============================================
// computeConceptHash tests
// ============================================

TestRunner.test('computeConceptHash_same_text: 同文本 hash 一致', () => {
  const mod = getModule();
  if (!mod) throw new Error('explain-conversation.js 尚未实现');
  const h1 = mod.computeConceptHash('位置编码');
  const h2 = mod.computeConceptHash('位置编码');
  TestRunner.assertEquals(h1, h2, '同文本 hash 应一致');
});

TestRunner.test('computeConceptHash_whitespace_normalized: 前后空格不影响', () => {
  const mod = getModule();
  if (!mod) throw new Error('explain-conversation.js 尚未实现');
  const h1 = mod.computeConceptHash('位置编码');
  const h2 = mod.computeConceptHash('  位置编码  ');
  TestRunner.assertEquals(h1, h2, '空格不影响 hash');
});

TestRunner.test('computeConceptHash_case_insensitive: 大小写不敏感', () => {
  const mod = getModule();
  if (!mod) throw new Error('explain-conversation.js 尚未实现');
  const h1 = mod.computeConceptHash('Transformer');
  const h2 = mod.computeConceptHash('transformer');
  TestRunner.assertEquals(h1, h2, '大小写不影响 hash');
});

TestRunner.run();
