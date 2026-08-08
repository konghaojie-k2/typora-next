#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for external file refresh (Sprint 14)
 *
 * Two layers:
 * - Behavior: requires the REAL dist/scripts/external-refresh.js module
 *   (the decision used by switchTab when returning to a background tab)
 * - Static markup: reads the REAL dist/index.html to verify the manual
 *   refresh button exists and the module is loaded before main.js
 */

const fs = require('fs');
const path = require('path');
const { StepRegistry } = require('../shared/runner');
const ExternalRefresh = require('../../dist/scripts/external-refresh');

const steps = new StepRegistry();

const INDEX_HTML = path.join(__dirname, '../../dist/index.html');
const MODULE_JS = path.join(__dirname, '../../dist/scripts/external-refresh.js');

// ============================================
// Given
// ============================================
steps.given('an open tab whose cached content differs from disk', function() {
  this.cached = '# 旧内容\n';
  this.disk = '# 新内容\n';
  this.promptVisible = false;
});

steps.given('an open tab whose cached content matches disk', function() {
  this.cached = '# 相同内容\n';
  this.disk = '# 相同内容\n';
  this.promptVisible = false;
});

steps.given('an open tab whose file cannot be read from disk', function() {
  this.cached = '# 缓存内容\n';
  this.disk = undefined; // open_file 失败/被删：被动检测不得误报
  this.promptVisible = false;
});

steps.given('no refresh prompt is currently visible', function() {
  this.promptVisible = false;
});

steps.given('a refresh prompt is currently visible', function() {
  this.promptVisible = true;
});

steps.given('the real index.html markup', function() {
  this.html = fs.readFileSync(INDEX_HTML, 'utf-8');
});

// ============================================
// When
// ============================================
steps.when('the external refresh decision is evaluated', function() {
  this.decision = ExternalRefresh.shouldPromptExternalRefresh(
    this.cached,
    this.disk,
    this.promptVisible
  );
});

// ============================================
// Then
// ============================================
steps.then('a refresh prompt should be shown', function() {
  if (this.decision !== true) {
    throw new Error(`Expected prompt=true, got ${this.decision}`);
  }
});

steps.then('no refresh prompt should be shown', function() {
  if (this.decision !== false) {
    throw new Error(`Expected prompt=false, got ${this.decision}`);
  }
});

steps.then('the toolbar should contain a refresh file button', function() {
  if (!this.html.includes('id="refreshFileBtn"')) {
    throw new Error('index.html missing #refreshFileBtn toolbar button');
  }
});

steps.then('the page should load the external refresh module', function() {
  if (!this.html.includes('scripts/external-refresh.js')) {
    throw new Error('index.html does not load scripts/external-refresh.js');
  }
  if (!fs.existsSync(MODULE_JS)) {
    throw new Error('dist/scripts/external-refresh.js missing on disk');
  }
  if (typeof ExternalRefresh.shouldPromptExternalRefresh !== 'function') {
    throw new Error('external-refresh.js does not export shouldPromptExternalRefresh');
  }
});

module.exports = steps;
