/**
 * Quiz Shuffle — 选项渲染前随机化（quiz-distractor-quality / B 层防御）
 *
 * 背景（2026-08-05 全量统计）：存量题正确项位置强偏（复习卡 91.5% 在 0 位、
 * 章节 quiz 66% 在 B），模型不守"位置随机"的提示词约定。位置是结构问题，
 * 用代码保证：渲染前 shuffle 选项并 remap 正确答案，判分逻辑零改动。
 *
 * 两类题形：
 * - label 型（章节 quiz / 附加题）：options=[{label,text}]，correct="A".."D"
 * - index 型（复习卡）：options=[string]，answer=0..3
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.QuizShuffle = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

  /** Fisher-Yates；perm[newIdx] = oldIdx。rng 可注入（测试用确定性序列） */
  function shuffledIndices(n, rng) {
    const idx = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = idx[i];
      idx[i] = idx[j];
      idx[j] = tmp;
    }
    return idx;
  }

  /**
   * label 型单选题 shuffle：选项重排并重标 A..，correct remap 到新 label。
   * 非 single / 选项不足 / correct 找不到 → 原样返回（防御）。
   */
  function shuffleLabelQuestion(q, rng) {
    if (!q || q.qtype !== 'single' || !Array.isArray(q.options) || q.options.length < 2) {
      return q;
    }
    const oldCorrectIdx = q.options.findIndex((o) => o.label === q.correct);
    if (oldCorrectIdx < 0) return q;

    const perm = shuffledIndices(q.options.length, rng || Math.random);
    const options = perm.map((oldIdx, newIdx) => ({
      label: LETTERS[newIdx],
      text: q.options[oldIdx].text
    }));
    const correct = LETTERS[perm.indexOf(oldCorrectIdx)];
    const out = Object.assign({}, q, { options, correct });
    return out;
  }

  /**
   * index 型单选题 shuffle（复习卡）：options 重排，answer remap 到新下标。
   */
  function shuffleIndexQuestion(q, rng) {
    if (!q || !Array.isArray(q.options) || q.options.length < 2 || typeof q.answer !== 'number') {
      return q;
    }
    const perm = shuffledIndices(q.options.length, rng || Math.random);
    const options = perm.map((oldIdx) => q.options[oldIdx]);
    const answer = perm.indexOf(q.answer);
    return Object.assign({}, q, { options, answer });
  }

  /** 批量：章节 quiz / 附加题数组 */
  function shuffleLabelQuestions(questions, rng) {
    return (questions || []).map((q) => shuffleLabelQuestion(q, rng || Math.random));
  }

  /** 批量：复习卡 quiz_questions 数组 */
  function shuffleIndexQuestions(questions, rng) {
    return (questions || []).map((q) => shuffleIndexQuestion(q, rng || Math.random));
  }

  return {
    shuffleLabelQuestion,
    shuffleIndexQuestion,
    shuffleLabelQuestions,
    shuffleIndexQuestions
  };
});
