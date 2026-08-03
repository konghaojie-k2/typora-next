#!/usr/bin/env node
// -*- coding: utf-8 -*-
/**
 * TDD Tests for toolbar export dropdown (toolbar-dropdown.js)
 *
 * Verifies the dropdown state machine against the REAL module:
 * - Initially closed
 * - Trigger click toggles open/closed (+ aria-expanded)
 * - Menu item click closes the dropdown
 * - Click inside menu (non-item) keeps it open
 * - Click outside closes it
 * - Escape closes it
 * - destroy() detaches all listeners
 */

const TestRunner = require('../../shared/test-runner');
const ToolbarDropdown = require('../../../dist/scripts/toolbar-dropdown.js');

// ============================================
// Minimal fake DOM (same idiom as test_toolbar_tooltip.js)
// ============================================
function createElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    _attrs: {},
    _classes: [],
    _listeners: {},
    _children: [],
    _parent: null,
    style: {},
    textContent: '',

    classList: {
      add(c) { if (!el._classes.includes(c)) el._classes.push(c); },
      remove(c) { el._classes = el._classes.filter(x => x !== c); },
      contains(c) { return el._classes.includes(c); }
    },

    setAttribute(k, v) { el._attrs[k] = String(v); },
    getAttribute(k) { return el._attrs[k] ?? null; },
    removeAttribute(k) { delete el._attrs[k]; },

    appendChild(c) {
      el._children.push(c);
      c._parent = el;
      return c;
    },

    contains(target) {
      if (target === el) return true;
      return el._children.some(c => c.contains(target));
    },

    addEventListener(ev, fn) {
      (el._listeners[ev] = el._listeners[ev] || []).push(fn);
    },

    removeEventListener(ev, fn) {
      if (el._listeners[ev]) {
        el._listeners[ev] = el._listeners[ev].filter(f => f !== fn);
      }
    },

    // Test helper: fire an event on this element (no bubbling simulation —
    // the module attaches document handlers on `doc`, trigger handlers on
    // `trigger`, so tests dispatch on the exact element).
    dispatch(ev, payload = {}) {
      (el._listeners[ev] || []).slice().forEach(fn => fn({ target: el, ...payload }));
    }
  };
  return el;
}

function buildDropdownDom() {
  const doc = createElement('#document');
  const container = createElement('div');
  const trigger = createElement('button');
  const menu = createElement('div');
  const item = createElement('button');
  item._classes = ['toolbar-dropdown-item'];
  const label = createElement('span');
  const outside = createElement('div');

  menu.appendChild(item);
  menu.appendChild(label);
  container.appendChild(trigger);
  container.appendChild(menu);
  doc.appendChild(container);
  doc.appendChild(outside);

  return { doc, container, trigger, menu, item, label, outside };
}

// ============================================
// Tests
// ============================================
TestRunner.test('Dropdown starts closed', () => {
  const { doc, trigger, menu } = buildDropdownDom();
  const dd = ToolbarDropdown.create({ trigger, menu, doc });

  TestRunner.assertEquals(dd.isOpen(), false, 'Should start closed');
  TestRunner.assertEquals(menu.classList.contains('open'), false, 'Menu should lack open class');
});

TestRunner.test('Trigger click opens the dropdown and sets aria-expanded', () => {
  const { doc, trigger, menu } = buildDropdownDom();
  const dd = ToolbarDropdown.create({ trigger, menu, doc });

  trigger.dispatch('click');

  TestRunner.assertEquals(dd.isOpen(), true, 'Should be open after trigger click');
  TestRunner.assertEquals(menu.classList.contains('open'), true, 'Menu should have open class');
  TestRunner.assertEquals(trigger.getAttribute('aria-expanded'), 'true', 'aria-expanded should be true');
});

TestRunner.test('Second trigger click closes the dropdown', () => {
  const { doc, trigger, menu } = buildDropdownDom();
  const dd = ToolbarDropdown.create({ trigger, menu, doc });

  trigger.dispatch('click');
  trigger.dispatch('click');

  TestRunner.assertEquals(dd.isOpen(), false, 'Should be closed after second click');
  TestRunner.assertEquals(menu.classList.contains('open'), false, 'Menu should lack open class');
  TestRunner.assertEquals(trigger.getAttribute('aria-expanded'), 'false', 'aria-expanded should be false');
});

TestRunner.test('Menu item click closes the dropdown', () => {
  const { doc, trigger, menu, item } = buildDropdownDom();
  const dd = ToolbarDropdown.create({ trigger, menu, doc });

  trigger.dispatch('click');
  // Fake DOM has no bubbling: the module listens on `menu`, so dispatch
  // there with the item as target (browser would bubble item → menu).
  menu.dispatch('click', { target: item });

  TestRunner.assertEquals(dd.isOpen(), false, 'Item click should close the dropdown');
});

TestRunner.test('Click inside menu on non-item keeps dropdown open', () => {
  const { doc, trigger, menu, label } = buildDropdownDom();
  const dd = ToolbarDropdown.create({ trigger, menu, doc });

  trigger.dispatch('click');
  menu.dispatch('click', { target: label });

  TestRunner.assertEquals(dd.isOpen(), true, 'Non-item click inside menu should keep it open');
});

TestRunner.test('Click outside closes the dropdown', () => {
  const { doc, trigger, menu, outside } = buildDropdownDom();
  const dd = ToolbarDropdown.create({ trigger, menu, doc });

  trigger.dispatch('click');
  doc.dispatch('click', { target: outside });

  TestRunner.assertEquals(dd.isOpen(), false, 'Outside click should close the dropdown');
});

TestRunner.test('Trigger click bubbling to document does not re-open the dropdown', () => {
  const { doc, trigger, menu } = buildDropdownDom();
  const dd = ToolbarDropdown.create({ trigger, menu, doc });

  trigger.dispatch('click');
  TestRunner.assertEquals(dd.isOpen(), true, 'Should be open');

  // Browser sequence when clicking the trigger while open:
  // trigger handler toggles closed, then the same click bubbles to document.
  trigger.dispatch('click');
  doc.dispatch('click', { target: trigger });

  TestRunner.assertEquals(dd.isOpen(), false, 'Document handler must ignore clicks on the trigger');
});

TestRunner.test('Escape key closes the dropdown', () => {
  const { doc, trigger } = buildDropdownDom();
  const dd = ToolbarDropdown.create({ trigger, menu: buildDropdownDom().menu, doc });

  trigger.dispatch('click');
  TestRunner.assertEquals(dd.isOpen(), true, 'Should be open');

  doc.dispatch('keydown', { key: 'Escape' });
  TestRunner.assertEquals(dd.isOpen(), false, 'Escape should close the dropdown');
});

TestRunner.test('Non-Escape key does not close the dropdown', () => {
  const { doc, trigger, menu } = buildDropdownDom();
  const dd = ToolbarDropdown.create({ trigger, menu, doc });

  trigger.dispatch('click');
  doc.dispatch('keydown', { key: 'Enter' });

  TestRunner.assertEquals(dd.isOpen(), true, 'Enter should not close the dropdown');
});

TestRunner.test('destroy() detaches listeners so trigger no longer toggles', () => {
  const { doc, trigger, menu } = buildDropdownDom();
  const dd = ToolbarDropdown.create({ trigger, menu, doc });

  dd.destroy();
  trigger.dispatch('click');

  TestRunner.assertEquals(dd.isOpen(), false, 'After destroy, trigger click should not open');
});

// Run
TestRunner.run();
