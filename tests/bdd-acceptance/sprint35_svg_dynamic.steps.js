#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD acceptance steps for dynamic inline SVG (Sprint 35).
 *
 * Real module: dist/scripts/learning/svg-dynamic.js
 * Static wiring: main.js / index.html / inline-svg-spec / main.css
 */

const fs = require('fs');
const path = require('path');

const { StepRegistry } = require('../shared/runner');
const SvgDynamic = require('../../dist/scripts/learning/svg-dynamic');

const steps = new StepRegistry();
const ROOT = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

function fakePart(attrs) {
  return { getAttribute: (name) => (name in attrs ? attrs[name] : null) };
}

// ============================================
// Given
// ============================================

steps.given('an SVG with three parts whose data-order is 3 1 2', function () {
  this.nodes = [
    fakePart({ 'data-part': 'three', 'data-label': '三步', 'data-order': '3' }),
    fakePart({ 'data-part': 'one', 'data-label': '一步', 'data-order': '1' }),
    fakePart({ 'data-part': 'two', 'data-label': '二步', 'data-order': '2' })
  ];
});

steps.given('an SVG with a part without data-label', function () {
  this.nodes = [fakePart({ 'data-part': 'heater' })];
});

steps.given('the main script source for svg dynamic', function () {
  this.mainSrc = read('dist/scripts/main.js');
});

steps.given('the index html source for svg dynamic', function () {
  this.indexSrc = read('dist/index.html');
});

steps.given('the inline svg spec', function () {
  this.spec = read('src-tauri/skills/chapter-generation/references/inline-svg-spec.md');
});

steps.given('the stylesheet source', function () {
  this.css = read('dist/styles/main.css');
});

// ============================================
// When
// ============================================

steps.when('the parts are collected', function () {
  this.parts = SvgDynamic.collectPartsFromList(this.nodes);
});

steps.when('the step state for index {int} is queried at current {int}', function (index, current) {
  this.state = SvgDynamic.stepState(index, current, 3);
});

// ============================================
// Then
// ============================================

steps.then('the collected order should be part one part two part three', function () {
  const ids = this.parts.map((p) => p.id).join(' ');
  if (ids !== 'one two three') {
    throw new Error(`unexpected order: ${ids}`);
  }
});

steps.then('the labels should come from data-label', function () {
  const labels = this.parts.map((p) => p.label).join(' ');
  if (labels !== '一步 二步 三步') {
    throw new Error(`unexpected labels: ${labels}`);
  }
});

steps.then('the label should be the part id', function () {
  if (this.parts[0].label !== 'heater') {
    throw new Error(`expected fallback label, got ${this.parts[0].label}`);
  }
});

steps.then('the state should be past', function () {
  if (this.state !== 'past') throw new Error(`got ${this.state}`);
});

steps.then('the state should be current', function () {
  if (this.state !== 'current') throw new Error(`got ${this.state}`);
});

steps.then('the state should be future', function () {
  if (this.state !== 'future') throw new Error(`got ${this.state}`);
});

steps.then('autoplay should be allowed when reduced motion is off', function () {
  if (!SvgDynamic.canAutoPlay(false)) throw new Error('autoplay should be allowed');
});

steps.then('autoplay should be disabled when reduced motion is on', function () {
  if (SvgDynamic.canAutoPlay(true)) throw new Error('autoplay should be disabled');
});

steps.then('progress before stepping of {int} should read 0 / {int}', function (total, totalAgain) {
  const text = SvgDynamic.formatProgress(-1, total);
  if (text !== `0 / ${totalAgain}`) throw new Error(`got ${text}`);
});

steps.then('progress at current {int} of {int} should read {int} / {int}', function (current, total, shown, totalAgain) {
  const text = SvgDynamic.formatProgress(current, total);
  if (text !== `${shown} / ${totalAgain}`) throw new Error(`got ${text}`);
});

steps.then('main.js should initialize the dynamic SVG runtime', function () {
  if (!this.mainSrc.includes('SvgDynamic.init')) {
    throw new Error('main.js 未调用 SvgDynamic.init');
  }
});

steps.then('svg-dynamic.js should load before main.js', function () {
  const dynamicIdx = this.indexSrc.indexOf('scripts/learning/svg-dynamic.js');
  const mainIdx = this.indexSrc.indexOf('scripts/main.js');
  if (dynamicIdx < 0) throw new Error('index.html 未加载 svg-dynamic.js');
  if (dynamicIdx > mainIdx) throw new Error('svg-dynamic.js 必须在 main.js 之前加载');
});

steps.then('the spec should require data-part groups', function () {
  if (!this.spec.includes('data-part')) {
    throw new Error('出图规范未要求 data-part 分组');
  }
});

steps.then('the spec should require data-label and data-order', function () {
  if (!this.spec.includes('data-label') || !this.spec.includes('data-order')) {
    throw new Error('出图规范未要求 data-label / data-order');
  }
});

steps.then('the stylesheet should style the dynamic panel', function () {
  if (!this.css.includes('.svg-dynamic-panel')) {
    throw new Error('样式缺少 .svg-dynamic-panel');
  }
});

steps.then('the stylesheet should disable transitions under reduced motion', function () {
  if (!/prefers-reduced-motion[\s\S]{0,400}svg-dynamic/.test(this.css) &&
      !/svg-dynamic[\s\S]{0,400}prefers-reduced-motion/.test(this.css)) {
    throw new Error('样式未在 prefers-reduced-motion 下关闭动效');
  }
});

module.exports = steps;
