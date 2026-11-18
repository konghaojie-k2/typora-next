/**
 * Quiz Explanations — 小测提交后的逐题解析（Route B）
 *
 * 设计决策（2026-11-18）：
 * - 解析按需生成（提交后点「📖 解析」），缓存到 .learning/quizzes/，
 *   不动 quiz.json schema，存量项目立即可用；
 * - 正确答案/你的答案始终由本地数据渲染，AI 失败时仍可看正确答案；
 * - 纯函数 + UMD，便于 Node 单元测试与 BDD 验收复用。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.QuizExplanations = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  /** 章节文件名 → 解析缓存文件名（保留扩展名，避免同名不同章节冲突） */
  function cacheFileName(chapterFile) {
    const normalized = String(chapterFile || '').replace(/\\/g, '/');
    const base = normalized.split('/').pop().trim();
    return base ? base + '.explanations.json' : 'chapter.explanations.json';
  }

  function formatUserAnswer(userAnswer) {
    if (Array.isArray(userAnswer)) {
      return userAnswer.length ? userAnswer.join(', ') : '未作答';
    }
    if (userAnswer === null || userAnswer === undefined) return '未作答';
    const text = String(userAnswer).trim();
    return text === '' ? '未作答' : text;
  }

  function correctLabelsOf(question) {
    if (!question) return [];
    const correct = question.correct;
    if (Array.isArray(correct)) return correct.slice();
    if (typeof correct === 'string' && correct) return [correct];
    return [];
  }

  function correctTextOf(question, labels) {
    if (!question || !Array.isArray(question.options) || !labels.length) return null;
    const texts = labels
      .map((label) => {
        const option = question.options.find((o) => o && o.label === label);
        return option ? option.text : null;
      })
      .filter((t) => t !== null && t !== undefined && String(t).trim() !== '');
    return texts.length ? texts.join(' / ') : null;
  }

  /**
   * 把 answerRecords 与题目数据组装成可渲染条目。
   * 题目缺失时仍保留记录（至少能展示用户答案与对错）。
   */
  function buildItems(questions, answerRecords) {
    const qs = Array.isArray(questions) ? questions : [];
    const records = Array.isArray(answerRecords) ? answerRecords : [];
    return records.map((record) => {
      const question = qs.find((q) => q && q.id === record.question_id) || null;
      const labels = correctLabelsOf(question);
      return {
        questionId: record.question_id,
        qtype: record.qtype || (question && question.qtype) || 'unknown',
        question: question ? (question.question || '') : '',
        options: question && Array.isArray(question.options) ? question.options : [],
        correctLabel: labels.length === 1 ? labels[0] : (labels.length ? labels : null),
        correctText: correctTextOf(question, labels),
        userAnswer: record.user_answer,
        userAnswerText: formatUserAnswer(record.user_answer),
        isCorrect: record.is_correct === true ? true : record.is_correct === false ? false : null,
        explanation: null
      };
    });
  }

  /** 错题默认展开，对题/待定折叠（减少信息噪音） */
  function defaultExpanded(item) {
    return !!item && item.isCorrect === false;
  }

  /**
   * 合并 AI 解析：按 question_id 匹配，未知 id / 空白文本丢弃，不修改原数组。
   */
  function mergeExplanations(items, explanations) {
    const list = Array.isArray(items) ? items : [];
    const incoming = Array.isArray(explanations) ? explanations : [];
    const byId = new Map();
    incoming.forEach((entry) => {
      if (!entry || typeof entry.question_id !== 'string') return;
      const text = typeof entry.explanation === 'string' ? entry.explanation.trim() : '';
      if (!text || byId.has(entry.question_id)) return;
      byId.set(entry.question_id, text);
    });
    return list.map((item) =>
      Object.assign({}, item, { explanation: byId.get(item.questionId) || null })
    );
  }

  function missingExplanationCount(items) {
    return (Array.isArray(items) ? items : []).filter((item) => !item.explanation).length;
  }

  return {
    cacheFileName,
    formatUserAnswer,
    buildItems,
    defaultExpanded,
    mergeExplanations,
    missingExplanationCount
  };
});
