/**
 * Mock Claude Agent SDK for testing
 * Returns predefined responses without calling real API
 *
 * Simulates the Phase D contract: for chapter-generation prompts the agent
 * uses its Write tool to create the .md file on disk (in options.cwd), then
 * returns a short confirmation string. The host (generateChapters) verifies
 * the file exists — so the mock must actually write it.
 */

const fs = require('fs');
const path = require('path');

const MOCK_OUTLINE = {
  chapters: [
    { title: '为什么学这个', duration_minutes: 10, concepts: ['动机', '应用场景'] },
    { title: '注意力机制的本质', duration_minutes: 25, concepts: ['注意力', '查询键值'] },
    { title: 'Self-Attention 详解', duration_minutes: 30, concepts: ['自注意力', '并行计算'] }
  ],
  total_duration: 65
};

const MOCK_CHAPTER_CONTENT = `# 为什么学这个

> [!concept] Transformer
> Transformer 是一种革命性的深度学习架构，彻底改变了自然语言处理领域。

本章将介绍学习 Transformer 的重要性。

> [!question] 为什么 Transformer 比 RNN 更好？
>
> > [!answer] 点击查看解释
> > 因为 Transformer 可以并行处理整个序列，而 RNN 必须逐个处理。

> [!quiz]
> 1. Transformer 的核心优势是什么？
>    - A. 更小的模型体积
>    - B. 并行处理整个序列 ✓
>    - C. 不需要训练数据

## 总结

Transformer 是当今最重要的深度学习架构之一。
`;

// Replicate agent-bridge.js generateFilename sanitization so the mock writes
// the same filename the host will look for.
function mockGenerateFilename(index, title) {
  const paddedIndex = String(index).padStart(2, '0');
  const safeTitle = title
    .replace(/[^一-龥a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${paddedIndex}-${safeTitle}.md`;
}

/**
 * Mock query function that simulates Agent SDK behavior
 */
async function* query({ prompt, options }) {
  // Simulate streaming delay
  await new Promise(r => setTimeout(r, 50));

  if (prompt.includes('设计学习大纲') || prompt.includes('学习设计师')) {
    // Plan stage: return JSON outline
    const jsonStr = JSON.stringify(MOCK_OUTLINE, null, 2);
    yield { type: 'assistant', message: { content: [{ type: 'text', text: jsonStr }] } };
    yield { type: 'result', subtype: 'success', result: jsonStr };
  } else if (prompt.includes('chapter-generation skill') || /chapter_index:\s*\d/.test(prompt)) {
    // Generate stage: simulate the agent using its Write tool to create the
    // .md file in options.cwd, then return a short confirmation.
    const idxMatch = prompt.match(/chapter_index:\s*(\d+)/);
    const titleMatch = prompt.match(/chapter_title:\s*(.*)$/m);
    const idx = idxMatch ? parseInt(idxMatch[1], 10) : 0;
    let title = '';
    if (titleMatch) {
      try { title = JSON.parse(titleMatch[1].trim()); }
      catch (_) { title = titleMatch[1].trim().replace(/^["']|["']$/g, ''); }
    }
    const cwd = (options && options.cwd) || '.';
    const filename = mockGenerateFilename(idx, title);
    const filepath = path.join(cwd, filename);
    try { fs.writeFileSync(filepath, MOCK_CHAPTER_CONTENT, 'utf-8'); } catch (_) {}
    const confirmation = `第 ${idx + 1} 章已生成: ${filename}`;
    yield { type: 'assistant', message: { content: [{ type: 'text', text: confirmation }] } };
    yield { type: 'result', subtype: 'success', result: confirmation };
  } else if (prompt.includes('生成') && prompt.includes('Markdown')) {
    // Legacy generate branch (kept for older callers)
    yield { type: 'assistant', message: { content: [{ type: 'text', text: MOCK_CHAPTER_CONTENT }] } };
    yield { type: 'result', subtype: 'success', result: MOCK_CHAPTER_CONTENT };
  } else {
    // Default fallback
    const fallback = '# Mock Content\n\nThis is a mock response.';
    yield { type: 'assistant', message: { content: [{ type: 'text', text: fallback }] } };
    yield { type: 'result', subtype: 'success', result: fallback };
  }
}

module.exports = { query };
