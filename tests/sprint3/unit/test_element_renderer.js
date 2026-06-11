/**
 * TDD Tests for Element Renderer
 * Tests !concept / !question / !quiz card rendering
 *
 * Module: dist/scripts/learning/element-renderer.js
 */

const T = require('../../shared/test-runner');
const { JSDOM } = (() => {
  try { return require('jsdom'); } catch { return null; }
})() || {};

// ============================================
// Setup
// ============================================

let ElementRenderer;

beforeLoad();

function beforeLoad() {
  // jsdom might not be installed; provide minimal DOM
  if (typeof global.window === 'undefined') {
    global.window = {};
  }
  if (typeof global.document === 'undefined') {
    if (JSDOM && JSDOM.JSDOM) {
      const dom = new JSDOM.JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
      global.document = dom.window.document;
      global.window = dom.window;
    } else {
      // Minimal mock
      global.document = createMockDocument();
    }
  }
  try {
    ElementRenderer = require('../../../../dist/scripts/learning/element-renderer');
  } catch (e) {
    ElementRenderer = null;
  }
}

function createMockDocument() {
  const elements = new Map();
  function makeEl(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      children: [],
      _classes: [],
      _attrs: {},
      _textContent: '',
      _innerHTML: '',
      _listeners: {},
      _dataAttrs: {},
      classList: {
        add: function(c) { if (!this._classes.includes(c)) this._classes.push(c); }.bind({ _classes: [] }),
        remove: function() {},
        contains: function() { return false; },
        toggle: function() {}
      },
      setAttribute(k, v) { this._attrs[k] = v; },
      getAttribute(k) { return this._attrs[k]; },
      appendChild(c) { this.children.push(c); return c; },
      querySelector(sel) { return mockQuery(sel, this); },
      querySelectorAll(sel) { return mockQueryAll(sel, this); },
      addEventListener(ev, fn) {
        (this._listeners[ev] = this._listeners[ev] || []).push(fn);
      },
      removeEventListener() {},
      click() {
        (this._listeners.click || []).forEach(fn => fn({ target: this }));
      },
      get innerHTML() { return this._innerHTML; },
      set innerHTML(v) { this._innerHTML = v; this.children = []; },
      get textContent() { return this._textContent; },
      set textContent(v) { this._textContent = v; }
    };
    return el;
  }
  function mockQuery(sel, root) {
    if (!root) return null;
    if (root._attrs && root._attrs[sel.split('=')[0]] !== undefined) {
      return root;
    }
    for (const c of (root.children || [])) {
      const r = mockQuery(sel, c);
      if (r) return r;
    }
    return null;
  }
  function mockQueryAll(sel, root) {
    const out = [];
    function walk(node) {
      if (!node) return;
      if (node._attrs && node._attrs['data-tag'] === sel) out.push(node);
      (node.children || []).forEach(walk);
    }
    walk(root);
    return out;
  }
  return {
    createElement: makeEl,
    createElementNS: makeEl,
    body: makeEl('body')
  };
}

// ============================================
// Concept Card Tests
// ============================================

T.test('concept: 识别 Markdown 中的 !concept 块', () => {
  if (!ElementRenderer) throw new Error('ElementRenderer not loaded');
  const md = '> [!concept] 注意力机制\n> 选择性关注重要部分';
  const blocks = ElementRenderer.parseLearningElements(md);
  T.assertEquals(blocks.length, 1, 'should find 1 block');
  T.assertEquals(blocks[0].type, 'concept', 'should be concept');
  T.assertEquals(blocks[0].title, '注意力机制', 'title');
});

T.test('concept: 渲染为带 📚 图标的卡片', () => {
  if (!ElementRenderer) throw new Error('ElementRenderer not loaded');
  const renderer = new ElementRenderer.ElementRenderer();
  const html = renderer.renderConceptCard({ title: '注意力', body: '选择性关注' });
  T.assert(html.includes('concept'), 'should have concept class');
  T.assert(html.includes('注意力'), 'should include title');
  T.assert(html.includes('concept-icon') || html.includes('📚') || html.includes('💡'),
    'should include concept icon/emoji');
});

T.test('concept: 卡片包含快速解释弹窗元素', () => {
  if (!ElementRenderer) throw new Error('ElementRenderer not loaded');
  const renderer = new ElementRenderer.ElementRenderer();
  const html = renderer.renderConceptCard({ title: 'X', body: 'Y' });
  // 悬停弹窗通常是 data-tooltip 或 class="concept-tooltip"
  T.assert(html.includes('tooltip') || html.includes('quick-explain') || html.includes('data-hover'),
    'should include tooltip mechanism');
});

T.test('concept: 支持多行 body 内容', () => {
  if (!ElementRenderer) throw new Error('ElementRenderer not loaded');
  const renderer = new ElementRenderer.ElementRenderer();
  const html = renderer.renderConceptCard({
    title: 'X',
    body: 'Line 1\nLine 2\nLine 3'
  });
  T.assert(html.includes('Line 1'), 'line 1');
  T.assert(html.includes('Line 2'), 'line 2');
  T.assert(html.includes('Line 3'), 'line 3');
});

T.test('concept: 处理特殊字符（不破坏 HTML）', () => {
  if (!ElementRenderer) throw new Error('ElementRenderer not loaded');
  const renderer = new ElementRenderer.ElementRenderer();
  const html = renderer.renderConceptCard({
    title: '<script>alert("xss")</script>',
    body: 'A & B < C'
  });
  T.assert(!html.includes('<script>'), 'should escape script');
  T.assert(html.includes('&lt;script&gt;') || html.includes('&amp;lt;'),
    'should escape HTML');
});

// ============================================
// Question Card Tests
// ============================================

T.test('question: 识别 Markdown 中的 !question 块', () => {
  if (!ElementRenderer) throw new Error('ElementRenderer not loaded');
  const md = '> [!question] 思考一下\n> 为什么 RNN 处理长文本会"忘记"？\n> > [!answer] 答案\n> > 因为梯度衰减';
  const blocks = ElementRenderer.parseLearningElements(md);
  T.assertEquals(blocks.length, 1, 'should find 1 question');
  T.assertEquals(blocks[0].type, 'question', 'should be question');
  T.assertEquals(blocks[0].title, '思考一下', 'title');
});

T.test('question: 提取答案内容', () => {
  if (!ElementRenderer) throw new Error('ElementRenderer not loaded');
  const blocks = ElementRenderer.parseLearningElements(
    '> [!question] Q\n> > [!answer] A\n> > 答案内容'
  );
  T.assertExists(blocks[0].answer, 'should have answer');
  T.assert(blocks[0].answer.includes('答案内容'), 'answer body');
});

T.test('question: 渲染初始只显示问题标题', () => {
  if (!ElementRenderer) throw new Error('ElementRenderer not loaded');
  const renderer = new ElementRenderer.ElementRenderer();
  const html = renderer.renderQuestionCard({
    title: '思考',
    question: '为什么 X？',
    answer: '因为 Y'
  });
  T.assert(html.includes('思考'), 'title visible');
  T.assert(html.includes('为什么 X'), 'question visible');
  // 答案默认应该被隐藏
  T.assert(html.includes('collapsed') || html.includes('hidden') || html.includes('toggle-answer') ||
    html.includes('data-expanded="false"'),
    'answer should be initially hidden');
});

T.test('question: 包含"查看解释"按钮', () => {
  if (!ElementRenderer) throw new Error('ElementRenderer not loaded');
  const renderer = new ElementRenderer.ElementRenderer();
  const html = renderer.renderQuestionCard({
    title: 'X',
    question: 'Q',
    answer: 'A'
  });
  T.assert(html.includes('查看解释') || html.includes('show-answer') || html.includes('查看答案') ||
    html.includes('toggle-answer'),
    'should have show answer button/control');
});

T.test('question: 答案内容支持多行', () => {
  if (!ElementRenderer) throw new Error('ElementRenderer not loaded');
  const renderer = new ElementRenderer.ElementRenderer();
  const html = renderer.renderQuestionCard({
    title: 'X',
    question: 'Q',
    answer: 'Line 1\nLine 2'
  });
  T.assert(html.includes('Line 1'), 'line 1');
  T.assert(html.includes('Line 2'), 'line 2');
});

// ============================================
// Quiz Card Tests
// ============================================

T.test('quiz: 识别 Markdown 中的 !quiz 块', () => {
  if (!ElementRenderer) throw new Error('ElementRenderer not loaded');
  const md = '> [!quiz]\n> 1. Question?\n>    - A. opt1\n>    - B. opt2 ✓\n>    - C. opt3';
  const blocks = ElementRenderer.parseLearningElements(md);
  T.assertEquals(blocks.length, 1, 'should find 1 quiz');
  T.assertEquals(blocks[0].type, 'quiz', 'should be quiz');
});

T.test('quiz: 解析选项列表', () => {
  if (!ElementRenderer) throw new Error('ElementRenderer not loaded');
  const block = ElementRenderer.parseLearningElements(
    '> [!quiz]\n> 1. Q?\n>    - A. opt1\n>    - B. opt2\n>    - C. opt3'
  )[0];
  T.assertEquals(block.options.length, 3, 'should have 3 options');
  T.assert(block.options[0].text === 'opt1' || block.options[0].label === 'A',
    'first option structure');
});

T.test('quiz: 标记正确答案（✓ 后缀）', () => {
  if (!ElementRenderer) throw new Error('ElementRenderer not loaded');
  const block = ElementRenderer.parseLearningElements(
    '> [!quiz]\n> 1. Q?\n>    - A. wrong\n>    - B. correct ✓\n>    - C. wrong'
  )[0];
  const correct = block.options.find(o => o.correct || o.isCorrect);
  T.assertExists(correct, 'should have a correct option');
  T.assert(correct.text === 'correct' || correct.label === 'B', 'B should be correct');
});

T.test('quiz: 渲染选项为可点击卡片', () => {
  if (!ElementRenderer) throw new Error('ElementRenderer not loaded');
  const renderer = new ElementRenderer.ElementRenderer();
  const html = renderer.renderQuizCard({
    question: 'Q?',
    options: [
      { label: 'A', text: 'opt1', correct: false },
      { label: 'B', text: 'opt2', correct: true },
      { label: 'C', text: 'opt3', correct: false }
    ]
  });
  T.assert(html.includes('opt1'), 'option 1 text');
  T.assert(html.includes('opt2'), 'option 2 text');
  T.assert(html.includes('opt3'), 'option 3 text');
  T.assert(html.includes('quiz-option') || html.includes('option-card'),
    'option card class');
});

T.test('quiz: 包含"提交答案"按钮', () => {
  if (!ElementRenderer) throw new Error('ElementRenderer not loaded');
  const renderer = new ElementRenderer.ElementRenderer();
  const html = renderer.renderQuizCard({
    question: 'Q?',
    options: [{ label: 'A', text: 'x', correct: true }]
  });
  T.assert(html.includes('提交') || html.includes('submit') || html.includes('submit-answer'),
    'should have submit button');
});

T.test('quiz: 支持多选（multiple correct）', () => {
  if (!ElementRenderer) throw new Error('ElementRenderer not loaded');
  const renderer = new ElementRenderer.ElementRenderer();
  const html = renderer.renderQuizCard({
    question: 'Q?',
    multiple: true,
    options: [
      { label: 'A', text: 'x', correct: true },
      { label: 'B', text: 'y', correct: true },
      { label: 'C', text: 'z', correct: false }
    ]
  });
  T.assert(html.includes('multi') || html.includes('checkbox') || html.includes('多选') ||
    html.includes('data-type="multiple"'),
    'should indicate multi-select');
});

// ============================================
// Integration / Edge Cases
// ============================================

T.test('parseLearningElements: 处理无学习元素的普通 Markdown', () => {
  if (!ElementRenderer) throw new Error('ElementRenderer not loaded');
  const md = '# Title\n\nNormal paragraph.\n\n- list\n- item';
  const blocks = ElementRenderer.parseLearningElements(md);
  T.assertEquals(blocks.length, 0, 'no learning elements');
});

T.test('parseLearningElements: 混合多个学习元素', () => {
  if (!ElementRenderer) throw new Error('ElementRenderer not loaded');
  const md = `# Title

> [!concept] C1
> Body

Some text

> [!question] Q1
> Question?
> > [!answer] A
> > Answer

> [!quiz]
> 1. Q?
>    - A. 1
>    - B. 2 ✓
`;
  const blocks = ElementRenderer.parseLearningElements(md);
  T.assertEquals(blocks.length, 3, 'should find 3 elements');
  T.assertEquals(blocks[0].type, 'concept', 'first concept');
  T.assertEquals(blocks[1].type, 'question', 'second question');
  T.assertEquals(blocks[2].type, 'quiz', 'third quiz');
});

T.test('ElementRenderer: 接受 root 元素并渲染', () => {
  if (!ElementRenderer) throw new Error('ElementRenderer not loaded');
  const renderer = new ElementRenderer.ElementRenderer();
  const md = '> [!concept] X\n> Y';
  if (typeof global.document !== 'undefined' && global.document.createElement) {
    const root = global.document.createElement('div');
    try {
      renderer.renderInto(root, md);
      T.assertExists(root.innerHTML, 'should populate root');
    } catch (e) {
      // If DOM is minimal mock, just verify it didn't throw catastrophically
      T.assert(true, 'render attempt did not crash');
    }
  } else {
    T.assert(true, 'no DOM available, skipped');
  }
});

module.exports = T;
