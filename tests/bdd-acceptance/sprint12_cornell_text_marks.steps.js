#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for Cornell text marks (划词痕迹)
 *
 * Requires the REAL dist/scripts/learning/cornell-text-marks.js module
 * against the shared mock DOM. The locate strategy is injected because
 * mock DOMs have no TreeWalker/createRange (browser default locator is
 * covered by manual acceptance).
 */

const { buildMockDOM } = require('../shared/mock-dom');
const { StepRegistry } = require('../shared/runner');
const Marks = require('../../dist/scripts/learning/cornell-text-marks.js');

const steps = new StepRegistry();

// ============================================
// Fixture helpers
// ============================================
function makeTextNode(value) {
  return {
    _isText: true,
    nodeValue: value,
    _parent: null,
    _classes: [],
    _attrs: {},
    _removed: false,
    querySelector: () => null,
    querySelectorAll: () => []
  };
}

/** pane > p > text */
function buildPane(context, content) {
  const { document } = buildMockDOM();
  context.document = document;
  const pane = document.createElement('div');
  const p = document.createElement('p');
  const text = makeTextNode(content);
  p.appendChild(text);
  pane.appendChild(p);
  document.body.appendChild(pane);
  context.pane = pane;
  context.originalText = content;
}

/** Fake locate: find FIRST text node containing text, return fake Range */
function fakeLocate(container, text) {
  let found = null;
  (function walk(el) {
    if (found) return;
    for (const c of el._children) {
      if (c._isText) {
        if (c.nodeValue.includes(text)) { found = c; return; }
      } else if (c._children) {
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
      if (before) nodes.push(makeTextNode(before));
      span.appendChild(makeTextNode(match));
      nodes.push(span);
      if (after) nodes.push(makeTextNode(after));
      parent._children.splice(pos, 1, ...nodes);
      nodes.forEach(n => { n._parent = parent; });
    }
  };
}

function injectDeps(context) {
  return { locate: fakeLocate, doc: context.document };
}

function makeCue(id, term, rounds) {
  const qaHistory = [];
  for (let i = 0; i < (rounds || 1); i++) {
    qaHistory.push({ q: `问题${i + 1}：${term}是什么`, a: `回答${i + 1}：${term}的解释` });
  }
  return { id, term, qaHistory };
}

function markCount(context) {
  return context.pane.querySelectorAll('.cornell-cue-mark').length;
}

function joinText(el) {
  return el._children.map(c => c._isText ? c.nodeValue : joinText(c)).join('');
}

// ============================================
// Given
// ============================================
steps.given('a reading pane containing the text {string}', function(text) {
  buildPane(this, text);
  this.cues = [];
});

steps.given('a cue with id {string} for the text {string}', function(id, term) {
  this.cues.push(makeCue(id, term, 1));
});

steps.given('an injected cue mark for {string} with {int} rounds of Q&A', function(id, rounds) {
  buildPane(this, '位置编码是 Transformer 的关键组件');
  this.cue = makeCue(id, '位置编码', rounds);
  Marks.injectCueMark(this.pane, this.cue, injectDeps(this));
  if (markCount(this) !== 1) throw new Error('Given failed: mark not injected');
  Marks.attachMarkInteractions(this.pane, {
    getSidebarBody: () => null,
    getCue: () => this.cue,
    doc: this.document
  });
});

steps.given('an injected cue mark for {string}', function(id) {
  buildPane(this, '位置编码是 Transformer 的关键组件');
  this.cue = makeCue(id, '位置编码', 1);
  Marks.injectCueMark(this.pane, this.cue, injectDeps(this));
  if (markCount(this) !== 1) throw new Error('Given failed: mark not injected');
  this.mark = this.pane.querySelector('.cornell-cue-mark');
});

steps.given('a sidebar cue card for {string}', function(id) {
  const card = this.document.createElement('div');
  card.className = 'cornell-cue';
  card.setAttribute('data-cue-id', id);
  this.document.body.appendChild(card);
  this.sidebarCard = card;
  Marks.attachMarkInteractions(this.pane, {
    getSidebarBody: () => this.document.body,
    getCue: () => this.cue,
    doc: this.document
  });
});

// ============================================
// When
// ============================================
steps.when('cue marks are injected', function() {
  this.injected = Marks.injectAllCueMarks(this.pane, this.cues, injectDeps(this));
});

steps.when('cue marks are injected twice', function() {
  Marks.injectAllCueMarks(this.pane, this.cues, injectDeps(this));
  Marks.injectAllCueMarks(this.pane, this.cues, injectDeps(this));
});

steps.when('the user hovers the cue mark', function() {
  const mark = this.pane.querySelector('.cornell-cue-mark');
  (this.pane._listeners.mouseover || []).forEach(fn => fn({ target: mark }));
});

steps.when('the user clicks the cue mark', function() {
  (this.pane._listeners.click || []).forEach(fn => fn({ target: this.mark }));
});

steps.when('the cue mark for {string} is removed', function(id) {
  Marks.removeCueMark(this.pane, id);
});

// ============================================
// Then
// ============================================
steps.then('the text {string} should be wrapped in a cue mark for {string}', function(text, id) {
  const mark = this.pane.querySelector(`.cornell-cue-mark[data-cue-id="${id}"]`);
  if (!mark) throw new Error(`No cue mark found for ${id}`);
  const inner = mark._children[0];
  if (!inner || inner.nodeValue !== text) {
    throw new Error(`Mark content mismatch: expected "${text}", got "${inner && inner.nodeValue}"`);
  }
});

steps.then('exactly {int} cue mark should exist', function(n) {
  if (markCount(this) !== n) {
    throw new Error(`Expected ${n} cue marks, got ${markCount(this)}`);
  }
});

steps.then('no cue mark should exist', function() {
  if (markCount(this) !== 0) {
    throw new Error(`Expected no cue marks, got ${markCount(this)}`);
  }
});

steps.then('a tooltip should show the cue summary with {int} rounds', function(rounds) {
  const tip = this.document.body.querySelector('.cornell-cue-tooltip');
  if (!tip) throw new Error('Tooltip not found');
  if (tip.style.display === 'none') throw new Error('Tooltip is hidden');
  const text = tip._children.map(c => c.textContent).join('\n');
  if (!text.includes(`共 ${rounds} 轮问答`)) {
    throw new Error(`Tooltip missing round count: "${text}"`);
  }
  if (!text.includes('问题1')) {
    throw new Error(`Tooltip missing first Q: "${text}"`);
  }
});

steps.then('the sidebar cue card should be scrolled into view and flashed', function() {
  if (!this.sidebarCard._scrolledIntoView) {
    throw new Error('Sidebar card was not scrolled into view');
  }
  if (!this.sidebarCard.classList.contains('cue-flash')) {
    throw new Error('Sidebar card missing cue-flash class');
  }
});

steps.then('the original text should be restored', function() {
  const text = joinText(this.pane);
  if (text !== this.originalText) {
    throw new Error(`Text not restored: expected "${this.originalText}", got "${text}"`);
  }
});

module.exports = steps;
