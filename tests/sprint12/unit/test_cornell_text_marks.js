#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for cornell-text-marks.js (康奈尔划词痕迹)
 *
 * The real module is required (dual-export). Range location strategy is
 * INJECTED (deps.locate) because mock DOMs have no TreeWalker/createRange;
 * the browser default TreeWalker locator is covered by manual acceptance.
 */

const TestRunner = require('../../shared/test-runner');
const Marks = require('../../../dist/scripts/learning/cornell-text-marks.js');

// ============================================
// Minimal fake DOM
// ============================================
function makeText(value) {
  const node = {
    _isText: true,
    nodeValue: value,
    _parent: null,
    get parentNode() { return node._parent; },
    get parentElement() { return node._parent; }
  };
  return node;
}

function createEl(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    _attrs: {},
    _classes: [],
    _listeners: {},
    _children: [],
    _parent: null,
    style: {},
    _text: '',
    offsetWidth: 0,

    classList: {
      add(c) { if (!el._classes.includes(c)) el._classes.push(c); },
      remove(c) { el._classes = el._classes.filter(x => x !== c); },
      contains(c) { return el._classes.includes(c); }
    },

    get className() { return el._classes.join(' '); },
    set className(v) { el._classes = String(v).split(/\s+/).filter(Boolean); },

    setAttribute(k, v) { el._attrs[k] = String(v); },
    getAttribute(k) { return el._attrs[k] ?? null; },
    removeAttribute(k) { delete el._attrs[k]; },

    appendChild(c) { el._children.push(c); c._parent = el; return c; },

    remove() { if (el._parent) el._parent.removeChild(el); },
    removeChild(c) { el._children = el._children.filter(x => x !== c); if (c._parent === el) c._parent = null; },

    replaceWith(...nodes) {
      const parent = el._parent;
      if (!parent) return;
      const pos = parent._children.indexOf(el);
      parent._children.splice(pos, 1, ...nodes);
      nodes.forEach(n => { n._parent = parent; });
      el._parent = null;
    },

    get parentNode() { return el._parent; },
    get parentElement() { return el._parent && !el._parent._isText ? el._parent : null; },
    get childNodes() { return el._children.slice(); },
    get firstChild() { return el._children[0] || null; },

    get textContent() {
      return el._children.map(c => c._isText ? c.nodeValue : (c.textContent || '')).join('') || el._text;
    },
    set textContent(v) { el._children = []; el._text = String(v); },

    addEventListener(ev, fn) { (el._listeners[ev] = el._listeners[ev] || []).push(fn); },
    removeEventListener(ev, fn) { if (el._listeners[ev]) el._listeners[ev] = el._listeners[ev].filter(f => f !== fn); },
    dispatch(ev, payload = {}) { (el._listeners[ev] || []).slice().forEach(fn => fn({ target: el, ...payload })); },

    scrollIntoView() { el._scrolledIntoView = (el._scrolledIntoView || 0) + 1; },
    getBoundingClientRect() { return { top: 10, left: 10, width: 20, height: 10, bottom: 20, right: 30 }; },

    _matches(sel) {
      // supports: 'tag', '.cls', '.cls[data-cue-id="x"]'
      const attrMatch = sel.match(/\[([a-z-]+)="([^"]+)"\]/);
      const clsMatch = sel.match(/\.([a-z-]+)/);
      if (clsMatch && !el._classes.includes(clsMatch[1])) return false;
      if (attrMatch && el._attrs[attrMatch[1]] !== attrMatch[2]) return false;
      if (!clsMatch && !attrMatch && el.tagName.toLowerCase() !== sel.toLowerCase()) return false;
      return true;
    },

    querySelector(sel) {
      for (const c of el._children) {
        if (c._isText) continue;
        if (c._matches(sel)) return c;
        const found = c.querySelector(sel);
        if (found) return found;
      }
      return null;
    },

    querySelectorAll(sel) {
      const out = [];
      for (const c of el._children) {
        if (c._isText) continue;
        if (c._matches(sel)) out.push(c);
        out.push(...c.querySelectorAll(sel));
      }
      return out;
    }
  };
  return el;
}

function createFakeDoc() {
  const body = createEl('body');
  return {
    body,
    createElement: createEl
  };
}

/** Build container > p > text(content) */
function buildPane(content) {
  const container = createEl('div');
  const p = createEl('p');
  p.appendChild(makeText(content));
  container.appendChild(p);
  return container;
}

/** Fake locate: find FIRST text node containing `text`, return fake Range */
function fakeLocate(container, text) {
  let found = null;
  (function walk(el) {
    if (found) return;
    for (const c of el._children) {
      if (c._isText) {
        if (c.nodeValue.includes(text)) { found = c; return; }
      } else {
        walk(c);
      }
    }
  })(container);
  if (!found) return null;
  const textNode = found;
  const idx = textNode.nodeValue.indexOf(text);
  return {
    surroundContents(span) {
      const parent = textNode._parent;
      const before = textNode.nodeValue.slice(0, idx);
      const match = textNode.nodeValue.slice(idx, idx + text.length);
      const after = textNode.nodeValue.slice(idx + text.length);
      const pos = parent._children.indexOf(textNode);
      const nodes = [];
      if (before) nodes.push(makeText(before));
      span.appendChild(makeText(match));
      nodes.push(span);
      if (after) nodes.push(makeText(after));
      parent._children.splice(pos, 1, ...nodes);
      nodes.forEach(n => { n._parent = parent; });
    }
  };
}

function makeCue(id, term, qaHistory) {
  return { id, term, qaHistory: qaHistory || [{ q: '什么是' + term, a: term + '的解释内容' }] };
}

/** deps for inject*: fake locator + fake document (Node has no global document) */
function injectDeps() {
  return { locate: fakeLocate, doc: createFakeDoc() };
}

// ============================================
// buildTooltipModel
// ============================================
TestRunner.test('buildTooltipModel returns full model', () => {
  const model = Marks.buildTooltipModel(makeCue('cue-1', '位置编码', [
    { q: '什么是位置编码', a: '为序列注入位置信息' },
    { q: '为什么用正弦', a: '周期性' }
  ]));
  TestRunner.assertEquals(model.selectedText, '位置编码');
  TestRunner.assertEquals(model.firstQ, '什么是位置编码');
  TestRunner.assertEquals(model.firstA, '为序列注入位置信息');
  TestRunner.assertEquals(model.rounds, 2);
});

TestRunner.test('buildTooltipModel truncates long answer with ellipsis', () => {
  const longA = '这是一段非常非常长的解释'.repeat(10);
  const model = Marks.buildTooltipModel(makeCue('cue-1', '晶格', [{ q: 'q', a: longA }]));
  TestRunner.assertEquals(model.firstA.length, 61, 'should truncate to 60 + ellipsis');
  TestRunner.assertEquals(model.firstA.endsWith('…'), true, 'should end with …');
});

TestRunner.test('buildTooltipModel handles empty qaHistory', () => {
  const model = Marks.buildTooltipModel(makeCue('cue-1', '晶格', []));
  TestRunner.assertEquals(model.rounds, 0);
  TestRunner.assertEquals(model.firstQ, '');
  TestRunner.assertEquals(model.firstA, '');
});

// ============================================
// injectCueMark
// ============================================
TestRunner.test('injectCueMark wraps matched text with data-cue-id span', () => {
  const pane = buildPane('位置编码是 Transformer 的关键组件');
  const ok = Marks.injectCueMark(pane, makeCue('cue-1', '位置编码'), injectDeps());

  TestRunner.assertEquals(ok, true, 'should return true');
  const mark = pane.querySelector('.cornell-cue-mark');
  TestRunner.assertEquals(!!mark, true, 'mark span should exist');
  TestRunner.assertEquals(mark.getAttribute('data-cue-id'), 'cue-1');
  TestRunner.assertEquals(mark.textContent, '位置编码');
  TestRunner.assertEquals(pane.textContent, '位置编码是 Transformer 的关键组件', 'full text preserved');
});

TestRunner.test('injectCueMark returns false and leaves DOM unchanged when text not found', () => {
  const pane = buildPane('完全无关的内容');
  const ok = Marks.injectCueMark(pane, makeCue('cue-3', '位置编码'), injectDeps());

  TestRunner.assertEquals(ok, false);
  TestRunner.assertEquals(pane.querySelectorAll('.cornell-cue-mark').length, 0);
  TestRunner.assertEquals(pane.textContent, '完全无关的内容');
});

TestRunner.test('injectCueMark is idempotent for the same cue id', () => {
  const pane = buildPane('位置编码是 Transformer 的关键组件');
  Marks.injectCueMark(pane, makeCue('cue-1', '位置编码'), injectDeps());
  const second = Marks.injectCueMark(pane, makeCue('cue-1', '位置编码'), injectDeps());

  TestRunner.assertEquals(second, false, 'second inject should be a no-op');
  TestRunner.assertEquals(pane.querySelectorAll('.cornell-cue-mark').length, 1);
});

TestRunner.test('Text occurring twice is marked only at the first occurrence', () => {
  const pane = buildPane('晶格是晶体结构，晶格决定性质');
  Marks.injectCueMark(pane, makeCue('cue-2', '晶格'), injectDeps());

  const marks = pane.querySelectorAll('.cornell-cue-mark');
  TestRunner.assertEquals(marks.length, 1);
  TestRunner.assertEquals(pane.textContent, '晶格是晶体结构，晶格决定性质');
});

TestRunner.test('acceptsTextNode rejects nodes inside pre/katex/mermaid/cue-mark', () => {
  const katex = createEl('span');
  katex._classes = ['katex'];
  const inner = createEl('span');
  katex.appendChild(inner);
  const textNode = makeText('x');
  inner.appendChild(textNode);

  TestRunner.assertEquals(Marks.acceptsTextNode(textNode), false, 'inside .katex should be rejected');

  const p = createEl('p');
  const plain = makeText('y');
  p.appendChild(plain);
  TestRunner.assertEquals(Marks.acceptsTextNode(plain), true, 'plain paragraph text should be accepted');
});

// ============================================
// removeCueMark / removeAllCueMarks
// ============================================
TestRunner.test('removeCueMark unwraps the span and restores original text', () => {
  const pane = buildPane('位置编码是 Transformer 的关键组件');
  Marks.injectCueMark(pane, makeCue('cue-1', '位置编码'), injectDeps());
  const removed = Marks.removeCueMark(pane, 'cue-1');

  TestRunner.assertEquals(removed, true);
  TestRunner.assertEquals(pane.querySelectorAll('.cornell-cue-mark').length, 0);
  TestRunner.assertEquals(pane.textContent, '位置编码是 Transformer 的关键组件', 'text restored');
});

TestRunner.test('removeAllCueMarks removes every mark', () => {
  const pane = buildPane('位置编码和晶格都是术语');
  Marks.injectAllCueMarks(pane, [makeCue('cue-1', '位置编码'), makeCue('cue-2', '晶格')], injectDeps());
  TestRunner.assertEquals(pane.querySelectorAll('.cornell-cue-mark').length, 2);

  Marks.removeAllCueMarks(pane);
  TestRunner.assertEquals(pane.querySelectorAll('.cornell-cue-mark').length, 0);
  TestRunner.assertEquals(pane.textContent, '位置编码和晶格都是术语');
});

// ============================================
// Interactions (click → sidebar flash, hover → tooltip)
// ============================================
function buildInteractionFixture() {
  const doc = createFakeDoc();
  const pane = buildPane('位置编码是关键组件');
  Marks.injectCueMark(pane, makeCue('cue-1', '位置编码'), injectDeps());
  const mark = pane.querySelector('.cornell-cue-mark');

  const sidebarBody = createEl('div');
  const card = createEl('div');
  card._classes = ['cornell-cue'];
  card.setAttribute('data-cue-id', 'cue-1');
  sidebarBody.appendChild(card);
  doc.body.appendChild(pane);
  doc.body.appendChild(sidebarBody);

  const cue = makeCue('cue-1', '位置编码', [
    { q: '什么是位置编码', a: '为序列注入位置信息' },
    { q: '为什么用正弦', a: '周期性且连续' }
  ]);

  Marks.attachMarkInteractions(pane, {
    getSidebarBody: () => sidebarBody,
    getCue: () => cue,
    doc
  });

  return { doc, pane, mark, sidebarBody, card, cue };
}

TestRunner.test('Clicking a cue mark scrolls sidebar card into view and flashes it', () => {
  const { pane, mark, card } = buildInteractionFixture();

  pane.dispatch('click', { target: mark });

  TestRunner.assertEquals(card._scrolledIntoView, 1, 'card should be scrolled into view');
  TestRunner.assertEquals(card.classList.contains('cue-flash'), true, 'card should have cue-flash class');
});

TestRunner.test('Hovering a cue mark shows tooltip with summary; mouseout hides it', () => {
  const { doc, pane, mark } = buildInteractionFixture();

  pane.dispatch('mouseover', { target: mark });

  const tip = doc.body.querySelector('.cornell-cue-tooltip');
  TestRunner.assertEquals(!!tip, true, 'tooltip should exist');
  TestRunner.assertEquals(tip.style.display !== 'none', true, 'tooltip should be visible');
  TestRunner.assertEquals(tip.textContent.includes('什么是位置编码'), true, 'tooltip shows first Q');
  TestRunner.assertEquals(tip.textContent.includes('共 2 轮问答'), true, 'tooltip shows round count');

  pane.dispatch('mouseout', { target: mark });
  TestRunner.assertEquals(tip.style.display, 'none', 'tooltip should hide on mouseout');
});

// Run
TestRunner.run();
