#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD: callout/GFM alert 内已渲染公式不得被拍平
 *
 * 复现的 bug（2026-10-12 用户实机截图）：
 *   课程章节 `> [!question]` 与下一行无空行 → CommonMark 合并为一个 <p>，
 *   管线顺序 initMathRendering → initObsidianCallouts，
 *   initObsidianCallouts 用 `firstP.textContent = firstP.textContent.replace(...)`
 *   删 marker —— textContent 重写把已渲染的 KaTeX DOM 拍平成纯文本。
 *   KaTeX 输出内部有三份文本（MathML 可见层 + <annotation> 原始 TeX +
 *   HTML fallback），拍平后三份全部可见 → 公式显示为「渲染+源码+渲染」三连。
 *   initGFMAlerts 有同样病灶。
 *
 * 测试策略：main.js 是巨型 IIFE 无法 require，按仓库先例
 * （tests/bdd-acceptance/annotation_notes.steps.js）花括号配对提取真实函数体
 * + eval；配合一个 textContent 语义忠实的 mini-DOM（getter 从子树派生、
 * setter 用单个文本节点替换全部子节点——正是拍平语义的来源）。
 *
 * 防「测试假绿」纪律：本测试先在未修复的 main.js 上跑红（旧代码走
 * textContent 重写路径，断言「标题不含原始 TeX」失败），再实现到绿。
 */

const fs = require('fs');
const path = require('path');
const TestRunner = require('../shared/test-runner');

const MAIN_JS = path.join(__dirname, '../../dist/scripts/main.js');

// ============================================
// 语义忠实的 mini-DOM（只实现被测函数用到的 API）
// ============================================

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

class MiniText {
  constructor(text) {
    this.nodeType = 3;
    this._text = String(text);
    this.parentNode = null;
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  get childNodes() { return []; }
  cloneNode() { return new MiniText(this._text); }
}

class MiniEl {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this._classes = new Set();
  }

  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] || null; }

  // 关键语义：与真实 DOM 一致——读 = 子树文本拼接；写 = 单文本节点替换全部子节点
  get textContent() { return this.children.map(c => c.textContent).join(''); }
  set textContent(v) {
    this.children.forEach(c => { c.parentNode = null; });
    const t = new MiniText(v);
    t.parentNode = this;
    this.children = [t];
  }

  appendChild(c) {
    if (c.parentNode) c.parentNode.children.splice(c.parentNode.children.indexOf(c), 1);
    c.parentNode = this;
    this.children.push(c);
    return c;
  }

  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.children.splice(c.parentNode.children.indexOf(c), 1);
    const i = this.children.indexOf(ref);
    this.children.splice(i < 0 ? this.children.length : i, 0, c);
    c.parentNode = this;
    return c;
  }

  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    if (i >= 0) this.parentNode.children.splice(i, 1);
    this.parentNode = null;
  }

  get classList() {
    const s = this._classes;
    return {
      add: (...cs) => cs.forEach(c => s.add(c)),
      contains: (c) => s.has(c),
      toggle: (c) => { s.has(c) ? s.delete(c) : s.add(c); }
    };
  }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this._classes].join(' '); }

  addEventListener() {}

  cloneNode(deep) {
    const c = new MiniEl(this.tagName);
    c.className = this.className;
    if (deep) this.children.forEach(ch => c.appendChild(ch.cloneNode(true)));
    return c;
  }

  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const out = [];
    const byClass = sel.startsWith('.');
    const want = byClass ? sel.slice(1) : sel.toUpperCase();
    const walk = (el) => {
      for (const c of el.children) {
        if (c.nodeType !== 1) continue;
        if (byClass ? c._classes.has(want) : c.tagName === want) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }

  get innerHTML() {
    return this.children.map(c => c.nodeType === 3
      ? escapeHTML(c._text)
      : `<${c.tagName.toLowerCase()}>${c.innerHTML}</${c.tagName.toLowerCase()}>`
    ).join('');
  }

  // 仅供旧代码路径（header.innerHTML = 两个 span）跑红用：解析扁平 span 标记
  set innerHTML(v) {
    this.children = [];
    const re = /<span class="([^"]+)">([\s\S]*?)<\/span>/g;
    let m, matched = false;
    while ((m = re.exec(v))) {
      matched = true;
      const sp = new MiniEl('span');
      sp.className = m[1];
      sp.textContent = m[2];
      this.appendChild(sp);
    }
    if (!matched && v) this.textContent = v;
  }
}

const miniDocument = { createElement: (tag) => new MiniEl(tag) };
const el = (tag, cls) => { const e = new MiniEl(tag); if (cls) e.className = cls; return e; };
const text = (t) => new MiniText(t);

/** 子树文本（跳过 .katex）——模拟「可见文本」：katex-mathml 的 annotation 本就该藏在子树里 */
function textExcludingKatex(node) {
  let out = '';
  for (const c of node.childNodes) {
    if (c.nodeType === 3) { out += c.textContent; continue; }
    if (c.classList && c.classList.contains('katex')) continue;
    out += textExcludingKatex(c);
  }
  return out;
}

/** 模拟 katex.renderToString 的输出结构：三层文本（MathML + annotation 原始 TeX + HTML） */
function fakeKatex(tex, rendered) {
  const k = el('span', 'katex');
  const mathml = el('span', 'katex-mathml');
  mathml.appendChild(text(rendered));
  mathml.appendChild(text(tex)); // <annotation> 里的原始 TeX
  const html = el('span', 'katex-html');
  html.appendChild(text(rendered));
  k.appendChild(mathml);
  k.appendChild(html);
  return k;
}

// ============================================
// 从 main.js 提取真实函数体并组装可执行环境
// ============================================

function extractFn(src, signature) {
  const start = src.indexOf(signature);
  if (start === -1) return '';
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return '';
}

function loadCalloutFns() {
  const src = fs.readFileSync(MAIN_JS, 'utf-8');
  const parts = [
    'function stripMarkerFromFirstTextNode(',
    'function stripLiteralEmphasisMarkers(',
    'function getCalloutMeta(',
    'function getAlertIcon(',
    'function initGFMAlerts(',
    'function initObsidianCallouts('
  ].map(sig => extractFn(src, sig));
  const missing = parts.filter(p => !p).length;
  const escapeHtmlShim = (s) => escapeHTML(s);
  const factory = new Function(
    'document', 'escapeHtml',
    parts.join('\n') + '\nreturn { initGFMAlerts, initObsidianCallouts };'
  );
  return { fns: factory(miniDocument, escapeHtmlShim), extractedAll: missing === 0, src };
}

// ============================================
// 场景构造（模拟 pulldown-cmark 输出 + KaTeX 已渲染的状态）
// ============================================

const TEX = '8\\times10^{17}\\ \\text{cm}^{-3}';
const RENDERED = '8×1017 cm−3';

/** 真实章节形态：`> [!question]` 与 `> **问题…$math$…**` 无空行 → 合并为一个 <p> */
function buildMergedQuestionCallout() {
  const bq = el('blockquote');
  const p = el('p');
  p.appendChild(text('[!question]'));
  const strong = el('strong');
  strong.appendChild(text('某 300 mm 单晶炉目前的氧含量是 '));
  const katex = fakeKatex(TEX, RENDERED);
  strong.appendChild(katex);
  strong.appendChild(text('，客户要求降到 '));
  strong.appendChild(fakeKatex('5' + TEX.slice(1), '5×1017 cm−3'));
  strong.appendChild(text(' 以下'));
  p.appendChild(strong);
  bq.appendChild(p);
  return { bq, katex };
}

// ============================================
// Tests
// ============================================

TestRunner.test('question callout（marker 与内容同段）：标题保留 KaTeX 元素，不出现原始 TeX', () => {
  const { fns } = loadCalloutFns();
  const { bq, katex } = buildMergedQuestionCallout();
  const root = el('div');
  root.appendChild(bq);

  fns.initObsidianCallouts(root);

  const titleEl = bq.querySelector('.obsidian-callout-title-text');
  TestRunner.assertExists(titleEl, '应生成 callout 标题');
  TestRunner.assert(
    titleEl.querySelector('.katex') === katex,
    '标题中的 KaTeX 元素应原样保留（节点身份不变，未被 textContent 拍平）'
  );
  TestRunner.assert(
    !textExcludingKatex(titleEl).includes('\\times'),
    '标题可见文本不应出现原始 TeX（出现 = MathML annotation 被拍平泄漏）'
  );
  TestRunner.assert(
    titleEl.textContent.includes('某 300 mm 单晶炉'),
    '标题应保留问题文本'
  );
  const headerEl = bq.querySelector('.obsidian-callout-title');
  TestRunner.assertExists(headerEl && headerEl.querySelector('.obsidian-callout-icon'), '应有图标');
});

TestRunner.test('question callout（marker 独占段 + 内容在第二段）：默认标题，正文 KaTeX 保留', () => {
  const { fns } = loadCalloutFns();
  const bq = el('blockquote');
  const p1 = el('p');
  p1.appendChild(text('[!question]'));
  const p2 = el('p');
  p2.appendChild(text('氧含量是 '));
  const katex = fakeKatex(TEX, RENDERED);
  p2.appendChild(katex);
  bq.appendChild(p1);
  bq.appendChild(p2);
  const root = el('div');
  root.appendChild(bq);

  fns.initObsidianCallouts(root);

  const titleEl = bq.querySelector('.obsidian-callout-title-text');
  TestRunner.assertEquals(titleEl.textContent, 'Question', 'marker 独占段时标题应为默认 Question');
  const body = bq.querySelector('.obsidian-callout-content');
  TestRunner.assertExists(body, '正文容器应存在');
  TestRunner.assert(body.querySelector('.katex') === katex, '正文 KaTeX 元素应原样保留');
});

TestRunner.test('嵌套 answer callout：折叠 + 标题「查看答案」+ 答案内 KaTeX 保留', () => {
  const { fns } = loadCalloutFns();
  const { bq } = buildMergedQuestionCallout();
  const nested = el('blockquote');
  const np1 = el('p');
  np1.appendChild(text('[!answer]- 查看答案'));
  const np2 = el('p');
  np2.appendChild(text('牵动：'));
  const katexG = fakeKatex('G', 'G');
  np2.appendChild(katexG);
  np2.appendChild(text(' 随之漂移'));
  nested.appendChild(np1);
  nested.appendChild(np2);
  bq.appendChild(nested);
  const root = el('div');
  root.appendChild(bq);

  fns.initObsidianCallouts(root);

  TestRunner.assert(nested.classList.contains('obsidian-callout-answer'), '嵌套块应识别为 answer');
  TestRunner.assert(nested.classList.contains('obsidian-callout-collapsed'), '`[!answer]-` 应默认折叠');
  const nTitle = nested.querySelector('.obsidian-callout-title-text');
  TestRunner.assertEquals(nTitle.textContent, '查看答案', '嵌套标题应为「查看答案」');
  const nBody = nested.querySelector('.obsidian-callout-content');
  TestRunner.assert(nBody && nBody.querySelector('.katex') === katexG, '答案内 KaTeX 元素应原样保留');
});

TestRunner.test('GFM alert [!NOTE]（marker 与公式同段）：marker 删除、KaTeX 保留、图标插入', () => {
  const { fns } = loadCalloutFns();
  const bq = el('blockquote');
  const p = el('p');
  p.appendChild(text('[!NOTE] 氧含量是 '));
  const katex = fakeKatex(TEX, RENDERED);
  p.appendChild(katex);
  bq.appendChild(p);
  const root = el('div');
  root.appendChild(bq);

  fns.initGFMAlerts(root);

  TestRunner.assert(bq.classList.contains('gfm-alert-note'), '应加 gfm-alert-note 类');
  TestRunner.assert(!p.textContent.includes('[!NOTE]'), 'marker 应被删除');
  TestRunner.assert(!textExcludingKatex(p).includes('\\times'), '可见文本不应出现原始 TeX');
  TestRunner.assert(p.querySelector('.katex') === katex, 'KaTeX 元素应原样保留');
  TestRunner.assert(
    p.firstChild && p.firstChild.classList && p.firstChild.classList.contains('gfm-alert-icon'),
    '图标应插到段首'
  );
});

TestRunner.test('标题字面 `**` 仍按契约剥除，但 .katex 子树内的 `*` 不动', () => {
  const { fns } = loadCalloutFns();
  const bq = el('blockquote');
  const p = el('p');
  p.appendChild(text('[!question] **加粗标题** '));
  const katex = fakeKatex('a^{*}b^{*}', 'a*b*');
  p.appendChild(katex);
  bq.appendChild(p);
  const root = el('div');
  root.appendChild(bq);

  fns.initObsidianCallouts(root);

  const titleEl = bq.querySelector('.obsidian-callout-title-text');
  TestRunner.assert(titleEl.textContent.includes('加粗标题'), '应保留标题文字');
  TestRunner.assert(!titleEl.textContent.includes('**'), '标题不应残留字面 **');
  const mathml = katex.querySelector('.katex-mathml');
  TestRunner.assert(
    mathml.textContent.includes('a^{*}b^{*}'),
    '.katex 子树内的 * 不得被标题剥除规则触碰'
  );
});

// ============================================
// TOC：同族只读变体（标题含公式时目录条目显示三连文本）
// ============================================

TestRunner.test('getHeadingVisibleText：含公式的标题只取可见渲染文本', () => {
  const { src } = loadCalloutFns();
  const helperSrc = extractFn(src, 'function getHeadingVisibleText(');
  TestRunner.assert(helperSrc !== '', 'main.js 应提供 getHeadingVisibleText（克隆标题并剥掉 .katex-mathml 隐藏层）');
  const helper = new Function('return ' + helperSrc)();

  const h2 = el('h2');
  h2.appendChild(text('氧含量控制与 '));
  h2.appendChild(fakeKatex(TEX, RENDERED));
  h2.appendChild(text(' 的关系'));

  const visible = helper(h2);
  TestRunner.assert(!visible.includes('\\times'), '目录文本不应含原始 TeX（annotation 泄漏）');
  TestRunner.assertEquals(visible, '氧含量控制与 ' + RENDERED + ' 的关系', '目录文本应为单层渲染文本');

  // 原文标题不受影响（只读场景，不得改动正文 DOM）
  TestRunner.assert(h2.querySelector('.katex'), '正文标题里的 KaTeX 元素不得被移除');
});

TestRunner.test('buildTOC 接线契约：经 getHeadingVisibleText 取文本，不直接读 heading.textContent', () => {
  const { src } = loadCalloutFns();
  const body = extractFn(src, 'function buildTOC(');
  TestRunner.assert(body !== '', '缺少 buildTOC 函数');
  TestRunner.assert(
    body.includes('getHeadingVisibleText('),
    'buildTOC 应通过 getHeadingVisibleText 取标题文本（否则含公式标题在目录里显示三连文本）'
  );
  TestRunner.assert(
    !body.includes('heading.textContent'),
    'buildTOC 不应直接读 heading.textContent（会把 KaTeX 三层文本拼进目录条目）'
  );
});

// ============================================

TestRunner.run().then(({ passed, failed }) => {
  if (failed > 0) process.exit(1);
});
