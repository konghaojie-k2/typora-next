#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD acceptance steps for block-level AI companion (Sprint 34).
 *
 * Real module: dist/scripts/learning/block-companion.js
 * Static wiring: main.js / index.html / mode-integration.js / ai-companion-modal.js
 */

const fs = require('fs');
const path = require('path');

const { StepRegistry } = require('../shared/runner');
const BlockCompanion = require('../../dist/scripts/learning/block-companion');

const steps = new StepRegistry();

const ROOT = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

function twoTableMarkdown() {
  return [
    '# 章节',
    '',
    '| 概念 | 含义 |',
    '| --- | --- |',
    '| 界面 | 固液交界 |',
    '',
    '```js',
    '| 这不是 | 表格 |',
    '| --- | --- |',
    '```',
    '',
    '| 参数 | 单位 |',
    '|:--|--:|',
    '| 温度 | K |'
  ].join('\n');
}

// ============================================
// Given
// ============================================

steps.given('a chapter markdown with two tables and a fenced code block in between', function () {
  this.markdown = twoTableMarkdown();
});

steps.given('a chapter markdown with a table inside a blockquote', function () {
  this.markdown = [
    '> 引言',
    '> | 项 | 值 |',
    '> | --- | --- |',
    '> | 坩埚 | 石英 |',
    '',
    '结尾'
  ].join('\n');
});

steps.given('a chapter markdown with two mermaid fences', function () {
  this.markdown = [
    '第一张：',
    '',
    '```mermaid',
    'graph TD',
    '  A --> B',
    '```',
    '',
    '第二张：',
    '',
    '~~~mmd',
    'sequenceDiagram',
    '  A->>B: hi',
    '~~~'
  ].join('\n');
});

steps.given('a chapter markdown with one table', function () {
  this.markdown = [
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |'
  ].join('\n');
});

steps.given('a chapter file named {string}', function (name) {
  this.chapterFile = name;
});

steps.given('a block source with {int} characters', function (n) {
  this.source = 'A'.repeat(Math.floor(n / 2)) + 'B'.repeat(Math.ceil(n / 2));
});

steps.given('the main script source', function () {
  this.mainSrc = read('dist/scripts/main.js');
});

steps.given('the index html source', function () {
  this.indexSrc = read('dist/index.html');
});

steps.given('the companion modal source', function () {
  this.modalSrc = read('dist/scripts/learning/ai-companion-modal.js');
});

steps.given('the learning integration source', function () {
  this.integrationSrc = read('dist/scripts/learning/mode-integration.js');
});

// ============================================
// When
// ============================================

steps.when('the table sources are extracted', function () {
  this.tables = BlockCompanion.extractTableBlocks(this.markdown);
});

steps.when('the mermaid sources are extracted', function () {
  this.mermaids = BlockCompanion.extractMermaidBlocks(this.markdown);
});

steps.when('the source for table index {int} is requested', function (index) {
  this.picked = BlockCompanion.pickBlockSource('table', index, this.markdown);
});

steps.when('the block label and key are built for the second mermaid block', function () {
  this.label = BlockCompanion.blockLabel('mermaid', 1);
  this.key = BlockCompanion.buildBlockKey(this.chapterFile, 'mermaid', 1);
});

steps.when('the source is truncated to {int} characters', function (max) {
  this.truncated = BlockCompanion.truncateSource(this.source, max);
});

// ============================================
// Then
// ============================================

steps.then('exactly {int} table sources should be found', function (n) {
  if (this.tables.length !== n) {
    throw new Error(`expected ${n} tables, got ${this.tables.length}`);
  }
});

steps.then('the second table source should contain its own header', function () {
  if (!this.tables[1].text.includes('参数') || !this.tables[1].text.includes('单位')) {
    throw new Error('second table header missing');
  }
  if (this.tables.some((t) => t.text.includes('这不是'))) {
    throw new Error('fenced code block leaked into table sources');
  }
});

steps.then('the table source should contain the blockquote table cells', function () {
  if (this.tables.length !== 1) {
    throw new Error(`expected 1 table, got ${this.tables.length}`);
  }
  const text = this.tables[0].text;
  if (!text.includes('坩埚') || !text.includes('石英')) {
    throw new Error(`blockquote table content missing: ${text}`);
  }
});

steps.then('exactly {int} mermaid sources should be found', function (n) {
  if (this.mermaids.length !== n) {
    throw new Error(`expected ${n} mermaid blocks, got ${this.mermaids.length}`);
  }
});

steps.then('the second mermaid source should start with its diagram type', function () {
  if (!this.mermaids[1].text.trim().startsWith('sequenceDiagram')) {
    throw new Error(`unexpected second mermaid source: ${this.mermaids[1].text}`);
  }
});

steps.then('no block source should be returned', function () {
  if (this.picked !== null) {
    throw new Error(`expected null, got ${this.picked}`);
  }
});

steps.then('the label should read Mermaid 图 #2', function () {
  if (this.label !== 'Mermaid 图 #2') {
    throw new Error(`unexpected label: ${this.label}`);
  }
});

steps.then('the key should read block::04-wave::mermaid::2', function () {
  if (this.key !== 'block::04-wave::mermaid::2') {
    throw new Error(`unexpected key: ${this.key}`);
  }
});

steps.then('the truncated source should contain the truncation marker', function () {
  if (!this.truncated.includes('已截断')) {
    throw new Error('truncation marker missing');
  }
});

steps.then('the truncated source should start and end with the original content', function () {
  if (!this.truncated.startsWith('AAAA')) {
    throw new Error('head content lost');
  }
  if (!this.truncated.endsWith('BBBB')) {
    throw new Error('tail content lost');
  }
});

steps.then('main.js should initialize the block companion with the chapter markdown', function () {
  if (!this.mainSrc.includes('BlockCompanion.init')) {
    throw new Error('main.js 未调用 BlockCompanion.init');
  }
  if (!/BlockCompanion\.init\([^)]*markdown/.test(this.mainSrc)) {
    throw new Error('BlockCompanion.init 未接收章节 markdown');
  }
});

steps.then('block-companion.js should load before mode-integration.js', function () {
  const blockIdx = this.indexSrc.indexOf('scripts/learning/block-companion.js');
  const integrationIdx = this.indexSrc.indexOf('scripts/learning/mode-integration.js');
  if (blockIdx < 0) throw new Error('index.html 未加载 block-companion.js');
  if (blockIdx > integrationIdx) throw new Error('block-companion.js 必须在 mode-integration.js 之前加载');
});

steps.then('the modal should honor a start key override', function () {
  if (!/this\.startKey\s*=\s*opts\.startKey/.test(this.modalSrc)) {
    throw new Error('AICompanionModal 未支持 opts.startKey 覆盖');
  }
});

steps.then('the modal should allow skipping cue marks', function () {
  if (!/this\.skipCue\s*=/.test(this.modalSrc)) {
    throw new Error('AICompanionModal 未支持 skipCue');
  }
  if (!this.modalSrc.includes('if (this.skipCue) return')) {
    throw new Error('_syncCue 未在 skipCue 时提前返回');
  }
});

steps.then('the integration should export openAICompanionForBlock', function () {
  if (!/openAICompanionForBlock/.test(this.integrationSrc)) {
    throw new Error('LearningModeIntegration 未导出 openAICompanionForBlock');
  }
});

steps.then('the block entry should pass the block source through context', function () {
  if (!/blockSource\s*:/.test(this.integrationSrc)) {
    throw new Error('块伴学未通过 context.blockSource 传递源码');
  }
});

module.exports = steps;
