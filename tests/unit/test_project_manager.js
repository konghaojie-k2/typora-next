/**
 * TDD Tests for Learning Project Manager
 * Tests the dialog state machine and outline data structures
 */

// Mock DOM for testing
function createMockElement(tag, attrs = {}) {
  const el = {
    tagName: tag.toUpperCase(),
    className: '',
    style: {},
    attributes: attrs,
    children: [],
    innerHTML: '',
    textContent: '',
    value: '',
    disabled: false,
    display: '',
    _listeners: {},

    classList: {
      list: [],
      add(cls) { this.list.push(cls); },
      remove(cls) { this.list = this.list.filter(c => c !== cls); },
      contains(cls) { return this.list.includes(cls); }
    },

    addEventListener(event, handler) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(handler);
    },

    removeEventListener(event, handler) {
      if (this._listeners[event]) {
        this._listeners[event] = this._listeners[event].filter(h => h !== handler);
      }
    },

    click() {
      if (this._listeners['click']) {
        this._listeners['click'].forEach(h => h());
      }
    },

    setAttribute(key, value) {
      this.attributes[key] = value;
    },

    getAttribute(key) {
      return this.attributes[key];
    },

    appendChild(child) {
      this.children.push(child);
    },

    removeChild(child) {
      this.children = this.children.filter(c => c !== child);
    },

    querySelector(selector) {
      // Simple mock - return first child matching
      return this.children[0] || null;
    },

    querySelectorAll(selector) {
      return this.children;
    }
  };
  return el;
}

// Mock document
global.document = {
  createElement(tag) {
    return createMockElement(tag);
  },
  getElementById(id) {
    return createMockElement('div', { id });
  },
  querySelector(selector) {
    return createMockElement('div');
  },
  body: createMockElement('body')
};

// Load test runner
const TestRunner = require('./test-runner');

// ============================================
// TDD: Learning Project Dialog State Machine
// ============================================

TestRunner.test('dialog state starts at idle', () => {
  const state = {
    step: 'idle',  // idle | input | planning | outline | generating
    goal: '',
    level: 'intermediate',
    hours: 3,
    outline: null,
    isLoading: false,
    error: null
  };

  TestRunner.assertEquals(state.step, 'idle', 'Initial state should be idle');
  TestRunner.assertEquals(state.goal, '', 'Initial goal should be empty');
});

TestRunner.test('dialog transitions to input when opened', () => {
  let state = { step: 'idle' };

  function openDialog() {
    state = { ...state, step: 'input', isLoading: false, error: null };
  }

  openDialog();
  TestRunner.assertEquals(state.step, 'input', 'State should transition to input');
});

TestRunner.test('outline data structure has required fields', () => {
  const outline = {
    chapters: [
      {
        title: '注意力机制的本质',
        duration_minutes: 25,
        concepts: ['注意力', '查询键值']
      },
      {
        title: 'Self-Attention',
        duration_minutes: 30,
        concepts: ['自注意力', '并行计算']
      }
    ],
    total_duration: 55
  };

  TestRunner.assert(outline.chapters.length > 0, 'Outline must have chapters');
  TestRunner.assertExists(outline.chapters[0].title, 'Chapter must have title');
  TestRunner.assertExists(outline.chapters[0].duration_minutes, 'Chapter must have duration');
  TestRunner.assert(Array.isArray(outline.chapters[0].concepts), 'Chapter must have concepts array');
});

TestRunner.test('editing a chapter updates the outline', () => {
  const outline = {
    chapters: [
      { title: '注意力机制', duration_minutes: 25, concepts: ['注意力'] }
    ]
  };

  function editChapter(outline, index, newTitle) {
    const updated = { ...outline };
    updated.chapters = [...outline.chapters];
    updated.chapters[index] = { ...updated.chapters[index], title: newTitle };
    return updated;
  }

  const result = editChapter(outline, 0, '注意力机制详解');
  TestRunner.assertEquals(result.chapters[0].title, '注意力机制详解', 'Title should be updated');
  TestRunner.assertEquals(outline.chapters[0].title, '注意力机制', 'Original should not be mutated');
});

TestRunner.test('deleting a chapter removes it and recalculates total', () => {
  const outline = {
    chapters: [
      { title: 'A', duration_minutes: 10, concepts: [] },
      { title: 'B', duration_minutes: 20, concepts: [] },
      { title: 'C', duration_minutes: 30, concepts: [] }
    ]
  };

  function deleteChapter(outline, index) {
    const chapters = outline.chapters.filter((_, i) => i !== index);
    const total_duration = chapters.reduce((sum, c) => sum + c.duration_minutes, 0);
    return { ...outline, chapters, total_duration };
  }

  const result = deleteChapter(outline, 1);
  TestRunner.assertEquals(result.chapters.length, 2, 'Should have 2 chapters after deletion');
  TestRunner.assertEquals(result.total_duration, 40, 'Total duration should be recalculated');
  TestRunner.assertEquals(result.chapters[1].title, 'C', 'Remaining chapters should shift');
});

TestRunner.test('planning state shows loading', () => {
  let state = { step: 'input', isLoading: false };

  function startPlanning() {
    state = { ...state, step: 'planning', isLoading: true, error: null };
  }

  startPlanning();
  TestRunner.assertEquals(state.step, 'planning', 'State should be planning');
  TestRunner.assert(state.isLoading, 'Should show loading');
});

TestRunner.test('planning error shows error message', () => {
  let state = { step: 'planning', isLoading: true, error: null };

  function handleError(message) {
    state = { ...state, step: 'input', isLoading: false, error: message };
  }

  handleError('API key 无效');
  TestRunner.assertEquals(state.step, 'input', 'Should return to input on error');
  TestRunner.assert(!state.isLoading, 'Should stop loading');
  TestRunner.assertEquals(state.error, 'API key 无效', 'Should store error message');
});

TestRunner.test('chapter duration validation', () => {
  const chapter = { title: 'Test', duration_minutes: 25, concepts: [] };

  TestRunner.assert(chapter.duration_minutes > 0, 'Duration must be positive');
  TestRunner.assert(chapter.duration_minutes <= 120, 'Single chapter should not exceed 2 hours');
});

// ============================================
// TDD: Chapter Status Enum
// ============================================

TestRunner.test('chapter status values are valid', () => {
  const VALID_STATUSES = ['not_generated', 'generating', 'ready', 'completed', 'failed'];

  TestRunner.assert(VALID_STATUSES.includes('not_generated'), 'Should have not_generated');
  TestRunner.assert(VALID_STATUSES.includes('generating'), 'Should have generating');
  TestRunner.assert(VALID_STATUSES.includes('ready'), 'Should have ready');
  TestRunner.assert(VALID_STATUSES.includes('completed'), 'Should have completed');
  TestRunner.assert(VALID_STATUSES.includes('failed'), 'Should have failed');
});

// ============================================
// TDD: Project State Persistence
// ============================================

TestRunner.test('project state has required structure', () => {
  const projectState = {
    goal: '理解 Transformer',
    level: 'intermediate',
    hours: 3,
    total_chapters: 8,
    completed_chapters: 0,
    chapters: [],
    concepts: {},
    created_at: '2026-05-29'
  };

  TestRunner.assertExists(projectState.goal, 'Must have goal');
  TestRunner.assertExists(projectState.level, 'Must have level');
  TestRunner.assert(typeof projectState.hours === 'number', 'Hours must be number');
  TestRunner.assert(typeof projectState.total_chapters === 'number', 'Total chapters must be number');
});

// Run all tests
console.log('Running TDD tests for Learning Project Manager...\n');
TestRunner.run();
