#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps: 本地 file 链接处理（裸 URL linkify + 点击分流）
 *
 * 背景（2026-11-05 实爆）：正文/PPT 里的裸 file:///...html 是纯文本 ——
 * pulldown-cmark 未开 autolink（CommonMark 需要 <> 或 []() 语法才成链接），
 * initLinkHandling 的打开链只对 <a> 生效 → 无可点击对象。
 * 方案：渲染层 linkify（文本节点裸 URL 包 <a>），主视图 + PPT 双端生效。
 */

const { StepRegistry } = require('../shared/runner');
const LinkUtils = require('../../dist/scripts/link-utils');
const fs = require('fs');
const path = require('path');

const steps = new StepRegistry();

// ============================================
// 纯逻辑：findUrlInText 匹配
// ============================================
steps.given('text containing a bare file URL with percent-encoded path', function() {
  this.text = '详细模拟见 file:///Users/x/Documents/cz-sim/pages/states/%E6%8B%89%E6%99%B6%E6%8E%BA%E6%9D%82%E6%B5%93%E5%BA%A6.html 章节另述';
  this.expectedUrl = this.text.split(' ')[1];
});

steps.given('text where a bare URL is followed by a CJK full stop', function() {
  this.text = '模拟见 https://example.com/sim.html。此处句号不属于链接';
});

steps.given('a bare URL containing balanced parentheses', function() {
  this.text = '参考 https://en.wikipedia.org/wiki/Single_(crystal)_growth 即可';
});

steps.when('the URL matcher scans the text', function() {
  this.hit = LinkUtils.findUrlInText(this.text);
});

steps.then('the full URL including encoded segments is matched', function() {
  if (!this.hit) throw new Error('findUrlInText returned null');
  if (this.hit.url !== this.expectedUrl) {
    throw new Error('matched ' + this.hit.url + ', expected ' + this.expectedUrl);
  }
  if (this.text.slice(this.hit.start, this.hit.end) !== this.expectedUrl) {
    throw new Error('offsets do not slice back the URL');
  }
});

steps.then('the matched URL excludes the trailing punctuation', function() {
  if (!this.hit) throw new Error('findUrlInText returned null');
  if (this.hit.url.endsWith('。')) {
    throw new Error('CJK full stop wrongly included: ' + this.hit.url);
  }
  if (this.hit.url !== 'https://example.com/sim.html') {
    throw new Error('unexpected match: ' + this.hit.url);
  }
});

steps.then('the matched URL keeps the parentheses', function() {
  if (!this.hit) throw new Error('findUrlInText returned null');
  if (this.hit.url !== 'https://en.wikipedia.org/wiki/Single_(crystal)_growth') {
    throw new Error('balanced parens broken: ' + this.hit.url);
  }
});

// ============================================
// 布线：主视图 / PPT
// ============================================
steps.given('the main.js rendering pipeline source', function() {
  this.mainSource = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/main.js'), 'utf-8');
});

steps.when('checking the main view linkify wiring', function() {
  this.linkifyIdx = this.mainSource.indexOf('linkifyPlainTextUrls()');
  this.linkHandlingIdx = this.mainSource.indexOf('initLinkHandling();');
});

steps.then('text nodes are linkified before click delegation is initialized', function() {
  if (this.linkifyIdx === -1) {
    throw new Error('renderMarkdown must call linkifyPlainTextUrls()');
  }
  if (this.linkHandlingIdx === -1) throw new Error('initLinkHandling missing');
  if (this.linkifyIdx > this.linkHandlingIdx) {
    throw new Error('linkify must run BEFORE initLinkHandling (anchor 必须先存在)');
  }
});

steps.given('the slides.js rendering pipeline source', function() {
  this.slidesSource = fs.readFileSync(
    path.join(__dirname, '../../dist/scripts/slides.js'), 'utf-8');
});

steps.when('checking the slides link wiring', function() {
  this.slideLinkifyIdx = this.slidesSource.indexOf('LinkUtils.linkifyElement(div)');
  this.measureIdx = this.slidesSource.indexOf('var items = measureItems(div)');
  this.hasClickRouting = this.slidesSource.includes("closest('a[href]')")
    && this.slidesSource.includes('open_local_file')
    && this.slidesSource.includes('open_external');
});

steps.then('bare URLs inside measured content are linkified before packing', function() {
  if (this.slideLinkifyIdx === -1) {
    throw new Error('measureAndPack must call LinkUtils.linkifyElement(div)');
  }
  if (this.slideLinkifyIdx > this.measureIdx) {
    throw new Error('slides linkify must run BEFORE measureItems');
  }
});

steps.then('anchor clicks are routed to open_external or open_local_file', function() {
  if (!this.hasClickRouting) {
    throw new Error('slides must delegate a[href] clicks to open_external / open_local_file');
  }
});

module.exports = steps;
