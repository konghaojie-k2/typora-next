#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for slides v3 (structure split + measured packing)
 *
 * Structure: tests/shared/slides-splitter.js (mirrors main.js parseMarkdownStructure)
 * Packing:  tests/shared/slides-pack-core.js (mirrors slides.js packItems)
 */

const { StepRegistry } = require('../shared/runner');
const { parseMarkdownStructure } = require('../shared/slides-splitter');
const { packItems } = require('../shared/slides-pack-core');

const steps = new StepRegistry();
const AVAIL = 100;

function item(height, opts = {}) {
  return {
    height,
    isHeading: opts.heading || false,
    h2Text: opts.h2 || null,
    payload: opts.id || null,
    split: opts.splittable
      ? (remainingH) => {
          if (remainingH < 20) return null;
          return [
            item(remainingH, { id: (opts.id || 'x') + '-part1' }),
            item(height - remainingH, { id: (opts.id || 'x') + '-part2', splittable: true })
          ];
        }
      : null
  };
}

// ============================================
// Given
// ============================================
steps.given('a markdown document without explicit slide separators', function() {
  this.markdown = [
    '# 第一章', '',
    '## 1.1 背景', '内容A', '',
    '## 1.2 方法', '内容B', '',
    '# 第二章', '',
    '## 2.1 结果', '内容C'
  ].join('\n');
});

steps.given('a markdown document with explicit --- separators', function() {
  this.markdown = '第一页\n\n---\n\n第二页\n\n--\n\n第二页下';
});

steps.given('a markdown document containing a setext heading', function() {
  this.markdown = '# 第一章\n\n这是一个标题\n---\n\n## 小节\n\n内容';
});

steps.given('a series of measured elements exceeding one page', function() {
  this.elements = [
    item(30, { id: 'a' }),
    item(40, { id: 'b' }),
    item(50, { id: 'c' }),
    item(20, { id: 'd' })
  ];
});

steps.given('measured elements where a heading would land at a page bottom', function() {
  this.elements = [
    item(70, { id: 'content' }),
    item(10, { heading: true, id: 'h' }),
    item(30, { id: 'after' })
  ];
});

steps.given('a long H2 section that must split across pages', function() {
  this.elements = [
    item(10, { heading: true, h2: '## 长节', id: 'h2' }),
    item(60, { id: 'p1' }),
    item(80, { id: 'code', splittable: true })
  ];
});

// ============================================
// When
// ============================================
steps.when('the document is parsed into slide structure', function() {
  this.groups = parseMarkdownStructure(this.markdown);
});

steps.when('they are packed by available height', function() {
  this.pages = packItems(this.elements, AVAIL);
});

// ============================================
// Then
// ============================================
steps.then('each H1 becomes a chapter with a cover', function() {
  if (this.groups.length !== 2) {
    throw new Error('Expected 2 chapters, got ' + this.groups.length);
  }
  if (this.groups[0].cover !== '# 第一章' || this.groups[1].cover !== '# 第二章') {
    throw new Error('Chapter covers incorrect');
  }
});

steps.then('chapter content keeps its H2 headings inline', function() {
  const unit = this.groups[0].units[0];
  if (!unit.includes('## 1.1 背景') || !unit.includes('## 1.2 方法')) {
    throw new Error('H2 headings must stay inline for DOM packing');
  }
});

steps.then('groups split exactly at the --- markers', function() {
  if (this.groups.length !== 2) {
    throw new Error('Expected 2 groups, got ' + this.groups.length);
  }
  if (this.groups[1].units.length !== 2) {
    throw new Error('Expected -- to create 2 units');
  }
});

steps.then('the setext line does not create a group boundary', function() {
  if (this.groups.length !== 1) {
    throw new Error('Setext --- must not split groups, got ' + this.groups.length);
  }
});

steps.then('every page is within the height budget', function() {
  for (let i = 0; i < this.pages.length; i++) {
    const h = this.pages[i].items.reduce((s, it) => s + it.height, 0);
    if (h > AVAIL && this.pages[i].items.length > 1) {
      throw new Error('Page ' + i + ' overflows: ' + h);
    }
  }
});

steps.then('all elements are preserved in order', function() {
  const flat = this.pages.flatMap(p => p.items.map(i => i.payload));
  const expected = ['a', 'b', 'c', 'd'];
  if (JSON.stringify(flat) !== JSON.stringify(expected)) {
    throw new Error('Element order changed: ' + flat.join(','));
  }
});

steps.then('no page ends with a lone heading', function() {
  for (let i = 0; i < this.pages.length - 1; i++) {
    const items = this.pages[i].items;
    if (items[items.length - 1].isHeading) {
      throw new Error('Page ' + i + ' ends with a heading');
    }
  }
});

steps.then('the continuation page is marked with the H2 text', function() {
  if (this.pages.length < 2) {
    throw new Error('Expected the section to split');
  }
  if (this.pages[1].continuedH2 !== '## 长节') {
    throw new Error('Continuation page missing H2 marker: ' + this.pages[1].continuedH2);
  }
});

module.exports = steps;
