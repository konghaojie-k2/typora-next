#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * Static contract tests for tab drag wiring
 *
 * main.js is a 7000+ line IIFE that needs Tauri + full DOM, so it is never
 * executed in tests (established pattern: test_external_open_attention.js).
 * Instead we assert the structural contract of the wiring:
 *   - renderTabs aborts any in-flight drag (cancelTabDrag) and tags each tab
 *     with dataset.index
 *   - a delegated mousedown listener on tabsList drives the drag session
 *   - drop commits through TabDrag.computeDropIndex / reorderArray /
 *     remapActiveIndex
 *   - a capture-phase click suppressor swallows the click fired after a drag
 *   - window blur cancels the drag
 *   - index.html loads tab-drag.js BEFORE main.js
 *   - main.css carries the drag feedback classes
 */

const fs = require('fs');
const path = require('path');
const TestRunner = require('../shared/test-runner');

const assert = TestRunner.assert.bind(TestRunner);
const test = TestRunner.test.bind(TestRunner);

const ROOT = path.join(__dirname, '..', '..');
const MAIN_JS = path.join(ROOT, 'dist', 'scripts', 'main.js');
const INDEX_HTML = path.join(ROOT, 'dist', 'index.html');
const MAIN_CSS = path.join(ROOT, 'dist', 'styles', 'main.css');

function extractBodyAfterMarker(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(marker + ' not found');
  const braceIdx = source.indexOf('{', start);
  if (braceIdx < 0) throw new Error('Could not find function body');
  let depth = 0;
  for (let i = braceIdx; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(braceIdx + 1, i);
    }
  }
  throw new Error('Unterminated function body');
}

// ============================================
// renderTabs contract
// ============================================

test('renderTabs aborts an in-flight drag before rebuilding', () => {
  const body = extractBodyAfterMarker(load(MAIN_JS), 'function renderTabs(');
  assert(/cancelTabDrag\(\)/.test(body),
    'renderTabs must call cancelTabDrag() — a rebuild mid-drag would strand the session');
});

test('renderTabs tags each tab element with dataset.index', () => {
  const body = extractBodyAfterMarker(load(MAIN_JS), 'function renderTabs(');
  assert(/dataset\.index\s*=\s*index/.test(body),
    'delegated mousedown resolves the tab via dataset.index');
});

// ============================================
// Drag session wiring
// ============================================

test('main.js registers a delegated mousedown listener on tabsList', () => {
  const source = load(MAIN_JS);
  assert(/tabsList\.addEventListener\('mousedown'/.test(source),
    'expected tabsList mousedown delegation (per-tab binding would re-bind every render)');
});

test('drop commits through the TabDrag pure functions', () => {
  const source = load(MAIN_JS);
  assert(source.includes('TabDrag.computeDropIndex'), 'drop index must come from TabDrag.computeDropIndex');
  assert(source.includes('TabDrag.reorderArray'), 'state.tabs must be reordered via TabDrag.reorderArray');
  assert(source.includes('TabDrag.remapActiveIndex'), 'state.activeTab must be remapped via TabDrag.remapActiveIndex');
});

test('a capture-phase click suppressor swallows the post-drag click', () => {
  // Without this, the click after mouseup can hit a stale index-closure
  // switchTab on a detached node (engine-dependent).
  const source = load(MAIN_JS);
  assert(source.includes('suppressNextTabClick'),
    'expected a suppressNextTabClick flag guarding the post-drag click');
  assert(/addEventListener\('click'[\s\S]{0,200}?true\)/.test(source),
    'expected a capture-phase click listener (suppressNextTabClick guard)');
});

test('window blur cancels the drag (mouseup can be lost outside the webview)', () => {
  const source = load(MAIN_JS);
  assert(/addEventListener\('blur',\s*cancelTabDrag\)/.test(source),
    'expected window blur wired to cancelTabDrag');
});

// ============================================
// index.html + main.css contract
// ============================================

test('index.html loads tab-drag.js before main.js', () => {
  const html = load(INDEX_HTML);
  const modPos = html.indexOf('scripts/tab-drag.js');
  const mainPos = html.indexOf('scripts/main.js');
  assert(modPos > -1, 'index.html missing scripts/tab-drag.js');
  assert(mainPos > -1, 'index.html missing scripts/main.js');
  assert(modPos < mainPos, 'tab-drag.js must load before main.js');
});

test('main.css carries the drag feedback classes', () => {
  const css = load(MAIN_CSS);
  assert(/\.tab-item\.dragging/.test(css), 'missing .tab-item.dragging');
  assert(/\.tab-item\.drop-before/.test(css), 'missing .tab-item.drop-before');
  assert(/\.tab-item\.drop-after/.test(css), 'missing .tab-item.drop-after');
});

test('.tab-item.dragging neutralizes transition (rubber-band guard)', () => {
  // .tab-item has `transition: all` — without an override the translateX
  // transform animates and the tab lags behind the cursor.
  const css = load(MAIN_CSS);
  const block = css.match(/\.tab-item\.dragging\s*\{([^}]*)\}/);
  assert(!!block, 'missing .tab-item.dragging rule');
  assert(/transition\s*:\s*none/.test(block[1]),
    '.tab-item.dragging must set transition: none');
});

function load(p) {
  return fs.readFileSync(p, 'utf8');
}

// ============================================
// Run
// ============================================

if (require.main === module) {
  console.log('Running Tab Drag wiring contract tests...\n');
  TestRunner.run();
}
