#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * BDD Acceptance Steps for toolbar export menu consolidation
 *
 * Two layers:
 * - Static markup: reads the REAL dist/index.html from the filesystem
 * - Behavior: requires the REAL dist/scripts/toolbar-dropdown.js module
 *   against the shared mock DOM
 */

const fs = require('fs');
const path = require('path');
const { buildMockDOM } = require('../shared/mock-dom');
const { StepRegistry } = require('../shared/runner');
const ToolbarDropdown = require('../../dist/scripts/toolbar-dropdown.js');

const steps = new StepRegistry();

const INDEX_HTML = path.join(__dirname, '../../dist/index.html');

// ============================================
// Context helpers
// ============================================
function setupDropdown(context) {
  if (context.dropdown) return;

  const { document } = buildMockDOM();
  context.document = document;

  const container = document.createElement('div');
  container.className = 'toolbar-dropdown-container';

  const trigger = document.createElement('button');
  trigger.className = 'btn-icon';
  trigger._attrs.id = 'exportMenuBtn';
  trigger.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'toolbar-dropdown';
  menu._attrs.id = 'exportMenu';

  for (const id of ['exportWordBtn', 'exportPdfBtn', 'shareBtn']) {
    const item = document.createElement('button');
    item.className = 'toolbar-dropdown-item';
    item._attrs.id = id;
    menu.appendChild(item);
  }

  const outside = document.createElement('div');

  container.appendChild(trigger);
  container.appendChild(menu);
  document.body.appendChild(container);
  document.body.appendChild(outside);

  context.trigger = trigger;
  context.menu = menu;
  context.outside = outside;
  context.dropdown = ToolbarDropdown.create({ trigger, menu, doc: document });
}

function clickMenuItem(context, id) {
  const item = context.menu.querySelector(`#${id}`) ||
    context.menu._children.find(c => (c._attrs.id || '') === id);
  if (!item) throw new Error(`Menu item not found: ${id}`);
  // Module listens on the menu (browser would bubble item → menu)
  (context.menu._listeners.click || []).forEach(fn => fn({ target: item }));
}

// ============================================
// Given
// ============================================
steps.given('the real index.html toolbar markup', function() {
  this.html = fs.readFileSync(INDEX_HTML, 'utf-8');
});

steps.given('a toolbar export dropdown', function() {
  setupDropdown(this);
});

steps.given('the dropdown is open', function() {
  setupDropdown(this);
  this.trigger.click();
  if (!this.dropdown.isOpen()) throw new Error('Dropdown failed to open in Given');
});

// ============================================
// When
// ============================================
steps.when('the user clicks the export menu button', function() {
  this.trigger.click();
});

steps.when('the user clicks the {string} menu item', function(id) {
  clickMenuItem(this, id);
});

steps.when('the user clicks outside the dropdown', function() {
  this.document._dispatchDocEvent('click', { target: this.outside });
});

steps.when('the user presses Escape', function() {
  this.document._dispatchDocEvent('keydown', { key: 'Escape' });
});

// ============================================
// Then
// ============================================
steps.then('there should be an export menu button', function() {
  if (!this.html.includes('id="exportMenuBtn"')) {
    throw new Error('index.html missing #exportMenuBtn trigger');
  }
  if (!this.html.includes('id="exportMenu"')) {
    throw new Error('index.html missing #exportMenu dropdown');
  }
});

steps.then('the dropdown should contain items {string}, {string} and {string}', function(a, b, c) {
  // Extract the exportMenu block and verify each item is a dropdown item inside it
  const menuStart = this.html.indexOf('id="exportMenu"');
  if (menuStart === -1) throw new Error('#exportMenu not found');
  const containerEnd = this.html.indexOf('</div>\n          </div>', menuStart);
  const block = this.html.slice(menuStart, containerEnd === -1 ? undefined : containerEnd);
  for (const id of [a, b, c]) {
    const itemRe = new RegExp(`<button class="toolbar-dropdown-item" id="${id}"`);
    if (!itemRe.test(block)) {
      throw new Error(`#${id} is not a toolbar-dropdown-item inside #exportMenu`);
    }
  }
});

steps.then('the three items should no longer be standalone toolbar buttons', function() {
  for (const id of ['exportWordBtn', 'exportPdfBtn', 'shareBtn']) {
    const standaloneRe = new RegExp(`<button class="btn-icon" id="${id}"`);
    if (standaloneRe.test(this.html)) {
      throw new Error(`#${id} is still a standalone .btn-icon toolbar button`);
    }
  }
});

steps.then('the dropdown should be open', function() {
  if (!this.dropdown.isOpen()) throw new Error('Dropdown is not open');
  if (!this.menu.classList.contains('open')) throw new Error('Menu lacks open class');
  if (this.trigger.getAttribute('aria-expanded') !== 'true') {
    throw new Error('aria-expanded is not true');
  }
});

steps.then('the dropdown should be closed', function() {
  if (this.dropdown.isOpen()) throw new Error('Dropdown is still open');
  if (this.menu.classList.contains('open')) throw new Error('Menu still has open class');
});

module.exports = steps;
