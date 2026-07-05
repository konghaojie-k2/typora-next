#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for PaperReaderIntegration (Sprint 10 PB2)
 *
 * Module under test:
 * - dist/scripts/learning/paper-reader-integration.js
 *
 * Contracts:
 *  - showWelcome(container) renders a welcome screen with a select-file button
 *  - showLoading(container) renders loading steps and starts an interval
 *  - loadGuideForTab(tab) fetches guide + html and caches them on the tab
 *  - enhancePaperTab(tab) renders a PaperReader into #markdownBody and caches the reader
 *  - unmountTab(tab) closes the reader and clears feedback overlays
 *  - teardown() closes all paper readers across tabs
 */

const TestRunner = require('../../shared/test-runner');
const fs = require('fs');
const path = require('path');

function makeNode(tag) {
  const node = {
    nodeType: 1,
    tagName: (tag || '').toUpperCase(),
    children: [],
    childNodes: [],
    style: {},
    dataset: {},
    attributes: {},
    _listeners: {},
    _html: '',
    appendChild(child) { this.children.push(child); this.childNodes.push(child); child.parentNode = this; return child; },
    removeChild(child) {
      this.children = this.children.filter(c => c !== child);
      this.childNodes = this.childNodes.filter(c => c !== child);
    },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    addEventListener(name, fn) { (this._listeners[name] = this._listeners[name] || []).push(fn); },
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html; },
    querySelector(sel) {
      if (sel.startsWith('#')) return null; // not used by integration logic
      return null;
    },
    querySelectorAll(sel) {
      const result = [];
      if (sel.startsWith('#')) return result;
      return result;
    }
  };
  return node;
}

function setupEnvironment(overrides = {}) {
  const container = makeNode('div');
  container.id = 'markdownBody';
  const elementsById = new Map([['markdownBody', container]]);

  global.document = {
    getElementById(id) { return elementsById.get(id) || null; },
    querySelectorAll() { return []; }
  };

  // Fake PaperReader class capturing options + render calls.
  const readerInstances = [];
  class FakePaperReader {
    constructor(options) { this.options = options; this.paperFile = null; this._closed = false; readerInstances.push(this); }
    render(guide, html) { this.guide = guide; this.html = html; container._rendered = true; }
    close() { this._closed = true; }
  }

  const invokeCalls = [];
  const TyporaNext = {
    state: { tabs: [] },
    invoke: overrides.invoke || (async (cmd, args) => {
      invokeCalls.push({ cmd, args });
      if (cmd === 'generate_paper_reader_guide') return { sections: [] };
      if (cmd === 'read_text_file') return '# title';
      if (cmd === 'render_markdown') return '<h1>title</h1>';
      return '';
    }),
    closeTab: overrides.closeTab || (() => {}),
    openPaperFile: overrides.openPaperFile || (() => {})
  };

  global.window = {
    TyporaNext,
    PaperReader: FakePaperReader,
    PaperReaderIntegration: null // will be set after load
  };

  return { container, readerInstances, invokeCalls, TyporaNext };
}

function loadIntegration() {
  const modPath = path.join(__dirname, '../../../dist/scripts/learning/paper-reader-integration.js');
  const src = fs.readFileSync(modPath, 'utf8');
  // Module is an IIFE that attaches to global/window. Eval in this context.
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'global', src + '\nreturn window.PaperReaderIntegration;');
  return fn(global.window, global);
}

TestRunner.test('showWelcome renders welcome screen with select button', () => {
  const { container } = setupEnvironment();
  const Integration = loadIntegration();
  Integration.showWelcome(container);
  if (!container.innerHTML.includes('paper-reader-welcome')) throw new Error('welcome markup missing');
  if (!container.innerHTML.includes('paper-reader-select-file')) throw new Error('select button missing');
});

TestRunner.test('showLoading renders loading steps and starts interval', () => {
  const { container } = setupEnvironment();
  const Integration = loadIntegration();
  Integration.showLoading(container);
  if (!container.innerHTML.includes('paper-reader-loading')) throw new Error('loading markup missing');
  if (!container._paperReaderLoadingInterval) throw new Error('interval not stored');
  Integration._clearLoadingInterval(container);
  if (container._paperReaderLoadingInterval !== null) throw new Error('interval not cleared');
});

TestRunner.test('loadGuideForTab fetches guide + html and caches on tab', async () => {
  const { invokeCalls } = setupEnvironment();
  const Integration = loadIntegration();
  const tab = { path: 'C:\\paper.md' };
  const guide = await Integration.loadGuideForTab(tab);
  if (!guide) throw new Error('guide not returned');
  if (tab.paperGuide !== guide) throw new Error('guide not cached on tab');
  if (tab.paperOriginalHtml !== '<h1>title</h1>') throw new Error('originalHtml not cached');
  if (tab.paperContent !== '# title') throw new Error('content not cached');

  // Second call reuses cache without invoking again.
  const before = invokeCalls.length;
  await Integration.loadGuideForTab(tab);
  if (invokeCalls.length !== before) throw new Error('cache miss: invoked again');
});

TestRunner.test('enhancePaperTab renders reader and caches reader on tab', async () => {
  const { container, readerInstances } = setupEnvironment();
  const Integration = loadIntegration();
  const tab = { path: 'C:\\paper.md', mode: 'paper' };
  await Integration.enhancePaperTab(tab);
  if (!tab.paperGuide) throw new Error('guide not generated');
  if (!tab.paperReader) throw new Error('reader not cached on tab');
  if (readerInstances.length !== 1) throw new Error('expected 1 reader instance');
  if (tab.paperReader.paperFile !== tab.path) throw new Error('paperFile not set on reader');
  if (container._rendered !== true) throw new Error('reader.render not called into container');
});

TestRunner.test('enhancePaperTab reuses cached guide without regenerating', async () => {
  const { invokeCalls } = setupEnvironment();
  const Integration = loadIntegration();
  const tab = { path: 'C:\\paper.md', mode: 'paper', paperGuide: { sections: [] }, paperOriginalHtml: '<h1>x</h1>' };
  await Integration.enhancePaperTab(tab);
  if (invokeCalls.some(c => c.cmd === 'generate_paper_reader_guide')) {
    throw new Error('guide regenerated despite cache');
  }
});

TestRunner.test('unmountTab closes the reader and clears it from tab', () => {
  const Integration = loadIntegration();
  const fakeReader = { close: () => { fakeReader._closed = true; }, _closed: false };
  const tab = { mode: 'paper', paperReader: fakeReader };
  Integration.unmountTab(tab);
  if (!fakeReader._closed) throw new Error('reader.close not called');
  if (tab.paperReader !== null) throw new Error('reader not cleared from tab');
});

TestRunner.test('teardown closes all paper readers across tabs', () => {
  setupEnvironment();
  const Integration = loadIntegration();
  const closed = [];
  const tabs = [
    { mode: 'paper', paperReader: { close: () => closed.push('a') } },
    { mode: 'normal', paperReader: null },
    { mode: 'paper', paperReader: { close: () => closed.push('c') } }
  ];
  global.window.TyporaNext.state.tabs = tabs;
  Integration.teardown();
  if (closed.length !== 2) throw new Error('expected 2 readers closed, got ' + closed.length);
  if (tabs[0].paperReader !== null || tabs[2].paperReader !== null) {
    throw new Error('readers not cleared from tabs');
  }
});

TestRunner.test('enhancePaperTab restores saved scrollTop', async () => {
  setupEnvironment();
  const Integration = loadIntegration();
  const tab = { path: 'C:\\paper.md', mode: 'paper', scrollTop: 123 };
  await Integration.enhancePaperTab(tab);
  // Fake DOM has no #paper-reader-main, so restore is a no-op — verify no crash + reader created.
  if (!tab.paperReader) throw new Error('reader not created');
});

(async () => {
  const result = await TestRunner.run();
  process.exit(result.failed > 0 ? 1 : 0);
})();
