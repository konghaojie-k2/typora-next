/**
 * Explain Conversation
 *
 * Pure functions for AI explanation workflow:
 * - buildExplainPrompt:  构建带上下文的 LLM prompt
 * - parseExplainResponse: 解析 LLM JSON 响应，含降级逻辑
 * - computeConceptHash:  概念 hash（大小写/空格不敏感）
 *
 * Sprint 6 PB1: 用户选中文字得到有上下文的解释 + 推荐追问
 */

(function() {
  'use strict';

  // Node.js compatibility
  if (typeof window === 'undefined') {
    global.window = {};
  }

  const MAX_TEXT_LENGTH = 200;
  const MAX_EXPLANATION_LENGTH = 500;
  const MAX_QUESTIONS = 4;

  // 硬编码追问模板（LLM 响应降级时使用）
  const FALLBACK_QUESTIONS = [
    '这是什么意思？',
    '举个例子',
    '有什么应用场景？',
    '需要注意什么陷阱？'
  ];

  // ============================================
  // buildExplainPrompt
  // ============================================

  /**
   * 构建带上下文的 LLM prompt
   * @param {string} text - 用户选中的文字
   * @param {object} context - { courseGoal?: string, chapterTitle?: string }
   * @param {string[]} learnedConcepts - 已掌握的概念列表
   * @param {Array<{q:string,a:string}>} previousQA - 之前的对话历史
   * @returns {string} prompt
   */
  function buildExplainPrompt(text, context, learnedConcepts, previousQA) {
    // 截断 text
    let truncatedText = String(text || '');
    if (truncatedText.length > MAX_TEXT_LENGTH) {
      truncatedText = truncatedText.substring(0, MAX_TEXT_LENGTH);
    }

    const parts = [];

    // 课程目标
    if (context && context.courseGoal) {
      parts.push('课程目标：' + context.courseGoal);
    }

    // 章节标题
    if (context && context.chapterTitle) {
      parts.push('当前章节：' + context.chapterTitle);
    }

    // 已掌握概念
    if (learnedConcepts && learnedConcepts.length > 0) {
      parts.push('用户已掌握：' + learnedConcepts.join('、'));
    }

    // 之前的对话
    if (previousQA && previousQA.length > 0) {
      parts.push('之前的对话：');
      previousQA.forEach(function(qa, i) {
        parts.push('  Q' + (i + 1) + ': ' + qa.q);
        parts.push('  A' + (i + 1) + ': ' + qa.a);
      });
    }

    // 核心请求
    parts.push('');
    parts.push('请解释以下概念，用生活化类比，300 字以内，深入浅出。');
    parts.push('同时给出 3-4 个用户可能想追问的问题（作为 JSON 数组）。');
    parts.push('');
    parts.push('返回格式（合法 JSON）：');
    parts.push('{"explanation": "...", "suggestedQuestions": ["...", "...", "...", "..."]}');
    parts.push('');
    parts.push('概念：' + truncatedText);

    return parts.join('\n');
  }

  // ============================================
  // parseExplainResponse
  // ============================================

  /**
   * 解析 LLM JSON 响应，含降级逻辑
   * @param {string} llmOutput - LLM 返回的原始字符串
   * @returns {{explanation: string, suggestedQuestions: string[], degraded?: boolean, error?: string}}
   */
  function parseExplainResponse(llmOutput) {
    if (!llmOutput || typeof llmOutput !== 'string') {
      return {
        explanation: '',
        suggestedQuestions: FALLBACK_QUESTIONS.slice(),
        degraded: true,
        error: 'LLM output is empty or not a string'
      };
    }

    // 尝试解析 JSON
    let parsed;
    try {
      parsed = JSON.parse(llmOutput);
    } catch (e) {
      // 非 JSON：降级为纯文本 + 硬编码追问
      return {
        explanation: llmOutput,
        suggestedQuestions: FALLBACK_QUESTIONS.slice(),
        degraded: true,
        error: 'LLM response is not valid JSON'
      };
    }

    // 提取 explanation（含省略号共 MAX_EXPLANATION_LENGTH）
    let explanation = parsed.explanation || '';
    if (explanation.length > MAX_EXPLANATION_LENGTH) {
      explanation = explanation.substring(0, MAX_EXPLANATION_LENGTH - 1) + '…';
    }

    // 提取 suggestedQuestions
    let questions = Array.isArray(parsed.suggestedQuestions) ? parsed.suggestedQuestions : [];
    if (questions.length === 0) {
      questions = FALLBACK_QUESTIONS.slice();
    }
    if (questions.length > MAX_QUESTIONS) {
      questions = questions.slice(0, MAX_QUESTIONS);
    }

    return {
      explanation: explanation,
      suggestedQuestions: questions
    };
  }

  // ============================================
  // computeConceptHash
  // ============================================

  /**
   * 计算概念 hash（大小写不敏感，空格归一化）
   * @param {string} text
   * @returns {string} 16 位 hex hash
   */
  function computeConceptHash(text) {
    if (!text) return '';
    var normalized = String(text).toLowerCase().trim().replace(/\s+/g, ' ');
    // 简单 hash：用字符串的 charCodeAt 累加（非加密，仅用于去重）
    var hash = 0;
    for (var i = 0; i < normalized.length; i++) {
      var ch = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + ch;
      hash = hash & hash; // Convert to 32bit integer
    }
    // 转为 16 位 hex
    return ('0000000000000000' + (hash >>> 0).toString(16)).slice(-16);
  }

  // ============================================
  // Exports
  // ============================================

  window.ExplainConversation = {
    buildExplainPrompt: buildExplainPrompt,
    parseExplainResponse: parseExplainResponse,
    computeConceptHash: computeConceptHash,
    MAX_TEXT_LENGTH: MAX_TEXT_LENGTH,
    MAX_EXPLANATION_LENGTH: MAX_EXPLANATION_LENGTH,
    MAX_QUESTIONS: MAX_QUESTIONS,
    FALLBACK_QUESTIONS: FALLBACK_QUESTIONS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      buildExplainPrompt: buildExplainPrompt,
      parseExplainResponse: parseExplainResponse,
      computeConceptHash: computeConceptHash,
      MAX_TEXT_LENGTH: MAX_TEXT_LENGTH,
      MAX_EXPLANATION_LENGTH: MAX_EXPLANATION_LENGTH,
      MAX_QUESTIONS: MAX_QUESTIONS,
      FALLBACK_QUESTIONS: FALLBACK_QUESTIONS
    };
  }
})();
