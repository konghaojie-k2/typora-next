#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for Paper Import (PDF / URL → Markdown)
 *
 * Modules under test:
 * - dist/scripts/learning/paper-import.js
 * - dist/scripts/learning/paper-reader-integration.js (welcome UI)
 */

const TestRunner = require('../../shared/test-runner');
const fs = require('fs');
const path = require('path');

function installDOM() {
  const elementMap = new Map();

  function makeNode(tag) {
    const node = {
      nodeType: 1,
      tagName: tag ? tag.toUpperCase() : '',
      children: [],
      childNodes: [],
      style: {},
      dataset: {},
      attributes: {},
      _listeners: {},
      _text: '',
      _html: '',
      appendChild(child) {
        this.children.push(child);
        this.childNodes.push(child);
        child.parentNode = this;
        return child;
      },
      removeChild(child) {
        this.children = this.children.filter(c => c !== child);
        this.childNodes = this.childNodes.filter(c => c !== child);
        child.parentNode = null;
      },
      remove() {
        if (this.parentNode) this.parentNode.removeChild(this);
      },
      addEventListener(name, fn) {
        (this._listeners[name] = this._listeners[name] || []).push(fn);
      },
      removeEventListener(name, fn) {
        if (!this._listeners[name]) return;
        this._listeners[name] = this._listeners[name].filter(f => f !== fn);
      },
      click() {
        const listeners = this._listeners['click'] || [];
        listeners.forEach(fn => fn.call(this, { target: this }));
      },
      setAttribute(k, v) { this.attributes[k] = v; },
      getAttribute(k) { return this.attributes[k]; },
      set textContent(v) { this._text = v; },
      get textContent() { return this._text || ''; },
      set innerHTML(v) {
        this._html = v;
        // Simple heuristic: register any id="..." found in the HTML so that
        // querySelector('#id') works like in a real DOM.
        const matches = v.matchAll(/id="([^"]+)"/g);
        for (const match of matches) {
          const id = match[1];
          if (!elementMap.has(id)) {
            const node = makeNode();
            node.id = id;
          }
        }
      },
      get innerHTML() { return this._html || ''; },
      set className(v) { this.attributes.class = v; },
      get className() { return this.attributes.class || ''; },
      set id(v) {
        if (this.attributes.id) elementMap.delete(this.attributes.id);
        this.attributes.id = v;
        if (v) elementMap.set(v, this);
      },
      get id() { return this.attributes.id; },
      checked: false,
      value: '',
      disabled: false,
      querySelector(sel) {
        if (sel.startsWith('#')) {
          return elementMap.get(sel.slice(1)) || null;
        }
        return null;
      },
      querySelectorAll(sel) {
        if (sel === '#paper-reader-feedback-overlay') return [];
        return [];
      },
      classList: {
        _set: new Set(),
        contains(c) { return this._set.has(c); },
        add(c) { this._set.add(c); },
        remove(c) { this._set.delete(c); },
        toggle(c) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); }
      }
    };
    return node;
  }

  global.document = {
    createElement(tag) { return makeNode(tag); },
    body: makeNode('body'),
    head: makeNode('head'),
    getElementById(id) { return elementMap.get(id) || null; },
    querySelector(sel) { return this.body.querySelector(sel); },
    querySelectorAll(sel) { return []; }
  };

  global.window = {
    __TAURI__: undefined,
    TyporaNext: {
      openPaperFile: () => {},
      openPaperPdf: () => {},
      openPaperUrl: () => {}
    },
    PaperReader: function () {},
    PaperReaderIntegration: null,
    PaperImport: null,
    scrollTo() {}
  };
}

function loadPaperReaderIntegration() {
  const modPath = path.join(__dirname, '../../../dist/scripts/learning/paper-reader-integration.js');
  delete require.cache[require.resolve(modPath)];
  require(modPath);
  return global.window.PaperReaderIntegration;
}

function loadPaperImport() {
  const modPath = path.join(__dirname, '../../../dist/scripts/learning/paper-import.js');
  delete require.cache[require.resolve(modPath)];
  require(modPath);
  return global.window.PaperImport;
}

TestRunner.test('PaperImport.extractTitle extracts first heading', () => {
  installDOM();
  const PaperImport = loadPaperImport();
  const content = '# My Paper Title\n\nSome body text.';
  TestRunner.assertEquals(PaperImport.extractTitle(content), 'My Paper Title');
});

TestRunner.test('PaperImport.extractTitle returns null when no heading', () => {
  installDOM();
  const PaperImport = loadPaperImport();
  TestRunner.assertEquals(PaperImport.extractTitle('No heading here'), null);
});

TestRunner.test('PaperImport.showProgress renders progress DOM', () => {
  installDOM();
  const PaperImport = loadPaperImport();
  const container = document.createElement('div');
  PaperImport.showProgress(container, 'poll', '正在解析...');

  const html = container.innerHTML;
  TestRunner.assert(html.includes('paper-import-progress'), 'should include progress class');
  TestRunner.assert(html.includes('正在解析...'), 'should show custom message');
  TestRunner.assert(html.includes('width: 50%'), 'poll step should be 50%');
});

TestRunner.test('PaperReaderIntegration.showWelcome renders PDF and URL inputs', () => {
  installDOM();
  loadPaperImport();
  const PaperReaderIntegration = loadPaperReaderIntegration();

  const container = document.createElement('div');
  PaperReaderIntegration.showWelcome(container);

  const html = container.innerHTML;
  TestRunner.assert(html.includes('导入本地 PDF'), 'should render PDF import button');
  TestRunner.assert(html.includes('paper-reader-url-input'), 'should render URL input');
  TestRunner.assert(html.includes('paper-reader-import-url'), 'should render URL import button');
  TestRunner.assert(html.includes('PDF、论文 URL'), 'should update supported formats tag');
  TestRunner.assert(!html.includes('未来还将支持粘贴论文 URL'), 'should remove old hint');
});

TestRunner.test('PaperReaderIntegration.showWelcome binds PDF button click', () => {
  installDOM();
  loadPaperImport();
  const PaperReaderIntegration = loadPaperReaderIntegration();

  let called = false;
  global.window.TyporaNext.openPaperPdf = () => { called = true; };

  const container = document.createElement('div');
  PaperReaderIntegration.showWelcome(container);

  const pdfBtn = container.querySelector('#paper-reader-select-pdf');
  TestRunner.assertExists(pdfBtn, 'PDF button should exist');
  pdfBtn.click();
  TestRunner.assert(called, 'openPaperPdf should be called');
});

TestRunner.test('PaperReaderIntegration.showWelcome binds URL import on Enter', () => {
  installDOM();
  loadPaperImport();
  const PaperReaderIntegration = loadPaperReaderIntegration();

  let called = false;
  global.window.TyporaNext.openPaperUrl = () => { called = true; };

  const container = document.createElement('div');
  PaperReaderIntegration.showWelcome(container);

  const input = container.querySelector('#paper-reader-url-input');
  TestRunner.assertExists(input, 'URL input should exist');

  const listeners = input._listeners['keydown'] || [];
  TestRunner.assert(listeners.length > 0, 'keydown listener should be registered');

  listeners[0]({ key: 'Enter' });
  TestRunner.assert(called, 'openPaperUrl should be called on Enter');
});

TestRunner.run();
